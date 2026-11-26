import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ArrowLeft, Save, TrendingDown, TrendingUp, Bell, BellOff, Settings, RefreshCcw, CheckCircle2, XCircle, AlertTriangle, Sparkles, Trash2, X, Clock, ExternalLink, Search, RefreshCw, ShoppingCart, Repeat } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LabelList, ReferenceLine } from 'recharts';
import { buildAffiliateUrl, buildAmazonCartLink, isAmazonUrl } from '../utils/affiliate';

const formatDateTime = (dateVal) => {
  if (!dateVal) return 'Last updated: --';
  const str = typeof dateVal === 'string' && !dateVal.endsWith('Z') && dateVal.includes(' ')
    ? dateVal.replace(' ', 'T') + 'Z'
    : dateVal;
  const d = new Date(str);
  if (isNaN(d.getTime())) return 'Last updated: --';
  return `Updated: ${d.toLocaleString()}`;
};

export default function ItemDetails({ itemId, onBack }) {
  const [item, setItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [resetState, setResetState] = useState('idle'); // idle | confirm | running | done | error
  const [cleanState, setCleanState] = useState('idle'); // idle | running | done | error
  const [cleanResult, setCleanResult] = useState(null); // { removed, remaining }
  const [deleteState, setDeleteState] = useState('idle'); // idle | confirm | running | done | error
  
  // Single point deletion popup state
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [deletingPoint, setDeletingPoint] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // History stats: lowest, highest, 30d average
  const [avg30d, setAvg30d] = useState(null);
  const [historyLowest, setHistoryLowest] = useState(null);
  const [historyHighest, setHistoryHighest] = useState(null);
  
  // New source state
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourcePackQty, setNewSourcePackQty] = useState(1);
  const [newSourceVolQty, setNewSourceVolQty] = useState(1);
  const [newSourceVolUnit, setNewSourceVolUnit] = useState('');
  const [newSourceUnitPricingEnabled, setNewSourceUnitPricingEnabled] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  
  // Affiliate / Monetization settings
  const [affiliateSettings, setAffiliateSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('stocksense_affiliate_settings') || '{}');
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    axios.get('/api/settings').then(res => {
      if (res.data) {
        const s = {
          amazonAssociateTag: res.data.amazonAssociateTag || '',
          affiliatePrefix: res.data.affiliatePrefix || ''
        };
        setAffiliateSettings(s);
        try {
          localStorage.setItem('stocksense_affiliate_settings', JSON.stringify(s));
        } catch (e) {}
      }
    }).catch(() => {});
  }, []);
  
  // Edit source state
  const [editingSourceId, setEditingSourceId] = useState(null);
  const [editSourcePackQty, setEditSourcePackQty] = useState(1);
  const [editSourceVolQty, setEditSourceVolQty] = useState(1);
  const [editSourceVolUnit, setEditSourceVolUnit] = useState('');
  const [editSourceUnitPricingEnabled, setEditSourceUnitPricingEnabled] = useState(false);
  const [editSourceTrackCondition, setEditSourceTrackCondition] = useState('any');
  const [editSourceTrackSubscribe, setEditSourceTrackSubscribe] = useState('any');
  const [activePackFilter, setActivePackFilter] = useState(null);

  // Rematch / competitor stores scan state
  const [scanningMatches, setScanningMatches] = useState(false);
  const [rematchResults, setRematchResults] = useState(null);
  const [selectedRematchUrls, setSelectedRematchUrls] = useState([]);
  const [rematchQuantities, setRematchQuantities] = useState({});
  const [addingRematchSources, setAddingRematchSources] = useState(false);
  const [rematchFeedback, setRematchFeedback] = useState(null);

  // Form State
  const [notifyAbove, setNotifyAbove] = useState('');
  const [notifyBelow, setNotifyBelow] = useState('');
  const [isAutoBuy, setIsAutoBuy] = useState(false);
  const [notify, setNotify] = useState(true);
  const [type, setType] = useState('watching');
  const [intervalWeeks, setIntervalWeeks] = useState(4);
  const [isRoutine, setIsRoutine] = useState(false);
  const [routineFrequency, setRoutineFrequency] = useState('weekly');
  const [routineQuantity, setRoutineQuantity] = useState(1);

  useEffect(() => {
    if (itemId) {
      fetchData();
    }
  }, [itemId]);

  const fetchData = async () => {
    console.log(`[DEBUG-UI] ItemDetails fetchData called for ID: ${itemId}`);
    try {
      const urlItem = `/api/items/${itemId}?_t=` + Date.now();
      const urlHist = `/api/items/${itemId}/history?_t=` + Date.now();
      console.log(`[DEBUG-UI] ItemDetails fetching: ${urlItem}`);
      const [itemRes, histRes] = await Promise.all([
        axios.get(urlItem),
        axios.get(urlHist)
      ]);
      
      const itemData = itemRes.data;
      setItem(itemData);
      
      // Initialize form
      setNotifyAbove(itemData.notifyAbove || '');
      setNotifyBelow(itemData.notifyBelow || '');
      setIsAutoBuy(Boolean(itemData.isAutoBuy));
      setNotify(Boolean(itemData.notify));
      setType(itemData.type || 'watching');
      setIntervalWeeks(itemData.intervalWeeks || 4);
      setIsRoutine(Boolean(itemData.isRoutine || itemData.routineFrequency));
      setRoutineFrequency(itemData.routineFrequency || 'weekly');
      setRoutineQuantity(itemData.routineQuantity || 1);

      // Format history for Recharts
      // Use "date|storeKey" as the composite key so each store gets ONE point per calendar day.
      // Multiple scrapes on the same day are collapsed — we keep the LAST reading (latest timestamp).
      // This prevents the dense blob of overlapping circles you'd get from hourly scrapes.
      const storeLastPriceBeforeDay = {}; // tracks price at end of previous day, per store
      const dayStoreMap = new Map(); // key: "dateStr|storeKey" -> raw row h

      // Data arrives in ASC order already; iterate to keep latest per day+store
      histRes.data.forEach(h => {
        const d = new Date(h.timestamp);
        const dateStr = d.toLocaleDateString();
        const url = (h.url || '').toLowerCase();
        let storeKey = 'Other';
        if (url.includes('coles')) storeKey = 'Coles';
        else if (url.includes('woolworths')) storeKey = 'Woolworths';
        else if (url.includes('amazon')) storeKey = 'Amazon';
        else if (url.includes('chemistwarehouse')) storeKey = 'ChemistWarehouse';
        else if (url.includes('priceline')) storeKey = 'Priceline';
        else if (url.includes('terrywhite')) storeKey = 'TerryWhite';
        else if (url.includes('cincotta')) storeKey = 'Cincotta';
        else if (url.includes('bloomsthechemist')) storeKey = 'Blooms';
        else if (url.includes('petcircle')) storeKey = 'PetCircle';
        else if (url.includes('petbarn')) storeKey = 'Petbarn';
        else if (url.includes('petstock')) storeKey = 'Petstock';
        else if (url.includes('budgetpetproducts')) storeKey = 'BudgetPet';
        else if (url.includes('petchemist')) storeKey = 'PetChemist';
        else if (url.includes('bunnings')) storeKey = 'Bunnings';
        else if (url.includes('officeworks')) storeKey = 'Officeworks';
        else if (url.includes('jbhifi')) storeKey = 'JBHiFi';
        else if (url.includes('thegoodguys')) storeKey = 'TheGoodGuys';
        else if (url.includes('theiconic')) storeKey = 'TheIconic';
        // Always overwrite — we end up with the LAST reading for this store on this day
        dayStoreMap.set(`${dateStr}|${storeKey}`, { h, d, dateStr, storeKey });
      });

      // Now build the chart-friendly historyMap keyed by dateStr
      // We add points in time order, so sort dayStoreMap entries by timestamp
      const sortedEntries = Array.from(dayStoreMap.values()).sort((a, b) => a.d - b.d);
      const historyMap = new Map();

      sortedEntries.forEach(({ h, d, dateStr, storeKey }) => {
        const fullDateStr = d.toLocaleString();
        const storeName = storeKey === 'ChemistWarehouse' ? 'Chemist Warehouse' :
          (storeKey === 'Priceline' ? 'Priceline Pharmacy' :
          (storeKey === 'TerryWhite' ? 'TerryWhite Chemmart' :
          (storeKey === 'Cincotta' ? 'Cincotta Chemist' :
          (storeKey === 'Blooms' ? 'Blooms The Chemist' :
          (storeKey === 'PetCircle' ? 'Pet Circle' :
          (storeKey === 'Petbarn' ? 'Petbarn' :
          (storeKey === 'Petstock' ? 'Petstock' :
          (storeKey === 'BudgetPet' ? 'Budget Pet Products' :
          (storeKey === 'PetChemist' ? 'Pet Chemist' :
          (storeKey === 'JBHiFi' ? 'JB Hi-Fi' :
          (storeKey === 'TheGoodGuys' ? 'The Good Guys' :
          (storeKey === 'TheIconic' ? 'The Iconic' : storeKey))))))))))));

        // Price change detection: compare to PREVIOUS day's last price for this store
        const prevPrice = storeLastPriceBeforeDay[storeKey];
        const isPriceChange = (prevPrice === undefined) || (Math.abs(h.price - prevPrice) > 0.005);
        // Update for next iteration (this IS the latest price for this store on this day)
        storeLastPriceBeforeDay[storeKey] = h.price;

        if (!historyMap.has(dateStr)) {
          historyMap.set(dateStr, {
            date: dateStr,
            fullDate: fullDateStr,
            sortTime: d.getTime(),
            _meta: {}
          });
        }

        const point = historyMap.get(dateStr);
        point[storeKey] = h.price;
        // Only set _change key when price actually changed (controls dot+label visibility)
        if (isPriceChange) {
          point[`${storeKey}_change`] = h.price;
        } else {
          // Clear change key if price is same as previous day
          delete point[`${storeKey}_change`];
        }
        if (!point._meta) point._meta = {};
        point._meta[storeKey] = {
          id: h.id,
          itemId: h.itemId,
          price: h.price,
          rawPrice: h.rawPrice,
          unitPrice: h.unitPrice,
          timestamp: h.timestamp,
          fullDate: fullDateStr,
          dateStr,
          storeKey,
          storeName,
          url: h.url,
          itemName: h.itemName,
          isPriceChange
        };
      });
      
      const formattedHistory = Array.from(historyMap.values()).sort((a,b) => a.sortTime - b.sortTime);
      setHistory(formattedHistory);

      // Compute 30-day average price
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      const recent30d = histRes.data.filter(h => new Date(h.timestamp).getTime() >= thirtyDaysAgo);
      if (recent30d.length > 0) {
        const sum = recent30d.reduce((acc, h) => acc + h.price, 0);
        setAvg30d(sum / recent30d.length);
      } else {
        setAvg30d(null);
      }

      // Compute lowest and highest from history
      if (histRes.data.length > 0) {
        const prices = histRes.data.map(h => h.price);
        setHistoryLowest(Math.min(...prices));
        setHistoryHighest(Math.max(...prices));
      } else {
        setHistoryLowest(itemData.lowestPrice ?? null);
        setHistoryHighest(itemData.highestPrice ?? null);
      }
    } catch (e) {
      console.error(e);
      const errMsg = e.response?.data?.error || e.message || 'Unknown error occurred.';
      setError(`Failed to load item details: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put(`/api/items/${itemId}`, {
        notifyAbove: notifyAbove ? parseFloat(notifyAbove) : null,
        notifyBelow: notifyBelow ? parseFloat(notifyBelow) : null,
        isAutoBuy,
        notify,
        type,
        intervalWeeks: parseInt(intervalWeeks, 10) || 4,
        isRoutine,
        routineFrequency: isRoutine ? routineFrequency : null,
        routineQuantity: parseInt(routineQuantity, 10) || 1
      });
      alert('Settings saved successfully!');
      fetchData();
    } catch (e) {
      console.error(e);
      alert('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };
  // Reset & Refresh: two-click inline confirm (destructive), then spinner feedback.
  const handleReset = async () => {
    if (resetState === 'running') return;

    // First click asks for confirmation, second click runs it.
    if (resetState === 'idle') {
      setResetState('confirm');
      return;
    }

    if (resetState === 'confirm' || resetState === 'error') {
      setResetState('running');
      try {
        await axios.post(`/api/groups/${itemId}/reset`);
        setResetState('done');
        // Let the user see the success state before returning to the dashboard.
        setTimeout(() => onBack(), 1200);
      } catch (e) {
        setResetState('error');
      }
    }
  };

  // Delete Item: permanently remove the item group and its price history
  const handleDeleteItem = async () => {
    if (deleteState === 'running') return;
    if (deleteState === 'idle') {
      setDeleteState('confirm');
      return;
    }
    if (deleteState === 'confirm' || deleteState === 'error') {
      setDeleteState('running');
      try {
        await axios.delete(`/api/items/${itemId}`);
        setDeleteState('done');
        setTimeout(() => onBack(), 800);
      } catch (e) {
        console.error('Failed to delete item', e);
        setDeleteState('error');
      }
    }
  };

  // Clean History: purge statistical outlier prices without wiping all data.
  const handleCleanHistory = async () => {
    if (cleanState === 'running') return;
    setCleanState('running');
    setCleanResult(null);
    try {
      const { data } = await axios.post(`/api/groups/${itemId}/purge-outliers`);
      setCleanResult(data);
      setCleanState('done');
      fetchData(); // Reload chart with cleaned data
      setTimeout(() => setCleanState('idle'), 4000);
    } catch (e) {
      setCleanState('error');
      setTimeout(() => setCleanState('idle'), 3000);
    }
  };

  const getSourceRetailer = (url) => {
    if (!url) return { name: 'Source', color: 'var(--accent)' };
    if (url.includes('coles.com.au')) return { name: 'Coles', color: '#e01a22' };
    if (url.includes('woolworths.com.au')) return { name: 'Woolworths', color: '#178841' };
    if (url.includes('aldi.com.au')) return { name: 'ALDI', color: '#002d72' };
    if (url.includes('amazon.')) return { name: 'Amazon', color: '#ff9900' };
    if (url.includes('chemistwarehouse.com.au')) return { name: 'Chemist Warehouse', color: '#0070ba' };
    if (url.includes('petcircle.com.au')) return { name: 'Pet Circle', color: '#ff5a00' };
    if (url.includes('bunnings.com.au')) return { name: 'Bunnings', color: '#0d5257' };
    if (url.includes('officeworks.com.au')) return { name: 'Officeworks', color: '#004b97' };
    if (url.includes('jbhifi.com.au')) return { name: 'JB Hi-Fi', color: '#c99700' };
    if (url.includes('thegoodguys.com.au')) return { name: 'The Good Guys', color: '#002f6c' };
    if (url.includes('theiconic.com.au')) return { name: 'The Iconic', color: '#94a3b8' };
    if (url.includes('danmurphys.com.au')) return { name: "Dan Murphy's", color: '#881337' };
    if (url.includes('priceline.com.au')) return { name: 'Priceline Pharmacy', color: '#ff007f' };
    if (url.includes('terrywhitechemmart.com.au')) return { name: 'TerryWhite Chemmart', color: '#00a3ad' };
    if (url.includes('cincottachemist.com.au')) return { name: 'Cincotta Chemist', color: '#e65100' };
    if (url.includes('bloomsthechemist.com.au')) return { name: 'Blooms The Chemist', color: '#0284c7' };
    if (url.includes('petbarn.com.au')) return { name: 'Petbarn', color: '#e11d48' };
    if (url.includes('petstock.com.au')) return { name: 'Petstock', color: '#2563eb' };
    if (url.includes('budgetpetproducts.com.au')) return { name: 'Budget Pet Products', color: '#16a34a' };
    if (url.includes('petchemist.com.au')) return { name: 'Pet Chemist', color: '#059669' };
    try { return { name: new URL(url).hostname.replace('www.', ''), color: 'var(--accent)' }; } catch { return { name: 'Source', color: 'var(--accent)' }; }
  };

  const checkVariantMatch = (targetName, candName) => {
    if (!targetName || !candName) return { isMatch: true, reason: '' };
    
    const normTarget = targetName.toLowerCase();
    const normCand = candName.toLowerCase();
    
    // 1. Weight ranges (e.g., "15.1 - 30kg", "15.1 to 30 kg")
    const rangeRegex = /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*kg/g;
    const targetRanges = [...normTarget.matchAll(rangeRegex)].map(m => `${parseFloat(m[1])}-${parseFloat(m[2])}`);
    const candRanges = [...normCand.matchAll(rangeRegex)].map(m => `${parseFloat(m[1])}-${parseFloat(m[2])}`);
    if (targetRanges.length > 0 && candRanges.length > 0) {
      if (!targetRanges.some(tr => candRanges.includes(tr))) {
        return { isMatch: false, reason: `Diff weight (${candRanges[0]}kg)` };
      }
    }

    // 2. Dog size classes (very small, small, medium, large, extra large)
    const sizeClasses = [
      { key: 'very small', re: /\bvery\s*small\b/ },
      { key: 'small', re: /\bsmall(?!\s*chew)\b/ },
      { key: 'medium', re: /\bmedium\b/ },
      { key: 'extra large', re: /\b(?:extra\s*large|xl)\b/ },
      { key: 'large', re: /\blarge\b/ }
    ];
    let targetClass = null;
    for (const sc of sizeClasses) {
      if (sc.re.test(normTarget)) { targetClass = sc.key; break; }
    }
    let candClass = null;
    for (const sc of sizeClasses) {
      if (sc.re.test(normCand)) { candClass = sc.key; break; }
    }
    if (targetClass && candClass && targetClass !== candClass) {
      return { isMatch: false, reason: `Diff size (${candClass})` };
    }

    // 3. Color codes
    const colors = ['purple', 'green', 'yellow', 'red', 'orange', 'blue'];
    const targetColor = colors.find(c => normTarget.includes(c));
    const candColor = colors.find(c => normCand.includes(c));
    if (targetColor && candColor && targetColor !== candColor) {
      return { isMatch: false, reason: `Diff color (${candColor})` };
    }

    // 4. Pack counts (3 chews vs 6 chews vs 12 chews)
    const packRegex = /\b(\d+)\s*(?:chews?|tabs?|tablets?|pk|pack|count|capsules?|doses?)\b/g;
    const targetPacks = [...normTarget.matchAll(packRegex)].map(m => parseInt(m[1]));
    const candPacks = [...normCand.matchAll(packRegex)].map(m => parseInt(m[1]));
    if (targetPacks.length > 0 && candPacks.length > 0) {
      if (!targetPacks.some(tp => candPacks.includes(tp))) {
        return { isMatch: false, reason: `Diff pack (${candPacks[0]}pk)` };
      }
    }

    return { isMatch: true, reason: 'Matching variant' };
  };

  const handleRematch = async () => {
    setScanningMatches(true);
    setRematchResults(null);
    setRematchFeedback(null);
    try {
      const { data } = await axios.post(`/api/items/${itemId}/rematch`);
      setRematchResults(data);
      const alts = data.alternatives || [];
      const baseName = data.original?.name || data.groupName || item?.name || '';
      const matchingUrls = alts.filter(alt => checkVariantMatch(baseName, alt.name).isMatch).map(a => a.url);
      setSelectedRematchUrls(matchingUrls.length > 0 ? matchingUrls : alts.map(a => a.url));

      const initialQtys = {};
      alts.forEach(alt => {
        initialQtys[alt.url] = {
          packQuantity: alt.packQuantity || 1,
          volumeQuantity: alt.volumeQuantity || 1,
          volumeUnit: alt.volumeUnit || '',
          unitPricingEnabled: alt.unitPricingEnabled ?? false
        };
      });
      setRematchQuantities(initialQtys);

      if (alts.length === 0) {
        setRematchFeedback({
          type: 'info',
          message: 'Scan complete. No new competitor stores were automatically found for this product.'
        });
      }
    } catch (err) {
      console.error('Failed to scan for matches:', err);
      setRematchFeedback({
        type: 'error',
        message: err.response?.data?.error || 'Failed to scan for competitor matches'
      });
    } finally {
      setScanningMatches(false);
    }
  };

  const handleAddRematchSources = async () => {
    if (!rematchResults || selectedRematchUrls.length === 0) return;
    setAddingRematchSources(true);
    try {
      const sourcesToAdd = selectedRematchUrls.map(url => {
        const alt = rematchResults.alternatives.find(a => a.url === url) || {};
        const qtys = rematchQuantities[url] || {};
        return {
          url,
          name: alt.name || '',
          price: alt.price,
          imageUrl: alt.imageUrl || null,
          packQuantity: qtys.packQuantity || alt.packQuantity || 1,
          volumeQuantity: qtys.volumeQuantity || alt.volumeQuantity || 1,
          volumeUnit: qtys.volumeUnit || alt.volumeUnit || '',
          unitPricingEnabled: qtys.unitPricingEnabled ?? alt.unitPricingEnabled ?? false
        };
      });

      await axios.post(`/api/items/${itemId}/sources`, { sources: sourcesToAdd });
      setRematchResults(null);
      setSelectedRematchUrls([]);
      setRematchFeedback({
        type: 'success',
        message: `Successfully linked ${sourcesToAdd.length} new store${sourcesToAdd.length > 1 ? 's' : ''} to this item!`
      });
      await fetchData();
    } catch (err) {
      console.error('Failed to add rematch sources:', err);
      alert('Failed to link selected stores: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingRematchSources(false);
    }
  };

  const renderRematchQtyInputs = (url) => {
    const qtys = rematchQuantities[url] || { packQuantity: 1, volumeQuantity: 1, volumeUnit: '', unitPricingEnabled: false };
    const updateQty = (key, val) => {
      const shouldEnable = ['packQuantity', 'volumeQuantity', 'volumeUnit'].includes(key) ? true : val;
      setRematchQuantities(prev => ({
        ...prev,
        [url]: {
          ...prev[url],
          [key]: val,
          unitPricingEnabled: key === 'unitPricingEnabled' ? val : (shouldEnable || (prev[url]?.unitPricingEnabled ?? false))
        }
      }));
    };
    const presets = ['pack', 'chew', 'tab', 'kg', 'g', 'ml', 'L'];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, background: 'rgba(0,0,0,0.25)', padding: '6px 10px', borderRadius: 6 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
            Pack:
            <input type="number" min="1" step="1" value={qtys.packQuantity} onChange={e => updateQty('packQuantity', parseInt(e.target.value) || 1)} style={{ width: 50, padding: '2px 5px', fontSize: '0.8rem' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
            Size:
            <input type="number" min="0.1" step="0.1" value={qtys.volumeQuantity} onChange={e => updateQty('volumeQuantity', parseFloat(e.target.value) || 1)} style={{ width: 55, padding: '2px 5px', fontSize: '0.8rem' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
            Unit:
            <input type="text" placeholder="kg, chew..." value={qtys.volumeUnit} onChange={e => updateQty('volumeUnit', e.target.value)} style={{ width: 60, padding: '2px 5px', fontSize: '0.8rem' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={qtys.unitPricingEnabled === true} onChange={e => updateQty('unitPricingEnabled', e.target.checked)} />
            Unit pricing
          </label>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Quick Unit:</span>
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
                padding: '1px 6px',
                fontSize: '0.72rem',
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

  // Store visual config
  const STORE_CONFIG = {
    Coles: { name: 'Coles', color: '#e01a22', position: 'top' },
    Woolworths: { name: 'Woolworths', color: '#178841', position: 'bottom' },
    Amazon: { name: 'Amazon', color: '#ff9900', position: 'top' },
    ChemistWarehouse: { name: 'Chemist Warehouse', color: '#0070ba', position: 'top' },
    Priceline: { name: 'Priceline Pharmacy', color: '#ff007f', position: 'top' },
    TerryWhite: { name: 'TerryWhite Chemmart', color: '#00a3ad', position: 'top' },
    Cincotta: { name: 'Cincotta Chemist', color: '#e65100', position: 'top' },
    Blooms: { name: 'Blooms The Chemist', color: '#0284c7', position: 'top' },
    PetCircle: { name: 'Pet Circle', color: '#ff5a00', position: 'top' },
    Petbarn: { name: 'Petbarn', color: '#e11d48', position: 'top' },
    Petstock: { name: 'Petstock', color: '#2563eb', position: 'top' },
    BudgetPet: { name: 'Budget Pet Products', color: '#16a34a', position: 'top' },
    PetChemist: { name: 'Pet Chemist', color: '#059669', position: 'top' },
    Bunnings: { name: 'Bunnings', color: '#0d5257', position: 'top' },
    Officeworks: { name: 'Officeworks', color: '#004b97', position: 'top' },
    JBHiFi: { name: 'JB Hi-Fi', color: '#c99700', position: 'top' },
    TheGoodGuys: { name: 'The Good Guys', color: '#002f6c', position: 'top' },
    TheIconic: { name: 'The Iconic', color: '#94a3b8', position: 'bottom' },
    Other: { name: 'Other', color: 'var(--accent)', position: 'bottom' }
  };

  // Interactive Dot for graph points - only renders a circle if price changed!
  const renderDot = (props, storeKey) => {
    const { cx, cy, value, payload } = props;
    if (value === undefined || value === null || isNaN(cx) || isNaN(cy)) return null;
    const meta = payload?._meta?.[storeKey];
    // If no price change, render nothing so it's a clean flat line without circles
    if (!meta || !meta.isPriceChange) return null;

    const color = STORE_CONFIG[storeKey]?.color || '#3b82f6';
    return (
      <g key={`dot-${storeKey}-${cx}-${cy}`}>
        {/* Generous hit area for effortless clicking */}
        <circle
          cx={cx}
          cy={cy}
          r={10}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            if (meta) {
              setDeleteError(null);
              setSelectedPoint(meta);
            }
          }}
        />
        {/* Visible dot — 1/4 the previous size (r=6 → r=1.5) */}
        <circle
          cx={cx}
          cy={cy}
          r={2}
          fill={color}
          stroke={color}
          strokeWidth={1}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            if (meta) {
              setDeleteError(null);
              setSelectedPoint(meta);
            }
          }}
        />
      </g>
    );
  };

  // Interactive Active Dot when hovered — scaled down to match new dot size
  const renderActiveDot = (props, storeKey) => {
    const { cx, cy, value, payload } = props;
    if (value === undefined || value === null || isNaN(cx) || isNaN(cy)) return null;
    const color = STORE_CONFIG[storeKey]?.color || '#3b82f6';
    const meta = payload?._meta?.[storeKey];

    return (
      <g key={`activedot-${storeKey}-${cx}-${cy}`}>
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            if (meta) {
              setDeleteError(null);
              setSelectedPoint(meta);
            }
          }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={color}
          stroke="var(--bg-color)"
          strokeWidth={1.5}
          style={{
            cursor: 'pointer',
            filter: `drop-shadow(0 0 4px ${color})`
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (meta) {
              setDeleteError(null);
              setSelectedPoint(meta);
            }
          }}
        />
      </g>
    );
  };

  // Custom rich Tooltip
  const renderCustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const dateStr = payload[0]?.payload?.fullDate || payload[0]?.payload?.date || label;

    return (
      <div style={{
        backgroundColor: 'var(--bg-color)',
        border: '1px solid var(--glass-border)',
        borderRadius: 8,
        padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        minWidth: 190
      }}>
        <div style={{ color: 'var(--text-main)', fontWeight: 'bold', marginBottom: 8, fontSize: '0.85rem' }}>
          {dateStr}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {payload.map((entry, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: '0.85rem' }}>
              <span style={{ color: entry.color, fontWeight: 600 }}>{entry.name}:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>${Number(entry.value).toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 4
        }}>
          <span>💡 Click a point to delete</span>
        </div>
      </div>
    );
  };

  // Delete individual point handler
  const handleDeletePoint = async () => {
    if (!selectedPoint || !selectedPoint.id || deletingPoint) return;
    setDeletingPoint(true);
    setDeleteError(null);
    try {
      await axios.delete(`/api/history/${selectedPoint.id}`);
      const storeName = selectedPoint.storeName;
      const pointPrice = selectedPoint.price.toFixed(2);
      setSelectedPoint(null);
      setToastMessage(`Deleted ${storeName} price point ($${pointPrice})`);
      setTimeout(() => setToastMessage(null), 3500);
      await fetchData();
    } catch (err) {
      console.error('Failed to delete price point:', err);
      setDeleteError(err.response?.data?.error || err.message || 'Failed to delete price point');
    } finally {
      setDeletingPoint(false);
    }
  };

  if (!item) return <div>{error || 'Item not found.'}</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <button onClick={onBack} className="tab-btn" style={{ marginRight: 16 }}>
          <ArrowLeft size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} />
          Back
        </button>
        <h2 style={{ margin: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name || item.url}
        </h2>
        {/* Clean History: surgical outlier removal (amber) */}
        <button
          onClick={handleCleanHistory}
          disabled={cleanState === 'running'}
          className="tab-btn"
          style={{
            marginRight: 8,
            background: cleanState === 'done' ? 'rgba(80, 200, 120, 0.2)' : cleanState === 'error' ? 'rgba(255, 50, 50, 0.2)' : 'rgba(255, 200, 50, 0.15)',
            border: `1px solid ${cleanState === 'done' ? 'rgba(80, 200, 120, 0.6)' : cleanState === 'error' ? 'rgba(255, 80, 80, 0.6)' : 'rgba(255, 200, 50, 0.5)'}`,
            color: cleanState === 'done' ? '#6be8a0' : cleanState === 'error' ? '#ff6b6b' : '#ffd166',
            cursor: cleanState === 'running' ? 'not-allowed' : 'pointer',
            opacity: cleanState === 'running' ? 0.7 : 1,
            whiteSpace: 'nowrap'
          }}
        >
          {cleanState === 'idle' && (<><Sparkles size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Clean History</>)}
          {cleanState === 'running' && (<><RefreshCcw size={15} className="spin" style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Cleaning…</>)}
          {cleanState === 'done' && cleanResult && (<><CheckCircle2 size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />{cleanResult.removed > 0 ? `Removed ${cleanResult.removed} bad ${cleanResult.removed === 1 ? 'entry' : 'entries'}` : 'Already clean ✓'}</>)}
          {cleanState === 'error' && (<><XCircle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Failed — retry</>)}
        </button>
        <button
          onClick={handleReset}
          disabled={resetState === 'running'}
          className="tab-btn"
          style={{
            background: resetState === 'confirm' ? 'rgba(255, 50, 50, 0.45)' : resetState === 'error' ? 'rgba(255, 50, 50, 0.3)' : 'rgba(255, 50, 50, 0.2)',
            border: '1px solid rgba(255, 50, 50, 0.6)',
            color: '#ff6b6b',
            fontWeight: resetState === 'confirm' ? 700 : 500,
            cursor: resetState === 'running' ? 'not-allowed' : 'pointer',
            opacity: resetState === 'running' ? 0.8 : 1
          }}
        >
          {resetState === 'idle' && (<><RefreshCcw size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Reset &amp; Refresh</>)}
          {resetState === 'confirm' && (<><AlertTriangle size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Confirm wipe?</>)}
          {resetState === 'running' && (<><RefreshCcw size={16} className="spin" style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Resetting &amp; Refreshing…</>)}
          {resetState === 'done' && (<><CheckCircle2 size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Done ✓</>)}
          {resetState === 'error' && (<><XCircle size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Failed — retry</>)}
        </button>
        <button
          onClick={handleDeleteItem}
          disabled={deleteState === 'running'}
          className="tab-btn"
          style={{
            marginLeft: 8,
            background: deleteState === 'confirm' ? 'rgba(239, 68, 68, 0.45)' : 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.6)',
            color: '#ef4444',
            fontWeight: deleteState === 'confirm' ? 700 : 500,
            cursor: deleteState === 'running' ? 'not-allowed' : 'pointer',
            opacity: deleteState === 'running' ? 0.8 : 1,
            whiteSpace: 'nowrap'
          }}
          title="Permanently delete this tracked item and all its price history"
        >
          {deleteState === 'idle' && (<><Trash2 size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Delete Item</>)}
          {deleteState === 'confirm' && (<><AlertTriangle size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Confirm delete?</>)}
          {deleteState === 'running' && (<><RefreshCcw size={16} className="spin" style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Deleting…</>)}
          {deleteState === 'done' && (<><CheckCircle2 size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Deleted ✓</>)}
          {deleteState === 'error' && (<><XCircle size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />Failed — retry</>)}
        </button>
        {deleteState === 'confirm' && (
          <button
            onClick={() => setDeleteState('idle')}
            className="tab-btn"
            style={{
              marginLeft: 6,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              fontSize: '0.82rem',
              color: 'var(--text-muted)'
            }}
          >
            Cancel
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 24, alignItems: 'start' }}>
        {/* Left Column: Chart & Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* Main Info Card */}
          <div className="glass-panel" style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            {item.imageUrl ? (
              <img src={item.imageUrl} alt={item.name} style={{ width: 150, height: 150, objectFit: 'contain', background: 'white', borderRadius: 8, padding: 10 }} />
            ) : (
              <div style={{ width: 150, height: 150, background: 'rgba(255,255,255,0.1)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No Image</div>
            )}
            <div style={{ flex: 1 }}>
              {(() => {
                const isTrackingUsed = item.currentPrice != null && item.usedPrice != null && Math.abs(item.currentPrice - item.usedPrice) < 0.01;
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Current Price</span>
                      {isTrackingUsed && (
                        <span style={{
                          background: '#d97706',
                          color: '#ffffff',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 4,
                          letterSpacing: '0.5px'
                        }}>
                          USED / RESALE
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="price-tag" style={{ fontSize: '3rem', marginBottom: 4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <span>${item.currentPrice ? item.currentPrice.toFixed(2) : '--'}</span>
                        {isTrackingUsed && (
                          <span style={{
                            background: 'rgba(217, 119, 6, 0.2)',
                            border: '1px solid #d97706',
                            color: '#fbbf24',
                            fontSize: '0.95rem',
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: 6
                          }}>
                            {item.usedCondition || 'Amazon Resale'}
                          </span>
                        )}
                        {item.subscribeSave ? <span className="status-badge badge-ss">S&S</span> : null}
                      </div>
                      {item.unitPriceDisplay && (
                        <div style={{ fontSize: '1.25rem', color: 'var(--accent)', fontWeight: 700, marginBottom: 6 }}>
                          {item.unitPriceDisplay}
                        </div>
                      )}
                      {/* Feature 4: Sale Cycle Predictor ("Wait or Buy Now?") */}
                      {item.salePrediction && (
                        <div style={{
                          marginTop: 10,
                          marginBottom: 10,
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: item.salePrediction.status === 'ON_SALE_NOW' ? 'rgba(16, 185, 129, 0.12)' : (item.salePrediction.status === 'WAIT_SALE_SOON' ? 'rgba(234, 179, 8, 0.12)' : 'rgba(59, 130, 246, 0.08)'),
                          border: `1.5px solid ${item.salePrediction.status === 'ON_SALE_NOW' ? 'var(--success)' : (item.salePrediction.status === 'WAIT_SALE_SOON' ? '#eab308' : 'rgba(59, 130, 246, 0.3)')}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: '0.88rem'
                        }}>
                          <span style={{
                            fontWeight: 800,
                            color: item.salePrediction.status === 'ON_SALE_NOW' ? 'var(--success)' : (item.salePrediction.status === 'WAIT_SALE_SOON' ? '#fde047' : '#93c5fd'),
                            whiteSpace: 'nowrap'
                          }}>
                            {item.salePrediction.badgeText || (item.salePrediction.status === 'ON_SALE_NOW' ? '🔥 On Sale' : '📊 Price Cadence')}
                          </span>
                          <span style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {item.salePrediction.explanation}
                          </span>
                        </div>
                      )}
                      {item.shippingPrice > 0 && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                          (includes ${item.shippingPrice.toFixed(2)} postage)
                        </div>
                      )}
                      {item.usedPrice != null && (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          background: isTrackingUsed ? 'rgba(245, 158, 11, 0.18)' : 'rgba(245, 158, 11, 0.12)',
                          border: `1px solid ${isTrackingUsed ? 'rgba(245, 158, 11, 0.45)' : 'rgba(245, 158, 11, 0.35)'}`,
                          borderRadius: 8,
                          padding: '8px 14px',
                          marginTop: 8,
                          marginBottom: 6
                        }}>
                          <span style={{ fontSize: '1.2rem' }}>📦</span>
                          <div>
                            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fbbf24' }}>
                              {isTrackingUsed ? 'Tracking Amazon Resale Price' : `Used / Resale available from $${item.usedPrice.toFixed(2)}`}
                              {item.usedCondition ? ` (${item.usedCondition})` : ''}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#fde68a', marginTop: 2 }}>
                              {item.usedSeller ? `Sold by ${item.usedSeller} • ` : ''}
                              {isTrackingUsed ? `Current tracked price reflects the discounted non-new offer ($${item.usedPrice.toFixed(2)})` : `A cheaper non-new option is in stock on Amazon ($${item.usedPrice.toFixed(2)})`}
                            </div>
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        {formatDateTime(item.lastChecked)}
                      </div>
                    </div>
                  </>
                );
              })()}
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status:</div>
                  <div style={{ fontWeight: 'bold', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>{item.status || 'Pending'}</span>
                    {item.status === '❌ No Price' && <span className="status-badge status-error">No Price</span>}
                    {item.inStock === 'Out of Stock' && <span className="status-badge status-error">Out of Stock</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Chart Card */}
          <div className="glass-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TrendingUp size={22} color="var(--accent)" />
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Price History</h3>
              </div>
              
              {/* Stat badges: Lowest, Highest, 30d Average */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: 8,
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8
                }}>
                  <span style={{ fontSize: '0.75rem', color: '#6ee7b7', textTransform: 'uppercase', fontWeight: 600 }}>Lowest</span>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#10b981' }}>
                    ${historyLowest != null ? historyLowest.toFixed(2) : '--'}
                  </span>
                </div>

                <div style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: 8,
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8
                }}>
                  <span style={{ fontSize: '0.75rem', color: '#fca5a5', textTransform: 'uppercase', fontWeight: 600 }}>Highest</span>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ef4444' }}>
                    ${historyHighest != null ? historyHighest.toFixed(2) : '--'}
                  </span>
                </div>

                <div style={{
                  background: 'rgba(59, 130, 246, 0.12)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  borderRadius: 8,
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8
                }}>
                  <span style={{ fontSize: '0.75rem', color: '#93c5fd', textTransform: 'uppercase', fontWeight: 600 }}>30d Avg</span>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#3b82f6' }}>
                    ${avg30d != null ? avg30d.toFixed(2) : '--'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span>Circles mark price changes • Flat lines show steady price</span>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: 12 }}>💡 Click any point to delete</span>
            </div>

            <div style={{ height: 350 }}>
              {history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={history} 
                    margin={{ top: 20, right: 30, left: 0, bottom: 0 }}
                    onClick={(e) => {
                      if (e && e.activePayload && e.activePayload.length === 1) {
                        const activeItem = e.activePayload[0];
                        const meta = activeItem.payload?._meta?.[activeItem.dataKey];
                        if (meta) {
                          setDeleteError(null);
                          setSelectedPoint(meta);
                        }
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--text-muted)" tickMargin={10} />
                    <YAxis 
                      stroke="var(--text-muted)" 
                      domain={[(dataMin) => Math.max(0, Math.floor(dataMin - 2)), (dataMax) => Math.ceil(dataMax + 2)]} 
                      tickFormatter={(v) => `$${v}`} 
                    />
                    <Tooltip content={renderCustomTooltip} />
                    <Legend verticalAlign="top" height={36} wrapperStyle={{ color: 'var(--text-muted)' }} />

                    {/* Reference lines for Lowest and Highest across entire price history */}
                    {historyLowest != null && (
                      <ReferenceLine 
                        y={historyLowest} 
                        stroke="#10b981" 
                        strokeDasharray="4 4" 
                        strokeWidth={1.5}
                        strokeOpacity={0.7}
                        label={{ 
                          value: `Lowest: $${historyLowest.toFixed(2)}`, 
                          fill: '#10b981', 
                          position: 'insideBottomLeft', 
                          fontSize: 11,
                          fontWeight: 600
                        }} 
                      />
                    )}
                    {historyHighest != null && Math.abs(historyHighest - historyLowest) > 0.01 && (
                      <ReferenceLine 
                        y={historyHighest} 
                        stroke="#ef4444" 
                        strokeDasharray="4 4" 
                        strokeWidth={1.5}
                        strokeOpacity={0.7}
                        label={{ 
                          value: `Highest: $${historyHighest.toFixed(2)}`, 
                          fill: '#ef4444', 
                          position: 'insideTopLeft', 
                          fontSize: 11,
                          fontWeight: 600
                        }} 
                      />
                    )}

                    {/* Render Lines conditionally based on data */}
                    {history.some(h => h.Coles !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Coles" 
                        dataKey="Coles" 
                        stroke="#e01a22" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Coles')} 
                        activeDot={(props) => renderActiveDot(props, 'Coles')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Coles_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#e01a22" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Woolworths !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Woolworths" 
                        dataKey="Woolworths" 
                        stroke="#178841" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Woolworths')} 
                        activeDot={(props) => renderActiveDot(props, 'Woolworths')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Woolworths_change" position="bottom" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#178841" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Amazon !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Amazon" 
                        dataKey="Amazon" 
                        stroke="#ff9900" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Amazon')} 
                        activeDot={(props) => renderActiveDot(props, 'Amazon')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Amazon_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#ff9900" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.ChemistWarehouse !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Chemist Warehouse" 
                        dataKey="ChemistWarehouse" 
                        stroke="#0070ba" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'ChemistWarehouse')} 
                        activeDot={(props) => renderActiveDot(props, 'ChemistWarehouse')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="ChemistWarehouse_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#0070ba" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.PetCircle !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Pet Circle" 
                        dataKey="PetCircle" 
                        stroke="#ff5a00" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'PetCircle')} 
                        activeDot={(props) => renderActiveDot(props, 'PetCircle')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="PetCircle_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#ff5a00" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Bunnings !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Bunnings" 
                        dataKey="Bunnings" 
                        stroke="#0d5257" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Bunnings')} 
                        activeDot={(props) => renderActiveDot(props, 'Bunnings')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Bunnings_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#0d5257" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Officeworks !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Officeworks" 
                        dataKey="Officeworks" 
                        stroke="#004b97" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Officeworks')} 
                        activeDot={(props) => renderActiveDot(props, 'Officeworks')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Officeworks_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#004b97" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.JBHiFi !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="JB Hi-Fi" 
                        dataKey="JBHiFi" 
                        stroke="#c99700" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'JBHiFi')} 
                        activeDot={(props) => renderActiveDot(props, 'JBHiFi')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="JBHiFi_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#c99700" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.TheGoodGuys !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="The Good Guys" 
                        dataKey="TheGoodGuys" 
                        stroke="#002f6c" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'TheGoodGuys')} 
                        activeDot={(props) => renderActiveDot(props, 'TheGoodGuys')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="TheGoodGuys_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#002f6c" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Priceline !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Priceline" 
                        dataKey="Priceline" 
                        stroke="#ff007f" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Priceline')} 
                        activeDot={(props) => renderActiveDot(props, 'Priceline')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Priceline_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#ff007f" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.TerryWhite !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="TerryWhite" 
                        dataKey="TerryWhite" 
                        stroke="#00a3ad" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'TerryWhite')} 
                        activeDot={(props) => renderActiveDot(props, 'TerryWhite')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="TerryWhite_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#00a3ad" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Cincotta !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Cincotta" 
                        dataKey="Cincotta" 
                        stroke="#e65100" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Cincotta')} 
                        activeDot={(props) => renderActiveDot(props, 'Cincotta')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Cincotta_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#e65100" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Blooms !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Blooms The Chemist" 
                        dataKey="Blooms" 
                        stroke="#0284c7" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Blooms')} 
                        activeDot={(props) => renderActiveDot(props, 'Blooms')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Blooms_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#0284c7" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Petbarn !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Petbarn" 
                        dataKey="Petbarn" 
                        stroke="#e11d48" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Petbarn')} 
                        activeDot={(props) => renderActiveDot(props, 'Petbarn')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Petbarn_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#e11d48" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Petstock !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Petstock" 
                        dataKey="Petstock" 
                        stroke="#2563eb" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Petstock')} 
                        activeDot={(props) => renderActiveDot(props, 'Petstock')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Petstock_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#2563eb" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.BudgetPet !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Budget Pet Products" 
                        dataKey="BudgetPet" 
                        stroke="#16a34a" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'BudgetPet')} 
                        activeDot={(props) => renderActiveDot(props, 'BudgetPet')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="BudgetPet_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#16a34a" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.PetChemist !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Pet Chemist" 
                        dataKey="PetChemist" 
                        stroke="#059669" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'PetChemist')} 
                        activeDot={(props) => renderActiveDot(props, 'PetChemist')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="PetChemist_change" position="top" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#059669" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.TheIconic !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="The Iconic" 
                        dataKey="TheIconic" 
                        stroke="#94a3b8" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'TheIconic')} 
                        activeDot={(props) => renderActiveDot(props, 'TheIconic')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="TheIconic_change" position="bottom" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="#94a3b8" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                    {history.some(h => h.Other !== undefined) && (
                      <Line 
                        type="monotone" 
                        name="Other" 
                        dataKey="Other" 
                        stroke="var(--accent)" 
                        strokeWidth={3} 
                        dot={(props) => renderDot(props, 'Other')} 
                        activeDot={(props) => renderActiveDot(props, 'Other')} 
                        connectNulls={true}
                      >
                        <LabelList dataKey="Other_change" position="bottom" formatter={(v) => (v != null ? `$${Number(v).toFixed(2)}` : '')} fill="var(--accent)" fontSize={11} fontWeight="bold" />
                      </Line>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  Not enough historical data yet.
                </div>
              )}
            </div>
          </div>

          {/* Single-store rematch callout banner */}
          {item.sources?.length === 1 && !rematchResults && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(37, 99, 235, 0.05))',
              border: '1.5px solid rgba(59, 130, 246, 0.4)',
              borderRadius: 14,
              padding: '16px 20px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 260 }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'rgba(59, 130, 246, 0.22)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Sparkles size={24} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.02rem', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Only 1 store tracked for this product</span>
                    <span style={{ fontSize: '0.72rem', background: 'rgba(59, 130, 246, 0.25)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>1 Source</span>
                  </div>
                  <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Scan across other Australian retailers (pet stores, pharmacies, Amazon AU, supermarkets) to compare prices and uncover discounts.
                  </div>
                </div>
              </div>
              <button 
                type="button"
                className="btn-primary" 
                onClick={handleRematch} 
                disabled={scanningMatches}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', fontSize: '0.94rem', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {scanningMatches ? <RefreshCw size={17} className="spinning" /> : <Search size={17} />}
                {scanningMatches ? 'Scanning Other Stores...' : 'Scan Other Stores for Matches'}
              </button>
            </div>
          )}

          {/* Rematch feedback alert */}
          {rematchFeedback && (
            <div style={{
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: rematchFeedback.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : (rematchFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)'),
              border: `1px solid ${rematchFeedback.type === 'error' ? 'rgba(239, 68, 68, 0.4)' : (rematchFeedback.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(59, 130, 246, 0.4)')}`,
              color: rematchFeedback.type === 'error' ? '#fca5a5' : (rematchFeedback.type === 'success' ? '#6ee7b7' : '#93c5fd')
            }}>
              <span style={{ fontSize: '0.9rem' }}>{rematchFeedback.message}</span>
              <button type="button" onClick={() => setRematchFeedback(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>
          )}

          {/* Sources Card */}
          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <h3 style={{ margin: 0 }}>Alternative Sources ({item.sources?.length || 0})</h3>
              <button 
                type="button" 
                onClick={handleRematch} 
                disabled={scanningMatches}
                className="tab-btn"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', padding: '6px 12px', border: '1px solid var(--border)' }}
              >
                {scanningMatches ? <RefreshCw size={14} className="spinning" /> : <Search size={14} />}
                {scanningMatches ? 'Scanning...' : 'Scan Other Stores'}
              </button>
            </div>

            {/* Scan Results Panel */}
            {rematchResults && (
              <div style={{
                marginBottom: 24,
                padding: 18,
                background: 'rgba(59, 130, 246, 0.05)',
                border: '1.5px solid var(--accent)',
                borderRadius: 12
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Sparkles size={18} style={{ color: 'var(--accent)' }} />
                      Competitor Store Scan Results
                    </h4>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {rematchResults.alternatives.length > 0
                        ? `Found ${rematchResults.alternatives.length} matching store${rematchResults.alternatives.length > 1 ? 's' : ''}! Select the stores you want to add to this item:`
                        : 'No new automatic competitor matches found for this item.'}
                    </div>
                    {rematchResults.alternatives.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="tab-btn"
                          style={{ fontSize: '0.78rem', padding: '4px 10px', border: '1px solid var(--border)', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}
                          onClick={() => {
                            const baseName = rematchResults.original?.name || rematchResults.groupName || item?.name || '';
                            const matching = rematchResults.alternatives.filter(a => checkVariantMatch(baseName, a.name).isMatch).map(a => a.url);
                            setSelectedRematchUrls(matching);
                          }}
                        >
                          Select Matching Size/Pack ({rematchResults.alternatives.filter(a => checkVariantMatch(rematchResults.original?.name || rematchResults.groupName || item?.name || '', a.name).isMatch).length})
                        </button>
                        <button
                          type="button"
                          className="tab-btn"
                          style={{ fontSize: '0.78rem', padding: '4px 10px', border: '1px solid var(--border)' }}
                          onClick={() => setSelectedRematchUrls(rematchResults.alternatives.map(a => a.url))}
                        >
                          Select All ({rematchResults.alternatives.length})
                        </button>
                        <button
                          type="button"
                          className="tab-btn"
                          style={{ fontSize: '0.78rem', padding: '4px 10px', border: '1px solid var(--border)' }}
                          onClick={() => setSelectedRematchUrls([])}
                        >
                          Deselect All
                        </button>
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => setRematchResults(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
                    <X size={18} />
                  </button>
                </div>

                {rematchResults.alternatives.length > 0 ? (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                      {rematchResults.alternatives.map((alt, idx) => {
                        const ret = getSourceRetailer(alt.url);
                        const isChecked = selectedRematchUrls.includes(alt.url);
                        const baseName = rematchResults.original?.name || rematchResults.groupName || item?.name || '';
                        const variantInfo = checkVariantMatch(baseName, alt.name);
                        return (
                          <div 
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 16,
                              padding: 14,
                              background: isChecked ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255,255,255,0.03)',
                              border: isChecked ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                              borderRadius: 10,
                              cursor: 'pointer'
                            }}
                            onClick={() => {
                              setSelectedRematchUrls(prev => 
                                prev.includes(alt.url) ? prev.filter(u => u !== alt.url) : [...prev, alt.url]
                              );
                            }}
                          >
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (e.target.checked) setSelectedRematchUrls(prev => [...prev, alt.url]);
                                else setSelectedRematchUrls(prev => prev.filter(u => u !== alt.url));
                              }}
                              style={{ marginTop: 4, cursor: 'pointer', flexShrink: 0 }}
                            />
                            {alt.imageUrl && (
                              <img 
                                src={alt.imageUrl} 
                                alt={alt.name} 
                                style={{ width: 64, height: 64, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 4, flexShrink: 0 }} 
                              />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                <span style={{ background: ret.color, color: '#fff', fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>
                                  {ret.name}
                                </span>
                                {alt.price != null && (
                                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#10b981' }}>
                                    ${Number(alt.price).toFixed(2)}
                                  </span>
                                )}
                                {alt.inStock && (
                                  <span style={{ fontSize: '0.75rem', color: alt.inStock === 'In Stock' ? '#10b981' : '#ef4444' }}>
                                    • {alt.inStock}
                                  </span>
                                )}
                                {variantInfo.isMatch ? (
                                  <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <CheckCircle2 size={11} /> Matching Size/Pack
                                  </span>
                                ) : (
                                  <span style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)', fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                                    {variantInfo.reason || 'Different Variant'}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontWeight: 500, fontSize: '0.92rem', marginBottom: 4, lineHeight: 1.3 }}>
                                {alt.name}
                              </div>
                              <a 
                                href={buildAffiliateUrl(alt.url, affiliateSettings)} 
                                target="_blank" 
                                rel="noreferrer" 
                                onClick={(e) => e.stopPropagation()} 
                                style={{ fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                View on {ret.name} <ExternalLink size={12} />
                              </a>
                              {renderRematchQtyInputs(alt.url)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button 
                        type="button" 
                        className="tab-btn" 
                        onClick={() => setRematchResults(null)} 
                        disabled={addingRematchSources}
                        style={{ border: '1px solid var(--border)' }}
                      >
                        Cancel
                      </button>
                      <button 
                        type="button" 
                        className="btn-primary" 
                        onClick={handleAddRematchSources} 
                        disabled={addingRematchSources || selectedRematchUrls.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {addingRematchSources ? <RefreshCw size={15} className="spinning" /> : <CheckCircle2 size={15} />}
                        {addingRematchSources ? 'Linking Stores...' : `Add Selected Stores (${selectedRematchUrls.length})`}
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 12 }}>
                      No alternative listings were automatically found for "{rematchResults.groupName}". You can manually search for it on competitor sites:
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                      <a 
                        href={buildAffiliateUrl(`https://www.petbarn.com.au/catalogsearch/result/?q=${encodeURIComponent(rematchResults.groupName)}`, affiliateSettings)} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="tab-btn" 
                        style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '4px 10px', background: '#e11d48', color: '#fff' }}
                      >
                        Petbarn ↗
                      </a>
                      <a 
                        href={buildAffiliateUrl(`https://www.petstock.com.au/search?q=${encodeURIComponent(rematchResults.groupName)}`, affiliateSettings)} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="tab-btn" 
                        style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '4px 10px', background: '#2563eb', color: '#fff' }}
                      >
                        Petstock ↗
                      </a>
                      <a 
                        href={buildAffiliateUrl(`https://www.petcircle.com.au/search?q=${encodeURIComponent(rematchResults.groupName)}`, affiliateSettings)} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="tab-btn" 
                        style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '4px 10px', background: '#ff5a00', color: '#fff' }}
                      >
                        Pet Circle ↗
                      </a>
                      <a 
                        href={buildAffiliateUrl(`https://www.chemistwarehouse.com.au/search?query=${encodeURIComponent(rematchResults.groupName)}`, affiliateSettings)} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="tab-btn" 
                        style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '4px 10px', background: '#0070ba', color: '#fff' }}
                      >
                        Chemist Warehouse ↗
                      </a>
                      <a 
                        href={buildAffiliateUrl(`https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(rematchResults.groupName)}`, affiliateSettings)} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="tab-btn" 
                        style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '4px 10px', background: '#178841', color: '#fff' }}
                      >
                        Woolworths ↗
                      </a>
                      <a 
                        href={buildAffiliateUrl(`https://www.coles.com.au/search?q=${encodeURIComponent(rematchResults.groupName)}`, affiliateSettings)} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="tab-btn" 
                        style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '4px 10px', background: '#e01a22', color: '#fff' }}
                      >
                        Coles ↗
                      </a>
                      <a 
                        href={`https://www.aldi.com.au/results?q=${encodeURIComponent(rematchResults.groupName)}`} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="tab-btn" 
                        style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '4px 10px', background: '#002d72', color: '#fff' }}
                      >
                        ALDI ↗
                      </a>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Found a link? Copy and paste it in the "Paste new item URL here" box below to add it directly!
                    </div>
                  </div>
                )}
              </div>
            )}

            {(() => {
              const packCounts = [...new Set((item.sources || []).map(s => s.packQuantity || 1))].sort((a, b) => a - b);
              if (packCounts.length <= 1) return null;
              const targetPackCount = (item?.name?.match(/\b(\d+)\s*(?:chews?|pack|pk|tablets?|doses?)\b/i)?.[1]
                ? parseInt(item.name.match(/\b(\d+)\s*(?:chews?|pack|pk|tablets?|doses?)\b/i)[1], 10)
                : 6);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Filter Pack Size:</span>
                  <button
                    type="button"
                    className="tab-btn"
                    style={{
                      fontSize: '0.78rem',
                      padding: '4px 10px',
                      borderRadius: 16,
                      background: activePackFilter === null ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                      color: activePackFilter === null ? '#fff' : 'var(--text-muted)',
                      border: '1px solid var(--border)'
                    }}
                    onClick={() => setActivePackFilter(null)}
                  >
                    All Packs ({item.sources?.length || 0})
                  </button>
                  {packCounts.map(count => {
                    const num = (item.sources || []).filter(s => (s.packQuantity || 1) === count).length;
                    const isTarget = targetPackCount === count;
                    const unitName = (item.sources?.find(s => (s.packQuantity || 1) === count)?.volumeUnit) || 'Chew';
                    return (
                      <button
                        key={count}
                        type="button"
                        className="tab-btn"
                        style={{
                          fontSize: '0.78rem',
                          padding: '4px 10px',
                          borderRadius: 16,
                          background: activePackFilter === count ? 'var(--accent)' : (isTarget ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.06)'),
                          color: activePackFilter === count ? '#fff' : (isTarget ? '#93c5fd' : 'var(--text-muted)'),
                          border: isTarget ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid var(--border)'
                        }}
                        onClick={() => setActivePackFilter(activePackFilter === count ? null : count)}
                      >
                        {count} {unitName}{count > 1 && !unitName.endsWith('s') ? 's' : ''} ({num}) {isTarget ? '★ Target' : ''}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(item.sources || [])
                .filter(source => activePackFilter === null || (source.packQuantity || 1) === activePackFilter)
                .map((source, idx) => {
                const retailer = getSourceRetailer(source.url);
                const isBestValue = item.bestSourceId === source.id && item.sources.length > 1;
                const targetPackCount = (item?.name?.match(/\b(\d+)\s*(?:chews?|pack|pk|tablets?|doses?)\b/i)?.[1]
                  ? parseInt(item.name.match(/\b(\d+)\s*(?:chews?|pack|pk|tablets?|doses?)\b/i)[1], 10)
                  : 6);
                const isMatchingTargetPack = (source.packQuantity || 1) === targetPackCount;

                let qtyStr = '';
                if (source.unitPricingEnabled === 0 || source.unitPricingEnabled === false || source.unitPricingEnabled === '0') {
                  qtyStr = ' (unit pricing off)';
                } else if (source.packQuantity > 1 || source.volumeQuantity > 1 || source.volumeUnit) {
                  qtyStr = ` (${source.packQuantity || 1}x ${source.volumeQuantity || 1}${source.volumeUnit || ''})`;
                }
                const isEditing = editingSourceId === source.id;
                const presets = ['pack', 'chew', 'tab', 'kg', 'g', 'ml', 'L'];
                
                return (
                  <div key={idx} style={{ padding: 12, background: isBestValue ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.05)', border: isBestValue ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid transparent', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200, flexWrap: 'wrap' }}>
                        <span style={{ background: retailer.color, color: '#fff', fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>
                          {retailer.name}
                        </span>
                        {source.packQuantity != null && (
                          <span style={{
                            background: isMatchingTargetPack ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                            color: isMatchingTargetPack ? '#93c5fd' : 'var(--text-muted)',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4
                          }}>
                            {source.packQuantity} {source.volumeUnit || 'chew'}{(source.packQuantity > 1 && !source.volumeUnit?.endsWith('s')) ? 's' : ''}
                          </span>
                        )}
                        {isBestValue && (
                          <span style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#6ee7b7', fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>
                            🏆 Best Value
                          </span>
                        )}
                        <a href={buildAffiliateUrl(source.url, affiliateSettings)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all', fontSize: '0.9rem' }}>
                          {source.url.replace(/^https?:\/\/(www\.)?/, '').substring(0, 42)}...
                        </a>
                        {isAmazonUrl(source.url) && (
                          <a
                            href={buildAmazonCartLink(source.url, affiliateSettings.amazonAssociateTag)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              background: '#f59e0b',
                              color: '#111827',
                              fontWeight: 700,
                              fontSize: '0.72rem',
                              padding: '2px 8px',
                              borderRadius: 4,
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                            title="Add directly to Amazon Cart"
                          >
                            🛒 Cart ↗
                          </a>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button 
                          onClick={() => {
                            if (isEditing) {
                              setEditingSourceId(null);
                            } else {
                              setEditingSourceId(source.id);
                              setEditSourcePackQty(source.packQuantity || 1);
                              setEditSourceVolQty(source.volumeQuantity || 1);
                              setEditSourceVolUnit(source.volumeUnit || '');
                              setEditSourceUnitPricingEnabled(source.unitPricingEnabled === true || source.unitPricingEnabled === 1);
                              setEditSourceTrackCondition(source.trackCondition || 'any');
                              setEditSourceTrackSubscribe(source.trackSubscribe || 'any');
                            }
                          }}
                          style={{ background: 'none', border: '1px solid var(--border)', color: 'white', borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer' }}
                        >
                          {isEditing ? 'Cancel' : 'Edit Source'}
                        </button>
                        {item.sources?.length > 1 && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`Delete ${retailer.name} source from this item?`)) return;
                              try {
                                await axios.delete(`/api/items/sources/${source.id}`);
                                fetchData();
                              } catch (err) {
                                alert('Failed to delete source: ' + (err.response?.data?.error || err.message));
                              }
                            }}
                            style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#ef4444', borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem', cursor: 'pointer' }}
                            title="Remove this retailer from item"
                          >
                            <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'text-bottom' }} />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem' }}>
                            Pack:
                            <input type="number" min="1" placeholder="Pack" value={editSourcePackQty} onChange={e => setEditSourcePackQty(parseInt(e.target.value)||1)} style={{ width: 55, padding: '4px', fontSize: '0.85rem' }} />
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem' }}>
                            Size:
                            <input type="number" min="0.1" step="0.1" placeholder="Size" value={editSourceVolQty} onChange={e => setEditSourceVolQty(parseFloat(e.target.value)||1)} style={{ width: 60, padding: '4px', fontSize: '0.85rem' }} />
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem' }}>
                            Unit:
                            <input type="text" placeholder="chew, kg" value={editSourceVolUnit} onChange={e => setEditSourceVolUnit(e.target.value)} style={{ width: 70, padding: '4px', fontSize: '0.85rem' }} />
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={editSourceUnitPricingEnabled} onChange={e => setEditSourceUnitPricingEnabled(e.target.checked)} />
                            Apply unit pricing
                          </label>
                          {source.url.includes('amazon') && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                              Condition:
                              <select
                                value={editSourceTrackCondition}
                                onChange={e => setEditSourceTrackCondition(e.target.value)}
                                style={{ padding: '4px', fontSize: '0.85rem', background: '#1e293b', color: '#fff', border: '1px solid var(--border)', borderRadius: 4 }}
                              >
                                <option value="any">Lowest (New or Resale/Used)</option>
                                <option value="new_only">New Only</option>
                                <option value="used_only">Used / Resale Only</option>
                              </select>
                            </label>
                          )}
                          {source.subscribePrice != null && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                              Subscription:
                              <select
                                value={editSourceTrackSubscribe}
                                onChange={e => setEditSourceTrackSubscribe(e.target.value)}
                                style={{ padding: '4px', fontSize: '0.85rem', background: '#1e293b', color: '#fff', border: '1px solid var(--border)', borderRadius: 4 }}
                              >
                                <option value="any">Lowest (Standard or Sub)</option>
                                <option value="standard">Standard Only</option>
                                <option value="subscribe_only">Subscription / Repeat Only</option>
                              </select>
                            </label>
                          )}
                          <button 
                            onClick={async () => {
                              try {
                                await axios.put(`/api/items/sources/${source.id}`, {
                                  packQuantity: editSourcePackQty,
                                  volumeQuantity: editSourceVolQty,
                                  volumeUnit: editSourceVolUnit,
                                  unitPricingEnabled: editSourceUnitPricingEnabled,
                                  trackCondition: editSourceTrackCondition,
                                  trackSubscribe: editSourceTrackSubscribe
                                });
                                setEditingSourceId(null);
                                fetchData();
                              } catch (e) {
                                console.error(e);
                                alert('Failed to update source quantities');
                              }
                            }}
                            className="btn-primary"
                            style={{ padding: '4px 14px', fontSize: '0.85rem', marginLeft: 'auto' }}
                          >
                            Save
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quick Unit:</span>
                          {presets.map(p => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => { setEditSourceVolUnit(p); setEditSourceUnitPricingEnabled(true); }}
                              style={{
                                background: editSourceVolUnit === p ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                                color: editSourceVolUnit === p ? '#fff' : 'var(--text-muted)',
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
                          {source.currentPrice && editSourceUnitPricingEnabled && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--accent)', marginLeft: 8 }}>
                              Preview: ${(source.currentPrice / (Math.max(editSourcePackQty, 1) * Math.max(editSourceVolQty, 0.001))).toFixed(2)}/{editSourceVolUnit || 'unit'}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', marginTop: 4 }}>
                          <span>
                            <strong style={{ fontSize: '1rem' }}>${source.currentPrice ? source.currentPrice.toFixed(2) : '--'}</strong>
                            {source.currentPrice != null && source.usedPrice != null && Math.abs(source.currentPrice - source.usedPrice) < 0.01 && (
                              <span style={{
                                background: '#d97706',
                                color: '#ffffff',
                                fontSize: '0.62rem',
                                fontWeight: 800,
                                padding: '1px 5px',
                                borderRadius: 3,
                                marginLeft: 6,
                                letterSpacing: '0.5px'
                              }}>
                                USED
                              </span>
                            )}
                            {source.currentPrice != null && source.subscribePrice != null && Math.abs(source.currentPrice - source.subscribePrice) < 0.01 && (
                              <span style={{
                                background: '#0284c7',
                                color: '#ffffff',
                                fontSize: '0.62rem',
                                fontWeight: 800,
                                padding: '1px 5px',
                                borderRadius: 3,
                                marginLeft: 6,
                                letterSpacing: '0.5px'
                              }}>
                                REPEAT / SUB
                              </span>
                            )}
                            {source.unitPriceDisplay && (
                              <span style={{ color: 'var(--accent)', fontWeight: 600, marginLeft: 8 }}>
                                ({source.unitPriceDisplay})
                              </span>
                            )}
                            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{qtyStr}</span>
                            {source.shippingPrice > 0 && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 6 }}>
                                (incl. ${source.shippingPrice.toFixed(2)} postage)
                              </span>
                            )}
                            {source.isPrime && (
                              <span style={{ background: '#00a8e1', color: '#fff', fontWeight: 800, fontSize: '0.65rem', padding: '1px 5px', borderRadius: 3, marginLeft: 6 }}>
                                PRIME
                              </span>
                            )}
                            {source.lastChecked && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>
                                ({formatDateTime(source.lastChecked)})
                              </span>
                            )}
                          </span>
                          <span className={source.status === 'OK' ? 'status-ok' : 'status-error'}>{source.status || 'Pending'}</span>
                        </div>

                        {/* Amazon Resale / Used Offers Callout */}
                        {source.usedPrice != null && (
                          <div style={{
                            marginTop: 8,
                            padding: '8px 12px',
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.25)',
                            borderRadius: 6,
                            fontSize: '0.82rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <span style={{ fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                                🏷️ {source.usedSeller || 'Amazon Resale'}: ${source.usedPrice.toFixed(2)}
                                {source.usedCondition && <span style={{ fontWeight: 500, color: '#fef3c7' }}>({source.usedCondition})</span>}
                              </span>
                              {source.trackCondition && (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                                  Tracking: {source.trackCondition === 'new_only' ? 'New Only' : (source.trackCondition === 'used_only' ? 'Used Only' : 'Lowest (New or Used)')}
                                </span>
                              )}
                            </div>
                            {source.usedConditionNote && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3 }}>
                                Note: {source.usedConditionNote}
                              </div>
                            )}
                            {(() => {
                              let offers = [];
                              try {
                                if (typeof source.usedOffers === 'string') offers = JSON.parse(source.usedOffers);
                                else if (Array.isArray(source.usedOffers)) offers = source.usedOffers;
                              } catch (e) {}
                              if (offers.length > 1) {
                                return (
                                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>All non-new options:</span>
                                    {offers.map((off, oIdx) => (
                                      <span key={oIdx} style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: 4, color: '#fef3c7' }} title={off.conditionNote || ''}>
                                        {off.condition}: ${off.price ? off.price.toFixed(2) : '--'}
                                      </span>
                                    ))}
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}

                        {/* Repeat Delivery / Subscribe & Save Callout */}
                        {source.subscribePrice != null && (
                          <div style={{
                            marginTop: 8,
                            padding: '8px 12px',
                            background: 'rgba(56, 189, 248, 0.08)',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            borderRadius: 6,
                            fontSize: '0.82rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <span style={{ fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
                                🔁 Repeat Delivery / Subscription: ${source.subscribePrice.toFixed(2)}
                                {source.rawPrice && source.subscribePrice < source.rawPrice && (
                                  <span style={{ color: '#86efac', fontWeight: 600, fontSize: '0.75rem', marginLeft: 6 }}>
                                    (Save ${(source.rawPrice - source.subscribePrice).toFixed(2)} / {Math.round((1 - source.subscribePrice / source.rawPrice) * 100)}%)
                                  </span>
                                )}
                              </span>
                              {source.trackSubscribe && (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                                  Tracking: {source.trackSubscribe === 'standard' ? 'Standard Only' : (source.trackSubscribe === 'subscribe_only' ? 'Subscription Only' : 'Lowest (Standard or Sub)')}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Interactive Variation / Pack Option Switcher */}
                        {source.variations?.allVariations && source.variations.allVariations.length > 1 && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              Pack Option:
                            </span>
                            <select
                              value={
                                (source.variations.allVariations.find(v => 
                                  (source.currentPrice != null && Math.abs(v.price - source.currentPrice) < 0.05) ||
                                  v.title === source.name ||
                                  (source.packQuantity && checkVariantMatch(item?.name || '', v.title || '').isMatch)
                                ) || source.variations.allVariations[0])?.asin || source.variations.allVariations[0]?.asin || ''
                              }
                              onChange={async (e) => {
                                const val = e.target.value;
                                const variant = source.variations.allVariations.find(v => (v.asin || v.title) === val);
                                if (!variant) return;
                                try {
                                  await axios.post(`/api/items/sources/${source.id}/select-variation`, {
                                    title: variant.title,
                                    price: variant.price,
                                    asin: variant.asin,
                                    url: variant.url
                                  });
                                  fetchData();
                                } catch (err) {
                                  console.error('Failed to switch variation:', err);
                                }
                              }}
                              style={{
                                fontSize: '0.78rem',
                                padding: '3px 8px',
                                background: '#1e293b',
                                border: '1px solid var(--border)',
                                borderRadius: 5,
                                color: '#fff',
                                cursor: 'pointer'
                              }}
                            >
                              {source.variations.allVariations.map((v, vIdx) => (
                                <option key={vIdx} value={v.asin || v.title}>
                                  {v.title} {v.price != null ? `($${Number(v.price).toFixed(2)})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input 
                type="url" 
                placeholder="Paste new item URL here (Amazon, Pet Circle, Coles, Woolies, ALDI, CW)..." 
                value={newSourceUrl}
                onChange={e => setNewSourceUrl(e.target.value)}
                style={{ flex: 1, padding: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 4, color: 'white', fontSize: '0.9rem' }}
                disabled={addingSource}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="number" min="1" placeholder="Pack Qty" value={newSourcePackQty} onChange={e => setNewSourcePackQty(parseInt(e.target.value)||1)} style={{ width: 85, padding: '8px', fontSize: '0.9rem' }} />
                <input type="number" min="0.1" step="0.1" placeholder="Size" value={newSourceVolQty} onChange={e => setNewSourceVolQty(parseFloat(e.target.value)||1)} style={{ width: 85, padding: '8px', fontSize: '0.9rem' }} />
                <input type="text" placeholder="Unit (chew, kg...)" value={newSourceVolUnit} onChange={e => setNewSourceVolUnit(e.target.value)} style={{ width: 110, padding: '8px', fontSize: '0.9rem' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={newSourceUnitPricingEnabled} onChange={e => setNewSourceUnitPricingEnabled(e.target.checked)} />
                  Apply unit pricing
                </label>
                <button 
                  type="button" 
                  className="btn-primary" 
                  disabled={addingSource || !newSourceUrl}
                  onClick={async () => {
                    if (!newSourceUrl) return;
                    setAddingSource(true);
                    try {
                      await axios.post(`/api/items/${itemId}/sources`, { 
                        url: newSourceUrl,
                        packQuantity: newSourcePackQty,
                        volumeQuantity: newSourceVolQty,
                        volumeUnit: newSourceVolUnit,
                        unitPricingEnabled: newSourceUnitPricingEnabled
                      });
                      setNewSourceUrl('');
                      setNewSourcePackQty(1);
                      setNewSourceVolQty(1);
                      setNewSourceVolUnit('');
                      setNewSourceUnitPricingEnabled(false);
                      fetchData();
                    } catch (e) {
                      console.error(e);
                      alert('Failed to add alternative source');
                    } finally {
                      setAddingSource(false);
                    }
                  }}
                  style={{ minWidth: 80 }}
                >
                  {addingSource ? 'Adding...' : 'Add'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quick Unit:</span>
                {['pack', 'chew', 'tab', 'kg', 'g', 'ml', 'L'].map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { setNewSourceVolUnit(p); setNewSourceUnitPricingEnabled(true); }}
                    style={{
                      background: newSourceVolUnit === p ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                      color: newSourceVolUnit === p ? '#fff' : 'var(--text-muted)',
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
          </div>
          
        </div>

        {/* Right Column: Spreadsheet Settings Form */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={20} /> Tracking Settings
          </h3>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Tracking Type</label>
              <select value={type} onChange={e => setType(e.target.value)}>
                <option value="watching">Watching (Notify on price drop)</option>
                <option value="autodeliver">Auto-Deliver (Notify before delivery)</option>
              </select>
            </div>

            {type === 'autodeliver' && (
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Delivery Interval (Weeks)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="52"
                  value={intervalWeeks} 
                  onChange={e => setIntervalWeeks(e.target.value)} 
                />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 0', borderTop: '1px solid var(--glass-border)' }}>
              <label style={{ flex: 1, cursor: 'pointer', margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Repeat size={16} color="var(--success)" />
                Routinely Bought Staple (Feeds Shopping List)
              </label>
              <input 
                type="checkbox" 
                checked={isRoutine} 
                onChange={e => setIsRoutine(e.target.checked)} 
                style={{ width: 'auto' }}
              />
            </div>

            {isRoutine && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, background: 'rgba(16, 185, 129, 0.08)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Repeat Frequency</label>
                  <select value={routineFrequency} onChange={e => setRoutineFrequency(e.target.value)}>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                    <option value="as_needed">As Needed</option>
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={routineQuantity}
                    onChange={e => setRoutineQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <label style={{ flex: 1, cursor: 'pointer', margin: 0, fontWeight: 600 }}>
                Is this an Auto Buy subscription?
              </label>
              <input 
                type="checkbox" 
                checked={isAutoBuy} 
                onChange={e => setIsAutoBuy(e.target.checked)} 
                style={{ width: 'auto' }}
              />
            </div>
            
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              If enabled, Spike Alerts are useful to warn you if your upcoming subscription is suddenly too expensive.
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Notify Above Price (Spike Alert)
              </label>
              <input 
                type="number" 
                step="0.01" 
                placeholder="e.g. 50.00" 
                value={notifyAbove} 
                onChange={e => setNotifyAbove(e.target.value)} 
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Notify Below Price (Drop Alert)
              </label>
              <input 
                type="number" 
                step="0.01" 
                placeholder="e.g. 20.00" 
                value={notifyBelow} 
                onChange={e => setNotifyBelow(e.target.value)} 
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, padding: '12px 0', borderTop: '1px solid var(--glass-border)' }}>
              <label style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                {notify ? <Bell size={18} color="var(--success)" /> : <BellOff size={18} color="var(--text-muted)" />}
                Enable Alerts
              </label>
              <input 
                type="checkbox" 
                checked={notify} 
                onChange={e => setNotify(e.target.checked)} 
                style={{ width: 'auto' }}
              />
            </div>

            <button type="submit" className="btn-primary" disabled={saving} style={{ marginTop: 16 }}>
              {saving ? 'Saving...' : (
                <><Save size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} /> Save Settings</>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Delete Price Point Confirmation Modal */}
      {selectedPoint && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(10, 15, 30, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16
          }}
          onClick={() => {
            if (!deletingPoint) {
              setSelectedPoint(null);
              setDeleteError(null);
            }
          }}
        >
          <div 
            className="glass-panel"
            style={{
              maxWidth: 460,
              width: '100%',
              padding: 24,
              borderRadius: 16,
              border: '1px solid rgba(239, 68, 68, 0.4)',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(239, 68, 68, 0.15)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 10, 
                  background: 'rgba(239, 68, 68, 0.15)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}>
                  <Trash2 size={20} color="#ef4444" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Delete Price Point</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Remove data point from history</span>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!deletingPoint) {
                    setSelectedPoint(null);
                    setDeleteError(null);
                  }
                }}
                disabled={deletingPoint}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete this recorded price point?
            </p>

            {/* Point details card */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid var(--glass-border)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: STORE_CONFIG[selectedPoint.storeKey]?.color ? `${STORE_CONFIG[selectedPoint.storeKey].color}22` : 'rgba(255,255,255,0.1)',
                  color: STORE_CONFIG[selectedPoint.storeKey]?.color || 'var(--text-main)',
                  border: `1px solid ${STORE_CONFIG[selectedPoint.storeKey]?.color || 'var(--glass-border)'}`
                }}>
                  {selectedPoint.storeName}
                </span>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  ${selectedPoint.price !== undefined ? selectedPoint.price.toFixed(2) : '--'}
                </div>
              </div>

              {selectedPoint.unitPrice != null && Math.abs(selectedPoint.unitPrice - selectedPoint.price) > 0.005 && (
                <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600, marginBottom: 8 }}>
                  Standardized unit price: ${selectedPoint.unitPrice.toFixed(2)}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <Clock size={14} />
                <span>{selectedPoint.fullDate || selectedPoint.timestamp}</span>
              </div>

              {selectedPoint.url && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <a 
                    href={buildAffiliateUrl(selectedPoint.url, affiliateSettings)} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ 
                      color: 'var(--accent)', 
                      fontSize: '0.8rem', 
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <ExternalLink size={12} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedPoint.url}</span>
                  </a>
                </div>
              )}
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              StockSense will recalculate the product's lowest, highest, and current prices after removing this point.
            </div>

            {deleteError && (
              <div style={{ 
                background: 'rgba(239, 68, 68, 0.15)', 
                border: '1px solid rgba(239, 68, 68, 0.4)', 
                borderRadius: 8, 
                padding: '10px 14px', 
                color: '#ff6b6b', 
                fontSize: '0.85rem', 
                marginBottom: 16 
              }}>
                {deleteError}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={() => {
                  setSelectedPoint(null);
                  setDeleteError(null);
                }}
                disabled={deletingPoint}
                className="tab-btn"
                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePoint}
                disabled={deletingPoint}
                className="btn-primary"
                style={{
                  background: '#ef4444',
                  padding: '8px 18px',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)'
                }}
              >
                {deletingPoint ? (
                  <>
                    <RefreshCcw size={16} className="spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete Point
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: 'rgba(16, 185, 129, 0.95)',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          zIndex: 10000,
          fontWeight: 500,
          fontSize: '0.9rem',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)'
        }}>
          <CheckCircle2 size={18} />
          {toastMessage}
        </div>
      )}
    </div>
  );
}
