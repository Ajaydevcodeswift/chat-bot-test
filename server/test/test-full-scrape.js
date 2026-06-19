// const fs = require("fs/promises");
// const path = require("path");

// const UrlDiscoveryService = require("./url-discovery.service");
// const PageScraperService = require("./page-scraper.service");

// async function main() {
//     const baseUrl = "https://cspt-dev-client.el.r.appspot.com";

//     const discoveryService = new UrlDiscoveryService();
//     const scraperService = new PageScraperService();

//     console.log("Discovering URLs...");

//     const urls = await discoveryService.discover(baseUrl);

//     console.log(`Found ${urls.length} URLs`);

//     await fs.mkdir("./output", {
//         recursive: true,
//     });

//     for (const url of urls) {
//         try {
//             console.log(`Scraping ${url}`);

//             const pageData =
//                 await scraperService.scrape(url);

//             const fileName =
//                 generateFileName(url);

//             await fs.writeFile(
//                 path.join(
//                     "./output",
//                     `${fileName}.json`
//                 ),
//                 JSON.stringify(
//                     pageData,
//                     null,
//                     2
//                 )
//             );

//             console.log(
//                 `Saved ${fileName}.json`
//             );
//         } catch (error) {
//             console.error(
//                 `Failed: ${url}`,
//                 error.message
//             );
//         }
//     }

//     console.log("Completed");
// }

// function generateFileName(url) {
//     const parsed = new URL(url);

//     let pathname =
//         parsed.pathname.replace(
//             /\//g,
//             "_"
//         );

//     if (!pathname) {
//         pathname = "home";
//     }

//     if (
//         pathname === "_" ||
//         pathname === ""
//     ) {
//         pathname = "home";
//     }

//     return pathname
//         .replace(/^_/, "")
//         .replace(/_$/, "") || "home";
// }

// main();


const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const UrlDiscoveryService = require("./url-discovery.service");
const PageScraperService = require("./page-scraper.service");
const PdfScraperService = require("./pdf-scraper.service");

async function main() {
    const baseUrl = "https://pft-api-client-dev.el.r.appspot.com";

    // Single browser instance shared across all pages
    const browser = await chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    });

    const discoveryService = new UrlDiscoveryService();
    const scraperService = new PageScraperService(browser);  // inject browser
    const pdfScraper = new PdfScraperService();

    try {
        console.log("Discovering URLs...");
        const initialUrls = await discoveryService.discover(baseUrl);
        console.log(`Found ${initialUrls.length} URLs`);

        await fs.mkdir("./output", { recursive: true });

        // Use a queue + visited set instead of simple for loop
        // so newly discovered links get crawled too
        const visited = new Set();
        const queue = [...initialUrls];

        while (queue.length > 0) {
            const url = queue.shift();
            if (visited.has(url)) continue;
            visited.add(url);

            try {
                const isPdf = url.toLowerCase().endsWith(".pdf");
                console.log(`Scraping ${isPdf ? "[PDF]" : "[PAGE]"}: ${url}`);

                const pageData = isPdf
                    ? await pdfScraper.scrape(url)
                    : await scraperService.scrape(url);

                if (!pageData) continue;

                const fileName = generateFileName(url);

                await fs.writeFile(
                    path.join("./output", `${fileName}.json`),
                    JSON.stringify(pageData, null, 2)
                );

                console.log(`Saved: ${fileName}.json`);

                // Queue newly discovered page links
                for (const { url: linkUrl } of pageData.discoveredLinks || []) {
                    if (!visited.has(linkUrl) && !queue.includes(linkUrl)) {
                        queue.push(linkUrl);
                    }
                }

                // Queue newly discovered PDF links
                for (const { url: pdfUrl } of pageData.discoveredPdfLinks || []) {
                    if (!visited.has(pdfUrl) && !queue.includes(pdfUrl)) {
                        queue.push(pdfUrl);
                    }
                }

            } catch (error) {
                console.error(`Failed: ${url}`, error.message);
            }
        }

        console.log(`\nCompleted. Total scraped: ${visited.size} URLs`);

    } finally {
        await browser.close(); // always close even if something throws
    }
}

function generateFileName(url) {
    const parsed = new URL(url);
    let pathname = parsed.pathname.replace(/\//g, "_");
    if (!pathname || pathname === "_" || pathname === "") {
        pathname = "home";
    }
    return pathname.replace(/^_/, "").replace(/_$/, "") || "home";
}

main();