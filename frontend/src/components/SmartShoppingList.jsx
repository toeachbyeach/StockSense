import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShoppingBag, CheckSquare, Square, Printer, ExternalLink, RefreshCw, Sparkles, Plus, Repeat, ArrowLeft } from 'lucide-react';
import { buildAffiliateUrl, buildAmazonCartLink, isAmazonUrl } from '../utils/affiliate';

export default function SmartShoppingList({ onNavigateToItem, onNavigateTab }) {
  const [basketData, setBasketData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkedItems, setCheckedItems] = useState({});
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'coles', 'woolworths', 'other'
  const [showOtherItems, setShowOtherItems] = useState(false);
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
  }, []);

  const fetchBasket = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/basket');
      setBasketData(res.data);
    } catch (e) {
      console.error('Failed to load shopping list', e);
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (id) => {
    setCheckedItems(prev => ({ ...prev, [id]: !prev[id] }));
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
  const otherItems = items.filter(i => i.bestStore !== 'coles' && i.bestStore !== 'woolworths');

  const filteredItems = items.filter(i => {
    if (activeFilter === 'coles') return i.bestStore === 'coles';
    if (activeFilter === 'woolworths') return i.bestStore === 'woolworths';
    if (activeFilter === 'other') return i.bestStore !== 'coles' && i.bestStore !== 'woolworths';
    return true;
  });

  return (
    <div>
      {/* Top Controls & Overview */}
      <div className="glass-panel" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShoppingBag color="var(--accent)" /> Split Basket & Mobile Checklist
            </h2>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              StockSense analyzes all tracked stores to show you exactly which store has the lowest price for each item.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="tab-btn"
              onClick={handlePrint}
              style={{ border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Printer size={16} /> Print / Save PDF
            </button>
            <button
              className="btn-primary"
              onClick={fetchBasket}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={16} /> Recalculate
            </button>
          </div>
        </div>

        {/* Potential Savings Banner */}
        {basketData?.potentialSplitSavings > 0 && (
          <div style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15))',
            border: '1.5px solid var(--success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Sparkles color="var(--success)" size={24} />
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>
                  Split Basket Saves You ${basketData.potentialSplitSavings.toFixed(2)}!
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Buying each product at its cheapest store saves money compared to buying everything in one place.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, fontSize: '0.88rem' }}>
              <div>Optimized: <strong style={{ color: 'var(--success)' }}>${basketData.totalOptimizedCost.toFixed(2)}</strong></div>
              {basketData.totalColesCost && <div>Coles only: <strong>${basketData.totalColesCost.toFixed(2)}</strong></div>}
              {basketData.totalWooliesCost && <div>Woolies only: <strong>${basketData.totalWooliesCost.toFixed(2)}</strong></div>}
            </div>
          </div>
        )}

        {/* Quick Instant Buy / Click & Collect Buttons */}
        <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {colesItems.length > 0 && (
            <button
              type="button"
              onClick={() => openColesCart(colesItems)}
              style={{
                background: '#e01a22',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
              title="Open all Coles items in new tabs"
            >
              <ExternalLink size={16} /> Open {colesItems.length} Coles Items for Click & Collect
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
                padding: '8px 16px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
              title="Open all Woolworths items in new tabs"
            >
              <ExternalLink size={16} /> Open {wooliesItems.length} Woolworths Items for Click & Collect
            </button>
          )}
        </div>
      </div>

      {/* Store Filter Tabs */}
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

      {/* Interactive Mobile & In-Store Checklist */}
      <div className="glass-panel" style={{ padding: '16px 20px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckSquare size={18} color="var(--accent)" /> In-Store Checklist (Tap item to tick off)
        </h3>

        {filteredItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🛒</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.2rem', fontWeight: 700 }}>Your Shopping List is Empty</h3>
            <p style={{ color: 'var(--text-muted)', maxWidth: 520, margin: '0 auto 20px', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Products marked as <strong>Routinely Bought</strong> on your Price Tracker (like flour, milk, coffee, pet food) automatically feed into this list with real-time supermarket split comparisons.
            </p>
            {onNavigateTab && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => onNavigateTab('tracker')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '0 auto 20px', padding: '8px 18px', fontSize: '0.9rem' }}
              >
                <ArrowLeft size={16} /> Go to Price Tracker to Add Routine Items
              </button>
            )}

            {basketData?.otherItems && basketData.otherItems.length > 0 && (
              <div style={{ marginTop: 28, textAlign: 'left', borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Plus size={16} color="var(--accent)" /> Or Add Any Tracked Watchlist Item to Your Shopping List:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {basketData.otherItems.map(other => (
                    <div
                      key={other.groupId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border)',
                        gap: 12
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        {other.imageUrl && (
                          <img src={other.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 2, flexShrink: 0 }} />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {other.groupName}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            Best: ${other.bestPrice?.toFixed(2) || '--'} at {other.bestStore?.toUpperCase()} {other.unitPriceDisplay ? `• ${other.unitPriceDisplay}` : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={(e) => handleToggleRoutine(other.groupId, false, e)}
                        style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                      >
                        <Plus size={14} /> Add to Routine List
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredItems.map(item => {
              const isChecked = !!checkedItems[item.groupId];
              const storeColor = item.bestStore === 'coles' ? '#e01a22' : (item.bestStore === 'woolworths' ? '#178841' : (item.bestStore === 'amazon' ? '#ff9900' : 'var(--accent)'));
              const storeName = item.bestStore === 'coles' ? 'Coles' : (item.bestStore === 'woolworths' ? 'Woolworths' : (item.bestStore === 'amazon' ? 'Amazon' : item.bestStore.toUpperCase()));

              return (
                <div
                  key={item.groupId}
                  onClick={() => toggleCheck(item.groupId)}
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
                            title={`Open ${storeName} listing with affiliate link`}
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

                        {item.bestUrl && isAmazonUrl(item.bestUrl) && (
                          <a
                            href={buildAmazonCartLink(item.bestUrl, affiliateSettings.amazonAssociateTag)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{
                              background: '#f59e0b',
                              color: '#111827',
                              padding: '1px 6px',
                              borderRadius: 4,
                              fontWeight: 700,
                              fontSize: '0.72rem',
                              textDecoration: 'none'
                            }}
                            title="Add directly to Amazon Cart"
                          >
                            🛒 Cart
                          </a>
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
        )}

        {/* Expandable Section to add other tracked items when list is not empty */}
        {filteredItems.length > 0 && basketData?.otherItems && basketData.otherItems.length > 0 && (
          <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                {basketData.otherItems.length} other items in your watchlist not marked as routine.
              </span>
              <button
                type="button"
                className="tab-btn"
                onClick={() => setShowOtherItems(!showOtherItems)}
                style={{ fontSize: '0.82rem', padding: '4px 10px', border: '1px solid var(--border)' }}
              >
                {showOtherItems ? 'Hide Other Watchlist Items' : '+ Add More Items from Watchlist'}
              </button>
            </div>

            {showOtherItems && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {basketData.otherItems.map(other => (
                  <div
                    key={other.groupId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      gap: 12
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      {other.imageUrl && (
                        <img src={other.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: 2, flexShrink: 0 }} />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {other.groupName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Best: ${other.bestPrice?.toFixed(2) || '--'} at {other.bestStore?.toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="tab-btn"
                      onClick={(e) => handleToggleRoutine(other.groupId, false, e)}
                      style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)' }}
                    >
                      <Plus size={13} /> Add to List
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
