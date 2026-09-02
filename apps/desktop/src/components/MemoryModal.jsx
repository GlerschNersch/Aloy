import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Brain, Plus, Trash2, Save, Check, HardDriveDownload, RotateCcw, AlertTriangle, Lock, LockOpen } from 'lucide-react';

export default function MemoryModal({
  isOpen = true,
  onClose,
  userProfile,
  onSaveProfile,
  memories,
  onAddMemory,
  onDeleteMemory,
  isElectron,
  backupDir,
  onSetBackupDir,
  autoBackupEnabled,
  onSetAutoBackupEnabled,
  isBackingUp,
  lastBackupStatus,
  onBackupNow,
  onRestoreBackup,
  isLockConfigured,
  onLockConfiguredChange,
  isFullPage = false
}) {
  const [name, setName] = useState(userProfile?.name || 'User');
  const [style, setStyle] = useState(userProfile?.style || 'Concise, direct, highly technical, clean code, dark UI aesthetics.');
  const [instructions, setInstructions] = useState(userProfile?.instructions || 'Always address requests directly with production-ready code and optimal architecture.');
  const [checkInsEnabled, setCheckInsEnabled] = useState(userProfile?.checkInsEnabled ?? true);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  const [lockCurrentPin, setLockCurrentPin] = useState('');
  const [lockNewPin, setLockNewPin] = useState('');
  const [lockConfirmPin, setLockConfirmPin] = useState('');
  const [lockError, setLockError] = useState('');
  const [lockSuccess, setLockSuccess] = useState('');
  const [lockBusy, setLockBusy] = useState(false);

  const handleSaveProfileSubmit = (e) => {
    e.preventDefault();
    onSaveProfile({ name, style, instructions, checkInsEnabled });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleAddMemorySubmit = (e) => {
    e.preventDefault();
    if (!newMemoryText.trim()) return;
    onAddMemory(newMemoryText.trim());
    setNewMemoryText('');
  };

  const handleRestoreClick = async () => {
    setRestoreError('');
    const confirmed = window.confirm(
      'Restoring will overwrite your current chats, profile, memories, personas, projects, and finances with the contents of the backup file. Continue?'
    );
    if (!confirmed) return;
    const result = await onRestoreBackup();
    if (result && !result.success && !result.cancelled) {
      setRestoreError(result.error || 'Restore failed.');
    }
  };

  const resetLockForm = () => {
    setLockCurrentPin('');
    setLockNewPin('');
    setLockConfirmPin('');
  };

  const handleSaveLockPin = async (e) => {
    e.preventDefault();
    setLockError('');
    setLockSuccess('');
    if (lockNewPin.length < 4) {
      setLockError('PIN must be at least 4 digits.');
      return;
    }
    if (lockNewPin !== lockConfirmPin) {
      setLockError("PINs don't match.");
      return;
    }
    setLockBusy(true);
    const result = isLockConfigured
      ? await window.electronAPI.changeLockPin(lockCurrentPin, lockNewPin)
      : await window.electronAPI.setupLockPin(lockNewPin);
    setLockBusy(false);
    if (result.success) {
      onLockConfiguredChange(true);
      setLockSuccess(isLockConfigured ? 'PIN changed.' : 'App lock enabled.');
      resetLockForm();
      setTimeout(() => setLockSuccess(''), 2500);
    } else {
      setLockError(result.error || 'Failed to save PIN.');
    }
  };

  const handleRemoveLockPin = async () => {
    setLockError('');
    setLockSuccess('');
    if (!lockCurrentPin) {
      setLockError('Enter your current PIN to remove the lock.');
      return;
    }
    setLockBusy(true);
    const result = await window.electronAPI.clearLockPin(lockCurrentPin);
    setLockBusy(false);
    if (result.success) {
      onLockConfiguredChange(false);
      setLockSuccess('App lock removed.');
      resetLockForm();
      setTimeout(() => setLockSuccess(''), 2500);
    } else {
      setLockError(result.error || 'Failed to remove PIN.');
    }
  };

  const formatBackupTimestamp = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const memoryContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.25), rgba(127, 0, 255, 0.25))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(0, 242, 254, 0.4)'
          }}>
            <Brain size={22} color="#00f2fe" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>Memory & Profile</h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Personalize Aloy and manage long-term facts & backups</p>
          </div>
        </div>
        {onClose && !isFullPage && (
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.5rem', borderRadius: '8px' }}>
            <X size={20} />
          </button>
        )}
      </div>

          {/* Profile Form */}
          <form onSubmit={handleSaveProfileSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#00f2fe', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              1. User Profile & Preferences
            </span>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                  Your Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="glass-input"
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    fontSize: '0.95rem'
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                  Communication Style
                </label>
                <input
                  type="text"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="glass-input"
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    fontSize: '0.95rem'
                  }}
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                Custom Personal System Instructions
              </label>
              <textarea
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="glass-input"
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  fontSize: '0.9rem',
                  resize: 'none'
                }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: '#cbd5e1', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={checkInsEnabled}
                onChange={(e) => setCheckInsEnabled(e.target.checked)}
              />
              Let Aloy ask how your day's going in the first chat each day
            </label>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                border: 'none',
                background: savedSuccess ? 'rgba(34, 197, 94, 0.2)' : 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                color: savedSuccess ? '#4ade80' : '#000',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem'
              }}
            >
              {savedSuccess ? <Check size={18} /> : <Save size={18} />}
              {savedSuccess ? 'Profile Saved!' : 'Save Personal Profile'}
            </motion.button>
          </form>

          {/* Long-Term Memory Bank Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#c084fc', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              2. Memory Bank (Remembered Facts)
            </span>

            {/* Add Memory Input */}
            <form onSubmit={handleAddMemorySubmit} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="e.g. Aloy runs Home Assistant on port 8123"
                value={newMemoryText}
                onChange={(e) => setNewMemoryText(e.target.value)}
                className="glass-input"
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  fontSize: '0.9rem'
                }}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="submit"
                style={{
                  padding: '0.75rem 1.25rem',
                  borderRadius: '12px',
                  background: 'rgba(127, 0, 255, 0.2)',
                  border: '1px solid rgba(127, 0, 255, 0.4)',
                  color: '#c084fc',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <Plus size={16} /> Add Fact
              </motion.button>
            </form>

            {/* Memories List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
              {memories.length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic', padding: '0.5rem' }}>
                  No custom facts saved yet. Add facts above for your local AI to remember across sessions!
                </div>
              ) : (
                memories.map((mem, idx) => (
                  <div
                    key={idx}
                    className="glass-panel"
                    style={{
                      padding: '0.65rem 0.9rem',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                      color: '#f1f5f9'
                    }}
                  >
                    <span>- {typeof mem === 'string' ? mem : (mem.content || mem.text || JSON.stringify(mem))}</span>
                    <button
                      onClick={() => onDeleteMemory(idx)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '2px'
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Markdown Vault Sync Badge */}
            <div
              className="glass-panel"
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                background: 'rgba(0, 242, 254, 0.08)',
                border: '1px solid rgba(0, 242, 254, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.8rem',
                color: '#38bdf8'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Brain size={16} color="#00f2fe" />
                <span><strong>Obsidian Vault Auto-Sync:</strong> Human-readable markdown files active in <code>Aloy Brain</code></span>
              </div>
            </div>
          </div>

          {/* App Lock Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#facc15', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              3. App Lock
            </span>

            {!isElectron ? (
              <div style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>
                The app lock is only available in the Desktop App.
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {isLockConfigured ? <Lock size={14} color="#4ade80" /> : <LockOpen size={14} />}
                  {isLockConfigured
                    ? 'Locks automatically after 15 minutes of inactivity. Forgot your PIN? Delete the file at %USERPROFILE%\\.aloy-server\\lock.json to reset it — nothing else is affected.'
                    : 'No PIN set — Aloy never locks. Set one below to enable auto-lock after 15 minutes idle.'}
                </div>

                <form onSubmit={handleSaveLockPin} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {isLockConfigured && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                        Current PIN
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={lockCurrentPin}
                        onChange={(e) => setLockCurrentPin(e.target.value.replace(/\D/g, ''))}
                        className="glass-input"
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', fontSize: '0.95rem' }}
                        maxLength={12}
                      />
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                        {isLockConfigured ? 'New PIN' : 'Set PIN'}
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={lockNewPin}
                        onChange={(e) => setLockNewPin(e.target.value.replace(/\D/g, ''))}
                        className="glass-input"
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', fontSize: '0.95rem' }}
                        maxLength={12}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                        Confirm PIN
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={lockConfirmPin}
                        onChange={(e) => setLockConfirmPin(e.target.value.replace(/\D/g, ''))}
                        className="glass-input"
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', fontSize: '0.95rem' }}
                        maxLength={12}
                      />
                    </div>
                  </div>

                  {lockError && <div style={{ fontSize: '0.8rem', color: '#f87171' }}>{lockError}</div>}
                  {lockSuccess && <div style={{ fontSize: '0.8rem', color: '#4ade80' }}>{lockSuccess}</div>}

                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={lockBusy}
                      style={{
                        padding: '0.65rem 1rem',
                        borderRadius: '12px',
                        border: '1px solid rgba(250, 204, 21, 0.4)',
                        background: 'rgba(250, 204, 21, 0.12)',
                        color: '#facc15',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        cursor: lockBusy ? 'default' : 'pointer',
                        opacity: lockBusy ? 0.6 : 1
                      }}
                    >
                      {isLockConfigured ? 'Change PIN' : 'Enable App Lock'}
                    </motion.button>

                    {isLockConfigured && (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        disabled={lockBusy}
                        onClick={handleRemoveLockPin}
                        style={{
                          padding: '0.65rem 1rem',
                          borderRadius: '12px',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          background: 'rgba(239, 68, 68, 0.12)',
                          color: '#f87171',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: lockBusy ? 'default' : 'pointer',
                          opacity: lockBusy ? 0.6 : 1
                        }}
                      >
                        Remove Lock
                      </motion.button>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>

          {/* Backup & Restore Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#4ade80', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              4. Backup & Restore
            </span>

            {!isElectron ? (
              <div style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>
                Backing up to a NAS/local folder is only available in the Desktop App.
              </div>
            ) : (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                    Backup Folder
                  </label>
                  <input
                    type="text"
                    value={backupDir}
                    onChange={(e) => onSetBackupDir(e.target.value)}
                    className="glass-input"
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: '12px',
                      fontSize: '0.9rem',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoBackupEnabled}
                    onChange={(e) => onSetAutoBackupEnabled(e.target.checked)}
                  />
                  Auto-back-up every 10 minutes while the app is open
                </label>

                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    disabled={isBackingUp}
                    onClick={onBackupNow}
                    style={{
                      padding: '0.65rem 1rem',
                      borderRadius: '12px',
                      border: '1px solid rgba(74, 222, 128, 0.4)',
                      background: 'rgba(74, 222, 128, 0.12)',
                      color: '#4ade80',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: isBackingUp ? 'default' : 'pointer',
                      opacity: isBackingUp ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <HardDriveDownload size={16} /> {isBackingUp ? 'Backing Up…' : 'Back Up Now'}
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={handleRestoreClick}
                    style={{
                      padding: '0.65rem 1rem',
                      borderRadius: '12px',
                      border: '1px solid rgba(249, 115, 22, 0.4)',
                      background: 'rgba(249, 115, 22, 0.12)',
                      color: '#fb923c',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <RotateCcw size={16} /> Restore from File…
                  </motion.button>
                </div>

                {lastBackupStatus && (
                  <div style={{
                    fontSize: '0.8rem',
                    color: lastBackupStatus.success ? '#4ade80' : '#f87171',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}>
                    {lastBackupStatus.success
                      ? <><Check size={14} /> Last backup: {formatBackupTimestamp(lastBackupStatus.timestamp)}</>
                      : <><AlertTriangle size={14} /> Last backup failed: {lastBackupStatus.error}</>}
                  </div>
                )}

                {restoreError && (
                  <div style={{ fontSize: '0.8rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <AlertTriangle size={14} /> {restoreError}
                  </div>
                )}
              </>
            )}
          </div>
    </div>
  );

  if (isFullPage) {
    return (
      <div style={{
        flex: 1,
        height: '100vh',
        overflowY: 'auto',
        background: '#080c14',
        padding: '2rem 3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem'
      }}>
        {memoryContent}
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(5, 8, 14, 0.85)',
        backdropFilter: 'blur(14px)'
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            width: '100%',
            maxWidth: '680px',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: 'rgba(15, 21, 35, 0.95)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            borderRadius: '24px',
            padding: '2rem',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
          }}
        >
          {memoryContent}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
