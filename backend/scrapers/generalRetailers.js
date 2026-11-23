const axios = require('axios');
const { launchBrowser, safeCloseBrowser, withScraperLock } = require('./browserHelper');
const { parseProductQuantity } = require('./petcircle');
const log = require('../logger');

/**
 * Detects which retailer a URL belongs to.
 */
function detectRetailer(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('bunnings.com.au')) return 'bunnings';
  if (lower.includes('officeworks.com.au')) return 'officeworks';
  if (lower.includes('jbhifi.com.au')) return 'jbhifi';
  if (lower.includes('thegoodguys.com.au')) return 'thegoodguys';
  if (lower.includes('theiconic.com.au')) return 'theiconic';
  if (lower.includes('danmurphys.com.au')) return 'danmurphys';
  if (lower.includes('harveynorman.com.au')) return 'harveynorman';
  if (lower.includes('myer.com.au')) return 'myer';
  if (lower.includes('priceline.com.au')) return 'priceline';
  if (lower.includes('terrywhitechemmart.com.au')) return 'terrywhite';
  if (lower.includes('cincottachemist.com.au')) return 'cincotta';
  if (lower.includes('bloomsthechemist.com.au')) return 'bloomsthechemist';
  if (lower.includes('petbarn.com.au')) return 'petbarn';
  if (lower.includes('petstock.com.au')) return 'petstock';
  if (lower.includes('budgetpetproducts.com.au')) return 'budgetpetproducts';
  if (lower.includes('petchemist.com.au')) return 'petchemist';
  return 'generic';
}

function getRetailerDisplayName(retailerKey) {
  const map = {
    bunnings: 'Bunnings Warehouse',
    officeworks: 'Officeworks',
    jbhifi: 'JB Hi-Fi',
    thegoodguys: 'The Good Guys',
    theiconic: 'The Iconic',
    danmurphys: "Dan Murphy's",
    harveynorman: 'Harvey Norman',
    myer: 'Myer',
    priceline: 'Priceline Pharmacy',
    terrywhite: 'TerryWhite Chemmart',
    cincotta: 'Cincotta Chemist',
    bloomsthechemist: 'Blooms The Chemist',
    petbarn: 'Petbarn',
    petstock: 'Petstock',
    budgetpetproducts: 'Budget Pet Products',
    petchemist: 'Pet Chemist',
    generic: 'Online Retailer'
  };
  return map[retailerKey] || 'Retailer';
}

/**
 * Scrapes a product page for supported Australian retail sites.
 */
async function scrapeRetailer(url, targetPackQuantity = null) {
  return withScraperLock(() => doScrapeRetailer(url, targetPackQuantity));
}

