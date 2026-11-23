const { launchBrowser, safeCloseBrowser, withScraperLock } = require('./browserHelper');
const log = require('../logger');

async function scrapeOzBargain(url) {
  return withScraperLock(() => doScrapeOzBargain(url));
}

async function doScrapeOzBargain(url) {
  let browser;
  log(`[OzBargain] Starting scrape for URL: ${url}`);
  try {
    log(`[OzBargain] Launching Puppeteer...`);
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    log(`[OzBargain] Setting HTTP headers...`);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    log(`[OzBargain] Navigating to URL...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    let result = {
      name: '',
      price: null,
      inStock: 'Unknown',
      imageUrl: null
    };

    log(`[OzBargain] Extracting title...`);
    result.name = await page.$eval('#title', el => el.textContent.trim()).catch(() => '');
    if (!result.name) {
      result.name = await page.$eval('h1.title', el => el.textContent.trim()).catch(() => '');
    }
    log(`[OzBargain] Found title: ${result.name}`);

    log(`[OzBargain] Checking for 'expired' tag...`);
    const isExpired = await page.$eval('.expired', el => !!el).catch(() => false);
    
    log(`[OzBargain] Extracting price...`);
    const priceStr = await page.$eval('.deal-price, .tag-price', el => el.textContent.trim()).catch(() => {
       const match = result.name.match(/\$([0-9,.]+)/);
       return match ? match[1] : null;
    });

    if (priceStr) {
      result.price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
      if (isNaN(result.price)) result.price = null;
      log(`[OzBargain] Parsed price: $${result.price}`);
    } else {
      log(`[OzBargain] Failed to find price on page.`, 'ERROR');
    }

    result.imageUrl = await page.$eval('.foxshot-container img, .node-thumbnail img', el => el.getAttribute('src')).catch(() => null);
    
    if (isExpired) {
      result.inStock = 'Out of Stock (Expired)';
    } else {
      result.inStock = 'Active Deal';
    }
    log(`[OzBargain] Stock status: ${result.inStock}`);

    return result;
  } catch (err) {
    log(`[OzBargain] CRITICAL ERROR during scrape: ${err.message}`, 'ERROR');
    return null;
  } finally {
    await safeCloseBrowser(browser);
  }
}

module.exports = { scrapeOzBargain };
