const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const UrlDiscoveryService = require("./url-discovery.service");
const PageScraperService = require("./page-scraper.service");
const PdfScraperService = require("./pdf-scraper.service");
const ChunkerService = require("./chunker.service");

const CLIENT_ID = "tenant_001";

async function main() {
    // const baseUrl = "https://cspt-dev-client.el.r.appspot.com";
    const baseUrl = "https://pft-api-client-dev.el.r.appspot.com";

    const browser = await chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    });

    const scraperService = new PageScraperService(browser);
    const pdfScraper = new PdfScraperService();
    const chunker = new ChunkerService({ chunkSize: 400, overlap: 50 });

    try {
        // ── Phase 1: Discover URLs ──────────────────────────────────────────
        const discoveryService = new UrlDiscoveryService();
        console.log("Discovering URLs...");
        const initialUrls = await discoveryService.discover(baseUrl);
        console.log(`Found ${initialUrls.length} URLs`);

        const visited = new Set();
        const queue = [...initialUrls];
        const allScrapedPages = [];

        // ── Phase 2: Scrape all pages ───────────────────────────────────────
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

                allScrapedPages.push(pageData);

                for (const { url: linkUrl } of pageData.discoveredLinks || []) {
                    if (!visited.has(linkUrl) && !queue.includes(linkUrl)) {
                        queue.push(linkUrl);
                    }
                }
                for (const { url: pdfUrl } of pageData.discoveredPdfLinks || []) {
                    if (!visited.has(pdfUrl) && !queue.includes(pdfUrl)) {
                        queue.push(pdfUrl);
                    }
                }

            } catch (error) {
                console.error(`Failed: ${url}`, error.message);
            }
        }

        console.log(`\nScraping done. ${allScrapedPages.length} pages collected`);

        // ── Phase 3: Extract shared header/footer ONCE ─────────────────────
        console.log("Extracting shared metadata...");
        const sharedChunks = await chunker.extractSharedMetadata(
            allScrapedPages,
            CLIENT_ID
        );
        console.log(`${sharedChunks.length} unique header/footer blocks found`);

        // ── Phase 4: Chunk each page's main content ─────────────────────────
        const pageChunksMap = new Map();

        for (const pageData of allScrapedPages) {
            const chunks = await chunker.chunkPage(pageData, CLIENT_ID);
            pageChunksMap.set(pageData.url, chunks);
        }

        // ── Phase 5: Save everything to JSON ───────────────────────────────
        console.log("\nSaving organized output...");
        await saveOrganizedData(
            allScrapedPages,
            sharedChunks,
            pageChunksMap,
            CLIENT_ID
        );

    } finally {
        await browser.close();
    }
}

async function saveOrganizedData(allScrapedPages, sharedChunks, pageChunksMap, clientId) {
    const outputDir = "./organized-output";
    await fs.mkdir(outputDir, { recursive: true });

    // ── 1. Shared metadata ──────────────────────────────────────────────────
    await fs.writeFile(
        path.join(outputDir, "shared-metadata.json"),
        JSON.stringify({
            type: "shared_metadata",
            clientId,
            description: "Header/footer content extracted once, shared across all pages",
            totalBlocks: sharedChunks.length,
            blocks: sharedChunks.map((chunk, i) => ({
                blockIndex: i,
                wordCount: chunk.text.split(/\s+/).length,
                text: chunk.text,
            })),
        }, null, 2)
    );
    console.log("Saved: shared-metadata.json");

    // ── 2. One file per page ────────────────────────────────────────────────
    const pagesDir = path.join(outputDir, "pages");
    await fs.mkdir(pagesDir, { recursive: true });

    for (const pageData of allScrapedPages) {
        const chunks = pageChunksMap.get(pageData.url) || [];
        const fileName = generateFileName(pageData.url);

        await fs.writeFile(
            path.join(pagesDir, `${fileName}.json`),
            JSON.stringify({
                url: pageData.url,
                title: pageData.title,
                type: pageData.type || "page",
                clientId,
                scrapedAt: pageData.scrapedAt,
                contentHash: pageData.contentHash,
                stats: {
                    totalChunks: chunks.length,
                    totalWords: chunks.reduce(
                        (sum, c) => sum + c.text.split(/\s+/).length, 0
                    ),
                },
                chunks: chunks.map((chunk) => ({
                    chunkIndex: chunk.chunkIndex,
                    sectionHeading: chunk.sectionHeading || null,
                    wordCount: chunk.text.split(/\s+/).length,
                    text: chunk.text,
                })),
            }, null, 2)
        );
        console.log(`Saved: ${fileName}.json (${chunks.length} chunks)`);
    }

    // ── 3. Summary ──────────────────────────────────────────────────────────
    const totalPageChunks = [...pageChunksMap.values()].reduce(
        (sum, chunks) => sum + chunks.length, 0
    );

    await fs.writeFile(
        path.join(outputDir, "summary.json"),
        JSON.stringify({
            clientId,
            baseUrl: allScrapedPages[0]?.url || "",
            generatedAt: new Date().toISOString(),
            stats: {
                totalPages: allScrapedPages.length,
                totalSharedMetadataChunks: sharedChunks.length,
                totalPageChunks,
                totalChunks: sharedChunks.length + totalPageChunks,
            },
            pages: allScrapedPages.map((page) => {
                const chunks = pageChunksMap.get(page.url) || [];
                return {
                    url: page.url,
                    title: page.title,
                    type: page.type || "page",
                    chunkCount: chunks.length,
                    wordCount: chunks.reduce(
                        (sum, c) => sum + c.text.split(/\s+/).length, 0
                    ),
                    sections: [
                        ...new Set(
                            chunks.map((c) => c.sectionHeading).filter(Boolean)
                        ),
                    ],
                };
            }),
        }, null, 2)
    );
    console.log("Saved: summary.json");

    console.log(`\n📁 Output saved to: ${outputDir}`);
    console.log(`   ├── summary.json`);
    console.log(`   ├── shared-metadata.json`);
    console.log(`   └── pages/ (${allScrapedPages.length} files)`);
}

function generateFileName(url) {
    const parsed = new URL(url);
    let pathname = parsed.pathname.replace(/\//g, "_");
    if (!pathname || pathname === "_" || pathname === "") pathname = "home";
    return pathname.replace(/^_/, "").replace(/_$/, "") || "home";
}

main();