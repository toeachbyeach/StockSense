import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  ListTodo, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Trash2, 
  Plus, 
  ExternalLink, 
  Copy, 
  Check, 
  Home, 
  CheckSquare, 
  Calendar, 
  Smartphone,
  ChevronDown,
  ChevronUp,
  Radio,
  Edit3
} from 'lucide-react';

const SERVICE_PRESETS = [
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    icon: Home,
    color: '#03a9f4',
    badge: 'Two-Way Sync',
    desc: 'Sync with Home Assistant Todo entities (todo.shopping_list) or voice satellites.',
    fields: [
      { key: 'url', label: 'Home Assistant URL', placeholder: 'http://homeassistant.local:8123', type: 'text', required: true },
      { key: 'token', label: 'Long-Lived Access Token', placeholder: 'eyJhbGciOi...', type: 'password', required: true },
      { key: 'entityId', label: 'Todo Entity ID', placeholder: 'todo.shopping_list', type: 'text', defaultValue: 'todo.shopping_list' }
    ]
  },
  {
    id: 'todoist',
    name: 'Todoist',
    icon: CheckSquare,
    color: '#e44332',
    badge: 'Two-Way Sync',
    desc: 'Sync items from a Todoist project (e.g. Groceries or Inbox).',
    fields: [
      { key: 'token', label: 'API Token', placeholder: '0123456789abcdef...', type: 'password', required: true },
      { key: 'projectId', label: 'Project ID (optional - leave empty for Inbox)', placeholder: '12345678', type: 'text' }
    ]
  },
  {
    id: 'caldav',
    name: 'CalDAV / Tasks.org / Apple',
    icon: Calendar,
    color: '#a855f7',
    badge: 'Two-Way Sync',
    desc: 'Connect to Tasks.org, Apple Reminders (via iCloud CalDAV), Nextcloud, or Radicale.',
    fields: [
      { key: 'url', label: 'CalDAV Server URL', placeholder: 'https://caldav.icloud.com or https://nextcloud.local/remote.php/dav', type: 'text', required: true },
      { key: 'username', label: 'Username / Apple ID', placeholder: 'user@example.com', type: 'text', required: true },
      { key: 'password', label: 'App-Specific Password', placeholder: 'abcd-efgh-ijkl-mnop', type: 'password', required: true },
      { key: 'calendarPath', label: 'Calendar / List Path (optional)', placeholder: '/calendars/user/groceries/', type: 'text' }
    ]
  },
  {
    id: 'googletasks',
    name: 'Google Tasks',
    icon: CheckSquare,
    color: '#4285f4',
    badge: 'Two-Way Sync',
    desc: 'Sync with Google Tasks using OAuth Bearer Token or Google API credentials.',
    fields: [
      { key: 'token', label: 'OAuth Access Token (or refresh token)', placeholder: 'ya29.a0...', type: 'password', required: true },
      { key: 'listId', label: 'Task List ID (optional - default is @default)', placeholder: '@default', type: 'text', defaultValue: '@default' },
      { key: 'refreshToken', label: 'Refresh Token (optional for auto-refresh)', placeholder: '1//...', type: 'password' },
      { key: 'clientId', label: 'Client ID (optional)', placeholder: '12345...apps.googleusercontent.com', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret (optional)', placeholder: 'GOCSPX-...', type: 'password' }
    ]
  },
  {
    id: 'microsofttodo',
    name: 'Microsoft To Do',
    icon: CheckSquare,
    color: '#0078d4',
    badge: 'Two-Way Sync',
    desc: 'Sync with Microsoft To Do via Microsoft Graph API.',
    fields: [
      { key: 'token', label: 'Access Token', placeholder: 'EwB4A8l6...', type: 'password', required: true },
      { key: 'listId', label: 'List ID (optional - default is main list)', placeholder: 'AQMkAD...', type: 'text' },
      { key: 'refreshToken', label: 'Refresh Token (optional)', placeholder: 'MCwDA...', type: 'password' },
      { key: 'clientId', label: 'App / Client ID (optional)', placeholder: '00000000-0000-0000-0000-000000000000', type: 'text' },
      { key: 'clientSecret', label: 'Client Secret (optional)', placeholder: '...', type: 'password' }
    ]
  }
];

