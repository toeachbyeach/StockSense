const { launchBrowser, safeCloseBrowser, withScraperLock } = require('./browserHelper');
const log = require('../logger');
const fs = require('fs');
const path = require('path');

async function scrapeSupermarket(url, lat = -33.8688, lng = 151.2093) {
  return withScraperLock(() => doScrapeSupermarket(url, lat, lng));
}

async function doScrapeSupermarket(url, lat = -33.8688, lng = 151.2093) {
  let browser;
  global.taskStatus = `Navigating to ${new URL(url).hostname}...`;
  log(`[Supermarket] Starting scrape for URL: ${url}`);
  try {
    log(`[Supermarket] Launching Puppeteer...`);
    browser = await launchBrowser([
      `--window-size=${1366 + Math.floor(Math.random() * 500)},${768 + Math.floor(Math.random() * 200)}`
    ]);
    const page = await browser.newPage();
    await page.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${115 + Math.floor(Math.random() * 10)}.0.0.0 Safari/537.36`);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    
    // Set geolocation for local pricing
    const context = browser.defaultBrowserContext();
    try {
      await context.overridePermissions(new URL(url).origin, ["geolocation"]);
      await page.setGeolocation({ latitude: parseFloat(lat), longitude: parseFloat(lng) });
    } catch(e) {}

    log(`[Supermarket] Navigating to URL...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    let result = {
      name: '',
      price: null,
      inStock: 'In Stock',
      imageUrl: null
    };

    if (url.includes('coles.com.au')) {
      log(`[Supermarket] Extracting Coles data...`);
      result.name = await page.$eval('.product__title', el => el.textContent.trim()).catch(() => '');
      const priceStr = await page.$eval('.price__value', el => el.textContent.trim()).catch(() => '');
      result.price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || null;
      result.imageUrl = await page.$eval('.thumbnail-container > img', el => el.getAttribute('src')).catch(() => null);
    } else if (url.includes('woolworths.com.au')) {
      log(`[Supermarket] Extracting Woolworths data...`);
      // Fallback 1: Next.js JSON state
      const nextDataJson = await page.evaluate(() => {
        const script = document.getElementById('__NEXT_DATA__');
        return script ? script.textContent : null;
      });
      
      let priceFound = null;
      let nameFound = null;
      let imageFound = null;
      
      if (nextDataJson) {
        try {
          const data = JSON.parse(nextDataJson);
          
          // Helper to recursively find price
          function findProductInfo(obj) {
            if (typeof obj !== 'object' || obj === null) return;
            if (obj.Price !== undefined && obj.Name) {
              priceFound = obj.Price;
              nameFound = obj.Name || obj.name;
              imageFound = obj.LargeImageFile || obj.image;
              return;
            }
            if (obj.price !== undefined && obj.name) {
              priceFound = obj.price;
              nameFound = obj.name || obj.title;
              imageFound = obj.image;
              return;
            }
            for (let k in obj) {
              if (priceFound === null) findProductInfo(obj[k]);
            }
          }
          findProductInfo(data);
        } catch(e) {
          log('[Supermarket] Failed to parse Woolworths JSON');
        }
      }
      
      if (priceFound !== null) {
        result.name = nameFound || await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
        result.price = parseFloat(priceFound);
        result.imageUrl = imageFound || await page.$eval('.product-image img, img.product-image', el => el.getAttribute('src')).catch(() => null);
      } else {
        // Fallback 2: Standard DOM selectors
        result.name = await page.$eval('h1.shelfProductTile-title, h1, .product-title', el => el.textContent.trim()).catch(() => '');
        const priceStr = await page.$eval('.primary.price-dollars, .price-dollars, .price, div[class*="price"]', el => el.textContent.trim()).catch(() => '');
        result.price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || null;
        result.imageUrl = await page.$eval('.product-image img', el => el.getAttribute('src')).catch(() => null);
      }
    }

    if (result.price !== null) {
      log(`[Supermarket] Scrape successful! Found price: $${result.price}`);
    } else {
      log(`[Supermarket] Failed to parse price from DOM.`, 'ERROR');
    }

    return result;
  } catch (err) {
    log(`[Supermarket] CRITICAL ERROR during scrape: ${err.message}`, 'ERROR');
    return null;
  } finally {
    await safeCloseBrowser(browser);
  }
}

async function searchSupermarket(query, retailer, lat = -33.8688, lng = 151.2093) {
  log(`[Supermarket Search] Searching ${retailer} for: "${query}"`);
  try {
    if (retailer === 'coles') {
      return await searchColes(query);
    } else if (retailer === 'woolworths') {
      return await searchWoolworths(query);
    }
    return [];
  } catch (err) {
    log(`[Supermarket Search] ERROR searching ${retailer}: ${err.message}`, 'ERROR');
    return [];
  }
}

