const axios = require("axios");
const pdfParse = require("pdf-parse");
const crypto = require("crypto");

class PdfScraperService {

    async scrape(url) {
        try {
            const response = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 30000,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            });

            const buffer = Buffer.from(response.data);
            const data = await pdfParse(buffer);

            const content = this.cleanText(data.text);

            return {
                url,
                title: this.extractTitle(data, url),
                content,
                pageCount: data.numpages,
                contentHash: crypto
                    .createHash("sha256")
                    .update(content)
                    .digest("hex"),
                scrapedAt: new Date().toISOString(),
                type: "pdf",
            };
        } catch (error) {
            console.error(`PDF scrape failed: ${url}`, error.message);
            return null;
        }
    }

    extractTitle(data, url) {
        // Try PDF metadata title first, fall back to filename from URL
        if (data.info?.Title) return data.info.Title;
        const filename = url.split("/").pop().replace(".pdf", "").replace(/[-_]/g, " ");
        return filename || "PDF Document";
    }

    cleanText(text) {
        return text
            .replace(/\s+/g, " ")       // collapse whitespace
            .replace(/(\w)-\n(\w)/g, "$1$2") // fix hyphenated line breaks
            .trim();
    }
}

module.exports = PdfScraperService;