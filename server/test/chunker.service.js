// class ChunkerService {
//     constructor(options = {}) {
//         this.chunkSize = options.chunkSize || 400;   // words per chunk
//         this.overlap = options.overlap || 50;         // words overlap between chunks
//     }

//     // Main entry — takes a scraped page, returns array of chunks ready for MongoDB
//     chunkPage(pageData, clientId) {
//         const {
//             url,
//             title,
//             content,
//             metadata,
//             scrapedAt,
//             contentHash
//         } = pageData;

//         // Split content into topic-level sections first
//         const sections = this.splitIntoSections(content);
//         const chunks = [];

//         for (const section of sections) {
//             // Split each section into word-limited chunks with overlap
//             const sectionChunks = this.splitIntoChunks(section.text);

//             sectionChunks.forEach((chunkText, index) => {
//                 if (chunkText.trim().length < 50) return; // skip tiny chunks

//                 chunks.push({
//                     // Tenant isolation
//                     clientId,

//                     // Content
//                     text: chunkText,

//                     // Page-level metadata
//                     sourceUrl: url,
//                     pageTitle: title,
//                     sectionHeading: section.heading || null,
//                     chunkIndex: chunks.length,

//                     // For re-crawl dedup
//                     pageContentHash: contentHash,
//                     scrapedAt,

//                     // embedding field — Atlas Auto Embedding will populate this
//                     // based on the "text" field configured in Atlas trigger
//                 });
//             });
//         }

//         return chunks;
//     }

//     // Deduplicate header/footer across all pages — store ONCE
//     extractSharedMetadata(pages, clientId) {
//         const headerFooterMap = new Map(); // hash → text

//         for (const page of pages) {
//             const metaText = page.metadata?.text;
//             if (!metaText) continue;

//             const hash = this.hash(metaText);
//             if (!headerFooterMap.has(hash)) {
//                 headerFooterMap.set(hash, metaText);
//             }
//         }

//         // Return as chunks — one per unique header/footer block
//         return [...headerFooterMap.values()].map((text, index) => ({
//             clientId,
//             text,
//             sourceUrl: "global",
//             pageTitle: "Site Navigation & Contact Info",
//             sectionHeading: null,
//             chunkIndex: index,
//             isSharedMetadata: true,    // flag so we know this is global content
//             scrapedAt: new Date().toISOString(),
//         }));
//     }

//     // Split by headings or double newlines — topic-level sections
//     splitIntoSections(text) {
//         const sections = [];

//         // Try to detect heading patterns like "SERVICES\n..." or "About Us\n..."
//         const headingPattern = /(?:^|\n)([A-Z][^\n]{2,60})\n/g;
//         let lastIndex = 0;
//         let lastHeading = null;
//         let match;

//         const matches = [];
//         while ((match = headingPattern.exec(text)) !== null) {
//             matches.push({ index: match.index, heading: match[1] });
//         }

//         if (matches.length <= 1) {
//             // No clear headings — split by double newline (paragraphs)
//             const paragraphs = text
//                 .split(/\n\s*\n/)
//                 .map(p => p.trim())
//                 .filter(p => p.length > 50);

//             // Group paragraphs into ~chunkSize word sections
//             let currentSection = "";
//             for (const para of paragraphs) {
//                 const combined = currentSection + " " + para;
//                 if (this.wordCount(combined) > this.chunkSize && currentSection) {
//                     sections.push({ heading: null, text: currentSection.trim() });
//                     currentSection = para;
//                 } else {
//                     currentSection = combined;
//                 }
//             }
//             if (currentSection.trim()) {
//                 sections.push({ heading: null, text: currentSection.trim() });
//             }

//             return sections;
//         }

//         // Split by detected headings
//         for (let i = 0; i < matches.length; i++) {
//             const start = matches[i].index;
//             const end = matches[i + 1]?.index ?? text.length;
//             const sectionText = text.slice(start, end).trim();

//             if (sectionText.length > 50) {
//                 sections.push({
//                     heading: matches[i].heading,
//                     text: sectionText,
//                 });
//             }
//         }

//         return sections.length > 0
//             ? sections
//             : [{ heading: null, text }];
//     }

//     // Split a section into overlapping word-count chunks
//     splitIntoChunks(text) {
//         const words = text.split(/\s+/);
//         const chunks = [];

//         let start = 0;
//         while (start < words.length) {
//             const end = Math.min(start + this.chunkSize, words.length);
//             const chunk = words.slice(start, end).join(" ");
//             chunks.push(chunk);

//             if (end === words.length) break;
//             start += this.chunkSize - this.overlap; // slide with overlap
//         }

//         return chunks;
//     }

//     wordCount(text) {
//         return text.split(/\s+/).length;
//     }

