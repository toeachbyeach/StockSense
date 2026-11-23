/**
 * Express router for External List Integrations & Voice Match Sync
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { createListClient } = require('../utils/listSync');
const { findCandidates, normalizeText } = require('../utils/listMatcher');
const {
  maskConfig,
  syncIntegration,
  syncAllEnabledIntegrations,
  completeSyncedItem,
  confirmMatch
} = require('../utils/listSyncManager');
const log = require('../logger');

module.exports = function (authenticateToken) {
  // GET all integrations (masked secrets)
  router.get('/api/list-integrations', authenticateToken, (req, res) => {
    db.all('SELECT * FROM list_integrations ORDER BY createdAt DESC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const integrations = (rows || []).map(row => {
        let parsedConfig = {};
        try {
          parsedConfig = row.config ? JSON.parse(row.config) : {};
        } catch (e) {
          parsedConfig = {};
        }
        return {
          ...row,
          enabled: !!row.enabled,
          config: maskConfig(parsedConfig),
          hasToken: !!(parsedConfig.token || parsedConfig.accessToken || parsedConfig.password)
        };
      });
      res.json(integrations);
    });
  });

  // POST create or update integration
  router.post('/api/list-integrations', authenticateToken, (req, res) => {
    const { id, service, name, enabled, config, syncInterval } = req.body;
    if (!service || !name) {
      return res.status(400).json({ error: 'Service and name are required' });
    }

    // If updating, merge with existing config so masked tokens aren't overwritten with asterisks
    if (id) {
      db.get('SELECT config FROM list_integrations WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        let existingConfig = {};
        try {
          existingConfig = row && row.config ? JSON.parse(row.config) : {};
        } catch (e) {}

        const mergedConfig = { ...existingConfig, ...config };
        
        // Preserve existing sensitive credentials if new submission is empty, masked with dots (...), or asterisks (*)
        const isMaskedOrEmpty = (val) => !val || typeof val !== 'string' || val.trim() === '' || val.includes('...') || val.includes('*');

        if (isMaskedOrEmpty(config.token) && existingConfig.token) {
          mergedConfig.token = existingConfig.token;
        }
        if (isMaskedOrEmpty(config.password) && existingConfig.password) {
          mergedConfig.password = existingConfig.password;
        }
        if (isMaskedOrEmpty(config.clientSecret) && existingConfig.clientSecret) {
          mergedConfig.clientSecret = existingConfig.clientSecret;
        }
        if (isMaskedOrEmpty(config.refreshToken) && existingConfig.refreshToken) {
          mergedConfig.refreshToken = existingConfig.refreshToken;
        }
        if (isMaskedOrEmpty(config.accessToken) && existingConfig.accessToken) {
          mergedConfig.accessToken = existingConfig.accessToken;
        }

        db.run(
          `UPDATE list_integrations 
           SET service = ?, name = ?, enabled = ?, config = ?, syncInterval = ?
           WHERE id = ?`,
          [service, name, enabled ? 1 : 0, JSON.stringify(mergedConfig), syncInterval || 5, id],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            if (enabled) {
              syncIntegration(id).catch(e => log(`[ListSync] Initial sync error: ${e.message}`, 'WARN'));
            }
            res.json({ success: true, id, message: 'Integration updated successfully' });
          }
        );
      });
    } else {
      // Create new integration
      db.run(
        `INSERT INTO list_integrations (service, name, enabled, config, syncInterval)
         VALUES (?, ?, ?, ?, ?)`,
        [service, name, enabled ? 1 : 0, JSON.stringify(config || {}), syncInterval || 5],
        function (insertErr) {
          if (insertErr) return res.status(500).json({ error: insertErr.message });
          const newId = this.lastID;
          if (enabled) {
            syncIntegration(newId).catch(e => log(`[ListSync] Initial sync error: ${e.message}`, 'WARN'));
          }
          res.json({ success: true, id: newId, message: 'Integration created successfully' });
        }
      );
    }
  });

  // DELETE integration
  router.delete('/api/list-integrations/:id', authenticateToken, (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM synced_list_items WHERE integration_id = ?', [id], () => {
      db.run('DELETE FROM list_integrations WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Integration removed' });
      });
    });
  });

  // POST test integration connection
  router.post('/api/list-integrations/:id/test', authenticateToken, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM list_integrations WHERE id = ?', [id], async (err, integration) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!integration) return res.status(404).json({ error: 'Integration not found' });

      let config = {};
      try {
        config = integration.config ? JSON.parse(integration.config) : {};
      } catch (e) {}

      // Allow overriding config from req.body for test before save
      if (req.body && Object.keys(req.body).length > 0) {
        config = { ...config, ...req.body };
      }

      try {
        const client = createListClient(integration.service, config);
        const result = await client.testConnection();
        res.json(result);
      } catch (clientErr) {
        res.json({ success: false, error: clientErr.message });
      }
    });
  });

  // POST test unsaved connection parameters
  router.post('/api/list-integrations/test-direct', authenticateToken, async (req, res) => {
    const { service, config } = req.body;
    if (!service) return res.status(400).json({ error: 'Service is required' });
    try {
      const client = createListClient(service, config || {});
      const result = await client.testConnection();
      res.json(result);
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // POST trigger manual sync
  router.post('/api/list-integrations/:id/sync', authenticateToken, async (req, res) => {
    try {
      const result = await syncIntegration(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST trigger sync across all enabled integrations
  router.post('/api/list-sync/sync-all', authenticateToken, async (req, res) => {
    try {
      const results = await syncAllEnabledIntegrations();
      res.json({ success: true, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET pending voice/external items needing pair confirmation
  router.get('/api/list-sync/pending', authenticateToken, (req, res) => {
    db.all(
      `SELECT sli.*, li.name as integrationName
       FROM synced_list_items sli
       LEFT JOIN list_integrations li ON sli.integration_id = li.id
       WHERE sli.status = 'pending_match'
       ORDER BY sli.createdAt DESC`,
      [],
      async (err, items) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!items || items.length === 0) return res.json([]);

        try {
          const enriched = [];
          for (const it of items) {
            const matchData = await findCandidates(it.raw_text, db);
            enriched.push({
              ...it,
              normalizedText: matchData.normalizedText,
              extractedQuantity: matchData.quantity,
              candidates: matchData.candidates
            });
          }
          res.json(enriched);
        } catch (matchErr) {
          res.status(500).json({ error: matchErr.message });
        }
      }
    );
  });

  // POST confirm match between voice text and product group
  router.post('/api/list-sync/match', authenticateToken, async (req, res) => {
    const { rawText, groupId, quantity, syncedItemId } = req.body;
    if (!rawText || !groupId) {
      return res.status(400).json({ error: 'rawText and groupId are required' });
    }
    try {
      const result = await confirmMatch(rawText, groupId, quantity, syncedItemId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST dismiss / ignore pending item
  router.post('/api/list-sync/dismiss', authenticateToken, (req, res) => {
    const { syncedItemId } = req.body;
    if (!syncedItemId) return res.status(400).json({ error: 'syncedItemId required' });
    db.run(
      "UPDATE synced_list_items SET status = 'dismissed' WHERE id = ?",
      [syncedItemId],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  });

  // GET active and pending synced items for shopping list display
  router.get('/api/list-sync/items', authenticateToken, (req, res) => {
    db.all(
      `SELECT 
         sli.id as syncedItemId,
         sli.raw_text,
         sli.quantity,
         sli.status,
         sli.external_id,
         sli.external_service,
         sli.external_completed,
         sli.group_id as groupId,
         li.name as integrationName,
         pg.name as groupName,
         pg.currentPrice as lowestPrice,
         pg.unitPriceDisplay,
         pg.isOnSale
       FROM synced_list_items sli
       LEFT JOIN list_integrations li ON sli.integration_id = li.id
       LEFT JOIN product_groups pg ON sli.group_id = pg.id
       WHERE sli.status != 'completed' AND sli.status != 'dismissed'
       ORDER BY sli.createdAt DESC`,
      [],
      async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const items = rows || [];
        const enriched = [];
        for (const it of items) {
          if (!it.groupId) {
            try {
              const matchData = await findCandidates(it.raw_text, db);
              enriched.push({
                ...it,
                normalizedText: matchData.normalizedText,
                extractedQuantity: matchData.quantity,
                candidates: matchData.candidates
              });
            } catch (e) {
              enriched.push(it);
            }
          } else {
            enriched.push(it);
          }
        }
        res.json(enriched);
      }
    );
  });

  // POST add new item directly to Home Assistant / active integration
  router.post('/api/list-sync/add', authenticateToken, async (req, res) => {
    const { text, quantity } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Item text is required' });
    }

    try {
      // Find active Home Assistant or primary list integration
      const integration = await new Promise((resolve) => {
        db.get(
          "SELECT * FROM list_integrations WHERE enabled = 1 ORDER BY CASE WHEN service = 'homeassistant' THEN 0 ELSE 1 END, id ASC LIMIT 1",
          [],
          (err, row) => resolve(row || null)
        );
      });

      if (integration) {
        let config = {};
        try { config = JSON.parse(integration.config); } catch (e) {}
        const client = createListClient(integration.service, config);
        if (typeof client.addItem === 'function') {
          await client.addItem(text.trim());
        }
        // Trigger sync
        await syncIntegration(integration.id);
      } else {
        // Direct local addition
        const { normalizedText, quantity: normQty } = normalizeText(text);
        const mapping = await new Promise((resolve) => {
          db.get('SELECT * FROM list_mappings WHERE raw_text = ? OR normalized_text = ?', [text.trim().toLowerCase(), normalizedText], (err, row) => resolve(row || null));
        });
        const groupId = mapping ? mapping.group_id : null;
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO synced_list_items (integration_id, external_id, external_service, raw_text, quantity, group_id, status)
             VALUES (NULL, ?, 'manual', ?, ?, ?, ?)`,
            [`manual_${Date.now()}`, text.trim(), quantity || normQty || 1, groupId, groupId ? 'active' : 'pending_match'],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      res.json({ success: true, message: `Added "${text}" to shopping list` });
    } catch (err) {
      log(`[ListSync] Error adding item: ${err.message}`, 'ERROR');
      res.status(500).json({ error: err.message });
    }
  });

  // POST complete item (Two-Way Sync to external service)
  router.post('/api/list-sync/complete', authenticateToken, async (req, res) => {
    const { syncedItemId } = req.body;
    if (!syncedItemId) return res.status(400).json({ error: 'syncedItemId required' });
    try {
      const result = await completeSyncedItem(syncedItemId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST incoming webhook (e.g. from Home Assistant automation or Siri Shortcut)
  // Can be called via /api/webhook/list-item?token=SECRET or with standard Bearer token
  router.post('/api/webhook/list-item', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const queryToken = req.query.token;
    const itemText = req.body.text || req.body.item || req.body.summary;
    const qty = parseInt(req.body.quantity || req.body.qty, 10) || 1;

    if (!itemText) {
      return res.status(400).json({ error: 'Item text required in body (text, item, or summary)' });
    }

    try {
      const { normalizedText, quantity } = normalizeText(itemText);
      const finalQty = qty || quantity || 1;

      // Check if an explicit mapping exists
      const mapping = await new Promise((resolve) => {
        db.get(
          `SELECT * FROM list_mappings WHERE raw_text = ? OR normalized_text = ?`,
          [itemText.trim().toLowerCase(), normalizedText],
          (err, row) => resolve(row || null)
        );
      });

      const groupId = mapping ? mapping.group_id : null;
      const status = groupId ? 'active' : 'pending_match';

      // Insert into synced_list_items
      const insertedId = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO synced_list_items 
             (integration_id, external_id, external_service, raw_text, quantity, group_id, status)
           VALUES (NULL, ?, 'webhook', ?, ?, ?, ?)`,
          [`webhook_${Date.now()}`, itemText.trim(), finalQty, groupId, status],
          function (err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      });

      log(`[Webhook] Received item: "${itemText}" -> status: ${status}, groupId: ${groupId}`);
      res.json({
        success: true,
        id: insertedId,
        rawText: itemText,
        status,
        groupId,
        isMatched: !!groupId
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
