import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Mic, MicOff, Settings, Bell, ExternalLink, Minimize2, 
  Cpu, HardDrive, Wifi, Activity, CheckCircle, AlertTriangle, 
  Terminal, Sparkles, Sun, Moon, ArrowRight, ShieldCheck, 
  Layers, Lightbulb, Calendar, BookOpen, Send, X, RefreshCw, Copy, Check, Pin, PinOff, ChevronRight, ChevronDown, Watch
} from 'lucide-react';
import { renderMarkdown } from '../services/markdown';
import { apiFetch, apiJson } from '../services/aloyApi.js';

const QUICK_CHIPS = [
  { label: '/briefing', icon: Sun, color: '#38bdf8', prompt: "Good morning! Please give me my Walk-Up Morning Briefing with my watch sleep score & recovery, today's calendar schedule, and home status." },
  { label: '/lights', icon: Lightbulb, color: '#fbbf24', prompt: 'What lights are currently on in the house?' },
  { label: '/conclave', icon: Layers, color: '#c084fc', prompt: 'Summarize the latest strategic directives from the Pantheon Conclave meeting.' },
  { label: '/vault', icon: BookOpen, color: '#34d399', prompt: 'What recent notes do I have in my Obsidian vault?' },
  { label: '/status', icon: ShieldCheck, color: '#00f2fe', prompt: 'Run a system health check on all background services and sidecars.' },
  { label: '/heph', icon: Terminal, color: '#f59e0b', prompt: 'Hephaestus, list any pending code development tasks or work orders.' }
];

