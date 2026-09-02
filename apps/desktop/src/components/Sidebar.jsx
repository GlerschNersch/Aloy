// Compact Media Player Mini-Glance for Sidebar
function SidebarMediaGlance({ activeMedia }) {
  if (!activeMedia || !activeMedia.title) return null;
  return (
    <div style={{ padding: '8px 12px', margin: '4px 8px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '1rem' }}>🎵</span>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{activeMedia.title}</div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{activeMedia.artist || 'Playing'}</div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Pops a status number/label whenever it changes, so an update to a
// background stat (new escalation, new security event, a client connecting)
// reads as something just happened rather than a silently-updated label.
function StatPop({ value }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        initial={{ scale: 1.35, opacity: 0.4, y: -2 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        style={{ display: 'inline-block' }}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}
import { Plus, MessageSquare, Sparkles, Cpu, Sliders, Brain, Trash2, FolderGit2, ChevronDown, ChevronUp, ChevronRight, Wallet, ShieldCheck, Gamepad2, Activity, Zap, BarChart3, Users, Code2, LayoutDashboard, Flame, BookOpen, Compass, Tv, Database, Shield, Briefcase, Landmark, Inbox, Watch, Search, Globe, Layers } from 'lucide-react';
import { getAmplitude } from '../services/speechVisualizer';

const CHAT_DATE_GROUPS = ['Today', 'Yesterday', 'Older'];

function getChatDateGroup(createdAt) {
  if (!createdAt) return 'Older';
  const date = new Date(createdAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date >= startOfToday) return 'Today';
  if (date >= startOfYesterday) return 'Yesterday';
  return 'Older';
}

// A flat 40-item list of near-identical titles ("Good morning! Please...")
// was unscannable — grouping by day at least lets you jump to "yesterday"
// or "older" without reading every row.
function groupChatsByDate(chats) {
  const groups = { Today: [], Yesterday: [], Older: [] };
  for (const c of chats) {
    groups[getChatDateGroup(c.createdAt)].push(c);
  }
  return groups;
}

function ChatRow({ chat, isActive, onSelectChat, onDeleteChat }) {
  return (
    <motion.div
      whileHover={{ x: 3 }}
      onClick={() => onSelectChat(chat.id)}
      style={{
        padding: '0.65rem 0.75rem',
        borderRadius: '10px',
        background: isActive ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
        border: isActive ? '1px solid rgba(0, 242, 254, 0.25)' : '1px solid transparent',
        color: isActive ? '#f8fafc' : '#94a3b8',
        fontSize: '0.85rem',
        fontWeight: isActive ? 600 : 400,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        transition: 'all 0.15s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
        <MessageSquare size={14} color={isActive ? '#00f2fe' : '#64748b'} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
          {chat.title || 'Untitled Chat'}
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDeleteChat(chat.id);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#64748b',
          cursor: 'pointer',
          opacity: 0.6,
          padding: '2px'
        }}
      >
        <Trash2 size={13} />
      </button>
    </motion.div>
  );
}

export default function Sidebar({
  activeView,
  onSelectView,
  onSelectDashboard,
  onSelectChatView,
  mcpStatus,
  escalationStats,
  skillsStats,
  securityStats,
  connectedClients,
  // Nothing passes this yet, and that is the correct default: the wearable
  // chip below used to render a hardcoded "89pt / Optimal Recovery" with no
  // data source whatsoever. With no prop it now renders nothing, and it starts
  // showing real values the moment a caller passes a health summary.
  healthSummary = null,
  isOllamaConnected,
  isPaused,
  onTogglePause,
  models,
  selectedModel,
  onSelectModel,
  currentPersona,
  onOpenPersonaModal,
  onOpenMemoryModal,
  onOpenSkillsDashboard,
  onOpenProjectsPanel,
  projectLiveStatus,
  onOpenFinancesPanel,
  smartHomeStats,
  onOpenSmartHomeDrawer,
  onOpenDevWorkspace,
  onOpenAthenaWorkspace,
  onOpenCommandPalette,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat
}) {
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [isWorkspacesCollapsed, setIsWorkspacesCollapsed] = useState(false);
  const [systemExpanded, setSystemExpanded] = useState(false);
  const [collapsedDateGroups, setCollapsedDateGroups] = useState(() => new Set());
  const smartHomeNeedsAttention = !!(smartHomeStats && smartHomeStats.locksUnlocked > 0);

  // Visual for "Aloy is speaking": the brand badge's own glow/scale driven by
  // real Kokoro TTS audio amplitude (src/services/speechVisualizer.js), not a
  // scripted animation — silence reads as ~0 amplitude, so idle and speaking
  // are the same code path, just different numbers. Direct DOM writes via a
  // ref rather than React state — this polls every animation frame, and
  // re-rendering the whole sidebar 60x/sec for a glow effect would be wasteful.
  const brandBadgeRef = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const amp = getAmplitude();
      const el = brandBadgeRef.current;
      if (el) {
        el.style.boxShadow = `0 0 ${15 + amp * 25}px rgba(0, 242, 254, ${0.4 + amp * 0.4})`;
        el.style.transform = `scale(${1 + amp * 0.08})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggleDateGroup = (label) => {
    setCollapsedDateGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  return (
    <motion.aside
      className="app-sidebar"
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        width: '280px',
        height: '100vh',
        background: 'rgba(11, 15, 25, 0.95)',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        padding: '1.25rem',
        gap: '1.25rem',
        flexShrink: 0,
        overflowY: 'auto'
      }}
    >
      {/* Brand Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div ref={brandBadgeRef} style={{
            width: '34px',
            height: '34px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #00f2fe 0%, #7f00ff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(0, 242, 254, 0.4)',
            transition: 'transform 0.05s linear'
          }}>
            <Cpu size={20} color="#fff" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
              <span className="gradient-text">Aloy</span>
            </h2>
            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>FOCUS v2.0.0</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Gaming Mode toggle — stops background polling/webcam and frees
              the loaded model's VRAM immediately for a concurrently running game. */}
          <button
            onClick={onTogglePause}
            aria-pressed={isPaused}
            title={isPaused ? 'Gaming Mode ON — click to resume Aloy' : 'Pause Aloy for Gaming Mode'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '30px',
              height: '30px',
              borderRadius: '20px',
              cursor: 'pointer',
              background: isPaused ? 'rgba(251, 146, 60, 0.15)' : 'transparent',
              border: isPaused ? '1px solid rgba(251, 146, 60, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              color: isPaused ? '#fb923c' : '#64748b'
            }}
          >
            <Gamepad2 size={14} />
          </button>

          {/* Status indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '20px',
            background: isPaused ? 'rgba(251, 146, 60, 0.1)' : isOllamaConnected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: isPaused ? '1px solid rgba(251, 146, 60, 0.3)' : isOllamaConnected ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)'
          }}>
            <div className={!isPaused && isOllamaConnected ? "pulse-green" : ""} style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isPaused ? '#fb923c' : isOllamaConnected ? '#22c55e' : '#ef4444'
            }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isPaused ? '#fb923c' : isOllamaConnected ? '#4ade80' : '#f87171' }}>
              {isPaused ? 'Paused' : isOllamaConnected ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Primary Navigation Mode Switcher */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onSelectDashboard}
          style={{
            flex: 1,
            padding: '0.65rem 0.5rem',
            borderRadius: '12px',
            border: activeView === 'dashboard' ? '1px solid rgba(0, 242, 254, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
            background: activeView === 'dashboard' ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.18), rgba(79, 172, 254, 0.18))' : 'rgba(255, 255, 255, 0.03)',
            color: activeView === 'dashboard' ? '#00f2fe' : '#94a3b8',
            fontWeight: 700,
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.45rem',
            cursor: 'pointer',
            boxShadow: activeView === 'dashboard' ? '0 0 15px rgba(0, 242, 254, 0.2)' : 'none',
            transition: 'all 0.15s ease'
          }}
        >
          <LayoutDashboard size={15} />
          Dashboard
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onSelectChatView}
          style={{
            flex: 1,
            padding: '0.65rem 0.5rem',
            borderRadius: '12px',
            border: activeView === 'chat' ? '1px solid rgba(0, 242, 254, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
            background: activeView === 'chat' ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.18), rgba(79, 172, 254, 0.18))' : 'rgba(255, 255, 255, 0.03)',
            color: activeView === 'chat' ? '#00f2fe' : '#94a3b8',
            fontWeight: 700,
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.45rem',
            cursor: 'pointer',
            boxShadow: activeView === 'chat' ? '0 0 15px rgba(0, 242, 254, 0.2)' : 'none',
            transition: 'all 0.15s ease'
          }}
        >
          <MessageSquare size={15} />
          Chat Area
        </motion.button>
      </div>

      {/* New Chat Button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onNewChat}
        style={{
          width: '100%',
          padding: '0.8rem 1rem',
          borderRadius: '14px',
          border: 'none',
          background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
          color: '#07090e',
          fontWeight: 700,
          fontSize: '0.88rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0, 242, 254, 0.25)'
        }}
      >
        <Plus size={16} />
        New Conversation
      </motion.button>

      {/* Spotlight Command Palette Trigger (Ctrl+K) */}
      <motion.div
        whileHover={{ scale: 1.01, borderColor: 'rgba(0, 242, 254, 0.4)' }}
        whileTap={{ scale: 0.98 }}
        onClick={onOpenCommandPalette}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.45rem 0.75rem',
          borderRadius: '10px',
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          cursor: 'pointer',
          color: '#94a3b8',
          fontSize: '0.78rem',
          gap: '0.5rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Search size={13} color="#00f2fe" />
          <span>Quick Command</span>
        </div>
        <span style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '4px',
          padding: '1px 5px',
          color: '#cbd5e1'
        }}>
          Ctrl+K
        </span>
      </motion.div>

      {/* ========================================== */}
      {/* SUB-AGENT PANTHEON NAVIGATION HUB          */}
      {/* ========================================== */}
      <div className="glass-panel" style={{ padding: '0.5rem', borderRadius: '14px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginTop: '0.2rem', padding: '0.2rem 0.4rem', fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Autonomous Sub-Agents</span>
        </div>

        {/* INBOX — cross-agent findings feed, not itself a Pantheon agent,
            so it gets Aloy's own brand cyan rather than an agent color. */}
        {/* -1. INBOX */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(0, 242, 254, 0.12)' }}
          onClick={() => onSelectView && onSelectView('inbox')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'inbox' ? '1px solid #00f2fe' : '1px solid rgba(0, 242, 254, 0.18)',
            background: activeView === 'inbox' ? 'rgba(0, 242, 254, 0.15)' : 'rgba(0, 242, 254, 0.04)',
            boxShadow: activeView === 'inbox' ? '0 0 10px rgba(0, 242, 254, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(0, 242, 254, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00f2fe', flexShrink: 0 }}>
            <Inbox size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>Inbox</div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Cross-agent findings feed</div>
          </div>
        </motion.div>

        {/* 0. PANTHEON STRATEGIC COUNCIL */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(168, 85, 247, 0.18)' }}
          onClick={() => onSelectView && onSelectView('conclave')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'conclave' ? '1px solid #a855f7' : '1px solid rgba(168, 85, 247, 0.25)',
            background: activeView === 'conclave' ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.22) 0%, rgba(56, 189, 248, 0.12) 100%)' : 'rgba(168, 85, 247, 0.05)',
            boxShadow: activeView === 'conclave' ? '0 0 10px rgba(168, 85, 247, 0.25)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(168, 85, 247, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c084fc', flexShrink: 0 }}>
            <Landmark size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Pantheon Council</span>
              <span style={{ fontSize: '0.55rem', color: '#c084fc', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(168, 85, 247, 0.25)' }}>COUNCIL</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Weekly Strategic Conclave</div>
          </div>
        </motion.div>

        {/* 1. HEPHAESTUS */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(245, 158, 11, 0.16)' }}
          onClick={() => onSelectView ? onSelectView('hephaestus') : (onOpenDevWorkspace && onOpenDevWorkspace())}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: (activeView === 'hephaestus' || activeView === 'cauldron' || activeView === 'projects') ? '1px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.22)',
            background: (activeView === 'hephaestus' || activeView === 'cauldron' || activeView === 'projects') ? 'rgba(245, 158, 11, 0.18)' : 'rgba(245, 158, 11, 0.04)',
            boxShadow: (activeView === 'hephaestus' || activeView === 'cauldron' || activeView === 'projects') ? '0 0 10px rgba(245, 158, 11, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', flexShrink: 0 }}>
            <Flame size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Hephaestus</span>
              <span style={{ fontSize: '0.55rem', color: '#f59e0b', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(245, 158, 11, 0.2)' }}>HEPH</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Code Forge & Monitored Projects</div>
          </div>
        </motion.div>

        {/* 2. ATHENA */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(56, 189, 248, 0.16)' }}
          onClick={() => onSelectView ? onSelectView('athena') : (onOpenAthenaWorkspace && onOpenAthenaWorkspace())}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'athena' ? '1px solid #38bdf8' : '1px solid rgba(56, 189, 248, 0.22)',
            background: activeView === 'athena' ? 'rgba(56, 189, 248, 0.18)' : 'rgba(56, 189, 248, 0.04)',
            boxShadow: activeView === 'athena' ? '0 0 10px rgba(56, 189, 248, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8', flexShrink: 0 }}>
            <Compass size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Athena</span>
              <span style={{ fontSize: '0.55rem', color: '#38bdf8', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(56, 189, 248, 0.2)' }}>SCOUT</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Deep Research & Dossiers</div>
          </div>
        </motion.div>

        {/* 3. APOLLO */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(245, 158, 11, 0.16)' }}
          onClick={() => onSelectView && onSelectView('apollo')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: (activeView === 'apollo' || activeView === 'memory' || activeView === 'profile' || activeView === 'skills') ? '1px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.22)',
            background: (activeView === 'apollo' || activeView === 'memory' || activeView === 'profile' || activeView === 'skills') ? 'rgba(245, 158, 11, 0.18)' : 'rgba(245, 158, 11, 0.04)',
            boxShadow: (activeView === 'apollo' || activeView === 'memory' || activeView === 'profile' || activeView === 'skills') ? '0 0 10px rgba(245, 158, 11, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', flexShrink: 0 }}>
            <Database size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Apollo</span>
              <span style={{ fontSize: '0.55rem', color: '#f59e0b', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(245, 158, 11, 0.2)' }}>VAULT</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Memory, Skills & Vault</div>
          </div>
        </motion.div>

        {/* 4. MINERVA */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(16, 185, 129, 0.16)' }}
          onClick={() => onSelectView && onSelectView('minerva')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'minerva' ? '1px solid #10b981' : '1px solid rgba(16, 185, 129, 0.22)',
            background: activeView === 'minerva' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.04)',
            boxShadow: activeView === 'minerva' ? '0 0 10px rgba(16, 185, 129, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', flexShrink: 0 }}>
            <ShieldCheck size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Minerva</span>
              <span style={{ fontSize: '0.55rem', color: '#10b981', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(16, 185, 129, 0.2)' }}>SENTINEL</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Smart Home & Reliability</div>
          </div>
        </motion.div>

        {/* 5. HERMES */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(139, 92, 246, 0.16)' }}
          onClick={() => onSelectView && onSelectView('hermes')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'hermes' ? '1px solid #8b5cf6' : '1px solid rgba(139, 92, 246, 0.22)',
            background: activeView === 'hermes' ? 'rgba(139, 92, 246, 0.18)' : 'rgba(139, 92, 246, 0.04)',
            boxShadow: activeView === 'hermes' ? '0 0 10px rgba(139, 92, 246, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(139, 92, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6', flexShrink: 0 }}>
            <Activity size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Hermes</span>
              <span style={{ fontSize: '0.55rem', color: '#8b5cf6', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(139, 92, 246, 0.2)' }}>BRIEF</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Daily Briefs, Jobs & Ops</div>
          </div>
        </motion.div>

        {/* MEDIA & INFRASTRUCTURE SECTION */}
        <div style={{ marginTop: '0.6rem', marginBottom: '0.35rem', padding: '0.3rem 0.4rem 0.1rem', fontSize: '0.68rem', fontWeight: 800, color: '#00f2fe', textTransform: 'uppercase', letterSpacing: '0.06em', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Media & Infrastructure</span>
        </div>

        {/* 6. MEDIA CAST DISPATCHER */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(0, 242, 254, 0.16)' }}
          onClick={() => onSelectView && onSelectView('media')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'media' ? '1px solid #00f2fe' : '1px solid rgba(0, 242, 254, 0.22)',
            background: activeView === 'media' ? 'rgba(0, 242, 254, 0.18)' : 'rgba(0, 242, 254, 0.04)',
            boxShadow: activeView === 'media' ? '0 0 10px rgba(0, 242, 254, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(0, 242, 254, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00f2fe', flexShrink: 0 }}>
            <Tv size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Media Cast</span>
              <span style={{ fontSize: '0.55rem', color: '#00f2fe', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(0, 242, 254, 0.2)' }}>CAST</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Bazzite, Lenny & TVs</div>
          </div>
        </motion.div>

        {/* 6b. MEDIA STACK (ARR HUB) */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(168, 85, 247, 0.16)' }}
          onClick={() => onSelectView && onSelectView('mediastack')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'mediastack' ? '1px solid #a855f7' : '1px solid rgba(168, 85, 247, 0.22)',
            background: activeView === 'mediastack' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(168, 85, 247, 0.04)',
            boxShadow: activeView === 'mediastack' ? '0 0 10px rgba(168, 85, 247, 0.2)' : 'none',
            marginBottom: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(168, 85, 247, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a855f7', flexShrink: 0 }}>
            <Layers size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Media Stack</span>
              <span style={{ fontSize: '0.55rem', color: '#a855f7', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(168, 85, 247, 0.2)' }}>ARR</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Sonarr, Radarr, Lidarr, RetroArr</div>
          </div>
        </motion.div>

        {/* 7. ROUTE INTELLIGENCE & NETWORK TELEMETRY */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(0, 242, 254, 0.16)' }}
          onClick={() => onSelectView && onSelectView('network')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: activeView === 'network' ? '1px solid #00f2fe' : '1px solid rgba(0, 242, 254, 0.22)',
            background: activeView === 'network' ? 'rgba(0, 242, 254, 0.18)' : 'rgba(0, 242, 254, 0.04)',
            boxShadow: activeView === 'network' ? '0 0 10px rgba(0, 242, 254, 0.2)' : 'none'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(0, 242, 254, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00f2fe', flexShrink: 0 }}>
            <Globe size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Route Intel</span>
              <span style={{ fontSize: '0.55rem', color: '#00f2fe', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(0, 242, 254, 0.2)' }}>NET</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>BGP, IXP & Traceroute</div>
          </div>
        </motion.div>

        {/* 7. DEVELOPER DOCUMENTATION */}
        <motion.div
          whileHover={{ x: 2, background: 'rgba(56, 189, 248, 0.16)' }}
          onClick={() => window.open('http://localhost:7890/docs/', '_blank')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.38rem 0.5rem',
            borderRadius: '8px',
            cursor: 'pointer',
            border: '1px solid rgba(56, 189, 248, 0.22)',
            background: 'rgba(56, 189, 248, 0.04)',
            marginTop: '3px'
          }}
        >
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8', flexShrink: 0 }}>
            <BookOpen size={13} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Developer Docs</span>
              <span style={{ fontSize: '0.55rem', color: '#38bdf8', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(56, 189, 248, 0.2)' }}>DOCS ↗</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Architecture, APIs & Guides</div>
          </div>
        </motion.div>
      </div>

      {/* Session — Active Model + Assistant Persona merged into one card,
          since both configure how the AI behaves for this chat. */}
      <div className="glass-panel" style={{ padding: '0.9rem', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Session
        </span>

        <select
          value={selectedModel}
          onChange={(e) => onSelectModel(e.target.value)}
          className="glass-input"
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          {models.length > 0 ? (
            models.map((m) => (
              <option key={m.name} value={m.name} style={{ background: '#171d2c', color: '#fff' }}>
                {m.name}
              </option>
            ))
          ) : (
            <option value="aloy-assistant" style={{ background: '#171d2c', color: '#fff' }}>
              aloy-assistant (Default)
            </option>
          )}
        </select>

        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(0, 242, 254, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#00f2fe',
              flexShrink: 0
            }}>
              <Sparkles size={16} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentPersona ? currentPersona.name : 'Personal Assistant'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentPersona ? `${currentPersona.systemPrompt.slice(0, 25)}...` : 'Default instructions'}
              </div>
            </div>
          </div>
          <button
            onClick={onOpenPersonaModal}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#00f2fe',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.75rem',
              fontWeight: 700,
              flexShrink: 0
            }}
          >
            <Sliders size={14} />
          </button>
        </div>
      </div>

      {/* Chat History List */}
      <div style={{ flex: isHistoryCollapsed ? '0 0 auto' : 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
        <button
          onClick={() => setIsHistoryCollapsed(prev => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: '4px'
          }}
        >
          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent Conversations{chats.length > 0 ? ` (${chats.length})` : ''}
          </span>
          {isHistoryCollapsed ? <ChevronRight size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
        </button>

        {isHistoryCollapsed ? null : chats.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: '#475569', fontStyle: 'italic', padding: '0.5rem' }}>
            No recent chats
          </div>
        ) : (
          (() => {
            const grouped = groupChatsByDate(chats);
            return CHAT_DATE_GROUPS.filter((label) => grouped[label].length > 0).map((label) => {
              const isGroupCollapsed = collapsedDateGroups.has(label);
              return (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <button
                    onClick={() => toggleDateGroup(label)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px 4px'
                    }}
                  >
                    <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {label} ({grouped[label].length})
                    </span>
                    {isGroupCollapsed ? <ChevronRight size={11} color="#475569" /> : <ChevronDown size={11} color="#475569" />}
                  </button>
                  {isGroupCollapsed ? null : grouped[label].map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      isActive={c.id === activeChatId}
                      onSelectChat={onSelectChat}
                      onDeleteChat={onDeleteChat}
                    />
                  ))}
                </div>
              );
            });
          })()
        )}
      </div>

      {/* System status — collapsed to one compact row by default (icons +
          counts only) since this keeps growing as more integrations get
          added (MCP, then Claude-assist, now this) and stacking another
          always-visible line per feature doesn't scale. Click to expand
          for the full detail. */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.6rem' }}>
        <motion.div
          whileHover={{ background: 'rgba(255, 255, 255, 0.04)' }}
          onClick={() => setSystemExpanded(v => !v)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '0.3rem 0.5rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.72rem', color: '#64748b' }}
        >
          {mcpStatus && mcpStatus.serverCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Cpu size={11} /> <StatPop value={mcpStatus.serverCount} />
            </span>
          )}
          {escalationStats && escalationStats.count > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#c084fc' }}>
              <Zap size={11} /> <StatPop value={escalationStats.count} />
            </span>
          )}
          {skillsStats && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: skillsStats.needsReviewCount > 0 ? '#fbbf24' : '#38bdf8' }}>
              <BarChart3 size={11} /> <StatPop value={`${skillsStats.overallProficiencyScore}%${skillsStats.needsReviewCount > 0 ? ` (${skillsStats.needsReviewCount})` : ''}`} />
            </span>
          )}
          {securityStats && securityStats.count > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: securityStats.injectionAttemptCount > 0 ? '#f87171' : '#fbbf24' }}>
              <Shield size={11} /> <StatPop value={securityStats.count} />
            </span>
          )}
          {/* Was a hardcoded "89pt / Optimal Recovery" wearable chip with no
              data source at all — it displayed the same score forever, whether
              or not a watch had ever synced. Only render it if there is a real
              sleep score to show. */}
          {healthSummary?.sleepScore != null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#34d399' }}
                  title={`Sleep score ${healthSummary.sleepScore}${healthSummary.recoveryState ? ` • ${healthSummary.recoveryState}` : ''}`}>
              <Watch size={11} /> {healthSummary.sleepScore}pt
            </span>
          )}
          {connectedClients && connectedClients.activeCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#34d399' }}>
              <Users size={11} /> <StatPop value={connectedClients.activeCount} />
            </span>
          )}
          <span>System</span>
          {systemExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </motion.div>

        {systemExpanded && (
          <div style={{ fontSize: '0.75rem', color: '#475569', textAlign: 'center', paddingTop: '0.4rem' }}>
            Connected to <strong>http://localhost:11434</strong>
            {/* Same fabrication as the chip above, expanded. */}
            {healthSummary?.sleepScore != null ? (
              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', color: '#34d399' }}>
                <Watch size={11} /> Sleep {healthSummary.sleepScore}/100
                {healthSummary.batteryLevel != null ? ` • ${healthSummary.batteryLevel}% batt` : ''}
                {healthSummary.recoveryState ? ` • ${healthSummary.recoveryState}` : ''}
              </div>
            ) : (
              <div style={{ marginTop: '4px', color: '#475569' }}>
                <Watch size={11} /> No wearable sync recorded
              </div>
            )}
            {mcpStatus && mcpStatus.serverCount > 0 && (
              <div style={{ marginTop: '4px' }}>
                MCP: {mcpStatus.serverCount} server{mcpStatus.serverCount !== 1 ? 's' : ''} connected ({mcpStatus.toolCount} tools)
              </div>
            )}
            {escalationStats && escalationStats.count > 0 && (
              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', color: '#c084fc' }}>
                <Zap size={11} /> Claude assist: {escalationStats.count} time{escalationStats.count !== 1 ? 's' : ''}
              </div>
            )}
            {skillsStats && (
              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', color: skillsStats.needsReviewCount > 0 ? '#fbbf24' : '#38bdf8' }}>
                <BarChart3 size={11} /> Skills: {skillsStats.overallProficiencyScore}% overall{skillsStats.needsReviewCount > 0 ? `, ${skillsStats.needsReviewCount} need review` : ''}
              </div>
            )}
            {securityStats && securityStats.count > 0 && (
              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', color: securityStats.injectionAttemptCount > 0 ? '#f87171' : '#fbbf24' }}>
                <Shield size={11} /> Security: {securityStats.injectionAttemptCount > 0 ? `${securityStats.injectionAttemptCount} injection attempt${securityStats.injectionAttemptCount !== 1 ? 's' : ''} blocked` : `${securityStats.blockedAccessCount} access denial${securityStats.blockedAccessCount !== 1 ? 's' : ''}`} ({securityStats.windowDays}d)
              </div>
            )}
            {connectedClients && connectedClients.activeCount > 0 && (
              <div style={{ marginTop: '4px', color: '#34d399' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                  <Users size={11} /> {connectedClients.activeCount} client{connectedClients.activeCount !== 1 ? 's' : ''} connected (last {connectedClients.activeWindowMinutes}m)
                </div>
                {connectedClients.clients.filter(c => c.secondsAgo * 1000 <= connectedClients.activeWindowMinutes * 60000).map((c) => (
                  <div key={c.ip} style={{ fontSize: '0.68rem', color: '#475569', marginTop: '2px' }}>
                    {c.isLocal ? 'This device' : c.ip} — {c.secondsAgo < 60 ? 'just now' : `${Math.floor(c.secondsAgo / 60)}m ago`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.aside>
  );
}
