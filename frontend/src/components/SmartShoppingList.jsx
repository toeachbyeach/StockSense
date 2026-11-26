import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  ShoppingBag, 
  CheckSquare, 
  Square, 
  Printer, 
  ExternalLink, 
  RefreshCw, 
  Sparkles, 
  Plus, 
  Repeat, 
  ArrowLeft,
  Mic,
  Radio,
  CheckCircle2,
  Home,
  ListTodo,
  Calendar,
  X,
  Check,
  ScanBarcode,
  Car,
  Store,
  Tag,
  Award,
  CheckCircle,
  FileText
} from 'lucide-react';
import { buildAffiliateUrl, buildAmazonCartLink, isAmazonUrl } from '../utils/affiliate';
import BarcodeScannerModal from './BarcodeScannerModal';

export default function SmartShoppingList({ onNavigateToItem, onNavigateTab }) {
  const [basketData, setBasketData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkedItems, setCheckedItems] = useState({});
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'coles', 'woolworths', 'other'
  const [viewMode, setViewMode] = useState('checklist'); // 'checklist' (in-store checklist) or 'optimizer' (split route breakdown)
  const [routeStrategy, setRouteStrategy] = useState('any'); // 'any', 'max2', 'single'
  const [applyEverydayExtra, setApplyEverydayExtra] = useState(false);
  const [isBarcodeOpen, setIsBarcodeOpen] = useState(false);
  const [showOtherItems, setShowOtherItems] = useState(false);
  const [syncedListItems, setSyncedListItems] = useState([]);
  const [hasIntegration, setHasIntegration] = useState(false);
  const [integrationName, setIntegrationName] = useState('Home Assistant');
  const [newItemText, setNewItemText] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [pendingVoiceItems, setPendingVoiceItems] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [manualMatchSelections, setManualMatchSelections] = useState({});
  const [confirmingId, setConfirmingId] = useState(null);
  const [syncToast, setSyncToast] = useState('');
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
        setAffiliateSettings({
          amazonAssociateTag: res.data.amazonAssociateTag || '',
          affiliatePrefix: res.data.affiliatePrefix || ''
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchBasket();
    fetchSyncedItems();
    fetchProductGroups();
    // Background sync to ensure fresh items from Home Assistant
    axios.post('/api/list-sync/sync-all').then(() => {
      fetchSyncedItems();
      fetchBasket();
    }).catch(() => {});
  }, []);

  const fetchBasket = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/basket');
      setBasketData(res.data);
      if (res.data?.everydayRewardsExtra !== undefined) {
        setApplyEverydayExtra(Boolean(res.data.everydayRewardsExtra));
      }
    } catch (e) {
      console.error('Failed to load shopping list', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchSyncedItems = async () => {
    try {
      const [itemsRes, intRes, pendingRes] = await Promise.all([
        axios.get('/api/list-sync/items'),
        axios.get('/api/list-integrations'),
        axios.get('/api/list-sync/pending')
      ]);
      setSyncedListItems(Array.isArray(itemsRes.data) ? itemsRes.data : []);
      setPendingVoiceItems(Array.isArray(pendingRes.data) ? pendingRes.data : []);
      const activeInt = Array.isArray(intRes.data) ? intRes.data.find(i => i.enabled) : null;
      setHasIntegration(!!activeInt);
      if (activeInt) setIntegrationName(activeInt.name);
    } catch (e) {
      console.error('Failed to load synced list items', e);
    }
  };

  const fetchPendingSync = async () => {
    fetchSyncedItems();
  };

  const fetchProductGroups = async () => {
    try {
      const res = await axios.get('/api/items');
      if (Array.isArray(res.data)) {
        // Build unique groups list
        const groupsMap = new Map();
        res.data.forEach(it => {
          const gid = it.group_id || it.id;
          if (!groupsMap.has(gid)) {
            groupsMap.set(gid, { id: gid, name: it.groupName || it.name });
          }
        });
        setAllGroups(Array.from(groupsMap.values()));
      }
    } catch (e) {}
  };

  const handleAddNewItem = async (e) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    setAddingItem(true);
    try {
      await axios.post('/api/list-sync/add', { text: newItemText.trim() });
      const addedText = newItemText.trim();
      setNewItemText('');
      setSyncToast(`Added "${addedText}" to shopping list!`);
      setTimeout(() => setSyncToast(''), 3500);
      await fetchSyncedItems();
      await fetchBasket();
    } catch (err) {
      alert('Failed to add item: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingItem(false);
    }
  };

  const handleToggleSyncedItem = async (syncedItemId, rawText) => {
    try {
      await axios.post('/api/list-sync/complete', { syncedItemId });
      setSyncToast(`Completed "${rawText}"! Checked off in ${integrationName}.`);
      setTimeout(() => setSyncToast(''), 3500);
      await fetchSyncedItems();
      await fetchBasket();
    } catch (e) {
      console.error('Failed to complete synced item', e);
    }
  };

  const handleDeleteSyncedItem = async (syncedItemId) => {
    try {
      await axios.post('/api/list-sync/dismiss', { syncedItemId });
      fetchSyncedItems();
      fetchBasket();
    } catch (e) {
      console.error('Failed to dismiss synced item', e);
    }
  };

  const handleConfirmPair = async (rawText, groupId, quantity, syncedItemId) => {
    setConfirmingId(syncedItemId || rawText);
    try {
      await axios.post('/api/list-sync/match', {
        rawText,
        groupId,
        quantity,
        syncedItemId
      });
      setSyncToast(`Matched "${rawText}"! Saved permanently and added to shopping list.`);
      setTimeout(() => setSyncToast(''), 4000);
      await fetchSyncedItems();
      await fetchBasket();
    } catch (err) {
      alert('Failed to confirm match: ' + (err.response?.data?.error || err.message));
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDismissPending = async (syncedItemId) => {
    try {
      await axios.post('/api/list-sync/dismiss', { syncedItemId });
      fetchPendingSync();
    } catch (err) {
      console.error('Failed to dismiss item', err);
    }
  };

  const toggleCheck = async (groupId, item) => {
    const nextChecked = !checkedItems[groupId];
    setCheckedItems(prev => ({ ...prev, [groupId]: nextChecked }));

    // Two-way sync: if checking off an item that originated from external list, complete it remotely
    if (nextChecked && item?.syncedItems && item.syncedItems.length > 0) {
      for (const sli of item.syncedItems) {
        try {
          await axios.post('/api/list-sync/complete', { syncedItemId: sli.syncedItemId });
          setSyncToast(`Marked "${sli.raw_text}" completed in ${sli.integrationName || 'external list'}!`);
          setTimeout(() => setSyncToast(''), 3500);
        } catch (e) {
          console.warn('Failed two-way completion sync:', e);
        }
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleToggleRoutine = async (groupId, currentlyRoutine, e) => {
    if (e) e.stopPropagation();
    try {
      await axios.post(`/api/items/${groupId}/routine`, { isRoutine: !currentlyRoutine });
      fetchBasket();
    } catch (err) {
      console.error('Failed to toggle routine status', err);
    }
  };

  // Build Coles & Woolies quick links for opening search/product directly with affiliate links
  const openColesCart = (items) => {
    items.forEach(it => {
      const targetUrl = it.colesUrl || `https://www.coles.com.au/search?q=${encodeURIComponent(it.groupName)}`;
      window.open(buildAffiliateUrl(targetUrl, affiliateSettings), '_blank');
    });
  };

  const openWooliesCart = (items) => {
    items.forEach(it => {
      const targetUrl = it.wooliesUrl || `https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(it.groupName)}`;
      window.open(buildAffiliateUrl(targetUrl, affiliateSettings), '_blank');
    });
  };

  const openAldiCart = (items) => {
    items.forEach(it => {
      const targetUrl = it.aldiUrl || `https://www.aldi.com.au/product/${encodeURIComponent(it.groupName)}`;
      window.open(targetUrl, '_blank');
    });
  };

  const openAmazonCart = (items) => {
    items.forEach(it => {
      const targetUrl = it.amazonUrl || `https://www.amazon.com.au/s?k=${encodeURIComponent(it.groupName)}`;
      window.open(buildAffiliateUrl(targetUrl, affiliateSettings), '_blank');
    });
  };

  const handleBarcodeDetected = (product) => {
    if (product && product.name) {
      setNewItemText(product.name);
      setSyncToast(`Scanned "${product.name}"! Click "Add to List" to queue.`);
      setTimeout(() => setSyncToast(''), 4500);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: 40 }}>
        <RefreshCw className="spinning" size={28} color="var(--accent)" style={{ margin: '0 auto 12px' }} />
        <div>Optimizing and calculating your shopping list...</div>
      </div>
    );
  }

  const items = basketData?.items || [];
  const colesItems = items.filter(i => i.bestStore === 'coles');
  const wooliesItems = items.filter(i => i.bestStore === 'woolworths');
  const aldiItems = items.filter(i => i.bestStore === 'aldi');
  const amazonItems = items.filter(i => i.bestStore === 'amazon');
  const otherItems = items.filter(i => i.bestStore !== 'coles' && i.bestStore !== 'woolworths' && i.bestStore !== 'aldi' && i.bestStore !== 'amazon');

  const filteredItems = items.filter(i => {
    if (activeFilter === 'coles') return i.bestStore === 'coles';
    if (activeFilter === 'woolworths') return i.bestStore === 'woolworths';
    if (activeFilter === 'aldi') return i.bestStore === 'aldi';
    if (activeFilter === 'amazon') return i.bestStore === 'amazon';
    if (activeFilter === 'other') return i.bestStore !== 'coles' && i.bestStore !== 'woolworths' && i.bestStore !== 'aldi' && i.bestStore !== 'amazon';
    return true;
  });

  const checkedCount = items.filter(it => checkedItems[it.groupId]).length;
  const progressPct = items.length > 0 ? Math.round((checkedCount / items.length) * 100) : 0;

  return (
    <div>
      {/* Top Controls & Overview */}
      <div className="glass-panel" style={{ marginBottom: 24 }}>
        {/* Top Controls Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShoppingBag color="var(--accent)" /> Smart Shopping List & Split Basket
            </h2>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              Two-way synced with Home Assistant & voice assistants, combined with automated supermarket split price comparisons.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="tab-btn"
              onClick={() => setIsBarcodeOpen(true)}
              style={{ border: '1px solid var(--accent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Scan physical product barcode using camera or enter number"
            >
              <ScanBarcode size={16} /> Scan Barcode
            </button>
            <button
              className="tab-btn"
              onClick={handlePrint}
              style={{ border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Printer size={16} /> Print / Save PDF
            </button>
            <button
              className="btn-primary"
              onClick={() => { fetchBasket(); fetchSyncedItems(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={16} /> Refresh All
            </button>
          </div>
        </div>

        {/* View Mode Switcher: In-Store Checklist vs Split Optimizer */}
        <div style={{
          marginTop: 18,
          display: 'flex',
          gap: 10,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 12,
          flexWrap: 'wrap'
        }}>
          <button
            type="button"
            className={`tab-btn ${viewMode === 'checklist' ? 'active' : ''}`}
            onClick={() => setViewMode('checklist')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 600,
              fontSize: '0.9rem'
            }}
          >
            <CheckSquare size={17} /> 📋 In-Store Checklist (Aisle Grouped)
          </button>
          <button
            type="button"
            className={`tab-btn ${viewMode === 'optimizer' ? 'active' : ''}`}
            onClick={() => setViewMode('optimizer')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 600,
              fontSize: '0.9rem'
            }}
          >
            <Sparkles size={17} /> ⚡ Split Basket Optimizer & Carts
          </button>
        </div>

        {/* Sync Toast Feedback */}
        {syncToast && (
          <div style={{
            marginTop: 16,
            padding: '10px 16px',
            borderRadius: 8,
            background: 'rgba(16, 185, 129, 0.2)',
            border: '1px solid var(--success)',
            color: 'var(--success)',
            fontSize: '0.88rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <CheckCircle2 size={18} /> {syncToast}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 1: HOME ASSISTANT & SYNCED SHOPPING LIST (FIRST THING SHOWN)       */}
        {/* ========================================================================= */}
        <div style={{
          marginTop: 20,
          padding: '18px 20px',
          borderRadius: 12,
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1.5px solid #03a9f4',
          boxShadow: '0 4px 24px rgba(3, 169, 244, 0.12)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: 'rgba(3, 169, 244, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(3, 169, 244, 0.4)'
              }}>
                <Home size={22} color="#03a9f4" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {integrationName} Shopping List
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(3, 169, 244, 0.2)',
                    color: '#38bdf8',
                    border: '1px solid rgba(3, 169, 244, 0.4)',
                    fontWeight: 700
                  }}>
                    {syncedListItems.length} {syncedListItems.length === 1 ? 'item' : 'items'}
                  </span>
                  <span style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: 'var(--success)',
                    border: '1px solid rgba(34, 197, 94, 0.35)',
                    fontWeight: 600
                  }}>
                    Two-Way Sync Active
                  </span>
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Items added via voice assistants (Alexa/Google/Siri) or Home Assistant appear here. Ticking an item off completes it remotely!
                </div>
              </div>
            </div>

            <button
              type="button"
              className="tab-btn"
              onClick={fetchSyncedItems}
              style={{ fontSize: '0.8rem', padding: '6px 12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={13} /> Sync List
            </button>
          </div>

          {/* Quick Add Bar to Home Assistant */}
          <form onSubmit={handleAddNewItem} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type="text"
              placeholder={`Add an item to ${integrationName} (e.g. 2x kangaroo mince, sourdough bread)...`}
              value={newItemText}
              onChange={e => setNewItemText(e.target.value)}
              style={{
                flex: 1,
                padding: '9px 14px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: '#fff',
                fontSize: '0.88rem'
              }}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={!newItemText.trim() || addingItem}
              style={{ padding: '9px 16px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', whiteSpace: 'nowrap' }}
            >
              <Plus size={16} /> {addingItem ? 'Adding...' : 'Add to List'}
            </button>
          </form>

          {/* Items List */}
          {syncedListItems.length === 0 ? (
            <div style={{
              padding: '16px 20px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed var(--border)',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.88rem'
            }}>
              ✓ Your {integrationName} shopping list is clear! Items added via voice or typed above will appear here with store prices.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {syncedListItems.map(item => {
                const isMatched = !!item.groupId;
                const isConfirming = confirmingId === item.syncedItemId || confirmingId === item.raw_text;
                const selectedGroupId = manualMatchSelections[item.syncedItemId] || (item.candidates?.[0]?.id || '');

                return (
                  <div
                    key={item.syncedItemId}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      padding: '12px 16px',
                      borderRadius: 10,
                      background: isMatched ? 'rgba(255,255,255,0.04)' : 'rgba(168, 85, 247, 0.07)',
                      border: isMatched ? '1px solid var(--border)' : '1px solid rgba(168, 85, 247, 0.4)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <div
                        onClick={() => handleToggleSyncedItem(item.syncedItemId, item.raw_text)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', minWidth: 0, flex: 1, userSelect: 'none' }}
                        title="Click to mark complete in StockSense and Home Assistant"
                      >
                        <Square size={20} color="var(--accent)" />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ color: '#fff' }}>{item.raw_text}</span>
                            {item.quantity > 1 && (
                              <span style={{
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'rgba(56, 189, 248, 0.2)',
                                color: '#38bdf8',
                                fontWeight: 700
                              }}>
                                ×{item.quantity}
                              </span>
                            )}
                            {isMatched ? (
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: 'rgba(34, 197, 94, 0.15)',
                                color: 'var(--success)',
                                border: '1px solid rgba(34, 197, 94, 0.35)',
                                fontWeight: 600
                              }}>
                                ✓ Matched: {item.groupName}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: 'rgba(168, 85, 247, 0.2)',
                                color: '#c084fc',
                                border: '1px solid rgba(168, 85, 247, 0.4)',
                                fontWeight: 600
                              }}>
                                Unmatched Voice Item
                              </span>
                            )}
                          </div>
                          {isMatched && item.lowestPrice != null && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              Cheapest Price: <strong style={{ color: 'var(--success)' }}>${item.lowestPrice.toFixed(2)}</strong> {item.unitPriceDisplay ? `• ${item.unitPriceDisplay}` : ''}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => handleToggleSyncedItem(item.syncedItemId, item.raw_text)}
                          className="btn-primary"
                          style={{ fontSize: '0.78rem', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
                          title="Complete item"
                        >
                          <Check size={14} /> Done
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSyncedItem(item.syncedItemId)}
                          className="tab-btn"
                          style={{ border: '1px solid var(--border)', padding: '5px 8px', color: 'var(--text-muted)' }}
                          title="Dismiss item"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Unmatched Confirmation Chips (Option A) */}
                    {!isMatched && (
                      <div style={{
                        marginTop: 6,
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px dashed rgba(168, 85, 247, 0.4)'
                      }}>
                        <div style={{ fontSize: '0.78rem', color: '#c084fc', fontWeight: 600, marginBottom: 6 }}>
                          Confirm product match to see live store prices (Option A):
                        </div>
                        {item.candidates && item.candidates.length > 0 ? (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                            {item.candidates.slice(0, 3).map(candidate => (
                              <button
                                key={candidate.id}
                                type="button"
                                disabled={isConfirming}
                                onClick={() => handleConfirmPair(item.raw_text, candidate.id, item.quantity || 1, item.syncedItemId)}
                                style={{
                                  background: 'rgba(255,255,255,0.06)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 6,
                                  padding: '5px 10px',
                                  color: '#fff',
                                  fontSize: '0.78rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6
                                }}
                              >
                                <Check size={12} color="var(--success)" />
                                <span>{candidate.name}</span>
                                {candidate.lowestPrice != null && (
                                  <strong style={{ color: 'var(--success)' }}>${candidate.lowestPrice.toFixed(2)}</strong>
                                )}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            value={selectedGroupId}
                            onChange={(e) => setManualMatchSelections(prev => ({ ...prev, [item.syncedItemId]: e.target.value }))}
                            style={{
                              flex: 1,
                              minWidth: 180,
                              padding: '5px 8px',
                              background: 'rgba(0,0,0,0.4)',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              color: '#fff',
                              fontSize: '0.78rem'
                            }}
                          >
                            <option value="">-- Or choose any tracked product --</option>
                            {allGroups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="tab-btn"
                            disabled={!selectedGroupId || isConfirming}
                            onClick={() => handleConfirmPair(
                              item.raw_text,
                              Number(selectedGroupId),
                              item.quantity || 1,
                              item.syncedItemId
                            )}
                            style={{ border: '1px solid var(--border)', padding: '5px 10px', fontSize: '0.78rem' }}
                          >
                            Confirm Match
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* SECTION 2: SAVINGS BANNER & LOYALTY PROGRAM CALCULATOR                    */}
        {/* ========================================================================= */}

        {/* Potential Savings & Loyalty Program Banner */}
        <div style={{
          marginTop: 20,
          padding: '16px 20px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(59, 130, 246, 0.12))',
          border: '1.5px solid var(--success)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Sparkles color="var(--success)" size={24} />
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#fff' }}>
                  {basketData?.potentialSplitSavings > 0 
                    ? `Split Basket Saves You $${basketData.potentialSplitSavings.toFixed(2)}!`
                    : `Multi-Store Price Comparison & Route Optimizer`}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Comparing real-time prices across Coles, Woolworths, ALDI, Chemist Warehouse & Amazon.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, fontSize: '0.88rem', flexWrap: 'wrap' }}>
              <div>Optimized Split: <strong style={{ color: 'var(--success)', fontSize: '1rem' }}>${basketData?.totalOptimizedCost?.toFixed(2) || '0.00'}</strong></div>
              {basketData?.totalColesCost && <div>Coles only: <strong>${basketData.totalColesCost.toFixed(2)}</strong></div>}
              {basketData?.totalWooliesCost && (
                <div>
                  Woolies only: <strong>${basketData.totalWooliesCost.toFixed(2)}</strong>
                  {applyEverydayExtra && basketData.wooliesDiscountedCost && (
                    <span style={{ color: 'var(--success)', marginLeft: 6, fontWeight: 700 }}>
                      (${basketData.wooliesDiscountedCost.toFixed(2)} w/ 10% Extra)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Loyalty Program Perks Bar (Woolworths Everyday Extra & Flybuys) */}
          <div style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: '0.83rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={applyEverydayExtra}
                  onChange={(e) => setApplyEverydayExtra(e.target.checked)}
                />
                <span style={{ color: '#34d399', fontWeight: 600 }}>
                  Woolworths Everyday Extra (10% Monthly Perk)
                </span>
              </label>

              {basketData?.totalWooliesCost && applyEverydayExtra && (
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                  Saves ${Math.min(50, basketData.totalWooliesCost * 0.10).toFixed(2)} on Woolies!
                </span>
              )}

              {basketData?.flybuysPoints > 0 && (
                <span style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Award size={13} /> Coles Flybuys: ~{basketData.flybuysPoints} pts (~${basketData.flybuysDollarValue.toFixed(2)})
                </span>
              )}
            </div>

            {applyEverydayExtra && basketData?.wooliesDiscountedCost && basketData?.totalOptimizedCost && (
              <div style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                {basketData.wooliesDiscountedCost < basketData.totalOptimizedCost ? (
                  <strong style={{ color: 'var(--success)' }}>
                    🏆 Woolies with 10% Extra is CHEAPER than splitting (${basketData.wooliesDiscountedCost.toFixed(2)} vs ${basketData.totalOptimizedCost.toFixed(2)})!
                  </strong>
                ) : (
                  <span>
                    Splitting saves ${(basketData.wooliesDiscountedCost - basketData.totalOptimizedCost).toFixed(2)} vs Woolies 10% perk.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick Instant Buy / Click & Collect Buttons */}
        <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {colesItems.length > 0 && (
            <button
              type="button"
              onClick={() => openColesCart(colesItems)}
              style={{
                background: '#e01a22',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              title="Open Coles items for Click & Collect"
            >
              <ExternalLink size={14} /> Open {colesItems.length} Coles for Click &amp; Collect
            </button>
          )}

          {wooliesItems.length > 0 && (
            <button
              type="button"
              onClick={() => openWooliesCart(wooliesItems)}
              style={{
                background: '#178841',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              title="Open Woolworths items for Click & Collect"
            >
              <ExternalLink size={14} /> Open {wooliesItems.length} Woolies for Click &amp; Collect
            </button>
          )}

          {aldiItems.length > 0 && (
            <button
              type="button"
              onClick={() => openAldiCart(aldiItems)}
              style={{
                background: '#002d72',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              title="Open ALDI items"
            >
              <ExternalLink size={14} /> Open {aldiItems.length} ALDI Items
            </button>
          )}

          {amazonItems.length > 0 && (
            <button
              type="button"
              onClick={() => openAmazonCart(amazonItems)}
              style={{
                background: '#f59e0b',
                color: '#111827',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              title="Open Amazon Cart"
            >
              🛒 Open {amazonItems.length} Amazon Items
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW MODE 1: IN-STORE PHYSICAL CHECKLIST (AISLE / DEPARTMENT GROUPED)     */}
      {/* ========================================================================= */}
      {viewMode === 'checklist' && (
        <div className="glass-panel" style={{ padding: '20px 22px' }}>
          {/* Checklist Header & Progress Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckSquare size={20} color="var(--accent)" /> In-Store Checklist (Grouped by Supermarket Aisle)
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Organized in walking order through the store. Tap any item to check off!
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                {checkedCount} of {items.length} items ticked ({progressPct}%)
              </span>
              {checkedCount > 0 && (
                <button
                  type="button"
                  className="tab-btn"
                  onClick={() => setCheckedItems({})}
                  style={{ fontSize: '0.75rem', padding: '4px 10px', border: '1px solid var(--border)' }}
                >
                  Uncheck All
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--success)', transition: 'width 0.25s ease' }} />
          </div>

          {/* Department Grouped Sections */}
          {(!basketData?.departments || basketData.departments.length === 0) ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
              No routine items on your shopping list yet!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {basketData.departments.map(dept => (
                <div key={dept.id} className="checklist-dept-block" style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  {/* Department Banner Header */}
                  <div style={{
                    padding: '10px 16px',
                    background: 'rgba(255,255,255,0.04)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontWeight: 700,
                    fontSize: '0.92rem'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '1.2rem' }}>{dept.icon}</span>
                      <span>{dept.name}</span>
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                      {dept.items.length} {dept.items.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  {/* Items in this aisle */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {dept.items.map((item, idx) => {
                      const isChecked = !!checkedItems[item.groupId];
                      const storeColor = item.bestStore === 'coles' ? '#e01a22' : (item.bestStore === 'woolworths' ? '#178841' : (item.bestStore === 'aldi' ? '#002d72' : (item.bestStore === 'amazon' ? '#ff9900' : 'var(--accent)')));
                      const storeName = item.bestStore === 'coles' ? 'Coles' : (item.bestStore === 'woolworths' ? 'Woolworths' : (item.bestStore === 'aldi' ? 'ALDI' : (item.bestStore === 'amazon' ? 'Amazon' : item.bestStore.toUpperCase())));

                      return (
                        <div
                          key={item.groupId}
                          onClick={() => toggleCheck(item.groupId, item)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            background: isChecked ? 'rgba(255,255,255,0.015)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'),
                            borderBottom: idx === dept.items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                            cursor: 'pointer',
                            userSelect: 'none',
                            opacity: isChecked ? 0.45 : 1,
                            textDecoration: isChecked ? 'line-through' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                            {isChecked ? <CheckSquare size={22} color="var(--success)" /> : <Square size={22} color="var(--text-muted)" />}
                            {item.imageUrl && (
                              <img src={item.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 2, flexShrink: 0 }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span>{item.groupName}</span>
                                {item.quantity > 1 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>(×{item.quantity})</span>}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: 8, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{
                                  background: `${storeColor}22`,
                                  color: storeColor,
                                  border: `1px solid ${storeColor}55`,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  fontSize: '0.7rem'
                                }}>
                                  BUY AT {storeName}
                                </span>
                                {item.unitPriceDisplay && (
                                  <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.72rem' }}>
                                    {item.unitPriceDisplay}
                                  </span>
                                )}
                                {item.savings > 0 && (
                                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                    Saves ${item.savings.toFixed(2)} vs competitor
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', marginLeft: 16 }}>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: isChecked ? 'var(--text-muted)' : 'var(--text-main)' }}>
                              ${(item.bestPrice * item.quantity).toFixed(2)}
                            </div>
                            {item.quantity > 1 && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                (${item.bestPrice.toFixed(2)} ea)
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 2: SPLIT BASKET OPTIMIZER & STORE ROUTES                        */}
      {/* ========================================================================= */}
      {viewMode === 'optimizer' && (
        <div>
          {/* Strategy Tabs */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <button
              className={`tab-btn ${routeStrategy === 'any' ? 'active' : ''}`}
              onClick={() => setRouteStrategy('any')}
              style={{ borderRadius: 8, padding: '8px 16px', fontWeight: 600 }}
            >
              ⚡ Optimal Split (Cheapest Everywhere)
            </button>

            {basketData?.twoStoreOptimal && (
              <button
                className={`tab-btn ${routeStrategy === 'max2' ? 'active' : ''}`}
                onClick={() => setRouteStrategy('max2')}
                style={{ borderRadius: 8, padding: '8px 16px', fontWeight: 600 }}
              >
                🚗 Max 2 Stores ({basketData.twoStoreOptimal.pair.map(s => s.toUpperCase()).join(' + ')})
              </button>
            )}

            <button
              className={`tab-btn ${routeStrategy === 'single' ? 'active' : ''}`}
              onClick={() => setRouteStrategy('single')}
              style={{ borderRadius: 8, padding: '8px 16px', fontWeight: 600 }}
            >
              🏪 Single Store Comparison
            </button>
          </div>

          {/* Strategy Details: 2-Store Split */}
          {routeStrategy === 'max2' && basketData?.twoStoreOptimal && (
            <div className="glass-panel" style={{ marginBottom: 20, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Car size={20} color="var(--accent)" /> Optimal 2-Store Shopping Trip
                </h3>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>
                  Total: ${basketData.twoStoreOptimal.totalCost.toFixed(2)}
                </div>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                Minimizes your driving: Buy at <strong>{basketData.twoStoreOptimal.pair[0].toUpperCase()}</strong> and <strong>{basketData.twoStoreOptimal.pair[1].toUpperCase()}</strong> for the best balance of savings and convenience.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 8, textTransform: 'uppercase', color: 'var(--accent)' }}>
                    {basketData.twoStoreOptimal.store1.store} ({basketData.twoStoreOptimal.store1.items.length} items - ${basketData.twoStoreOptimal.store1.subtotal.toFixed(2)})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {basketData.twoStoreOptimal.store1.items.map(it => (
                      <li key={it.groupId}>
                        {it.groupName} ({it.quantity > 1 ? `×${it.quantity}` : ''}) — <strong>${(it.chosenPrice * it.quantity).toFixed(2)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>

                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 8, textTransform: 'uppercase', color: 'var(--accent)' }}>
                    {basketData.twoStoreOptimal.store2.store} ({basketData.twoStoreOptimal.store2.items.length} items - ${basketData.twoStoreOptimal.store2.subtotal.toFixed(2)})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {basketData.twoStoreOptimal.store2.items.map(it => (
                      <li key={it.groupId}>
                        {it.groupName} ({it.quantity > 1 ? `×${it.quantity}` : ''}) — <strong>${(it.chosenPrice * it.quantity).toFixed(2)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Strategy Details: Single Store Comparisons */}
          {routeStrategy === 'single' && (
            <div className="glass-panel" style={{ marginBottom: 20, padding: 20 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Store size={20} color="var(--accent)" /> Single Store Basket Totals
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                {basketData?.singleStoreComparisons?.map(sc => (
                  <div key={sc.store} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', marginBottom: 4 }}>
                      {sc.name}
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: 6 }}>
                      ${sc.cost.toFixed(2)}
                    </div>
                    {sc.discountedCost && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--success)', fontWeight: 600, marginBottom: 4 }}>
                        w/ 10% Extra: ${sc.discountedCost.toFixed(2)}
                      </div>
                    )}
                    {sc.missingCount > 0 ? (
                      <div style={{ fontSize: '0.78rem', color: '#f87171' }}>
                        ⚠ {sc.missingCount} item{sc.missingCount > 1 ? 's' : ''} not sold at {sc.name}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: 'var(--success)' }}>
                        ✓ All basket items available
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Store Filter Tabs for List */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button
              className={`tab-btn ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
              style={{ borderRadius: 8, padding: '6px 14px' }}
            >
              All Items ({items.length})
            </button>
            <button
              className={`tab-btn ${activeFilter === 'coles' ? 'active' : ''}`}
              onClick={() => setActiveFilter('coles')}
              style={{ borderRadius: 8, padding: '6px 14px', borderColor: '#e01a22', color: activeFilter === 'coles' ? '#fff' : '#e01a22' }}
            >
              Coles ({colesItems.length})
            </button>
            <button
              className={`tab-btn ${activeFilter === 'woolworths' ? 'active' : ''}`}
              onClick={() => setActiveFilter('woolworths')}
              style={{ borderRadius: 8, padding: '6px 14px', borderColor: '#178841', color: activeFilter === 'woolworths' ? '#fff' : '#178841' }}
            >
              Woolworths ({wooliesItems.length})
            </button>
            {aldiItems.length > 0 && (
              <button
                className={`tab-btn ${activeFilter === 'aldi' ? 'active' : ''}`}
                onClick={() => setActiveFilter('aldi')}
                style={{ borderRadius: 8, padding: '6px 14px', borderColor: '#002d72', color: activeFilter === 'aldi' ? '#fff' : '#002d72' }}
              >
                ALDI ({aldiItems.length})
              </button>
            )}
            {otherItems.length > 0 && (
              <button
                className={`tab-btn ${activeFilter === 'other' ? 'active' : ''}`}
                onClick={() => setActiveFilter('other')}
                style={{ borderRadius: 8, padding: '6px 14px' }}
              >
                Other Stores ({otherItems.length})
              </button>
            )}
          </div>

          {/* Filtered Items List */}
          <div className="glass-panel" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredItems.map(item => {
                const isChecked = !!checkedItems[item.groupId];
                const storeColor = item.bestStore === 'coles' ? '#e01a22' : (item.bestStore === 'woolworths' ? '#178841' : (item.bestStore === 'aldi' ? '#002d72' : (item.bestStore === 'amazon' ? '#ff9900' : 'var(--accent)')));
                const storeName = item.bestStore === 'coles' ? 'Coles' : (item.bestStore === 'woolworths' ? 'Woolworths' : (item.bestStore === 'aldi' ? 'ALDI' : (item.bestStore === 'amazon' ? 'Amazon' : item.bestStore.toUpperCase())));

                return (
                  <div
                    key={item.groupId}
                    onClick={() => toggleCheck(item.groupId, item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: 10,
                      background: isChecked ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                      border: isChecked ? '1px solid rgba(255,255,255,0.05)' : '1px solid var(--border)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      opacity: isChecked ? 0.45 : 1,
                      textDecoration: isChecked ? 'line-through' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                      {isChecked ? <CheckSquare size={20} color="var(--success)" /> : <Square size={20} color="var(--text-muted)" />}
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt="" style={{ width: 44, height: 44, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 3, flexShrink: 0 }} />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span>{item.groupName}</span>
                          {item.quantity > 1 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>(×{item.quantity})</span>}
                          {item.routineFrequency && (
                            <span style={{
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#93c5fd',
                              border: '1px solid rgba(59, 130, 246, 0.35)',
                              fontSize: '0.7rem',
                              padding: '1px 6px',
                              borderRadius: 4,
                              fontWeight: 600
                            }}>
                              {item.routineFrequency}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          {item.bestUrl ? (
                            <a
                              href={buildAffiliateUrl(item.bestUrl, affiliateSettings)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{
                                background: `${storeColor}22`,
                                color: storeColor,
                                border: `1px solid ${storeColor}55`,
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontWeight: 700,
                                fontSize: '0.72rem',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              BUY AT {storeName} ↗
                            </a>
                          ) : (
                            <span style={{
                              background: `${storeColor}22`,
                              color: storeColor,
                              border: `1px solid ${storeColor}55`,
                              padding: '1px 6px',
                              borderRadius: 4,
                              fontWeight: 700,
                              fontSize: '0.72rem'
                            }}>
                              BUY AT {storeName}
                            </span>
                          )}

                          {item.unitPriceDisplay && (
                            <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.75rem' }}>
                              {item.unitPriceDisplay}
                            </span>
                          )}

                          {item.savings > 0 && (
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                              Saves ${item.savings.toFixed(2)} vs competitor
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', marginLeft: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1.05rem', color: isChecked ? 'var(--text-muted)' : 'var(--text-main)' }}>
                          ${(item.bestPrice * item.quantity).toFixed(2)}
                        </div>
                        {item.quantity > 1 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            (${item.bestPrice.toFixed(2)} ea)
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => handleToggleRoutine(item.groupId, true, e)}
                        title="Remove from Routine Shopping List"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: 4,
                          opacity: 0.6
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isBarcodeOpen}
        onClose={() => setIsBarcodeOpen(false)}
        onDetected={handleBarcodeDetected}
      />

      {/* Dedicated Print & PDF Layout Stylesheet */}
      <style>{`
        @media print {
          body {
            background: #ffffff !important;
            color: #000000 !important;
          }
          nav, header, button, .tab-btn, .btn-primary, form, input, select {
            display: none !important;
          }
          .glass-panel {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
          .checklist-dept-block {
            border: 1px solid #333 !important;
            margin-bottom: 16px !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>
    </div>
  );
}
