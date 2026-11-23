const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');
const { scrapeSupermarket, searchSupermarket } = require('./scrapers/supermarkets');
const { scrapeAmazon, searchAmazon } = require('./scrapers/amazon');
const { scrapeChemistWarehouse, searchChemistWarehouse } = require('./scrapers/chemistwarehouse');
const { scrapePetCircle, searchPetCircle, parseProductQuantity } = require('./scrapers/petcircle');
const { detectRetailer, getRetailerDisplayName, scrapeRetailer, searchRetailer } = require('./scrapers/generalRetailers');
const { scrapeOzBargain } = require('./scrapers/ozbargain');
const { recordScrapeResult, getScraperHealth, runCanaryProbe, getScraperKeyForUrl } = require('./utils/scraperMonitor');
const { extractAmazonAsin, buildAmazonCartLink, buildAffiliateUrl } = require('./utils/affiliate');
const log = require('./logger');
const { sendAlert } = require('./notifier');
const { encrypt } = require('./crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const upload = multer({ dest: 'data/uploads/' });

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Utility to mask tokens when printing to logs
function maskToken(t) {
  if (!t) return '';
  try {
    if (t.length < 16) return t.replace(/.(?=.{4})/g, '*');
    return t.slice(0, 8) + '...' + t.slice(-4);
  } catch (e) {
    return '***';
  }
}

// Auth configuration
const AUTH_PASSWORD = process.env.PASSWORD || 'changeme123';
const JWT_SECRET = process.env.ENCRYPTION_KEY || 'default-secret-key-replace-in-prod';

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (token == null) {
    console.log(`[AUTH] ${new Date().toISOString()} Missing token for ${req.method} ${req.originalUrl}`);
    return res.sendStatus(401);
  }

  console.log(`[AUTH] ${new Date().toISOString()} Verifying token: ${maskToken(token)}`);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log(`[AUTH] ${new Date().toISOString()} JWT verification failed for token ${maskToken(token)}: ${err && err.message}`);
      return res.sendStatus(403);
    }
    console.log(`[AUTH] ${new Date().toISOString()} JWT verified for ${req.method} ${req.originalUrl}`);
    req.user = user;
    next();
  });
}

function isUnitPricingEnabled(item) {
  return !!(item && (item.manualUnitPricing === 1 || item.manualUnitPricing === '1' || item.manualUnitPricing === true || item.unitPricingEnabled === 1 || item.unitPricingEnabled === true));
}

function computeItemUnitPrice(price, packQuantity, volumeQuantity, volumeUnit, unitPricingEnabled) {
  if (price == null || isNaN(Number(price))) return { unitPrice: null, display: null, multiplier: 1 };
  const numPrice = Number(price);

  const isEnabled = unitPricingEnabled === 1 || unitPricingEnabled === '1' || unitPricingEnabled === true;
  if (!isEnabled) {
    return {
      unitPrice: numPrice,
      display: null,
      multiplier: 1
    };
  }

  const pQty = Math.max(Number(packQuantity) || 1, 1);
  const vQty = Math.max(Number(volumeQuantity) || 1, 0.0001);
  const rawUnit = (volumeUnit || '').trim().toLowerCase();

  // 1. Weight normalisation: Standardize to kg for fair cross-size comparisons
  if (['kg', 'kilo', 'kilogram', 'kilograms'].includes(rawUnit)) {
    const totalKg = pQty * vQty;
    const uPrice = Math.round((numPrice / totalKg) * 100) / 100;
    return {
      unitPrice: uPrice,
      display: `$${uPrice.toFixed(2)}/kg`,
      multiplier: totalKg,
      baseUnit: 'kg'
    };
  }

  if (['g', 'gm', 'gram', 'grams'].includes(rawUnit)) {
    const totalKg = (pQty * vQty) / 1000;
    const uPrice = Math.round((numPrice / totalKg) * 100) / 100;
    const totalG = pQty * vQty;
    const display = totalG < 1000
      ? `$${(Math.round((numPrice / (totalG / 100)) * 100) / 100).toFixed(2)}/100g`
      : `$${uPrice.toFixed(2)}/kg`;
    return {
      unitPrice: uPrice, // standardized to per kg for cross-size comparison
      display: display,
      multiplier: totalKg,
      baseUnit: 'kg'
    };
  }

  // 2. Volume normalisation: Standardize to L
  if (['l', 'litre', 'liter', 'litres', 'liters'].includes(rawUnit)) {
    const totalL = pQty * vQty;
    const uPrice = Math.round((numPrice / totalL) * 100) / 100;
    return {
      unitPrice: uPrice,
      display: `$${uPrice.toFixed(2)}/L`,
      multiplier: totalL,
      baseUnit: 'L'
    };
  }

  if (['ml', 'millilitre', 'milliliter', 'mls'].includes(rawUnit)) {
    const totalL = (pQty * vQty) / 1000;
    const uPrice = Math.round((numPrice / totalL) * 100) / 100;
    const totalMl = pQty * vQty;
    const display = totalMl < 1000
      ? `$${(Math.round((numPrice / (totalMl / 100)) * 100) / 100).toFixed(2)}/100ml`
      : `$${uPrice.toFixed(2)}/L`;
    return {
      unitPrice: uPrice, // standardized to per L for cross-size comparison
      display: display,
      multiplier: totalL,
      baseUnit: 'L'
    };
  }

  // 3. Discrete count items (chews, tablets, doses, cans, pouches, packs)
  const totalCount = pQty * vQty;
  const uPrice = Math.round((numPrice / totalCount) * 100) / 100;
  let unitLabel = rawUnit || (pQty > 1 ? 'ea' : 'ea');
  if (['pack', 'pk'].includes(unitLabel) && pQty > 1) {
    unitLabel = 'ea';
  }
  if (unitLabel.endsWith('s') && !['doses', 'pouches'].includes(unitLabel)) {
    unitLabel = unitLabel.slice(0, -1);
  }
  return {
    unitPrice: uPrice,
    display: `$${uPrice.toFixed(2)}/${unitLabel}`,
    multiplier: totalCount,
    baseUnit: unitLabel
  };
}

function getUnitMultiplier(item) {
  if (!isUnitPricingEnabled(item)) return 1;
  const unitInfo = computeItemUnitPrice(1, item?.packQuantity, item?.volumeQuantity, item?.volumeUnit, true);
  return unitInfo.multiplier || 1;
}

function getEffectiveUnitPrice(item) {
  if (!item || item.currentPrice == null) return null;
  const unitInfo = computeItemUnitPrice(item.currentPrice, item.packQuantity, item.volumeQuantity, item.volumeUnit, isUnitPricingEnabled(item));
  return unitInfo.unitPrice;
}

function computeEffectivePrice(rawPrice, shippingPrice, isPrime, hasAmazonPrime) {
  if (rawPrice === null || rawPrice === undefined) return null;
  const numRaw = Number(rawPrice);
  if (isNaN(numRaw)) return null;
  const numShip = Number(shippingPrice) || 0;
  const effectiveShipping = (hasAmazonPrime && isPrime) ? 0 : numShip;
  return Math.round((numRaw + effectiveShipping) * 100) / 100;
}

// Serve static frontend in production
app.use(express.static(path.join(__dirname, 'public')));

// Prevent caching for API routes and log auth/token presence for debugging
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const authHeader = req.headers['authorization'];
  const tokenFromQuery = req.query && req.query.token;
  const tokenPreview = authHeader ? maskToken((authHeader || '').split(' ')[1]) : (tokenFromQuery ? maskToken(req.query.token) : '');
  console.log(`[AUTH] ${new Date().toISOString()} ${req.method} ${req.originalUrl} authHeader=${!!authHeader} tokenQuery=${!!tokenFromQuery} token=${tokenPreview}`);

  next();
});

// API: Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === AUTH_PASSWORD) {
    console.log(`[AUTH] ${new Date().toISOString()} Successful login`);
    const token = jwt.sign({ authenticated: true }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ token });
  } else {
    console.warn(`[AUTH] ${new Date().toISOString()} Failed login attempt (password mismatch)`);
    res.status(401).json({ error: 'Invalid password' });
  }
});
// API: Uptime
app.get('/api/uptime', authenticateToken, (req, res) => {
  res.json({ uptime: process.uptime() });
});

// API: Status
app.get('/api/status', authenticateToken, (req, res) => {
  res.json({ status: global.taskStatus || '' });
});

// API: Scraper Health & Monitoring
app.get('/api/scrapers/health', authenticateToken, (req, res) => {
  res.json(getScraperHealth());
});

// API: Trigger Scraper Health Canary Probe
app.post('/api/scrapers/health/test', authenticateToken, async (req, res) => {
  const { key } = req.body || {};
  try {
    global.taskStatus = key ? `Testing ${key} scraper...` : 'Running scraper health probe across all sites...';
    const report = await runCanaryProbe(key);
    global.taskStatus = '';
    res.json(report);
  } catch (err) {
    global.taskStatus = '';
    res.status(500).json({ error: err.message });
  }
});

// API: Get all items
// API: Get logs
app.get('/api/logs', authenticateToken, (req, res) => {
  const logPath = path.join(__dirname, 'data', 'scraper.log');
  if (fs.existsSync(logPath)) {
    const logs = fs.readFileSync(logPath, 'utf8');
    res.send(logs);
  } else {
    res.send('No logs available yet.');
  }
});

// API: Get global settings
app.get('/api/settings', authenticateToken, (req, res) => {
  db.get('SELECT * FROM settings WHERE id = 1', (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) row = {};
    // Mask password before sending to frontend
    if (row.gmailAppPassword) {
      row.gmailAppPassword = '••••••••••••••••';
    }
    // Ensure dashboardColumns has a sensible default
    row.dashboardColumns = row.dashboardColumns || 3;
    row.hasAmazonPrime = Boolean(row.hasAmazonPrime);
    row.trackAmazonUsed = row.trackAmazonUsed !== undefined ? Boolean(row.trackAmazonUsed) : true;
    row.giftCardDiscount = row.giftCardDiscount || 0;
    row.quietHoursEnabled = Boolean(row.quietHoursEnabled);
    row.quietHoursStart = row.quietHoursStart || '22:00';
    row.quietHoursEnd = row.quietHoursEnd || '07:00';
    row.ntfyServer = row.ntfyServer || 'https://ntfy.sh';
    row.amazonAssociateTag = row.amazonAssociateTag || process.env.AMAZON_ASSOCIATE_TAG || '';
    row.affiliatePrefix = row.affiliatePrefix || '';
    res.json(row);
  });
});

// API: Update global settings
app.post('/api/settings', authenticateToken, (req, res) => {
  const { 
    gmailUser, gmailAppPassword, discordWebhook, globalNotify, digestFrequency, 
    latitude, longitude, dashboardColumns, hasAmazonPrime, trackAmazonUsed,
    giftCardDiscount, quietHoursEnabled, quietHoursStart, quietHoursEnd,
    telegramBotToken, telegramChatId, ntfyTopic, ntfyServer,
    amazonAssociateTag, affiliatePrefix
  } = req.body;
  
  let query = `UPDATE settings SET gmailUser = ?, discordWebhook = ?, globalNotify = ?, digestFrequency = ?, latitude = ?, longitude = ?`;
  let params = [gmailUser, discordWebhook, globalNotify ? 1 : 0, digestFrequency, latitude || -33.8688, longitude || 151.2093];
  
  if (gmailAppPassword && gmailAppPassword !== '••••••••••••••••') {
    query += `, gmailAppPassword = ?`;
    params.push(encrypt(gmailAppPassword));
  }
  // dashboardColumns persisted as integer
  if (dashboardColumns !== undefined) {
    query += `, dashboardColumns = ?`;
    params.push(Number(dashboardColumns) || 3);
  }
  if (hasAmazonPrime !== undefined) {
    query += `, hasAmazonPrime = ?`;
    params.push(hasAmazonPrime ? 1 : 0);
  }
  if (trackAmazonUsed !== undefined) {
    query += `, trackAmazonUsed = ?`;
    params.push(trackAmazonUsed ? 1 : 0);
  }
  if (giftCardDiscount !== undefined) {
    query += `, giftCardDiscount = ?`;
    params.push(Number(giftCardDiscount) || 0);
  }
  if (quietHoursEnabled !== undefined) {
    query += `, quietHoursEnabled = ?`;
    params.push(quietHoursEnabled ? 1 : 0);
  }
  if (quietHoursStart !== undefined) {
    query += `, quietHoursStart = ?`;
    params.push(quietHoursStart || '22:00');
  }
  if (quietHoursEnd !== undefined) {
    query += `, quietHoursEnd = ?`;
    params.push(quietHoursEnd || '07:00');
  }
  if (telegramBotToken !== undefined) {
    query += `, telegramBotToken = ?`;
    params.push(telegramBotToken || '');
  }
  if (telegramChatId !== undefined) {
    query += `, telegramChatId = ?`;
    params.push(telegramChatId || '');
  }
  if (ntfyTopic !== undefined) {
    query += `, ntfyTopic = ?`;
    params.push(ntfyTopic || '');
  }
  if (ntfyServer !== undefined) {
    query += `, ntfyServer = ?`;
    params.push(ntfyServer || 'https://ntfy.sh');
  }
  if (amazonAssociateTag !== undefined) {
    query += `, amazonAssociateTag = ?`;
    params.push(amazonAssociateTag ? amazonAssociateTag.trim() : '');
  }
  if (affiliatePrefix !== undefined) {
    query += `, affiliatePrefix = ?`;
    params.push(affiliatePrefix ? affiliatePrefix.trim() : '');
  }
  
  query += ` WHERE id = 1`;
  
  db.run(query, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });

    // When hasAmazonPrime is updated, recalculate effective prices for any items that have shipping fees or Prime eligibility
    if (hasAmazonPrime !== undefined) {
      const primeFlag = Boolean(hasAmazonPrime);
      db.all('SELECT id, rawPrice, currentPrice, shippingPrice, isPrime, subscribeSave, subscribePrice, group_id FROM items WHERE (shippingPrice IS NOT NULL AND shippingPrice > 0) OR isPrime = 1', [], (err2, items) => {
        if (!err2 && items && items.length > 0) {
          const updatedGroups = new Set();
          items.forEach(it => {
            const basePrice = (it.subscribeSave && it.subscribePrice) ? it.subscribePrice : (it.rawPrice != null ? it.rawPrice : it.currentPrice);
            const newEffective = computeEffectivePrice(basePrice, it.shippingPrice, Boolean(it.isPrime), primeFlag);
            if (newEffective !== null && newEffective !== it.currentPrice) {
              db.run('UPDATE items SET currentPrice = ? WHERE id = ?', [newEffective, it.id]);
              if (it.group_id) updatedGroups.add(it.group_id);
            }
          });
          updatedGroups.forEach(gId => updateGroupPrice(gId));
        }
      });
    }

    res.json({ message: 'Settings updated' });
  });
});

const { getCashbackInfo, CASHBACK_RATES } = require('./utils/cashback');

// API: Database maintenance / vacuum
app.post('/api/database/vacuum', authenticateToken, (req, res) => {
  log('[Database] Running VACUUM and cleanup...');
  db.run('VACUUM;', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    log('[Database] VACUUM complete.');
    res.json({ message: 'Database optimized and vacuumed successfully.' });
  });
});

// API: Cashback rates lookup
app.get('/api/cashback', authenticateToken, (req, res) => {
  const { url } = req.query;
  if (url) {
    return res.json(getCashbackInfo(url) || {});
  }
  res.json(CASHBACK_RATES);
});

