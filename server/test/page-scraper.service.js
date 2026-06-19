// // const { chromium } = require("playwright");
// // const { JSDOM } = require("jsdom");
// // const { Readability } = require("@mozilla/readability");
// // const crypto = require("crypto");

// // class PageScraperService {
// //     constructor() {
// //         console.log("page scraper constructor")
// //     }

// //     async scrape(url) {
// //         const browser = await chromium.launch({
// //             headless: true,
// //         });


// //         try {
// //             const page = await browser.newPage();
// //             await page.goto(url, {
// //                 waitUntil: "networkidle",
// //                 timeout: 60000,
// //             });

// //             console.log(await page.title());

// //             const bodyText = await page.evaluate(() => {
// //                 return document.body.innerText;
// //             });

// //             const html = await page.content();

// //             require("fs").writeFileSync(
// //                 "debug.html",
// //                 html
// //             );

// //             const dom = new JSDOM(html, {
// //                 url,
// //             });

// //             const reader = new Readability(dom.window.document);

// //             const article = reader.parse();

// //             const content = this.cleanText(
// //                 article?.textContent || ""
// //             );

// //             const title =
// //                 article?.title ||
// //                 (await page.title());

// //             return {
// //                 url,
// //                 title,
// //                 content,
// //                 contentHash: this.generateHash(content),
// //                 scrapedAt: new Date().toISOString(),
// //             };
// //         } finally {
// //             await browser.close();
// //         }
// //     }

// //     cleanText(text) {
// //         return text
// //             .replace(/\s+/g, " ")
// //             .trim();
// //     }

// //     generateHash(content) {
// //         return crypto
// //             .createHash("sha256")
// //             .update(content)
// //             .digest("hex");
// //     }
// // }

// // module.exports = PageScraperService;

// const { chromium } = require("playwright");
// const { JSDOM } = require("jsdom");
// const { Readability } = require("@mozilla/readability");
// const crypto = require("crypto");

// class PageScraperService {

//     async scrape(url) {
//         const browser = await chromium.launch({
//             headless: true,
//             args: [
//                 "--no-sandbox",
//                 "--disable-setuid-sandbox",
//                 "--disable-blink-features=AutomationControlled", // avoid bot detection
//             ],
//         });

//         try {
//             const context = await browser.newContext({
//                 // Mimic a real browser to avoid bot detection
//                 userAgent:
//                     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
//                 viewport: { width: 1280, height: 800 },
//                 locale: "en-US",
//             });

//             const page = await context.newPage();

//             // Block unnecessary resources — speeds up scraping significantly
//             await page.route("**/*", (route) => {
//                 const blocked = ["image", "font", "media", "stylesheet"];
//                 if (blocked.includes(route.request().resourceType())) {
//                     route.abort();
//                 } else {
//                     route.continue();
//                 }
//             });

//             // Go to page
//             await page.goto(url, {
//                 waitUntil: "networkidle",
//                 timeout: 60000,
//             });

//             // Step 1 — Handle cookie/consent popups
//             await this.dismissPopups(page);

//             // Step 2 — Expand all interactive elements
//             await this.expandInteractiveElements(page);

//             // Step 3 — Scroll to trigger lazy loading
//             await this.autoScroll(page);

//             // Step 4 — Handle pagination if present
//             const allPageContents = await this.handlePagination(page, url);

//             // Step 5 — Grab final HTML
//             const html = await page.content();
//             const dom = new JSDOM(html, { url });
//             const document = dom.window.document;

//             // Step 6 — Extract header/footer before Readability
//             const { text: headerFooterText, links: headerFooterLinks } =
//                 this.extractHeaderFooter(document, url);

//             // Step 7 — Readability for main content
//             const reader = new Readability(document);
//             const article = reader.parse();
//             const mainContent = this.cleanText(article?.textContent || "");

//             // Step 8 — Collect all discovered links (main body + header/footer)
//             const bodyLinks = this.extractBodyLinks(document, url);

//             // Step 9 — Merge everything
//             const allContent = [mainContent, ...allPageContents, headerFooterText]
//                 .filter(Boolean)
//                 .join(" ");

//             const content = this.cleanText(allContent);
//             const title = article?.title || (await page.title());

