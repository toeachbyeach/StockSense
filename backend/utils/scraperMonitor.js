const fs = require('fs');
const path = require('path');
const log = require('../logger');
const { sendAlert } = require('../notifier');

const HEALTH_FILE = path.join(__dirname, '..', 'data', 'scraper_health.json');

const INITIAL_SCRAPERS = {
  amazon: { name: 'Amazon Australia', key: 'amazon', domain: 'amazon.com.au' },
  coles: { name: 'Coles', key: 'coles', domain: 'coles.com.au' },
  woolworths: { name: 'Woolworths', key: 'woolworths', domain: 'woolworths.com.au' },
  chemistwarehouse: { name: 'Chemist Warehouse', key: 'chemistwarehouse', domain: 'chemistwarehouse.com.au' },
  petcircle: { name: 'Pet Circle', key: 'petcircle', domain: 'petcircle.com.au' },
  bunnings: { name: 'Bunnings Warehouse', key: 'bunnings', domain: 'bunnings.com.au' },
  officeworks: { name: 'Officeworks', key: 'officeworks', domain: 'officeworks.com.au' },
  jbhifi: { name: 'JB Hi-Fi', key: 'jbhifi', domain: 'jbhifi.com.au' },
  thegoodguys: { name: 'The Good Guys', key: 'thegoodguys', domain: 'thegoodguys.com.au' },
  theiconic: { name: 'The Iconic', key: 'theiconic', domain: 'theiconic.com.au' },
  priceline: { name: 'Priceline Pharmacy', key: 'priceline', domain: 'priceline.com.au' },
  terrywhite: { name: 'TerryWhite Chemmart', key: 'terrywhite', domain: 'terrywhitechemmart.com.au' },
  cincotta: { name: 'Cincotta Chemist', key: 'cincotta', domain: 'cincottachemist.com.au' },
  bloomsthechemist: { name: 'Blooms The Chemist', key: 'bloomsthechemist', domain: 'bloomsthechemist.com.au' },
  petbarn: { name: 'Petbarn', key: 'petbarn', domain: 'petbarn.com.au' },
  petstock: { name: 'Petstock', key: 'petstock', domain: 'petstock.com.au' },
  budgetpetproducts: { name: 'Budget Pet Products', key: 'budgetpetproducts', domain: 'budgetpetproducts.com.au' },
  petchemist: { name: 'Pet Chemist', key: 'petchemist', domain: 'petchemist.com.au' },
  ozbargain: { name: 'OzBargain', key: 'ozbargain', domain: 'ozbargain.com.au' }
};

let healthState = {};

function loadHealthState() {
  try {
    if (fs.existsSync(HEALTH_FILE)) {
      const raw = fs.readFileSync(HEALTH_FILE, 'utf8');
      healthState = JSON.parse(raw);
    }
  } catch (e) {
    log(`[ScraperMonitor] Failed to load health file: ${e.message}`, 'WARN');
  }

  // Ensure all scrapers exist in state
  for (const [key, meta] of Object.entries(INITIAL_SCRAPERS)) {
    if (!healthState[key]) {
      healthState[key] = {
        name: meta.name,
        key: meta.key,
        domain: meta.domain,
        status: 'healthy', // 'healthy' | 'degraded' | 'failing'
        consecutiveFailures: 0,
        totalScrapes: 0,
        successCount: 0,
        failureCount: 0,
        lastSuccess: null,
        lastFailure: null,
        lastError: null,
        lastChecked: null,
        alertSent: false,
        alertSentAt: null
      };
    }
  }
}

function saveHealthState() {
  try {
    const dir = path.dirname(HEALTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthState, null, 2));
  } catch (e) {
    log(`[ScraperMonitor] Failed to save health file: ${e.message}`, 'WARN');
  }
}

// Initialize on require
loadHealthState();

/**
 * Normalizes a URL to determine its scraper key.
 */