// API: Public shared list (Read-Only)
app.get('/api/public/list', (req, res) => {
  const query = `
    SELECT g.id, g.name, g.currentPrice, g.lowestPrice, g.highestPrice, g.unitPrice, g.unitPriceDisplay, g.isOnSale, g.status, g.tags,
      (SELECT i.imageUrl FROM items i WHERE i.group_id = g.id AND i.imageUrl IS NOT NULL LIMIT 1) as imageUrl,
      (SELECT i.url FROM items i WHERE i.group_id = g.id AND i.currentPrice IS NOT NULL ORDER BY i.currentPrice ASC LIMIT 1) as url,
      (SELECT COUNT(*) FROM items i WHERE i.group_id = g.id) as sourceCount
    FROM product_groups g
    ORDER BY g.name ASC
  `;
  db.get('SELECT amazonAssociateTag, affiliatePrefix FROM settings WHERE id = 1', (errSettings, settings) => {
    const s = settings || {};
    db.all(query, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const enriched = (rows || []).map(r => ({
        ...r,
        url: r.url ? buildAffiliateUrl(r.url, s) : null
      }));
      res.json(enriched);
    });
  });
});

// API: Shopping Cart / Basket Split Optimizer
app.get('/api/basket', authenticateToken, (req, res) => {
  // Query all active groups with all their item sources
  const showAll = req.query.all === '1';
  const groupQuery = `SELECT id, name, routineQuantity, routineFrequency, isRoutine, currentPrice, unitPriceDisplay FROM product_groups`;
  db.all(groupQuery, [], (err, groups) => {
    if (err) return res.status(500).json({ error: err.message });

    const itemQuery = `SELECT id, group_id, url, name, currentPrice, inStock, packQuantity, volumeQuantity, volumeUnit, imageUrl FROM items WHERE currentPrice IS NOT NULL`;
    db.all(itemQuery, [], (err2, items) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const itemsByGroup = {};
      items.forEach(it => {
        if (!itemsByGroup[it.group_id]) itemsByGroup[it.group_id] = [];
        itemsByGroup[it.group_id].push(it);
      });

      // Retailer categorization helpers
      const getStore = (u) => {
        if (!u) return 'other';
        const lower = u.toLowerCase();
        if (lower.includes('coles.com.au')) return 'coles';
        if (lower.includes('woolworths.com.au')) return 'woolworths';
        if (lower.includes('amazon.')) return 'amazon';
        if (lower.includes('chemistwarehouse.com.au')) return 'chemistwarehouse';
        if (lower.includes('bunnings.com.au')) return 'bunnings';
        if (lower.includes('jbhifi.com.au')) return 'jbhifi';
        if (lower.includes('thegoodguys.com.au')) return 'thegoodguys';
        if (lower.includes('petcircle.com.au')) return 'petcircle';
        if (lower.includes('priceline.com.au')) return 'priceline';
        if (lower.includes('terrywhitechemmart.com.au')) return 'terrywhite';
        if (lower.includes('cincottachemist.com.au')) return 'cincotta';
        if (lower.includes('bloomsthechemist.com.au')) return 'bloomsthechemist';
        if (lower.includes('petbarn.com.au')) return 'petbarn';
        if (lower.includes('petstock.com.au')) return 'petstock';
        if (lower.includes('budgetpetproducts.com.au')) return 'budgetpetproducts';
        if (lower.includes('petchemist.com.au')) return 'petchemist';
        return 'other';
      };

      const allRecommendations = [];
      const routineRecommendations = [];
      const otherRecommendations = [];
      let totalOptimizedCost = 0;
      let totalColesCost = 0;
      let totalWooliesCost = 0;

      groups.forEach(g => {
        const sources = itemsByGroup[g.id] || [];
        if (sources.length === 0) return;

        // Find cheapest valid source
        let best = sources[0];
        let colesSource = null;
        let wooliesSource = null;

        sources.forEach(s => {
          if (s.currentPrice < best.currentPrice) best = s;
          const store = getStore(s.url);
          if (store === 'coles' && (!colesSource || s.currentPrice < colesSource.currentPrice)) colesSource = s;
          if (store === 'woolworths' && (!wooliesSource || s.currentPrice < wooliesSource.currentPrice)) wooliesSource = s;
        });

        const bestStore = getStore(best.url);
        const qty = Math.max(1, g.routineQuantity || 1);
        const isRoutine = Boolean(g.isRoutine === 1 || g.isRoutine === true || (g.routineFrequency && g.routineFrequency.trim() !== ''));
        const imageUrl = best.imageUrl || (sources.find(s => s.imageUrl)?.imageUrl) || null;

        const rec = {
          groupId: g.id,
          groupName: g.name,
          quantity: qty,
          routineFrequency: g.routineFrequency || 'weekly',
          isRoutine,
          imageUrl,
          unitPriceDisplay: g.unitPriceDisplay || null,
          bestStore,
          bestPrice: best.currentPrice,
          bestUrl: best.url,
          bestSourceId: best.id,
          colesPrice: colesSource ? colesSource.currentPrice : null,
          colesUrl: colesSource ? colesSource.url : null,
          wooliesPrice: wooliesSource ? wooliesSource.currentPrice : null,
          wooliesUrl: wooliesSource ? wooliesSource.url : null,
          savings: (colesSource && wooliesSource) ? Math.abs(colesSource.currentPrice - wooliesSource.currentPrice) * qty : 0,
          sourcesCount: sources.length
        };

        allRecommendations.push(rec);

        if (isRoutine) {
          routineRecommendations.push(rec);
          totalOptimizedCost += best.currentPrice * qty;
          if (colesSource) totalColesCost += colesSource.currentPrice * qty;
          if (wooliesSource) totalWooliesCost += wooliesSource.currentPrice * qty;
        } else {
          otherRecommendations.push(rec);
        }
      });

      const selectedItems = showAll ? allRecommendations : routineRecommendations;

      res.json({
        totalOptimizedCost,
        totalColesCost: totalColesCost || null,
        totalWooliesCost: totalWooliesCost || null,
        potentialSplitSavings: (totalColesCost && totalWooliesCost) ? Math.max(0, Math.min(totalColesCost, totalWooliesCost) - totalOptimizedCost) : 0,
        items: selectedItems,
        routineCount: routineRecommendations.length,
        totalTrackedCount: allRecommendations.length,
        otherItems: otherRecommendations
      });
    });
  });
});

// API: Quick toggle/update routine status for an item/group
app.post('/api/items/:id/routine', authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  const { isRoutine, routineFrequency, routineQuantity } = req.body;
  const flag = (isRoutine === true || isRoutine === 1 || isRoutine === '1') ? 1 : 0;
  const freq = routineFrequency || (flag ? 'weekly' : null);
  const qty = routineQuantity ? Math.max(1, parseInt(routineQuantity, 10)) : 1;

  db.run(
    `UPDATE product_groups SET isRoutine = ?, routineFrequency = ?, routineQuantity = ? WHERE id = ?`,
    [flag, freq, qty, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        `UPDATE items SET isRoutine = ?, routineFrequency = ?, routineQuantity = ? WHERE group_id = ?`,
        [flag, freq, qty, id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true, isRoutine: Boolean(flag), routineFrequency: freq, routineQuantity: qty });
        }
      );
    }
  );
});

