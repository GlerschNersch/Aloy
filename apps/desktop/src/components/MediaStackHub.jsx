import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Tv,
  Film,
  Music2,
  Gamepad2,
  ExternalLink,
  RotateCw,
  Power,
  Server,
  Layers,
  CheckCircle2,
  AlertCircle,
  X,
  Maximize2
} from 'lucide-react';
import PageHeader from './common/PageHeader';
import { apiFetch } from '../services/aloyApi';

const SERVICES = [
  {
    id: 'sonarr',
    name: 'Sonarr',
    tag: 'TV Shows',
    port: 8989,
    url: 'http://localhost:8989',
    icon: Tv,
    accent: '#00f2fe',
    description: 'TV series automation, season monitoring & episode grabber'
  },
  {
    id: 'radarr',
    name: 'Radarr',
    tag: 'Movies',
    port: 7878,
    url: 'http://localhost:7878',
    icon: Film,
    accent: '#f59e0b',
    description: 'Movie library manager, quality profiles & release tracker'
  },
  {
    id: 'lidarr',
    name: 'Lidarr',
    tag: 'Music',
    port: 8686,
    url: 'http://localhost:8686',
    icon: Music2,
    accent: '#ec4899',
    description: 'Artist discography, album scraper & audio collection'
  },
  {
    id: 'retroarr',
    name: 'RetroArr',
    tag: 'Games',
    port: 5002,
    url: 'http://localhost:5002',
    icon: Gamepad2,
    accent: '#a855f7',
    description: 'Console ROMs, PC repacks, IGDB artwork & emulator hub'
  }
];