async function doScrapeRetailer(url, targetPackQuantity = null) {
  let browser;
  const retailer = detectRetailer(url);
  const displayName = getRetailerDisplayName(retailer);

  try {
    global.taskStatus = `Navigating to ${displayName}...`;
    log(`[${displayName}] Scraping URL: ${url}`);

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 900 });

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const httpStatus = resp ? resp.status() : 0;

    if (httpStatus === 403 || httpStatus === 429) {
      throw new Error(`HTTP ${httpStatus} - Site blocked request or rate limited`);
    }

    // Wait for client-side hydration / rendering
    await new Promise(r => setTimeout(r, 3500));

    const scraped = await page.evaluate((targetUrl, retKey, targetPack) => {
      let name = '';
      let price = null;
      let rawPrice = null;
      let inStock = 'In Stock';
      let imageUrl = null;
      let subscribePrice = null;
      let subscribeSave = false;
      let variations = { hasVariations: false, dimensions: [], dimensionOptions: {}, allVariations: [] };

      // 1. Collect all JSON-LD blocks
      const jsonLds = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
          const parsed = JSON.parse(s.textContent);
          if (Array.isArray(parsed)) jsonLds.push(...parsed);
          else jsonLds.push(parsed);
        } catch (e) { }
      });

      // Find Product or ProductGroup schema
      let product = jsonLds.find(j => j && j['@type'] === 'Product');
      let productGroup = jsonLds.find(j => j && j['@type'] === 'ProductGroup');

      if (!product) {
        // Look in @graph array if present
        for (const j of jsonLds) {
          if (j && Array.isArray(j['@graph'])) {
            const found = j['@graph'].find(g => g['@type'] === 'Product');
            if (found) { product = found; break; }
          }
        }
      }

      if (product) {
        name = product.name || '';
        if (product.offers) {
          const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
          if (offers && offers.price != null) {
            price = parseFloat(offers.price);
          } else if (offers && offers.lowPrice != null) {
            price = parseFloat(offers.lowPrice);
          }
          if (offers && offers.availability) {
            inStock = String(offers.availability).includes('InStock') ? 'In Stock' : 'Out of Stock';
          }
        }
        if (product.image) {
          imageUrl = Array.isArray(product.image) ? product.image[0] : (product.image.url || product.image);
        }
      }

      // If productGroup with variants exists
      if (productGroup && Array.isArray(productGroup.hasVariant) && productGroup.hasVariant.length > 0) {
        variations.hasVariations = true;
        variations.dimensions = ['Option'];
        variations.dimensionOptions['Option'] = [];

        // Check if a variant matches the SKU or path in the target URL
        let selectedVariant = productGroup.hasVariant.find(v => v.sku && targetUrl.includes(v.sku));

        // If targetPack is requested, find the variant matching that pack count
        if (!selectedVariant && targetPack && targetPack > 0) {
          const packRegex = new RegExp(`\\b${targetPack}\\s*(?:pack|pk|chews?|months?|tablets?|doses?)\\b`, 'i');
          selectedVariant = productGroup.hasVariant.find(v => packRegex.test(v.name || v.size || ''));
        }

        if (!selectedVariant) {
          selectedVariant = productGroup.hasVariant[0];
        }

        // Helper: get effective price from offer, preferring member price if available
        const getVariantOfferPrice = (v) => {
          if (!v) return null;
          if (Array.isArray(v.offers?.priceSpecification)) {
            const memberSpec = v.offers.priceSpecification.find(ps =>
              ps.validForMemberTier ||
              (ps.price && parseFloat(ps.price) > 0 && parseFloat(ps.price) < parseFloat(v.offers?.price || Infinity))
            );
            if (memberSpec && memberSpec.price) {
              return parseFloat(memberSpec.price);
            }
          }
          if (v.offers?.price) return parseFloat(v.offers.price);
          if (v.offers?.lowPrice) return parseFloat(v.offers.lowPrice);
          return null;
        };

        if (selectedVariant) {
          if (selectedVariant.name) name = selectedVariant.name;
          const vPrice = getVariantOfferPrice(selectedVariant);
          if (vPrice !== null) price = vPrice;
          if (selectedVariant.image) {
            imageUrl = Array.isArray(selectedVariant.image) ? selectedVariant.image[0] : (selectedVariant.image.url || selectedVariant.image);
          }
        }

        productGroup.hasVariant.forEach(v => {
          const vPrice = getVariantOfferPrice(v);
          const vName = v.name || '';
          variations.allVariations.push({
            asin: v.sku || '',
            url: v.offers?.url || v.url || targetUrl,
            title: vName,
            price: vPrice,
            inStock: v.offers?.availability?.includes('InStock') ? 'In Stock' : 'Out of Stock'
          });
          variations.dimensionOptions['Option'].push(vName);
        });
      }

      if (!name && productGroup?.name) {
        name = productGroup.name;
      }

      // If brand is available and not in product name, prepend it for accurate matching
      const brandObj = product?.brand || productGroup?.brand;
      const brandName = (typeof brandObj === 'string' ? brandObj : (brandObj?.name || '')).trim();
      if (brandName && name && !name.toLowerCase().includes(brandName.toLowerCase())) {
        name = `${brandName} ${name}`;
      }

      // 2. DOM extraction fallbacks
      if (!name) {
        const h1 = document.querySelector('h1');
        name = h1 ? h1.innerText.replace(/\s+/g, ' ').trim() : '';
      }
      if (!name) {
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (ogTitle) name = ogTitle.split('|')[0].split('-')[0].trim();
      }

      if (price === null) {
        // Try common retail price selectors
        const priceSelectors = [
          '[data-locator*="price"]',
          '[data-testid*="price"]',
          '[itemprop="price"]',
          '.product-price',
          '.price__current',
          '[class*="Price_price"]',
          '[class*="price-val"]',
          '[class*="current-price"]',
          '.price'
        ];
        for (const sel of priceSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const raw = el.innerText || el.getAttribute('content') || '';
            const match = raw.match(/\$\s*(\d+(?:\.\d{2})?)/) || raw.match(/(\d+(?:\.\d{2})?)/);
            if (match) {
              const parsed = parseFloat(match[1]);
              if (!isNaN(parsed) && parsed > 0) {
                price = parsed;
                break;
              }
            }
          }
        }
      }

      // 3. Fallback price extraction from entire page text if still null
      if (price === null) {
        const text = document.body.innerText || '';
        const priceMatch = text.match(/\$\s*(\d+\.\d{2})\b/);
        if (priceMatch) {
          const parsed = parseFloat(priceMatch[1]);
          if (!isNaN(parsed) && parsed > 0 && parsed < 20000) {
            price = parsed;
          }
        }
      }

      if (!imageUrl && productGroup && productGroup.image) {
        imageUrl = Array.isArray(productGroup.image) ? productGroup.image[0] : (productGroup.image.url || productGroup.image);
      }

      if (!imageUrl) {
        imageUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
          || document.querySelector('[data-locator*="product-image"] img, [data-testid*="product-image"] img, .product-image img, img[itemprop="image"], img[src*="catalog/product"], img[src*="product_images"], img[src*="cdnpublic.budgetpetproducts"]')
            ?.src
          || null;
      }

      // Check DOM member price (e.g. Petbarn Friends For Life, Supercheap Auto Club Plus, Priceline Sister Club)
      const memberPriceEl = document.querySelector('.ProductPrice_memberPrice, [class*="memberPrice"], [class*="MemberPrice"], [data-testid*="member-price"]');
      if (memberPriceEl) {
        const m = (memberPriceEl.innerText || '').match(/\$\s*(\d+(?:\.\d{2})?)/);
        if (m) {
          const mp = parseFloat(m[1]);
          if (!isNaN(mp) && mp > 0) {
            price = mp;
          }
        }
      }

      // Check Repeat Delivery / Subscription discount (e.g. Petbarn, Pet Circle, Petstock, Amazon, etc.)
      const repeatEl = document.querySelector('.ProductPrice_repeatPrice, [class*="repeatPrice"], [class*="RepeatPrice"], [data-testid*="repeat-price"]');
      if (repeatEl) {
        const m = (repeatEl.innerText || '').match(/\$\s*(\d+(?:\.\d{2})?)/);
        if (m) {
          const rp = parseFloat(m[1]);
          if (!isNaN(rp) && rp > 0 && (price === null || rp < price)) {
            subscribePrice = rp;
            subscribeSave = true;
          }
        }
      }

      if (!subscribePrice) {
        const allText = document.body.innerText || '';
        const subMatch = allText.match(/(?:repeat delivery|auto[\s-]?delivery|autoship|subscribe\s*(?:&|and)\s*save)[^\n$]{0,40}\$\s*(\d+(?:\.\d{2})?)/i);
        if (subMatch) {
          const sp = parseFloat(subMatch[1]);
          if (!isNaN(sp) && sp > 0 && (price === null || sp < price)) {
            subscribePrice = sp;
            subscribeSave = true;
          }
        }
      }

      rawPrice = price;

      return {
        name,
        price,
        rawPrice,
        shippingPrice: 0,
        isPrime: false,
        inStock,
        imageUrl,
        subscribePrice,
        subscribeSave,
        variations
      };
    }, url, retailer, targetPackQuantity);

    if (!scraped || !scraped.name || scraped.price === null) {
      log(`[${displayName}] Failed to extract valid price or name from ${url}`, 'WARN');
      return null;
    }

    // Auto-detect quantities and size units from product title
    const qtyInfo = parseProductQuantity(scraped.name);
    scraped.packQuantity = qtyInfo.packQuantity;
    scraped.volumeQuantity = qtyInfo.volumeQuantity;
    scraped.volumeUnit = qtyInfo.volumeUnit;
    scraped.unitPricingEnabled = qtyInfo.unitPricingEnabled;

    // Enrich all variations with parsed quantities
    if (scraped.variations && Array.isArray(scraped.variations.allVariations)) {
      scraped.variations.allVariations.forEach(v => {
        const vQty = parseProductQuantity(v.title || '');
        v.packQuantity = vQty.packQuantity || 1;
        v.volumeQuantity = vQty.volumeQuantity || 1;
        v.volumeUnit = vQty.volumeUnit || '';
      });
    }

    log(`[${displayName}] Success! Scraped "${scraped.name}" at $${scraped.price}`);
    return scraped;
  } catch (err) {
    log(`[${displayName}] Error scraping ${url}: ${err.message}`, 'ERROR');
    throw err;
  } finally {
    await safeCloseBrowser(browser);
  }
}

