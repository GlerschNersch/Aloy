import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Lock,
  Unlock,
  Thermometer,
  Lightbulb,
  Zap,
  RefreshCw,
  Users,
  MapPin,
  User,
} from 'lucide-react';

export default function SmartHomeDrawer({
  isOpen = true,
  onClose,
  categories,
  onExecuteService,
  onRefresh,
  isRefreshing,
  isFullPage = false
}) {
  const [activeTab, setActiveTab] = useState('lights');
  const [executingMap, setExecutingMap] = useState({});

  const handleToggleDevice = async (domain, service, entityId) => {
    setExecutingMap(prev => ({ ...prev, [entityId]: true }));
    await onExecuteService(domain, service, entityId);
    setExecutingMap(prev => ({ ...prev, [entityId]: false }));
  };

  const lightsList = categories?.lights || [];
  const locksList = categories?.locks || [];
  const climateList = categories?.climate || [];
  const personsList = categories?.persons || [];
  const trackersList = categories?.trackers || [];

  const drawerContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '1rem' }}>
            {/* Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '12px',
                  background: 'rgba(0, 242, 254, 0.15)',
                  border: '1px solid rgba(0, 242, 254, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00f2fe'
                }}>
                  <Zap size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                    Smart Home Command Center
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Live Interactive Controls (1,682 Entities)
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={onRefresh}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '8px'
                  }}
                  title="Refresh Devices"
                >
                  <RefreshCw size={18} className={isRefreshing ? 'spin' : ''} />
                </button>
                {onClose && !isFullPage && (
                  <button
                    onClick={onClose}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '8px'
                    }}
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{
              display: 'flex',
              padding: '0.75rem 1.5rem',
              gap: '0.5rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              <button
                onClick={() => setActiveTab('lights')}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  border: activeTab === 'lights' ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
                  background: activeTab === 'lights' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                  color: activeTab === 'lights' ? '#00f2fe' : '#64748b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Lightbulb size={15} /> Lights ({lightsList.length})
              </button>

              <button
                onClick={() => setActiveTab('locks')}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  border: activeTab === 'locks' ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                  background: activeTab === 'locks' ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                  color: activeTab === 'locks' ? '#c084fc' : '#64748b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Lock size={15} /> Locks ({locksList.length})
              </button>

              <button
                onClick={() => setActiveTab('climate')}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  border: activeTab === 'climate' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid transparent',
                  background: activeTab === 'climate' ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
                  color: activeTab === 'climate' ? '#4ade80' : '#64748b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Thermometer size={15} /> Climate ({climateList.length})
              </button>

              <button
                onClick={() => setActiveTab('family')}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  border: activeTab === 'family' ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid transparent',
                  background: activeTab === 'family' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                  color: activeTab === 'family' ? '#fbbf24' : '#64748b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Users size={15} /> Family ({personsList.length || 6})
              </button>
            </div>

            {/* Quick Scene Buttons */}
            <div style={{
              padding: '0.75rem 1.5rem',
              display: 'flex',
              gap: '0.5rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              background: 'rgba(0,0,0,0.2)'
            }}>
              <button
                onClick={() => {
                  lightsList.forEach(l => onExecuteService('light', 'turn_off', l.entity_id));
                }}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                🌙 All Lights OFF
              </button>
              <button
                onClick={() => {
                  locksList.forEach(l => onExecuteService('lock', 'lock', l.entity_id));
                }}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: '8px',
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  color: '#4ade80',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                🔒 Lock All Doors
              </button>
            </div>

            {/* Device Cards Scroll Area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '1.25rem 1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              {activeTab === 'lights' && lightsList.map((item, i) => {
                const isOn = item.state === 'on';
                const name = item.attributes?.friendly_name || item.entity_id;
                const isExec = executingMap[item.entity_id];

                return (
                  <div
                    key={i}
                    className="glass-panel"
                    style={{
                      padding: '0.85rem 1.1rem',
                      borderRadius: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: isOn ? 'rgba(0, 242, 254, 0.08)' : 'rgba(15, 23, 42, 0.6)',
                      border: isOn ? '1px solid rgba(0, 242, 254, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Lightbulb size={20} color={isOn ? '#00f2fe' : '#64748b'} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>{name}</div>
                        <span style={{ fontSize: '0.75rem', color: isOn ? '#00f2fe' : '#64748b' }}>
                          {isOn ? 'ON' : 'OFF'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleDevice('light', isOn ? 'turn_off' : 'turn_on', item.entity_id)}
                      disabled={isExec}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '10px',
                        border: 'none',
                        background: isOn ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 242, 254, 0.2)',
                        color: isOn ? '#f87171' : '#00f2fe',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                      }}
                    >
                      {isExec ? '...' : (isOn ? 'Turn OFF' : 'Turn ON')}
                    </button>
                  </div>
                );
              })}

              {activeTab === 'locks' && locksList.map((item, i) => {
                const isLocked = item.state === 'locked';
                const name = item.attributes?.friendly_name || item.entity_id;
                const isExec = executingMap[item.entity_id];

                return (
                  <div
                    key={i}
                    className="glass-panel"
                    style={{
                      padding: '0.85rem 1.1rem',
                      borderRadius: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: isLocked ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                      border: isLocked ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {isLocked ? <Lock size={20} color="#4ade80" /> : <Unlock size={20} color="#f87171" />}
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>{name}</div>
                        <span style={{ fontSize: '0.75rem', color: isLocked ? '#4ade80' : '#f87171' }}>
                          {isLocked ? 'LOCKED' : 'UNLOCKED'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleDevice('lock', isLocked ? 'unlock' : 'lock', item.entity_id)}
                      disabled={isExec}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '10px',
                        border: 'none',
                        background: isLocked ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                        color: isLocked ? '#f87171' : '#4ade80',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                      }}
                    >
                      {isExec ? '...' : (isLocked ? 'Unlock' : 'Lock')}
                    </button>
                  </div>
                );
              })}

              {activeTab === 'climate' && climateList.map((item, i) => {
                const temp = item.attributes?.current_temperature ?? '—'  /* was || '72' — a fabricated live reading, and || also fired on a real 0 */;
                const name = item.attributes?.friendly_name || item.entity_id;

                return (
                  <div
                    key={i}
                    className="glass-panel"
                    style={{
                      padding: '0.85rem 1.1rem',
                      borderRadius: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Thermometer size={20} color="#00f2fe" />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>{name}</div>
                        <span style={{ fontSize: '0.75rem', color: '#00f2fe' }}>
                          Current: {temp}°F ({item.state})
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {activeTab === 'family' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {personsList.length === 0 ? (
                    <div style={{ padding: '1rem', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      Fetching family member locations from Home Assistant...
                    </div>
                  ) : (
                    personsList.map((item, i) => {
                      const name = item.name || item.entity_id;
                      const state = item.state || 'unknown';
                      const isHome = state === 'home';
                      const badgeColor = isHome ? '#22c55e' : state.includes('work') ? '#3b82f6' : '#f59e0b';
                      const bgGlow = isHome ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)';

                      return (
                        <div
                          key={i}
                          className="glass-panel"
                          style={{
                            padding: '0.85rem 1.1rem',
                            borderRadius: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'rgba(15, 23, 42, 0.6)',
                            border: `1px solid ${badgeColor}33`
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '10px',
                              background: bgGlow,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: badgeColor
                            }}>
                              <User size={18} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>{name}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: badgeColor }}>
                                <MapPin size={12} />
                                <span style={{ textTransform: 'capitalize' }}>{state}</span>
                              </div>
                            </div>
                          </div>

                          <div style={{
                            padding: '4px 10px',
                            borderRadius: '99px',
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            background: `${badgeColor}22`,
                            color: badgeColor,
                            border: `1px solid ${badgeColor}44`,
                            textTransform: 'uppercase'
                          }}>
                            {isHome ? 'AT HOME' : state}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
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
        gap: '1.25rem'
      }}>
        {drawerContent}
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'flex-end',
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="glass-panel"
          style={{
            width: '460px',
            maxWidth: '90vw',
            height: '100%',
            background: 'rgba(11, 15, 25, 0.98)',
            borderLeft: '1px solid rgba(0, 242, 254, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-10px 0 50px rgba(0, 0, 0, 0.9)'
          }}
        >
          {drawerContent}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
