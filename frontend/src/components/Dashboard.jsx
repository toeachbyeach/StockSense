import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw, Plus, TrendingDown, Trash2, Layers, Bookmark, CheckCircle2, Repeat, ShoppingBag, ScanBarcode, Store, Search, ExternalLink, X, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { buildAffiliateUrl } from '../utils/affiliate';
import BarcodeScannerModal from './BarcodeScannerModal';

const getWebsiteName = (url) => {
  if (!url) return 'Alternative';
  if (url.includes('coles.com.au')) return 'Coles';
  if (url.includes('woolworths.com.au')) return 'Woolworths';
  if (url.includes('aldi.com.au')) return 'ALDI';
  if (url.includes('amazon.')) return 'Amazon';
  if (url.includes('chemistwarehouse.com.au')) return 'Chemist Warehouse';
  if (url.includes('petcircle.com.au')) return 'Pet Circle';
  if (url.includes('bunnings.com.au')) return 'Bunnings';
  if (url.includes('officeworks.com.au')) return 'Officeworks';
  if (url.includes('jbhifi.com.au')) return 'JB Hi-Fi';
  if (url.includes('thegoodguys.com.au')) return 'The Good Guys';
  if (url.includes('theiconic.com.au')) return 'The Iconic';
  if (url.includes('danmurphys.com.au')) return "Dan Murphy's";
  if (url.includes('priceline.com.au')) return 'Priceline Pharmacy';
  if (url.includes('terrywhitechemmart.com.au')) return 'TerryWhite Chemmart';
  if (url.includes('cincottachemist.com.au')) return 'Cincotta Chemist';
  if (url.includes('bloomsthechemist.com.au')) return 'Blooms The Chemist';
  if (url.includes('petbarn.com.au')) return 'Petbarn';
  if (url.includes('petstock.com.au')) return 'Petstock';
  if (url.includes('budgetpetproducts.com.au')) return 'Budget Pet Products';
  if (url.includes('petchemist.com.au')) return 'Pet Chemist';
  if (url.includes('ozbargain.com.au')) return 'OzBargain';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return 'Alternative'; }
};

const formatDateTime = (dateVal) => {
  if (!dateVal) return 'Last updated: --';
  const str = typeof dateVal === 'string' && !dateVal.endsWith('Z') && dateVal.includes(' ')
    ? dateVal.replace(' ', 'T') + 'Z'
    : dateVal;
  const d = new Date(str);
  if (isNaN(d.getTime())) return 'Last updated: --';
  return `Updated: ${d.toLocaleString()}`;
};

function SparkDot({ cx, cy, index, maxIdx, minIdx, midIdx, data }) {
  if (cx == null || cy == null) return null;
  const isMax = index === maxIdx;
  const isMin = index === minIdx;
  const isMid = index === midIdx;

  if (!isMax && !isMin && !isMid) return null;
  const pt = data && data[index];
  if (!pt || pt.price == null) return null;

  const priceNum = Number(pt.price);
  const priceStr = `$${priceNum.toFixed(2)}`;
  const label = isMid ? priceStr : (isMax ? `▲ ${priceStr}` : `▼ ${priceStr}`);
  const dotColor = isMid ? '#38bdf8' : (isMax ? '#ef4444' : '#10b981');
  const textColor = isMid ? '#7dd3fc' : (isMax ? '#fca5a5' : '#6ee7b7');
  const borderColor = isMid ? 'rgba(56, 189, 248, 0.5)' : (isMax ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.6)');

  const pillW = Math.max(42, label.length * 6.6 + 10);
  const pillH = 16;
  const pillX = Math.max(pillW / 2 + 2, cx);
  let pillY = (isMax || isMid) ? cy - 11 : cy + 11;
  if (pillY - pillH / 2 < 2) pillY = pillH / 2 + 2;
  if (pillY + pillH / 2 > 68) pillY = 68 - pillH / 2;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={3} fill={dotColor} stroke="#ffffff" strokeWidth={1.5} />
      <rect
        x={pillX - pillW / 2}
        y={pillY - pillH / 2}
        width={pillW}
        height={pillH}
        rx={4}
        ry={4}
        fill="#0f172a"
        stroke={borderColor}
        strokeWidth={1}
      />
      <text
        x={pillX}
        y={pillY + 0.5}
        fill={textColor}
        fontSize="9.5"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  );
}

function SparklineChart({ data }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        No history yet
      </div>
    );
  }

  const prices = data.map(d => Number(d.price) || 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const isFlat = Math.abs(maxPrice - minPrice) < 0.001;

  const maxIdx = isFlat ? -1 : data.findIndex(d => Number(d.price) === maxPrice);
  const minIdx = isFlat ? -1 : data.findLastIndex(d => Number(d.price) === minPrice);
  const midIdx = isFlat ? Math.floor(data.length / 2) : -1;

  const spread = maxPrice - minPrice;
  const pad = isFlat ? (minPrice * 0.1 || 1) : Math.max(spread * 0.35, 0.5);
  const yDomain = [Math.max(0, minPrice - pad), maxPrice + pad];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, bottom: 12, left: 26, right: 26 }}>
        <YAxis domain={yDomain} hide />
        <XAxis dataKey="day" hide />
        <Tooltip
          formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Price']}
          labelFormatter={(l) => l}
          contentStyle={{
            background: 'rgba(15,23,42,0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            fontSize: '0.8rem'
          }}
        />
        <Line
          type="stepAfter"
          dataKey="price"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={<SparkDot maxIdx={maxIdx} minIdx={minIdx} midIdx={midIdx} data={data} />}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}