/**
 * Dedicated API search for Priceline Pharmacy.
 */
async function searchPricelineApi(query) {
  try {
    log(`[Priceline Pharmacy Search] Querying API for: "${query}"`);
    const resp = await axios.get(`https://api.priceline.com.au/occ/v2/priceline/products/search?query=${encodeURIComponent(query)}&pageSize=8&lang=en&curr=AUD`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 15000
    });
    const products = resp.data?.products || [];
    const results = products.map(p => {
      const url = p.url?.startsWith('http') ? p.url : `https://www.priceline.com.au${p.url}`;
      const img = p.images?.find(i => i.format === 'product' || i.format === 'thumbnail') || p.images?.[0];
      const imageUrl = img ? (img.url?.startsWith('http') ? img.url : `https://www.priceline.com.au${img.url}`) : null;
      const price = p.price?.value != null ? parseFloat(p.price.value) : null;
      return {
        name: p.name || '',
        price,
        url,
        imageUrl,
        inStock: p.stock?.stockLevelStatus === 'inStock' ? 'In Stock' : 'Out of Stock'
      };
    }).filter(i => i.name && i.price !== null);
    log(`[Priceline Pharmacy Search] Found ${results.length} results`);
    return results;
  } catch (err) {
    log(`[Priceline Pharmacy Search] API Error: ${err.message}`, 'WARN');
    return [];
  }
}

