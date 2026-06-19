const axios = require("axios");
const { chromium } = require("playwright");
const { XMLParser } = require("fast-xml-parser");
const pino = require("pino");

const logger = pino();

class UrlDiscoveryService {
    constructor() {
        this.parser = new XMLParser({
            ignoreAttributes: false,
        });

        this.invalidExtensions = [
            ".pdf",
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".svg",
            ".webp",
            ".zip",
            ".rar",
            ".mp4",
            ".mp3",
            ".css",
            ".js",
        ];
    }

    async discover(baseUrl) {
        logger.info(`Starting discovery for ${baseUrl}`);

        const sitemapUrls = await this.discoverFromSitemaps(baseUrl);

        if (sitemapUrls.length > 0) {
            logger.info(`Found ${sitemapUrls.length} URLs from sitemap`);
            return sitemapUrls;
        }

        logger.info("No sitemap found. Falling back to Playwright crawler.");
        return await this.crawlWebsite(baseUrl);
    }

    async discoverFromSitemaps(baseUrl) {
        const discoveredUrls = new Set();

        try {
            const robotsUrl = new URL("/robots.txt", baseUrl).toString();
            const response = await axios.get(robotsUrl, { timeout: 15000 });
            const matches = response.data.match(/^Sitemap:\s*(.+)$/gim) || [];

            for (const line of matches) {
                const sitemapUrl = line.replace(/^Sitemap:\s*/i, "").trim();
                const urls = await this.parseSitemapUrl(sitemapUrl);
                urls.forEach((url) => discoveredUrls.add(url));
            }
        } catch (_) { }

        const commonSitemaps = ["/sitemap.xml", "/sitemap_index.xml"];

        for (const path of commonSitemaps) {
            try {
                const sitemapUrl = new URL(path, baseUrl).toString();
                const urls = await this.parseSitemapUrl(sitemapUrl);
                urls.forEach((url) => discoveredUrls.add(url));
            } catch (_) { }
        }

        return [...discoveredUrls];
    }

    async parseSitemapUrl(sitemapUrl) {
        try {
            const response = await axios.get(sitemapUrl, { timeout: 15000 });
            return await this.parseSitemapXml(response.data);
        } catch {
            return [];
        }
    }

    async parseSitemapXml(xml) {
        const parsed = this.parser.parse(xml);
        const urls = [];

        if (parsed?.urlset?.url) {
            const entries = Array.isArray(parsed.urlset.url)
                ? parsed.urlset.url
                : [parsed.urlset.url];

            entries.forEach((entry) => {
                if (entry.loc) {
                    urls.push(this.normalizeUrl(entry.loc));
                }
            });
            return urls;
        }

        if (parsed?.sitemapindex?.sitemap) {
            const entries = Array.isArray(parsed.sitemapindex.sitemap)
                ? parsed.sitemapindex.sitemap
                : [parsed.sitemapindex.sitemap];

            for (const sitemap of entries) {
                const nestedUrls = await this.parseSitemapUrl(sitemap.loc);
                urls.push(...nestedUrls);
            }
        }

        return urls;
    }

    async crawlWebsite(baseUrl) {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const queue = [baseUrl];
        const visited = new Set();
        const baseHost = new URL(baseUrl).hostname;
        const MAX_PAGES = 500;

        try {
            while (queue.length && visited.size < MAX_PAGES) {
                const currentUrl = queue.shift();

                if (!currentUrl || visited.has(currentUrl)) {
                    continue;
                }

                visited.add(currentUrl);
                logger.info(`Crawling ${currentUrl}`);

                try {
                    await page.goto(currentUrl, { waitUntil: "networkidle", timeout: 60000 });

                    // Hover over navigation items to trigger dynamic dropdowns
                    try {
                        const navItems = await page.$$("nav a, header a, [class*='menu'], li");
                        for (const item of navItems) {
                            if (await item.isVisible()) {
                                await item.hover().catch(() => {});
                                await page.waitForTimeout(100); // give it a moment to render
                            }
                        }
                    } catch (e) {
                        // ignore hover errors
                    }

                    const links = await page.$$eval("a[href]", (anchors) =>
                        anchors.map((a) => a.href)
                    );

                    for (const link of links) {
                        const normalizedUrl = this.normalizeUrl(link);

                        if (!this.isValidInternalUrl(normalizedUrl, baseHost)) {
                            continue;
                        }

                        if (!visited.has(normalizedUrl)) {
                            queue.push(normalizedUrl);
                        }
                    }
                } catch (error) {
                    logger.warn(`Failed: ${currentUrl}`);
                }
            }

            return [...visited];
        } finally {
            await browser.close();
        }
    }

    isValidInternalUrl(url, baseHost) {
        try {
            const parsed = new URL(url);

            if (parsed.hostname !== baseHost) {
                return false;
            }

            const pathname = parsed.pathname.toLowerCase();

            return !this.invalidExtensions.some((ext) => pathname.endsWith(ext));
        } catch {
            return false;
        }
    }

    normalizeUrl(url) {
        const parsed = new URL(url);
        parsed.hash = "";
        let normalized = parsed.toString();

        if (normalized.endsWith("/")) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    }
}

module.exports = UrlDiscoveryService;