// API: Send test notification
app.post('/api/settings/test', authenticateToken, async (req, res) => {
  try {
    const item = await new Promise((resolve, reject) => {
      db.get(
        `SELECT i.url, i.name, i.packQuantity, i.volumeQuantity, i.volumeUnit, i.manualUnitPricing
         FROM items i
         ORDER BY i.id ASC
         LIMIT 1`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });

    const itemLabel = item?.name || 'your first tracked item';
    const itemUrl = item?.url || null;
    await sendAlert(
      "🧪 Test Alert from StockSense", 
      `Success! This is a test alert for ${itemLabel}. If this item is on Amazon, the email should include your add-to-cart link and associate tag.`,
      { url: itemUrl }
    );
    res.json({ message: item ? `Test notification sent using ${itemLabel}` : 'Test notification sent (no tracked items were found to attach)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Find matching items for grouping
/**
 * Determines which stores to cross-search based on origin store and product context.
 */
function getTargetRetailersForMatch(url, productName = '') {
  const u = (url || '').toLowerCase();
  const name = (productName || '').toLowerCase();

  // 1. Bunnings: only search Bunnings
  if (u.includes('bunnings.com.au')) {
    return ['bunnings'];
  }

  // 2. Coles: search Woolworths and Amazon
  if (u.includes('coles.com.au')) {
    return ['woolworths', 'amazon'];
  }

  // 3. Woolworths: search Coles and Amazon
  if (u.includes('woolworths.com.au')) {
    return ['coles', 'amazon'];
  }

  // 4. JB Hi-Fi: search The Good Guys, Amazon, and optionally Officeworks if computer/tech
  if (u.includes('jbhifi.com.au')) {
    const list = ['thegoodguys', 'amazon'];
    if (/computer|laptop|monitor|printer|keyboard|mouse|headphone|cable|desk/i.test(name)) {
      list.push('officeworks');
    }
    return list;
  }

  // 5. The Good Guys: search JB Hi-Fi, Amazon, and optionally Officeworks if computer/tech
  if (u.includes('thegoodguys.com.au')) {
    const list = ['jbhifi', 'amazon'];
    if (/computer|laptop|monitor|printer|keyboard|mouse|headphone|cable/i.test(name)) {
      list.push('officeworks');
    }
    return list;
  }

  // 6. Pharmacies (Chemist Warehouse, Priceline, TerryWhite, Cincotta, Blooms The Chemist)
  if (u.includes('chemistwarehouse.com.au') || u.includes('priceline.com.au') || u.includes('terrywhitechemmart.com.au') || u.includes('cincottachemist.com.au') || u.includes('bloomsthechemist.com.au')) {
    const list = ['chemistwarehouse', 'priceline', 'terrywhite', 'cincotta', 'bloomsthechemist', 'amazon'];
    if (/shampoo|soap|wash|vitamin|supplement|toothpaste|deodorant|sunscreen|panadol|nurofen|bandaid|cream|lotion|skincare|cosmetic|perfume|tissue|wipe/i.test(name)) {
      list.push('coles', 'woolworths');
    }
    const originKey = detectRetailer(u) || (u.includes('chemistwarehouse.com.au') ? 'chemistwarehouse' : null);
    return list.filter(r => r !== originKey);
  }

  // 7. Pet Stores (Pet Circle, Petbarn, Petstock, Budget Pet Products, Pet Chemist)
  if (u.includes('petcircle.com.au') || u.includes('petbarn.com.au') || u.includes('petstock.com.au') || u.includes('budgetpetproducts.com.au') || u.includes('petchemist.com.au')) {
    const list = ['petcircle', 'petbarn', 'petstock', 'budgetpetproducts', 'petchemist', 'amazon'];
    if (/food|treat|meat|dental|pedigree|whiskas|purina|supercoat|dine|felix|fancy feast/i.test(name)) {
      list.push('coles', 'woolworths');
    }
    const originKey = detectRetailer(u) || (u.includes('petcircle.com.au') ? 'petcircle' : null);
    return list.filter(r => r !== originKey);
  }

  // 8. Officeworks: tech & stationery -> Amazon, JB Hi-Fi, The Good Guys
  if (u.includes('officeworks.com.au')) {
    const list = ['amazon'];
    if (/tv|monitor|laptop|computer|headphone|speaker|apple|keyboard|mouse|tablet|cable|wireless/i.test(name)) {
      list.push('jbhifi', 'thegoodguys');
    }
    return list;
  }

  // 9. The Iconic: fashion/apparel/shoes -> Amazon
  if (u.includes('theiconic.com.au')) {
    return ['amazon'];
  }

  // 10. Amazon: cross search everywhere intelligently based on product category
  if (u.includes('amazon.')) {
    const targets = new Set();
    // Groceries / household / toiletries / health
    if (/shampoo|soap|wash|vitamin|supplement|toothpaste|deodorant|sunscreen|panadol|nurofen|bandaid|cream|lotion|skincare|cosmetic|perfume/i.test(name)) {
      targets.add('chemistwarehouse');
      targets.add('priceline');
      targets.add('terrywhite');
      targets.add('coles');
      targets.add('woolworths');
    } else if (/snack|chocolate|coffee|tea|cereal|sauce|pasta|rice|oil|biscuit|drink|water|cleaner|detergent|dish|laundry|wipe|towel|paper/i.test(name)) {
      targets.add('coles');
      targets.add('woolworths');
    }
    // Pets
    if (/dog|cat|pet|puppy|kitten|flea|tick|worm|nexgard|bravecto|simparica|royal canin|hills|advance|black hawk/i.test(name)) {
      targets.add('petcircle');
      targets.add('petbarn');
      targets.add('petstock');
      targets.add('budgetpetproducts');
      targets.add('petchemist');
      targets.add('coles');
      targets.add('woolworths');
    }
    // Hardware / tools / garden / DIY / automotive
    if (/tool|hammer|drill|saw|screw|garden|paint|hardware|timber|mower|hose|dewalt|makita|ryobi|craftright|wiper|aerotwin|automotive/i.test(name)) {
      targets.add('bunnings');
    }
    // Tech / electronics / appliances
    if (/tv|headphone|earphone|speaker|apple|sony|samsung|laptop|gaming|playstation|nintendo|xbox|wireless|monitor|oled|led|soundbar|fridge|dryer|washer|vacuum|air fryer|microwave/i.test(name)) {
      targets.add('jbhifi');
      targets.add('thegoodguys');
      targets.add('officeworks');
    }
    // Stationery / office
    if (/pen|paper|notebook|printer|ink|toner|desk|chair|stationery|folder|binder|stapler/i.test(name)) {
      targets.add('officeworks');
    }
    // Fashion / clothing
    if (/shirt|dress|shoes|sneaker|jacket|pants|cologne|bag|apparel|clothing/i.test(name)) {
      targets.add('theiconic');
    }
    // If no category matched specifically, search supermarket + chemistwarehouse as standard fallback
    if (targets.size === 0) {
      targets.add('coles');
      targets.add('woolworths');
      targets.add('chemistwarehouse');
    }
    return Array.from(targets);
  }

  // Generic fallback if unknown store
  return ['amazon', 'coles', 'woolworths'];
}

/**
 * Filters out search results that do not belong to the same product / brand family.
 */
function filterRelevantAlternatives(originalName, candidates) {
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'of', 'with', 'in', 'on', 'to', 'from',
    'by', 'is', 'it', 'at', 'as', 'be', 'this', 'that', 'your', 'you', 'our', 'its',
    'pack', 'size', 'pk', 'count', 'ea', 'approx', 'each', 'chews', 'chew', 'tablets',
    'capsules', 'caplets', 'online', 'special', 'buy'
  ]);

  const origTokens = (originalName || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  if (origTokens.length === 0) return candidates;

  const primaryBrand = origTokens[0];
  const secondaryBrand = origTokens.length > 1 ? origTokens[1] : null;

  return candidates.filter(cand => {
    if (!cand || !cand.name) return false;
    const candTokens = new Set(
      cand.name
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );

    // Check brand match
    const hasBrandMatch = (primaryBrand && candTokens.has(primaryBrand)) ||
                          (secondaryBrand && candTokens.has(secondaryBrand));

    // Calculate token overlap
    let overlapCount = 0;
    for (const t of origTokens) {
      if (candTokens.has(t)) overlapCount++;
    }
    const overlapRatio = overlapCount / origTokens.length;

    // If original has a clear brand (>= 4 chars), require brand match or strong overlap (>= 45%)
    if (primaryBrand && primaryBrand.length >= 4) {
      if (hasBrandMatch) return true;
      return overlapRatio >= 0.45;
    }

    return overlapRatio >= 0.35;
  });
}

/**
 * Core matching orchestrator: scrapes original item, searches competitor retailers,
 * enriches with unit pricing, and runs visual matching.
 */
async function findProductMatches(url) {
  let original = null;
  const settings = await new Promise((resolve) => {
    db.get('SELECT latitude, longitude, hasAmazonPrime FROM settings WHERE id = 1', (err, row) => resolve(row || { latitude: -33.8688, longitude: 151.2093, hasAmazonPrime: 0 }));
  });

  if (url.includes('coles.com.au') || url.includes('woolworths.com.au')) {
    original = await scrapeSupermarket(url, settings.latitude, settings.longitude);
  } else if (url.includes('amazon')) {
    original = await scrapeAmazon(url);
  } else if (url.includes('chemistwarehouse.com.au')) {
    original = await scrapeChemistWarehouse(url);
  } else if (url.includes('petcircle.com.au')) {
    original = await scrapePetCircle(url);
  } else if (detectRetailer(url)) {
    original = await scrapeRetailer(url);
  }

  if (original && original.price != null) {
    await recordScrapeResult(url, true, { url, price: original.price });
  } else {
    await recordScrapeResult(url, false, { url, error: new Error('Failed to extract product data from URL') });
  }

  if (!original || !original.name) {
    throw new Error('Could not extract product name from URL to perform matching search.');
  }
  
  // Build a smart search query: deduplicate words, remove filler, keep it concise
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'with', 'in', 'on', 'to', 'from', 'by', 'is', 'it', 'at', 'as', 'be', 'this', 'that', 'your', 'you', 'our', 'its']);
  const rawWords = original.name
    .replace(/[^\w\s]/g, ' ')  // strip special chars
    .split(/\s+/)
    .filter(w => w.length > 1);
  
  // Deduplicate (case-insensitive) while preserving order
  const seen = new Set();
  const uniqueWords = [];
  for (const word of rawWords) {
    const lower = word.toLowerCase();
    if (!seen.has(lower) && !stopWords.has(lower)) {
      seen.add(lower);
      uniqueWords.push(word);
    }
  }
  
  // Orchestrator: Try progressively shorter queries if no results are found
  async function searchWithDegradation(retailer, uniqueWords, lat, lng) {
    const lengths = [5, 4, 3, 2];
    let lastAttemptedQuery = '';
    
    for (const len of lengths) {
      const query = uniqueWords.slice(0, len).join(' ');
      if (query === lastAttemptedQuery || !query) continue;
      lastAttemptedQuery = query;
      
      const msg = `[Match Orchestrator] Trying ${retailer} search with query: "${query}"`;
      global.taskStatus = `Searching ${retailer}...`;
      log(msg);
      
      let results = [];
      try {
        if (retailer === 'amazon') {
          results = await searchAmazon(query);
        } else if (retailer === 'chemistwarehouse') {
          results = await searchChemistWarehouse(query);
        } else if (retailer === 'petcircle') {
          results = await searchPetCircle(query);
        } else if ([
          'bunnings', 'officeworks', 'jbhifi', 'thegoodguys', 'theiconic',
          'priceline', 'terrywhite', 'cincotta', 'bloomsthechemist',
          'petbarn', 'petstock', 'budgetpetproducts', 'petchemist'
        ].includes(retailer)) {
          results = await searchRetailer(retailer, query);
        } else {
          results = await searchSupermarket(query, retailer, lat, lng);
        }
      } catch (e) {
        log(`[Match Orchestrator] ${retailer} search threw error: ${e.message}`, 'ERROR');
      }
      
      if (results && results.length > 0) {
        log(`[Match Orchestrator] Success! Found ${results.length} results for ${retailer} using "${query}"`);
        return results;
      }
    }
    log(`[Match Orchestrator] Exhausted all query degradation attempts for ${retailer}. No results found.`, 'WARN');
    return [];
  }
  
  original.url = url;

  const targetRetailers = getTargetRetailersForMatch(url, original.name);
  log(`[Match Orchestrator] Target stores to search for "${original.name}": [${targetRetailers.join(', ')}]`);

  global.taskStatus = `Searching alternative stores (${targetRetailers.join(', ')})...`;
  const promises = targetRetailers.map(retailer => {
    if (retailer === 'coles' || retailer === 'woolworths') {
      return searchWithDegradation(retailer, uniqueWords, settings.latitude, settings.longitude);
    }
    return searchWithDegradation(retailer, uniqueWords);
  });
  
  const allResults = await Promise.all(promises);
  
  // Filter out the exact original URL from the alternatives
  const stripQuery = (u) => { try { return new URL(u).origin + new URL(u).pathname; } catch { return u; } };
  const originalNormalized = stripQuery(original.url);
  
  let alternatives = allResults.flat().filter(alt => stripQuery(alt.url) !== originalNormalized);

  // 1. Text & Brand Relevance Filtering: reject totally unrelated items (e.g. chicken, prawns, cat litter)
  const preCount = alternatives.length;
  alternatives = filterRelevantAlternatives(original.name, alternatives);
  log(`[Match Orchestrator] Relevance filter: kept ${alternatives.length} of ${preCount} alternatives for "${original.name}"`);
  
  // 2. Visual and Color Comparison
  if (original.imageUrl && alternatives.length > 0) {
    global.taskStatus = `Analyzing product images for visual and color matching...`;
    const { getImageHash, compareHashes, getColorSignature, compareColors } = require('./utils/imageMatcher');
    log(`[ImageMatcher] Calculating hash and colors for original image...`);
    const originalHash = await getImageHash(original.imageUrl);
    const originalColors = await getColorSignature(original.imageUrl);
    
    if (originalHash) {
      log(`[ImageMatcher] Calculating hashes and colors for ${alternatives.length} alternatives...`);
      for (const alt of alternatives) {
        if (alt.imageUrl) {
          const altHash = await getImageHash(alt.imageUrl);
          const altColors = await getColorSignature(alt.imageUrl);
          
          const shapeDistance = compareHashes(originalHash, altHash);
          const colorDistance = compareColors(originalColors, altColors);
          
          // Color mismatch raises visual distance
          alt.visualDistance = colorDistance === 1 ? Math.max(shapeDistance, 0.6) : shapeDistance;
          log(`[ImageMatcher] Distance for "${alt.name}": Shape=${shapeDistance.toFixed(3)}, ColorMismatch=${colorDistance === 1}, Total=${alt.visualDistance.toFixed(3)}`);
        } else {
          alt.visualDistance = null;
        }
      }
      
      // Filter out hard visual mismatches (distance > 0.65) where image was analyzed
      const visualFiltered = alternatives.filter(alt => alt.visualDistance === null || alt.visualDistance <= 0.65);
      if (visualFiltered.length > 0) {
        alternatives = visualFiltered;
      }
      
      // Sort by closest visual match without mutating product titles
      alternatives.sort((a, b) => (a.visualDistance ?? 0.5) - (b.visualDistance ?? 0.5));
    }
  }
  
  global.taskStatus = '';

  const enrichItemWithUnits = (prod) => {
    if (!prod) return;
    prod.rawPrice = prod.rawPrice != null ? prod.rawPrice : prod.price;
    prod.shippingPrice = prod.shippingPrice || 0;
    prod.isPrime = Boolean(prod.isPrime);
    prod.price = computeEffectivePrice(prod.rawPrice, prod.shippingPrice, prod.isPrime, Boolean(settings.hasAmazonPrime));
    prod.subscribePrice = prod.subscribePrice != null ? prod.subscribePrice : null;
    prod.subscribeSave = Boolean(prod.subscribeSave);

    const parsed = parseProductQuantity(prod.name);
    if (prod.packQuantity === undefined) prod.packQuantity = parsed.packQuantity || 1;
    if (prod.volumeQuantity === undefined) prod.volumeQuantity = parsed.volumeQuantity || 1;
    if (prod.volumeUnit === undefined) prod.volumeUnit = parsed.volumeUnit || '';
    if (prod.unitPricingEnabled === undefined) prod.unitPricingEnabled = parsed.unitPricingEnabled;

    const unitInfo = computeItemUnitPrice(prod.price, prod.packQuantity, prod.volumeQuantity, prod.volumeUnit, prod.unitPricingEnabled);
    prod.unitPrice = unitInfo.unitPrice;
    prod.unitPriceDisplay = unitInfo.display;
  };
  
  if (original) {
    enrichItemWithUnits(original);
  }
  if (alternatives && alternatives.length > 0) {
    // If original has a specific pack count (e.g. 6), align any alternative from pet stores with variants
    if (original && original.packQuantity > 1) {
      for (const alt of alternatives) {
        if (alt.url && (alt.url.includes('petchemist.com.au') || alt.url.includes('petbarn.com.au'))) {
          try {
            const scrapedAlt = await scrapeRetailer(alt.url, original.packQuantity);
            if (scrapedAlt && scrapedAlt.price != null) {
              alt.name = scrapedAlt.name;
              alt.price = scrapedAlt.price;
              alt.rawPrice = scrapedAlt.rawPrice;
              alt.subscribePrice = scrapedAlt.subscribePrice;
              alt.subscribeSave = scrapedAlt.subscribeSave;
              alt.packQuantity = scrapedAlt.packQuantity;
              alt.volumeQuantity = scrapedAlt.volumeQuantity;
              alt.volumeUnit = scrapedAlt.volumeUnit;
              alt.unitPricingEnabled = scrapedAlt.unitPricingEnabled;
            }
          } catch (e) {
            log(`[Match Orchestrator] Retailer variant alignment skipped: ${e.message}`, 'WARN');
          }
        }
      }
    }
    alternatives.forEach(alt => enrichItemWithUnits(alt));

    // Sort: matching pack size first, then closest visual distance
    alternatives.sort((a, b) => {
      if (original?.packQuantity > 1) {
        const aMatch = a.packQuantity === original.packQuantity ? 0 : 1;
        const bMatch = b.packQuantity === original.packQuantity ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return (a.visualDistance ?? 0.5) - (b.visualDistance ?? 0.5);
    });
  }

  return { original, alternatives };
}

app.post('/api/match', authenticateToken, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  
  log(`Finding matches for: ${url}`);
  try {
    const results = await findProductMatches(url);
    res.json(results);
  } catch (err) {
    global.taskStatus = '';
    res.status(500).json({ error: err.message });
  }
});

// API: Manual link match fallback
app.post('/api/match/manual', authenticateToken, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    global.taskStatus = 'Manually scraping URL...';
    let alternative = null;
    
    // Supports Coles, Woolworths, Chemist Warehouse, Amazon, Pet Circle, Bunnings, Officeworks, JB Hi-Fi, The Iconic, etc.
    if (url.includes('coles.com.au') || url.includes('woolworths.com.au')) {
      const { scrapeSupermarket } = require('./scrapers/supermarkets');
      alternative = await scrapeSupermarket(url);
    } else if (url.includes('chemistwarehouse.com.au')) {
      alternative = await scrapeChemistWarehouse(url);
    } else if (url.includes('amazon')) {
      alternative = await scrapeAmazon(url);
    } else if (url.includes('petcircle.com.au')) {
      alternative = await scrapePetCircle(url);
    } else if (detectRetailer(url)) {
      alternative = await scrapeRetailer(url);
    } else {
      alternative = await scrapeRetailer(url);
    }
    
    global.taskStatus = '';
    
    if (alternative && alternative.name) {
      alternative.url = url;
      const parsed = parseProductQuantity(alternative.name);
      alternative.packQuantity = alternative.packQuantity || parsed.packQuantity || 1;
      alternative.volumeQuantity = alternative.volumeQuantity || parsed.volumeQuantity || 1;
      alternative.volumeUnit = alternative.volumeUnit || parsed.volumeUnit || '';
      alternative.unitPricingEnabled = (alternative.unitPricingEnabled !== undefined) ? alternative.unitPricingEnabled : parsed.unitPricingEnabled;
      const unitInfo = computeItemUnitPrice(alternative.price, alternative.packQuantity, alternative.volumeQuantity, alternative.volumeUnit, alternative.unitPricingEnabled);
      alternative.unitPrice = unitInfo.unitPrice;
      alternative.unitPriceDisplay = unitInfo.display;

      res.json({ alternatives: [alternative] });
    } else {
      res.status(404).json({ error: 'Could not extract product data from the provided URL' });
    }
  } catch (err) {
    global.taskStatus = '';
    res.status(500).json({ error: err.message });
  }
});

// API: Get basic product info (real title, image, price) for a single URL.
// Used by the bookmarklet quick-add so items get their actual product name.
app.post('/api/product-info', authenticateToken, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    global.taskStatus = 'Reading product details...';
    let info = null;

    const settings = await new Promise((resolve) => {
      db.get('SELECT latitude, longitude, hasAmazonPrime FROM settings WHERE id = 1', (err, row) => resolve(row || { latitude: -33.8688, longitude: 151.2093, hasAmazonPrime: 0 }));
    });

    if (url.includes('coles.com.au') || url.includes('woolworths.com.au')) {
      info = await scrapeSupermarket(url, settings.latitude, settings.longitude);
    } else if (url.includes('amazon')) {
      info = await scrapeAmazon(url);
    } else if (url.includes('chemistwarehouse.com.au')) {
      info = await scrapeChemistWarehouse(url);
    } else if (url.includes('petcircle.com.au')) {
      info = await scrapePetCircle(url);
    } else if (url.includes('ozbargain.com.au')) {
      info = await scrapeOzBargain(url);
    } else if (detectRetailer(url)) {
      info = await scrapeRetailer(url);
    }

    global.taskStatus = '';

    if (!info || !info.name) {
      return res.status(400).json({ error: 'Could not read product info from that URL.' });
    }

    const rawPrice = info.rawPrice != null ? info.rawPrice : info.price;
    const shippingPrice = info.shippingPrice || 0;
    const isPrime = Boolean(info.isPrime);
    const effectivePrice = computeEffectivePrice(rawPrice, shippingPrice, isPrime, Boolean(settings.hasAmazonPrime));

    const parsedQty = parseProductQuantity(info.name);
    const pQty = info.packQuantity || parsedQty.packQuantity || 1;
    const vQty = info.volumeQuantity || parsedQty.volumeQuantity || 1;
    const vUnit = info.volumeUnit || parsedQty.volumeUnit || '';
    const unitPricingEnabled = (info.unitPricingEnabled !== undefined) ? info.unitPricingEnabled : parsedQty.unitPricingEnabled;
    const unitInfo = computeItemUnitPrice(effectivePrice != null ? effectivePrice : info.price, pQty, vQty, vUnit, unitPricingEnabled);

    res.json({
      name: info.name,
      price: effectivePrice != null ? effectivePrice : info.price,
      rawPrice: rawPrice,
      shippingPrice: shippingPrice,
      isPrime: isPrime,
      imageUrl: info.imageUrl,
      inStock: info.inStock,
      variations: info.variations || null,
      packQuantity: pQty,
      volumeQuantity: vQty,
      volumeUnit: vUnit,
      unitPricingEnabled: unitPricingEnabled,
      unitPrice: unitInfo.unitPrice,
      unitPriceDisplay: unitInfo.display,
      usedPrice: info.usedPrice || null,
      usedCondition: info.usedCondition || null,
      usedConditionNote: info.usedConditionNote || null,
      usedSeller: info.usedSeller || null,
      usedOffers: info.usedOffers || []
    });
  } catch (err) {
    global.taskStatus = '';
    res.status(500).json({ error: err.message });
  }
});