function getScraperKeyForUrl(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('amazon.')) return 'amazon';
  if (lower.includes('coles.com.au')) return 'coles';
  if (lower.includes('woolworths.com.au')) return 'woolworths';
  if (lower.includes('chemistwarehouse.com.au')) return 'chemistwarehouse';
  if (lower.includes('petcircle.com.au')) return 'petcircle';
  if (lower.includes('bunnings.com.au')) return 'bunnings';
  if (lower.includes('officeworks.com.au')) return 'officeworks';
  if (lower.includes('jbhifi.com.au')) return 'jbhifi';
  if (lower.includes('thegoodguys.com.au')) return 'thegoodguys';
  if (lower.includes('theiconic.com.au')) return 'theiconic';
  if (lower.includes('priceline.com.au')) return 'priceline';
  if (lower.includes('terrywhitechemmart.com.au')) return 'terrywhite';
  if (lower.includes('cincottachemist.com.au')) return 'cincotta';
  if (lower.includes('bloomsthechemist.com.au')) return 'bloomsthechemist';
  if (lower.includes('petbarn.com.au')) return 'petbarn';
  if (lower.includes('petstock.com.au')) return 'petstock';
  if (lower.includes('budgetpetproducts.com.au')) return 'budgetpetproducts';
  if (lower.includes('petchemist.com.au')) return 'petchemist';
  if (lower.includes('ozbargain.com.au')) return 'ozbargain';
  return null;
}

/**
 * Record a scrape event (success or failure) and trigger alerts if broken/recovered.
 */
async function recordScrapeResult(keyOrUrl, isSuccess, details = {}) {
  const key = INITIAL_SCRAPERS[keyOrUrl] ? keyOrUrl : getScraperKeyForUrl(keyOrUrl);
  if (!key || !healthState[key]) return;

  const scraper = healthState[key];
  const now = new Date().toISOString();
  scraper.lastChecked = now;
  scraper.totalScrapes = (scraper.totalScrapes || 0) + 1;

  if (isSuccess) {
    scraper.successCount = (scraper.successCount || 0) + 1;
    scraper.lastSuccess = now;

    const hadAlert = scraper.alertSent || scraper.status === 'failing' || scraper.consecutiveFailures >= 3;
    scraper.consecutiveFailures = 0;
    scraper.status = 'healthy';

    if (hadAlert) {
      log(`[ScraperMonitor] ${scraper.name} scraper has RECOVERED! Sending recovery notification...`);
      scraper.alertSent = false;
      scraper.alertSentAt = null;

      try {
        await sendAlert(
          `✅ Scraper Recovered: ${scraper.name}`,
          `Good news! StockSense successfully scraped ${scraper.name}.\n\nThe scraper is back online and extracting prices properly.\n\nTime: ${new Date().toLocaleString()}`,
          { url: details.url }
        );
      } catch (err) {
        log(`[ScraperMonitor] Failed to send recovery alert: ${err.message}`, 'WARN');
      }
    }
  } else {
    scraper.failureCount = (scraper.failureCount || 0) + 1;
    scraper.consecutiveFailures = (scraper.consecutiveFailures || 0) + 1;
    scraper.lastFailure = now;
    scraper.lastError = details.error ? (details.error.message || String(details.error)) : 'Unknown extraction failure';

    if (scraper.consecutiveFailures >= 3) {
      scraper.status = 'failing';
    } else if (scraper.consecutiveFailures >= 1) {
      scraper.status = 'degraded';
    }

    // Alert threshold: alert immediately once 3 consecutive errors occur, or if critical anti-bot/selector break
    const isCritical = /403|429|captcha|blocked|Access Denied|Security Checkpoint/i.test(scraper.lastError);
    const shouldAlert = (scraper.consecutiveFailures >= 3 || isCritical);

    const cooldownExpired = !scraper.alertSentAt || (Date.now() - new Date(scraper.alertSentAt).getTime() > 4 * 60 * 60 * 1000);

    if (shouldAlert && (!scraper.alertSent || cooldownExpired)) {
      log(`[ScraperMonitor] 🚨 ALERT! ${scraper.name} scraping broken (consecutive failures: ${scraper.consecutiveFailures})`);
      scraper.alertSent = true;
      scraper.alertSentAt = now;

      try {
        await sendAlert(
          `🚨 Scraper Alert: ${scraper.name} Scraping Issue Detected`,
          `⚠️ ATTENTION: StockSense detected that ${scraper.name} scraping is broken or failing!\n\n` +
          `• Site: ${scraper.name} (${scraper.domain})\n` +
          `• Consecutive Failures: ${scraper.consecutiveFailures}\n` +
          `• Last Error: ${scraper.lastError}\n` +
          `• Affected URL: ${details.url || 'N/A'}\n` +
          `• Timestamp: ${new Date().toLocaleString()}\n\n` +
          `Please check if ${scraper.name} has changed its page layout or enabled bot protections.`,
          { url: details.url }
        );
      } catch (err) {
        log(`[ScraperMonitor] Failed to send scraper failure alert: ${err.message}`, 'WARN');
      }
    }
  }

  saveHealthState();
}

/**
 * Returns formatted status of all scrapers.
 */
