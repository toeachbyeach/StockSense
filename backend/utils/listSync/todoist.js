/**
 * Todoist Integration Client
 * Uses Todoist REST API v2
 */
const axios = require('axios');

class TodoistClient {
  constructor(config = {}) {
    this.token = config.token || '';
    this.projectId = config.projectId || ''; // optional filter
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  async testConnection() {
    try {
      const res = await axios.get('https://api.todoist.com/rest/v2/projects', {
        headers: this.getHeaders(),
        timeout: 8000
      });
      const projects = Array.isArray(res.data) ? res.data.map(p => ({ id: p.id, name: p.name })) : [];
      return {
        success: true,
        message: 'Connected to Todoist',
        projects
      };
    } catch (err) {
      const msg = err.response?.data || err.response?.statusText || err.message;
      return { success: false, error: `Todoist connection failed: ${msg}` };
    }
  }

  async getItems() {
    try {
      const url = this.projectId
        ? `https://api.todoist.com/rest/v2/tasks?project_id=${encodeURIComponent(this.projectId)}`
        : 'https://api.todoist.com/rest/v2/tasks';

      const res = await axios.get(url, {
        headers: this.getHeaders(),
        timeout: 8000
      });

      if (Array.isArray(res.data)) {
        return res.data
          .filter(t => !t.is_completed)
          .map(t => ({
            externalId: String(t.id),
            summary: t.content || '',
            description: t.description || '',
            status: 'needs_action'
          }));
      }
      return [];
    } catch (err) {
      throw new Error(`Failed to fetch Todoist tasks: ${err.message}`);
    }
  }

  async completeItem(externalId) {
    try {
      await axios.post(
        `https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(externalId)}/close`,
        {},
        { headers: this.getHeaders(), timeout: 8000 }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = TodoistClient;
