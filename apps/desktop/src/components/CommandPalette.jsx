import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  LayoutDashboard,
  MessageSquare,
  Flame,
  Compass,
  Brain,
  Shield,
  Briefcase,
  Users,
  FolderGit2,
  Lightbulb,
  Lock,
  Power,
  RefreshCw,
  Sparkles,
  Command,
  ArrowRight,
  Sliders,
  Database,
  Film
} from 'lucide-react';
import { listListeningPorts, killPortProcess } from '../services/projectMonitor';

export default function CommandPalette({
  isOpen,
  onClose,
  onSelectView,
  onAskAloy,
  haCategories = {},
  onExecuteHAService,
  trackedProjects = []
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activePorts, setActivePorts] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Fetch active listening ports when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      listListeningPorts().then(ports => setActivePorts(ports || [])).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build the complete command index
  const allCommands = useMemo(() => {
    const commands = [
      // 1. Navigation Commands
      {
        id: 'nav-dashboard',
        category: 'Navigation',
        title: 'Open Dashboard',
        subtitle: 'System health, quick stats, agenda & subagents',
        icon: LayoutDashboard,
        color: '#00f2fe',
        action: () => { onSelectView('dashboard'); onClose(); }
      },
      {
        id: 'nav-chat',
        category: 'Navigation',
        title: 'Open Chat',
        subtitle: 'Main conversational assistant & context canvas',
        icon: MessageSquare,
        color: '#38bdf8',
        action: () => { onSelectView('chat'); onClose(); }
      },
      {
        id: 'nav-media',
        category: 'Media & Cast',
        title: 'Universal Media Dispatcher',
        subtitle: 'Cast movies & shows to Local PC, Bazzite, Lenny, Jellyfin or TV',
        icon: Film,
        color: '#00f2fe',
        action: () => { onSelectView('media'); onClose(); }
      },
      {
        id: 'nav-hephaestus',
        category: 'Studios',
        title: 'Hephaestus (HEPH)',
        subtitle: 'Code Forge, autonomous patches & training flywheel',
        icon: Flame,
        color: '#f59e0b',
        action: () => { onSelectView('hephaestus'); onClose(); }
      },
      {
        id: 'nav-projects',
        category: 'Studios',
        title: 'Hephaestus: Projects & Monitored Builds',
        subtitle: 'Git status, build checks & PortPal port manager',
        icon: FolderGit2,
        color: '#f59e0b',
        action: () => { onSelectView('projects'); onClose(); }
      },
      {
        id: 'nav-athena',
        category: 'Studios',
        title: 'Athena (SCOUT)',
        subtitle: 'Deep Intelligence, Web Scout & Research Dossiers',
        icon: Compass,
        color: '#38bdf8',
        action: () => { onSelectView('athena'); onClose(); }
      },
      {
        id: 'nav-apollo',
        category: 'Studios',
        title: 'Apollo (VAULT)',
        subtitle: 'Persistent memory, skills matrix & Obsidian GraphRAG',
        icon: Brain,
        color: '#a855f7',
        action: () => { onSelectView('apollo'); onClose(); }
      },
      {
        id: 'nav-minerva',
        category: 'Studios',
        title: 'Minerva (SENTINEL)',
        subtitle: 'System watchdog, 2FA security gates & telemetry',
        icon: Shield,
        color: '#10b981',
        action: () => { onSelectView('minerva'); onClose(); }
      },
      {
        id: 'nav-hermes',
        category: 'Studios',
        title: 'Hermes (OPS)',
        subtitle: 'Daily briefings, stock portfolio & budget radar',
        icon: Briefcase,
        color: '#ec4899',
        action: () => { onSelectView('hermes'); onClose(); }
      },
      {
        id: 'nav-council',
        category: 'Studios',
        title: 'Pantheon Council',
        subtitle: 'Weekly strategic conclave & multi-agent deliberation',
        icon: Users,
        color: '#8b5cf6',
        action: () => { onSelectView('council'); onClose(); }
      },

      // 2. Studio Quick Actions
      {
        id: 'act-heph-order',
        category: 'Quick Actions',
        title: 'Hephaestus: Create New Work Order',
        subtitle: 'Stage a new code patch or feature implementation',
        icon: Flame,
        color: '#f59e0b',
        action: () => {
          onSelectView('hephaestus');
          onClose();
        }
      },
      {
        id: 'act-athena-research',
        category: 'Quick Actions',
        title: 'Athena: Launch Research Scout',
        subtitle: 'Run deep multi-source research on a topic',
        icon: Compass,
        color: '#38bdf8',
        action: () => {
          onSelectView('athena');
          onClose();
        }
      },
      {
        id: 'act-apollo-teach',
        category: 'Quick Actions',
        title: 'Apollo: Garden & Teach Facts',
        subtitle: 'Add new persistent knowledge or run fact deduplication',
        icon: Brain,
        color: '#a855f7',
        action: () => {
          onSelectView('apollo');
          onClose();
        }
      }
    ];

    // 3. Smart Home Quick Actions
    if (haCategories && onExecuteHAService) {
      // Lights
      (haCategories.lights || []).forEach(light => {
        const isOn = light.state === 'on';
        commands.push({
          id: `ha-light-${light.entity_id}`,
          category: 'Smart Home',
          title: `${isOn ? 'Turn Off' : 'Turn On'} ${light.name || light.entity_id}`,
          subtitle: `Currently ${light.state} · ${light.entity_id}`,
          icon: Lightbulb,
          color: isOn ? '#eab308' : '#64748b',
          action: () => {
            onExecuteHAService('light', isOn ? 'turn_off' : 'turn_on', light.entity_id);
            onClose();
          }
        });
      });

      // Switches
      (haCategories.switches || []).forEach(sw => {
        const isOn = sw.state === 'on';
        commands.push({
          id: `ha-switch-${sw.entity_id}`,
          category: 'Smart Home',
          title: `Toggle ${sw.name || sw.entity_id}`,
          subtitle: `Currently ${sw.state} · ${sw.entity_id}`,
          icon: Power,
          color: isOn ? '#10b981' : '#64748b',
          action: () => {
            onExecuteHAService('switch', 'toggle', sw.entity_id);
            onClose();
          }
        });
      });

      // Locks
      (haCategories.locks || []).forEach(lock => {
        const isLocked = lock.state === 'locked';
        commands.push({
          id: `ha-lock-${lock.entity_id}`,
          category: 'Smart Home',
          title: `${isLocked ? 'Unlock' : 'Lock'} ${lock.name || lock.entity_id}`,
          subtitle: `Currently ${lock.state} · ${lock.entity_id}`,
          icon: Lock,
          color: isLocked ? '#22c55e' : '#f87171',
          action: () => {
            onExecuteHAService('lock', isLocked ? 'unlock' : 'lock', lock.entity_id);
            onClose();
          }
        });
      });
    }

    // 4. PortPal Active Ports Quick Kill Actions
    activePorts.forEach(portInfo => {
      if (!portInfo.isProtected) {
        commands.push({
          id: `port-kill-${portInfo.port}`,
          category: 'PortPal Dev Ops',
          title: `Release Port :${portInfo.port} (${portInfo.service})`,
          subtitle: `Terminate PID ${portInfo.pid} · ${portInfo.processName}`,
          icon: Power,
          color: '#f87171',
          action: async () => {
            await killPortProcess(portInfo.port);
            onClose();
          }
        });
      }
    });

    return commands;
  }, [haCategories, activePorts, onSelectView, onExecuteHAService, onClose]);

  // Filter commands by search query
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(c => 
      c.title.toLowerCase().includes(q) ||
      c.subtitle.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  }, [allCommands, query]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % (filteredCommands.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        } else if (query.trim() && onAskAloy) {
          // If no matching command, treat query as quick chat prompt to Aloy!
          onAskAloy(query.trim());
          onSelectView('chat');
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, query, onAskAloy, onSelectView, onClose]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex];
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(3, 6, 12, 0.75)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '12vh'
        }}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: -15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -15 }}
          transition={{ type: 'spring', damping: 30, stiffness: 400 }}
          style={{
            width: '100%',
            maxWidth: '620px',
            background: 'rgba(11, 15, 25, 0.96)',
            border: '1px solid rgba(0, 242, 254, 0.3)',
            borderRadius: '16px',
            boxShadow: '0 25px 60px -10px rgba(0, 0, 0, 0.9), 0 0 35px rgba(0, 242, 254, 0.12)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Search Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)'
          }}>
            <Search size={18} color="#00f2fe" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search studios, smart home devices, commands, or ask Aloy..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: '#f8fafc',
                fontSize: '0.95rem',
                fontWeight: 600,
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 6px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '0.65rem',
              color: '#94a3b8',
              fontWeight: 700
            }}>
              ESC
            </div>
          </div>

          {/* Results List */}
          <div
            ref={listRef}
            style={{
              maxHeight: '380px',
              overflowY: 'auto',
              padding: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}
          >
            {filteredCommands.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b' }}>
                <Command size={24} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>
                  No exact command match for "{query}"
                </div>
                <div style={{ fontSize: '0.75rem', marginTop: '4px', color: '#64748b' }}>
                  Press <span style={{ color: '#00f2fe', fontWeight: 700 }}>Enter ↵</span> to ask Aloy directly in chat.
                </div>
              </div>
            ) : (
              filteredCommands.map((cmd, idx) => {
                const isSelected = idx === selectedIndex;
                const IconComponent = cmd.icon || ArrowRight;

                return (
                  <div
                    key={cmd.id}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.6rem 0.85rem',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                      border: isSelected ? '1px solid rgba(0, 242, 254, 0.25)' : '1px solid transparent',
                      transition: 'all 0.1s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: `${cmd.color}15`,
                        border: `1px solid ${cmd.color}35`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: cmd.color,
                        flexShrink: 0
                      }}>
                        <IconComponent size={16} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          color: isSelected ? '#ffffff' : '#f1f5f9',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {cmd.title}
                        </div>
                        <div style={{
                          fontSize: '0.7rem',
                          color: isSelected ? '#94a3b8' : '#64748b',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {cmd.subtitle}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                      <span style={{
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        color: isSelected ? '#00f2fe' : '#64748b',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                      }}>
                        {cmd.category}
                      </span>
                      {isSelected && (
                        <ArrowRight size={13} color="#00f2fe" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Keyboard Hints */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.6rem 1.25rem',
            background: 'rgba(0, 0, 0, 0.4)',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.7rem',
            color: '#64748b'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span><strong style={{ color: '#cbd5e1' }}>↑↓</strong> Navigate</span>
              <span><strong style={{ color: '#cbd5e1' }}>↵</strong> Select</span>
              <span><strong style={{ color: '#cbd5e1' }}>Esc</strong> Close</span>
            </div>
            <div style={{ color: '#00f2fe', fontWeight: 600 }}>
              Aloy Spotlight
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
