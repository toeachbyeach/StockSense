/**
 * Microsoft To Do Integration Client
 * Uses Microsoft Graph API v1.0
 */
const axios = require('axios');

class MicrosoftTodoClient {
  constructor(config = {}) {
    this.accessToken = config.token || config.accessToken || '';
    this.refreshToken = config.refreshToken || '';
    this.clientId = config.clientId || '';
    this.clientSecret = config.clientSecret || '';
    this.tenantId = config.tenantId || 'common';
    this.listId = config.listId || '';
  }

  async getValidToken() {
    if (this.refreshToken && this.clientId && this.clientSecret) {
      try {
        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('client_secret', this.clientSecret);
        params.append('refresh_token', this.refreshToken);
        params.append('grant_type', 'refresh_token');
        params.append('scope', 'Tasks.ReadWrite offline_access');

        const res = await axios.post(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, params, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 8000
        });
        if (res.data?.access_token) {
          this.accessToken = res.data.access_token;
        }
      } catch (err) {
        console.warn('Microsoft To Do token refresh failed:', err.message);
      }
    }
    return this.accessToken;
  }

  async getHeaders() {
    const token = await this.getValidToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  async testConnection() {
    try {
      const headers = await this.getHeaders();
      const res = await axios.get('https://graph.microsoft.com/v1.0/me/todo/lists', {
        headers,
        timeout: 8000
      });
      const lists = Array.isArray(res.data?.value)
        ? res.data.value.map(l => ({ id: l.id, name: l.displayName, isOwner: l.isOwner }))
        : [];
      return {
        success: true,
        message: 'Connected to Microsoft To Do',
        lists
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.statusText || err.message;
      return { success: false, error: `Microsoft To Do connection failed: ${msg}` };
    }
  }

  async getItems() {
    try {
      const headers = await this.getHeaders();
      let listId = this.listId;
      if (!listId) {
        // Find default or first list
        const listsRes = await axios.get('https://graph.microsoft.com/v1.0/me/todo/lists', {
          headers,
          timeout: 8000
        });
        const lists = listsRes.data?.value || [];
        const defaultList = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
        if (defaultList) listId = defaultList.id;
      }

      if (!listId) return [];

      const res = await axios.get(`https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(listId)}/tasks?$filter=status ne 'completed'`, {
        headers,
        timeout: 8000
      });

      const tasks = res.data?.value;
      if (Array.isArray(tasks)) {
        return tasks.map(t => ({
          externalId: String(t.id),
          summary: t.title || '',
          description: t.body?.content || '',
          status: 'needs_action'
        }));
      }
      return [];
    } catch (err) {
      throw new Error(`Failed to fetch Microsoft To Do tasks: ${err.message}`);
    }
  }

  async completeItem(externalId) {
    try {
      const headers = await this.getHeaders();
      let listId = this.listId;
      if (!listId) {
        const listsRes = await axios.get('https://graph.microsoft.com/v1.0/me/todo/lists', { headers, timeout: 8000 });
        const lists = listsRes.data?.value || [];
        const defaultList = lists.find(l => l.wellknownListName === 'defaultList') || lists[0];
        if (defaultList) listId = defaultList.id;
      }
      await axios.patch(
        `https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(externalId)}`,
        { status: 'completed' },
        { headers, timeout: 8000 }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = MicrosoftTodoClient;
