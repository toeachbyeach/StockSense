import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Terminal, RefreshCw } from 'lucide-react';

function Logs() {
  const [logs, setLogs] = useState('Fetching logs...');
  const [loading, setLoading] = useState(false);
  const logEndRef = useRef(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/logs');
      setLogs(res.data);
    } catch (e) {
      setLogs('Error fetching logs. ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000); // Auto-refresh every 5s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="card" style={{ height: '70vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2><Terminal size={24} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }} /> System Logs</h2>
        <button 
          className="btn btn-primary" 
          onClick={fetchLogs} 
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>
      
      <div 
        style={{ 
          flex: 1, 
          backgroundColor: '#000', 
          color: '#0f0', 
          padding: '16px', 
          borderRadius: '8px',
          fontFamily: 'monospace',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5)'
        }}
      >
        {logs || 'No logs available.'}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

export default Logs;
