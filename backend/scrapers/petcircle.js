const { launchBrowser, safeCloseBrowser, withScraperLock } = require('./browserHelper');
const log = require('../logger');

/**
 * Normalizes text to extract quantity, pack size, volume, and unit.
 * Examples:
 *  "NexGard SPECTRA Chews for Very Large Dogs 30.1-60kg - 6 Pack" -> pack: 6, unit: 'pack'
 *  "Advocate 6 x 4ml" -> pack: 6, volume: 4, unit: 'ml'
 *  "Royal Canin 15kg" -> pack: 1, volume: 15, unit: 'kg'
 *  "Nexgard 3 Chews" -> pack: 3, unit: 'chew'
 */
function parseProductQuantity(title, extraText = '') {
  if (!title) return { packQuantity: 1, volumeQuantity: 1, volumeUnit: '', unitPricingEnabled: false };

  const combined = `${title} ${extraText}`.replace(/\s+/g, ' ');
  const isChewProduct = /\b(chews?|tablets?|tabs?|capsules?|doses?|pipettes?|tubes?|treats?|flea|tick|worm|spectra|nexgard|bravecto|simparica|credelio|advocate|revolution)\b/i.test(combined);

  // 1. Remove animal weight ranges so they are NEVER parsed as product volume/weight
  // e.g. "30.1 - 60kg", "30.1-60kg", "7.6 to 15 kg", "3.6 - 7.5kg", "1.35 to 3.5 kg"
  let cleanText = combined
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g)?\s*(?:-|to)\s*\d+(?:\.\d+)?\s*(?:kg|g)\b/gi, ' ')
    .replace(/\b(?:for\s+)?(?:dogs?|cats?|puppy|puppies|kittens?)\s+\d+(?:\.\d+)?\s*(?:kg|g)\b/gi, ' ')
    .replace(/\b(?:over|under|>|<)\s*\d+(?:\.\d+)?\s*(?:kg|g)\b/gi, ' ');

  // 2. Multipacks like "6PK x 2" or "2 x 6pk" or "6 pack x 2"
  const multiPackMatch = cleanText.match(/(\d+)\s*(?:pk|pack|chews?)\s*[xX]\s*(\d+)/i)
    || cleanText.match(/(\d+)\s*[xX]\s*(\d+)\s*(?:pk|pack|chews?)/i);
  if (multiPackMatch) {
    const totalCount = parseInt(multiPackMatch[1], 10) * parseInt(multiPackMatch[2], 10);
    if (!isNaN(totalCount) && totalCount > 0) {
      const unit = isChewProduct ? 'chew' : 'pack';
      return { packQuantity: totalCount, volumeQuantity: 1, volumeUnit: unit, unitPricingEnabled: true };
    }
  }

  // 3. Chews / Tablets / Doses / Pipettes / Tubes / Capsules / Months (e.g. "6 chews", "6 months", "1 month")
  const chewMatch = cleanText.match(/(\d+)\s*(chews?|tablets?|tabs?|capsules?|doses?|pipettes?|tubes?|treats?|cans?|pouches?|pieces?|sachets?|months?)/i);
  if (chewMatch) {
    const qty = parseInt(chewMatch[1], 10);
    if (!isNaN(qty) && qty > 0) {
      let unit = chewMatch[2].toLowerCase();
      if (unit.startsWith('month')) unit = isChewProduct ? 'chew' : 'pack';
      if (unit.endsWith('s') && !['doses', 'pouches'].includes(unit)) unit = unit.slice(0, -1);
      return { packQuantity: qty, volumeQuantity: 1, volumeUnit: unit, unitPricingEnabled: true };
    }
  }

  // 4. Multipack x Volume: e.g. "6 x 4ml" or "12 x 85g"
  const multiVolMatch = cleanText.match(/(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|ml|l|litre|liter|oz)\b/i);
  if (multiVolMatch) {
    const pQty = parseInt(multiVolMatch[1], 10);
    const vQty = parseFloat(multiVolMatch[2]);
    let unit = multiVolMatch[3].toLowerCase();
    if (unit === 'gm') unit = 'g';
    if (unit === 'liter' || unit === 'litre') unit = 'l';
    return { packQuantity: pQty, volumeQuantity: vQty, volumeUnit: unit, unitPricingEnabled: true };
  }

  // 5. X Pack or Pack of X: e.g. "6 Pack", "Pack of 12", "Twin Pack", "12-Pack", "1 Pack", "3Pack"
  const packMatch = cleanText.match(/(\d+)\s*[- ]?packs?\b/i)
    || cleanText.match(/pack\s+of\s+(\d+)\b/i)
    || cleanText.match(/\b(\d+)\s*pk\b/i);
  if (packMatch) {
    const pQty = parseInt(packMatch[1], 10);
    if (!isNaN(pQty) && pQty >= 1) {
      const unit = isChewProduct ? 'chew' : 'pack';
      return { packQuantity: pQty, volumeQuantity: 1, volumeUnit: unit, unitPricingEnabled: true };
    }
  }

  if (/\btwin\s*pack\b/i.test(cleanText)) {
    const unit = isChewProduct ? 'chew' : 'pack';
    return { packQuantity: 2, volumeQuantity: 1, volumeUnit: unit, unitPricingEnabled: true };
  }

  // 6. Single Volume/Weight: e.g. "15kg", "500g", "2.5kg", "100ml", "1.5L"
  const singleVolMatch = cleanText.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|ml|l|litre|liter|oz)\b/i);
  if (singleVolMatch) {
    const vQty = parseFloat(singleVolMatch[1]);
    let unit = singleVolMatch[2].toLowerCase();
    if (unit === 'gm') unit = 'g';
    if (unit === 'liter' || unit === 'litre') unit = 'l';
    return { packQuantity: 1, volumeQuantity: vQty, volumeUnit: unit, unitPricingEnabled: true };
  }

  if (isChewProduct) {
    return { packQuantity: 1, volumeQuantity: 1, volumeUnit: 'chew', unitPricingEnabled: true };
  }

  return { packQuantity: 1, volumeQuantity: 1, volumeUnit: '', unitPricingEnabled: false };
}