export default function ListIntegrationsSettings() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedService, setSelectedService] = useState('homeassistant');
  const [formData, setFormData] = useState({ name: '', enabled: true, config: {} });
  const [editingId, setEditingId] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [testStatusById, setTestStatusById] = useState({});
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const webhookUrl = `${window.location.origin}/api/webhook/list-item`;

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const fetchIntegrations = async () => {
    try {
      const res = await axios.get('/api/list-integrations');
      setIntegrations(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load list integrations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestExisting = async (id) => {
    setTestingId(id);
    setTestStatusById(prev => ({ ...prev, [id]: null }));
    try {
      const res = await axios.post(`/api/list-integrations/${id}/test`);
      setTestStatusById(prev => ({
        ...prev,
        [id]: {
          success: res.data.success,
          message: res.data.success ? (res.data.message || 'Connected successfully!') : (res.data.error || 'Connection failed'),
          entities: res.data.entities || res.data.lists || []
        }
      }));
    } catch (e) {
      setTestStatusById(prev => ({
        ...prev,
        [id]: { success: false, message: e.response?.data?.error || e.message }
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleOpenAdd = (presetId = 'homeassistant') => {
    const preset = SERVICE_PRESETS.find(p => p.id === presetId) || SERVICE_PRESETS[0];
    setSelectedService(preset.id);
    setEditingId(null);
    const initialConfig = {};
    preset.fields.forEach(f => {
      if (f.defaultValue) initialConfig[f.key] = f.defaultValue;
    });
    setFormData({
      name: preset.name,
      enabled: true,
      config: initialConfig
    });
    setTestResult(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (integration) => {
    setSelectedService(integration.service);
    setEditingId(integration.id);
    setFormData({
      name: integration.name,
      enabled: integration.enabled,
      config: { ...(integration.config || {}) }
    });
    setTestResult(null);
    setShowAddModal(true);
  };

  const handleFieldChange = (key, val) => {
    setFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: val
      }
    }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post('/api/list-integrations/test-direct', {
        service: selectedService,
        config: formData.config
      });
      setTestResult(res.data);
    } catch (e) {
      setTestResult({ success: false, error: e.response?.data?.error || e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveIntegration = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    setSaving(true);
    try {
      const res = await axios.post('/api/list-integrations', {
        id: editingId || undefined,
        service: selectedService,
        name: formData.name || selectedService,
        enabled: formData.enabled,
        config: formData.config
      });
      setShowAddModal(false);
      const targetId = res.data?.id || editingId;
      setEditingId(null);
      await fetchIntegrations();
      if (targetId) {
        axios.post(`/api/list-integrations/${targetId}/sync`)
          .then(() => fetchIntegrations())
          .catch(err => console.warn('[ListSync] Initial sync notice:', err.message));
      }
    } catch (err) {
      alert('Failed to save integration: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteIntegration = async (id, name) => {
    if (!window.confirm(`Are you sure you want to remove the integration "${name}"?`)) return;
    try {
      await axios.delete(`/api/list-integrations/${id}`);
      fetchIntegrations();
    } catch (err) {
      alert('Failed to delete integration: ' + err.message);
    }
  };

  const handleTriggerSync = async (id) => {
    setSyncingId(id);
    try {
      const res = await axios.post(`/api/list-integrations/${id}/sync`);
      alert(`Sync completed! Fetched: ${res.data.totalFetched}, Auto-mapped: ${res.data.mapped}, Needing Match: ${res.data.pending}`);
      fetchIntegrations();
    } catch (err) {
      alert('Sync failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncingId(null);
    }
  };

  const handleToggleEnable = async (integration) => {
    try {
      await axios.post('/api/list-integrations', {
        id: integration.id,
        service: integration.service,
        name: integration.name,
        enabled: !integration.enabled,
        config: integration.config
      });
      fetchIntegrations();
    } catch (err) {
      console.error('Failed to toggle integration:', err);
    }
  };

  const currentPreset = SERVICE_PRESETS.find(p => p.id === selectedService) || SERVICE_PRESETS[0];

  return (
    <div className="glass-panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <ListTodo size={22} color="var(--accent)" /> External Shopping Lists & Home Assistant
          </h3>
          <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Connect StockSense to Home Assistant, Todoist, Google Tasks, Microsoft To Do, or CalDAV (Tasks.org / Apple Reminders).
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => handleOpenAdd('homeassistant')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: '0.88rem' }}
        >
          <Plus size={16} /> Add List Integration
        </button>
      </div>

      {/* Preset Quick-Add Buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {SERVICE_PRESETS.map(preset => {
          const Icon = preset.icon;
          return (
            <button
              key={preset.id}
              type="button"
              className="tab-btn"
              onClick={() => handleOpenAdd(preset.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                fontSize: '0.82rem',
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.03)'
              }}
            >
              <Icon size={14} color={preset.color} />
              <span>{preset.name}</span>
            </button>
          );
        })}
      </div>

      {/* Active Integrations List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
          <RefreshCw className="spinning" size={20} style={{ margin: '0 auto 8px' }} />
          Loading integrations...
        </div>
      ) : integrations.length === 0 ? (
        <div style={{
          padding: 24,
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 10,
          border: '1px dashed var(--border)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.9rem'
        }}>
          No list integrations connected yet. Click <strong>Add List Integration</strong> or choose a preset above to connect Home Assistant or your to-do app.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {integrations.map(item => {
            const preset = SERVICE_PRESETS.find(p => p.id === item.service) || {
              icon: ListTodo,
              color: '#38bdf8',
              name: item.service
            };
            const Icon = preset.icon;
            const isSyncing = syncingId === item.id || item.status === 'syncing';
            const isTesting = testingId === item.id;
            const testStatus = testStatusById[item.id];
            const isConnected = item.enabled && !item.error;

            return (
              <div
                key={item.id}
                style={{
                  padding: '16px 20px',
                  background: isConnected ? 'rgba(34, 197, 94, 0.04)' : (item.error ? 'rgba(239, 68, 68, 0.05)' : 'rgba(0,0,0,0.3)'),
                  border: isConnected ? '1.5px solid rgba(34, 197, 94, 0.45)' : (item.error ? '1.5px solid var(--danger)' : '1px solid var(--border)'),
                  borderRadius: 12,
                  boxShadow: isConnected ? '0 4px 20px rgba(34, 197, 94, 0.08)' : 'none'
                }}
              >
                {/* Header with Connection Status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      background: `${preset.color}18`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1.5px solid ${preset.color}50`
                    }}>
                      <Icon size={22} color={preset.color} />
                    </div>
                    <div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span>
                          {isConnected ? '🟢' : (item.error ? '🔴' : '⚪')} {item.name} {isConnected ? 'Connected' : (item.error ? 'Connection Issue' : 'Disabled')}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: isConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                          color: isConnected ? 'var(--success)' : 'var(--text-muted)',
                          border: `1px solid ${isConnected ? 'rgba(34, 197, 94, 0.35)' : 'var(--border)'}`,
                          fontWeight: 600
                        }}>
                          {isConnected ? 'Active' : 'Disabled'}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: 'rgba(56, 189, 248, 0.12)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          fontWeight: 600
                        }}>
                          Two-Way Sync
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        Provider: <strong>{preset.name}</strong> • Last Synced: <strong>{item.lastSync ? new Date(item.lastSync).toLocaleTimeString() : 'Pending first sync'}</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="tab-btn"
                      onClick={() => handleOpenEdit(item)}
                      style={{ fontSize: '0.82rem', padding: '6px 12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <Edit3 size={14} color="var(--accent)" />
                      Edit Settings
                    </button>
                    <button
                      type="button"
                      className="tab-btn"
                      onClick={() => handleTestExisting(item.id)}
                      disabled={isTesting}
                      style={{ border: '1px solid var(--border)', fontSize: '0.82rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <CheckCircle2 size={14} color="var(--accent)" />
                      {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleTriggerSync(item.id)}
                      disabled={isSyncing || !item.enabled}
                      style={{ fontSize: '0.82rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <RefreshCw size={14} className={isSyncing ? 'spinning' : ''} />
                      {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button
                      type="button"
                      className="tab-btn"
                      onClick={() => handleToggleEnable(item)}
                      style={{ fontSize: '0.82rem', padding: '6px 12px', border: '1px solid var(--border)' }}
                    >
                      {item.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="tab-btn"
                      onClick={() => handleDeleteIntegration(item.id, item.name)}
                      style={{ border: '1px solid var(--border)', padding: '6px 10px', color: 'var(--danger)' }}
                      title="Remove integration"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Integration Config Details Box (Token safely excluded) */}
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(0,0,0,0.35)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 8,
                  fontSize: '0.8rem'
                }}>
                  {item.config?.url && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>URL: </span>
                      <strong style={{ color: '#e2e8f0' }}>{item.config.url}</strong>
                    </div>
                  )}
                  {item.config?.entityId && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Entity ID: </span>
                      <strong style={{ color: '#38bdf8' }}>{item.config.entityId}</strong>
                    </div>
                  )}
                  {item.config?.projectId && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Project: </span>
                      <strong style={{ color: '#38bdf8' }}>{item.config.projectId}</strong>
                    </div>
                  )}
                  {item.config?.listId && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>List: </span>
                      <strong style={{ color: '#38bdf8' }}>{item.config.listId}</strong>
                    </div>
                  )}
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Auto-Sync: </span>
                    <strong style={{ color: '#e2e8f0' }}>Every {item.syncInterval || 5} mins</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Security: </span>
                    <strong style={{ color: 'var(--success)' }}>Token Authenticated (Hidden)</strong>
                  </div>
                </div>

                {/* Inline Test Result Banner */}
                {testStatus && (
                  <div style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: testStatus.success ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    border: `1px solid ${testStatus.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    fontSize: '0.82rem',
                    color: testStatus.success ? 'var(--success)' : 'var(--danger)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    {testStatus.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    <div>
                      <strong>{testStatus.message}</strong>
                      {testStatus.entities && testStatus.entities.length > 0 && (
                        <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
                          (Discovered: {testStatus.entities.map(e => e.name || e.entity_id).join(', ')})
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {item.error && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--danger)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertCircle size={14} /> <strong>Sync Error:</strong> {item.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Direct Webhook & Voice Assistant Info Box */}
      <div style={{
        marginTop: 20,
        padding: 16,
        background: 'rgba(0,0,0,0.25)',
        borderRadius: 8,
        border: '1px solid var(--border)'
      }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Radio size={16} color="#10b981" /> Direct Webhook for Siri Shortcuts, Tasker & Custom Automations
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          You can also post voice commands directly to StockSense via HTTP POST. StockSense will automatically normalize the text, extract quantities, and match your tracked product groups.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            readOnly
            value={webhookUrl}
            style={{
              flex: 1,
              minWidth: 260,
              padding: '6px 10px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: '#e2e8f0',
              fontSize: '0.82rem'
            }}
          />
          <button
            type="button"
            className="tab-btn"
            onClick={() => {
              navigator.clipboard.writeText(webhookUrl);
              setCopiedWebhook(true);
              setTimeout(() => setCopiedWebhook(false), 2000);
            }}
            style={{ border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: '0.82rem' }}
          >
            {copiedWebhook ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
            {copiedWebhook ? 'Copied' : 'Copy URL'}
          </button>
        </div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Payload example: <code>{JSON.stringify({ text: "2x kangaroo mince" })}</code>
        </div>
      </div>

      {/* Add / Edit Integration Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 16
        }}>
          <div style={{
            background: 'var(--card-bg, #0f172a)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            width: '100%',
            maxWidth: 540,
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              {React.createElement(currentPreset.icon, { size: 22, color: currentPreset.color })}
              {editingId ? 'Edit' : 'Add'} {currentPreset.name} Integration
            </h3>

            {/* Service selector tabs (only when adding new) */}
            {!editingId && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
                {SERVICE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className={selectedService === preset.id ? 'btn-primary' : 'tab-btn'}
                    onClick={() => handleOpenAdd(preset.id)}
                    style={{ fontSize: '0.78rem', padding: '6px 10px', whiteSpace: 'nowrap' }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            )}

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              {currentPreset.desc}
            </p>

            <form onSubmit={handleSaveIntegration}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: '0.82rem', marginBottom: 4, fontWeight: 500 }}>
                  Integration Display Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder={`My ${currentPreset.name}`}
                  style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, color: '#fff' }}
                />
              </div>

              {currentPreset.fields.map(field => {
                const isSecret = field.type === 'password' || field.key === 'token' || field.key === 'clientSecret' || field.key === 'refreshToken';
                const rawVal = formData.config[field.key] || '';
                const isMasked = isSecret && (rawVal.includes('...') || rawVal.includes('*'));
                const hasExistingSavedSecret = editingId && isSecret && !!rawVal;

                return (
                  <div key={field.key} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '0.82rem', fontWeight: 500 }}>
                        {field.label} {field.required && !hasExistingSavedSecret && <span style={{ color: 'var(--danger)' }}>*</span>}
                      </label>
                      {hasExistingSavedSecret && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                          ✓ Token saved (leave blank to keep)
                        </span>
                      )}
                    </div>
                    <input
                      type={field.type || 'text'}
                      required={field.required && !hasExistingSavedSecret}
                      value={isMasked ? '' : rawVal}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={hasExistingSavedSecret ? '•••••••• (Leave blank to keep existing stored token)' : field.placeholder}
                      style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, color: '#fff' }}
                    />
                  </div>
                );
              })}

              {/* Test Connection Button & Result */}
              <div style={{ marginTop: 16, marginBottom: 16, padding: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    className="tab-btn"
                    onClick={handleTestConnection}
                    disabled={testing}
                    style={{ border: '1px solid var(--border)', padding: '6px 14px', fontSize: '0.82rem' }}
                  >
                    {testing ? 'Testing...' : 'Test Connection'}
                  </button>
                  {testResult && (
                    <span style={{
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: testResult.success ? 'var(--success)' : 'var(--danger)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                      {testResult.success ? (testResult.message || 'Connected successfully!') : testResult.error}
                    </span>
                  )}
                </div>
                {testResult?.entities && testResult.entities.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Discovered entities: {testResult.entities.map(e => e.name || e.entity_id).join(', ')}
                  </div>
                )}
                {testResult?.lists && testResult.lists.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Discovered lists: {testResult.lists.map(l => l.name).join(', ')}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="tab-btn"
                  onClick={() => { setShowAddModal(false); setEditingId(null); }}
                  style={{ border: '1px solid var(--border)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : (editingId ? 'Update Integration' : 'Save Integration')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
