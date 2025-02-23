const { Actor } = require('apify');
const { PlaywrightCrawler } = require('crawlee');
const cheerio = require('cheerio');

await Actor.init();

const input = await Actor.getInput();
const { startUrls, linkPattern, maxPages } = input || {};

if (!startUrls || !Array.isArray(startUrls) || startUrls.length === 0) {
    console.error('No valid "startUrls" provided in input');
    await Actor.exit(1);
}

const holidayKeywords = {
    'Christmas': ['christmas', 'xmas', 'winter holiday', 'noel'],
    'Thanksgiving': ['thanksgiving', 'turkey day'],
    'Halloween': ['halloween', 'all hallows', 'spooky'],
    'Easter': ['easter', 'spring holiday'],
    'Valentine': ['valentine', "valentine's", 'love day'],
    'New Year': ['new year', "new year's", 'nye'],
    'General': []
};

function detectHoliday(text) {
    const lowerText = text.toLowerCase();
    for (const [holiday, keywords] of Object.entries(holidayKeywords)) {
        if (keywords.some(keyword => lowerText.includes(keyword))) {
            return holiday;
        }
    }
    return 'General';
}

function extractRecipe($, url) {
    const recipe = {
        title: $('h1, h2').first().text().trim() || 'Untitled Recipe',
        ingredients: [],
        instructions: [],
        holiday: 'General',
        sourceUrl: url
    };
    recipe.holiday = detectHoliday(recipe.title);

    $('ul li, .ingredients li, .ingredient-list li').each((i, el) => {
        const ingredient = $(el).text().trim();
        if (ingredient) recipe.ingredients.push(ingredient);
    });

    $('ol li, .instructions li, .steps li').each((i, el) => {
        const instruction = $(el).text().trim();
        if (instruction) recipe.instructions.push(instruction);
    });

    return recipe;
}

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxPages || 100,
    async requestHandler({ page, request }) {
        const url = request.url;
        console.log(`Processing: ${url}`);
        const html = await page.content();
        const $ = cheerio.load(html);

        const recipes = [];
        const recipeContainers = $('.recipe, .recipe-card, .post-recipe, article, .wprm-recipe-container');

        if (recipeContainers.length > 0) {
            recipeContainers.each((i, container) => {
                const recipe = extractRecipe($, $(container), url);
                if (recipe.ingredients.length > 0 || recipe.instructions.length > 0) {
                    recipes.push(recipe);
                }
            });
        } else {
            const singleRecipe = extractRecipe($, url);
            if (singleRecipe.ingredients.length > 0 || singleRecipe.instructions.length > 0) {
                recipes.push(singleRecipe);
            }
        }

        if (recipes.length > 0) {
            await Actor.pushData(recipes);
        }

        const linkRegex = new RegExp(linkPattern || '/recipe/\\d+/');
        const links = await page.$$eval('a[href]', anchors =>
            anchors.map(a => a.href).filter(href => href && linkRegex.test(href))
        );
        await crawler.addRequests(links.map(url => ({ url })));
    },
    failedRequestHandler({ request, error }) {
        console.error(`Failed: ${request.url} - ${error.message}`);
        await Actor.pushData({ error: error.message, url: request.url });
    }
});

await crawler.run(startUrls);

const dataset = await Actor.openDataset();
const { items } = await dataset.getData();

const categorizedRecipes = {};
items.forEach(recipe => {
    if (!categorizedRecipes[recipe.holiday]) {
        categorizedRecipes[recipe.holiday] = [];
    }
    categorizedRecipes[recipe.holiday].push({
        title: recipe.title,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        sourceUrl: recipe.sourceUrl
    });
});

console.log(`Found ${items.length} recipes across all pages`);
console.log('Categorized recipes:', categorizedRecipes);

await Actor.pushData({
    totalRecipes: items.length,
    byHoliday: categorizedRecipes
});

await Actor.exit();