export default function Dashboard({ onItemClick, onNavigateTab }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedForDelete, setSelectedForDelete] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [showRoutineAdd, setShowRoutineAdd] = useState(false);
  const [routineUrl, setRoutineUrl] = useState('');
  const [routineFreq, setRoutineFreq] = useState('weekly');
  const [routineQty, setRoutineQty] = useState(1);
  const [routinePromoteId, setRoutinePromoteId] = useState('');
  const [sortKey, setSortKey] = useState(() => {
    try { return localStorage.getItem('stocksense_sortKey') || ''; } catch { return ''; }
  });
  const [sortOrder, setSortOrder] = useState(() => {
    try { return localStorage.getItem('stocksense_sortOrder') || 'desc'; } catch { return 'desc'; }
  });
  const [onlyOnSale, setOnlyOnSale] = useState(() => {
    try { return localStorage.getItem('stocksense_onlyOnSale') === '1'; } catch { return false; }
  });
  const [saleThreshold, setSaleThreshold] = useState(() => {
    try { const v = localStorage.getItem('stocksense_saleThreshold'); return v !== null ? Number(v) : 20; } catch { return 20; }
  });
  const [minHistory, setMinHistory] = useState(() => {
    try { const v = localStorage.getItem('stocksense_minHistory'); return v !== null ? Number(v) : 3; } catch { return 3; }
  });
  const [matchResults, setMatchResults] = useState(null);
  const [selectedUrls, setSelectedUrls] = useState([]);
  const [itemQuantities, setItemQuantities] = useState({});
  const [manualUrl, setManualUrl] = useState('');
  const [taskStatus, setTaskStatus] = useState('');
  const [separateGroups, setSeparateGroups] = useState(() => {
    try { return localStorage.getItem('stocksense_separateGroups') === '1'; } catch { return false; }
  });
  const [showVariations, setShowVariations] = useState(() => {
    try { return localStorage.getItem('stocksense_showVariations') === '1'; } catch { return false; }
  });
  const [columns, setColumns] = useState(3);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [sparklines, setSparklines] = useState({}); // groupId -> [{day, price}]
  const [pendingItems, setPendingItems] = useState([]);
  const [activePendingId, setActivePendingId] = useState(null);
  const [activeTag, setActiveTag] = useState('All');
  const [giftCardDiscount, setGiftCardDiscount] = useState(0);
  const [isBarcodeOpen, setIsBarcodeOpen] = useState(false);
  const [singleSourceAudit, setSingleSourceAudit] = useState([]);
  const [showAuditInbox, setShowAuditInbox] = useState(false);
  const [dismissingAuditId, setDismissingAuditId] = useState(null);
  const [affiliateSettings, setAffiliateSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('stocksense_affiliate_settings') || '{}');
    } catch (e) {
      return {};
    }
  });

  // Persist sort/filter/view prefs to localStorage whenever they change
  useEffect(() => { try { localStorage.setItem('stocksense_sortKey', sortKey); } catch {} }, [sortKey]);
  useEffect(() => { try { localStorage.setItem('stocksense_sortOrder', sortOrder); } catch {} }, [sortOrder]);
  useEffect(() => { try { localStorage.setItem('stocksense_onlyOnSale', onlyOnSale ? '1' : '0'); } catch {} }, [onlyOnSale]);
  useEffect(() => { try { localStorage.setItem('stocksense_saleThreshold', String(saleThreshold)); } catch {} }, [saleThreshold]);
  useEffect(() => { try { localStorage.setItem('stocksense_minHistory', String(minHistory)); } catch {} }, [minHistory]);
  useEffect(() => { try { localStorage.setItem('stocksense_separateGroups', separateGroups ? '1' : '0'); } catch {} }, [separateGroups]);
  useEffect(() => { try { localStorage.setItem('stocksense_showVariations', showVariations ? '1' : '0'); } catch {} }, [showVariations]);

  useEffect(() => {
    fetchItems();
    fetchPendingItems();
    fetchSingleSourceAudit();
    // Load dashboardColumns from server settings on mount
    (async () => {
      try {
        const res = await axios.get('/api/settings');
        if (res.data) {
          if (res.data.giftCardDiscount) {
            setGiftCardDiscount(Number(res.data.giftCardDiscount));
          }
          const aff = {
            amazonAssociateTag: res.data.amazonAssociateTag || '',
            affiliatePrefix: res.data.affiliatePrefix || ''
          };
          setAffiliateSettings(aff);
          try {
            localStorage.setItem('stocksense_affiliate_settings', JSON.stringify(aff));
          } catch (e) {}
        }
        let serverCols = res.data && res.data.dashboardColumns ? Number(res.data.dashboardColumns) : 3;
        // If a preview is enabled in localStorage, prefer that value so preview persists across navigation
        try {
          const previewEnabled = localStorage.getItem('stocksense_preview_enabled');
          const previewCols = localStorage.getItem('stocksense_preview_columns');
          if (previewEnabled === '1' && previewCols) {
            setColumns(Math.max(1, Math.min(10, Number(previewCols))));
          } else {
            setColumns(serverCols);
          }
        } catch (e) {
          setColumns(serverCols);
        }
      } catch (e) {
        // Ignore
      }
    })();
  }, []);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);

    // Listen for preview changes via localStorage (other tabs) and custom events (same tab)
    const onStorage = (e) => {
      if (e.key === 'stocksense_preview_columns') {
        try {
          const v = e.newValue ? Number(e.newValue) : null;
          if (v) setColumns(Math.max(1, Math.min(10, v)));
        } catch (ex) {}
      }
    };
    const onPreviewEvent = (ev) => {
      try {
        const v = ev?.detail ? Number(ev.detail) : null;
        if (v) setColumns(Math.max(1, Math.min(10, v)));
      } catch (ex) {}
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('stocksense_preview_columns', onPreviewEvent);
    window.addEventListener('focus', fetchPendingItems);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('stocksense_preview_columns', onPreviewEvent);
      window.removeEventListener('focus', fetchPendingItems);
    };
  }, []);

  useEffect(() => {
    let interval;
    if (syncing || matching) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get('/api/status');
          setTaskStatus(res.data.status);
        } catch (e) {}
      }, 1000);
    } else {
      setTaskStatus('');
    }
    return () => clearInterval(interval);
  }, [syncing, matching]);

  // Auto-refresh items if any are pending/scanning
  useEffect(() => {
    const needsRefresh = items.some(item => 
      !item.name || 
      (!item.currentPrice && (!item.status || item.status === 'OK' || item.status === 'Pending' || item.status.includes('Scraping')))
    );
    
    if (needsRefresh && !syncing) {
      const interval = setInterval(() => {
        fetchItems();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [items, syncing]);

  // fetchItems accepts optional overrides so UI controls can trigger
  // an immediate fetch with their new value (avoids stale state issues).
  const fetchItems = async (overrides = {}) => {
    console.log('[DEBUG-UI] fetchItems called! Token exists?', !!localStorage.getItem('stocksense_token'));
    try {
      const usedSortKey = overrides.sortKey !== undefined ? overrides.sortKey : sortKey;
      const usedSortOrder = overrides.sortOrder !== undefined ? overrides.sortOrder : sortOrder;
      const usedOnlyOnSale = overrides.onlyOnSale !== undefined ? overrides.onlyOnSale : onlyOnSale;
      const usedSaleThreshold = overrides.saleThreshold !== undefined ? overrides.saleThreshold : saleThreshold;
      const usedMinHistory = overrides.minHistory !== undefined ? overrides.minHistory : minHistory;

      const params = new URLSearchParams();
      params.set('_t', Date.now());
      if (usedSortKey) params.set('sort', usedSortKey);
      if (usedSortOrder) params.set('order', usedSortOrder);
      if (usedOnlyOnSale) params.set('onsale', '1');
      if (usedSaleThreshold) params.set('saleThreshold', String(usedSaleThreshold));
      if (usedMinHistory) params.set('minHistory', String(usedMinHistory));
      const url = '/api/items?' + params.toString();
      console.log(`[DEBUG-UI] Requesting: ${url}`);
      const res = await axios.get(url);
      console.log(`[DEBUG-UI] Received response with ${res.data.length} items. IDs:`, res.data.map(i => i.id));
      setItems(res.data);
      fetchPendingItems();
      // Fetch sparkline history for all loaded groups in one batch
      if (res.data.length > 0) {
        try {
          const ids = res.data.map(i => i.id);
          const histRes = await axios.post('/api/history/batch', { ids, days: 30 });
          setSparklines(histRes.data || {});
        } catch (e) {
          console.warn('[DEBUG-UI] Batch history fetch failed:', e);
        }
      }
    } catch (e) {
      console.error('[DEBUG-UI] Error fetching items:', e);
    }
  };

  const fetchPendingItems = async () => {
    try {
      const res = await axios.get('/api/pending-items');
      setPendingItems(res.data || []);
    } catch (e) {
      console.warn('Failed to fetch pending items:', e);
    }
  };

  const handleReviewPending = async (item) => {
    setActivePendingId(item.id);
    setError(null);
    setNewUrl(item.url);

    // If matchResults is already cached on the pending item, use it immediately!
    if (item.matchResults && item.matchResults.original) {
      const resData = item.matchResults;
      setMatchResults(resData);
      setSelectedUrls([resData.original.url]);
      const qtys = {};
      const allMatches = [resData.original, ...(resData.alternatives || [])];
      allMatches.forEach(m => {
        qtys[m.url] = {
          packQuantity: m.packQuantity || 1,
          volumeQuantity: m.volumeQuantity || 1,
          volumeUnit: m.volumeUnit || '',
          unitPricingEnabled: m.unitPricingEnabled === true || m.unitPricingEnabled === 1
        };
      });
      setItemQuantities(qtys);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Otherwise, call /api/match
    setMatching(true);
    try {
      const res = await axios.post('/api/match', { url: item.url });
      setMatchResults(res.data);
      setSelectedUrls([res.data.original.url]);
      const qtys = {};
      const allMatches = [res.data.original, ...(res.data.alternatives || [])];
      allMatches.forEach(m => {
        qtys[m.url] = {
          packQuantity: m.packQuantity || 1,
          volumeQuantity: m.volumeQuantity || 1,
          volumeUnit: m.volumeUnit || '',
          unitPricingEnabled: m.unitPricingEnabled === true || m.unitPricingEnabled === 1
        };
      });
      setItemQuantities(qtys);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setMatching(false);
    }
  };

  const handleDismissPending = async (id) => {
    try {
      await axios.delete(`/api/pending-items/${id}`);
      setPendingItems(prev => prev.filter(p => p.id !== id));
      if (activePendingId === id) {
        setActivePendingId(null);
        setMatchResults(null);
      }
    } catch (e) {
      console.error('Failed to dismiss pending item:', e);
    }
  };

  const fetchSingleSourceAudit = async () => {
    try {
      const res = await axios.get('/api/audit/single-source');
      setSingleSourceAudit(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.warn('Failed to fetch single-source audit:', e);
    }
  };

  const handleDismissAudit = async (groupId, e) => {
    if (e) e.stopPropagation();
    setDismissingAuditId(groupId);
    try {
      await axios.post('/api/audit/dismiss', { groupId });
      setSingleSourceAudit(prev => prev.filter(a => a.id !== groupId));
    } catch (err) {
      console.error('Failed to dismiss audit item:', err);
    } finally {
      setDismissingAuditId(null);
    }
  };

  const handleBarcodeDetected = (product) => {
    if (product && product.name) {
      setNewUrl(product.name);
      setTimeout(() => {
        const btn = document.getElementById('btn-add-item-submit');
        if (btn) btn.click();
      }, 100);
    }
  };

  const handleMatch = async (e) => {
    e.preventDefault();
    if (!newUrl) return;
    setActivePendingId(null);
    setError(null);
    setMatching(true);
    try {
      const res = await axios.post('/api/match', { url: newUrl });
      setMatchResults(res.data);
      setSelectedUrls([res.data.original.url]);
      
      const qtys = {};
      const allMatches = [res.data.original, ...res.data.alternatives];
      allMatches.forEach(m => {
        qtys[m.url] = { 
          packQuantity: m.packQuantity || 1, 
          volumeQuantity: m.volumeQuantity || 1, 
          volumeUnit: m.volumeUnit || '',
          unitPricingEnabled: m.unitPricingEnabled === true || m.unitPricingEnabled === 1
        };
      });
      setItemQuantities(qtys);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      console.error(e);
    } finally {
      setMatching(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!matchResults) return;
    setMatching(true);
    try {
      const variationItems = (matchResults.original.variations?.allVariations || []).map(v => ({
        url: v.url,
        name: `${matchResults.original.name} (${v.value})`,
        imageUrl: v.imageUrl || matchResults.original.imageUrl
      }));
      const allMatches = [matchResults.original, ...matchResults.alternatives, ...variationItems];
      const itemsData = selectedUrls.map(url => {
        const match = allMatches.find(m => m.url === url) || { url };
        const qty = itemQuantities[url] || { packQuantity: 1, volumeQuantity: 1, volumeUnit: '', unitPricingEnabled: false };
        return { ...match, ...qty };
      });
      
      await axios.post('/api/groups', {
        name: matchResults.original.name,
        type: 'watching',
        intervalWeeks: 4,
        itemsData,
        separateGroups,
        pendingId: activePendingId
      });
      if (activePendingId) {
        setPendingItems(prev => prev.filter(p => p.id !== activePendingId));
        setActivePendingId(null);
      }
      setMatchResults(null);
      setNewUrl('');
      setSeparateGroups(false);
      setShowVariations(false);
      fetchItems();
    } catch(e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setMatching(false);
    }
  };

  const [manualLoading, setManualLoading] = useState(false);
  const handleAddManualUrl = async () => {
    if (!manualUrl || selectedUrls.includes(manualUrl)) return;
    setManualLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/match/manual', { url: manualUrl });
      if (res.data.alternatives && res.data.alternatives.length > 0) {
        setMatchResults(prev => ({
          ...prev,
          alternatives: [...prev.alternatives, res.data.alternatives[0]]
        }));
        setSelectedUrls(prev => [...prev, manualUrl]);
        setManualUrl('');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setManualLoading(false);
    }
  };

  const deleteItem = async (id) => {
    if (!window.confirm("Are you sure you want to delete this group?")) return;
    try {
      setItems(prev => prev.filter(i => i.id !== id));
      await axios.delete(`/api/items/${id}`);
      fetchItems();
    } catch (e) {
      console.error('Failed to delete item', e);
      fetchItems();
    }
  };

  const handleBulkDelete = async () => {
    if (selectedForDelete.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedForDelete.length} groups?`)) return;
    
    try {
      setItems(prev => prev.filter(i => !selectedForDelete.includes(i.id)));
      for (const id of selectedForDelete) {
        await axios.delete(`/api/items/${id}`);
      }
      setSelectedForDelete([]);
      fetchItems();
    } catch (e) {
      console.error('Failed to bulk delete', e);
      fetchItems();
    }
  };

  const syncPrices = async () => {
    setSyncing(true);
    try {
      await axios.post('/api/sync');
      setTimeout(fetchItems, 3000); // Give it time to scrape
    } finally {
      setSyncing(false);
    }
  };

  const routineItems = items.filter(i => i.isRoutine === 1 || i.isRoutine === true || (i.routineFrequency && i.routineFrequency.trim() !== ''));

  const handleToggleRoutine = async (itemId, currentRoutine, currentFreq, currentQty, e) => {
    if (e) e.stopPropagation();
    const newRoutine = !currentRoutine;
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          isRoutine: newRoutine ? 1 : 0,
          routineFrequency: newRoutine ? (currentFreq || 'weekly') : null,
          routineQuantity: currentQty || 1
        };
      }
      return item;
    }));

    try {
      await axios.post(`/api/items/${itemId}/routine`, {
        isRoutine: newRoutine,
        routineFrequency: newRoutine ? (currentFreq || 'weekly') : null,
        routineQuantity: currentQty || 1
      });
      fetchItems();
    } catch (err) {
      console.error('Failed to toggle routine:', err);
      fetchItems();
    }
  };

  const handleUpdateRoutine = async (itemId, updatedFreq, updatedQty, e) => {
    if (e) e.stopPropagation();
    const qty = Math.max(1, parseInt(updatedQty, 10) || 1);
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        return { ...item, routineFrequency: updatedFreq, routineQuantity: qty };
      }
      return item;
    }));

    try {
      await axios.post(`/api/items/${itemId}/routine`, {
        isRoutine: 1,
        routineFrequency: updatedFreq,
        routineQuantity: qty
      });
    } catch (err) {
      console.error('Failed to update routine settings:', err);
    }
  };

  const handleAddRoutineSubmit = async (e) => {
    if (e) e.preventDefault();
    if (routinePromoteId) {
      const target = items.find(i => String(i.id) === String(routinePromoteId));
      if (target) {
        await handleToggleRoutine(target.id, false, routineFreq, routineQty);
        setRoutinePromoteId('');
        setShowRoutineAdd(false);
        return;
      }
    }
    if (routineUrl) {
      const targetUrl = routineUrl.trim();
      setShowRoutineAdd(false);
      setRoutineUrl('');
      setNewUrl(targetUrl);
      setTimeout(() => {
        const btn = document.getElementById('btn-add-item-submit');
        if (btn) btn.click();
      }, 100);
    }
  };

  return (
    <div>
      <div className="glass-panel" style={{ marginBottom: 32 }}>
        <form onSubmit={handleMatch} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <input 
            type="url" 
            placeholder="Paste link from Amazon, Bunnings, JB Hi-Fi, The Good Guys, Officeworks, Pet Circle, Coles, Woolies, ALDI..." 
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            style={{ flex: 1, minWidth: '300px' }}
            disabled={matching}
          />
          <button id="btn-add-item-submit" type="submit" className="btn-primary" style={{ whiteSpace: 'nowrap' }} disabled={matching}>
            {matching && !matchResults ? <RefreshCw size={18} className="spinning" style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} /> : <Plus size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />}
            {matching && !matchResults ? 'Searching...' : 'Add Item'}
          </button>
          <button
            type="button"
            onClick={() => setIsBarcodeOpen(true)}
            className="tab-btn"
            style={{ border: '1px solid var(--accent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            title="Scan physical product barcode using camera or enter number"
          >
            <ScanBarcode size={18} /> Scan Barcode
          </button>
          <button type="button" onClick={syncPrices} className="btn-primary" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', whiteSpace: 'nowrap' }}>
            <RefreshCw size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} className={syncing ? 'spinning' : ''} />
            {syncing ? 'Syncing...' : 'Sync Prices'}
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={onlyOnSale} onChange={e => { const v = e.target.checked; setOnlyOnSale(v); fetchItems({ onlyOnSale: v }); }} />
              On Sale
            </label>
            <input type="number" min="1" value={saleThreshold} onChange={e => { const v = Number(e.target.value); setSaleThreshold(v); fetchItems({ saleThreshold: v }); }} style={{ width: 80, padding: '6px 8px' }} />%
            <select value={sortKey} onChange={e => { const v = e.target.value; setSortKey(v); fetchItems({ sortKey: v }); }} style={{ padding: '6px 8px' }}>
              <option value="">Sort</option>
              <option value="discount">Biggest Discount</option>
              <option value="price">Price</option>
              <option value="name">Name</option>
              <option value="lastChecked">Last Checked</option>
            </select>
            <select value={sortOrder} onChange={e => { const v = e.target.value; setSortOrder(v); fetchItems({ sortOrder: v }); }} style={{ padding: '6px 8px' }}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
            <input type="number" min="1" value={minHistory} onChange={e => { const v = Number(e.target.value); setMinHistory(v); fetchItems({ minHistory: v }); }} title="Min history points for discount" style={{ width: 60, padding: '6px 8px' }} /> pts
            
          </div>
        </form>
        {taskStatus && <div style={{ color: 'var(--accent)', marginTop: 12, fontSize: '0.9rem', fontStyle: 'italic' }}>↳ {taskStatus}</div>}
        {error && <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: '0.9rem' }}>⚠️ {error}</div>}

        {/* Feature 6: Automated Competitor Linking Inbox (Single-Store Audit) */}
        {singleSourceAudit.length > 0 && (
          <div style={{
            marginTop: 18,
            padding: '12px 16px',
            borderRadius: 10,
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1.5px solid rgba(59, 130, 246, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.92rem', color: '#93c5fd' }}>
                <Store size={18} color="#38bdf8" />
                Competitor Opportunities ({singleSourceAudit.length} item{singleSourceAudit.length > 1 ? 's' : ''} tracked at only 1 store)
              </div>
              <button
                type="button"
                className="tab-btn"
                onClick={() => setShowAuditInbox(!showAuditInbox)}
                style={{ fontSize: '0.78rem', padding: '4px 10px', border: '1px solid var(--border)' }}
              >
                {showAuditInbox ? 'Hide Opportunities' : 'Review Items'}
              </button>
            </div>

            {showAuditInbox && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {singleSourceAudit.map(item => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      gap: 12
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt="" style={{ width: 34, height: 34, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 2, flexShrink: 0 }} />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Only at <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{item.currentStore}</span> ({item.currentPrice ? `$${item.currentPrice.toFixed(2)}` : '--'})
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          setNewUrl(item.name);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                          setTimeout(() => {
                            const btn = document.getElementById('btn-add-item-submit');
                            if (btn) btn.click();
                          }, 100);
                        }}
                        style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                        title="Search Coles, Woolies, ALDI, Amazon for competitors"
                      >
                        <Search size={13} /> Find Competitor
                      </button>

                      <button
                        type="button"
                        className="tab-btn"
                        disabled={dismissingAuditId === item.id}
                        onClick={(e) => handleDismissAudit(item.id, e)}
                        style={{ padding: '5px 10px', fontSize: '0.75rem', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                        title="Mark as store-brand only so it won't repeatedly nag"
                      >
                        Dismiss (Store Brand Only)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Category & Tag Filter Pills */}
        {(() => {
          const allTags = new Set();
          items.forEach(it => {
            if (it.tags) {
              it.tags.split(',').forEach(t => {
                const trimmed = t.trim();
                if (trimmed) allTags.add(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
              });
            }
          });
          const tagList = ['All', ...Array.from(allTags)];
          if (tagList.length <= 1) return null;

          return (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center', marginRight: 4 }}>Filter by Tag:</span>
              {tagList.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className={`tab-btn ${activeTag === tag ? 'active' : ''}`}
                  onClick={() => setActiveTag(tag)}
                  style={{
                    fontSize: '0.8rem',
                    padding: '3px 10px',
                    borderRadius: 16,
                    border: activeTag === tag ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)'
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      {pendingItems.length > 0 && !matchResults && (
        <div className="glass-panel" style={{
          marginBottom: 28,
          border: '1.5px solid var(--accent)',
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(0, 0, 0, 0.45))',
          padding: '16px 20px',
          borderRadius: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bookmark size={20} color="var(--accent)" />
              <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#fff' }}>
                {pendingItems.length === 1 ? '1 Item Queued from Chrome Bookmark' : `${pendingItems.length} Items Queued from Chrome Bookmark`}
              </span>
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Confirm alternative store matches to finish grouping
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingItems.map((item) => (
              <div key={item.id} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                padding: '10px 14px',
                flexWrap: 'wrap',
                gap: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, flex: 1 }}>
                  {item.imageUrl && (
                    <img src={item.imageUrl} alt="" style={{ width: 44, height: 44, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 2, flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                      <span style={{ fontWeight: 500, color: 'var(--accent)' }}>{getWebsiteName(item.url)}</span>
                      {item.price != null && <span>• ${Number(item.price).toFixed(2)}</span>}
                      {item.status === 'ready' && <span style={{ color: 'var(--success)', fontWeight: 600 }}>• Competitor matches ready</span>}
                      {item.status === 'matching' && <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>• Searching comparisons in background...</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    className="btn-primary"
                    onClick={() => handleReviewPending(item)}
                    disabled={matching}
                    style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Layers size={15} />
                    Confirm Item Group
                  </button>
                  <button
                    className="tab-btn"
                    onClick={() => handleDismissPending(item.id)}
                    title="Dismiss item"
                    style={{ padding: '6px 10px', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ROUTINELY BOUGHT PRODUCTS (PANTRY & HOUSEHOLD ESSENTIALS) SECTION        */}
      {/* ========================================================================= */}
      <div className="glass-panel" style={{
        marginBottom: 32,
        padding: '20px 24px',
        borderRadius: 16,
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.75))',
        border: '1.5px solid rgba(16, 185, 129, 0.35)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        {/* Section Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--success)'
            }}>
              <Repeat size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
                  Routinely Bought Products
                </h2>
                <span style={{
                  background: 'rgba(16, 185, 129, 0.2)',
                  color: '#6ee7b7',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  padding: '2px 8px',
                  borderRadius: 12,
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}>
                  {routineItems.length} {routineItems.length === 1 ? 'Staple' : 'Staples'}
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Everyday essentials (flour, milk, coffee, pet food) monitored for deals and automatically fed into your <strong>Shopping List</strong>.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {onNavigateTab && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => onNavigateTab('shopping-list')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.85rem',
                  padding: '7px 14px',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  border: 'none',
                  color: '#fff'
                }}
                title="Open Smart Split Shopping List"
              >
                <ShoppingBag size={16} />
                Open Shopping List ({routineItems.length}) ↗
              </button>
            )}

            <button
              type="button"
              className="tab-btn"
              onClick={() => setShowRoutineAdd(!showRoutineAdd)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.85rem',
                padding: '7px 14px',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: showRoutineAdd ? '#fff' : '#6ee7b7'
              }}
            >
              <Plus size={16} />
              {showRoutineAdd ? 'Cancel' : 'Add Routine Staple'}
            </button>
          </div>
        </div>

        {/* Quick Add Routine Drawer */}
        {showRoutineAdd && (
          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 12,
            padding: '16px 18px',
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>
              Add a recurring pantry product or pet essential:
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {items.filter(i => !(i.isRoutine === 1 || i.isRoutine === true || (i.routineFrequency && i.routineFrequency.trim() !== ''))).length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 260 }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>From Watchlist:</span>
                  <select
                    value={routinePromoteId}
                    onChange={e => setRoutinePromoteId(e.target.value)}
                    style={{ flex: 1, padding: '7px 10px', fontSize: '0.85rem' }}
                  >
                    <option value="">-- Choose tracked product --</option>
                    {items
                      .filter(i => !(i.isRoutine === 1 || i.isRoutine === true || (i.routineFrequency && i.routineFrequency.trim() !== '')))
                      .map(it => (
                        <option key={it.id} value={it.id}>{it.name} (${it.currentPrice ? it.currentPrice.toFixed(2) : '--'})</option>
                      ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Frequency:</span>
                <select
                  value={routineFreq}
                  onChange={e => setRoutineFreq(e.target.value)}
                  style={{ padding: '7px 10px', fontSize: '0.85rem' }}
                >
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly">Monthly</option>
                  <option value="as_needed">As Needed</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Qty:</span>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={routineQty}
                  onChange={e => setRoutineQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{ width: 60, padding: '7px 8px', fontSize: '0.85rem' }}
                />
              </div>

              {routinePromoteId ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleAddRoutineSubmit}
                  style={{ padding: '7px 16px', fontSize: '0.85rem', background: '#10b981', border: 'none' }}
                >
                  Mark as Routine Staple
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 260 }}>
                  <input
                    type="url"
                    placeholder="Or paste link (Coles, Woolies, Amazon...)"
                    value={routineUrl}
                    onChange={e => setRoutineUrl(e.target.value)}
                    style={{ flex: 1, padding: '7px 10px', fontSize: '0.85rem' }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleAddRoutineSubmit}
                    disabled={!routineUrl}
                    style={{ padding: '7px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  >
                    Track Link
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Routine Products List / Grid */}
        {routineItems.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '28px 16px',
            background: 'rgba(0, 0, 0, 0.25)',
            borderRadius: 12,
            border: '1px dashed rgba(16, 185, 129, 0.3)'
          }}>
            <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>🌾 🍞 🥛</div>
            <div style={{ fontWeight: 600, fontSize: '0.98rem', marginBottom: 6 }}>
              No routine staples added yet
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', maxWidth: 540, margin: '0 auto 16px', lineHeight: 1.5 }}>
              Add everyday items you buy routinely (like flour, milk, bread, coffee, or dog food) to track which supermarket has them cheaper every week and automatically build your smart shopping list.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="tab-btn"
                onClick={() => {
                  setNewUrl('https://www.coles.com.au/product/white-wings-plain-flour-1kg-44274');
                }}
                style={{ fontSize: '0.82rem', padding: '5px 12px', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#6ee7b7' }}
              >
                + Try Sample: White Wings Plain Flour
              </button>
              <button
                type="button"
                className="tab-btn"
                onClick={() => {
                  setNewUrl('https://www.woolworths.com.au/shop/productdetails/688081/nescafe-coffee-blend-43');
                }}
                style={{ fontSize: '0.82rem', padding: '5px 12px', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#6ee7b7' }}
              >
                + Try Sample: Coffee Blend 43
              </button>
              {items.length > 0 && (
                <button
                  type="button"
                  className="tab-btn"
                  onClick={() => setShowRoutineAdd(true)}
                  style={{ fontSize: '0.82rem', padding: '5px 12px', border: '1px solid var(--border)' }}
                >
                  Select from existing items ({items.length})
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14
          }}>
            {routineItems.map(item => {
              const qty = item.routineQuantity || 1;
              const freq = item.routineFrequency || 'weekly';
              return (
                <div
                  key={item.id}
                  onClick={() => onItemClick(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    cursor: 'pointer',
                    gap: 12,
                    position: 'relative',
                    transition: 'border-color 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.6)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.3)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" style={{ width: 44, height: 44, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 3, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 44, height: 44, background: 'rgba(16, 185, 129, 0.15)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#6ee7b7' }}>
                        <ShoppingBag size={20} />
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                        {item.name || 'Scanning item...'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 700, color: '#6ee7b7' }}>
                          ${item.currentPrice ? item.currentPrice.toFixed(2) : '--'}
                        </span>
                        {item.unitPriceDisplay && (
                          <span style={{ fontSize: '0.74rem', color: 'var(--accent)', fontWeight: 600 }}>
                            {item.unitPriceDisplay}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        <span style={{
                          background: 'rgba(16, 185, 129, 0.2)',
                          color: '#6ee7b7',
                          border: '1px solid rgba(16, 185, 129, 0.4)',
                          borderRadius: 4,
                          padding: '1px 6px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}>
                          <Repeat size={10} /> {qty}× • {freq}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => handleToggleRoutine(item.id, true, item.routineFrequency, item.routineQuantity, e)}
                      title="Remove from Routine Staples"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: 2,
                        opacity: 0.6
                      }}
                    >
                      ✕
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '2px 4px' }}>
                      <button
                        type="button"
                        onClick={(e) => handleUpdateRoutine(item.id, item.routineFrequency || 'weekly', Math.max(1, qty - 1), e)}
                        style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '0 4px', fontSize: '0.85rem' }}
                        title="Decrease Quantity"
                      >
                        -
                      </button>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{qty}</span>
                      <button
                        type="button"
                        onClick={(e) => handleUpdateRoutine(item.id, item.routineFrequency || 'weekly', qty + 1, e)}
                        style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '0 4px', fontSize: '0.85rem' }}
                        title="Increase Quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedForDelete.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{selectedForDelete.length} selected</span>
          <button onClick={handleBulkDelete} className="btn-primary" style={{ background: 'var(--danger)', border: 'none' }}>
            <Trash2 size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />
            Bulk Delete
          </button>
          <button onClick={() => setSelectedForDelete([])} className="tab-btn" style={{ border: '1px solid var(--border)' }}>
            Cancel
          </button>
        </div>
      )}

      {matchResults && (
        <div className="glass-panel" style={{ marginBottom: 32, border: '2px solid var(--accent)' }}>
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>Confirm Item Group</span>
            {activePendingId && (
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--accent)', background: 'rgba(59, 130, 246, 0.15)', padding: '2px 8px', borderRadius: 4 }}>
                from Chrome Bookmark Queue
              </span>
            )}
          </h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            We found these possible alternative matches across different retailers. Select the ones you want to group together!
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {/* Helper to render quantity inputs */}
            {(() => {
              const renderQtyInputs = (url) => {
                const qtys = itemQuantities[url] || { packQuantity: 1, volumeQuantity: 1, volumeUnit: '', unitPricingEnabled: false };
                const updateQty = (key, val) => {
                  const shouldEnable = ['packQuantity', 'volumeQuantity', 'volumeUnit'].includes(key) ? true : val;
                  setItemQuantities(prev => ({
                    ...prev,
                    [url]: { ...prev[url], [key]: val, unitPricingEnabled: key === 'unitPricingEnabled' ? val : (shouldEnable || (prev[url]?.unitPricingEnabled ?? false)) }
                  }));
                };
                const presets = ['pack', 'chew', 'tab', 'kg', 'g', 'ml', 'L'];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 8 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                        Pack Qty:
                        <input type="number" min="1" step="1" value={qtys.packQuantity} onChange={e => updateQty('packQuantity', parseInt(e.target.value) || 1)} style={{ width: 55, padding: '3px 6px' }} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                        Size:
                        <input type="number" min="0.1" step="0.1" value={qtys.volumeQuantity} onChange={e => updateQty('volumeQuantity', parseFloat(e.target.value) || 1)} style={{ width: 60, padding: '3px 6px' }} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                        Unit:
                        <input type="text" placeholder="chew, kg..." value={qtys.volumeUnit} onChange={e => updateQty('volumeUnit', e.target.value)} style={{ width: 65, padding: '3px 6px' }} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={qtys.unitPricingEnabled === true} onChange={e => updateQty('unitPricingEnabled', e.target.checked)} />
                        Apply unit pricing
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quick Unit:</span>
                      {presets.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => { updateQty('volumeUnit', p); updateQty('unitPricingEnabled', true); }}
                          style={{
                            background: qtys.volumeUnit === p ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                            color: qtys.volumeUnit === p ? '#fff' : 'var(--text-muted)',
                            border: 'none',
                            borderRadius: 4,
                            padding: '1px 7px',
                            fontSize: '0.75rem',
                            cursor: 'pointer'
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              };

              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 16, background: 'rgba(255,255,255,0.05)', borderRadius: 12 }}>
                    <input type="checkbox" checked={selectedUrls.includes(matchResults.original.url)} readOnly style={{ flexShrink: 0 }} />
                    {matchResults.original.imageUrl && <img src={matchResults.original.imageUrl} style={{ width: '50%', height: 200, objectFit: 'contain', flexShrink: 0, background: 'white', borderRadius: 8, padding: 8 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '1.2rem', lineHeight: 1.3, marginBottom: 8 }}>{matchResults.original.name}</div>
                      <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>{getWebsiteName(matchResults.original.url)} • ${matchResults.original.price || 'Price on selection'}</div>
                      <a href={buildAffiliateUrl(matchResults.original.url, affiliateSettings)} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all' }}>{matchResults.original.url}</a>
                      {renderQtyInputs(matchResults.original.url)}
                    </div>
                  </div>

                  {/* Variations Section */}
                  {matchResults.original.variations && matchResults.original.variations.hasVariations && (
                    <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.95rem', color: 'var(--accent)' }}>
                          <Layers size={18} />
                          <span>Product Variations ({matchResults.original.variations.dimensions.join(', ')})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowVariations(!showVariations)}
                          className="tab-btn"
                          style={{ fontSize: '0.8rem', padding: '3px 8px' }}
                        >
                          {showVariations ? 'Hide Individual Options' : `Show Options (${matchResults.original.variations.allVariations.length})`}
                        </button>
                      </div>

                      {/* Quick Select Buttons */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        {(matchResults.original.variations.dimensionOptions['Colour Name'] || matchResults.original.variations.dimensionOptions['Color Name']) && (
                          <button
                            type="button"
                            className="tab-btn"
                            style={{ fontSize: '0.82rem', padding: '4px 10px', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                            onClick={() => {
                              const colorOpts = matchResults.original.variations.dimensionOptions['Colour Name'] || matchResults.original.variations.dimensionOptions['Color Name'] || [];
                              const colorUrls = colorOpts.map(o => `https://www.amazon.com.au/dp/${o.asin}`);
                              setSelectedUrls(prev => Array.from(new Set([...prev, ...colorUrls])));
                            }}
                          >
                            + Select All Colours ({ (matchResults.original.variations.dimensionOptions['Colour Name'] || matchResults.original.variations.dimensionOptions['Color Name']).length })
                          </button>
                        )}
                        {matchResults.original.variations.dimensionOptions['Size Name'] && (
                          <button
                            type="button"
                            className="tab-btn"
                            style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                            onClick={() => {
                              const sizeOpts = matchResults.original.variations.dimensionOptions['Size Name'] || [];
                              const sizeUrls = sizeOpts.map(o => `https://www.amazon.com.au/dp/${o.asin}`);
                              setSelectedUrls(prev => Array.from(new Set([...prev, ...sizeUrls])));
                            }}
                          >
                            + Select All Sizes ({ matchResults.original.variations.dimensionOptions['Size Name'].length })
                          </button>
                        )}
                        <button
                          type="button"
                          className="tab-btn"
                          style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                          onClick={() => {
                            const allUrls = matchResults.original.variations.allVariations.map(v => v.url);
                            setSelectedUrls(prev => Array.from(new Set([...prev, ...allUrls])));
                          }}
                        >
                          + Select All ({ matchResults.original.variations.allVariations.length })
                        </button>
                        <button
                          type="button"
                          className="tab-btn"
                          style={{ fontSize: '0.82rem', padding: '4px 10px', color: 'var(--text-muted)' }}
                          onClick={() => {
                            const varUrls = new Set(matchResults.original.variations.allVariations.map(v => v.url));
                            setSelectedUrls(prev => prev.filter(u => !varUrls.has(u) || u === matchResults.original.url));
                          }}
                        >
                          Deselect Variations
                        </button>
                      </div>

                      {/* Swatches Grid */}
                      {showVariations && (
                        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, padding: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 8, marginTop: 8 }}>
                          {matchResults.original.variations.allVariations.map((v, vIdx) => {
                            const isChecked = selectedUrls.includes(v.url);
                            return (
                              <label
                                key={vIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '6px 8px',
                                  borderRadius: 6,
                                  background: isChecked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                                  border: isChecked ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.04)',
                                  cursor: 'pointer',
                                  fontSize: '0.8rem',
                                  margin: 0
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) setSelectedUrls(prev => [...prev, v.url]);
                                    else setSelectedUrls(prev => prev.filter(u => u !== v.url));
                                  }}
                                />
                                {v.imageUrl && (
                                  <img src={v.imageUrl} alt="" style={{ width: 24, height: 24, objectFit: 'contain', background: '#fff', borderRadius: 4, flexShrink: 0 }} />
                                )}
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{v.dimension}</div>
                                  <div style={{ fontWeight: 500 }}>{v.value}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {matchResults.alternatives.map((alt, idx) => (
                    <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 12, cursor: 'pointer', margin: 0, border: '1px solid rgba(255,255,255,0.05)' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedUrls.includes(alt.url)} 
                        onChange={(e) => {
                          if (e.target.checked) setSelectedUrls(prev => [...prev, alt.url]);
                          else setSelectedUrls(prev => prev.filter(u => u !== alt.url));
                        }}
                        style={{ flexShrink: 0 }}
                      />
                      {alt.imageUrl && <img src={alt.imageUrl} style={{ width: '50%', height: 200, objectFit: 'contain', flexShrink: 0, background: 'white', borderRadius: 8, padding: 8 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '1.2rem', lineHeight: 1.3, marginBottom: 8 }}>{alt.name}</div>
                        <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>{getWebsiteName(alt.url)} • ${alt.price}</div>
                        <a href={buildAffiliateUrl(alt.url, affiliateSettings)} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 6, fontSize: '0.9rem', color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all' }} onClick={(e) => e.stopPropagation()}>{alt.url}</a>
                        {renderQtyInputs(alt.url)}
                      </div>
                    </label>
                  ))}

                  {/* Render manually added URLs */}
                  {selectedUrls
                    .filter(u => u !== matchResults.original.url && !matchResults.alternatives.find(a => a.url === u))
                    .map((u, idx) => (
                    <label key={`manual-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 12, cursor: 'pointer', margin: 0, border: '1px solid rgba(255,255,255,0.05)' }}>
                      <input 
                        type="checkbox" 
                        checked={true} 
                        onChange={(e) => {
                          if (!e.target.checked) setSelectedUrls(prev => prev.filter(prevU => prevU !== u));
                        }}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={{ width: '50%', height: 200, background: 'rgba(255,255,255,0.05)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Plus size={48} opacity={0.5} />
                      </div>
                      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '1.2rem', lineHeight: 1.3, marginBottom: 8 }}>Manually Added Link</div>
                        <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u}</div>
                        {renderQtyInputs(u)}
                      </div>
                    </label>
                  ))}
                </>
              );
            })()}

            {/* Search Fallbacks */}
            {matchResults.alternatives.length === 0 && (
              <div style={{ padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, marginTop: 12 }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 8, fontSize: '0.9rem' }}>Didn't find anything automatically? Try searching directly:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={buildAffiliateUrl(`https://www.coles.com.au/search?q=${encodeURIComponent(matchResults.original.name)}`, affiliateSettings)} target="_blank" rel="noreferrer" className="btn-primary" style={{ background: '#e01a22', textDecoration: 'none', padding: '6px 12px', fontSize: '0.9rem' }}>
                    Search Coles
                  </a>
                  <a href={buildAffiliateUrl(`https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(matchResults.original.name)}`, affiliateSettings)} target="_blank" rel="noreferrer" className="btn-primary" style={{ background: '#178841', textDecoration: 'none', padding: '6px 12px', fontSize: '0.9rem' }}>
                    Search Woolworths
                  </a>
                  <a href={buildAffiliateUrl(`https://www.chemistwarehouse.com.au/search?query=${encodeURIComponent(matchResults.original.name)}&contexts=default`, affiliateSettings)} target="_blank" rel="noreferrer" className="btn-primary" style={{ background: '#0070ba', textDecoration: 'none', padding: '6px 12px', fontSize: '0.9rem' }}>
                    Search Chemist Warehouse
                  </a>
                  <a href={`https://www.aldi.com.au/results?q=${encodeURIComponent(matchResults.original.name)}`} target="_blank" rel="noreferrer" className="btn-primary" style={{ background: '#002d72', textDecoration: 'none', padding: '6px 12px', fontSize: '0.9rem' }}>
                    Search ALDI
                  </a>
                </div>
              </div>
            )}

            {/* Input to manually add URLs */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input 
                type="url" 
                placeholder="Paste Coles, Woolies, or Chemist Warehouse product URL here..." 
                value={manualUrl}
                onChange={e => setManualUrl(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 4, color: 'white' }}
                disabled={manualLoading}
              />
              <button 
                type="button" 
                className="btn-primary"
                onClick={handleAddManualUrl}
                disabled={manualLoading}
              >
                {manualLoading ? 'Extracting...' : 'Add Link'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={separateGroups}
                onChange={e => setSeparateGroups(e.target.checked)}
              />
              Create separate dashboard cards for each selected item
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleCreateGroup} className="btn-primary" disabled={matching}>
                {matching ? 'Creating...' : `Add to Watchlist (${selectedUrls.length})`}
              </button>
              <button onClick={() => { setMatchResults(null); setActivePendingId(null); }} className="tab-btn" style={{ border: '1px solid var(--border)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First-time Onboarding banner if no items tracked */}
      {items.length === 0 && !matching && (
        <div className="glass-panel" style={{
          textAlign: 'center',
          padding: '48px 24px',
          borderRadius: 16,
          border: '1.5px dashed var(--accent)',
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(0, 0, 0, 0.4))',
          marginBottom: 32
        }}>
          <h2 style={{ fontSize: '1.6rem', marginBottom: 12, fontWeight: 700 }}>
            Welcome to StockSense! 🛒
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 560, margin: '0 auto 24px', lineHeight: 1.6, fontSize: '0.98rem' }}>
            Start saving on your everyday Australian shopping. Paste a product link from Amazon AU, Coles, Woolworths, Chemist Warehouse, Bunnings, or JB Hi-Fi above to start tracking real prices and deals.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setNewUrl('https://www.woolworths.com.au/shop/productdetails/688081/nescafe-coffee-blend-43');
              }}
              style={{ fontSize: '0.9rem' }}
            >
              Try Sample Product (Nescafé Blend 43)
            </button>
            <button
              type="button"
              className="tab-btn"
              onClick={() => {
                setNewUrl('https://www.petcircle.com.au/product/nexgard-spectra-very-large-dog/dhn2245');
              }}
              style={{ border: '1px solid var(--border)', fontSize: '0.9rem' }}
            >
              Try Pet Circle (Nexgard Spectra)
            </button>
          </div>
        </div>
      )}

      {/* Compute card image height based on column count so cards scale */}
      <div className="item-grid" data-columns style={{
        ['--columns']: (windowWidth < 600) ? Math.min(2, columns) : columns,
        // Simple scaling: base height 260px at 3 columns. Scale inversely with columns.
        ['--card-img-height']: `${Math.max(120, Math.round(260 * (3 / Math.max(1, columns))))}px`
      }}
      >
        {items
          .filter(item => {
            if (activeTag === 'All') return true;
            if (!item.tags) return false;
            const itemTags = item.tags.split(',').map(t => t.trim().toLowerCase());
            return itemTags.includes(activeTag.replace('#', '').toLowerCase());
          })
          .map(item => {
          const isOos = item.inStock === 'Out of Stock';
          const isError = !isOos && item.status && item.status !== 'OK' && item.status !== 'Pending';
          return (
          <div 
            key={item.id} 
            className={`glass-panel item-card${isOos ? ' item-card--oos' : isError ? ' item-card--error' : ''}`}
            style={{ position: 'relative', cursor: 'pointer' }}
            onClick={() => {
              console.log(`[DEBUG-UI] User clicked item in dashboard. Passed ID to onItemClick: ${item.id}`);
              onItemClick(item.id);
            }}
          >
            <input 
              type="checkbox" 
              checked={selectedForDelete.includes(item.id)}
              onChange={(e) => {
                if (e.target.checked) setSelectedForDelete(prev => [...prev, item.id]);
                else setSelectedForDelete(prev => prev.filter(id => id !== item.id));
              }}
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', top: 12, left: 12, width: 18, height: 18, zIndex: 10, cursor: 'pointer' }}
            />
            <button 
              type="button"
              onClick={(e) => handleToggleRoutine(item.id, Boolean(item.isRoutine || item.routineFrequency), item.routineFrequency, item.routineQuantity, e)} 
              style={{
                position: 'absolute',
                top: 10,
                right: 38,
                background: (item.isRoutine || item.routineFrequency) ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                border: (item.isRoutine || item.routineFrequency) ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(255, 255, 255, 0.15)',
                color: (item.isRoutine || item.routineFrequency) ? '#6ee7b7' : 'var(--text-muted)',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                zIndex: 10
              }}
              title={(item.isRoutine || item.routineFrequency) ? "In Routine Staples (Click to remove)" : "Mark as Routinely Bought (Feeds Shopping List)"}
            >
              <Repeat size={12} />
              {(item.isRoutine || item.routineFrequency) ? 'Routine' : '+ Routine'}
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }} 
              style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.7 }}
              title="Delete Item"
            >
              <Trash2 size={18} />
            </button>
            {item.imageUrl ? (
              <div className="item-image-wrap">
                <img src={item.imageUrl} alt={item.name} className="item-image" />
                {isOos && (
                  <div className="oos-ribbon">
                    <span className="oos-ribbon-label">Out of Stock</span>
                  </div>
                )}
                {!isOos && isError && (
                  <div className="oos-ribbon oos-ribbon--error">
                    <span className="oos-ribbon-label">Scan Error</span>
                  </div>
                )}
              </div>
            ) : null}
            <div className="item-title" style={{ paddingRight: 24 }}>{item.name || 'Scanning...'}</div>
            
            {/* Price row: current | avg + % diff | badges */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
              {/* Current price */}
              <div style={{ minWidth: 0 }}>
                {(() => {
                  const isTrackingUsed = item.currentPrice != null && item.usedPrice != null && Math.abs(item.currentPrice - item.usedPrice) < 0.01;
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Current</span>
                        {isTrackingUsed && (
                          <span style={{
                            background: '#d97706',
                            color: '#ffffff',
                            fontSize: '0.62rem',
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: 3,
                            letterSpacing: '0.5px'
                          }}>
                            USED
                          </span>
                        )}
                      </div>
                      <div className="price-tag" style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span>{item.isEstimate ? '~' : ''}${item.currentPrice ? item.currentPrice.toFixed(2) : '--'}</span>
                        {isTrackingUsed && (
                          <span style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600 }}>
                            ({item.usedCondition ? item.usedCondition.replace(/^Used\s*[-–—]\s*/i, '') : 'Resale'})
                          </span>
                        )}
                      </div>
                      {item.unitPriceDisplay && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, marginTop: 1, marginBottom: 2 }}>
                          {item.unitPriceDisplay}
                        </div>
                      )}
                      {item.shippingPrice > 0 && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: -2, marginBottom: 2 }}>
                          (incl. ${item.shippingPrice.toFixed(2)} postage)
                        </div>
                      )}
                      {item.usedPrice != null && (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: isTrackingUsed ? 'rgba(245, 158, 11, 0.18)' : 'rgba(245, 158, 11, 0.12)',
                          border: `1px solid ${isTrackingUsed ? 'rgba(245, 158, 11, 0.45)' : 'rgba(245, 158, 11, 0.3)'}`,
                          color: '#fbbf24',
                          borderRadius: 6,
                          padding: '2px 6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          marginTop: 3,
                          marginBottom: 3
                        }}>
                          {isTrackingUsed ? (
                            <>📦 Amazon Resale ({item.usedCondition || 'Used'})</>
                          ) : (
                            <>🏷️ Used from ${item.usedPrice.toFixed(2)}{item.usedCondition ? ` (${item.usedCondition.replace(/^Used\s*[-–—]\s*/i, '')})` : ''}</>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {formatDateTime(item.lastChecked)}
                </div>
              </div>

              {/* Avg price + % diff (only when history exists) */}
              {item.avgPrice != null && item.currentPrice != null && (() => {
                const pct = ((item.currentPrice - item.avgPrice) / item.avgPrice) * 100;
                const below = pct < 0;
                const pctColor = below ? 'var(--success)' : 'var(--danger)';
                const pctLabel = (below ? '▼ ' : '▲ ') + Math.abs(pct).toFixed(1) + '% vs avg';
                return (
                  <div style={{ textAlign: 'center', minWidth: 0 }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 2 }}>Avg</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      ${item.avgPrice.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: pctColor, whiteSpace: 'nowrap' }}>
                      {pctLabel}
                    </div>
                  </div>
                );
              })()}

              {/* Status badges — only shown when something is actually wrong */}
              {item.inStock === 'Out of Stock' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <div className="status-badge badge-outofstock">Out of Stock</div>
                </div>
              )}
            </div>

            {/* Sparkline — real 30-day price history with high/low callouts */}
            <div style={{ height: 70, marginTop: 14 }}>
              <SparklineChart data={sparklines[item.id]} />
            </div>
            
            {item.currentPrice < item.lowestPrice && (
              <div style={{ color: 'var(--success)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                <TrendingDown size={14} /> Lowest Price Ever!
              </div>
            )}

            {/* Smart Deal Quality Badge & Cashback & Gift Card Net Price */}
            {(() => {
              const cp = Number(item.currentPrice);
              const lp = Number(item.lowestPrice);
              const hp = Number(item.highestPrice);
              const ap = Number(item.avgPrice);

              let dealBadge = null;
              if (cp && lp && cp <= lp) {
                dealBadge = { label: '🔥 All-Time Low', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)' };
              } else if (cp && ap && cp < ap * 0.85) {
                dealBadge = { label: '⚡ Exceptional Deal (>15% off avg)', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' };
              } else if (cp && hp && ap && cp >= hp && hp > ap * 1.05) {
                dealBadge = { label: '⚠️ Price Spike (Wait)', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)' };
              }

              const netGiftPrice = giftCardDiscount > 0 && cp ? (cp * (1 - giftCardDiscount / 100)).toFixed(2) : null;

              return (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {dealBadge && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: dealBadge.bg,
                        border: `1px solid ${dealBadge.border}`,
                        color: dealBadge.color,
                        fontWeight: 700
                      }}>
                        {dealBadge.label}
                      </span>
                    )}
                    {netGiftPrice && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: 'rgba(168, 85, 247, 0.12)',
                        border: '1px solid rgba(168, 85, 247, 0.35)',
                        color: '#c084fc',
                        fontWeight: 600
                      }} title={`Calculated with ${giftCardDiscount}% gift card discount from settings`}>
                        💳 ${netGiftPrice} with Gift Card (-{giftCardDiscount}%)
                      </span>
                    )}
                    {item.targetPrice && cp <= item.targetPrice && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: 'rgba(34, 197, 94, 0.15)',
                        border: '1px solid rgba(34, 197, 94, 0.4)',
                        color: '#4ade80',
                        fontWeight: 700
                      }}>
                        🎯 Target Reached (≤${Number(item.targetPrice).toFixed(2)})
                      </span>
                    )}
                  </div>
                  {/* Cashback Portal Helper */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                    <span>Cashback:</span>
                    <a
                      href="https://www.shopback.com.au"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#f87171', textDecoration: 'none', fontWeight: 600 }}
                      onClick={e => e.stopPropagation()}
                    >
                      ShopBack ↗
                    </a>
                    <span>•</span>
                    <a
                      href="https://www.cashrewards.com.au"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#fb923c', textDecoration: 'none', fontWeight: 600 }}
                      onClick={e => e.stopPropagation()}
                    >
                      Cashrewards ↗
                    </a>
                  </div>
                </div>
              );
            })()}
          </div>
          );
        })}
      </div>

      {/* Feature 5: Mobile Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isBarcodeOpen}
        onClose={() => setIsBarcodeOpen(false)}
        onDetected={handleBarcodeDetected}
      />
    </div>
  );
}

// End of Dashboard component
