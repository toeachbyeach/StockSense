import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Login from './Login';
import { CheckCircle2, Loader2, XCircle, ExternalLink, Layers, ChevronDown, ChevronUp } from 'lucide-react';

const deriveName = (rawUrl) => {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace('www.', '');
    const cap = (s) => s.split('-').filter(Boolean).map(w => (w[0] || '').toUpperCase() + w.slice(1)).join(' ');

    if (host.includes('coles.com.au') && u.pathname.includes('/product/')) {
      const slug = (u.pathname.split('/').pop() || '').replace(/-\d+$/, '');
      return cap(slug) || 'Coles item';
    }
    if (host.includes('woolworths.com.au') && u.pathname.includes('/productdetails/')) {
      const parts = u.pathname.split('/').filter(Boolean);
      return cap(parts[parts.length - 1] || '') || 'Woolworths item';
    }
    if (host.includes('chemistwarehouse.com.au') && u.pathname.includes('/buy/')) {
      const parts = u.pathname.split('/').filter(Boolean);
      const slug = (parts[parts.length - 1] || '').replace(/^\d+-?/, '');
      return cap(slug) || 'Chemist Warehouse item';
    }
    if (host.includes('amazon')) {
      const parts = u.pathname.split('/').filter(Boolean);
      const dpIndex = parts.indexOf('dp');
      if (dpIndex > 0 && parts[dpIndex - 1]) {
        const slug = cap(parts[dpIndex - 1]);
        if (slug && slug.length > 3) {
          return slug.length > 60 ? slug.slice(0, 60) : slug;
        }
      }
      const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      return asin ? `Amazon item ${asin[1]}` : 'Amazon item';
    }
    return host || 'New item';
  } catch {
    return 'New item';
  }
};