// API: Get pending bookmarklet items
app.get('/api/pending-items', authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM pending_items WHERE status IN ('pending', 'matching', 'ready') ORDER BY id DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const parsed = (rows || []).map(r => {
        let parsedMatches = null;
        if (r.matchResults) {
          try { parsedMatches = JSON.parse(r.matchResults); } catch {}
        }
        return { ...r, matchResults: parsedMatches };
      });
      res.json(parsed);
    }
  );
});

// API: Queue a new item from bookmarklet or external source
app.post('/api/pending-items', authenticateToken, async (req, res) => {
  const { url, name, imageUrl, price, rawPrice, shippingPrice, isPrime } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  db.get(`SELECT id, status, matchResults FROM pending_items WHERE url = ? AND status IN ('pending', 'matching', 'ready')`, [url], async (err, existing) => {
    if (existing) {
      return res.json({ id: existing.id, message: 'Item already in pending queue', status: existing.status });
    }

    let itemName = name;
    let itemImage = imageUrl;
    let itemPrice = price;
    let itemRawPrice = rawPrice != null ? rawPrice : price;
    let itemShippingPrice = shippingPrice || 0;
    let itemIsPrime = isPrime ? 1 : 0;

    db.run(
      `INSERT INTO pending_items (url, name, imageUrl, price, rawPrice, shippingPrice, isPrime, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'matching')`,
      [url, itemName || 'New item', itemImage, itemPrice, itemRawPrice, itemShippingPrice, itemIsPrime],
      function(insErr) {
        if (insErr) return res.status(500).json({ error: insErr.message });
        const pendingId = this.lastID;
        res.json({ id: pendingId, name: itemName, url, status: 'matching' });

        // Trigger background comparison search so comparisons are immediately ready when the user visits the frontend
        (async () => {
          try {
            log(`[PendingQueue] Background comparison started for item ${pendingId} (${url})`);
            const matchData = await findProductMatches(url);
            db.run(
              `UPDATE pending_items SET name = COALESCE(?, name), imageUrl = COALESCE(?, imageUrl), price = COALESCE(?, price), status = 'ready', matchResults = ? WHERE id = ?`,
              [matchData.original?.name, matchData.original?.imageUrl, matchData.original?.price, JSON.stringify(matchData), pendingId],
              (uErr) => {
                if (uErr) log(`[PendingQueue] Failed to save match results for item ${pendingId}: ${uErr.message}`, 'ERROR');
                else log(`[PendingQueue] Comparisons ready for queued item ${pendingId}`);
              }
            );
          } catch (mErr) {
            log(`[PendingQueue] Background match failed for item ${pendingId}: ${mErr.message}`, 'WARN');
            db.run(`UPDATE pending_items SET status = 'pending' WHERE id = ?`, [pendingId]);
          }
        })();
      }
    );
  });
});

// API: Delete / dismiss a pending item
app.delete('/api/pending-items/:id', authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  db.run(`DELETE FROM pending_items WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deleted: this.changes > 0 });
  });
});

// API: Create new product group (supports single group or separateGroups for variations)
app.post('/api/groups', authenticateToken, (req, res) => {
  const { name, type, intervalWeeks, urls, itemsData, separateGroups, pendingId, targetPrice, tags, isRoutine, routineFrequency, routineQuantity } = req.body;
  if (pendingId) {
    db.run('DELETE FROM pending_items WHERE id = ?', [pendingId]);
  }
  const items = itemsData || (urls ? urls.map(u => ({ url: u })) : []);
  const rFlag = (isRoutine === true || isRoutine === 1 || isRoutine === '1') ? 1 : (routineFrequency ? 1 : 0);
  const rFreq = routineFrequency || (rFlag ? 'weekly' : null);
  const rQty = routineQuantity ? Math.max(1, parseInt(routineQuantity, 10)) : 1;

  if (separateGroups && items.length > 1) {
    const createdIds = [];
    let completed = 0;
    let hasError = false;

    items.forEach(item => {
      const groupName = item.name ? (item.name.includes(name) ? item.name : `${name} (${item.name})`) : name;
      const detected = parseProductQuantity(item.name || groupName);
      const pQty = item.packQuantity || detected.packQuantity || 1;
      const vQty = item.volumeQuantity || detected.volumeQuantity || 1;
      const vUnit = item.volumeUnit || detected.volumeUnit || '';
      const unitPricingEnabled = (item.manualUnitPricing !== undefined || item.unitPricingEnabled !== undefined)
        ? (item.manualUnitPricing === 1 || item.manualUnitPricing === true || item.unitPricingEnabled === 1 || item.unitPricingEnabled === true)
        : Boolean(detected.unitPricingEnabled);

      db.run(
        `INSERT INTO product_groups (name, type, intervalWeeks, currentPrice, lowestPrice, highestPrice, targetPrice, tags, isRoutine, routineFrequency, routineQuantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [groupName, type || 'watching', intervalWeeks || 4, null, null, null, targetPrice || null, tags || null, rFlag, rFreq, rQty],
        function(err) {
          if (err) {
            if (!hasError) { hasError = true; res.status(400).json({ error: err.message }); }
            return;
          }
          const groupId = this.lastID;
          createdIds.push(groupId);

          db.run(
            `INSERT INTO items (group_id, url, name, currentPrice, rawPrice, shippingPrice, isPrime, lowestPrice, highestPrice, imageUrl, inStock, status, lastChecked, packQuantity, volumeQuantity, volumeUnit, manualUnitPricing, targetPrice, isRoutine, routineFrequency, routineQuantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`,
            [groupId, item.url, item.name || groupName, item.currentPrice, item.rawPrice != null ? item.rawPrice : item.currentPrice, item.shippingPrice || 0, item.isPrime ? 1 : 0, item.currentPrice, item.currentPrice, item.imageUrl, item.inStock || 'In Stock', 'OK', pQty, vQty, vUnit, unitPricingEnabled ? 1 : 0, targetPrice || null, rFlag, rFreq, rQty],
            function(itemErr) {
              if (!itemErr) {
                const itemId = this.lastID;
                if (!item.currentPrice) {
                  db.get('SELECT * FROM items WHERE id = ?', [itemId], (e, dbItem) => {
                    if (dbItem) syncItem(dbItem);
                  });
                } else {
                  db.run(`INSERT INTO price_history (item_id, price) VALUES (?, ?)`, [itemId, item.currentPrice], () => {
                    updateGroupPrice(groupId);
                  });
                }
              }
              completed++;
              if (completed === items.length && !hasError) {
                createBackup();
                res.json({ id: createdIds[0], ids: createdIds, count: createdIds.length });
              }
            }
          );
        }
      );
    });
    return;
  }
  
  db.run(
    `INSERT INTO product_groups (name, type, intervalWeeks, currentPrice, lowestPrice, highestPrice, targetPrice, tags, isRoutine, routineFrequency, routineQuantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name || 'New Group', type || 'watching', intervalWeeks || 4, null, null, null, targetPrice || null, tags || null, rFlag, rFreq, rQty],
    function(err) {
      if (err) return res.status(400).json({ error: err.message });
      const groupId = this.lastID;
      
      const items = itemsData || (urls ? urls.map(u => ({ url: u })) : []);
      let pendingInserts = items.length;
      
      if (pendingInserts === 0) {
        return res.json({ id: groupId });
      }

      items.forEach(item => {
        const detected = parseProductQuantity(item.name || name);
        const pQty = item.packQuantity || detected.packQuantity || 1;
        const vQty = item.volumeQuantity || detected.volumeQuantity || 1;
        const vUnit = item.volumeUnit || detected.volumeUnit || '';
        const unitPricingEnabled = (item.manualUnitPricing !== undefined || item.unitPricingEnabled !== undefined)
          ? (item.manualUnitPricing === 1 || item.manualUnitPricing === true || item.unitPricingEnabled === 1 || item.unitPricingEnabled === true)
          : Boolean(detected.unitPricingEnabled);
        
        db.run(`INSERT INTO items (group_id, url, name, currentPrice, rawPrice, shippingPrice, isPrime, lowestPrice, highestPrice, imageUrl, inStock, status, lastChecked, packQuantity, volumeQuantity, volumeUnit, manualUnitPricing, targetPrice, isRoutine, routineFrequency, routineQuantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [groupId, item.url, item.name, item.currentPrice, item.rawPrice != null ? item.rawPrice : item.currentPrice, item.shippingPrice || 0, item.isPrime ? 1 : 0, item.currentPrice, item.currentPrice, item.imageUrl, item.inStock || 'In Stock', 'OK', pQty, vQty, vUnit, unitPricingEnabled ? 1 : 0, targetPrice || null, rFlag, rFreq, rQty], 
          function(err) {
            if (!err) {
               const itemId = this.lastID;
               if (!item.currentPrice) {
                 db.get('SELECT * FROM items WHERE id = ?', [itemId], (err, dbItem) => {
                   if (dbItem) syncItem(dbItem);
                 });
               } else {
                 db.run(`INSERT INTO price_history (item_id, price) VALUES (?, ?)`, [itemId, item.currentPrice], () => {
                   updateGroupPrice(groupId);
                 });
               }
            }
            pendingInserts--;
            if (pendingInserts === 0) {
              updateGroupPrice(groupId);
            }
        });
      });
      
      res.json({ id: groupId });
      createBackup();
    }
  );
});

// API: Add new item (legacy, keeping for safety but not used in new flow)
app.post('/api/items', authenticateToken, (req, res) => {
  const { url, type, routineFrequency, routineQuantity } = req.body;
  log(`Adding new item to database: ${url}`);
  db.run(
    `INSERT INTO items (url, type, routineFrequency, routineQuantity) VALUES (?, ?, ?, ?)`,
    [url, type || 'watching', routineFrequency, routineQuantity || 1],
    function(err) {
      if (err) return res.status(400).json({ error: err.message });
      const newItemId = this.lastID;
      res.json({ id: newItemId });
      
      // Immediately trigger background sync for the new item
      db.get('SELECT * FROM items WHERE id = ?', [newItemId], (err, item) => {
        if (!err && item) {
          log(`Immediately syncing newly added item: ${item.url}`);
          syncItem(item);
        }
      });
    }
  );
});