//             return {
//                 url,
//                 title,
//                 content,
//                 discoveredLinks: [
//                     ...headerFooterLinks,
//                     ...bodyLinks,
//                 ],
//                 contentHash: this.generateHash(content),
//                 scrapedAt: new Date().toISOString(),
//             };
//         } finally {
//             await browser.close();
//         }
//     }

//     // ─── Dismiss cookie banners, GDPR popups, newsletter modals ───────────────
//     async dismissPopups(page) {
//         const popupSelectors = [
//             // Common accept/close button patterns
//             "button[id*='accept']",
//             "button[class*='accept']",
//             "button[id*='cookie']",
//             "button[class*='cookie']",
//             "button[id*='consent']",
//             "button[class*='consent']",
//             "button[id*='close']",
//             "button[class*='close']",
//             "[aria-label*='close' i]",
//             "[aria-label*='accept' i]",
//             "[aria-label*='dismiss' i]",
//             ".cookie-banner button",
//             "#cookie-notice button",
//             ".modal button[class*='close']",
//         ];

//         for (const selector of popupSelectors) {
//             try {
//                 const btn = await page.$(selector);
//                 if (btn && await btn.isVisible()) {
//                     await btn.click();
//                     await page.waitForTimeout(300);
//                 }
//             } catch (_) { }
//         }
//     }

//     // ─── Expand dropdowns, accordions, tabs, "read more" buttons ──────────────
//     async expandInteractiveElements(page) {
//         try {
//             // Hover nav items to trigger dropdowns
//             const navItems = await page.$$("nav a, header a, [class*='menu-item']");
//             for (const item of navItems) {
//                 await item.hover().catch(() => { });
//             }

//             // Click accordions and expandable sections
//             const expandables = await page.$$(
//                 "[class*='accordion'] button, " +
//                 "[class*='collapse'] button, " +
//                 "details summary, " +
//                 "[aria-expanded='false'], " +
//                 "button[class*='expand'], " +
//                 "button[class*='toggle'], " +
//                 ".show-more, .read-more"
//             );

//             for (const el of expandables) {
//                 try {
//                     if (await el.isVisible()) {
//                         await el.click();
//                         await page.waitForTimeout(200);
//                     }
//                 } catch (_) { }
//             }

//             // Click all tab buttons to expose tab content
//             const tabs = await page.$$(
//                 "[role='tab'], " +
//                 "[class*='tab-btn'], " +
//                 "[class*='tab-link']"
//             );

//             for (const tab of tabs) {
//                 try {
//                     if (await tab.isVisible()) {
//                         await tab.click();
//                         await page.waitForTimeout(300);
//                     }
//                 } catch (_) { }
//             }

//             await page.waitForTimeout(500);
//         } catch (_) { }
//     }

//     // ─── Auto scroll to trigger lazy-loaded content ───────────────────────────
//     async autoScroll(page) {
//         await page.evaluate(async () => {
//             await new Promise((resolve) => {
//                 let totalHeight = 0;
//                 const distance = 400;
//                 const timer = setInterval(() => {
//                     window.scrollBy(0, distance);
//                     totalHeight += distance;
//                     // Stop at bottom or after 30 scrolls
//                     if (totalHeight >= document.body.scrollHeight || totalHeight > 12000) {
//                         clearInterval(timer);
//                         window.scrollTo(0, 0); // scroll back to top
//                         resolve();
//                     }
//                 }, 100);
//             });
//         });
//         await page.waitForTimeout(500);
//     }

//     // ─── Handle paginated content (page=1, page=2 etc.) ───────────────────────
//     async handlePagination(page, url) {
//         const contents = [];

//         try {
//             const paginationSelectors = [
//                 "a[aria-label='Next page']",
//                 "a[class*='next']",
//                 "a[rel='next']",
//                 ".pagination a[class*='next']",
//                 "button[class*='next-page']",
//             ];

//             let pagesVisited = 0;
//             const maxExtraPages = 5; // safety limit

//             while (pagesVisited < maxExtraPages) {
//                 let nextBtn = null;

//                 for (const selector of paginationSelectors) {
//                     const btn = await page.$(selector);
//                     if (btn && await btn.isVisible()) {
//                         nextBtn = btn;
//                         break;
//                     }
//                 }

//                 if (!nextBtn) break;

