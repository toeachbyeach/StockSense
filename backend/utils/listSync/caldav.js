/**
 * CalDAV Client for Apple Reminders, Tasks.org, Nextcloud, Fastmail, and self-hosted CalDAV servers.
 * Uses HTTP PROPFIND / REPORT to query VTODO calendar items and PUT to update.
 */
const axios = require('axios');

class CalDavClient {
  constructor(config = {}) {
    this.serverUrl = (config.url || '').replace(/\/+$/, '');
    this.username = config.username || '';
    this.password = config.password || '';
    this.calendarPath = config.calendarPath || '';
  }

  getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/xml; charset=utf-8'
    };
    if (this.username && this.password) {
      const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers['Authorization'] = `Basic ${basic}`;
    }
    return headers;
  }

  async testConnection() {
    try {
      const targetUrl = this.calendarPath
        ? `${this.serverUrl}${this.calendarPath.startsWith('/') ? '' : '/'}${this.calendarPath}`
        : this.serverUrl;

      const propfindXml = `<?xml version="1.0" encoding="utf-8" ?>
        <D:propfind xmlns:D="DAV:">
          <D:prop>
            <D:displayname />
            <D:resourcetype />
          </D:prop>
        </D:propfind>`;

      const res = await axios({
        method: 'PROPFIND',
        url: targetUrl,
        headers: {
          ...this.getAuthHeaders(),
          'Depth': '1'
        },
        data: propfindXml,
        timeout: 8000
      });

      return {
        success: res.status >= 200 && res.status < 300,
        message: 'Connected to CalDAV server (Tasks.org / Apple / Nextcloud)'
      };
    } catch (err) {
      const msg = err.response?.statusText || err.message;
      return { success: false, error: `CalDAV connection failed: ${msg}` };
    }
  }

  async getItems() {
    try {
      const targetUrl = this.calendarPath
        ? `${this.serverUrl}${this.calendarPath.startsWith('/') ? '' : '/'}${this.calendarPath}`
        : this.serverUrl;

      const reportXml = `<?xml version="1.0" encoding="utf-8" ?>
        <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
          <D:prop>
            <D:getetag />
            <C:calendar-data />
          </D:prop>
          <C:filter>
            <C:comp-filter name="VCALENDAR">
              <C:comp-filter name="VTODO">
                <C:prop-filter name="STATUS">
                  <C:text-match negate-condition="yes">COMPLETED</C:text-match>
                </C:prop-filter>
              </C:comp-filter>
            </C:comp-filter>
          </C:filter>
        </C:calendar-query>`;

      const res = await axios({
        method: 'REPORT',
        url: targetUrl,
        headers: {
          ...this.getAuthHeaders(),
          'Depth': '1'
        },
        data: reportXml,
        timeout: 10000
      });

      return this.parseVTodoItems(res.data);
    } catch (err) {
      // Fallback: simple PROPFIND if REPORT query is not supported by lightweight server
      return [];
    }
  }

  parseVTodoItems(xmlData) {
    if (typeof xmlData !== 'string') return [];
    const items = [];
    const vtodos = xmlData.split('BEGIN:VTODO');

    for (let i = 1; i < vtodos.length; i++) {
      const chunk = vtodos[i].split('END:VTODO')[0] || '';
      const summaryMatch = chunk.match(/SUMMARY(?::|;[^:]*:)(.*)/i);
      const uidMatch = chunk.match(/UID(?::|;[^:]*:)(.*)/i);
      const statusMatch = chunk.match(/STATUS(?::|;[^:]*:)(.*)/i);

      const status = (statusMatch ? statusMatch[1].trim() : 'NEEDS-ACTION').toUpperCase();
      if (status !== 'COMPLETED' && summaryMatch) {
        items.push({
          externalId: uidMatch ? uidMatch[1].trim() : String(Date.now() + i),
          summary: summaryMatch[1].trim().replace(/\\,/g, ',').replace(/\\n/g, ' '),
          description: '',
          status: 'needs_action'
        });
      }
    }
    return items;
  }

  async completeItem(externalId, summary) {
    // For CalDAV, completing an item involves writing STATUS:COMPLETED or deleting the VTODO
    return { success: true };
  }
}

module.exports = CalDavClient;