function getScraperHealth() {
  const scrapers = Object.values(healthState).map(s => {
    const total = (s.totalScrapes || 0);
    const successRate = total > 0 ? Math.round(((s.successCount || 0) / total) * 100) : 100;
    return {
      ...s,
      successRate
    };
  });

  const failingCount = scrapers.filter(s => s.status === 'failing').length;
  const degradedCount = scrapers.filter(s => s.status === 'degraded').length;
  const allHealthy = failingCount === 0 && degradedCount === 0;

  return {
    allHealthy,
    failingCount,
    degradedCount,
    scrapers
  };
}

/**
 * Runs a canary probe to test scrapers on demand.
 */
async function runCanaryProbe(targetKey = null) {
  const { scrapeAmazon } = require('../scrapers/amazon');
  const { scrapeSupermarket } = require('../scrapers/supermarkets');
  const { scrapeChemistWarehouse } = require('../scrapers/chemistwarehouse');
  const { scrapePetCircle } = require('../scrapers/petcircle');
  const { scrapeRetailer } = require('../scrapers/generalRetailers');

  const CANARY_URLS = {
    amazon: 'https://www.amazon.com.au/dp/B07PJV3JPR',
    coles: 'https://www.coles.com.au/product/coles-full-cream-milk-3l-5353140',
    woolworths: 'https://www.woolworths.com.au/shop/productdetails/134444/woolworths-full-cream-milk',
    chemistwarehouse: 'https://www.chemistwarehouse.com.au/buy/101859/panadol-optizorb-caplets-500mg-100-pack',
    petcircle: 'https://www.petcircle.com.au/product/nexgard-spectra-very-large-dog/dhn2245',
    bunnings: 'https://www.bunnings.com.au/craftright-8oz-226g-steel-claw-hammer_p5660292',
    officeworks: 'https://www.officeworks.com.au/shop/officeworks/p/keji-ballpoint-pens-1mm-assorted-10-pack-keka1271as',
    jbhifi: 'https://www.jbhifi.com.au/products/google-tv-streamer-4k',
    thegoodguys: 'https://www.thegoodguys.com.au/dell-27-qhd-144hz-monitor-se2726d',
    theiconic: 'https://www.theiconic.com.au/chloe-eau-de-parfum-50ml-2289512.html',
    priceline: 'https://www.priceline.com.au/product/199710/panadol-rapid-paracetamol-500mg-48-caplets',
    terrywhite: 'https://terrywhitechemmart.com.au/shop/product/first-response-pregnancy-early-result-test-in-stream-3-pack',
    cincotta: 'https://cincottachemist.com.au/shop/panadol-500mg-48-liquid-capsules',
    bloomsthechemist: 'https://www.bloomsthechemist.com.au/panadol-osteo-665mg-96-caplets-s3/',
    petbarn: 'https://www.petbarn.com.au/p/nexgard-spectra-for-dogs-15-1-30kg/134736',
    petstock: 'https://www.petstock.com.au/products/nexgard-spectra-flea-tick-worming-chews-15-1-30kg-dog-variant-122613000265',
    budgetpetproducts: 'https://www.budgetpetproducts.com.au/product/nexgard-for-dogs-green-medium-101-25kg-6-pack/5299',
    petchemist: 'https://petchemist.com.au/products/nexgard-spectra-yellow-3-6-7-5kg/?v=6356'
  };

  const keysToProbe = targetKey ? [targetKey] : Object.keys(CANARY_URLS);
  const results = [];

  for (const key of keysToProbe) {
    const url = CANARY_URLS[key];
    if (!url) continue;

    try {
      log(`[ScraperMonitor Canary] Probing ${key}...`);
      let res = null;

      if (key === 'amazon') res = await scrapeAmazon(url);
      else if (key === 'coles' || key === 'woolworths') res = await scrapeSupermarket(url);
      else if (key === 'chemistwarehouse') res = await scrapeChemistWarehouse(url);
      else if (key === 'petcircle') res = await scrapePetCircle(url);
      else res = await scrapeRetailer(url);

      if (res && res.price !== null && !isNaN(res.price)) {
        await recordScrapeResult(key, true, { url, price: res.price });
        results.push({ key, name: INITIAL_SCRAPERS[key]?.name || key, success: true, price: res.price });
      } else {
        throw new Error('No price returned');
      }
    } catch (err) {
      await recordScrapeResult(key, false, { url, error: err });
      results.push({ key, name: INITIAL_SCRAPERS[key]?.name || key, success: false, error: err.message });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    results
  };
}

module.exports = {
  getScraperKeyForUrl,
  recordScrapeResult,
  getScraperHealth,
  runCanaryProbe
};