/**
 * Scrapes a single Pet Circle product page
 * @param {string} url - Pet Circle product URL
 * @returns {Promise<{name: string, price: number|null, rawPrice: number|null, shippingPrice: number, isPrime: boolean, inStock: string, imageUrl: string|null, subscribePrice: number|null, subscribeSave: boolean, variations: any}|null>}
 */
async function scrapePetCircle(url) {
  return withScraperLock(() => doScrapePetCircle(url));
}

async function doScrapePetCircle(url) {
  let browser;
  try {
    global.taskStatus = 'Navigating to Pet Circle...';
    log(`[PetCircle] Starting scrape for URL: ${url}`);

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });

    log(`[PetCircle] Loading page...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    // Wait for client hydration / dynamic offers
    await new Promise(r => setTimeout(r, 3000));

    const scraped = await page.evaluate((targetUrl) => {
      let name = '';
      let price = null;
      let rawPrice = null;
      let inStock = 'In Stock';
      let imageUrl = null;
      let subscribePrice = null;
      let subscribeSave = false;
      let variations = { hasVariations: false, dimensions: [], dimensionOptions: {}, allVariations: [] };

      // 1. Parse JSON-LD data
      const jsonLds = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try { jsonLds.push(JSON.parse(s.textContent)); } catch (e) {}
      });

      const productGroup = jsonLds.find(j => j['@type'] === 'ProductGroup');
      const singleProduct = jsonLds.find(j => j['@type'] === 'Product');

      // Check URL sku (e.g. /dhn2245)
      const urlSkuMatch = targetUrl.match(/\/([a-zA-Z0-9]+)(?:[?#]|$)/);
      const targetSku = urlSkuMatch ? urlSkuMatch[1].toUpperCase() : '';

      if (productGroup && Array.isArray(productGroup.hasVariant) && productGroup.hasVariant.length > 0) {
        variations.hasVariations = true;
        variations.dimensions = ['Size'];
        variations.dimensionOptions['Size'] = [];

        // Find the specific variant that matches the target SKU or URL
        let matchedVariant = productGroup.hasVariant.find(v => {
          if (v.sku && targetSku && v.sku.toUpperCase() === targetSku) return true;
          if (v.offers?.url && v.offers.url.toLowerCase().includes(targetSku.toLowerCase())) return true;
          return false;
        });

        // If not matched by SKU, try matching by URL ending
        if (!matchedVariant) {
          matchedVariant = productGroup.hasVariant.find(v => {
            const vUrl = (v.offers?.url || v.url || '').toLowerCase();
            return vUrl && targetUrl.toLowerCase().includes(vUrl);
          });
        }

        // Fallback to first variant if none matched specifically
        const selectedVariant = matchedVariant || productGroup.hasVariant[0];

        if (selectedVariant) {
          name = selectedVariant.name || productGroup.name || '';
          if (selectedVariant.offers?.price) {
            price = parseFloat(selectedVariant.offers.price);
          }
          if (selectedVariant.offers?.availability) {
            inStock = selectedVariant.offers.availability.includes('InStock') ? 'In Stock' : 'Out of Stock';
          }
          if (selectedVariant.image) {
            imageUrl = Array.isArray(selectedVariant.image) ? selectedVariant.image[0] : selectedVariant.image;
          }
        }

        // Populate variations list
        productGroup.hasVariant.forEach(v => {
          const vPrice = v.offers?.price ? parseFloat(v.offers.price) : null;
          const vName = v.name || '';
          const vUrl = v.offers?.url || v.url || targetUrl;
          variations.allVariations.push({
            asin: v.sku || '',
            url: vUrl,
            title: vName,
            price: vPrice,
            inStock: v.offers?.availability?.includes('InStock') ? 'In Stock' : 'Out of Stock',
            isCurrent: v === selectedVariant
          });
          variations.dimensionOptions['Size'].push(vName);
        });
      } else if (singleProduct) {
        name = singleProduct.name || '';
        if (singleProduct.offers?.price) {
          price = parseFloat(singleProduct.offers.price);
        }
        if (singleProduct.offers?.availability) {
          inStock = singleProduct.offers.availability.includes('InStock') ? 'In Stock' : 'Out of Stock';
        }
        if (singleProduct.image) {
          imageUrl = Array.isArray(singleProduct.image) ? singleProduct.image[0] : singleProduct.image;
        }
      }

      // 2. DOM fallback for title & image
      if (!name) {
        const h1 = document.querySelector('h1');
        name = h1 ? h1.innerText.replace(/\s+/g, ' ').trim() : '';
      }

      if (!imageUrl) {
        imageUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
          || document.querySelector('[data-testid*="product-image"] img, img[alt*="Pet"]')?.src || null;
      }

      // 3. Auto-Delivery price extraction from DOM
      // Pet Circle shows e.g. "$92.79 Once only $115.99"
      try {
        const pageText = document.body.innerText || '';
        if (price !== null) {
          const escapedPrice = price.toFixed(2).replace('.', '\\.');
          const adMatch = pageText.match(new RegExp(`\\$\\s*(\\d+(?:\\.\\d{2})?)\\s+Once\\s+only\\s+\\$\\s*${escapedPrice}`, 'i'));
          if (adMatch) {
            const adPrice = parseFloat(adMatch[1]);
            if (!isNaN(adPrice) && adPrice > 0 && adPrice < price) {
              subscribePrice = adPrice;
              subscribeSave = true;
            }
          }
        }

        // Fallback: search for "Auto Delivery $XX.XX" directly adjacent
        if (!subscribePrice) {
          const generalAdMatch = pageText.match(/Auto\s*Delivery\s*\n\s*\$(\d+(?:\.\d{2})?)/i)
            || pageText.match(/Auto\s*Delivery[^\$\n]{0,20}\$(\d+(?:\.\d{2})?)/i);
          if (generalAdMatch) {
            const adPrice = parseFloat(generalAdMatch[1]);
            if (!isNaN(adPrice) && adPrice > 0 && (price === null || adPrice <= price)) {
              subscribePrice = adPrice;
              subscribeSave = true;
            }
          }
        }
      } catch (e) {}

      // 4. Shipping rate
      let shippingPrice = 0;
      if (price !== null && price < 79) {
        // Pet Circle has free standard delivery over $79 to most metro areas; standard fee is typically $4.95-$6.95
        // If below 79, check if free shipping banner or standard fee is mentioned
        const shipMatch = document.body.innerText.match(/delivery\s*(?:from|fee|costs?|charge)?:?\s*\$(\d+(?:\.\d{2})?)/i);
        if (shipMatch) {
          shippingPrice = parseFloat(shipMatch[1]);
        }
      }

      rawPrice = price;

      return {
        name,
        price,
        rawPrice,
        shippingPrice,
        isPrime: false,
        inStock,
        imageUrl,
        subscribePrice,
        subscribeSave,
        variations
      };
    }, url);

    if (!scraped || !scraped.name) {
      log(`[PetCircle] Failed to extract product info for ${url}`, 'WARN');
      return null;
    }

    // Parse product quantity and size from title
    const qtyInfo = parseProductQuantity(scraped.name);
    scraped.packQuantity = qtyInfo.packQuantity;
    scraped.volumeQuantity = qtyInfo.volumeQuantity;
    scraped.volumeUnit = qtyInfo.volumeUnit;
    scraped.unitPricingEnabled = qtyInfo.unitPricingEnabled;

    log(`[PetCircle] Scraped: "${scraped.name}", Price: $${scraped.price}, AutoDelivery: $${scraped.subscribePrice}, Qty: ${scraped.packQuantity}x ${scraped.volumeQuantity}${scraped.volumeUnit}`);
    return scraped;
  } catch (err) {
    log(`[PetCircle] Error scraping ${url}: ${err.message}`, 'ERROR');
    return null;
  } finally {
    await safeCloseBrowser(browser);
  }
}

/**
 * Searches Pet Circle for a product query
 * @param {string} query
 * @returns {Promise<Array<{name: string, price: number, url: string, imageUrl: string|null, inStock: string}>>}
 */
async function searchPetCircle(query) {
  return withScraperLock(() => doSearchPetCircle(query));
}

async function doSearchPetCircle(query) {
  let browser;
  try {
    const searchUrl = `https://www.petcircle.com.au/search?q=${encodeURIComponent(query)}`;
    log(`[PetCircle Search] Searching for: "${query}" at ${searchUrl}`);
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise(r => setTimeout(r, 2500));

    const results = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid*="product-card"], a[href*="/product/"]')).slice(0, 10);
      const items = [];
      const seen = new Set();
      for (const c of cards) {
        const link = c.tagName === 'A' ? c : c.querySelector('a[href*="/product/"]');
        const href = link?.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);

        const titleEl = c.querySelector('[data-testid*="title"], h3, h2, [class*="title"]') || link;
        const priceEl = c.querySelector('[data-testid*="price"], [class*="price"]') || c;
        const imgEl = c.querySelector('img');
        const priceMatch = (priceEl?.innerText || c.innerText || '').match(/\$(\d+(?:\.\d{2})?)/);

        if (titleEl && priceMatch) {
          items.push({
            name: titleEl.innerText.replace(/\s+/g, ' ').trim(),
            price: parseFloat(priceMatch[1]),
            rawPrice: parseFloat(priceMatch[1]),
            shippingPrice: 0,
            isPrime: false,
            url: href,
            imageUrl: imgEl?.src || null,
            inStock: 'In Stock'
          });
        }
      }
      return items;
    });

    results.forEach(r => {
      const q = parseProductQuantity(r.name);
      r.packQuantity = q.packQuantity;
      r.volumeQuantity = q.volumeQuantity;
      r.volumeUnit = q.volumeUnit;
      r.unitPricingEnabled = q.unitPricingEnabled;
    });

    log(`[PetCircle Search] Found ${results.length} matches for "${query}"`);
    return results;
  } catch (e) {
    log(`[PetCircle Search] Error: ${e.message}`, 'WARN');
    return [];
  } finally {
    await safeCloseBrowser(browser);
  }
}

module.exports = { scrapePetCircle, searchPetCircle, parseProductQuantity };
