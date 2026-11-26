

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.resolve(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA busy_timeout = 5000;');
  }
});

function initDB() {
  db.serialize(() => {
    // Items table
    db.run(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE NOT NULL,
        asin TEXT,
        domain TEXT,
        name TEXT,
        type TEXT DEFAULT 'watching',
        intervalWeeks INTEGER DEFAULT 4,
        targetPrice REAL,
        dropPct REAL DEFAULT 50,
        notifyAbove REAL,
        notifyBelow REAL,
        isAutoBuy BOOLEAN DEFAULT 0,
        currentPrice REAL,
        usedPrice REAL,
        lowestPrice REAL,
        highestPrice REAL,
        inStock TEXT,
        couponBadge TEXT,
        imageUrl TEXT,
        lastChecked DATETIME,
        status TEXT,
        notify BOOLEAN DEFAULT 1,
        isEstimate BOOLEAN DEFAULT 0,
        routineFrequency TEXT, 
        routineQuantity INTEGER DEFAULT 1,
        isRoutine BOOLEAN DEFAULT 0
      )
    `);

    // Price History table
    db.run(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        price REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      )
    `);
    // Settings table
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        gmailUser TEXT,
        gmailAppPassword TEXT,
        discordWebhook TEXT,
        globalNotify BOOLEAN DEFAULT 1,
        digestFrequency TEXT DEFAULT 'weekly',
        latitude REAL DEFAULT -33.8688,
        longitude REAL DEFAULT 151.2093
      )
    `);

    // Ensure default settings exist
    db.run(`INSERT OR IGNORE INTO settings (id) VALUES (1)`);

    // Safe Migrations for existing databases
    db.run(`ALTER TABLE items ADD COLUMN notifyAbove REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN notifyBelow REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN isAutoBuy BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN group_id INTEGER`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN packQuantity INTEGER DEFAULT 1`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN volumeQuantity REAL DEFAULT 1`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN volumeUnit TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN manualUnitPricing BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN unitPricingEnabled BOOLEAN DEFAULT 1`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN tags TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN subscribePrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN subscribeSave BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN isOnSale BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN shippingPrice REAL DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN isPrime BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN rawPrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedPrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedRawPrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedShippingPrice REAL DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedIsPrime BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedCondition TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedConditionNote TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedSeller TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN usedOffers TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN trackCondition TEXT DEFAULT 'any'`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN variations TEXT`, (err) => { /* Ignore if exists */ });
    
    // Repair misparsed animal weights (e.g. 30.1kg or 60kg dog weight stored as product volume)
    db.run(`
      UPDATE items
      SET volumeQuantity = 1, volumeUnit = 'chew'
      WHERE volumeUnit = 'kg' AND volumeQuantity >= 10
        AND (name LIKE '%chew%' OR name LIKE '%spectra%' OR name LIKE '%nexgard%' OR name LIKE '%flea%' OR name LIKE '%dog%')
    `, (err) => { /* Ignore */ });

    // Repair Pet Chemist items tracked as 6-pack (or in 6-pack groups) that have 1-pack price ($27.96)
    db.run(`
      UPDATE items
      SET currentPrice = 121.56, rawPrice = 121.56, lowestPrice = 121.56, highestPrice = 121.56,
          name = 'Nexgard Spectra Red 30.1-60kg (6 pack (6 months))',
          packQuantity = 6, volumeQuantity = 1, volumeUnit = 'chew', manualUnitPricing = 1
      WHERE url LIKE '%petchemist.com.au/products/nexgard-spectra-red-30-1-60kg%'
        AND (currentPrice < 50 OR packQuantity = 6)
    `, (err) => { /* Ignore */ });

    // Also update price history for the repaired Pet Chemist item so graphs and stats match
    db.run(`
      UPDATE price_history
      SET price = 121.56
      WHERE item_id IN (
        SELECT id FROM items WHERE url LIKE '%petchemist.com.au/products/nexgard-spectra-red-30-1-60kg%'
      ) AND price < 50
    `, (err) => { /* Ignore */ });

    // Repair Petbarn Nexgard Spectra 6-pack: member price 116.00, repeat delivery 92.80
    db.run(`
      UPDATE items
      SET currentPrice = 92.80, rawPrice = 116.00, lowestPrice = 92.80, highestPrice = 116.00,
          subscribePrice = 92.80, subscribeSave = 1,
          name = 'NexGard Spectra for Dogs Flea Tick & Worm Chew 30.1kg - 60kg 6Pack',
          packQuantity = 6, volumeQuantity = 1, volumeUnit = 'chew', manualUnitPricing = 1
      WHERE url LIKE '%petbarn.com.au/p/nexgard-spectra-for-dogs-30-1kg-60kg/134737%'
        AND (currentPrice > 150 OR currentPrice IS NULL OR currentPrice = 194)
    `, (err) => { /* Ignore */ });

    db.run(`
      UPDATE price_history
      SET price = 92.80
      WHERE item_id IN (
        SELECT id FROM items WHERE url LIKE '%petbarn.com.au/p/nexgard-spectra-for-dogs-30-1kg-60kg/134737%'
      ) AND price > 150
    `, (err) => { /* Ignore */ });

    db.run(`ALTER TABLE items ADD COLUMN trackSubscribe TEXT DEFAULT 'any'`, (err) => { /* Ignore if exists */ });
    
    // Reset items stuck in '❌ Error' so startup recovery can sync them cleanly
    db.run(`
      UPDATE items
      SET status = 'Pending'
      WHERE status = '❌ Error'
    `, (err) => { /* Ignore */ });

    db.run(`ALTER TABLE settings ADD COLUMN latitude REAL DEFAULT -33.8688`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN longitude REAL DEFAULT 151.2093`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN dashboardColumns INTEGER DEFAULT 3`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN hasAmazonPrime BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN trackAmazonUsed BOOLEAN DEFAULT 1`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN giftCardDiscount REAL DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN quietHoursEnabled BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN quietHoursStart TEXT DEFAULT '22:00'`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN quietHoursEnd TEXT DEFAULT '07:00'`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN telegramBotToken TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN telegramChatId TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN ntfyTopic TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN ntfyServer TEXT DEFAULT 'https://ntfy.sh'`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN amazonAssociateTag TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN affiliatePrefix TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN everydayRewardsExtra BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE settings ADD COLUMN flybuysMember BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });

    // Product groups table
    db.run(`
      CREATE TABLE IF NOT EXISTS product_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT DEFAULT 'watching',
        intervalWeeks INTEGER,
        notifyAbove REAL,
        notifyBelow REAL,
        isAutoBuy BOOLEAN DEFAULT 0,
        notify BOOLEAN DEFAULT 1,
        currentPrice REAL,
        lowestPrice REAL,
        highestPrice REAL,
        unitPrice REAL,
        unitPriceDisplay TEXT,
        status TEXT,
        lastChecked DATETIME,
        isOnSale BOOLEAN DEFAULT 0,
        targetPrice REAL,
        tags TEXT,
        routineFrequency TEXT,
        routineQuantity INTEGER DEFAULT 1,
        isRoutine BOOLEAN DEFAULT 0
      )
    `);

    // Add columns to product_groups for tracking on existing databases
    db.run(`ALTER TABLE product_groups ADD COLUMN lastChecked DATETIME`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN isOnSale BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN unitPrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN unitPriceDisplay TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN usedPrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN usedCondition TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN usedSeller TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN targetPrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN tags TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN routineFrequency TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN routineQuantity INTEGER DEFAULT 1`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN isRoutine BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN auditDismissed BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE product_groups ADD COLUMN lastPurchased DATETIME`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN couponDiscount REAL DEFAULT 0`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN targetPrice REAL`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN routineFrequency TEXT`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN routineQuantity INTEGER DEFAULT 1`, (err) => { /* Ignore if exists */ });
    db.run(`ALTER TABLE items ADD COLUMN isRoutine BOOLEAN DEFAULT 0`, (err) => { /* Ignore if exists */ });

    // Pending bookmarklet items queue table
    db.run(`
      CREATE TABLE IF NOT EXISTS pending_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        name TEXT,
        imageUrl TEXT,
        price REAL,
        rawPrice REAL,
        shippingPrice REAL DEFAULT 0,
        isPrime BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'pending',
        matchResults TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Shopping List Integrations table (Home Assistant, Todoist, Google Tasks, MS To Do, CalDAV/Tasks.org)
    db.run(`
      CREATE TABLE IF NOT EXISTS list_integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled BOOLEAN DEFAULT 1,
        config TEXT,
        syncInterval INTEGER DEFAULT 5,
        lastSync DATETIME,
        status TEXT DEFAULT 'idle',
        error TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Mapping table: maps raw text from voice/external lists to StockSense product groups
    db.run(`
      CREATE TABLE IF NOT EXISTS list_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_text TEXT NOT NULL UNIQUE,
        normalized_text TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES product_groups(id) ON DELETE CASCADE
      )
    `);

    // Synced items table: items pulled from external lists
    db.run(`
      CREATE TABLE IF NOT EXISTS synced_list_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration_id INTEGER,
        external_id TEXT NOT NULL,
        external_service TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        group_id INTEGER,
        status TEXT DEFAULT 'pending_match',
        external_completed BOOLEAN DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(integration_id, external_id)
      )
    `);

    // Migration: wrap existing orphaned items in a 1:1 group
    db.all(`SELECT * FROM items WHERE group_id IS NULL`, [], (err, rows) => {
      if (!err && rows && rows.length > 0) {
        rows.forEach(item => {
          db.run(
            `INSERT INTO product_groups (name, type, intervalWeeks, notifyAbove, notifyBelow, isAutoBuy, notify, currentPrice, lowestPrice, highestPrice, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.name || 'Unknown Item', item.type, item.intervalWeeks, item.notifyAbove, item.notifyBelow, item.isAutoBuy, item.notify, item.currentPrice, item.lowestPrice, item.highestPrice, item.status],
            function(err) {
              if (!err) {
                db.run(`UPDATE items SET group_id = ? WHERE id = ?`, [this.lastID, item.id]);
              }
            }
          );
        });
      }
    });
  });
}

initDB();

module.exports = db;
