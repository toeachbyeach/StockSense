const { launchBrowser, safeCloseBrowser, withScraperLock } = require('./browserHelper');
const log = require('../logger');

const ALGOLIA_APP_ID = '42NP1V2I98';
const ALGOLIA_API_KEY = '3ce54af79eae81a18144a7aa7ee10ec2';
const ALGOLIA_INDEX_NAME = 'prod_cwr-cw-au_products_en';

/**
 * Scrapes a single Chemist Warehouse product page
 * @param {string} url - Chemist Warehouse product URL
 * @returns {Promise<{name: string, price: number|null, inStock: string, imageUrl: string|null}|null>}
 */
async function scrapeChemistWarehouse(url) {
  return withScraperLock(() => doScrapeChemistWarehouse(url));
}

async function doScrapeChemistWarehouse(url) {
  let browser;
  try {
    global.taskStatus = 'Navigating to Chemist Warehouse...';
    log(`[ChemistWarehouse] Starting scrape for URL: ${url}`);

    browser = await launchBrowser([
      `--window-size=${1366 + Math.floor(Math.random() * 500)},${768 + Math.floor(Math.random() * 200)}`
    ]);

    const page = await browser.newPage();
    await page.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${120 + Math.floor(Math.random() * 5)}.0.0.0 Safari/537.36`);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en-US;q=0.9,en;q=0.8' });

    log(`[ChemistWarehouse] Navigating to URL...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });

    const result = await page.evaluate(() => {
      let name = '';
      let price = null;
      let inStock = 'In Stock';
      let imageUrl = null;

      // 1. Try __NEXT_DATA__
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const nextData = JSON.parse(nextDataEl.textContent);
          const productProps = nextData?.props?.pageProps?.product;
          
          if (productProps) {
            // Name
            name = productProps.product?.name || productProps.product?.metaTitle || '';
            
            // Price
            if (Array.isArray(productProps.prices) && productProps.prices.length > 0) {
              const p = productProps.prices[0]?.price?.value?.amount;
              if (typeof p === 'number') {
                price = p;
              } else if (typeof p === 'string') {
                price = parseFloat(p.replace(/[^0-9.]/g, ''));
              }
            }

            // Availability
            if (Array.isArray(productProps.availability) && productProps.availability.length > 0) {
              const status = productProps.availability[0]?.status;
              if (status && (status.includes('out') || status.includes('unavailable'))) {
                inStock = 'Out of Stock';
              }
            }

            // Image
            const variantImages = productProps.product?.variants?.[0]?.images;
            if (Array.isArray(variantImages) && variantImages.length > 0 && variantImages[0]?.url) {
              imageUrl = variantImages[0].url;
            }
          }
        } catch (e) {}
      }

      // 2. Try JSON-LD Schema if price or name is still missing
      if (price === null || !name || !imageUrl) {
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of ldScripts) {
          try {
            const data = JSON.parse(script.textContent);
            const obj = Array.isArray(data) ? data[0] : data;
            if (obj && (obj['@type'] === 'Product' || obj.offers)) {
              if (!name && obj.name) name = obj.name;
              if (price === null && obj.offers) {
                const offerPrice = obj.offers.price || (Array.isArray(obj.offers) ? obj.offers[0]?.price : null);
                if (offerPrice !== undefined && offerPrice !== null) {
                  price = parseFloat(offerPrice);
                }
                const availability = obj.offers.availability || '';
                if (typeof availability === 'string' && (availability.includes('OutOfStock') || availability.includes('Discontinued'))) {
                  inStock = 'Out of Stock';
                }
              }
              if (!imageUrl && obj.image) {
                imageUrl = Array.isArray(obj.image) ? obj.image[0] : obj.image;
              }
            }
          } catch (e) {}
        }
      }

      // 3. Fallback to DOM Selectors
      if (!name) {
        name = document.querySelector('h1.headline-xl, h1')?.textContent?.trim() || '';
      }

      if (price === null) {
        // Look for text matching dollar amounts
        const priceEls = Array.from(document.querySelectorAll('*')).filter(el => {
          return el.children.length === 0 && /\$\s*\d+(\.\d{2})?/.test(el.textContent);
        });
        if (priceEls.length > 0) {
          const match = priceEls[0].textContent.match(/\$?\s*(\d+(\.\d{2})?)/);
          if (match && match[1]) {
            price = parseFloat(match[1]);
          }
        }
      }

      if (!imageUrl) {
        const img = document.querySelector('img[src*="chemistwarehouse.com.au/ams/media"], img[alt*="' + (name ? name.substring(0, 15) : '') + '"]');
        if (img) imageUrl = img.getAttribute('src');
      }

      return { name, price, inStock, imageUrl };
    });

    if (result.price !== null) {
      log(`[ChemistWarehouse] Scrape successful! Product: "${result.name}" Price: $${result.price}`);
    } else {
      log(`[ChemistWarehouse] Scraped product without price: "${result.name}"`, 'WARN');
    }

    return result;
  } catch (err) {
    log(`[ChemistWarehouse] CRITICAL ERROR during scrape: ${err.message}`, 'ERROR');
    return null;
  } finally {
    await safeCloseBrowser(browser);
  }
}

/**
 * Searches Chemist Warehouse for matching products via Algolia search index
 * @param {string} query - Search term
 * @returns {Promise<Array<{name: string, price: number|null, url: string, imageUrl: string|null, inStock: string}>>}
 */
async function searchChemistWarehouse(query) {
  try {
    global.taskStatus = `Searching Chemist Warehouse for "${query}"...`;
    log(`[ChemistWarehouse Search] Query: "${query}"`);

    const url = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=${ALGOLIA_API_KEY}&x-algolia-application-id=${ALGOLIA_APP_ID}`;
    const body = {
      requests: [
        {
          indexName: ALGOLIA_INDEX_NAME,
          params: `query=${encodeURIComponent(query)}&hitsPerPage=10`
        }
      ]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Algolia search failed with status ${res.status}`);
    }

    const data = await res.json();
    const hits = data.results?.[0]?.hits || [];

    const results = hits.map(hit => {
      const rawSlug = typeof hit.slug === 'object' ? hit.slug?.en : hit.slug;
      const name = typeof hit.name === 'object' ? hit.name?.en : (hit.name || '');
      const priceCents = hit.calculatedPrice || hit.prices?.AUD?.min;
      const price = priceCents ? parseFloat((priceCents / 100).toFixed(2)) : null;
      const imageUrl = Array.isArray(hit.images) && hit.images.length > 0 ? hit.images[0] : null;
      
      let productUrl = '';
      if (rawSlug) {
        // Normalize slug to /buy/150234/product-name format or direct slug
        const formattedSlug = rawSlug.replace(/^(\d+)-/, '$1/');
        productUrl = `https://www.chemistwarehouse.com.au/buy/${formattedSlug}`;
      }

      return {
        name,
        price,
        url: productUrl,
        imageUrl,
        inStock: hit.isInStock !== false ? 'In Stock' : 'Out of Stock'
      };
    }).filter(r => r.price !== null && r.url && r.name);

    log(`[ChemistWarehouse Search] Found ${results.length} results`);
    return results;
  } catch (err) {
    log(`[ChemistWarehouse Search] Error: ${err.message}`, 'ERROR');
    return [];
  }
}

module.exports = {
  scrapeChemistWarehouse,
  searchChemistWarehouse
};