export default function AddToWatchlist({ url }) {
  const [token, setToken] = useState(() => localStorage.getItem('stocksense_token'));
  const [phase, setPhase] = useState(token ? 'adding' : 'login'); // login | adding | variations | done | error
  const [error, setError] = useState('');
  const [hostLabel, setHostLabel] = useState('');
  const startedRef = useRef(false);

  // Variation state
  const [productInfo, setProductInfo] = useState(null);
  const [selectedAsins, setSelectedAsins] = useState([]);
  const [separateCards, setSeparateCards] = useState(false);
  const [showCustomList, setShowCustomList] = useState(false);

  useEffect(() => {
    try { setHostLabel(new URL(url).hostname.replace('www.', '')); } catch (e) { setHostLabel(url); }
  }, [url]);

  useEffect(() => {
    if (token && !startedRef.current) {
      startedRef.current = true;
      initAdd(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const initAdd = async (tok) => {
    setPhase('adding');
    setError('');
    axios.defaults.headers.common['Authorization'] = `Bearer ${tok}`;
    try {
      let name = deriveName(url);
      let imageUrl = null;
      let variations = null;
      let price = null;
      let rawPrice = null;
      let shippingPrice = 0;
      let isPrime = false;

      try {
        const infoRes = await axios.post('/api/product-info', { url });
        if (infoRes.data?.name) {
          name = infoRes.data.name;
          imageUrl = infoRes.data.imageUrl || null;
          variations = infoRes.data.variations || null;
          price = infoRes.data.price;
          rawPrice = infoRes.data.rawPrice;
          shippingPrice = infoRes.data.shippingPrice || 0;
          isPrime = infoRes.data.isPrime || false;
        }
      } catch (e) {
        // Fallback to URL-derived name
      }

      if (variations && variations.hasVariations && variations.allVariations?.length > 1) {
        setProductInfo({ name, imageUrl, variations, price, rawPrice, shippingPrice, isPrime });
        const current = variations.allVariations.find(v => v.isCurrent);
        setSelectedAsins(current ? [current.asin] : [variations.allVariations[0].asin]);
        setPhase('variations');
        return;
      }

      await queueItem([{ url, imageUrl, name, price, rawPrice, shippingPrice, isPrime }]);
    } catch (err) {
      handleError(err);
    }
  };

  const queueItem = async (itemsToQueue) => {
    setPhase('adding');
    setError('');
    try {
      for (const item of itemsToQueue) {
        await axios.post('/api/pending-items', {
          url: item.url,
          name: item.name,
          imageUrl: item.imageUrl,
          price: item.price,
          rawPrice: item.rawPrice,
          shippingPrice: item.shippingPrice,
          isPrime: item.isPrime
        });
      }
      setPhase('done');
      setTimeout(() => { try { window.close(); } catch (e) {} }, 3500);
    } catch (err) {
      handleError(err);
    }
  };

  const handleError = (err) => {
    const statusCode = err.response?.status;
    if (statusCode === 401 || statusCode === 403) {
      localStorage.removeItem('stocksense_token');
      startedRef.current = false;
      setToken(null);
      setPhase('login');
    } else {
      setPhase('error');
      setError(err.response?.data?.error || err.message || 'Failed to add item');
    }
  };

  const handleLogin = (t) => {
    localStorage.setItem('stocksense_token', t);
    setToken(t);
  };

  // Preset selection helpers
  const selectAllColours = () => {
    if (!productInfo?.variations) return;
    const colorOpts = productInfo.variations.dimensionOptions['Colour Name'] ||
                      productInfo.variations.dimensionOptions['Color Name'] || [];
    if (colorOpts.length > 0) {
      setSelectedAsins(colorOpts.map(o => o.asin));
    }
  };

  const selectAllSizes = () => {
    if (!productInfo?.variations) return;
    const sizeOpts = productInfo.variations.dimensionOptions['Size Name'] || [];
    if (sizeOpts.length > 0) {
      setSelectedAsins(sizeOpts.map(o => o.asin));
    }
  };

  const selectAllVariations = () => {
    if (!productInfo?.variations) return;
    setSelectedAsins(productInfo.variations.allVariations.map(v => v.asin));
  };

  const selectCurrentOnly = () => {
    if (!productInfo?.variations) return;
    const current = productInfo.variations.allVariations.find(v => v.isCurrent);
    if (current) setSelectedAsins([current.asin]);
    else if (productInfo.variations.allVariations[0]) setSelectedAsins([productInfo.variations.allVariations[0].asin]);
  };

  const handleConfirmVariations = () => {
    if (!productInfo?.variations || selectedAsins.length === 0) return;
    const itemsToQueue = selectedAsins.map(asin => {
      const v = productInfo.variations.allVariations.find(opt => opt.asin === asin);
      return {
        url: v ? v.url : `https://www.amazon.com.au/dp/${asin}`,
        name: v ? `${productInfo.name} (${v.value})` : productInfo.name,
        imageUrl: v?.imageUrl || productInfo.imageUrl,
        price: productInfo.price,
        rawPrice: productInfo.rawPrice,
        shippingPrice: productInfo.shippingPrice,
        isPrime: productInfo.isPrime
      };
    });
    queueItem(itemsToQueue);
  };

  if (phase === 'login') {
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 10, width: '100%', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', zIndex: 5 }}>
          Adding from {hostLabel}
        </div>
        <Login onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div className="glass-panel" style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: phase === 'variations' ? 24 : 32 }}>
        
        {phase === 'adding' && (
          <>
            <Loader2 size={32} color="var(--accent)" className="add-watchlist-spin" />
            <p style={{ marginTop: 16 }}>Reading product details &amp; adding {hostLabel}…</p>
          </>
        )}

        {phase === 'variations' && productInfo && (
          <div style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              {productInfo.imageUrl && (
                <img src={productInfo.imageUrl} alt="" style={{ width: 52, height: 52, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 4, flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {productInfo.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--accent)', marginTop: 2 }}>
                  <Layers size={14} /> Multiple options detected ({productInfo.variations.dimensions.join(', ')})
                </div>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>Quick select:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  type="button"
                  onClick={selectCurrentOnly}
                  className="tab-btn"
                  style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                >
                  Current Only
                </button>
                {(productInfo.variations.dimensionOptions['Colour Name'] || productInfo.variations.dimensionOptions['Color Name']) && (
                  <button
                    type="button"
                    onClick={selectAllColours}
                    className="tab-btn"
                    style={{ fontSize: '0.8rem', padding: '4px 10px', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  >
                    All Colours ({ (productInfo.variations.dimensionOptions['Colour Name'] || productInfo.variations.dimensionOptions['Color Name']).length })
                  </button>
                )}
                {productInfo.variations.dimensionOptions['Size Name'] && (
                  <button
                    type="button"
                    onClick={selectAllSizes}
                    className="tab-btn"
                    style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                  >
                    All Sizes ({ productInfo.variations.dimensionOptions['Size Name'].length })
                  </button>
                )}
                <button
                  type="button"
                  onClick={selectAllVariations}
                  className="tab-btn"
                  style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                >
                  All Options ({ productInfo.variations.allVariations.length })
                </button>
              </div>
            </div>

            {/* Collapsible custom picker */}
            <div style={{ marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => setShowCustomList(!showCustomList)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
              >
                {showCustomList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showCustomList ? 'Hide individual options' : `Choose specific options (${selectedAsins.length} selected)`}
              </button>

              {showCustomList && (
                <div style={{ maxHeight: 180, overflowY: 'auto', background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: 8, marginTop: 8, border: '1px solid var(--border)' }}>
                  {productInfo.variations.allVariations.map((v, idx) => {
                    const isChecked = selectedAsins.includes(v.asin);
                    return (
                      <label
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 6px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: isChecked ? 'rgba(255,255,255,0.06)' : 'transparent',
                          fontSize: '0.82rem',
                          marginBottom: 2
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedAsins(prev => [...prev, v.asin]);
                            else setSelectedAsins(prev => prev.filter(a => a !== v.asin));
                          }}
                        />
                        {v.imageUrl && (
                          <img src={v.imageUrl} alt="" style={{ width: 22, height: 22, objectFit: 'contain', background: '#fff', borderRadius: 3 }} />
                        )}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>[{v.dimension}]</span>
                          {v.value} {v.isCurrent && <span style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>(current)</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Grouping mode checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-muted)', marginBottom: 18 }}>
              <input
                type="checkbox"
                checked={separateCards}
                onChange={e => setSeparateCards(e.target.checked)}
              />
              Create separate dashboard cards for each variation
            </label>

            <button
              onClick={handleConfirmVariations}
              disabled={selectedAsins.length === 0}
              className="btn-primary"
              style={{ width: '100%', padding: '10px 16px', fontSize: '0.95rem' }}
            >
              Queue {selectedAsins.length} {selectedAsins.length === 1 ? 'Item' : 'Items'} for Comparison
            </button>
          </div>
        )}

        {phase === 'done' && (
          <>
            <CheckCircle2 size={36} color="var(--success)" style={{ margin: '0 auto' }} />
            <h3 style={{ margin: '14px 0 6px' }}>Queued for Comparison!</h3>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.4 }}>
              Item saved to your queue. Next time you open StockSense, you'll be prompted to confirm alternative sellers and group this item.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <a className="btn-primary" style={{ display: 'inline-block' }} href={window.location.origin} target="_blank" rel="noreferrer">
                <ExternalLink size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} /> Open Dashboard
              </a>
              <button className="tab-btn" onClick={() => window.close()} style={{ border: '1px solid var(--border)' }}>
                Close
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <XCircle size={32} color="var(--danger)" />
            <p style={{ marginTop: 16, color: 'var(--danger)' }}>{error}</p>
            <a className="btn-primary" style={{ display: 'inline-block', marginTop: 12 }} href={window.location.origin} target="_blank" rel="noreferrer">
              <ExternalLink size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} /> Open Dashboard
            </a>
          </>
        )}
      </div>
      <style>{`
        .add-watchlist-spin { animation: addWatchlistSpin 1s linear infinite; }
        @keyframes addWatchlistSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
