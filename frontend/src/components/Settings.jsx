import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Mail, MessageSquare, Bell, BellOff, MapPin, Search, Database, Download, Upload, Truck, Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw, ShieldAlert, CheckCircle2, Bookmark, Copy, Check, ExternalLink } from 'lucide-react';
import ListIntegrationsSettings from './ListIntegrationsSettings';

export default function Settings() {
  const [settings, setSettings] = useState({
    gmailUser: '',
    gmailAppPassword: '',
    discordWebhook: '',
    globalNotify: true,
    digestFrequency: 'weekly',
    latitude: -33.8688,
    longitude: 151.2093,
    dashboardColumns: 3,
    hasAmazonPrime: false,
    trackAmazonUsed: true,
    giftCardDiscount: 0,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    telegramBotToken: '',
    telegramChatId: '',
    ntfyTopic: '',
    ntfyServer: 'https://ntfy.sh',
    amazonAssociateTag: '',
    affiliatePrefix: ''
  });
  const [healthData, setHealthData] = useState(null);
  const [probing, setProbing] = useState(false);
  const [probeResultMsg, setProbeResultMsg] = useState('');
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [postcode, setPostcode] = useState('');
  const [locating, setLocating] = useState(false);
  const [copiedBookmark, setCopiedBookmark] = useState(false);
  const [copiedWishlistLink, setCopiedWishlistLink] = useState(false);
  const [activeBrowserTab, setActiveBrowserTab] = useState('chrome');
  const [vacuuming, setVacuuming] = useState(false);
  const [vacuumMsg, setVacuumMsg] = useState('');
  const [emailTestMsg, setEmailTestMsg] = useState('');

  useEffect(() => {
    fetchSettings();
    fetchScraperHealth();
  }, []);

  const fetchScraperHealth = async () => {
    try {
      const res = await axios.get('/api/scrapers/health');
      setHealthData(res.data);
    } catch (e) {
      console.error('Failed to load scraper health', e);
    }
  };

  const handleRunHealthProbe = async () => {
    setProbing(true);
    setProbeResultMsg('');
    try {
      const res = await axios.post('/api/scrapers/health/test');
      const fails = res.data.results.filter(r => !r.success);
      if (fails.length > 0) {
        setProbeResultMsg(`Probe finished: ${fails.length} scraper(s) failed (${fails.map(f => f.name).join(', ')})`);
      } else {
        setProbeResultMsg('Probe finished: All tested scrapers are healthy!');
      }
      fetchScraperHealth();
    } catch (e) {
      setProbeResultMsg('Probe failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setProbing(false);
    }
  };

  // On mount, load preview state from localStorage so preview persists across navigations
  useEffect(() => {
    try {
      const previewVal = localStorage.getItem('stocksense_preview_columns');
      const previewFlag = localStorage.getItem('stocksense_preview_enabled');
      if (previewVal) {
        setSettings(prev => ({ ...prev, dashboardColumns: Number(previewVal) }));
      }
      if (previewFlag === '1') {
        setPreviewEnabled(true);
      }
    } catch (e) {}
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get('/api/settings');
      if (res.data) {
        setSettings(prev => ({ ...prev, ...res.data }));
        try {
          localStorage.setItem('stocksense_affiliate_settings', JSON.stringify({
            amazonAssociateTag: res.data.amazonAssociateTag || '',
            affiliatePrefix: res.data.affiliatePrefix || ''
          }));
        } catch (e) {}
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  };

  const handleTestNotification = async () => {
    setEmailTestMsg('');
    setSendingTest(true);
    try {
      const res = await axios.post('/api/settings/test');
      setEmailTestMsg(res.data.message || 'Test notification sent!');
    } catch (e) {
      console.error(e);
      setEmailTestMsg(e.response?.data?.error || 'Failed to send test notification.');
    } finally {
      setSendingTest(false);
    }
  };

  const handleVacuumDatabase = async () => {
    setVacuuming(true);
    setVacuumMsg('');
    try {
      const res = await axios.post('/api/database/vacuum');
      setVacuumMsg(res.data.message || 'Database vacuumed successfully!');
    } catch (e) {
      setVacuumMsg('Vacuum failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setVacuuming(false);
    }
  };

  const bookmarkUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const publicWishlistUrl = `${bookmarkUrl}/?share=1`;
  const bookmarkletCode = `javascript:(function(){window.open('${bookmarkUrl}/?add='+encodeURIComponent(location.href),'stocksense_add','width=480,height=600');})();`;

  const handleCopyBookmark = () => {
    try {
      navigator.clipboard.writeText(bookmarkletCode);
      setCopiedBookmark(true);
      setTimeout(() => setCopiedBookmark(false), 2500);
    } catch (e) {
      console.error('Failed to copy bookmark code', e);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    // If preview is enabled and the user is changing dashboardColumns, update localStorage for live preview
    if (previewEnabled && name === 'dashboardColumns') {
      try {
        localStorage.setItem('stocksense_preview_columns', String(value));
        window.dispatchEvent(new CustomEvent('stocksense_preview_columns', { detail: Number(value) }));
      } catch (e) {}
    }
  };

  useEffect(() => {
    // Keep preview in sync if slider changed directly (range input uses onChange inline)
    if (previewEnabled && settings.dashboardColumns !== undefined) {
      try {
        localStorage.setItem('stocksense_preview_columns', String(settings.dashboardColumns));
        window.dispatchEvent(new CustomEvent('stocksense_preview_columns', { detail: Number(settings.dashboardColumns) }));
      } catch (e) {}
    }
  }, [settings.dashboardColumns, previewEnabled]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await axios.post('/api/settings', settings);
      try {
        localStorage.setItem('stocksense_affiliate_settings', JSON.stringify({
          amazonAssociateTag: settings.amazonAssociateTag || '',
          affiliatePrefix: settings.affiliatePrefix || ''
        }));
      } catch (errCache) {}
      setMessage('Settings saved securely!');
    } catch (e) {
      console.error(e);
      setMessage('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleLocatePostcode = async () => {
    if (!postcode) return;
    setLocating(true);
    try {
      const res = await axios.get(`https://nominatim.openstreetmap.org/search?postalcode=${postcode}&country=australia&format=json`);
      if (res.data && res.data.length > 0) {
        setSettings(prev => ({
          ...prev,
          latitude: parseFloat(res.data[0].lat),
          longitude: parseFloat(res.data[0].lon)
        }));
        setMessage('Location found! Remember to save.');
      } else {
        setMessage('Postcode not found in Australia.');
      }
    } catch (err) {
      console.error(err);
      setMessage('Failed to lookup postcode.');
    } finally {
      setLocating(false);
    }
  };

  const handleExportBackup = () => {
    window.location.href = '/api/backup/export?token=' + localStorage.getItem('stocksense_token');
  };

  const handleImportBackup = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!window.confirm("Are you sure you want to overwrite your database? All current data will be lost!")) {
      e.target.value = '';
      return;
    }
    
    const formData = new FormData();
    formData.append('database', file);
    
    setMessage('Importing database...');
    try {
      const res = await axios.post('/api/backup/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setMessage(res.data.message || 'Import successful. Refreshing...');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      console.error(err);
      setMessage('Failed to import backup.');
    }
    
    e.target.value = '';
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 24 }}>Global Settings</h2>
      
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        
        {/* Global Notifications */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={20} /> Notification Preferences
          </h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 600 }}>
              {settings.globalNotify ? <Bell size={18} color="var(--success)" /> : <BellOff size={18} color="var(--text-muted)" />}
              Enable Global Notifications
            </label>
            <input 
              type="checkbox" 
              name="globalNotify"
              checked={settings.globalNotify} 
              onChange={handleChange} 
              style={{ width: 'auto' }}
            />
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 24 }}>
            Turn off to instantly pause all emails and Discord alerts.
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Auto-Deliver Digest Frequency</label>
            <select name="digestFrequency" value={settings.digestFrequency} onChange={handleChange}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Mondays)</option>
            </select>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Immediate price drop alerts will still be sent as soon as they happen.
            </div>
          </div>
        </div>

        {/* Location / Geolocation */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={20} /> Supermarket Location
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
            Supermarket prices change based on your area. The scraper uses GPS coordinates to spoof your location so it gets the exact prices for your local store. 
            You can type your Latitude/Longitude manually, or enter your Postcode to automatically look it up.
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Australian Postcode Lookup</label>
              <input 
                type="text" 
                placeholder="e.g. 2000"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
              />
            </div>
            <button type="button" className="tab-btn" onClick={handleLocatePostcode} disabled={locating} style={{ border: '1px solid var(--border)', height: 42 }}>
              {locating ? 'Searching...' : <><Search size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> Locate</>}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Latitude</label>
              <input 
                type="number" 
                step="any"
                name="latitude"
                placeholder="-33.8688"
                value={settings.latitude || ''}
                onChange={handleChange}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Longitude</label>
              <input 
                type="number" 
                step="any"
                name="longitude"
                placeholder="151.2093"
                value={settings.longitude || ''}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Dashboard Columns moved to Layout section below */}
          
          {settings.latitude && settings.longitude && (
            <div style={{ marginTop: 24, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--glass-border)', height: 250 }}>
              <iframe 
                width="100%" 
                height="100%" 
                frameBorder="0" 
                scrolling="no" 
                marginHeight="0" 
                marginWidth="0" 
                src={`https://maps.google.com/maps?q=${settings.latitude},${settings.longitude}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                style={{ filter: 'brightness(0.9) contrast(1.1)' }}
              />
            </div>
          )}
        </div>

        {/* Amazon Prime & Delivery */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={20} /> Amazon Prime & Postage
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
            Certain Amazon products (especially international items) have postage or delivery fees. Configure your Prime status so prices reflect your actual out-of-pocket cost.
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontWeight: 600 }}>
              <span style={{ 
                background: '#00a8e1', 
                color: '#fff', 
                fontWeight: 800, 
                fontSize: '0.75rem', 
                padding: '2px 8px', 
                borderRadius: 4, 
                letterSpacing: '0.5px' 
              }}>
                PRIME
              </span>
              I have an Amazon Prime membership
            </label>
            <input 
              type="checkbox" 
              name="hasAmazonPrime"
              checked={Boolean(settings.hasAmazonPrime)} 
              onChange={handleChange} 
              style={{ width: 'auto' }}
            />
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            When checked, Prime-eligible items show with free delivery ($0 shipping). When unchecked, or for items not eligible for Prime, delivery costs are included in the total price.
          </div>
        </div>

        {/* Amazon Resale & Used Deals */}
        <div className="form-group" style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🏷️</span> Track Amazon Resale &amp; Used Deals
            </label>
            <input 
              type="checkbox" 
              name="trackAmazonUsed" 
              checked={settings.trackAmazonUsed !== false} 
              onChange={handleChange} 
              style={{ width: 'auto' }}
            />
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
            When enabled, StockSense automatically checks Amazon for discounted Amazon Resale (Warehouse) and Used offers (e.g. Like New, Very Good), displays them on cards, and can track them as the lowest available price.
          </div>
        </div>

        {/* Gmail SMTP */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={20} /> Gmail SMTP (App Passwords)
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
            To send emails, generate a secure 16-character <b>App Password</b> in your Google Account settings (requires 2-Step Verification). 
            These credentials are saved securely inside the local database and never leave your server.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Gmail Address</label>
              <input 
                type="email" 
                name="gmailUser"
                placeholder="you@gmail.com"
                value={settings.gmailUser}
                onChange={handleChange}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>App Password</label>
              <input 
                type="password" 
                name="gmailAppPassword"
                placeholder="16-character app password"
                value={settings.gmailAppPassword}
                onChange={handleChange}
              />
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="tab-btn"
              onClick={handleTestNotification}
              disabled={sendingTest || !settings.gmailUser}
              style={{ border: '1px solid var(--border)', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Mail size={16} />
              {sendingTest ? 'Sending Test Email...' : 'Send Test Email'}
            </button>
            {emailTestMsg && (
              <span style={{
                fontSize: '0.88rem',
                fontWeight: 600,
                color: emailTestMsg.toLowerCase().includes('failed') ? 'var(--danger)' : 'var(--success)'
              }}>
                {emailTestMsg}
              </span>
            )}
          </div>
        </div>

        {/* Discord */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={20} /> Discord Webhook
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 24 }}>
            Paste a Discord channel webhook URL to receive instant push notifications to your desktop or phone.
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Webhook URL</label>
            <input 
              type="url" 
              name="discordWebhook"
              placeholder="https://discord.com/api/webhooks/..."
              value={settings.discordWebhook}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Telegram Notifications */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={20} color="#38bdf8" /> Telegram Bot Alerts
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            Receive instant price drops and catalogue alerts directly via Telegram Bot. Create a bot with @BotFather and paste your token and Chat ID below.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Bot Token</label>
              <input
                type="password"
                name="telegramBotToken"
                placeholder="123456789:ABCdefGhI..."
                value={settings.telegramBotToken || ''}
                onChange={handleChange}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Chat ID</label>
              <input
                type="text"
                name="telegramChatId"
                placeholder="e.g. 987654321"
                value={settings.telegramChatId || ''}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        {/* NTFY Push Notifications */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={20} color="#f59e0b" /> NTFY.sh Free Push Notifications
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            Send instant mobile push alerts without signing up for anything. Download the free ntfy app (Android/iOS) and subscribe to your secret topic.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Topic Name</label>
              <input
                type="text"
                name="ntfyTopic"
                placeholder="e.g. stocksense_mysecretalerts"
                value={settings.ntfyTopic || ''}
                onChange={handleChange}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>NTFY Server URL</label>
              <input
                type="url"
                name="ntfyServer"
                placeholder="https://ntfy.sh"
                value={settings.ntfyServer || 'https://ntfy.sh'}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        {/* Quiet Hours / Do Not Disturb */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BellOff size={20} /> Quiet Hours (Do Not Disturb)
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 20 }}>
            Mute price drop notifications during the night so your sleep isn't disturbed. Alerts will resume in the morning.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                name="quietHoursEnabled"
                checked={settings.quietHoursEnabled === true || settings.quietHoursEnabled === 1}
                onChange={handleChange}
              />
              Enable Quiet Hours
            </label>
          </div>
          {(settings.quietHoursEnabled === true || settings.quietHoursEnabled === 1) && (
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Start Time</label>
                <input
                  type="time"
                  name="quietHoursStart"
                  value={settings.quietHoursStart || '22:00'}
                  onChange={handleChange}
                  style={{ padding: '6px 12px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>End Time</label>
                <input
                  type="time"
                  name="quietHoursEnd"
                  value={settings.quietHoursEnd || '07:00'}
                  onChange={handleChange}
                  style={{ padding: '6px 12px' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Discounted Gift Card Settings */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={20} color="#10b981" /> Discounted Digital Gift Card Settings
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
            Many Australians purchase discounted digital gift cards via RACV, Macquarie, Woolworths Everyday Extra, or employer benefit programs (usually 3% to 5% off). Enter your standard discount rate here to automatically factor gift card savings into product cards and comparisons.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Standard Gift Card Discount:</label>
            <input
              type="number"
              min="0"
              max="25"
              step="0.5"
              name="giftCardDiscount"
              value={settings.giftCardDiscount || 0}
              onChange={handleChange}
              style={{ width: 80, padding: '6px 10px' }}
            />
            <span style={{ fontWeight: 600 }}>% off</span>
          </div>
        </div>

        {/* Browser Bookmarklet (Quick Add) */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bookmark size={20} color="var(--accent)" /> Browser Bookmarklet (Quick Add to StockSense)
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
            Add items to StockSense with a single click while browsing your favorite stores (Amazon, Bunnings, JB Hi-Fi, The Good Guys, Coles, Woolworths, Chemist Warehouse, Pet Circle, Officeworks, The Iconic). When clicked on any product page, it queues the item, finds alternative competitor prices in the background, and prompts you to confirm the item group next time you open StockSense.
          </div>

          <div style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>
                  Drag this button to your Bookmarks Bar:
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Click and drag onto your browser's toolbar, or copy the JavaScript code below.
                </div>
              </div>
              <div>
                <a
                  href={bookmarkletCode}
                  className="btn-primary"
                  style={{
                    cursor: 'grab',
                    padding: '10px 20px',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    textDecoration: 'none',
                    boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)'
                  }}
                  title="Drag me to your Bookmarks Toolbar!"
                  onClick={(e) => {
                    e.preventDefault();
                    alert("Drag this button directly onto your browser's Bookmarks bar (or use the Copy Code button below)!");
                  }}
                >
                  <Bookmark size={18} /> 🔖 Add to StockSense
                </a>
              </div>
            </div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                Bookmarklet Code (for manual setup):
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  readOnly
                  value={bookmarkletCode}
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.8rem', background: 'rgba(0,0,0,0.4)', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, color: '#94a3b8' }}
                  onClick={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="tab-btn"
                  onClick={handleCopyBookmark}
                  style={{ border: '1px solid var(--border)', height: 38, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                >
                  {copiedBookmark ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
                  {copiedBookmark ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
            </div>
          </div>

          {/* Browser-Specific Setup Guides */}
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                className={`tab-btn ${activeBrowserTab === 'chrome' ? 'active' : ''}`}
                onClick={() => setActiveBrowserTab('chrome')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: activeBrowserTab === 'chrome' ? 'var(--accent)' : 'transparent',
                  color: activeBrowserTab === 'chrome' ? '#fff' : 'var(--text-muted)',
                  fontWeight: 600
                }}
              >
                Google Chrome Guide
              </button>
              <button
                type="button"
                className={`tab-btn ${activeBrowserTab === 'firefox' ? 'active' : ''}`}
                onClick={() => setActiveBrowserTab('firefox')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: activeBrowserTab === 'firefox' ? 'var(--accent)' : 'transparent',
                  color: activeBrowserTab === 'firefox' ? '#fff' : 'var(--text-muted)',
                  fontWeight: 600
                }}
              >
                Mozilla Firefox Guide
              </button>
            </div>

            {activeBrowserTab === 'chrome' && (
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                <h4 style={{ margin: '0 0 10px', fontSize: '0.95rem' }}>How to set up in Google Chrome:</h4>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  <li>
                    Make sure your Bookmarks Bar is visible by pressing <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Ctrl</kbd> + <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Shift</kbd> + <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>B</kbd> (or <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Cmd</kbd> + <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Shift</kbd> + <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>B</kbd> on Mac).
                  </li>
                  <li>
                    Click and drag the blue <b>🔖 Add to StockSense</b> button above directly onto your Chrome Bookmarks Bar.
                  </li>
                  <li>
                    <i>Manual alternative:</i> Right-click your Chrome Bookmarks Bar &rarr; select <b>Add page...</b> &rarr; Name: <code>Add to StockSense</code> &rarr; paste the copied code into the <b>URL</b> field &rarr; click <b>Save</b>.
                  </li>
                  <li>
                    <b>How to use:</b> When viewing any item on Amazon, Bunnings, JB Hi-Fi, The Good Guys, Coles, or Woolworths, simply click the bookmark! A small popup will confirm the item is queued, and comparisons will be ready in StockSense.
                  </li>
                </ol>
              </div>
            )}

            {activeBrowserTab === 'firefox' && (
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                <h4 style={{ margin: '0 0 10px', fontSize: '0.95rem' }}>How to set up in Mozilla Firefox:</h4>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  <li>
                    Ensure your Bookmarks Toolbar is shown: Press <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Ctrl</kbd> + <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Shift</kbd> + <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>B</kbd>, or right-click any empty space in the tab bar &rarr; <b>Bookmarks Toolbar</b> &rarr; <b>Always Show</b>.
                  </li>
                  <li>
                    Drag the blue <b>🔖 Add to StockSense</b> button above onto your Bookmarks Toolbar.
                  </li>
                  <li>
                    <i>Manual alternative:</i> Right-click the Bookmarks Toolbar &rarr; select <b>Add Bookmark...</b> &rarr; Name: <code>Add to StockSense</code> &rarr; paste the code into <b>URL</b> &rarr; click <b>Save</b>.
                  </li>
                  <li>
                    <b>How to use:</b> Whenever you are shopping online, click <b>Add to StockSense</b> to queue the item and automatically cross-search prices across other stores.
                  </li>
                </ol>
              </div>
            )}
          </div>
        </div>

        {/* Scraper Health & Anomaly Monitoring */}
        <div className="glass-panel" style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={20} color="var(--accent)" />
                Scraper Health & Monitoring
              </h3>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Real-time status of all retailer scrapers. You are alerted via Discord/Email if a scraper breaks or encounters bot protection.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleRunHealthProbe}
                disabled={probing}
                style={{ fontSize: '0.85rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={15} className={probing ? 'spin' : ''} />
                {probing ? 'Probing All Sites...' : 'Run Scraper Health Probe'}
              </button>
            </div>
          </div>

          {probeResultMsg && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 6,
              fontSize: '0.85rem',
              marginBottom: 16,
              background: probeResultMsg.includes('failed') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              border: `1px solid ${probeResultMsg.includes('failed') ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
              color: probeResultMsg.includes('failed') ? '#fca5a5' : '#6ee7b7'
            }}>
              {probeResultMsg}
            </div>
          )}

          {healthData ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {healthData.scrapers.map(sc => {
                const isHealthy = sc.status === 'healthy';
                const isDegraded = sc.status === 'degraded';
                const isFailing = sc.status === 'failing';

                const statusColor = isHealthy ? 'var(--success)' : (isDegraded ? '#fbbf24' : 'var(--danger)');
                const statusBg = isHealthy ? 'rgba(16, 185, 129, 0.1)' : (isDegraded ? 'rgba(251, 191, 36, 0.15)' : 'rgba(239, 68, 68, 0.15)');
                const statusBorder = isHealthy ? 'rgba(16, 185, 129, 0.3)' : (isDegraded ? 'rgba(251, 191, 36, 0.4)' : 'rgba(239, 68, 68, 0.4)');
                const statusLabel = isHealthy ? 'Healthy' : (isDegraded ? 'Degraded' : 'Failing');

                const formatTime = (ts) => {
                  if (!ts) return 'None yet';
                  try {
                    const d = new Date(ts);
                    return isNaN(d.getTime()) ? 'None yet' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  } catch (e) { return 'None yet'; }
                };

                return (
                  <div
                    key={sc.key}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${statusBorder}`,
                      borderRadius: 8,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{sc.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sc.domain}</div>
                      </div>
                      <span style={{
                        background: statusBg,
                        color: statusColor,
                        border: `1px solid ${statusBorder}`,
                        borderRadius: 12,
                        padding: '2px 8px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}>
                        {isHealthy && <CheckCircle2 size={12} />}
                        {isDegraded && <AlertTriangle size={12} />}
                        {isFailing && <XCircle size={12} />}
                        {statusLabel}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <span>Success Rate: <strong style={{ color: 'var(--text-main)' }}>{sc.successRate}%</strong></span>
                      <span>Total Scrapes: <strong style={{ color: 'var(--text-main)' }}>{sc.totalScrapes || 0}</strong></span>
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div>Last Success: <span style={{ color: sc.lastSuccess ? 'var(--text-main)' : 'var(--text-muted)' }}>{formatTime(sc.lastSuccess)}</span></div>
                      {sc.consecutiveFailures > 0 && (
                        <div style={{ color: 'var(--danger)', fontWeight: 600 }}>
                          Consecutive Failures: {sc.consecutiveFailures}
                        </div>
                      )}
                      {sc.lastError && (
                        <div style={{ color: 'var(--danger)', fontSize: '0.72rem', wordBreak: 'break-word', marginTop: 2 }}>
                          Error: {sc.lastError.substring(0, 100)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading scraper health metrics...</div>
          )}
        </div>

        {/* Backup & Restore */}
        <div className="glass-panel" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={20} /> Backup & Restore
          </h3>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
            Download a full copy of your StockSense database (including all items, price history, and settings). 
            You can restore this backup later if you move to a new server or want to roll back changes.
            <br/><br/>
            <b>Note:</b> A rolling backup is also automatically created on your server every time you add a new item or link.
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button type="button" className="tab-btn" onClick={handleExportBackup} style={{ border: '1px solid var(--border)', flex: 1, display: 'flex', justifyContent: 'center', gap: 8 }}>
              <Download size={18} /> Export Database
            </button>
            <div style={{ position: 'relative', flex: 1 }}>
              <input 
                type="file" 
                accept=".sqlite,.db" 
                onChange={handleImportBackup} 
                style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 2 }}
                title="Import Backup"
              />
              <button type="button" className="btn-primary" style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
                <Upload size={18} /> Restore Database
              </button>
            </div>
          </div>
        </div>
        {/* Layout */}
        <div className="glass-panel" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={20} /> Layout
          </h3>
          <div>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Dashboard Columns (1-10)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="range" min="1" max="10" name="dashboardColumns" value={settings.dashboardColumns} onChange={(e) => setSettings(prev => ({ ...prev, dashboardColumns: Number(e.target.value) }))} />
              <input type="number" min="1" max="10" name="dashboardColumns" value={settings.dashboardColumns} onChange={handleChange} style={{ width: 80 }} />
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>Choose how many columns the dashboard shows; mobile will constrain to 1-2 for readability.</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={previewEnabled} onChange={(e) => {
                  const v = e.target.checked; setPreviewEnabled(v);
                  try {
                    if (v) {
                      localStorage.setItem('stocksense_preview_columns', String(settings.dashboardColumns));
                      localStorage.setItem('stocksense_preview_enabled', '1');
                    } else {
                      localStorage.removeItem('stocksense_preview_columns');
                      localStorage.removeItem('stocksense_preview_enabled');
                    }
                    window.dispatchEvent(new CustomEvent('stocksense_preview_columns_previewToggle', { detail: { enabled: v, columns: Number(settings.dashboardColumns) } }));
                  } catch (ex) {}
                }} />
                Preview changes (apply immediately without saving)
              </label>
              {previewEnabled && (
                <button type="button" className="tab-btn" style={{ height: 34 }} onClick={() => {
                  // Force write to storage and dispatch event to trigger listeners
                  try { localStorage.setItem('stocksense_preview_columns', String(settings.dashboardColumns)); window.dispatchEvent(new CustomEvent('stocksense_preview_columns', { detail: Number(settings.dashboardColumns) })); } catch (e) {}
                }}>Apply Preview</button>
              )}
            </div>
          </div>
        </div>

        {/* Sticky Save Bar at the bottom of General Settings */}
        <div style={{
          position: 'sticky',
          bottom: 20,
          zIndex: 30,
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(16px)',
          border: '1.5px solid var(--accent)',
          borderRadius: 12,
          padding: '14px 20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginTop: 24
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <button type="submit" className="btn-primary" disabled={saving} style={{ padding: '10px 24px', fontSize: '1rem', fontWeight: 600 }}>
              {saving ? 'Saving...' : (
                <><Save size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} /> Save Settings</>
              )}
            </button>
          </div>
          {message && (
            <span style={{ color: message.includes('Failed') ? 'var(--danger)' : 'var(--success)', fontWeight: 600, fontSize: '0.9rem' }}>
              {message}
            </span>
          )}
        </div>
      </form>

      {/* External Shopping Lists & Home Assistant */}
      <ListIntegrationsSettings />

      {/* Database Optimization & Vacuuming */}
      <div className="glass-panel" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Database size={20} color="#38bdf8" /> Database Optimization & Maintenance
        </h3>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
          StockSense automatically defragments and re-indexes SQLite every Sunday at 3 AM. You can also trigger an immediate <code>VACUUM</code> optimization to reclaim disk space and speed up database queries.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={handleVacuumDatabase}
            disabled={vacuuming}
            style={{ padding: '8px 16px', fontSize: '0.9rem' }}
          >
            {vacuuming ? 'Optimizing Database...' : '⚡ Optimize Database Now (VACUUM)'}
          </button>
          {vacuumMsg && (
            <span style={{ fontSize: '0.88rem', color: vacuumMsg.includes('failed') ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
              {vacuumMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
