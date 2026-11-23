import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Calculator } from 'lucide-react';

export default function BudgetTool() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      const res = await axios.get('/api/items');
      // Only show items configured for budgeting
      setItems(res.data.filter(i => i.routineFrequency));
    } catch (e) {
      console.error(e);
    }
  };

  // Calculations
  let weeklyTotal = 0;
  let monthlyTotal = 0;
  let yearlyTotal = 0;

  items.forEach(item => {
    if (!item.currentPrice) return;
    const price = item.currentPrice;
    const qty = item.routineQuantity || 1;
    let costPerWeek = 0;
    
    switch(item.routineFrequency) {
      case 'weekly': costPerWeek = price * qty; break;
      case 'fortnightly': costPerWeek = (price * qty) / 2; break;
      case 'monthly': costPerWeek = (price * qty) / 4.33; break;
      case 'yearly': costPerWeek = (price * qty) / 52; break;
    }
    
    weeklyTotal += costPerWeek;
    monthlyTotal += costPerWeek * 4.33;
    yearlyTotal += costPerWeek * 52;
  });

  return (
    <div>
      <div className="glass-panel" style={{ marginBottom: 32 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <Calculator /> Routine Expenditures
        </h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, textAlign: 'center' }}>
          <div>
            <div style={{ color: 'var(--text-muted)' }}>Weekly Cost</div>
            <div className="price-tag">${weeklyTotal.toFixed(2)}</div>
          </div>
          <div style={{ borderLeft: '1px solid var(--glass-border)', borderRight: '1px solid var(--glass-border)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Monthly Cost</div>
            <div className="price-tag">${monthlyTotal.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)' }}>Yearly Cost</div>
            <div className="price-tag" style={{ color: 'var(--warning)' }}>${yearlyTotal.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="item-grid">
        {items.map(item => (
          <div key={item.id} className="glass-panel item-card" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <img src={item.imageUrl} style={{ width: 60, height: 60, objectFit: 'contain', background: 'white', borderRadius: 8 }} />
            <div style={{ flex: 1 }}>
              <div className="item-title" style={{ fontSize: '0.9rem' }}>{item.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 4 }}>
                {item.routineQuantity}x {item.routineFrequency} @ ${item.currentPrice?.toFixed(2) || '--'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