//                 await nextBtn.click();
//                 await page.waitForLoadState("networkidle");
//                 await this.autoScroll(page);

//                 const html = await page.content();
//                 const dom = new JSDOM(html, { url });
//                 const reader = new Readability(dom.window.document);
//                 const article = reader.parse();

//                 if (article?.textContent) {
//                     contents.push(this.cleanText(article.textContent));
//                 }

//                 pagesVisited++;
//             }
//         } catch (_) { }

//         return contents;
//     }

//     // ─── Extract all links from body ──────────────────────────────────────────
//     extractBodyLinks(document, baseUrl) {
//         const links = [];
//         const seen = new Set();
//         const baseHost = new URL(baseUrl).hostname;

//         document.querySelectorAll("main a[href], article a[href], #content a[href]")
//             .forEach((a) => {
//                 try {
//                     const href = a.getAttribute("href");
//                     if (!href) return;
//                     const absolute = new URL(href, baseUrl).href;
//                     const host = new URL(absolute).hostname;

//                     if (
//                         host === baseHost &&
//                         !seen.has(absolute) &&
//                         !absolute.includes("#") &&
//                         !href.startsWith("mailto:") &&
//                         !href.startsWith("tel:")
//                     ) {
//                         seen.add(absolute);
//                         links.push({
//                             url: absolute,
//                             label: this.cleanText(a.textContent || ""),
//                         });
//                     }
//                 } catch (_) { }
//             });

//         return links;
//     }

//     // ─── Extract header/footer text + links ───────────────────────────────────
//     extractHeaderFooter(document, baseUrl) {
//         const selectors = [
//             "header", "footer", "nav",
//             "[class*='header']", "[class*='footer']",
//             "[class*='navbar']", "[class*='nav-']",
//             "[class*='menu']", "[class*='dropdown']",
//             "[id*='header']", "[id*='footer']",
//             "address",
//         ];

//         const seenText = new Set();
//         const seenLinks = new Set();
//         const links = [];
//         let text = "";

//         const baseHost = new URL(baseUrl).hostname;

//         for (const selector of selectors) {
//             document.querySelectorAll(selector).forEach((el) => {
//                 const elText = this.cleanText(el.textContent || "");
//                 if (elText.length > 10 && !seenText.has(elText)) {
//                     seenText.add(elText);
//                     text += " " + elText;
//                 }

//                 el.querySelectorAll("a[href]").forEach((a) => {
//                     try {
//                         const href = a.getAttribute("href");
//                         if (!href) return;
//                         const absolute = new URL(href, baseUrl).href;
//                         const host = new URL(absolute).hostname;

//                         if (
//                             host === baseHost &&
//                             !seenLinks.has(absolute) &&
//                             !absolute.includes("#") &&
//                             !href.startsWith("mailto:") &&
//                             !href.startsWith("tel:")
//                         ) {
//                             seenLinks.add(absolute);
//                             links.push({
//                                 url: absolute,
//                                 label: this.cleanText(a.textContent || ""),
//                             });
//                         }
//                     } catch (_) { }
//                 });
//             });
//         }

//         return { text: this.cleanText(text), links };
//     }

//     cleanText(text) {
//         return text.replace(/\s+/g, " ").trim();
//     }

//     generateHash(content) {
//         return crypto.createHash("sha256").update(content).digest("hex");
//     }
// }

// module.exports = PageScraperService;


const { JSDOM } = require("jsdom");
const crypto = require("crypto");
const PdfScraperService = require("./pdf-scraper.service");

class PageScraperService {
    constructor(browser) {
        this.browser = browser;
        this.pdfScraper = new PdfScraperService();
    }

    async scrape(url) {
        // Route PDF URLs directly
        if (this.isPdfUrl(url)) {
            return await this.pdfScraper.scrape(url);
        }

        const context = await this.browser.newContext({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 800 },
            locale: "en-US",
        });

        const page = await context.newPage();