/**
 * Dedicated API search for Blooms The Chemist (Searchspring).
 */
async function searchBloomsApi(query) {
  try {
    log(`[Blooms The Chemist Search] Querying API for: "${query}"`);
    const resp = await axios.get(`https://bzg28y.a.searchspring.io/api/search/search.json?siteId=bzg28y&q=${encodeURIComponent(query)}&resultsFormat=native`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 15000
    });
    const items = resp.data?.results || [];
    const results = items.slice(0, 8).map(item => {
      const u = item.url?.startsWith('http') ? item.url : `https://www.bloomsthechemist.com.au${item.url?.startsWith('/') ? '' : '/'}${item.url || ''}`;
      const price = item.price != null ? parseFloat(item.price) : null;
      return {
        name: item.name || '',
        price,
        url: u,
        imageUrl: item.imageUrl || item.thumbnailImageUrl || null,
        inStock: item.ss_in_stock !== '0' ? 'In Stock' : 'Out of Stock'
      };
    }).filter(i => i.name && i.price !== null);
    log(`[Blooms The Chemist Search] Found ${results.length} results`);
    return results;
  } catch (err) {
    log(`[Blooms The Chemist Search] API Error: ${err.message}`, 'WARN');
    return [];
  }
}

/**
 * Searches a retailer for products matching a query.
 */
async function searchRetailer(retailerKey, query) {
  if (retailerKey === 'priceline') {
    return searchPricelineApi(query);
  }
  if (retailerKey === 'bloomsthechemist') {
    return searchBloomsApi(query);
  }
  return withScraperLock(() => doSearchRetailer(retailerKey, query));
}