//     hash(text) {
//         return require("crypto")
//             .createHash("sha256")
//             .update(text)
//             .digest("hex");
//     }
// }

// module.exports = ChunkerService;



/**
 * ChunkerService — LangChain-powered chunking for MongoDB Atlas RAG pipeline
 *
 * Strategy:
 *  1. RecursiveCharacterTextSplitter for main content  (respects sentence/paragraph boundaries)
 *  2. Shared header/footer extracted ONCE and stored separately (avoids duplication across chunks)
 *  3. Each chunk is enriched with metadata Atlas needs for vector search + tenant filtering
 */

const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const crypto = require("crypto");

class ChunkerService {
    /**
     * @param {object} opts
     * @param {number} opts.chunkSize    - target chunk size in characters (default 1500)
     * @param {number} opts.overlap      - overlap between chunks in characters (default 200)
     */
    constructor(opts = {}) {
        this.chunkSize = opts.chunkSize ?? 1500;
        this.overlap = opts.overlap ?? 200;

        // Primary splitter — tries to split on paragraphs → sentences → words → chars
        this.splitter = new RecursiveCharacterTextSplitter({
            chunkSize: this.chunkSize,
            chunkOverlap: this.overlap,
            separators: ["\n\n", "\n", ". ", "! ", "? ", " ", ""],
        });

        // Smaller splitter for shared metadata (headers/footers are usually short)
        this.metaSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 800,
            chunkOverlap: 100,
            separators: ["\n\n", "\n", ". ", " ", ""],
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC: chunk a single page's MAIN content
    // Returns array of chunk objects ready for MongoDB insertion
    // ─────────────────────────────────────────────────────────────────────────
    async chunkPage(pageData, clientId) {
        const { url, title, content, type = "page", scrapedAt, contentHash } = pageData;

        if (!content || content.trim().length < 30) return [];

        // Use createDocuments to get LangChain Document objects with loc metadata
        const docs = await this.splitter.createDocuments(
            [content],
            [{ url, title, clientId, type }]  // base metadata applied to all chunks
        );

        return docs.map((doc, i) => ({
            // ── Identity ────────────────────────────────────────────────────
            chunkId: this._hash(`${url}::chunk::${i}`),
            contentHash, // page-level hash; useful for dedup / re-scrape detection

            // ── Tenant + source ─────────────────────────────────────────────
            clientId,
            url,
            title: title || "",
            type,        // "page" | "pdf" | "shared_metadata"
            scrapedAt: scrapedAt || new Date().toISOString(),

            // ── Chunk position (helps with re-ranking) ──────────────────────
            chunkIndex: i,
            totalChunks: docs.length,  // will be backfilled after map, see below

            // ── Section heading (extracted from nearby H tags if available) ─
            sectionHeading: this._extractHeading(doc.pageContent),

            // ── The actual text Atlas will embed ────────────────────────────
            text: doc.pageContent,

            // ── LangChain loc metadata (char offsets) ───────────────────────
            charStart: doc.metadata?.loc?.lines?.from ?? null,
            charEnd: doc.metadata?.loc?.lines?.to ?? null,
        }));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC: extract shared header/footer content across ALL pages
    // Called once with the full allScrapedPages array.
    // Returns chunks tagged type="shared_metadata"
    // ─────────────────────────────────────────────────────────────────────────
    async extractSharedMetadata(allScrapedPages, clientId) {
        // Collect unique metadata text blocks across all pages
        const seen = new Set();
        const blocks = [];

        for (const page of allScrapedPages) {
            const raw = page?.metadata?.text?.trim();
            if (!raw || raw.length < 20) continue;

            // Normalize whitespace for dedup comparison
            const key = raw.replace(/\s+/g, " ");
            if (seen.has(key)) continue;
            seen.add(key);
            blocks.push(raw);
        }

        if (blocks.length === 0) return [];

        const combined = blocks.join("\n\n");

        const docs = await this.metaSplitter.createDocuments(
            [combined],
            [{ clientId, type: "shared_metadata" }]
        );

        return docs.map((doc, i) => ({
            chunkId: this._hash(`${clientId}::shared::${i}`),
            clientId,
            url: null,
            title: "Shared Header/Footer",
            type: "shared_metadata",
            chunkIndex: i,
            totalChunks: docs.length,
            sectionHeading: null,
            text: doc.pageContent,
            scrapedAt: new Date().toISOString(),
        }));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Heuristic: if the chunk starts with a short line (≤80 chars) followed
     * by a newline, treat it as a section heading.
     */
    _extractHeading(text) {
        const firstLine = text.split("\n")[0]?.trim();
        if (firstLine && firstLine.length > 0 && firstLine.length <= 80) {
            return firstLine;
        }
        return null;
    }

    _hash(str) {
        return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
    }
}

module.exports = ChunkerService;