// API: Delete an item (group)
app.delete('/api/items/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  log(`Deleting group ${id} from database`);
  db.all('SELECT id FROM items WHERE group_id = ?', [id], (err, items) => {
    const itemIds = items ? items.map(i => i.id) : [];
    if (itemIds.length > 0) {
      db.run(`DELETE FROM price_history WHERE item_id IN (${itemIds.join(',')})`);
      db.run(`DELETE FROM items WHERE group_id = ?`, [id]);
    }
    db.run(`DELETE FROM product_groups WHERE id = ?`, [id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// API: Get all items (groups)
app.get('/api/items', authenticateToken, (req, res) => {
  // Support optional sorting and tag filtering via query params:
  // ?sort=price|name|lastChecked|discount&tag=tools&order=asc|desc&onsale=1&saleThreshold=20
  const { sort, tag, order, onsale, saleThreshold, minHistory } = req.query;
  const orderBy = order && order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const salePct = saleThreshold ? Number(saleThreshold) : 20;
  const minHist = minHistory ? Number(minHistory) : 3;

  // Build base select that also computes average historical price and discount
  // Compute avgPrice only when there are at least `minHist` history rows for the group's items
  let baseQuery = `SELECT g.*, 
    COALESCE(g.lastChecked, (SELECT MAX(lastChecked) FROM items WHERE group_id = g.id)) as lastChecked,
    (SELECT imageUrl FROM items WHERE group_id = g.id LIMIT 1) as imageUrl, 
    (SELECT url FROM items WHERE group_id = g.id LIMIT 1) as url,
    (SELECT shippingPrice FROM items WHERE group_id = g.id AND currentPrice IS NOT NULL ORDER BY (currentPrice / COALESCE(packQuantity, 1)) ASC LIMIT 1) as shippingPrice,
    (SELECT isPrime FROM items WHERE group_id = g.id AND currentPrice IS NOT NULL ORDER BY (currentPrice / COALESCE(packQuantity, 1)) ASC LIMIT 1) as isPrime,
    (SELECT rawPrice FROM items WHERE group_id = g.id AND currentPrice IS NOT NULL ORDER BY (currentPrice / COALESCE(packQuantity, 1)) ASC LIMIT 1) as rawPrice,
    (SELECT usedPrice FROM items WHERE group_id = g.id AND usedPrice IS NOT NULL ORDER BY usedPrice ASC LIMIT 1) as usedPrice,
    (SELECT usedCondition FROM items WHERE group_id = g.id AND usedPrice IS NOT NULL ORDER BY usedPrice ASC LIMIT 1) as usedCondition,
    (SELECT usedSeller FROM items WHERE group_id = g.id AND usedPrice IS NOT NULL ORDER BY usedPrice ASC LIMIT 1) as usedSeller,
    CASE
      WHEN (SELECT COUNT(*) FROM items WHERE group_id = g.id) > 0
        AND (SELECT COUNT(*) FROM items WHERE group_id = g.id AND (inStock IS NULL OR inStock != 'Out of Stock')) = 0
      THEN 'Out of Stock'
      ELSE 'In Stock'
    END as inStock,
    CASE WHEN (SELECT COUNT(*) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id) >= ${minHist}
      THEN (SELECT AVG(p.price) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id)
      ELSE NULL END as avgPrice,
    CASE WHEN (CASE WHEN (SELECT COUNT(*) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id) >= ${minHist}
        THEN (SELECT AVG(p.price) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id)
        ELSE NULL END) IS NOT NULL AND g.currentPrice IS NOT NULL
      THEN (((CASE WHEN (SELECT COUNT(*) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id) >= ${minHist}
                THEN (SELECT AVG(p.price) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id)
                ELSE NULL END) - g.currentPrice) / (CASE WHEN (SELECT COUNT(*) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id) >= ${minHist}
                THEN (SELECT AVG(p.price) FROM price_history p JOIN items i ON p.item_id = i.id WHERE i.group_id = g.id)
                ELSE NULL END)) * 100
      ELSE 0 END as discount
    FROM product_groups g`;

  const params = [];

  if (tag) {
    // Join with items to filter groups that have at least one item with matching tag
    baseQuery = baseQuery.replace('FROM product_groups g', 'FROM product_groups g JOIN items i ON i.group_id = g.id');
    const tagValue = `%${tag.toLowerCase()}%`;
    baseQuery += ' WHERE LOWER(i.tags) LIKE ?';
    params.push(tagValue);
  }

  // Apply onsale filter (groups where discount >= salePct)
  if (onsale) {
    // Prefer the precomputed `isOnSale` flag for faster queries. Fall back
    // to discount computation if the column is not present.
    const clause = `g.isOnSale = 1`;
    baseQuery += tag ? ` AND ${clause}` : ` WHERE ${clause}`;
  }

  // Apply sorting
  if (sort) {
    if (sort === 'price') baseQuery += ` ORDER BY g.currentPrice ${orderBy}`;
    else if (sort === 'name') baseQuery += ` ORDER BY g.name ${orderBy}`;
    else if (sort === 'lastChecked') baseQuery += ` ORDER BY lastChecked ${orderBy}`;
    else if (sort === 'discount') baseQuery += ` ORDER BY discount ${orderBy}`;
  }

  db.all(baseQuery, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// API: Debug dump
app.get('/api/debug', (req, res) => {
  db.all('SELECT * FROM product_groups', [], (err, groups) => {
    db.all('SELECT * FROM items', [], (err2, items) => {
      res.json({ groups, items });
    });
  });
});

// API: Get a single item (group)
app.get('/api/items/:id', authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  console.log(`[API] GET /api/items/${id} called (raw param: "${req.params.id}")`);
  
  const groupQuery = `SELECT g.*, 
    COALESCE(g.lastChecked, (SELECT MAX(lastChecked) FROM items WHERE group_id = g.id)) as lastChecked, 
    (SELECT imageUrl FROM items WHERE group_id = g.id LIMIT 1) as imageUrl, 
    (SELECT url FROM items WHERE group_id = g.id LIMIT 1) as url,
    (SELECT shippingPrice FROM items WHERE group_id = g.id AND currentPrice IS NOT NULL ORDER BY (currentPrice / COALESCE(packQuantity, 1)) ASC LIMIT 1) as shippingPrice,
    (SELECT isPrime FROM items WHERE group_id = g.id AND currentPrice IS NOT NULL ORDER BY (currentPrice / COALESCE(packQuantity, 1)) ASC LIMIT 1) as isPrime,
    (SELECT rawPrice FROM items WHERE group_id = g.id AND currentPrice IS NOT NULL ORDER BY (currentPrice / COALESCE(packQuantity, 1)) ASC LIMIT 1) as rawPrice,
    (SELECT usedPrice FROM items WHERE group_id = g.id AND usedPrice IS NOT NULL ORDER BY usedPrice ASC LIMIT 1) as usedPrice,
    (SELECT usedCondition FROM items WHERE group_id = g.id AND usedPrice IS NOT NULL ORDER BY usedPrice ASC LIMIT 1) as usedCondition,
    (SELECT usedSeller FROM items WHERE group_id = g.id AND usedPrice IS NOT NULL ORDER BY usedPrice ASC LIMIT 1) as usedSeller
    FROM product_groups g WHERE g.id = ?`;
  
  const returnGroup = (groupId) => {
    db.get(groupQuery, [groupId], (err, row) => {
      if (err) {
        console.error(`[API] GET /api/items/${id} DB ERROR:`, err.message);
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        console.warn(`[API] GET /api/items/${id} GROUP ${groupId} NOT FOUND in product_groups`);
        return res.status(404).json({ error: 'Item not found' });
      }
      
      db.all('SELECT id, url, name, currentPrice, rawPrice, shippingPrice, isPrime, status, packQuantity, volumeQuantity, volumeUnit, manualUnitPricing as unitPricingEnabled, inStock, lastChecked, usedPrice, usedRawPrice, usedShippingPrice, usedIsPrime, usedCondition, usedConditionNote, usedSeller, usedOffers, trackCondition, variations, subscribePrice, subscribeSave, trackSubscribe FROM items WHERE group_id = ?', [groupId], (err, items) => {
        if (err) {
          console.error(`[API] GET /api/items/${id} (items) ERROR:`, err.message);
          return res.status(500).json({ error: err.message });
        }
        // Normalize item fields and unit pricing for frontend
        let bestSourceId = null;
        let lowestEffectiveUnitPrice = null;

        row.sources = (items || []).map(i => {
          const unitInfo = computeItemUnitPrice(i.currentPrice, i.packQuantity, i.volumeQuantity, i.volumeUnit, i.unitPricingEnabled);
          const effectiveUPrice = unitInfo.unitPrice != null ? unitInfo.unitPrice : i.currentPrice;

          // Only consider in-stock sources with valid prices for best value
          const isAvailable = i.currentPrice != null && i.inStock !== 'Out of Stock';
          if (isAvailable && effectiveUPrice != null && (lowestEffectiveUnitPrice === null || effectiveUPrice < lowestEffectiveUnitPrice)) {
            lowestEffectiveUnitPrice = effectiveUPrice;
            bestSourceId = i.id;
          }

          let parsedVariations = null;
          if (i.variations) {
            try { parsedVariations = JSON.parse(i.variations); } catch (e) { parsedVariations = null; }
          }

          return {
            id: i.id,
            url: i.url,
            name: i.name,
            currentPrice: i.currentPrice,
            rawPrice: i.rawPrice != null ? i.rawPrice : i.currentPrice,
            shippingPrice: i.shippingPrice || 0,
            isPrime: Boolean(i.isPrime),
            status: i.status,
            packQuantity: i.packQuantity,
            volumeQuantity: i.volumeQuantity,
            volumeUnit: i.volumeUnit,
            unitPricingEnabled: i.unitPricingEnabled,
            unitPrice: unitInfo.unitPrice,
            unitPriceDisplay: unitInfo.display,
            multiplier: unitInfo.multiplier,
            inStock: i.inStock || 'Unknown',
            lastChecked: i.lastChecked || null,
            variations: parsedVariations,
            usedPrice: i.usedPrice,
            usedRawPrice: i.usedRawPrice,
            usedCondition: i.usedCondition,
            usedConditionNote: i.usedConditionNote,
            usedSeller: i.usedSeller,
            usedOffers: i.usedOffers,
            trackCondition: i.trackCondition || 'any',
            subscribePrice: i.subscribePrice || null,
            subscribeSave: Boolean(i.subscribeSave),
            trackSubscribe: i.trackSubscribe || 'any'
          };
        });
        row.bestSourceId = bestSourceId;
        console.log(`[API] GET /api/items/${id} SUCCESS - group ${groupId}, name: "${row.name}", sources: ${row.sources.length}`);
        res.json(row);
      });
    });
  };
  
  // First try: look up as a group ID directly
  db.get('SELECT id FROM product_groups WHERE id = ?', [id], (err, group) => {
    if (group) {
      console.log(`[API] GET /api/items/${id} - found as group ID directly`);
      return returnGroup(id);
    }
    
    // Fallback: maybe the frontend passed an items-table ID instead of a group ID
    console.log(`[API] GET /api/items/${id} - not a group ID, checking items table as fallback...`);
    db.get('SELECT group_id FROM items WHERE id = ?', [id], (err, item) => {
      if (item && item.group_id) {
        console.log(`[API] GET /api/items/${id} - FALLBACK: found item ${id} belongs to group ${item.group_id}`);
        return returnGroup(item.group_id);
      }
      
      console.warn(`[API] GET /api/items/${id} - NOT FOUND in groups or items tables`);
      // Log what actually exists for debugging
      db.all('SELECT id FROM product_groups', [], (err, groups) => {
        console.log('[API] GET /api/items/ NOT FOUND. Current groups:', groups);
        res.status(404).json({ error: 'Item not found' });
      });
    });
  });
});

// API: Add a source URL or batch of source URLs to an existing group
app.post('/api/items/:id/sources', authenticateToken, (req, res) => {
  const groupId = Number(req.params.id);
  const { url, sources, packQuantity, volumeQuantity, volumeUnit, manualUnitPricing, unitPricingEnabled, trackCondition } = req.body;

  // Batch insert if sources array provided
  if (Array.isArray(sources) && sources.length > 0) {
    db.get('SELECT id FROM product_groups WHERE id = ?', [groupId], (err, group) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!group) return res.status(404).json({ error: 'Group not found' });

      let completed = 0;
      let insertedCount = 0;
      let hasError = false;

      sources.forEach(s => {
        const sUrl = s.url;
        if (!sUrl) {
          completed++;
          if (completed === sources.length && !hasError) {
            updateGroupPrice(groupId);
            createBackup();
            return res.json({ success: true, count: insertedCount });
          }
          return;
        }

        const detected = parseProductQuantity(s.name || '');
        const pQty = s.packQuantity || detected.packQuantity || 1;
        const vQty = s.volumeQuantity || detected.volumeQuantity || 1;
        const vUnit = s.volumeUnit || detected.volumeUnit || '';
        const enabled = (s.manualUnitPricing !== undefined || s.unitPricingEnabled !== undefined)
          ? Boolean(s.manualUnitPricing || s.unitPricingEnabled)
          : Boolean(detected.unitPricingEnabled);
        const cond = s.trackCondition || 'any';
        const curPrice = s.price != null ? parseFloat(s.price) : (s.currentPrice != null ? parseFloat(s.currentPrice) : null);

        db.run(
          `INSERT INTO items (group_id, url, name, currentPrice, rawPrice, shippingPrice, isPrime, lowestPrice, highestPrice, imageUrl, inStock, status, lastChecked, packQuantity, volumeQuantity, volumeUnit, manualUnitPricing, trackCondition) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)`,
          [groupId, sUrl, s.name || null, curPrice, curPrice, s.shippingPrice || 0, s.isPrime ? 1 : 0, curPrice, curPrice, s.imageUrl || null, s.inStock || 'In Stock', 'OK', pQty, vQty, vUnit, enabled ? 1 : 0, cond],
          function(insertErr) {
            if (!insertErr) {
              insertedCount++;
              const itemId = this.lastID;
              if (curPrice != null) {
                db.run(`INSERT INTO price_history (item_id, price) VALUES (?, ?)`, [itemId, curPrice], () => {
                  updateGroupPrice(groupId);
                });
              }
              // Always trigger sync in background to capture full variations and guarantee accurate pack alignment
              db.get('SELECT * FROM items WHERE id = ?', [itemId], (e, dbItem) => {
                if (dbItem) syncItem(dbItem);
              });
            }
            completed++;
            if (completed === sources.length && !hasError) {
              updateGroupPrice(groupId);
              createBackup();
              res.json({ success: true, count: insertedCount });
            }
          }
        );
      });
    });
    return;
  }

  // Single URL insertion
  if (!url) return res.status(400).json({ error: 'URL is required' });
  
  db.get('SELECT id, name FROM product_groups WHERE id = ?', [groupId], async (err, group) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    let targetPack = packQuantity ? Number(packQuantity) : null;
    if (!targetPack || targetPack <= 1) {
      const gQty = parseProductQuantity(group.name || '').packQuantity;
      if (gQty > 1) targetPack = gQty;
      else {
        const siblings = await new Promise(res => db.all('SELECT packQuantity FROM items WHERE group_id = ? AND packQuantity > 1', [groupId], (e, r) => res(r || [])));
        if (siblings.length > 0) targetPack = siblings[0].packQuantity;
      }
    }
    const pQty = targetPack || 1;
    const vQty = volumeQuantity || 1;
    const vUnit = volumeUnit || (pQty > 1 ? 'chew' : '');
    const enabled = manualUnitPricing !== undefined ? manualUnitPricing : (unitPricingEnabled !== undefined ? unitPricingEnabled : 1);
    const cond = trackCondition || 'any';
    
    db.run(`INSERT INTO items (group_id, url, packQuantity, volumeQuantity, volumeUnit, manualUnitPricing, trackCondition) VALUES (?, ?, ?, ?, ?, ?, ?)`, [groupId, url, pQty, vQty, vUnit, enabled ? 1 : 0, cond], function(insertErr) {
      if (insertErr) return res.status(500).json({ error: insertErr.message });
      const itemId = this.lastID;
      
      // Trigger sync for this new item immediately
      db.get('SELECT * FROM items WHERE id = ?', [itemId], (e, it) => {
        if (it) syncItem(it);
      });
      
      res.json({ success: true, id: itemId });
      createBackup();
    });
  });
});

// API: Rematch / scan competitor stores for an existing product group
app.post('/api/items/:id/rematch', authenticateToken, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'Valid item/group ID is required' });

  try {
    const group = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM product_groups WHERE id = ?', [groupId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!group) return res.status(404).json({ error: 'Product group not found' });

    const sources = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM items WHERE group_id = ?', [groupId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    if (sources.length === 0) {
      return res.status(400).json({ error: 'No tracked items found in this group to match against.' });
    }

    // Pick best URL to search with: preferred source from request, or first source with a valid URL
    const primarySource = sources.find(s => s.url && (s.url.includes('amazon') || s.url.includes('petcircle') || s.url.includes('chemistwarehouse') || s.url.includes('coles') || s.url.includes('woolworths'))) || sources[0];
    const matchUrl = req.body?.url || primarySource.url;

    log(`[Rematch] Scanning competitor stores for group ${groupId} ("${group.name}") using URL: ${matchUrl}`);
    const results = await findProductMatches(matchUrl);

    // Filter out alternatives whose URLs are already tracked in this group
    const existingUrls = new Set(sources.map(s => (s.url || '').toLowerCase().trim()));
    const newAlternatives = (results.alternatives || []).filter(alt => {
      if (!alt || !alt.url) return false;
      const lower = alt.url.toLowerCase().trim();
      return !existingUrls.has(lower);
    });

    res.json({
      groupName: group.name,
      primaryUrl: matchUrl,
      original: results.original,
      alternatives: newAlternatives,
      totalMatchesFound: (results.alternatives || []).length,
      existingSourcesCount: sources.length
    });
  } catch (err) {
    log(`[Rematch] Error scanning matches for group ${req.params.id}: ${err.message}`, 'ERROR');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/items/sources/:sourceId', authenticateToken, (req, res) => {
  const sourceId = Number(req.params.sourceId);
  const { packQuantity, volumeQuantity, volumeUnit, manualUnitPricing, unitPricingEnabled, trackCondition, trackSubscribe } = req.body;
  const pQty = packQuantity || 1;
  const vQty = volumeQuantity || 1;
  const vUnit = volumeUnit || '';
  const enabled = manualUnitPricing !== undefined ? manualUnitPricing : unitPricingEnabled;

  db.get('SELECT id, group_id, rawPrice, shippingPrice, isPrime, usedPrice, usedRawPrice, usedShippingPrice, usedIsPrime, trackCondition, trackSubscribe FROM items WHERE id = ?', [sourceId], (err, item) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!item) return res.status(404).json({ error: 'Source not found' });

    const newCond = trackCondition !== undefined ? trackCondition : (item.trackCondition || 'any');
    const newSub = trackSubscribe !== undefined ? trackSubscribe : (item.trackSubscribe || 'any');

    db.run(
      `UPDATE items SET packQuantity = ?, volumeQuantity = ?, volumeUnit = ?, manualUnitPricing = ?, trackCondition = ?, trackSubscribe = ? WHERE id = ?`,
      [pQty, vQty, vUnit, enabled ? 1 : 0, newCond, newSub, sourceId],
      async function(updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        
        // If trackCondition or trackSubscribe changed, re-sync this item so prices reflect the chosen condition immediately
        if ((trackCondition !== undefined && trackCondition !== item.trackCondition) || (trackSubscribe !== undefined && trackSubscribe !== item.trackSubscribe)) {
          db.get('SELECT * FROM items WHERE id = ?', [sourceId], (e, it) => {
            if (it) syncItem(it);
          });
        } else if (item.group_id) {
          await updateGroupPrice(item.group_id);
        }
        res.json({ success: true });
        createBackup();
      }
    );
  });
});