async function doSearchRetailer(retailerKey, query) {
  let browser;
  const displayName = getRetailerDisplayName(retailerKey);

  try {
    let searchUrl = '';
    if (retailerKey === 'bunnings') {
      searchUrl = `https://www.bunnings.com.au/search/products?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'officeworks') {
      searchUrl = `https://www.officeworks.com.au/shop/officeworks/search?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'jbhifi') {
      searchUrl = `https://www.jbhifi.com.au/search?query=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'thegoodguys') {
      searchUrl = `https://www.thegoodguys.com.au/search?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'theiconic') {
      searchUrl = `https://www.theiconic.com.au/catalog/?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'terrywhite') {
      searchUrl = `https://terrywhitechemmart.com.au/catalogsearch/result?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'cincotta') {
      searchUrl = `https://cincottachemist.com.au/search?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'petbarn') {
      searchUrl = `https://www.petbarn.com.au/catalogsearch/result/?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'petstock') {
      searchUrl = `https://www.petstock.com.au/search?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'budgetpetproducts') {
      searchUrl = `https://www.budgetpetproducts.com.au/search?q=${encodeURIComponent(query)}`;
    } else if (retailerKey === 'petchemist') {
      searchUrl = `https://petchemist.com.au/search/?q=${encodeURIComponent(query)}`;
    } else {
      return [];
    }

    log(`[${displayName} Search] Searching for: "${query}" at ${searchUrl}`);
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise(r => setTimeout(r, 3500));

    const results = await page.evaluate((retKey, queryStr) => {
      const items = [];
      const seen = new Set();
      const queryTerms = (queryStr || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);

      let anchors = [];
      if (retKey === 'bunnings') {
        anchors = Array.from(document.querySelectorAll('a')).filter(a => /_p\d+/.test(a.href));
      } else if (retKey === 'officeworks') {
        anchors = Array.from(document.querySelectorAll('a[href*="/shop/officeworks/p/"]'));
      } else if (retKey === 'jbhifi') {
        anchors = Array.from(document.querySelectorAll('a[href*="/products/"]'));
      } else if (retKey === 'thegoodguys') {
        anchors = Array.from(document.querySelectorAll('a[href]')).filter(a => {
          const h = a.getAttribute('href') || '';
          return h.startsWith('/') && !h.includes('#') && !h.includes('search') && !h.includes('cart') && !h.includes('store') && h.length > 15;
        });
      } else if (retKey === 'theiconic') {
        anchors = Array.from(document.querySelectorAll('a[href*=".html"]')).filter(a => /\d+\.html$/.test(a.href));
      } else if (retKey === 'terrywhite') {
        anchors = Array.from(document.querySelectorAll('a[href*="/shop/product/"]'));
      } else if (retKey === 'cincotta') {
        anchors = Array.from(document.querySelectorAll('a[href*="/shop/"]')).filter(a => !a.href.includes('/shop/products') && !a.href.includes('/shop/catalogue'));
      } else if (retKey === 'petbarn') {
        anchors = Array.from(document.querySelectorAll('a[href*="/p/"]')).filter(a => !a.href.includes('/c/'));
      } else if (retKey === 'petstock') {
        anchors = Array.from(document.querySelectorAll('a[href*="/products/"]'));
      } else if (retKey === 'budgetpetproducts') {
        anchors = Array.from(document.querySelectorAll('a[href*="/product/"]'));
      } else if (retKey === 'petchemist') {
        anchors = Array.from(document.querySelectorAll('a[href*="/products/"]'));
      }

      for (const a of anchors) {
        const href = a.href;
        if (!href || seen.has(href)) continue;

        // Find surrounding card container
        const card = a.closest('article, [data-testid*="product"], [class*="product"], [class*="Card"], li') || a;
        const titleEl = card.querySelector('h2, h3, [data-testid*="title"], [class*="title"]') || a;
        const title = titleEl ? titleEl.innerText.replace(/\s+/g, ' ').trim() : '';
        if (!title || title.length < 3) continue;

        // Skip recommendations / carousels on retailer search pages
        const titleLower = title.toLowerCase();
        const hrefLower = href.toLowerCase();
        if (queryTerms.length > 0 && !queryTerms.some(term => titleLower.includes(term) || hrefLower.includes(term))) {
          continue;
        }

        const priceEl = card.querySelector('[data-testid*="price"], [data-locator*="price"], [class*="price"], [class*="Price"]');
        let price = null;
        if (priceEl) {
          const pText = priceEl.innerText || '';
          const match = pText.match(/\$\s*(\d+(?:\.\d{2})?)/);
          if (match) {
            price = parseFloat(match[1]);
          } else {
            const eaMatch = pText.match(/\$(\d{3,4})ea/);
            if (eaMatch) {
              price = parseFloat(eaMatch[1]) / 100;
            }
          }
        }
        if (price === null) {
          const cText = card.innerText || '';
          const match = cText.match(/\$\s*(\d+\.\d{2})/);
          if (match) {
            price = parseFloat(match[1]);
          } else {
            const eaMatch = cText.match(/\$(\d{3,4})ea/);
            if (eaMatch) {
              price = parseFloat(eaMatch[1]) / 100;
            }
          }
        }

        const imgEl = card.querySelector('img');
        const imageUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null;

        if (price !== null && !isNaN(price)) {
          seen.add(href);
          items.push({
            name: title,
            price,
            url: href,
            imageUrl,
            inStock: 'In Stock'
          });
          if (items.length >= 8) break;
        }
      }

      return items;
    }, retailerKey, query);

    log(`[${displayName} Search] Found ${results.length} results for "${query}"`);
    return results;
  } catch (err) {
    log(`[${displayName} Search] Error: ${err.message}`, 'ERROR');
    return [];
  } finally {
    await safeCloseBrowser(browser);
  }
}

module.exports = {
  detectRetailer,
  getRetailerDisplayName,
  scrapeRetailer,
  searchRetailer
};
