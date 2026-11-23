/**
 * Google Tasks Integration Client
 * Supports Google Tasks API v1
 * Uses either an OAuth Access Token directly or Refresh Token credentials.
 */
const axios = require('axios');

class GoogleTasksClient {
  constructor(config = {}) {
    this.accessToken = config.token || config.accessToken || '';
    this.refreshToken = config.refreshToken || '';
    this.clientId = config.clientId || '';
    this.clientSecret = config.clientSecret || '';
    this.listId = config.listId || '@default';
  }

  async getValidToken() {
    // If refresh token and client secrets are present, refresh if needed
    if (this.refreshToken && this.clientId && this.clientSecret) {
      try {
        const res = await axios.post('https://oauth2.googleapis.com/token', {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token'
        }, { timeout: 8000 });
        if (res.data?.access_token) {
          this.accessToken = res.data.access_token;
        }
      } catch (err) {
        // Fall back to current access token if refresh fails
        console.warn('Google Tasks token refresh failed:', err.message);
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
      const res = await axios.get('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
        headers,
        timeout: 8000
      });
      const lists = Array.isArray(res.data?.items)
        ? res.data.items.map(l => ({ id: l.id, name: l.title }))
        : [];
      return {
        success: true,
        message: 'Connected to Google Tasks',
        lists
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.statusText || err.message;
      return { success: false, error: `Google Tasks connection failed: ${msg}` };
    }
  }

  async getItems() {
    try {
      const headers = await this.getHeaders();
      const listId = encodeURIComponent(this.listId || '@default');
      const res = await axios.get(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=false`, {
        headers,
        timeout: 8000
      });
      const items = res.data?.items;
      if (Array.isArray(items)) {
        return items
          .filter(t => t.status !== 'completed' && !t.deleted)
          .map(t => ({
            externalId: String(t.id),
            summary: t.title || '',
            description: t.notes || '',
            status: 'needs_action'
          }));
      }
      return [];
    } catch (err) {
      throw new Error(`Failed to fetch Google Tasks: ${err.message}`);
    }
  }

  async completeItem(externalId) {
    try {
      const headers = await this.getHeaders();
      const listId = encodeURIComponent(this.listId || '@default');
      await axios.patch(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${encodeURIComponent(externalId)}`,
        { status: 'completed' },
        { headers, timeout: 8000 }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = GoogleTasksClient;