        try {
            // Block images, fonts, media — faster scraping
            await page.route("**/*", (route) => {
                const blocked = ["image", "font", "media", "stylesheet"];
                blocked.includes(route.request().resourceType())
                    ? route.abort()
                    : route.continue();
            });

            await page.goto(url, {
                waitUntil: "networkidle",
                timeout: 60000,
            });

            await this.dismissPopups(page);
            await this.expandInteractiveElements(page);
            await this.autoScroll(page);

            // Handle pagination and collect extra page contents
            const paginatedContents = await this.handlePagination(page, url);

            const title = await page.title();

            const content = await page.evaluate(() => {
                const main = document.querySelector("main");
                return main?.innerText || document.body.innerText || "";
            });

            const html = await page.content();
            const dom = new JSDOM(html, { url });
            const document = dom.window.document;

            // Extract header/footer BEFORE anything mutates the DOM
            const { text: metadataText, links: metadataLinks } =
                this.extractHeaderFooter(document, url);

            const bodyLinks = this.extractBodyLinks(document, url);

            // Extract and scrape linked PDFs
            const pdfLinks = this.extractPdfLinks(document, url);
            const pdfContents = await this.scrapePdfLinks(pdfLinks);

            // Merge all content
            const fullContent = this.cleanText(
                [content, ...paginatedContents, metadataText, ...pdfContents]
                    .filter(Boolean)
                    .join(" ")
            );

            return {
                url,
                title,
                content: fullContent,
                metadata: {
                    text: metadataText,
                    links: metadataLinks,
                },
                discoveredLinks: bodyLinks,
                discoveredPdfLinks: pdfLinks,
                contentHash: this.generateHash(fullContent),
                scrapedAt: new Date().toISOString(),
            };
        } finally {
            await context.close(); // closes page too
        }
    }

    // ── PDF helpers ───────────────────────────────────────────────────────────

    isPdfUrl(url) {
        try {
            return new URL(url).pathname.toLowerCase().endsWith(".pdf");
        } catch (_) {
            return false;
        }
    }

    extractPdfLinks(document, baseUrl) {
        const seen = new Set();
        const baseHost = new URL(baseUrl).hostname;
        const links = [];

        document.querySelectorAll("a[href]").forEach((a) => {
            try {
                const href = a.getAttribute("href");
                if (!href) return;
                const absolute = new URL(href, baseUrl).href;
                if (
                    this.isPdfUrl(absolute) &&
                    new URL(absolute).hostname === baseHost &&
                    !seen.has(absolute)
                ) {
                    seen.add(absolute);
                    links.push({
                        url: absolute,
                        label: this.cleanText(a.textContent || ""),
                    });
                }
            } catch (_) { }
        });

        return links;
    }

    async scrapePdfLinks(pdfLinks) {
        const contents = [];
        for (const { url, label } of pdfLinks) {
            console.log(`  → Extracting PDF: ${url}`);
            const result = await this.pdfScraper.scrape(url);
            if (result?.content) {
                const prefix = label ? `[PDF: ${label}]` : "[PDF Document]";
                contents.push(`${prefix} ${result.content}`);
            }
        }
        return contents;
    }

    // ── Pagination ────────────────────────────────────────────────────────────

    async handlePagination(page, url) {
        const contents = [];
        const nextSelectors = [
            "a[aria-label='Next page']",
            "a[class*='next']",
            "a[rel='next']",
            ".pagination a[class*='next']",
        ];

        let pagesVisited = 0;
        const maxExtraPages = 5;

        while (pagesVisited < maxExtraPages) {
            let nextBtn = null;
            for (const selector of nextSelectors) {
                const btn = await page.$(selector);
                if (btn && (await btn.isVisible())) {
                    nextBtn = btn;
                    break;
                }
            }
            if (!nextBtn) break;

            await nextBtn.click();
            await page.waitForLoadState("networkidle");
            await this.autoScroll(page);

            const content = await page.evaluate(() => {
                const main = document.querySelector("main");
                return main?.innerText || document.body.innerText || "";
            });

            if (content) contents.push(this.cleanText(content));
            pagesVisited++;
        }

        return contents;
    }

    // ── Popup dismissal ───────────────────────────────────────────────────────

    async dismissPopups(page) {
        const selectors = [
            "button[id*='accept']",
            "button[class*='accept']",
            "button[id*='cookie']",
            "button[class*='cookie']",
            "button[id*='consent']",
            "button[class*='consent']",
            "[aria-label*='accept' i]",
            "[aria-label*='close' i]",
            "[aria-label*='dismiss' i]",
        ];

        for (const selector of selectors) {
            try {
                const btn = await page.$(selector);
                if (btn && (await btn.isVisible())) {
                    await btn.click();
                    await page.waitForTimeout(300);
                }
            } catch (_) { }
        }
    }

    // ── Expand interactive elements ───────────────────────────────────────────

    async expandInteractiveElements(page) {
        try {
            // Hover nav items for dropdown menus
            const navItems = await page.$$(
                "nav a, header a, [class*='menu-item']"
            );
            for (const item of navItems) {
                await item.hover().catch(() => { });
            }

            // Click accordions, toggles, read-more buttons
            const expandables = await page.$$(
                "[aria-expanded='false'], " +
                "details summary, " +
                "button[class*='expand'], " +
                "button[class*='toggle'], " +
                ".read-more, .show-more"
            );
            for (const item of expandables) {
                try {
                    if (await item.isVisible()) {
                        await item.click();
                        await page.waitForTimeout(200);
                    }
                } catch (_) { }
            }

            // Click all tabs
            const tabs = await page.$$("[role='tab']");
            for (const tab of tabs) {
                try {
                    if (await tab.isVisible()) {
                        await tab.click();
                        await page.waitForTimeout(200);
                    }
                } catch (_) { }
            }

            await page.waitForTimeout(500);
        } catch (_) { }
    }

    // ── Auto scroll ───────────────────────────────────────────────────────────

    async autoScroll(page) {
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let total = 0;
                const timer = setInterval(() => {
                    window.scrollBy(0, 500);
                    total += 500;
                    // FIX: cap at 15000px to avoid infinite scroll loops
                    if (
                        total >= document.body.scrollHeight ||
                        total > 15000
                    ) {
                        clearInterval(timer);
                        window.scrollTo(0, 0);
                        resolve();
                    }
                }, 100);
            });
        });
        await page.waitForTimeout(1000);
    }

    // ── Link extraction ───────────────────────────────────────────────────────

    extractBodyLinks(document, baseUrl) {
        const links = [];
        const seen = new Set();
        const baseHost = new URL(baseUrl).hostname;

        document.querySelectorAll("a[href]").forEach((a) => {
            try {
                const href = a.getAttribute("href");
                if (!href) return;
                const absolute = new URL(href, baseUrl).href;
                const host = new URL(absolute).hostname;

                if (
                    host === baseHost &&
                    !seen.has(absolute) &&
                    !absolute.includes("#") &&      // FIX: filter anchors
                    !href.startsWith("mailto:") &&
                    !href.startsWith("tel:")
                ) {
                    seen.add(absolute);
                    links.push({
                        url: absolute,
                        label: this.cleanText(a.textContent || ""),
                    });
                }
            } catch (_) { }
        });

        return links;
    }

    extractHeaderFooter(document, baseUrl) {
        const selectors = [
            "header", "footer", "nav", "address",
            "[class*='header']", "[class*='footer']",
            "[class*='navbar']", "[class*='nav-']",
            "[class*='menu']", "[class*='dropdown']",
            "[id*='header']", "[id*='footer']",
        ];

        const seenText = new Set();
        const seenLinks = new Set();
        const links = [];
        let text = "";
        const baseHost = new URL(baseUrl).hostname;

        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((el) => {
                const content = this.cleanText(el.textContent || "");
                if (content.length > 10 && !seenText.has(content)) {
                    seenText.add(content);
                    text += " " + content;
                }

                el.querySelectorAll("a[href]").forEach((a) => {
                    try {
                        const href = a.getAttribute("href");
                        if (!href) return;
                        const absolute = new URL(href, baseUrl).href;
                        const host = new URL(absolute).hostname;

                        if (
                            host === baseHost &&
                            !seenLinks.has(absolute) &&
                            !absolute.includes("#") &&  // FIX: filter anchors
                            !href.startsWith("mailto:") &&
                            !href.startsWith("tel:")
                        ) {
                            seenLinks.add(absolute);
                            links.push({
                                url: absolute,
                                label: this.cleanText(a.textContent || ""),
                            });
                        }
                    } catch (_) { }
                });
            });
        }

        return { text: this.cleanText(text), links };
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    cleanText(text) {
        return text.replace(/\s+/g, " ").trim();
    }

    generateHash(content) {
        return crypto.createHash("sha256").update(content).digest("hex");
    }
}

module.exports = PageScraperService;
