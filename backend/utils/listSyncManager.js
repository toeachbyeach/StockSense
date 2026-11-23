/**
 * List Sync Manager
 * Orchestrates fetching from external services (Home Assistant, Todoist, CalDAV, Google Tasks, MS To Do),
 * managing mappings, and executing two-way completion sync.
 */
const db = require('../db');
const { createListClient } = require('./listSync');
const { normalizeText, findCandidates } = require('./listMatcher');
const log = require('../logger');

/**
 * Mask sensitive credentials for safe API responses.
 */
function maskConfig(config = {}) {
  const masked = { ...config };
  if (masked.token) {
    masked.token = masked.token.length > 8
      ? `${masked.token.slice(0, 4)}...${masked.token.slice(-4)}`
      : '****';
  }
  if (masked.password) {
    masked.password = '****';
  }
  if (masked.clientSecret) {
    masked.clientSecret = '****';
  }
  if (masked.refreshToken) {
    masked.refreshToken = '****';
  }
  return masked;
}

/**
 * Run sync for a specific integration.
 */
async function syncIntegration(integrationId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM list_integrations WHERE id = ?', [integrationId], async (err, integration) => {
      if (err) return reject(err);
      if (!integration) return reject(new Error(`Integration ${integrationId} not found`));

      let config = {};
      try {
        config = integration.config ? JSON.parse(integration.config) : {};
      } catch (e) {
        log(`[ListSync] Invalid JSON config for integration ${integrationId}: ${e.message}`, 'ERROR');
      }

      db.run("UPDATE list_integrations SET status = 'syncing' WHERE id = ?", [integrationId]);

      try {
        const client = createListClient(integration.service, config);
        const items = await client.getItems();

        log(`[ListSync] Fetched ${items.length} items from ${integration.name} (${integration.service})`);

        let newCount = 0;
        let mappedCount = 0;

        for (const item of items) {
          const rawSummary = (item.summary || '').trim();
          if (!rawSummary) continue;

          const { normalizedText, quantity } = normalizeText(rawSummary);

          // Check if an explicit mapping exists
          const mapping = await new Promise((res) => {
            db.get(
              `SELECT * FROM list_mappings WHERE raw_text = ? OR normalized_text = ?`,
              [rawSummary.toLowerCase(), normalizedText],
              (err, row) => res(row || null)
            );
          });

          const groupId = mapping ? mapping.group_id : null;
          const finalQuantity = mapping ? (mapping.quantity || quantity) : quantity;
          const status = groupId ? 'active' : 'pending_match';

          if (groupId) mappedCount++;
          else newCount++;

          // Upsert into synced_list_items
          await new Promise((res) => {
            db.run(
              `INSERT INTO synced_list_items 
                 (integration_id, external_id, external_service, raw_text, quantity, group_id, status, external_completed, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
               ON CONFLICT(integration_id, external_id) DO UPDATE SET
                 raw_text = excluded.raw_text,
                 quantity = excluded.quantity,
                 group_id = COALESCE(excluded.group_id, synced_list_items.group_id),
                 status = CASE WHEN synced_list_items.status = 'completed' THEN 'completed' ELSE excluded.status END,
                 updatedAt = CURRENT_TIMESTAMP`,
              [integration.id, item.externalId, integration.service, rawSummary, finalQuantity, groupId, status],
              (err) => {
                if (err) log(`[ListSync] Error upserting synced item ${rawSummary}: ${err.message}`, 'ERROR');
                res();
              }
            );
          });
        }

        db.run(
          "UPDATE list_integrations SET status = 'idle', error = NULL, lastSync = CURRENT_TIMESTAMP WHERE id = ?",
          [integrationId]
        );

        resolve({
          success: true,
          totalFetched: items.length,
          mapped: mappedCount,
          pending: newCount
        });
      } catch (syncErr) {
        log(`[ListSync] Sync error for ${integration.name}: ${syncErr.message}`, 'ERROR');
        db.run(
          "UPDATE list_integrations SET status = 'error', error = ? WHERE id = ?",
          [syncErr.message, integrationId]
        );
        reject(syncErr);
      }
    });
  });
}

/**
 * Sync all enabled integrations.
 */
async function syncAllEnabledIntegrations() {
  return new Promise((resolve) => {
    db.all(
      "SELECT id, name, service FROM list_integrations WHERE enabled = 1 AND status != 'syncing'",
      [],
      async (err, rows) => {
        if (err || !rows || rows.length === 0) return resolve([]);
        const results = [];
        for (const row of rows) {
          try {
            const res = await syncIntegration(row.id);
            results.push({ id: row.id, name: row.name, ...res });
          } catch (e) {
            results.push({ id: row.id, name: row.name, success: false, error: e.message });
          }
        }
        resolve(results);
      }
    );
  });
}

/**
 * Complete a synced item locally and in the external provider (Two-Way Sync).
 */
async function completeSyncedItem(syncedItemId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT sli.*, li.service, li.config, li.name as integrationName
       FROM synced_list_items sli
       LEFT JOIN list_integrations li ON sli.integration_id = li.id
       WHERE sli.id = ?`,
      [syncedItemId],
      async (err, item) => {
        if (err) return reject(err);
        if (!item) return reject(new Error('Synced item not found'));

        let externalSuccess = false;
        let externalError = null;

        if (item.integration_id && item.config) {
          try {
            const config = JSON.parse(item.config);
            const client = createListClient(item.service, config);
            const extRes = await client.completeItem(item.external_id);
            externalSuccess = extRes.success;
            if (!extRes.success) externalError = extRes.error;
          } catch (e) {
            externalError = e.message;
            log(`[ListSync] External completion failed for item ${item.raw_text}: ${e.message}`, 'WARN');
          }
        }

        // Mark completed in StockSense database
        db.run(
          `UPDATE synced_list_items 
           SET status = 'completed', external_completed = ?, updatedAt = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [externalSuccess ? 1 : 0, syncedItemId],
          (updateErr) => {
            if (updateErr) return reject(updateErr);
            resolve({
              success: true,
              externalCompleted: externalSuccess,
              externalError
            });
          }
        );
      }
    );
  });
}

/**
 * Confirm pair match between raw voice text and product group.
 */
async function confirmMatch(rawText, groupId, quantity = 1, syncedItemId = null) {
  const { normalizedText, quantity: normQty } = normalizeText(rawText);
  const finalQty = quantity || normQty || 1;

  return new Promise((resolve, reject) => {
    // 1. Insert or update mapping
    db.run(
      `INSERT INTO list_mappings (raw_text, normalized_text, group_id, quantity)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(raw_text) DO UPDATE SET
         group_id = excluded.group_id,
         quantity = excluded.quantity,
         normalized_text = excluded.normalized_text`,
      [rawText.trim().toLowerCase(), normalizedText, groupId, finalQty],
      function (err) {
        if (err) return reject(err);

        // 2. Update any pending synced items that match this raw text
        db.run(
          `UPDATE synced_list_items
           SET group_id = ?, quantity = ?, status = 'active', updatedAt = CURRENT_TIMESTAMP
           WHERE status = 'pending_match' 
             AND (raw_text = ? OR id = ?)`,
          [groupId, finalQty, rawText, syncedItemId],
          (updateErr) => {
            if (updateErr) return reject(updateErr);
            resolve({
              success: true,
              rawText,
              normalizedText,
              groupId,
              quantity: finalQty
            });
          }
        );
      }
    );
  });
}

module.exports = {
  maskConfig,
  syncIntegration,
  syncAllEnabledIntegrations,
  completeSyncedItem,
  confirmMatch
};
