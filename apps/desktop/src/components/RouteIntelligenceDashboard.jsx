import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Globe,
  Radio,
  Zap,
  ShieldCheck,
  Search,
  RefreshCw,
  MapPin,
  Layers,
  ChevronRight,
  Filter,
  Cpu,
  ExternalLink,
  X
} from 'lucide-react';
import { fetchRouteTrace } from '../services/networkTraceService';

const PRESET_TARGETS = [
  { label: 'Cloudflare DNS', target: '1.1.1.1', type: 'Anycast CDN' },
  { label: 'Google DNS', target: '8.8.8.8', type: 'Anycast DNS' },
  { label: 'GitHub Core', target: 'github.com', type: 'Transit' },
  { label: 'Local Gateway', target: '192.168.1.1', type: 'LAN' },
  { label: 'Tailscale Mesh', target: '100.100.100.100', type: 'VPN' },
];

export default function RouteIntelligenceDashboard({ onClose, isFullPage = true, onAskAloy }) {
  const [target, setTarget] = useState('1.1.1.1');
  const [protocol, setProtocol] = useState('ICMP');
  const [isTracing, setIsTracing] = useState(false);
  const [hops, setHops] = useState([]);
  const [selectedHop, setSelectedHop] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');

  const executeTrace = async (hostTarget = target) => {
    setIsTracing(true);
    setHops([]);
    setSelectedHop(null);

    try {
      const data = await fetchRouteTrace(hostTarget, protocol, 15);
      if (data && Array.isArray(data.hops)) {
        // Stream / render hops progressively for a live diagnostic feel
        for (let i = 0; i < data.hops.length; i++) {
          await new Promise((r) => setTimeout(r, 60));
          setHops((prev) => [...prev, data.hops[i]]);
        }
      }
    } catch (err) {
      console.error('Trace error:', err);
    } finally {
      setIsTracing(false);
    }
  };

  useEffect(() => {
    executeTrace('1.1.1.1');
  }, []);

  const filteredHops = useMemo(() => {
    if (activeFilter === 'ixp') return hops.filter((h) => h.isIxp);
    if (activeFilter === 'cdn') return hops.filter((h) => h.isCdn);
    if (activeFilter === 'loss') return hops.filter((h) => h.loss > 0);
    return hops;
  }, [hops, activeFilter]);

  const finalHop = hops[hops.length - 1];
  const totalLatency = finalHop ? `${finalHop.avgRtt.toFixed(1)} ms` : '--';
  const ixpCrossings = hops.filter((h) => h.isIxp).length;
  const cdnDetected = hops.some((h) => h.isCdn);

  const getLatencyColor = (rtt) => {
    if (!rtt || rtt === 0) return '#64748b';
    if (rtt < 25) return '#34d399';
    if (rtt < 60) return '#00f2fe';
    if (rtt < 120) return '#fbbf24';
    return '#f43f5e';
  };

  const getTypeBadgeStyle = (type) => {
    switch (type) {
      case 'LAN':
        return { background: 'rgba(255, 255, 255, 0.05)', color: '#94a3b8', border: '1px solid rgba(255, 255, 255, 0.1)' };
      case 'ISP CORE':
        return { background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.3)' };
      case 'TRANSIT':
        return { background: 'rgba(139, 92, 246, 0.15)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.3)' };
      case 'IXP':
        return { background: 'rgba(245, 158, 11, 0.2)', color: '#fcd34d', border: '1px solid rgba(245, 158, 11, 0.4)' };
      case 'CDN EDGE':
        return { background: 'rgba(0, 242, 254, 0.15)', color: '#67e8f9', border: '1px solid rgba(0, 242, 254, 0.3)' };
      case 'DESTINATION':
        return { background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', border: '1px solid rgba(16, 185, 129, 0.4)', fontWeight: 800 };
      default:
        return { background: 'rgba(255, 255, 255, 0.05)', color: '#94a3b8', border: '1px solid rgba(255, 255, 255, 0.1)' };
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#07090e',
      color: '#f8fafc',
      padding: isFullPage ? '1.5rem' : '1rem',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      {/* 1. Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '1.25rem',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'rgba(0, 242, 254, 0.12)',
            border: '1px solid rgba(0, 242, 254, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#00f2fe',
            boxShadow: '0 0 15px rgba(0, 242, 254, 0.15)'
          }}>
            <Radio size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              Route Intelligence & Telemetry
              <span style={{
                fontSize: '0.65rem',
                fontFamily: 'monospace',
                padding: '2px 8px',
                borderRadius: '20px',
                background: 'rgba(0, 242, 254, 0.12)',
                color: '#00f2fe',
                border: '1px solid rgba(0, 242, 254, 0.25)'
              }}>
                NextTrace Engine
              </span>
            </h1>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '4px 0 0 0' }}>Multi-source BGP, IXP Peering & Anycast Path Telemetry</p>
          </div>
        </div>

        {/* Protocol Selector & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            display: 'flex',
            background: 'rgba(11, 15, 25, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '2px',
            borderRadius: '10px'
          }}>
            {['ICMP', 'TCP', 'UDP'].map((p) => (
              <button
                key={p}
                onClick={() => setProtocol(p)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: protocol === p ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' : 'transparent',
                  color: protocol === p ? '#07090e' : '#94a3b8',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {p}
              </button>
            ))}
          </div>

          <button
            onClick={() => executeTrace(target)}
            disabled={isTracing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 16px',
              background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
              color: '#07090e',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: isTracing ? 'not-allowed' : 'pointer',
              opacity: isTracing ? 0.6 : 1,
              boxShadow: '0 0 15px rgba(0, 242, 254, 0.25)'
            }}
          >
            <RefreshCw size={13} className={isTracing ? 'spin' : ''} />
            <span>{isTracing ? 'Tracing...' : 'Run Trace'}</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                borderRadius: '8px',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Target Query Bar & Presets */}
      <div style={{ margin: '1rem 0 0.5rem 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} color="#00f2fe" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeTrace(target)}
              placeholder="Enter IP, hostname, or domain (e.g., 1.1.1.1, github.com)..."
              style={{
                width: '100%',
                padding: '10px 14px 10px 38px',
                background: 'rgba(11, 15, 25, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                color: '#f8fafc',
                fontSize: '0.85rem',
                fontFamily: 'monospace',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>
          <button
            onClick={() => executeTrace(target)}
            style={{
              padding: '0 18px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#f8fafc',
              fontSize: '0.78rem',
              fontWeight: 700,
              borderRadius: '12px',
              cursor: 'pointer'
            }}
          >
            Trace Target
          </button>
        </div>

        {/* Quick Presets Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '2px', fontSize: '0.75rem' }}>
          <span style={{ color: '#64748b', fontWeight: 800, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.05em' }}>Presets:</span>
          {PRESET_TARGETS.map((p) => (
            <button
              key={p.target}
              onClick={() => {
                setTarget(p.target);
                executeTrace(p.target);
              }}
              style={{
                padding: '4px 10px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{p.label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#64748b' }}>({p.target})</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Telemetry KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '10px',
        margin: '0.75rem 0'
      }}>
        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: '#64748b', letterSpacing: '0.05em' }}>Destination Latency</div>
          <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 800, color: '#00f2fe', marginTop: '4px' }}>{totalLatency}</div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <Zap size={11} color="#00f2fe" /> End-to-End RTT
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: '#64748b', letterSpacing: '0.05em' }}>Hop Count</div>
          <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>{hops.length} Hops</div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <Layers size={11} /> Path Length
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: '#64748b', letterSpacing: '0.05em' }}>IXP Interchanges</div>
          <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 800, color: '#fbbf24', marginTop: '4px' }}>{ixpCrossings} Detected</div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <Globe size={11} color="#fbbf24" /> PeeringDB Matches
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: '#64748b', letterSpacing: '0.05em' }}>Edge / Anycast</div>
          <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 800, color: '#34d399', marginTop: '4px' }}>
            {cdnDetected ? 'Active CDN' : 'Direct IP'}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <ShieldCheck size={11} color="#34d399" /> Anycast Edge Node
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: '#64748b', letterSpacing: '0.05em' }}>Probe Protocol</div>
          <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 800, color: '#a78bfa', marginTop: '4px' }}>{protocol}</div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
            <Cpu size={11} color="#a78bfa" /> Flow-Hash Probing
          </div>
        </div>
      </div>

      {/* 4. Hop Filter Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#64748b', fontWeight: 800, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Filter size={11} /> View Filter:
          </span>
          {[
            { key: 'all', label: `All Hops (${hops.length})` },
            { key: 'ixp', label: `IXP Only (${ixpCrossings})` },
            { key: 'cdn', label: `CDN / Edge (${hops.filter((h) => h.isCdn).length})` },
            { key: 'loss', label: `Loss / Flaps (${hops.filter((h) => h.loss > 0).length})` },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              style={{
                padding: '3px 9px',
                borderRadius: '6px',
                border: activeFilter === f.key ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
                background: activeFilter === f.key ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
                color: activeFilter === f.key ? '#00f2fe' : '#94a3b8',
                fontWeight: activeFilter === f.key ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ color: '#64748b', fontSize: '0.7rem', fontFamily: 'monospace' }}>
          Showing {filteredHops.length} of {hops.length} nodes
        </div>
      </div>

      {/* 5. Interactive Hop Journey List & Drawer Container */}
      <div style={{ display: 'flex', gap: '1rem', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Hop Table / Timeline */}
        <div style={{
          flex: 1,
          background: 'rgba(11, 15, 25, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '16px',
          overflowY: 'auto',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          {filteredHops.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', gap: '8px' }}>
              <Activity size={28} color="rgba(0, 242, 254, 0.4)" />
              <p style={{ fontSize: '0.78rem', margin: 0 }}>No hop data matching filter</p>
            </div>
          ) : (
            filteredHops.map((h) => {
              const isSelected = selectedHop?.hop === h.hop;
              return (
                <motion.div
                  key={h.hop}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setSelectedHop(h)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(0, 242, 254, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                    border: isSelected ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)',
                    boxShadow: isSelected ? '0 0 15px rgba(0, 242, 254, 0.12)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {/* Left: Hop # + Classification Badge + Host */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '7px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      color: '#cbd5e1'
                    }}>
                      {h.hop}
                    </div>

                    <span style={{
                      fontSize: '0.62rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      ...getTypeBadgeStyle(h.type)
                    }}>
                      {h.type}
                    </span>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{h.ip}</span>
                        {h.hostname && h.hostname !== h.ip && (
                          <span style={{ color: '#64748b', fontFamily: 'sans-serif', fontWeight: 400, fontSize: '0.72rem' }}>
                            ({h.hostname})
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span>{h.location?.flag}</span>
                        <span>{h.location?.city}</span>
                        <span style={{ color: '#475569' }}>•</span>
                        <span style={{ fontFamily: 'monospace', color: 'rgba(0, 242, 254, 0.8)' }}>{h.as}</span>
                        <span style={{ color: '#64748b' }}>{h.org}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Latency Bar & Value */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', fontWeight: 700, color: getLatencyColor(h.avgRtt) }}>
                        {h.avgRtt ? h.avgRtt.toFixed(2) : '--'} ms
                      </div>
                      <div style={{ fontSize: '0.65rem', color: '#64748b', fontFamily: 'monospace' }}>
                        loss: {h.loss || 0}%
                      </div>
                    </div>

                    <div style={{ width: '60px', height: '6px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: '10px', overflow: 'hidden', display: 'flex' }}>
                      <div
                        style={{
                          height: '100%',
                          background: getLatencyColor(h.avgRtt),
                          width: `${Math.min(100, ((h.avgRtt || 1) / 100) * 100)}%`
                        }}
                      />
                    </div>

                    <ChevronRight size={14} color="#64748b" />
                  </div>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Right Drawer: Hop Inspector or Default Path Telemetry Summary */}
        <AnimatePresence mode="wait">
          {selectedHop ? (
            <motion.div
              key="selected-hop-inspector"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              style={{
                width: '320px',
                background: 'rgba(11, 15, 25, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                overflowY: 'auto'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(0, 242, 254, 0.2)', color: '#00f2fe', fontFamily: 'monospace', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>
                      #{selectedHop.hop}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f8fafc' }}>Node Details</span>
                  </div>
                  <button
                    onClick={() => setSelectedHop(null)}
                    style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    Close
                  </button>
                </div>

                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.75rem' }}>
                  <div>
                    <span style={{ color: '#64748b', textTransform: 'uppercase', fontWeight: 800, fontSize: '0.65rem', letterSpacing: '0.05em' }}>IP Address</span>
                    <p style={{ fontFamily: 'monospace', color: '#00f2fe', fontWeight: 700, margin: '2px 0 0 0' }}>{selectedHop.ip}</p>
                  </div>

                  <div>
                    <span style={{ color: '#64748b', textTransform: 'uppercase', fontWeight: 800, fontSize: '0.65rem', letterSpacing: '0.05em' }}>Reverse DNS PTR</span>
                    <p style={{ fontFamily: 'monospace', color: '#cbd5e1', margin: '2px 0 0 0', wordBreak: 'break-all' }}>
                      {selectedHop.hostname || 'None / Unresolved'}
                    </p>
                  </div>

                  <div>
                    <span style={{ color: '#64748b', textTransform: 'uppercase', fontWeight: 800, fontSize: '0.65rem', letterSpacing: '0.05em' }}>Autonomous System (BGP)</span>
                    <p style={{ fontWeight: 700, color: '#f8fafc', margin: '2px 0 0 0' }}>{selectedHop.as}</p>
                    <p style={{ color: '#94a3b8', fontSize: '0.7rem', margin: '2px 0 0 0' }}>{selectedHop.org}</p>
                  </div>

                  <div>
                    <span style={{ color: '#64748b', textTransform: 'uppercase', fontWeight: 800, fontSize: '0.65rem', letterSpacing: '0.05em' }}>Location / Facility</span>
                    <p style={{ color: '#f8fafc', margin: '2px 0 0 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={13} color="#f43f5e" />
                      <span>{selectedHop.location?.city}, {selectedHop.location?.country}</span>
                    </p>
                  </div>

                  <div>
                    <span style={{ color: '#64748b', textTransform: 'uppercase', fontWeight: 800, fontSize: '0.65rem', letterSpacing: '0.05em' }}>Probes & Latency Samples</span>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      {selectedHop.rtt && selectedHop.rtt.map((sample, i) => (
                        <span
                          key={i}
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: sample.includes('*') ? '#f87171' : '#34d399'
                          }}
                        >
                          {sample}
                        </span>
                      ))}
                    </div>
                  </div>

                  {selectedHop.isIxp && (
                    <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#fbbf24', fontSize: '0.7rem', lineHeight: '1.4' }}>
                      ⚡ <strong>Internet Exchange Point:</strong> This node represents a direct public/private peering switch fabric.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {onAskAloy && (
                  <button
                    onClick={() => onAskAloy(`Analyze route hop #${selectedHop.hop} at IP ${selectedHop.ip} (${selectedHop.org}) with latency ${selectedHop.avgRtt}ms.`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      width: '100%',
                      padding: '8px',
                      background: 'rgba(0, 242, 254, 0.15)',
                      color: '#00f2fe',
                      border: '1px solid rgba(0, 242, 254, 0.3)',
                      borderRadius: '10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <span>Ask Aloy About This Hop</span>
                  </button>
                )}
                <a
                  href={`https://bgp.he.net/ip/${selectedHop.ip}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    width: '100%',
                    padding: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#f8fafc',
                    borderRadius: '10px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    boxSizing: 'border-box'
                  }}
                >
                  <ExternalLink size={13} />
                  <span>Lookup on BGP.he.net</span>
                </a>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="path-overview-card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                width: '320px',
                background: 'rgba(11, 15, 25, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '1.2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <Globe size={16} color="#00f2fe" />
                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#f8fafc' }}>Path Intelligence Overview</span>
              </div>

              <div style={{ fontSize: '0.76rem', color: '#94a3b8', lineHeight: 1.5 }}>
                Select any hop on the route sequence to inspect PTR reverse records, BGP ASN ownership, and multi-probe latency jitter.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Current Target</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#00f2fe', fontFamily: 'monospace', marginTop: '2px' }}>{target}</div>
                </div>

                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Peering Fabric Status</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#34d399', marginTop: '2px' }}>
                    {ixpCrossings > 0 ? `${ixpCrossings} Direct IXP Exchange(s)` : 'Direct Transit Route'}
                  </div>
                </div>

                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Telemetry Probe</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#a78bfa', marginTop: '2px' }}>
                    RFC 4884 Multi-Hop ICMP
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
