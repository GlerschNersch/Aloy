import React, { useState } from 'react';
import { Tv, Play, Pause, ExternalLink, RefreshCw, Disc3, Power, AlertTriangle, CheckCircle, Wrench } from 'lucide-react';
import { apiFetch } from '../../services/aloyApi.js';

export default function NowPlayingCard({
  jellyfinStatus = null,  // was { online: true, serverName: 'Aloy Server' } — a default that claimed a healthy server before any fetch
  activeSessions = [],
  onRefresh,
}) {
  const isOnline = jellyfinStatus?.online ?? false;
  const activeStream = activeSessions.find((s) => s.nowPlaying != null);

  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [diagReport, setDiagReport] = useState(null);

  const openJellyfin = () => {
    window.open('http://localhost:8096', '_blank');
  };

  const handleStart = async () => {
    setIsLoading(true);
    setActionMessage('Starting Jellyfin server...');
    try {
      const res = await apiFetch('/api/jellyfin/start', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage('Start command sent! Waiting for port 8096...');
        setTimeout(() => {
          setIsLoading(false);
          setActionMessage(null);
          if (onRefresh) onRefresh();
        }, 3000);
      } else {
        setActionMessage(`Failed to start: ${data.error || 'Unknown error'}`);
        setIsLoading(false);
      }
    } catch (err) {
      setActionMessage(`Error: ${err.message}`);
      setIsLoading(false);
    }
  };

  const handleRestart = async () => {
    setIsLoading(true);
    setActionMessage('Restarting Jellyfin server...');
    try {
      const res = await apiFetch('/api/jellyfin/restart', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage('Restart command dispatched. Reconnecting...');
        setTimeout(() => {
          setIsLoading(false);
          setActionMessage(null);
          if (onRefresh) onRefresh();
        }, 3500);
      } else {
        setActionMessage(`Restart failed: ${data.error || 'Unknown error'}`);
        setIsLoading(false);
      }
    } catch (err) {
      setActionMessage(`Error: ${err.message}`);
      setIsLoading(false);
    }
  };

  const handleDiagnose = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/jellyfin/diagnostics');
      const data = await res.json();
      if (data.success && data.report) {
        setDiagReport(data.report);
      }
    } catch (err) {
      setActionMessage(`Diagnostic error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: '20px',
        padding: '1.5rem',
        background: 'rgba(15, 21, 35, 0.85)',
        border: isOnline ? '1px solid rgba(0, 242, 254, 0.2)' : '1px solid rgba(239, 68, 68, 0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: isOnline ? 'rgba(0, 242, 254, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isOnline ? '#00f2fe' : '#f87171',
            }}
          >
            <Tv size={16} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Jellyfin Media Orchestrator
            </h3>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
              Multi-device streaming & whole-home casting
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 8px',
              borderRadius: '8px',
              background: isOnline ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              border: isOnline ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: isOnline ? '#4ade80' : '#f87171',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: isOnline ? '#22c55e' : '#ef4444',
              }}
            />
            {isOnline ? (jellyfinStatus?.serverName ?? 'Online') : 'Offline'}
          </div>

          {isOnline ? (
            <>
              <button
                onClick={handleRestart}
                disabled={isLoading}
                title="Restart Jellyfin"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#94a3b8',
                  padding: '4px 8px',
                  borderRadius: '8px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <RefreshCw size={12} className={isLoading ? 'spin' : ''} />
                Restart
              </button>
              <button
                onClick={openJellyfin}
                title="Open Web Player"
                style={{
                  background: 'rgba(0, 242, 254, 0.1)',
                  border: '1px solid rgba(0, 242, 254, 0.3)',
                  color: '#00f2fe',
                  padding: '4px 8px',
                  borderRadius: '8px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <ExternalLink size={12} />
                Launch
              </button>
            </>
          ) : (
            <button
              onClick={handleStart}
              disabled={isLoading}
              style={{
                background: 'rgba(34, 197, 94, 0.18)',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                color: '#4ade80',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Power size={12} />
              {isLoading ? 'Starting...' : 'Start Server'}
            </button>
          )}
        </div>
      </div>

      {actionMessage && (
        <div
          style={{
            padding: '0.5rem 0.8rem',
            borderRadius: '8px',
            background: 'rgba(0, 242, 254, 0.08)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            fontSize: '0.75rem',
            color: '#38bdf8',
            fontWeight: 600,
          }}
        >
          {actionMessage}
        </div>
      )}

      {/* Offline Alert & Diagnostics Banner */}
      {!isOnline && (
        <div
          style={{
            padding: '0.9rem',
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} color="#f87171" />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f87171' }}>
                Media Server Unreachable
              </span>
            </div>
            <button
              onClick={handleDiagnose}
              disabled={isLoading}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                padding: '3px 8px',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Wrench size={11} />
              Diagnose Issue
            </button>
          </div>

          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            Jellyfin is not responding on port 8096. Click "Start Server" above to launch it in the background.
          </div>

          {diagReport && (
            <div
              style={{
                marginTop: '4px',
                padding: '0.6rem',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: '0.72rem',
                color: '#e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ fontWeight: 700, color: '#38bdf8' }}>Diagnostic Report:</div>
              <div>• {diagReport.summary}</div>
              {diagReport.suggestedFix && (
                <div style={{ color: '#4ade80', fontWeight: 600 }}>• Fix: {diagReport.suggestedFix}</div>
              )}
            </div>
          )}
        </div>
      )}

      {isOnline && activeStream ? (
        <div
          style={{
            padding: '1rem',
            borderRadius: '14px',
            background: 'rgba(0, 242, 254, 0.04)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }}>
              {activeStream.nowPlaying.seriesName
                ? `${activeStream.nowPlaying.seriesName} — ${activeStream.nowPlaying.name}`
                : activeStream.nowPlaying.name}
            </span>
            <span style={{ fontSize: '0.78rem', color: '#00f2fe', fontWeight: 700 }}>
              {activeStream.nowPlaying.playbackPercent}%
            </span>
          </div>
          <div
            style={{
              height: '5px',
              borderRadius: '3px',
              background: '#0c111c',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${activeStream.nowPlaying.playbackPercent}%`,
                background: 'linear-gradient(90deg, #00f2fe, #38bdf8)',
                borderRadius: '3px',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Streaming to {activeStream.deviceName || activeStream.client}
            </span>
          </div>
        </div>
      ) : isOnline ? (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Disc3 size={15} color="#00f2fe" />
            <span style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
              Server ready · Library indexed on port 8096
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
            0 active streams
          </span>
        </div>
      ) : null}
    </div>
  );
}
