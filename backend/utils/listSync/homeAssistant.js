/**
 * Home Assistant Todo / Shopping List Integration Client
 * Supports Home Assistant's native todo entity system (HA 2023.11+) and legacy shopping_list component.
 */
const axios = require('axios');

class HomeAssistantClient {
  constructor(config = {}) {
    this.baseUrl = (config.url || '').replace(/\/+$/, '');
    this.token = config.token || '';
    this.entityId = config.entityId || 'todo.shopping_list';
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Test connection to Home Assistant instance and verify permissions.
   */
  async testConnection() {
    try {
      const res = await axios.get(`${this.baseUrl}/api/`, {
        headers: this.getHeaders(),
        timeout: 8000
      });
      const ok = res.status === 200 && res.data && res.data.message;
      if (!ok) return { success: false, error: 'Unexpected response from Home Assistant' };

      // Discover available todo entities
      const entities = await this.discoverTodoEntities();
      return {
        success: true,
        message: res.data.message || 'Connected to Home Assistant',
        entities
      };
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.statusText || err.message;
      return { success: false, error: `Home Assistant connection failed: ${msg}` };
    }
  }

  /**
   * Discovers all available todo entities (e.g. todo.shopping_list, todo.groceries)
   */
  async discoverTodoEntities() {
    try {
      const res = await axios.get(`${this.baseUrl}/api/states`, {
        headers: this.getHeaders(),
        timeout: 8000
      });
      if (Array.isArray(res.data)) {
        return res.data
          .filter(e => e.entity_id.startsWith('todo.'))
          .map(e => ({
            entity_id: e.entity_id,
            name: e.attributes?.friendly_name || e.entity_id,
            state: e.state
          }));
      }
      return [];
    } catch {
      return [{ entity_id: 'todo.shopping_list', name: 'Shopping List' }];
    }
  }

  /**
   * Fetch active shopping list items that need action.
   */
  async getItems() {
    const entityId = this.entityId || 'todo.shopping_list';

    // Try Home Assistant modern todo.get_items service call
    try {
      const res = await axios.post(
        `${this.baseUrl}/api/services/todo/get_items?return_response=true`,
        {
          entity_id: entityId,
          status: ['needs_action']
        },
        {
          headers: this.getHeaders(),
          timeout: 10000
        }
      );

      // Home Assistant returns { response: { [entity_id]: { items: [...] } } }
      const itemsMap = res.data?.response || res.data?.service_response || res.data;
      const listData = itemsMap[entityId] || Object.values(itemsMap)[0];
      if (listData && Array.isArray(listData.items)) {
        return listData.items.map(it => ({
          externalId: it.uid || String(it.summary),
          summary: it.summary || '',
          description: it.description || '',
          status: it.status || 'needs_action'
        }));
      }
    } catch (modernErr) {
      // Fallback for older Home Assistant versions or legacy shopping_list
    }

    // Fallback: legacy /api/shopping_list endpoint
    try {
      const legRes = await axios.get(`${this.baseUrl}/api/shopping_list`, {
        headers: this.getHeaders(),
        timeout: 8000
      });
      if (Array.isArray(legRes.data)) {
        return legRes.data
          .filter(it => !it.complete)
          .map(it => ({
            externalId: String(it.id || it.name),
            summary: it.name || '',
            description: '',
            status: 'needs_action'
          }));
      }
    } catch (legErr) {
      // If legacy fails too, throw detailed error
      throw new Error(`Failed to fetch items from Home Assistant: ${legErr.message}`);
    }

    return [];
  }

  /**
   * Mark an item completed in Home Assistant (two-way sync)
   */
  async completeItem(externalId, summary) {
    const entityId = this.entityId || 'todo.shopping_list';

    // Try modern todo.update_item
    try {
      await axios.post(
        `${this.baseUrl}/api/services/todo/update_item`,
        {
          entity_id: entityId,
          item: externalId,
          status: 'completed'
        },
        {
          headers: this.getHeaders(),
          timeout: 8000
        }
      );
      return { success: true };
    } catch (err) {
      // Try by summary name if uid failed
      if (summary) {
        try {
          await axios.post(
            `${this.baseUrl}/api/services/todo/update_item`,
            {
              entity_id: entityId,
              item: summary,
              status: 'completed'
            },
            {
              headers: this.getHeaders(),
              timeout: 8000
            }
          );
          return { success: true };
        } catch {}
      }
    }

    // Fallback for legacy shopping_list
    try {
      await axios.post(
        `${this.baseUrl}/api/shopping_list/item/${encodeURIComponent(externalId)}`,
        { complete: true },
        { headers: this.getHeaders(), timeout: 8000 }
      );
      return { success: true };
    } catch (legacyErr) {
      return { success: false, error: legacyErr.message };
    }
  }

  /**
   * Add a new item to Home Assistant shopping list
   */
  async addItem(summary) {
    const entityId = this.entityId || 'todo.shopping_list';
    try {
      await axios.post(
        `${this.baseUrl}/api/services/todo/add_item`,
        {
          entity_id: entityId,
          item: summary
        },
        { headers: this.getHeaders(), timeout: 8000 }
      );
      return { success: true };
    } catch (modernErr) {
      try {
        await axios.post(
          `${this.baseUrl}/api/shopping_list/item`,
          { name: summary },
          { headers: this.getHeaders(), timeout: 8000 }
        );
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }
}

module.exports = HomeAssistantClient;
