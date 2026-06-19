const fs = require("fs/promises");

const UrlDiscoveryService = require("./url-discovery.service");

async function main() {
    const service = new UrlDiscoveryService();

    const urls = await service.discover(
        // "https://acharya4life.com"
        // "https://wigglesandwash.com"
        // "https://cspt-dev-client.el.r.appspot.com"
        "https://pft-api-client-dev.el.r.appspot.com/"
    );

    await fs.writeFile("urls.json", JSON.stringify(urls, null, 2));

    console.log(`Found ${urls.length} URLs`);
}

main();
