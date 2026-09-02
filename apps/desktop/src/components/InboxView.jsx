import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox as InboxIcon, ChevronDown, ChevronRight, Compass, BookOpen, ShieldCheck, RefreshCw, Flame, CheckCircle2, AlertTriangle, Shield, Search, Eye, Filter } from 'lucide-react';
import { fetchLLMVisionTimeline, getLLMVisionEventsDetail } from '../services/homeassistant';
import { apiFetch } from '../services/aloyApi.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

const AGENT_META = {
  Athena: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.1)', icon: Compass },
  Apollo: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', icon: BookOpen },
  Minerva: { color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', icon: ShieldCheck },
  Hephaestus: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', icon: Flame }
};

const TYPE_LABEL = {
  escalation: 'Claude assist',
  research: 'Research completed',
  'injection-attempt': 'Injection attempt blocked',
  'blocked-access': 'Access blocked',
  vision: 'Vision event',
  unlock: 'Lock opened',
  'stuck-work-order': 'Needs staging',
  'stuck-research-task': 'Never started'
};

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function groupByAgent(items) {
  const byAgent = {};
  for (const item of items) {
    if (!byAgent[item.agent]) byAgent[item.agent] = [];
    byAgent[item.agent].push(item);
  }
  return Object.entries(byAgent)
    .map(([agent, agentItems]) => {
      const sorted = [...agentItems].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return { agent, items: sorted, mostRecent: sorted[0].timestamp };
    })
    .sort((a, b) => new Date(b.mostRecent) - new Date(a.mostRecent));
}