// API: Select a specific variation for a source
app.post('/api/items/sources/:sourceId/select-variation', authenticateToken, async (req, res) => {
  const sourceId = Number(req.params.sourceId);
  const { title, price, asin, url } = req.body;
  if (!sourceId || price == null) return res.status(400).json({ error: 'Valid source ID and price are required' });

  try {
    const item = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM items WHERE id = ?', [sourceId], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!item) return res.status(404).json({ error: 'Source not found' });

    const numPrice = parseFloat(price);
    const parsedQty = parseProductQuantity(title || item.name || '');
    const pQty = parsedQty.packQuantity || 1;
    const vQty = parsedQty.volumeQuantity || 1;
    const vUnit = parsedQty.volumeUnit || '';
    const enabled = parsedQty.unitPricingEnabled ? 1 : (item.manualUnitPricing || 0);
    const newName = title || item.name;
    const newUrl = url || item.url;

    const newLowest = (item.lowestPrice && item.lowestPrice >= numPrice * 0.5) ? Math.min(item.lowestPrice, numPrice) : numPrice;
    const newHighest = (item.highestPrice && item.highestPrice <= numPrice * 2) ? Math.max(item.highestPrice, numPrice) : numPrice;

    db.run(
      `UPDATE items SET name = ?, currentPrice = ?, rawPrice = ?, lowestPrice = ?, highestPrice = ?, packQuantity = ?, volumeQuantity = ?, volumeUnit = ?, manualUnitPricing = ?, url = ?, lastChecked = datetime('now') WHERE id = ?`,
      [newName, numPrice, numPrice, newLowest, newHighest, pQty, vQty, vUnit, enabled, newUrl, sourceId],
      async function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Clean up any historical price readings that belonged to a much smaller pack variant
        db.run(`UPDATE price_history SET price = ? WHERE item_id = ? AND price < ?`, [numPrice, sourceId, numPrice * 0.5], () => {
          db.run(`INSERT INTO price_history (item_id, price, timestamp) VALUES (?, ?, datetime('now'))`, [sourceId, numPrice], async () => {
            if (item.group_id) await updateGroupPrice(item.group_id);
            createBackup();
            res.json({ success: true, price: numPrice, packQuantity: pQty, volumeQuantity: vQty, volumeUnit: vUnit });
          });
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Batch price history for multiple groups (dashboard sparklines)
// POST /api/history/batch  body: { ids: [1,2,3], days: 30 }
app.post('/api/history/batch', authenticateToken, (req, res) => {
  const { ids, days = 30 } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.json({});

  const safeIds = ids.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (safeIds.length === 0) return res.json({});

  const placeholders = safeIds.map(() => '?').join(',');
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const query = `
    SELECT
      i.group_id,
      MIN(p.price) as price,
      date(p.timestamp) as day
    FROM price_history p
    JOIN items i ON p.item_id = i.id
    WHERE i.group_id IN (${placeholders})
      AND p.timestamp >= ?
    GROUP BY i.group_id, date(p.timestamp)
    ORDER BY i.group_id, day ASC
  `;

  db.all(query, [...safeIds, cutoff], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // Group by group_id -> array of { day, price }
    const result = {};
    for (const row of rows) {
      if (!result[row.group_id]) result[row.group_id] = [];
      result[row.group_id].push({ day: row.day, price: row.price });
    }
    res.json(result);
  });
});

// API: Get price history for an item (group)
app.get('/api/items/:id/history', authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  console.log(`[API] GET /api/items/${id}/history called`);
  
  const fetchHistory = (groupId) => {
    const query = `
      SELECT 
        p.id,
        p.item_id as itemId,
        p.price as price,
        p.price as rawPrice,
        (p.price / (CASE WHEN IFNULL(i.manualUnitPricing, 0) = 0 THEN 1 ELSE (IFNULL(i.packQuantity, 1) * IFNULL(i.volumeQuantity, 1)) END)) as unitPrice,
        p.timestamp,
        i.url,
        i.name as itemName
      FROM price_history p 
      JOIN items i ON p.item_id = i.id 
      WHERE i.group_id = ? OR (i.group_id IS NULL AND i.id = ?)
      ORDER BY p.timestamp ASC
    `;
    db.all(query, [groupId, groupId], (err, rows) => {
      if (err) {
        console.error(`[API] GET /api/items/${id}/history ERROR:`, err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`[API] GET /api/items/${id}/history SUCCESS (group ${groupId}), found ${rows.length} rows`);
      res.json(rows);
    });
  };
  
  // Check if it's a group ID first
  db.get('SELECT id FROM product_groups WHERE id = ?', [id], (err, group) => {
    if (group) return fetchHistory(id);
    
    // Fallback: resolve item ID to group ID
    db.get('SELECT group_id FROM items WHERE id = ?', [id], (err, item) => {
      if (item && item.group_id) {
        console.log(`[API] GET /api/items/${id}/history - FALLBACK: item ${id} -> group ${item.group_id}`);
        return fetchHistory(item.group_id);
      }
      // If nothing found, just try with the original ID (will return 0 rows)
      fetchHistory(id);
    });
  });
});

// Helper: Delete a single price history point and recalculate item & group stats
function deletePriceHistoryPoint(historyId, req, res) {
  const findQuery = `
    SELECT p.id, p.item_id, p.price, i.group_id 
    FROM price_history p 
    JOIN items i ON p.item_id = i.id 
    WHERE p.id = ?
  `;

  db.get(findQuery, [historyId], (findErr, entry) => {
    if (findErr) {
      log(`[Delete History] Error finding entry ${historyId}: ${findErr.message}`, 'ERROR');
      return res.status(500).json({ error: findErr.message });
    }
    if (!entry) {
      return res.status(404).json({ error: 'Price history point not found' });
    }

    const { item_id: itemId, group_id: groupId } = entry;

    db.run('DELETE FROM price_history WHERE id = ?', [historyId], function (delErr) {
      if (delErr) {
        log(`[Delete History] Error deleting entry ${historyId}: ${delErr.message}`, 'ERROR');
        return res.status(500).json({ error: delErr.message });
      }

      log(`[Delete History] Deleted price_history point ${historyId} for item ${itemId} (group ${groupId})`);

      // Recalculate lowestPrice, highestPrice, and currentPrice for this item
      db.all(
        'SELECT price, timestamp FROM price_history WHERE item_id = ? ORDER BY timestamp DESC',
        [itemId],
        async (qErr, rows) => {
          if (qErr) {
            log(`[Delete History] Error querying remaining history for item ${itemId}: ${qErr.message}`, 'ERROR');
          }

          const prices = (rows || []).map(r => r.price);
          const newLowest = prices.length ? Math.min(...prices) : null;
          const newHighest = prices.length ? Math.max(...prices) : null;
          const latestPrice = prices.length ? rows[0].price : null;

          db.run(
            'UPDATE items SET lowestPrice = ?, highestPrice = ?, currentPrice = ? WHERE id = ?',
            [newLowest, newHighest, latestPrice, itemId],
            async (updateItemErr) => {
              if (updateItemErr) {
                log(`[Delete History] Error updating item ${itemId} prices: ${updateItemErr.message}`, 'ERROR');
              }

              if (groupId) {
                const groupStatsQuery = `
                  SELECT 
                    MIN(p.price / (CASE WHEN IFNULL(i.manualUnitPricing, 0) = 0 THEN 1 ELSE (IFNULL(i.packQuantity, 1) * IFNULL(i.volumeQuantity, 1)) END)) as lowest,
                    MAX(p.price / (CASE WHEN IFNULL(i.manualUnitPricing, 0) = 0 THEN 1 ELSE (IFNULL(i.packQuantity, 1) * IFNULL(i.volumeQuantity, 1)) END)) as highest
                  FROM price_history p
                  JOIN items i ON p.item_id = i.id
                  WHERE i.group_id = ?
                `;
                db.get(groupStatsQuery, [groupId], async (statsErr, stats) => {
                  const groupLowest = (!statsErr && stats) ? stats.lowest : null;
                  const groupHighest = (!statsErr && stats) ? stats.highest : null;
                  db.run(
                    'UPDATE product_groups SET lowestPrice = ?, highestPrice = ? WHERE id = ?',
                    [groupLowest, groupHighest, groupId],
                    async () => {
                      await updateGroupPrice(groupId);
                      res.json({ success: true, message: 'Price history point deleted successfully' });
                    }
                  );
                });
              } else {
                res.json({ success: true, message: 'Price history point deleted successfully' });
              }
            }
          );
        }
      );
    });
  });
}

// API: Delete a single price history point
app.delete('/api/history/:id', authenticateToken, (req, res) => {
  const historyId = Number(req.params.id);
  if (!historyId) return res.status(400).json({ error: 'Invalid history ID' });
  deletePriceHistoryPoint(historyId, req, res);
});

// Also support RESTful nested route
app.delete('/api/items/:itemId/history/:id', authenticateToken, (req, res) => {
  const historyId = Number(req.params.id);
  if (!historyId) return res.status(400).json({ error: 'Invalid history ID' });
  deletePriceHistoryPoint(historyId, req, res);
});


// API: Update an item (group)
app.put('/api/items/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { isAutoBuy, notifyAbove, notifyBelow, notify, type, intervalWeeks, targetPrice, tags, routineFrequency, routineQuantity, isRoutine } = req.body;
  log(`Updating group ${id} settings`);
  const rFlag = isRoutine !== undefined ? (isRoutine ? 1 : 0) : (routineFrequency ? 1 : 0);
  const rFreq = routineFrequency !== undefined ? (routineFrequency || null) : null;
  const rQty = routineQuantity !== undefined ? Math.max(1, parseInt(routineQuantity, 10)) : 1;

  db.run(
    `UPDATE product_groups SET isAutoBuy = ?, notifyAbove = ?, notifyBelow = ?, notify = ?, type = ?, intervalWeeks = ?, targetPrice = ?, tags = ?, isRoutine = ?, routineFrequency = ?, routineQuantity = ? WHERE id = ?`,
    [isAutoBuy ? 1 : 0, notifyAbove, notifyBelow, notify ? 1 : 0, type, intervalWeeks, targetPrice || null, tags || null, rFlag, rFreq, rQty, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      db.run(`UPDATE items SET isRoutine = ?, routineFrequency = ?, routineQuantity = ? WHERE group_id = ?`, [rFlag, rFreq, rQty, id]);
      res.json({ success: true, isRoutine: Boolean(rFlag), routineFrequency: rFreq, routineQuantity: rQty });
    }
  );
});

async function updateGroupPrice(groupId) {
  return new Promise((resolve) => {
    db.get('SELECT * FROM product_groups WHERE id = ?', [groupId], (err, group) => {
      if (err || !group) return resolve();
      
      db.all('SELECT id, url, currentPrice, packQuantity, volumeQuantity, volumeUnit, manualUnitPricing, usedPrice, usedCondition, usedSeller FROM items WHERE group_id = ? AND (currentPrice IS NOT NULL OR usedPrice IS NOT NULL)', [groupId], (err, items) => {
        if (err || !items || items.length === 0) return resolve();
        
        const usedItems = items.filter(it => it.usedPrice != null);
        const minUsed = usedItems.length > 0
          ? usedItems.reduce((best, it) => (best === null || it.usedPrice < best.usedPrice ? it : best), null)
          : null;
        const bestUsedPrice = minUsed ? minUsed.usedPrice : null;
        const bestUsedCondition = minUsed ? minUsed.usedCondition : null;
        const bestUsedSeller = minUsed ? minUsed.usedSeller : null;

        const pricedItems = items.filter(it => it.currentPrice != null).map(item => {
          const unitInfo = computeItemUnitPrice(item.currentPrice, item.packQuantity, item.volumeQuantity, item.volumeUnit, isUnitPricingEnabled(item));
          return {
            item,
            unitInfo,
            unitPrice: unitInfo.unitPrice != null ? unitInfo.unitPrice : item.currentPrice
          };
        });
        const minEntry = pricedItems.length > 0 ? pricedItems.reduce((best, entry) => (best === null || entry.unitPrice < best.unitPrice ? entry : best), null) : null;
        const winningItem = minEntry ? minEntry.item : null;
        const bestPurchasePrice = winningItem ? winningItem.currentPrice : (bestUsedPrice || null);
        const bestUnitPrice = minEntry ? minEntry.unitPrice : null;
        const bestUnitPriceDisplay = minEntry?.unitInfo?.display || null;
        const productUrl = winningItem ? winningItem.url : null;
        const purchaseUrl = productUrl ? buildAmazonCartLink(productUrl) : null;
        
        const lowest = group.lowestPrice ? Math.min(group.lowestPrice, bestPurchasePrice) : bestPurchasePrice;
        const highest = group.highestPrice ? Math.max(group.highestPrice, bestPurchasePrice) : bestPurchasePrice;
        
        // Compute 30-day and all-time average price stats for the group (standardized by unit multiplier)
        db.get(
          `SELECT 
            COUNT(p.price) as cnt,
            AVG(p.price / (CASE WHEN IFNULL(i.manualUnitPricing,0)=0 THEN 1 ELSE (IFNULL(i.packQuantity,1)*IFNULL(i.volumeQuantity,1)) END)) as avgPrice,
            COUNT(CASE WHEN p.timestamp >= datetime('now', '-30 days') THEN 1 END) as cnt30d,
            AVG(CASE WHEN p.timestamp >= datetime('now', '-30 days') THEN (p.price / (CASE WHEN IFNULL(i.manualUnitPricing,0)=0 THEN 1 ELSE (IFNULL(i.packQuantity,1)*IFNULL(i.volumeQuantity,1)) END)) END) as avgPrice30d
          FROM price_history p 
          JOIN items i ON p.item_id = i.id 
          WHERE i.group_id = ?`,
          [groupId],
          (err2, stats) => {
            const minHist = process.env.DEFAULT_MIN_HISTORY ? Number(process.env.DEFAULT_MIN_HISTORY) : 3;
            stats = stats || {};

            // Prioritize the 30-day average price if sufficient history exists; fall back to all-time average
            const baselineAvg = (stats.cnt30d >= minHist && stats.avgPrice30d != null)
              ? stats.avgPrice30d
              : (stats.cnt >= minHist && stats.avgPrice != null ? stats.avgPrice : null);

            let discountPct = null;
            let isOnSaleFlag = 0;
            if (baselineAvg != null && bestUnitPrice != null) {
              discountPct = Math.round(((baselineAvg - bestUnitPrice) / baselineAvg) * 1000) / 10;
              const defaultThreshold = process.env.DEFAULT_SALE_THRESHOLD ? Number(process.env.DEFAULT_SALE_THRESHOLD) : 20;
              if (discountPct >= defaultThreshold) {
                isOnSaleFlag = 1;
              }
            }

            if (group.notify && group.currentPrice && bestPurchasePrice != null) {
              let alertMessage = null;
              let alertSubject = `StockSense Alert: ${group.name.substring(0, 25)}`;
              const displayPriceStr = `$${bestPurchasePrice.toFixed(2)}${bestUnitPriceDisplay ? ` (${bestUnitPriceDisplay})` : ''}`;

              if (group.notifyAbove && bestPurchasePrice >= group.notifyAbove && group.currentPrice < group.notifyAbove) {
                alertSubject = `📈 Price Spike: ${group.name.substring(0, 25)}`;
                alertMessage = `PRICE SPIKE ALERT! ${group.name} just jumped to ${displayPriceStr}${baselineAvg != null ? ` (30d avg unit: $${baselineAvg.toFixed(2)})` : ''}.`;
              } else if (group.notifyBelow && bestPurchasePrice <= group.notifyBelow && group.currentPrice > group.notifyBelow) {
                alertSubject = `🎯 Target Price Met: ${group.name.substring(0, 25)}`;
                alertMessage = `PRICE DROP ALERT! ${group.name} is now ${displayPriceStr}${baselineAvg != null ? ` (30d avg unit: $${baselineAvg.toFixed(2)})` : ''}. Target of $${group.notifyBelow.toFixed(2)} reached. Buy now!`;
              } else if (baselineAvg != null && bestUnitPrice <= baselineAvg * 0.5 && (group.unitPrice ? group.unitPrice > bestUnitPrice : group.currentPrice > bestPurchasePrice)) {
                // Drop is 50%+ below the 30-day average price (prevents false alerts when a price doubles and returns to normal)
                alertSubject = `🔥 50%+ Massive Drop: ${group.name.substring(0, 25)}`;
                alertMessage = `MASSIVE 50%+ DROP! ${group.name} dropped to ${displayPriceStr} (30d avg unit: $${baselineAvg.toFixed(2)}, saving ${discountPct}%). Buy now!`;
              }

              if (alertMessage) {
                log(`Triggering alert: ${alertMessage}`);
                sendAlert(alertSubject, alertMessage, {
                  productUrl,
                  purchaseUrl,
                  currentPrice: bestPurchasePrice,
                  avgPrice30d: baselineAvg,
                  discountPct,
                  usedPrice: bestUsedPrice,
                  usedCondition: bestUsedCondition
                });

                // If this is an extreme drop (>80% from baseline 30-day average), create snapshot
                try {
                  if (baselineAvg != null && bestUnitPrice <= baselineAvg * 0.2) {
                    createDropSnapshot(group, minEntry, pricedItems, baselineAvg, bestUnitPrice);
                  }
                } catch (e) {
                  log(`Failed to create drop snapshot: ${e.message}`, 'ERROR');
                }
              }
            }

            db.run(
              `UPDATE product_groups SET currentPrice = ?, lowestPrice = ?, highestPrice = ?, unitPrice = ?, unitPriceDisplay = ?, lastChecked = datetime('now'), status = 'OK', isOnSale = ?, usedPrice = ?, usedCondition = ?, usedSeller = ? WHERE id = ?`,
              [bestPurchasePrice, lowest, highest, bestUnitPrice, bestUnitPriceDisplay, isOnSaleFlag, bestUsedPrice, bestUsedCondition, bestUsedSeller, groupId],
              () => resolve()
            );
          }
        );
      });
    });
  });
}

// Utility: include lastChecked and better status info when returning a group
function enrichGroupRow(row) {
  if (!row) return row;
  // Ensure lastChecked exists (may be null)
  row.lastChecked = row.lastChecked || null;
  return row;
}

// Background Cron: Sync all prices at 9am and 5pm
cron.schedule('0 9,17 * * *', () => {
  log('[CRON] Starting scheduled price sync for all items (9am / 5pm)...');
  db.all('SELECT * FROM items', [], async (err, items) => {
    if (err) return log(`[CRON] DB error: ${err.message}`, 'ERROR');
    global.taskStatus = `Scheduled sync: Updating ${items.length} items...`;
    for (const item of items) {
      await syncItem(item);
    }
    global.taskStatus = '';
    log('[CRON] Scheduled price sync completed.');
  });
});

// Background Cron: Scraper Health Canary Check daily at noon
cron.schedule('0 12 * * *', async () => {
  log('[CRON] Running daily scraper health canary probe across all retailers...');
  try {
    await runCanaryProbe();
    log('[CRON] Daily scraper health probe completed.');
  } catch (e) {
    log(`[CRON] Scraper health probe failed: ${e.message}`, 'ERROR');
  }
});

// If a group still has a placeholder name (e.g. from the quick-add bookmarklet),
// adopt the real product name once we've scraped it.
function updateGroupNameIfPlaceholder(groupId, name) {
  if (!groupId || !name) return;
  db.get('SELECT name FROM product_groups WHERE id = ?', [groupId], (err, row) => {
    if (err || !row || !row.name) return;
    if (/^(New Group|Amazon item|Coles item|Woolworths item|Chemist Warehouse item|New item)/i.test(row.name.trim())) {
      db.run('UPDATE product_groups SET name = ? WHERE id = ?', [name, groupId]);
    }
  });
}

// Sync logic
async function syncItem(item) {
  let result = null;
  let scrapeError = null;
  let groupTargetPack = item.packQuantity > 1 ? item.packQuantity : null;

  try {
    const settings = await new Promise((resolve) => {
      db.get('SELECT latitude, longitude, hasAmazonPrime FROM settings WHERE id = 1', (err, row) => resolve(row || { latitude: -33.8688, longitude: 151.2093, hasAmazonPrime: 0 }));
    });

    try {
      if (!groupTargetPack && item.group_id) {
        try {
          const groupRow = await new Promise(res => db.get('SELECT name FROM product_groups WHERE id = ?', [item.group_id], (e, r) => res(r)));
          if (groupRow && groupRow.name) {
            const parsedG = parseProductQuantity(groupRow.name);
            if (parsedG.packQuantity > 1) groupTargetPack = parsedG.packQuantity;
          }
          if (!groupTargetPack) {
            const siblings = await new Promise(res => db.all('SELECT packQuantity FROM items WHERE group_id = ? AND id != ? AND packQuantity > 1', [item.group_id, item.id], (e, r) => res(r || [])));
            for (const s of siblings) {
              if (s.packQuantity && s.packQuantity > 1) {
                groupTargetPack = s.packQuantity;
                break;
              }
            }
          }
        } catch (e) {}
      }

      if (item.url.includes('coles.com.au') || item.url.includes('woolworths.com.au') || item.url.includes('iga.com.au')) {
        result = await scrapeSupermarket(item.url, settings.latitude, settings.longitude);
      } else if (item.url.includes('amazon')) {
        result = await scrapeAmazon(item.url);
      } else if (item.url.includes('chemistwarehouse.com.au')) {
        result = await scrapeChemistWarehouse(item.url);
      } else if (item.url.includes('petcircle.com.au')) {
        result = await scrapePetCircle(item.url);
      } else if (item.url.includes('ozbargain.com.au')) {
        result = await scrapeOzBargain(item.url);
      } else if (detectRetailer(item.url)) {
        result = await scrapeRetailer(item.url, groupTargetPack);
      }
    } catch (err) {
      scrapeError = err;
      log(`[SyncItem] Scrape exception for ${item.url}: ${err.message}`, 'ERROR');
    }

    // Record scraper health metrics & trigger alert if broken
    const isSuccess = !!(result && (result.price !== null || result.usedPrice !== null || result.inStock === 'Out of Stock'));
    await recordScrapeResult(item.url, isSuccess, {
      url: item.url,
      price: result?.price || result?.usedPrice,
      error: scrapeError || (result && result.price == null && result.usedPrice == null && result.inStock !== 'Out of Stock' ? new Error('No price extracted from page') : new Error('Empty scraper response'))
    });

    if (result && (result.price !== null || result.usedPrice !== null)) {
      const now = new Date().toISOString();
      const rawPrice = result.rawPrice != null ? result.rawPrice : result.price;
      const shippingPrice = result.shippingPrice || 0;
      const isPrime = Boolean(result.isPrime);
      // Subscription / Repeat Delivery preference: 'any' (default lowest), 'standard', 'subscribe_only'
      const trackSub = item.trackSubscribe || 'any';
      const hasSubDiscount = Boolean(result.subscribeSave && result.subscribePrice && result.subscribePrice < rawPrice);
      let effectiveBase = rawPrice;
      if (trackSub === 'subscribe_only' && result.subscribePrice != null) {
        effectiveBase = result.subscribePrice;
      } else if (trackSub === 'standard') {
        effectiveBase = rawPrice;
      } else {
        // 'any': prefer subscription discount if available and cheaper
        effectiveBase = hasSubDiscount ? result.subscribePrice : rawPrice;
      }
      const effectiveNewPrice = effectiveBase != null ? computeEffectivePrice(effectiveBase, shippingPrice, isPrime, Boolean(settings.hasAmazonPrime)) : null;

      // Used / Resale price calculation
      const usedRawPrice = result.usedRawPrice != null ? result.usedRawPrice : result.usedPrice;
      const usedShippingPrice = result.usedShippingPrice || 0;
      const usedIsPrime = Boolean(result.usedIsPrime);
      const effectiveUsedPrice = usedRawPrice != null ? computeEffectivePrice(usedRawPrice, usedShippingPrice, usedIsPrime, Boolean(settings.hasAmazonPrime)) : null;
      const usedCondition = result.usedCondition || null;
      const usedConditionNote = result.usedConditionNote || null;
      const usedSeller = result.usedSeller || null;
      const usedOffersJson = (result.usedOffers && result.usedOffers.length > 0) ? JSON.stringify(result.usedOffers) : null;

      // Condition preference: 'any' (default lowest), 'new_only', 'used_only'
      const trackCond = item.trackCondition || 'any';
      let effectivePrice = null;
      let finalRawPrice = rawPrice;
      let finalShippingPrice = shippingPrice;
      let finalIsPrime = isPrime;

      if (trackCond === 'new_only') {
        effectivePrice = effectiveNewPrice;
      } else if (trackCond === 'used_only') {
        effectivePrice = effectiveUsedPrice;
        if (effectiveUsedPrice != null) {
          finalRawPrice = usedRawPrice;
          finalShippingPrice = usedShippingPrice;
          finalIsPrime = usedIsPrime;
        }
      } else {
        // 'any' condition: prefer the cheaper of new and used
        if (effectiveNewPrice != null && effectiveUsedPrice != null) {
          if (effectiveUsedPrice < effectiveNewPrice) {
            effectivePrice = effectiveUsedPrice;
            finalRawPrice = usedRawPrice;
            finalShippingPrice = usedShippingPrice;
            finalIsPrime = usedIsPrime;
          } else {
            effectivePrice = effectiveNewPrice;
          }
        } else if (effectiveUsedPrice != null) {
          effectivePrice = effectiveUsedPrice;
          finalRawPrice = usedRawPrice;
          finalShippingPrice = usedShippingPrice;
          finalIsPrime = usedIsPrime;
        } else {
          effectivePrice = effectiveNewPrice;
        }
      }

      // Auto-detect quantities if not manually configured or if misparsed animal weight
      let pQty = item.packQuantity;
      let vQty = item.volumeQuantity;
      let vUnit = item.volumeUnit;
      let manualUnitPricing = item.manualUnitPricing;

      const hasAnimalWeightMisparse = vUnit === 'kg' && vQty >= 10 && /\b(chews?|spectra|nexgard|bravecto|flea|worm|dog)\b/i.test(item.name || result.name || '');

      if (!manualUnitPricing || hasAnimalWeightMisparse || (!pQty || (pQty === 1 && (!vUnit || vUnit === '')))) {
        const detected = (result.packQuantity > 1 || (result.volumeUnit && result.volumeUnit !== 'kg'))
          ? result
          : parseProductQuantity(result.name || item.name || '');
        if (detected && (detected.packQuantity > 1 || detected.volumeUnit)) {
          pQty = detected.packQuantity || 1;
          vQty = detected.volumeQuantity || 1;
          vUnit = detected.volumeUnit || '';
          manualUnitPricing = detected.unitPricingEnabled ? 1 : 0;
        }
      }

      // Align variation to match group pack size or item pack size
      const targetPack = groupTargetPack || (pQty > 1 ? pQty : null);
      if (targetPack && result.variations?.allVariations?.length > 1) {
        const matchedVar = result.variations.allVariations.find(v => parseProductQuantity(v.title || '').packQuantity === targetPack);
        if (matchedVar && matchedVar.price != null) {
          if (effectivePrice !== matchedVar.price || pQty !== targetPack) {
            log(`[syncItem] Aligning variation for item ${item.id} to ${targetPack}-pack: "${matchedVar.title}" at $${matchedVar.price} (was $${effectivePrice})`);
            effectivePrice = matchedVar.price;
            finalRawPrice = matchedVar.price;
            pQty = targetPack;
            vQty = 1;
            vUnit = 'chew';
            result.name = matchedVar.title;
          }
        }
      }

      const variationsJson = result.variations ? JSON.stringify(result.variations) : (item.variations || null);

      // --- Outlier guard ---
      // Fetch recent price history and compute median. If the new price is an
      // extreme statistical outlier (< 15% or > 10× the median), it is almost
      // certainly a bad parse (e.g. $0.30 coupon element, garbled number).
      // Skip writing it to avoid poisoning the price graph and triggering
      // false alerts. We only activate the guard once there are ≥ 3 readings
      // so that legitimate first-time prices are never accidentally blocked.
      const recentRows = await new Promise(resolve =>
        db.all(
          'SELECT price FROM price_history WHERE item_id = ? ORDER BY timestamp DESC LIMIT 10',
          [item.id],
          (err, rows) => resolve(err ? [] : (rows || []))
        )
      );

      let isOutlier = false;
      if (recentRows.length >= 3) {
        const sorted = recentRows.map(r => r.price).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
        if (effectivePrice < median * 0.15) {
          log(`[Outlier] Skipping suspicious LOW price $${effectivePrice.toFixed(2)} for item ${item.id} (median: $${median.toFixed(2)}). Likely a bad parse.`, 'WARN');
          isOutlier = true;
        } else if (effectivePrice > median * 10) {
          log(`[Outlier] Skipping suspicious HIGH price $${effectivePrice.toFixed(2)} for item ${item.id} (median: $${median.toFixed(2)}). Likely a bad parse.`, 'WARN');
          isOutlier = true;
        }
      }

      if (isOutlier) {
        // Don't update currentPrice or history — just refresh name/image/stock, variations and used fields.
        db.run(
          `UPDATE items SET name = ?, inStock = ?, imageUrl = ?, lastChecked = ?, status = 'OK', subscribePrice = ?, subscribeSave = ?, isOnSale = 0, packQuantity = COALESCE(packQuantity, ?), volumeQuantity = COALESCE(volumeQuantity, ?), volumeUnit = COALESCE(volumeUnit, ?), variations = COALESCE(?, variations), usedPrice = ?, usedRawPrice = ?, usedShippingPrice = ?, usedIsPrime = ?, usedCondition = ?, usedConditionNote = ?, usedSeller = ?, usedOffers = ? WHERE id = ?`,
          [result.name, result.inStock, result.imageUrl, now, result.subscribePrice || null, result.subscribeSave ? 1 : 0, pQty || 1, vQty || 1, vUnit || '', variationsJson, effectiveUsedPrice, usedRawPrice, usedShippingPrice, usedIsPrime ? 1 : 0, usedCondition, usedConditionNote, usedSeller, usedOffersJson, item.id],
          () => { if (item.group_id) updateGroupPrice(item.group_id); }
        );
      } else {
        const lowest = item.lowestPrice ? Math.min(item.lowestPrice, effectivePrice) : effectivePrice;
        const highest = item.highestPrice ? Math.max(item.highestPrice, effectivePrice) : effectivePrice;

        db.run(
          `UPDATE items SET name = ?, currentPrice = ?, rawPrice = ?, shippingPrice = ?, isPrime = ?, lowestPrice = ?, highestPrice = ?, inStock = ?, imageUrl = ?, lastChecked = ?, status = 'OK', subscribePrice = ?, subscribeSave = ?, packQuantity = ?, volumeQuantity = ?, volumeUnit = ?, manualUnitPricing = ?, variations = COALESCE(?, variations), usedPrice = ?, usedRawPrice = ?, usedShippingPrice = ?, usedIsPrime = ?, usedCondition = ?, usedConditionNote = ?, usedSeller = ?, usedOffers = ? WHERE id = ?`,
          [result.name, effectivePrice, finalRawPrice, finalShippingPrice, finalIsPrime ? 1 : 0, lowest, highest, result.inStock, result.imageUrl, now, result.subscribePrice || null, result.subscribeSave ? 1 : 0, pQty || 1, vQty || 1, vUnit || '', manualUnitPricing ? 1 : 0, variationsJson, effectiveUsedPrice, usedRawPrice, usedShippingPrice, usedIsPrime ? 1 : 0, usedCondition, usedConditionNote, usedSeller, usedOffersJson, item.id],
          () => {
            if (item.group_id) updateGroupPrice(item.group_id);
          }
        );

        db.run(`INSERT INTO price_history (item_id, price, timestamp) VALUES (?, ?, ?)`, [item.id, effectivePrice, now], () => {
          // After inserting price history, compute item-level average and
          // set the `isOnSale` flag if the current price is sufficiently
          // below the recent average.
          const minHist = process.env.DEFAULT_MIN_HISTORY ? Number(process.env.DEFAULT_MIN_HISTORY) : 3;
          const saleThreshold = process.env.DEFAULT_SALE_THRESHOLD ? Number(process.env.DEFAULT_SALE_THRESHOLD) : 20;
          db.get(`SELECT COUNT(price) as cnt, AVG(price) as avgPrice FROM price_history WHERE item_id = ?`, [item.id], (err2, stats) => {
            try {
              let itemOnSale = 0;
              if (!err2 && stats && stats.cnt >= minHist && stats.avgPrice && effectivePrice != null) {
                const avg = stats.avgPrice;
                const discountPct = ((avg - effectivePrice) / avg) * 100;
                if (discountPct >= saleThreshold) itemOnSale = 1;
              }
              db.run(`UPDATE items SET isOnSale = ? WHERE id = ?`, [itemOnSale, item.id]);
            } catch (e) {
              log(`Failed to compute item isOnSale: ${e.message}`, 'ERROR');
            }
          });
        });
      }
    } else if (result && result.inStock === 'Out of Stock') {
      // Out-of-stock item: record the unavailable state and clear the price so
      // we don't keep showing a stale/wrong price.
      db.run(
        `UPDATE items SET name = ?, currentPrice = NULL, inStock = ?, imageUrl = ?, lastChecked = ?, status = 'Out of Stock', subscribePrice = ?, subscribeSave = ?, isOnSale = 0 WHERE id = ?`,
        [result.name, result.inStock, result.imageUrl, new Date().toISOString(), result.subscribePrice || null, result.subscribeSave ? 1 : 0, item.id],
        () => {
          if (item.group_id) updateGroupPrice(item.group_id);
        }
      );
    } else {
      db.run(`UPDATE items SET status = '❌ No Price', isOnSale = 0 WHERE id = ?`, [item.id]);
    }

    // Quick-add bookmarklet creates groups with a placeholder name; once we've
    // scraped the real product name, adopt it for the group too.
    if (result && result.name) {
      updateGroupNameIfPlaceholder(item.group_id, result.name);
    }
  } catch (err) {
    log(`[syncItem] Critical error processing item ${item.id} (${item.url}): ${err.message}`, 'ERROR');
    db.run(`UPDATE items SET status = '❌ Error' WHERE id = ?`, [item.id]);
  }
}

// API: Trigger sync
app.post('/api/sync', authenticateToken, (req, res) => {
  db.all('SELECT * FROM items', [], async (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Sync started' });
    for (const item of items) {
      await syncItem(item);
    }
  });
});

// API: Reset and refresh group
app.post('/api/groups/:id/reset', authenticateToken, (req, res) => {
  const groupId = Number(req.params.id);
  db.run(`UPDATE product_groups SET currentPrice = NULL, lowestPrice = NULL, highestPrice = NULL, lastChecked = NULL WHERE id = ?`, [groupId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.run(`UPDATE items SET currentPrice = NULL, lowestPrice = NULL, highestPrice = NULL WHERE group_id = ?`, [groupId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      db.run(`DELETE FROM price_history WHERE item_id IN (SELECT id FROM items WHERE group_id = ?)`, [groupId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Asynchronously sync all items in group
        db.all('SELECT * FROM items WHERE group_id = ?', [groupId], async (err, items) => {
          if (!err && items) {
            for (const item of items) {
              await syncItem(item);
            }
          }
        });
        
        res.json({ success: true, message: 'Group history wiped and sync started' });
      });
    });
  });
});

// API: Purge outlier price history entries for a group
// POST /api/groups/:id/purge-outliers
// Removes existing price_history rows that are statistical outliers (< 15% or
// > 10× the median), then recalculates lowestPrice / highestPrice from the
// cleaned data. Returns { removed, remaining } counts.
app.post('/api/groups/:id/purge-outliers', authenticateToken, async (req, res) => {
  const groupId = Number(req.params.id);

  // Helper: compute median of a numeric array
  const median = arr => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  try {
    // Gather all item IDs in the group
    const items = await new Promise((resolve, reject) =>
      db.all('SELECT id FROM items WHERE group_id = ?', [groupId], (err, rows) =>
        err ? reject(err) : resolve(rows || [])
      )
    );
    if (!items.length) return res.json({ removed: 0, remaining: 0 });

    let totalRemoved = 0;
    let totalRemaining = 0;

    for (const { id: itemId } of items) {
      // Load all history rows for this item
      const rows = await new Promise((resolve, reject) =>
        db.all(
          'SELECT id, price FROM price_history WHERE item_id = ? ORDER BY timestamp ASC',
          [itemId],
          (err, r) => err ? reject(err) : resolve(r || [])
        )
      );
      if (rows.length < 3) {
        totalRemaining += rows.length;
        continue; // Not enough data to detect outliers safely
      }

      const prices = rows.map(r => r.price);
      const med = median(prices);
      const badIds = rows
        .filter(r => r.price < med * 0.15 || r.price > med * 10)
        .map(r => r.id);

      if (badIds.length > 0) {
        await new Promise((resolve, reject) =>
          db.run(
            `DELETE FROM price_history WHERE id IN (${badIds.map(() => '?').join(',')})`,
            badIds,
            err => err ? reject(err) : resolve()
          )
        );
        log(`[Purge] Removed ${badIds.length} outlier price entries for item ${itemId} (median: $${med.toFixed(2)})`);
      }

      totalRemoved += badIds.length;
      totalRemaining += rows.length - badIds.length;
    }

    // Recalculate lowestPrice / highestPrice for each item from clean data
    for (const { id: itemId } of items) {
      const cleanRows = await new Promise(resolve =>
        db.all('SELECT price FROM price_history WHERE item_id = ?', [itemId], (err, r) => resolve(r || []))
      );
      if (!cleanRows.length) continue;
      const cleanPrices = cleanRows.map(r => r.price);
      const newLowest = Math.min(...cleanPrices);
      const newHighest = Math.max(...cleanPrices);
      await new Promise(resolve =>
        db.run(
          'UPDATE items SET lowestPrice = ?, highestPrice = ? WHERE id = ?',
          [newLowest, newHighest, itemId],
          () => resolve()
        )
      );
    }

    // Refresh group aggregate prices too
    await updateGroupPrice(groupId);

    log(`[Purge] Outlier purge for group ${groupId}: removed ${totalRemoved}, remaining ${totalRemaining}`);
    res.json({ removed: totalRemoved, remaining: totalRemaining });
  } catch (err) {
    log(`[Purge] Error purging outliers for group ${groupId}: ${err.message}`, 'ERROR');
    res.status(500).json({ error: err.message });
  }
});


// Cron: Daily Digest at 8 AM
cron.schedule('0 8 * * *', () => {
  log('Checking for digest emails...');
  db.get('SELECT * FROM settings WHERE id = 1', (err, settings) => {
    if (err || !settings || !settings.globalNotify) return;
    
    const today = new Date().getDay(); // 0 = Sunday, 1 = Monday
    const isWeeklyDay = (today === 1); // Monday is weekly digest day
    
    if (settings.digestFrequency === 'weekly' && !isWeeklyDay) return;
    
    db.all("SELECT * FROM items WHERE type = 'autodeliver' AND notify = 1", [], async (err, items) => {
      if (err || items.length === 0) return;
      
      let message = `Here is your ${settings.digestFrequency} digest for Auto-Deliver items:\n\n`;
      for (const item of items) {
        const avgRow = await new Promise(res => {
          db.get(
            `SELECT AVG(price) as avg30d FROM price_history WHERE item_id = ? AND timestamp >= datetime('now', '-30 days')`,
            [item.id],
            (e, r) => res(r || null)
          );
        });
        const avgStr = avgRow && avgRow.avg30d != null ? ` | 30d Avg: $${avgRow.avg30d.toFixed(2)}` : '';
        message += `- ${item.name}\n  Current Price: $${item.currentPrice?.toFixed(2) || '--'}${avgStr} (Interval: ${item.intervalWeeks} wks)\n\n`;
      }
      
      sendAlert(`StockSense ${settings.digestFrequency.toUpperCase()} Digest`, message);
    });
  });
});

// Cron: Weekly Catalogue Cycle Reminder on Tuesday 6 PM (Supermarket catalogues launch Wednesday)
cron.schedule('0 18 * * 2', () => {
  log('[CRON] Sending Tuesday catalogue cycle reminder...');
  sendAlert(
    '🛒 Coles & Woolies Half-Price Specials Launch Tomorrow!',
    'Friendly reminder: Australian supermarket catalogue specials and half-price discounts update overnight tonight (Wednesday morning). Check your StockSense shopping list tomorrow morning to capture the best weekly bargains!'
  );
});

// Cron: Weekly Database Auto-Vacuum and Cleanup (Sundays 3 AM)
cron.schedule('0 3 * * 0', () => {
  log('[CRON] Running weekly database VACUUM and optimization...');
  db.run('VACUUM;', (err) => {
    if (err) log(`[CRON] Weekly VACUUM error: ${err.message}`, 'ERROR');
    else log('[CRON] Weekly database VACUUM completed successfully.');
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('  StockSense Backend Started Successfully!');
  console.log(`  Port: ${PORT}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`  Node: ${process.version} | PID: ${process.pid}`);
  console.log('====================================================');

  // Auto-recover any items stuck in '❌ Error' from previous crash
  setTimeout(() => {
    db.all(`SELECT * FROM items WHERE status = '❌ Error' OR status = 'Pending'`, [], async (err, errorItems) => {
      if (!err && errorItems && errorItems.length > 0) {
        log(`[Startup] Auto-recovering ${errorItems.length} items stuck in error/pending status...`);
        for (const it of errorItems) {
          await syncItem(it);
        }
      }
    });
  }, 5000);
});

function createBackup() {
  const backupPath = path.resolve(__dirname, 'data', 'database.backup.sqlite');
  if (fs.existsSync(backupPath)) {
    try { fs.unlinkSync(backupPath); } catch (e) {}
  }
  db.run(`VACUUM INTO ?`, [backupPath], (err) => {
    if (err) console.error('[Backup] Failed to create backup:', err);
    else console.log('[Backup] Successfully created database backup.');
  });
}

function ensureSnapshotsDir() {
  const dir = path.join(__dirname, 'data', 'snapshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createDropSnapshot(group, minEntry, pricedItems, baselinePrice, minPrice) {
  try {
    const dir = ensureSnapshotsDir();
    const timestamp = new Date().toISOString();
    const snapshot = {
      timestamp,
      group: {
        id: group.id,
        name: group.name,
        currentPrice: group.currentPrice,
        lowestPrice: group.lowestPrice,
        highestPrice: group.highestPrice
      },
      detected: {
        minPrice,
        baselinePrice,
        dropPct: baselinePrice ? Math.round(((baselinePrice - minPrice) / baselinePrice) * 10000) / 100 : null
      },
      minEntry: {
        itemId: minEntry.item.id,
        url: minEntry.item.url,
        currentPrice: minEntry.item.currentPrice
      },
      items: pricedItems.map(p => ({ id: p.item.id, url: p.item.url, currentPrice: p.item.currentPrice, unitPrice: p.unitPrice })),
      priceHistory: [],
      recentLogs: []
    };

    // Fetch recent price history for the affected item
    db.all('SELECT price, timestamp FROM price_history WHERE item_id = ? ORDER BY timestamp DESC LIMIT 50', [minEntry.item.id], (err, rows) => {
      if (!err && rows) snapshot.priceHistory = rows;

      // Fetch last lines of the scraper log to provide context
      const logPath = path.join(__dirname, 'data', 'scraper.log');
      if (fs.existsSync(logPath)) {
        try {
          const contents = fs.readFileSync(logPath, 'utf8').split('\n');
          snapshot.recentLogs = contents.slice(-200);
        } catch (e) {
          // ignore reading errors
        }
      }

      const fileNameSafe = timestamp.replace(/[:.]/g, '-');
      const filePath = path.join(dir, `${fileNameSafe}_group${group.id}_item${minEntry.item.id}.json`);
      try {
        fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
        log(`Created price-drop snapshot: ${filePath}`);
      } catch (e) {
        log(`Failed to write price-drop snapshot: ${e.message}`, 'ERROR');
      }
    });
  } catch (err) {
    log(`createDropSnapshot error: ${err.message}`, 'ERROR');
  }
}

// API: Export database backup
app.get('/api/backup/export', authenticateToken, (req, res) => {
  const exportPath = path.resolve(__dirname, 'data', 'database.export.sqlite');
  if (fs.existsSync(exportPath)) {
    try { fs.unlinkSync(exportPath); } catch (e) {}
  }
  
  db.run(`VACUUM INTO ?`, [exportPath], (err) => {
    if (err) {
      console.error('[Backup] Failed to export database:', err);
      return res.status(500).json({ error: 'Failed to generate export file.' });
    }
    res.download(exportPath, `stocksense-backup-${new Date().toISOString().slice(0,10)}.sqlite`, (err) => {
      // Clean up after download if possible
      if (!err) {
        setTimeout(() => {
          try { fs.unlinkSync(exportPath); } catch (e) {}
        }, 10000);
      }
    });
  });
});

// API: Import database backup
app.post('/api/backup/import', authenticateToken, upload.single('database'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  
  const dbPath = path.resolve(__dirname, 'data', 'database.sqlite');
  const tempPath = req.file.path;

  // We must close the current DB connection before overwriting
  db.close((err) => {
    if (err) {
      console.error('[Backup] Error closing DB before import:', err);
      return res.status(500).json({ error: 'Failed to close DB for import' });
    }
    
    // Overwrite the DB
    try {
      // Delete WAL and SHM files to prevent corruption with the new DB
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

      fs.copyFileSync(tempPath, dbPath);
      fs.unlinkSync(tempPath);
      
      console.log('[Backup] Successfully imported database. Restarting server process to reinitialize DB...');
      res.json({ success: true, message: 'Database imported successfully. The server is restarting.' });
      
      // Exit the process so Docker can restart it and re-initialize the DB cleanly
      setTimeout(() => process.exit(0), 1000);
    } catch (copyErr) {
      console.error('[Backup] Error overwriting DB:', copyErr);
      res.status(500).json({ error: 'Failed to copy uploaded DB' });
    }
  });
});
