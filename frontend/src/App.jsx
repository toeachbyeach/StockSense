import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Dashboard from './components/Dashboard';
import BudgetTool from './components/BudgetTool';
import Logs from './components/Logs';
import ItemDetails from './components/ItemDetails';
import Settings from './components/Settings';
import Login from './components/Login';
import AddToWatchlist from './components/AddToWatchlist';
import SmartShoppingList from './components/SmartShoppingList';
import { Activity, Wallet, Terminal, Settings as SettingsIcon, LogOut, ShoppingBag } from 'lucide-react';
import { buildAffiliateUrl } from './utils/affiliate';

// Ensure Authorization header is set synchronously on module load
const _initialToken = typeof window !== 'undefined' ? localStorage.getItem('stocksense_token') : null;
if (_initialToken) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${_initialToken}`;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('App ErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: '#ff6b6b' }}>
          <h2>Something went wrong displaying this view.</h2>
          <pre style={{ textAlign: 'left', background: 'rgba(0,0,0,0.5)', padding: 16, borderRadius: 8, overflowX: 'auto', marginTop: 16, color: '#ff9999' }}>
            {this.state.error?.toString()}
          </pre>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PublicWishlistView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get('/api/public/list')
      .then(res => setItems(res.data))
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <h1 style={{ fontSize: '2.2rem', marginBottom: 8, background: 'linear-gradient(135deg, #60a5fa, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          StockSense Shared Wishlist
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
          Real-time Australian shopping prices and deals tracked by StockSense
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading wishlist...</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--danger)' }}>Failed to load wishlist: {error}</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>No items in wishlist yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {items.map(it => (
            <div key={it.id} className="glass-panel" style={{ borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {it.imageUrl && (
                <div style={{ height: 180, background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
                  <img src={it.imageUrl} alt={it.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                </div>
              )}
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 8, flex: 1 }}>{it.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 'auto' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent)' }}>
                    ${it.currentPrice != null ? it.currentPrice.toFixed(2) : '--'}
                  </span>
                  {it.inStock && (
                    <span style={{ fontSize: '0.78rem', color: it.inStock === 'Out of Stock' ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                      {it.inStock}
                    </span>
                  )}
                </div>
                {it.url && (
                  <a
                    href={buildAffiliateUrl(it.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary"
                    style={{ marginTop: 12, textDecoration: 'none', textAlign: 'center', fontSize: '0.85rem', padding: '8px 12px' }}
                  >
                    View at Store ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('tracker');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [token, setToken] = useState(_initialToken);
  const [uptime, setUptime] = useState(null);
  const [addUrl, setAddUrl] = useState(() => new URLSearchParams(window.location.search).get('add'));
  const isShareView = typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('share') === '1' || window.location.pathname.startsWith('/share'));

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const fetchUptime = async () => {
      try {
        const res = await axios.get('/api/uptime');
        setUptime(res.data.uptime);
      } catch (e) {
        console.error('Failed to fetch uptime:', e);
      }
    };
    fetchUptime();
    const interval = setInterval(fetchUptime, 60000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    const responseInterceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
          handleLogout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  // Quick "Add to Watchlist" mode — opened by the bookmarklet popup as
  // http://localhost:3000/?add=<encoded product url>
  if (addUrl) {
    return <AddToWatchlist url={addUrl} />;
  }

  // Public read-only wishlist mode (?share=1)
  if (isShareView) {
    return <PublicWishlistView />;
  }

  const handleLogout = () => {
    localStorage.removeItem('stocksense_token');
    setToken(null);
  };

  const handleItemClick = (id) => {
    console.log(`[DEBUG-UI] App.jsx handleItemClick called with ID: ${id}`);
    setSelectedItemId(id);
    setActiveTab('details');
  };

  const goBackToTracker = () => {
    setSelectedItemId(null);
    setActiveTab('tracker');
  };

  if (!token) {
    return <Login onLogin={setToken} />;
  }

  const formatUptime = (seconds) => {
    if (seconds == null) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `Uptime: ${h}h ${m}m`;
    return `Uptime: ${m}m`;
  };

  return (
    <div className="app-container">
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ margin: 0 }}>StockSense</h1>
            {uptime !== null && <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>{formatUptime(uptime)}</span>}
          </div>
          <div className="nav-tabs">
            <button 
              className={`tab-btn ${(activeTab === 'tracker' || activeTab === 'details') ? 'active' : ''}`}
              onClick={goBackToTracker}
            >
              <Activity size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
              Price Tracker
            </button>
            <button 
              className={`tab-btn ${activeTab === 'shopping-list' ? 'active' : ''}`}
              onClick={() => setActiveTab('shopping-list')}
            >
              <ShoppingBag size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
              Shopping List
            </button>
            <button 
              className={`tab-btn ${activeTab === 'budget' ? 'active' : ''}`}
              onClick={() => setActiveTab('budget')}
            >
              <Wallet size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
              Budgeting
            </button>
            <button 
              className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <Terminal size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
              Logs
            </button>
            <button 
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <SettingsIcon size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
              Settings
            </button>
          </div>
        </div>
        <button className="tab-btn" onClick={handleLogout} title="Logout">
          <LogOut size={18} />
        </button>
      </header>

      <main>
        <ErrorBoundary>
          {activeTab === 'tracker' && <Dashboard onItemClick={handleItemClick} onNavigateTab={setActiveTab} />}
          {activeTab === 'shopping-list' && <SmartShoppingList onNavigateToItem={handleItemClick} onNavigateTab={setActiveTab} />}
          {activeTab === 'details' && <ItemDetails itemId={selectedItemId} onBack={goBackToTracker} />}
          {activeTab === 'budget' && <BudgetTool />}
          {activeTab === 'logs' && <Logs />}
          {activeTab === 'settings' && <Settings />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default App;