async function searchColes(query) {
  try {
    global.taskStatus = `Searching Coles API...`;
    const url = `https://www.coles.com.au/api/bff/products/search?q=${encodeURIComponent(query)}&page=1&tabType=everything&sortBy=Relevance`;
    log(`[Coles Search API] Fetching: ${url}`);
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const results = (data.results || []).slice(0, 10).map(item => {
      const pricing = item.pricing || {};
      const price = pricing.now || pricing.was || null;
      const imgUrl = item.imageUris && item.imageUris.length > 0 
        ? `https://shop.coles.com.au${item.imageUris[0]?.uri || ''}` 
        : (item.thumbnailUri ? `https://shop.coles.com.au${item.thumbnailUri}` : null);
      
      return {
        name: item.name || item.description || '',
        price: price,
        url: item.id ? `https://www.coles.com.au/product/${item.slug || item.id}` : '',
        imageUrl: imgUrl,
        inStock: item.availability !== false ? 'In Stock' : 'Out of Stock'
      };
    }).filter(r => r.price !== null && r.url && r.name);

    log(`[Coles Search API] Found ${results.length} results`);
    return results;
  } catch (err) {
    const msg = `Searching Coles Puppeteer (fallback)...`;
    global.taskStatus = msg;
    log(`[Coles Search API] Failed: ${err.message}, falling back to Puppeteer`, 'WARN');
    return await searchSupermarketPuppeteer(query, 'coles');
  }
}

async function searchWoolworths(query) {
  try {
    global.taskStatus = `Searching Woolworths API...`;
    const url = 'https://www.woolworths.com.au/apis/ui/Search/products';
    log(`[Woolworths Search API] Posting search for: "${query}"`);
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        SearchTerm: query,
        PageSize: 10,
        PageNumber: 1,
        SortType: 'TraderRelevance',
        Location: '/shop/search/products',
        Filters: []
      })
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const products = data.Products || [];
    const results = products.slice(0, 10).map(p => {
      const prod = p.Products ? p.Products[0] : p;
      if (!prod) return null;
      
      const stockcode = prod.Stockcode || prod.stockcode;
      const urlName = (prod.UrlFriendlyName || prod.Name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      
      return {
        name: prod.Name || prod.DisplayName || '',
        price: prod.Price || prod.InstorePrice || null,
        url: stockcode ? `https://www.woolworths.com.au/shop/productdetails/${stockcode}/${urlName}` : '',
        imageUrl: prod.MediumImageFile || prod.SmallImageFile || null,
        inStock: prod.IsAvailable !== false ? 'In Stock' : 'Out of Stock'
      };
    }).filter(r => r && r.price !== null && r.url && r.name);

    log(`[Woolworths Search API] Found ${results.length} results`);
    return results;
  } catch (err) {
    const msg = `Searching Woolworths Puppeteer (fallback)...`;
    global.taskStatus = msg;
    log(`[Woolworths Search API] Failed: ${err.message}, falling back to Puppeteer`, 'WARN');
    return await searchSupermarketPuppeteer(query, 'woolworths');
  }
}

// Fallback Puppeteer-based search (in case APIs are blocked)
async function searchSupermarketPuppeteer(query, retailer) {
  return withScraperLock(() => doSearchSupermarketPuppeteer(query, retailer));
}

