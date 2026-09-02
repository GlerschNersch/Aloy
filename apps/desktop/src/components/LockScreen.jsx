import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';

// Full-screen overlay shown while checking lock state on launch, and while
// actually locked. Rendered ON TOP of the existing app tree (which stays
// mounted underneath) rather than replacing it, so background polling/state
// isn't disrupted by locking/unlocking. See App.jsx's lockState effect and
// electron.cjs's lock:* IPC handlers (server/lock.cjs) for the rest of this
// feature — PIN only, no face-ID auto-unlock in this version (kept simple
// on purpose, this gates the whole app so it must never be able to fail
// closed with no way in).
export default function LockScreen({ checking, onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!checking) inputRef.current?.focus();
  }, [checking]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin || verifying) return;
    setVerifying(true);
    setError('');
    const ok = await window.electronAPI?.verifyLockPin?.(pin);
    setVerifying(false);
    if (ok) {
      onUnlock();
    } else {
      setError('Incorrect PIN.');
      setPin('');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(5, 8, 14, 0.98)',
      backdropFilter: 'blur(20px)'
    }}>
      {checking ? (
        <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading…</div>
      ) : (
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            width: '100%',
            maxWidth: '320px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.25rem',
            padding: '1rem'
          }}
        >
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.25), rgba(127, 0, 255, 0.25))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(0, 242, 254, 0.4)'
          }}>
            <Lock size={26} color="#00f2fe" />
          </div>

          <div style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.25rem' }}>
              Aloy is Locked
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Enter your PIN to continue</p>
          </div>

          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="glass-input"
            style={{
              width: '100%',
              padding: '0.85rem 1rem',
              borderRadius: '12px',
              fontSize: '1.25rem',
              letterSpacing: '0.5em',
              textAlign: 'center'
            }}
            maxLength={12}
            autoFocus
          />

          {error && (
            <div style={{ fontSize: '0.85rem', color: '#f87171' }}>{error}</div>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={!pin || verifying}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
              color: '#000',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: (!pin || verifying) ? 'default' : 'pointer',
              opacity: (!pin || verifying) ? 0.6 : 1
            }}
          >
            {verifying ? 'Checking…' : 'Unlock'}
          </motion.button>
        </motion.form>
      )}
    </div>
  );
}
