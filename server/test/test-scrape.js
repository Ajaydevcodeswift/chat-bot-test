const fs = require("fs/promises");

const PageScraperService = require("./page-scraper.service");

async function main() {
    console.log("page scraping started")
    const scraper = new PageScraperService();
    console.log(scraper, "scraper")

    const result = await scraper.scrape("https://pft-api-client-dev.el.r.appspot.com");

    await fs.writeFile("page.json", JSON.stringify(result, null, 2));

    console.log("Scraped Successfully");
    console.log(result.title);
}

main();