export default function HudOverlay() {
  const [prompt, setPrompt] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(() => {
    try {
      return localStorage.getItem('aloy_hud_pinned') === 'true';
    } catch {
      return false;
    }
  });

  const [metrics, setMetrics] = useState({ cpu: 28, mem: 62, latency: 12, status: 'STABLE' });
  const [buildInfo, setBuildInfo] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingToolCall, setPendingToolCall] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);

  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Toggle and persist pin state
  const togglePin = () => {
    setIsPinned(prev => {
      const next = !prev;
      try {
        localStorage.setItem('aloy_hud_pinned', String(next));
      } catch {}
      return next;
    });
  };

  // Determine if the sidebar should be fully slid out or retracted to the edge tab
  const isBarActive = isPinned || isHovered || isStreaming || prompt.length > 0 || messages.length > 0;

  // Synchronize OS-level Electron window bounds when expanding/collapsing to eliminate 100% deadspace
  useEffect(() => {
    if (window.electronAPI?.hudSetExpanded) {
      if (isBarActive) {
        window.electronAPI.hudSetExpanded(true);
      } else {
        const timer = setTimeout(() => {
          window.electronAPI.hudSetExpanded(false);
        }, 280);
        return () => clearTimeout(timer);
      }
    }
  }, [isBarActive]);

  // Ensure transparent window backdrop
  useEffect(() => {
    document.documentElement.classList.add('hud-mode');
    document.body.classList.add('hud-mode');
    const root = document.getElementById('root');
    if (root) root.classList.add('hud-mode');
  }, []);

  // Fetch build identity (git sha/branch, build timestamp) once, for the
  // Sentinel Pill tooltip — lets us confirm which build is actually running
  // without cracking open the asar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = window.electronAPI?.getBuildInfo
          ? await window.electronAPI.getBuildInfo()
          : await apiJson('/api/build-info');
        if (!cancelled) setBuildInfo(info);
      } catch {
        // Non-critical — tooltip just falls back to version-only.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll hardware & sentinel telemetry
  useEffect(() => {
    const fetchMetrics = async () => {
      if (window.electronAPI?.hudGetMetrics) {
        try {
          const data = await window.electronAPI.hudGetMetrics();
          if (data) setMetrics(data);
        } catch {}
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  // Global hotkey / focus listener (Ctrl+Shift+Space)
  useEffect(() => {
    if (window.electronAPI?.onHudFocus) {
      return window.electronAPI.onHudFocus(() => {
        setIsHovered(true);
        setTimeout(() => inputRef.current?.focus(), 80);
      });
    }
  }, []);

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, pendingToolCall]);

  // Keyboard shortcut listener within HUD
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsHovered(false);
        inputRef.current?.blur();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCopy = (text, idx) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  // Submit Prompt to Aloy
  const handleSubmit = async (textToSend = null) => {
    const userQuery = (textToSend || prompt).trim();
    if (!userQuery || isStreaming) return;

    setPrompt('');
    const userMessage = { role: 'user', content: userQuery, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);
    setPendingToolCall(null);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'aloy-assistant:latest',
          messages: [{ role: 'user', content: userQuery }]
        })
      });

      const data = await res.json();
      setIsStreaming(false);

      if (data.type === 'complete') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.text || 'Action complete.',
          usedTools: data.usedTools,
          toolNames: data.toolNamesUsed,
          timestamp: new Date().toISOString()
        }]);
      } else if (data.type === 'pending_confirmation') {
        setPendingToolCall(data.pendingCalls?.[0] || null);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'I need your authorization to execute this system action:',
          pendingCalls: data.pendingCalls,
          timestamp: new Date().toISOString()
        }]);
      } else if (data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${data.error}`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (err) {
      setIsStreaming(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Failed to connect to Aloy: ${err.message}`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handleResolveTool = async (callId, approved) => {
    try {
      setIsStreaming(true);
      const res = await apiFetch('/api/chat/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, approved })
      });
      const data = await res.json();
      setIsStreaming(false);
      setPendingToolCall(null);

      if (data.type === 'complete') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.text,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (err) {
      setIsStreaming(false);
      console.error('Failed to resolve tool:', err);
    }
  };

  return (
    <div 
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'stretch',
        userSelect: 'none',
        fontFamily: 'var(--font-sans)',
        color: '#f1f5f9',
        boxSizing: 'border-box',
        background: 'transparent',
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      {/* ========================================================================= */}
      {/* RETRACTED EDGE TRIGGER TAB (Zero deadspace — window is only 28px wide)    */}
      {/* ========================================================================= */}
      {!isBarActive && (
        <div 
          onMouseEnter={() => setIsHovered(true)}
          style={{
            width: '28px',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'pointer',
            pointerEvents: 'auto',
            background: 'transparent'
          }}
        >
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            padding: '16px 4px',
            background: 'rgba(7, 11, 22, 0.95)',
            border: '1px solid rgba(0, 242, 254, 0.5)',
            borderRight: 'none',
            borderRadius: '12px 0 0 12px',
            boxShadow: '-4px 0 16px rgba(0, 242, 254, 0.35)'
          }}>
            <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00f2fe', boxShadow: '0 0 8px #00f2fe' }} />
            <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#00f2fe', writingMode: 'vertical-rl', letterSpacing: '0.18em' }}>
              ⚡ ALOY
            </span>
            <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00f2fe', boxShadow: '0 0 8px #00f2fe' }} />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* RIGHT-EDGE SLIDEOUT GLASS SIDEBAR (Active/Expanded)                       */}
      {/* ========================================================================= */}
      {isBarActive && (
        <div 
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            position: 'relative',
            zIndex: 50,
            width: '420px',
            height: '100vh',
            background: 'linear-gradient(180deg, #0a0f1d 0%, #060914 100%)',
            borderLeft: '1px solid rgba(0, 242, 254, 0.45)',
            borderRight: 'none',
            borderTop: 'none',
            borderBottom: 'none',
            borderRadius: '24px 0 0 24px',
            boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.9)',
            transform: 'translateX(0)',
            opacity: 1,
            transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            overflow: 'hidden',
            pointerEvents: 'auto'
          }}
        >
          {/* 1. TOP HEADER & TELEMETRY */}
        <div style={{
          padding: '14px 16px 10px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          background: 'rgba(10, 15, 28, 0.95)'
        }}>
          {/* Row 1: Logo & Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '9px',
                background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.3), rgba(99, 102, 241, 0.3))',
                border: '1px solid rgba(0, 242, 254, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 12px rgba(0, 242, 254, 0.25)'
              }}>
                <Sparkles size={15} color="#00f2fe" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                    Aloy Sidecar
                  </span>
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'rgba(0, 242, 254, 0.15)', color: '#00f2fe', border: '1px solid rgba(0, 242, 254, 0.3)' }}>
                    v2.0
                  </span>
                </div>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Pin Toggle */}
              <button
                type="button"
                onClick={togglePin}
                style={{
                  padding: '5px 8px',
                  borderRadius: '7px',
                  border: isPinned ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.1)',
                  background: isPinned ? 'rgba(0, 242, 254, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                  color: isPinned ? '#00f2fe' : '#94a3b8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  transition: 'all 0.15s ease'
                }}
                title={isPinned ? 'Pinned: Always open (Click to auto-retract)' : 'Auto-Retract mode (Click to pin open)'}
              >
                {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
                <span>{isPinned ? 'Pinned' : 'Pin'}</span>
              </button>

              {/* Open Full App Window */}
              <button
                type="button"
                onClick={() => window.electronAPI?.hudToggleMainApp?.()}
                style={{
                  padding: '5px',
                  borderRadius: '7px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
                title="Expand to Full Aloy Desktop"
              >
                <ExternalLink size={13} />
              </button>

              {/* Retract / Dismiss */}
              <button
                type="button"
                onClick={() => { setIsHovered(false); if (isPinned) setIsPinned(false); }}
                style={{
                  padding: '5px',
                  borderRadius: '7px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
                title="Retract (Esc)"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Row 2: Live Telemetry Micro Gauges */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 10px',
            background: 'rgba(0, 0, 0, 0.45)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.68rem',
            fontFamily: 'var(--font-mono)'
          }}>
            {/* CPU Gauge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: '#64748b', fontWeight: 700 }}>CPU</span>
              <div style={{ width: '36px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${metrics.cpu}%`, height: '100%', background: '#38bdf8', borderRadius: '2px' }} />
              </div>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{metrics.cpu}%</span>
            </div>

            {/* MEM Gauge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: '#64748b', fontWeight: 700 }}>MEM</span>
              <div style={{ width: '36px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${metrics.mem}%`, height: '100%', background: '#34d399', borderRadius: '2px' }} />
              </div>
              <span style={{ color: '#34d399', fontWeight: 600 }}>{metrics.mem}%</span>
            </div>

            {/* Latency */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#00f2fe' }}>
              <Wifi size={11} />
              <span>{metrics.latency}ms</span>
            </div>

            {/* Sentinel Pill — hover for exact build identity (git sha/branch, build time) */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#4ade80', cursor: buildInfo ? 'help' : 'default' }}
              title={buildInfo ? `Aloy v${buildInfo.version} · ${buildInfo.gitSha}${buildInfo.dirty ? ' (dirty)' : ''} on ${buildInfo.gitBranch}${buildInfo.builtAt ? `\nBuilt ${new Date(buildInfo.builtAt).toLocaleString()}` : ''}` : undefined}
            >
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 5px #4ade80' }} />
              <span style={{ fontWeight: 700 }}>{metrics.status}</span>
            </div>
          </div>
        </div>

        {/* 2. OMNIBAR PROMPT INPUT */}
        <div style={{ padding: '12px 16px 8px 16px' }}>
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}
          >
            <Search style={{ position: 'absolute', left: '12px', width: '15px', height: '15px', color: 'rgba(0, 242, 254, 0.8)', pointerEvents: 'none' }} />
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask Aloy, run /command, or type a query..."
              style={{
                width: '100%',
                height: '38px',
                paddingLeft: '36px',
                paddingRight: '64px',
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                borderRadius: '12px',
                fontSize: '0.82rem',
                color: '#f8fafc',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'var(--font-sans)',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
                transition: 'all 0.2s ease'
              }}
            />

            <div style={{ position: 'absolute', right: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <button
                type="button"
                onClick={() => setIsListening(!isListening)}
                style={{
                  padding: '5px',
                  borderRadius: '7px',
                  border: isListening ? '1px solid #f43f5e' : 'none',
                  background: isListening ? 'rgba(244, 63, 94, 0.25)' : 'transparent',
                  color: isListening ? '#f43f5e' : '#64748b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
                title="Voice Input (Whisper STT)"
              >
                <Mic size={14} />
              </button>

              <button
                type="submit"
                disabled={!prompt.trim() || isStreaming}
                style={{
                  padding: '5px 7px',
                  borderRadius: '7px',
                  border: 'none',
                  background: prompt.trim() ? '#00f2fe' : 'rgba(255, 255, 255, 0.06)',
                  color: prompt.trim() ? '#000' : '#475569',
                  cursor: prompt.trim() ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  boxShadow: prompt.trim() ? '0 0 10px rgba(0, 242, 254, 0.5)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <Send size={12} />
              </button>
            </div>
          </form>
        </div>

        {/* 3. QUICK CHIPS 3x2 GRID */}
        <div style={{
          padding: '0 16px 10px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '6px'
        }}>
          {QUICK_CHIPS.map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleSubmit(chip.prompt)}
                style={{
                  padding: '6px 4px',
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: `1px solid ${chip.color}35`,
                  borderRadius: '8px',
                  fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color: chip.color,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={12} color={chip.color} />
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>

        {/* 4. SCROLLABLE CHAT & INTELLIGENT DRAWER */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 16px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {messages.length === 0 ? (
            /* Standby State */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Standby Hero Card */}
              <div style={{
                padding: '16px',
                background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.08), rgba(99, 102, 241, 0.08))',
                border: '1px solid rgba(0, 242, 254, 0.25)',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  padding: '10px',
                  background: 'rgba(0, 242, 254, 0.15)',
                  border: '1px solid rgba(0, 242, 254, 0.4)',
                  borderRadius: '10px',
                  boxShadow: '0 0 14px rgba(0, 242, 254, 0.25)'
                }}>
                  <Sparkles size={20} color="#00f2fe" />
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '0.02em' }}>
                    ALOY AUTONOMOUS SIDECAR
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                    Summon anywhere with <kbd style={{ padding: '1px 4px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', color: '#00f2fe' }}>Ctrl+Shift+Space</kbd>
                  </div>
                </div>
              </div>

              {/* Ambient Status Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div 
                  onClick={() => handleSubmit("Good morning! Please give me my Walk-Up Morning Briefing with my watch sleep score & recovery, today's calendar schedule, and home status.")}
                  style={{
                    padding: '10px',
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#38bdf8', fontSize: '0.74rem', fontWeight: 700 }}>
                    <Watch size={13} />
                    <span>Amazfit T-Rex 3</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#cbd5e1' }}>89pt Recovery • 59%</span>
                </div>

                <div 
                  onClick={() => handleSubmit('What lights are currently on in the house?')}
                  style={{
                    padding: '10px',
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(251, 191, 36, 0.2)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#fbbf24', fontSize: '0.74rem', fontWeight: 700 }}>
                    <Lightbulb size={13} />
                    <span>Smart Home Hub</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#cbd5e1' }}>Check lights & climate</span>
                </div>
              </div>

              {/* Action Directives */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div 
                  onClick={() => handleSubmit("Good morning! Please give me my Walk-Up Morning Briefing with today's calendar schedule and home status.")}
                  style={{
                    padding: '11px 13px',
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    borderRadius: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sun size={15} color="#38bdf8" />
                    <div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>Morning Briefing</div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Calendar pulse, workouts & weather</div>
                    </div>
                  </div>
                  <ChevronRight size={14} color="#64748b" />
                </div>

                <div 
                  onClick={() => handleSubmit('Summarize the latest strategic directives from the Pantheon Conclave meeting')}
                  style={{
                    padding: '11px 13px',
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(192, 132, 252, 0.2)',
                    borderRadius: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Layers size={15} color="#c084fc" />
                    <div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>Pantheon Conclave</div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Apollo, Minerva, Hephaestus, Hermes</div>
                    </div>
                  </div>
                  <ChevronRight size={14} color="#64748b" />
                </div>

                <div 
                  onClick={() => handleSubmit('Athena, scout latest autonomous local LLM benchmarks on RTX 4090')}
                  style={{
                    padding: '11px 13px',
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(0, 242, 254, 0.2)',
                    borderRadius: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Search size={15} color="#00f2fe" />
                    <div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>Athena Deep Research</div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Dispatch technical scouting dossier</div>
                    </div>
                  </div>
                  <ChevronRight size={14} color="#64748b" />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {messages.map((msg, idx) => (
                <div 
                  key={idx}
                  style={{
                    padding: '11px 13px',
                    borderRadius: '13px',
                    border: msg.role === 'user' ? '1px solid rgba(0, 242, 254, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                    background: msg.role === 'user' ? 'rgba(0, 242, 254, 0.1)' : 'rgba(15, 23, 42, 0.85)',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: msg.role === 'user' ? '#38bdf8' : '#00f2fe' }}>
                      {msg.role === 'user' ? '👤 Commander' : '🤖 Aloy'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {msg.role === 'assistant' && (
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.content, idx)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '0.65rem',
                            fontFamily: 'var(--font-mono)'
                          }}
                          title="Copy response"
                        >
                          {copiedIdx === idx ? <Check size={11} color="#34d399" /> : <Copy size={11} />}
                          <span>{copiedIdx === idx ? 'Copied' : 'Copy'}</span>
                        </button>
                      )}
                      <span style={{ fontSize: '0.65rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {msg.role === 'user' ? (
                    <div style={{ fontSize: '0.82rem', color: '#e0f2fe', fontWeight: 500, lineHeight: '1.4' }}>
                      {msg.content}
                    </div>
                  ) : (
                    <div 
                      className="markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      style={{ fontSize: '0.8rem', lineHeight: '1.55', color: '#f1f5f9' }}
                    />
                  )}

                  {msg.toolNames && msg.toolNames.length > 0 && (
                    <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: '#00f2fe' }}>
                      <ShieldCheck size={12} color="#00f2fe" />
                      <span>Executed: {msg.toolNames.join(', ')}</span>
                    </div>
                  )}

                  {msg.pendingCalls && msg.pendingCalls.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#fbbf24', fontWeight: 600, fontSize: '0.76rem', marginBottom: '4px' }}>
                        <AlertTriangle size={13} />
                        <span>Action Requires Authorization</span>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: '#cbd5e1', fontFamily: 'var(--font-mono)', margin: '0 0 8px 0' }}>
                        {msg.pendingCalls[0].confirmLabel}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleResolveTool(msg.pendingCalls[0].id, true)}
                          style={{
                            padding: '4px 10px',
                            background: '#0284c7',
                            border: 'none',
                            color: '#fff',
                            borderRadius: '6px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveTool(msg.pendingCalls[0].id, false)}
                          style={{
                            padding: '4px 10px',
                            background: 'rgba(30, 41, 59, 0.8)',
                            border: '1px solid rgba(71, 85, 105, 0.5)',
                            color: '#94a3b8',
                            borderRadius: '6px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.7rem',
                            cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {isStreaming && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.74rem', color: '#00f2fe', fontFamily: 'var(--font-mono)', padding: '10px 12px', background: 'rgba(0, 242, 254, 0.06)', borderRadius: '8px', border: '1px solid rgba(0, 242, 254, 0.25)' }}>
                  <Activity size={13} className="spin" />
                  <span>Aloy is synthesizing neural response...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

      </div>
      )}
    </div>
  );
}