async function doSearchSupermarketPuppeteer(query, retailer) {
  let browser;
  log(`[Supermarket Search Fallback] Puppeteer search on ${retailer} for: "${query}"`);
  try {
    log(`[Supermarket Search Fallback] Launching browser...`);
    browser = await launchBrowser([
      `--window-size=${1366 + Math.floor(Math.random() * 500)},${768 + Math.floor(Math.random() * 200)}`
    ]);
    
    log(`[Supermarket Search Fallback] Browser launched. Creating new page...`);
    const page = await browser.newPage();
    
    // Add random human-like behavior
    await page.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${115 + Math.floor(Math.random() * 10)}.0.0.0 Safari/537.36`);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

    let interceptedApiResults = null;
    
    // Tier 3: Network Interception - Listen for internal API requests made by the SPA
    await page.setRequestInterception(true);
    page.on('request', (req) => req.continue());
    page.on('response', async (response) => {
      const url = response.url();
      if ((url.includes('/api/bff/products/search') || url.includes('/apis/ui/Search/products')) && response.status() === 200) {
        try {
          const json = await response.json();
          log(`[Supermarket Search Fallback] Intercepted internal API response from ${url}`);
          if (retailer === 'woolworths' && json.Products) {
            interceptedApiResults = json.Products.slice(0, 10).map(p => {
              const prod = p.Products ? p.Products[0] : p;
              if (!prod) return null;
              const stockcode = prod.Stockcode || prod.stockcode;
              const urlName = (prod.UrlFriendlyName || prod.Name || '').toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '');
              return {
                name: prod.Name || prod.DisplayName || '',
                price: prod.Price || prod.InstorePrice || null,
                url: stockcode ? `https://www.woolworths.com.au/shop/productdetails/${stockcode}/${urlName}` : '',
                imageUrl: prod.MediumImageFile || prod.SmallImageFile || null,
                inStock: prod.IsAvailable !== false ? 'In Stock' : 'Out of Stock'
              };
            }).filter(r => r && r.price !== null && r.url && r.name);
          } else if (retailer === 'coles' && json.results) {
             interceptedApiResults = json.results.slice(0, 10).map(item => {
               const pricing = item.pricing || {};
               const price = pricing.now || pricing.was || null;
               const imgUrl = item.imageUris && item.imageUris.length > 0 
                 ? `https://shop.coles.com.au${item.imageUris[0]?.uri || ''}` 
                 : (item.thumbnailUri ? `https://shop.coles.com.au${item.thumbnailUri}` : null);
               return {
                 name: item.name || item.description || '',
                 price: price,
                 url: item.id ? `https://www.coles.com.au/product/${item.slug || item.id}` : '',
                 imageUrl: imgUrl,
                 inStock: item.availability !== false ? 'In Stock' : 'Out of Stock'
               };
             }).filter(r => r.price !== null && r.url && r.name);
          }
        } catch(e) {}
      }
    });

    let searchUrl = '';
    if (retailer === 'coles') {
      searchUrl = `https://www.coles.com.au/search?q=${encodeURIComponent(query)}`;
    } else {
      searchUrl = `https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(query)}`;
    }

    log(`[Supermarket Search Fallback] Navigating to ${searchUrl}`);
    try {
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500)); // Add human delay before navigating
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      // Simulate human scrolling
      await page.evaluate(() => window.scrollBy(0, 500));
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1000));
    } catch (navErr) {
      log(`[Supermarket Search Fallback] Navigation warning: ${navErr.message} (Will check for intercepted data anyway)`);
    }
    
    // Check if network interception caught anything
    if (interceptedApiResults && interceptedApiResults.length > 0) {
       log(`[Supermarket Search Fallback] Success using intercepted API data! Found ${interceptedApiResults.length} valid results.`);
       return interceptedApiResults;
    }

    log(`[Supermarket Search Fallback] No API data intercepted. Proceeding to extract DOM links...`);
    
    // Tier 2: Generic DOM fallback
    const results = await page.evaluate((ret) => {
      const links = Array.from(document.querySelectorAll('a[href*="/product/"], a[href*="/productdetails/"]'));
      return links.map(link => {
        const container = link.closest('[data-testid="product-tile"]') || 
                          link.closest('.product-tile-v2') || 
                          link.closest('.shelfProductTile') || 
                          link.closest('section') || 
                          link.closest('article') || 
                          link.parentElement.parentElement.parentElement;
        
        const name = link.textContent.trim().substring(0, 100);
        let price = null;
        if (container) {
          const priceEl = container.querySelector('[class*="price"], [class*="Price"], .price-dollars');
          if (priceEl) {
            price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, ''));
          }
          if (!price || isNaN(price)) {
            const match = container.textContent.match(/\\$[0-9]+\\.[0-9]{2}/);
            if (match) price = parseFloat(match[0].replace('$', ''));
          }
        }
        
        const imgEl = container ? container.querySelector('img') : null;
        return {
          name,
          price: isNaN(price) ? null : price,
          url: link.href,
          imageUrl: imgEl ? imgEl.src : null,
          inStock: 'In Stock'
        };
      });
    }, retailer).catch(e => {
      return { error: e.message };
    });

    if (results && results.error) {
       log(`[Supermarket Search Fallback] Evaluation error: ${results.error}`, 'ERROR');
       return [];
    }

    log(`[Supermarket Search Fallback] Extracted ${results.length} total product links from page.`);
    if (results.length > 0) {
       log(`[Supermarket Search Fallback] First raw item: "${results[0].name.replace(/\\n/g, ' ')}" - Price: ${results[0].price}`);
    }

    const filtered = results.filter(r => r.price && r.name.length > 3).slice(0, 5);
    
    // DEBUG DUMP if we still have 0 results
    if (filtered.length === 0) {
      log(`[Supermarket Search Fallback] Zero results found after all tiers. Saving debug dumps...`, 'WARN');
      try {
        const debugDir = path.join(__dirname, '..', 'data', 'debug');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        const safeQuery = query.replace(/[^a-zA-Z0-9]/g, '_');
        const dumpPrefix = path.join(debugDir, `${retailer}_${safeQuery}_error`);
        
        const html = await page.content();
        fs.writeFileSync(`${dumpPrefix}.html`, html);
        await page.screenshot({ path: `${dumpPrefix}.png`, fullPage: true });
        
        log(`[Supermarket Search Fallback] Saved debug HTML and screenshot to: ${dumpPrefix}.[html/png]`);
      } catch (dumpErr) {
        log(`[Supermarket Search Fallback] Failed to save debug dump: ${dumpErr.message}`, 'ERROR');
      }
    } else {
      log(`[Supermarket Search Fallback] Found ${filtered.length} valid results after filtering.`);
    }

    return filtered;
  } catch (err) {
    log(`[Supermarket Search Fallback] ERROR: ${err.message}`, 'ERROR');
    return [];
  } finally {
    if (browser) {
      log(`[Supermarket Search Fallback] Closing browser...`);
      await safeCloseBrowser(browser);
    }
  }
}

module.exports = { scrapeSupermarket, searchSupermarket };