export default function MediaStackHub({ onClose }) {
  const [activeServiceId, setActiveServiceId] = useState('sonarr');
  const [iframeKey, setIframeKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [serviceStatus, setServiceStatus] = useState({});
  const [restartingId, setRestartingId] = useState(null);
  const [restartingAll, setRestartingAll] = useState(false);
  const iframeRef = useRef(null);
  const restartTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    };
  }, []);

  const activeService = SERVICES.find(s => s.id === activeServiceId) || SERVICES[0];

  // Ping all 4 services to check connectivity
  const checkHealth = async () => {
    const statuses = {};
    await Promise.all(
      SERVICES.map(async (s) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2500);
          await fetch(s.url, { mode: 'no-cors', signal: controller.signal });
          clearTimeout(timeoutId);
          statuses[s.id] = true;
        } catch {
          statuses[s.id] = false;
        }
      })
    );
    setServiceStatus(statuses);
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectService = (id) => {
    if (id !== activeServiceId) {
      setActiveServiceId(id);
      setIsLoading(true);
      setIframeKey(prev => prev + 1);
    }
  };

  const handleReloadFrame = () => {
    setIsLoading(true);
    setIframeKey(prev => prev + 1);
  };

  const handleOpenExternal = () => {
    window.open(activeService.url, '_blank', 'noopener,noreferrer');
  };

  // (Re)starts a single service via the local server's arrService routes.
  // Works uniformly whether the service is currently up or down — restart
  // tolerates "not running" as a no-op stop, so one button covers both.
  const handleRestartService = async (id, e) => {
    e.stopPropagation();
    if (restartingId || restartingAll) return;
    setRestartingId(id);
    try {
      await apiFetch(`/api/arr/service/${id}/restart`, { method: 'POST' }, 30000);
    } catch {
      // checkHealth below will surface the still-offline state either way
    } finally {
      // Give the process a moment to bind its port before re-checking.
      restartTimeoutRef.current = setTimeout(async () => {
        await checkHealth();
        setRestartingId(null);
      }, 3000);
    }
  };

  const handleRestartAll = async () => {
    if (restartingId || restartingAll) return;
    setRestartingAll(true);
    try {
      await apiFetch('/api/arr/stack/restart', { method: 'POST' }, 30000);
    } catch {
      // checkHealth below will surface whatever's still offline
    } finally {
      restartTimeoutRef.current = setTimeout(async () => {
        await checkHealth();
        setRestartingAll(false);
      }, 4000);
    }
  };

  const onlineCount = Object.values(serviceStatus).filter(Boolean).length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: '#0a0e17',
        color: '#f8fafc',
        overflow: 'hidden'
      }}
    >
      {/* Top Header */}
      <PageHeader
        icon={Layers}
        title="Media Stack Hub"
        subtitle="Unified embedded console for Sonarr, Radarr, Lidarr, and RetroArr"
        accentColor={activeService.accent}
        statusBadge={{
          label: `${onlineCount}/4 Online`,
          color: onlineCount === 4 ? '#22c55e' : '#f59e0b'
        }}
        actions={[
          {
            label: 'Open Browser',
            icon: ExternalLink,
            onClick: handleOpenExternal,
            variant: 'secondary'
          },
          {
            label: 'Reload',
            icon: RotateCw,
            onClick: handleReloadFrame,
            variant: 'secondary'
          },
          {
            label: restartingAll ? 'Restarting...' : 'Restart All',
            icon: Power,
            onClick: handleRestartAll,
            variant: 'secondary',
            loading: restartingAll,
            disabled: restartingAll || !!restartingId
          }
        ]}
        onClose={onClose}
      />

      {/* Service Selector Tabs Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.6rem 1.4rem',
          background: 'rgba(15, 23, 42, 0.75)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0
        }}
      >
        {SERVICES.map((s) => {
          const isSelected = s.id === activeServiceId;
          const isOnline = serviceStatus[s.id] !== false;
          const IconComponent = s.icon;

          return (
            <motion.button
              key={s.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelectService(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                padding: '0.45rem 0.9rem',
                borderRadius: '10px',
                border: isSelected
                  ? `1px solid ${s.accent}`
                  : '1px solid rgba(255, 255, 255, 0.08)',
                background: isSelected
                  ? `linear-gradient(135deg, ${s.accent}25 0%, rgba(15, 23, 42, 0.8) 100%)`
                  : 'rgba(255, 255, 255, 0.03)',
                color: isSelected ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                boxShadow: isSelected ? `0 0 14px ${s.accent}30` : 'none'
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  background: isSelected ? `${s.accent}35` : 'rgba(255, 255, 255, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isSelected ? s.accent : '#94a3b8'
                }}
              >
                <IconComponent size={14} />
              </div>

              <div style={{ textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: isSelected ? 800 : 600 }}>
                    {s.name}
                  </span>
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: isOnline ? '#22c55e' : '#ef4444',
                      boxShadow: isOnline ? '0 0 6px #22c55e' : 'none'
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.66rem', color: isSelected ? s.accent : '#64748b', fontWeight: 600 }}>
                  :{s.port} · {s.tag}
                </div>
              </div>

              {/* (Re)start this service — full-strength red when offline,
                  dimmed when online, so a dead service is never more than
                  one click from being brought back up. */}
              <motion.div
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => handleRestartService(s.id, e)}
                title={isOnline ? `Restart ${s.name}` : `Start ${s.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  borderRadius: '6px',
                  marginLeft: '2px',
                  color: isOnline ? '#64748b' : '#ef4444',
                  cursor: restartingId ? 'not-allowed' : 'pointer',
                  opacity: isOnline ? 0.55 : 1
                }}
              >
                <Power
                  size={12}
                  style={{ animation: restartingId === s.id ? 'spin 1s linear infinite' : 'none' }}
                />
              </motion.div>
            </motion.button>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>
          <span>Endpoint:</span>
          <code
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              padding: '2px 8px',
              borderRadius: '6px',
              color: activeService.accent,
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            {activeService.url}
          </code>
        </div>
      </div>

      {/* Embedded Iframe Container */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: '#070a12'
        }}
      >
        {/* Loading Overlay */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(7, 10, 18, 0.85)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                zIndex: 5
              }}
            >
              <RotateCw
                size={28}
                color={activeService.accent}
                style={{ animation: 'spin 1s linear infinite' }}
              />
              <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
                Connecting to {activeService.name} on port {activeService.port}...
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live Service Iframe */}
        <iframe
          key={`${activeService.id}-${iframeKey}`}
          ref={iframeRef}
          src={activeService.url}
          title={activeService.name}
          onLoad={() => setIsLoading(false)}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
            background: '#0d1117'
          }}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
        />
      </div>

      {/* Quick Footer Ticker */}
      <div
        style={{
          padding: '0.4rem 1.4rem',
          background: 'rgba(10, 14, 23, 0.95)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.72rem',
          color: '#64748b',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: activeService.accent, fontWeight: 700 }}>{activeService.name}:</span>
          <span>{activeService.description}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>Auto-managed via MediaStack</span>
        </div>
      </div>
    </div>
  );
}
