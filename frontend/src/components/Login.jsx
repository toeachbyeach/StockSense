import React, { useState } from 'react';
import axios from 'axios';
import { Lock } from 'lucide-react';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await axios.post('/api/login', { password });
      if (res.data.token) {
        localStorage.setItem('stocksense_token', res.data.token);
        // Set axios default immediately to avoid a race where other components
        // make API calls before App's token effect runs and clear the token.
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        onLogin(res.data.token);
      }
    } catch (err) {
      setError('Invalid password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: 24 }}>
      <div className="glass-panel" style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: '50%' }}>
            <Lock size={32} color="var(--accent)" />
          </div>
        </div>
        
        <h2 style={{ marginBottom: 8 }}>StockSense</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Enter your Master Password to continue</p>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input 
            type="password" 
            placeholder="Password" 
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            style={{ textAlign: 'center' }}
          />
          {error && <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
