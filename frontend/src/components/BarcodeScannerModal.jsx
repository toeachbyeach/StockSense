import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Camera, X, Search, RefreshCw, CheckCircle, AlertCircle, ScanBarcode } from 'lucide-react';

export default function BarcodeScannerModal({ isOpen, onClose, onDetected }) {
  const [manualCode, setManualCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [hasBarcodeDetector, setHasBarcodeDetector] = useState(false);
  const [resolvedProduct, setResolvedProduct] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const isScanningRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      setHasBarcodeDetector(true);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setResolvedProduct(null);
      setManualCode('');
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg('Camera access is not supported by your browser. You can type the barcode numbers below.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
        startScanningLoop();
      }
    } catch (err) {
      console.warn('Camera start error:', err);
      setErrorMsg('Could not access camera. Please check camera permissions or enter the barcode numbers manually.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    isScanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startScanningLoop = () => {
    if (!('BarcodeDetector' in window)) return;
    try {
      const barcodeDetector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code']
      });

      isScanningRef.current = true;

      const scan = async () => {
        if (!isScanningRef.current || !videoRef.current || videoRef.current.readyState < 2) {
          animationFrameRef.current = requestAnimationFrame(scan);
          return;
        }

        try {
          const barcodes = await barcodeDetector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            if (code && code.trim()) {
              isScanningRef.current = false;
              handleLookupBarcode(code.trim());
              return;
            }
          }
        } catch (e) {
          // Frame read errors during camera adjust can be ignored
        }

        if (isScanningRef.current) {
          animationFrameRef.current = requestAnimationFrame(scan);
        }
      };

      animationFrameRef.current = requestAnimationFrame(scan);
    } catch (e) {
      console.warn('BarcodeDetector initialization error:', e);
    }
  };

  const handleLookupBarcode = async (codeToLookup) => {
    const code = (codeToLookup || manualCode).trim();
    if (!code) return;

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await axios.get(`/api/barcode/${encodeURIComponent(code)}`);
      if (res.data && res.data.found) {
        setResolvedProduct(res.data);
        stopCamera();
      } else {
        setErrorMsg(res.data.message || `No product details found for barcode ${code}. You can enter the product name directly.`);
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Failed to resolve barcode with Open Food Facts.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmProduct = () => {
    if (resolvedProduct && onDetected) {
      onDetected(resolvedProduct);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 16
    }}>
      <div className="glass-panel" style={{
        maxWidth: 500,
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        borderRadius: 16,
        padding: '24px 22px',
        position: 'relative',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        border: '1.5px solid var(--accent)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ScanBarcode size={24} color="var(--accent)" />
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>Mobile Barcode Scanner</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Camera Viewport */}
        {!resolvedProduct && (
          <div style={{
            position: 'relative',
            borderRadius: 12,
            overflow: 'hidden',
            background: '#000',
            aspectRatio: '4/3',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />

            {/* Visual Scanning Reticle */}
            {cameraActive && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '75%',
                height: '45%',
                border: '2px solid var(--accent)',
                borderRadius: 12,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none'
              }}>
                <div style={{
                  width: '90%',
                  height: '2px',
                  background: 'var(--accent)',
                  boxShadow: '0 0 8px var(--accent)',
                  animation: 'pulse 1.5s infinite'
                }} />
              </div>
            )}

            {!cameraActive && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>
                <Camera size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                <div style={{ fontSize: '0.85rem' }}>Camera inactive. Type the barcode below.</div>
              </div>
            )}
          </div>
        )}

        {/* Resolved Product Preview */}
        {resolvedProduct && (
          <div style={{
            padding: 16,
            borderRadius: 12,
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1.5px solid var(--success)',
            marginBottom: 18,
            display: 'flex',
            gap: 14,
            alignItems: 'center'
          }}>
            {resolvedProduct.imageUrl ? (
              <img
                src={resolvedProduct.imageUrl}
                alt=""
                style={{ width: 64, height: 64, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 4 }}
              />
            ) : (
              <div style={{ width: 64, height: 64, background: 'rgba(255,255,255,0.05)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle size={28} color="var(--success)" />
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 700, textTransform: 'uppercase' }}>
                ✓ Barcode Resolved ({resolvedProduct.barcode})
              </div>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginTop: 2, color: '#fff' }}>
                {resolvedProduct.name}
              </div>
              {resolvedProduct.brand && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Brand: {resolvedProduct.brand} {resolvedProduct.quantity ? `• ${resolvedProduct.quantity}` : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#f87171',
            fontSize: '0.85rem',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <AlertCircle size={18} /> {errorMsg}
          </div>
        )}

        {/* Manual Barcode Input Fallback */}
        {!resolvedProduct && (
          <form onSubmit={(e) => { e.preventDefault(); handleLookupBarcode(); }} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              type="text"
              placeholder="Or enter barcode numbers (e.g. 9300633...)"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              style={{
                flex: 1,
                padding: '10px 14px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: '#fff',
                fontSize: '0.9rem'
              }}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={!manualCode.trim() || loading}
              style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}
            >
              {loading ? <RefreshCw className="spinning" size={16} /> : <Search size={16} />}
              Look Up
            </button>
          </form>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
          <button
            type="button"
            className="tab-btn"
            onClick={onClose}
            style={{ border: '1px solid var(--border)' }}
          >
            Cancel
          </button>
          {resolvedProduct && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirmProduct}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <CheckCircle size={16} /> Add Product to StockSense
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