export default function InboxView({ lockHistory = [] }) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [activeCategory, setActiveCategory] = useState('all');

  const load = useCallback(async () => {
    setIsLoading(true);
    const cutoff = Date.now() - WINDOW_MS;
    let feedItems = [];
    try {
      if (window.electronAPI?.getInboxFeed) {
        const feed = await window.electronAPI.getInboxFeed();
        feedItems = feed.items || [];
      } else {
        const res = await apiFetch('/api/inbox/feed');
        if (res.ok) {
          feedItems = (await res.json()).items || [];
        }
      }
    } catch (err) {
      console.warn('Failed to load Inbox feed:', err);
    }

    let visionItems = [];
    try {
      const visionEvents = await fetchLLMVisionTimeline(24);
      visionItems = getLLMVisionEventsDetail(visionEvents).notable.map((e) => ({
        agent: 'Minerva',
        type: 'vision',
        timestamp: e.start,
        text: e.description
      }));
    } catch (err) {
      console.warn('Failed to load vision events for Inbox:', err);
    }

    const lockItems = (lockHistory || [])
      .filter((e) => new Date(e.timestamp).getTime() >= cutoff)
      .map((e) => ({
        agent: 'Minerva',
        type: 'unlock',
        timestamp: e.timestamp,
        text: `${e.entityId.split('.').pop().replace(/_/g, ' ')} unlocked`
      }));

    setItems([...feedItems, ...visionItems, ...lockItems]);
    setIsLoading(false);
  }, [lockHistory]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const toggleGroup = (agent) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent); else next.add(agent);
      return next;
    });
  };

  const filteredItems = items.filter((item) => {
    if (activeCategory === 'security') return item.type === 'injection-attempt' || item.type === 'blocked-access' || item.type === 'unlock';
    if (activeCategory === 'vision') return item.type === 'vision';
    if (activeCategory === 'research') return item.type === 'research' || item.agent === 'Athena';
    if (activeCategory === 'dev') return item.agent === 'Hephaestus';
    return true;
  });

  const groups = groupByAgent(filteredItems);

  return (
    <div style={{
      flex: 1,
      height: '100vh',
      overflowY: 'auto',
      background: '#10141f',
      color: '#f1f5f9',
      padding: '2rem 2.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.25rem'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '10px',
            background: 'rgba(0, 242, 254, 0.15)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: '#00f2fe'
          }}>
            <InboxIcon size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Cross-Agent Inbox</h1>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Centralized findings, anomaly signals & triage feed — last 24 hours
            </span>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={load}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '0.5rem 0.9rem',
            borderRadius: '10px', border: '1px solid rgba(0, 242, 254, 0.3)',
            background: 'rgba(0, 242, 254, 0.08)', color: '#00f2fe', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
          }}
        >
          <RefreshCw size={13} className={isLoading ? 'spin' : ''} /> Refresh Feed
        </motion.button>
      </div>

      {/* KPI Stats Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '0.85rem'
      }}>
        <div className="glass-panel" style={{ padding: '1rem', borderRadius: '14px', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>
            <span>TOTAL FINDINGS</span>
            <InboxIcon size={14} color="#00f2fe" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>{items.length}</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Active in 24h window</div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem', borderRadius: '14px', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>
            <span>SENTINEL DEFENSE</span>
            <ShieldCheck size={14} color="#34d399" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#34d399', marginTop: '4px' }}>Nominal</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Perimeter gates secured</div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem', borderRadius: '14px', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>
            <span>AUTONOMOUS AGENTS</span>
            <Compass size={14} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#38bdf8', marginTop: '4px' }}>5 Active</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Pantheon mesh ready</div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: 'All Findings', count: items.length },
          { id: 'security', label: 'Security & Access', count: items.filter(i => i.type === 'unlock' || i.type === 'injection-attempt').length },
          { id: 'vision', label: 'Vision Events', count: items.filter(i => i.type === 'vision').length },
          { id: 'research', label: 'Research Dossiers', count: items.filter(i => i.agent === 'Athena').length },
          { id: 'dev', label: 'Dev Work Orders', count: items.filter(i => i.agent === 'Hephaestus').length }
        ].map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '20px',
                border: isActive ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                background: isActive ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: isActive ? '#00f2fe' : '#94a3b8',
                fontSize: '0.76rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{cat.label}</span>
              <span style={{
                background: isActive ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '0.68rem'
              }}>
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div style={{ color: '#64748b', fontSize: '0.9rem', padding: '2rem', textAlign: 'center' }}>
          <RefreshCw size={20} className="spin" style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
          <div>Scanning agent message bus...</div>
        </div>
      ) : groups.length === 0 ? (
        <div className="glass-panel" style={{
          padding: '3rem 2rem',
          textAlign: 'center',
          borderRadius: '18px',
          background: 'rgba(15, 23, 42, 0.45)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#34d399',
            boxShadow: '0 0 25px rgba(52, 211, 153, 0.15)'
          }}>
            <CheckCircle2 size={28} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 0.35rem' }}>
              Inbox Zero — All Systems Nominal
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0, maxWidth: '500px', lineHeight: 1.5 }}>
              No critical anomalies, blocked injection attempts, or unhandled agent tasks in the last 24 hours. Background sentinels are monitoring perimeter gates and autonomous workflows.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              onClick={load}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#cbd5e1',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Re-scan Sentinels
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {groups.map((group) => {
            const meta = AGENT_META[group.agent] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: InboxIcon };
            const Icon = meta.icon;
            const isOpen = expanded.has(group.agent);
            return (
              <div key={group.agent} style={{
                border: `1px solid ${meta.color}33`,
                borderRadius: '14px',
                background: 'rgba(15, 23, 42, 0.65)',
                overflow: 'hidden'
              }}>
                <motion.div
                  whileHover={{ background: meta.bg }}
                  onClick={() => toggleGroup(group.agent)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.9rem 1.1rem', cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                    <div style={{
                      width: '30px', height: '30px', borderRadius: '8px', background: meta.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color
                    }}>
                      <Icon size={15} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{group.agent}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {group.items.length} item{group.items.length !== 1 ? 's' : ''} · most recent {timeAgo(group.mostRecent)}
                      </div>
                    </div>
                  </div>
                  {isOpen ? <ChevronDown size={16} color="#64748b" /> : <ChevronRight size={16} color="#64748b" />}
                </motion.div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div style={{ padding: '0 1.1rem 0.9rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {group.items.map((item, i) => (
                          <div key={i} style={{
                            padding: '0.6rem 0.8rem', borderRadius: '10px',
                            background: 'rgba(255,255,255,0.03)', fontSize: '0.82rem',
                            border: '1px solid rgba(255, 255, 255, 0.05)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.7rem', marginBottom: '3px' }}>
                              <span style={{ color: meta.color, fontWeight: 600 }}>{TYPE_LABEL[item.type] || item.type}</span>
                              <span>{timeAgo(item.timestamp)}</span>
                            </div>
                            <div style={{ color: '#e2e8f0' }}>{item.text}</div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
