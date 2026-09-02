import React, { useState, useEffect } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  Watch,
  Sun,
  Lock,
  Unlock,
  Lightbulb,
  Calendar,
  Layers,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Activity,
  Heart,
  Moon,
  Zap,
  Clock,
  Compass
} from 'lucide-react';
import { apiFetch } from '../services/aloyApi.js';

export default function ContextCanvas({
  isOpen = true,
  onClose = null,
  activeTab = 'health',
  onSelectTab = null,
  haCategories = null,
  onExecuteHAService = null,
  trackedProjects = [],
  onAskAloy = null
}) {
  const [tab, setTab] = useState(activeTab);
  const [healthData, setHealthData] = useState(null);
  const [briefingMarkdown, setBriefingMarkdown] = useState('');
  const [isLoadingBrief, setIsLoadingBrief] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (activeTab) setTab(activeTab);
  }, [activeTab]);

  // Fetch health data
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await apiFetch('/api/health/summary');
        if (res.ok) {
          const data = await res.json();
          setHealthData(data.summary);
        }
      } catch {}
    };
    fetchHealth();
  }, []);

  // Fetch or synthesize briefing
  const loadBriefing = async () => {
    setIsLoadingBrief(true);
    try {
      const res = await apiFetch('/api/hermes/daily-brief');
      if (res.ok) {
        const data = await res.json();
        setBriefingMarkdown(data.briefing?.markdown || '');
      }
    } catch {}
    setIsLoadingBrief(false);
  };

  useEffect(() => {
    if (tab === 'briefing' && !briefingMarkdown) {
      loadBriefing();
    }
  }, [tab]);

  if (!isOpen) return null;

  const lights = haCategories?.lights || [];
  const locks = haCategories?.locks || [];
  const onLights = lights.filter(l => l.state === 'on');
  const unlockedLocks = locks.filter(l => l.state === 'unlocked');

  return (
    <aside className={`flex flex-col border-l border-slate-800/80 bg-slate-950/70 backdrop-blur-2xl transition-all duration-300 z-30 shadow-2xl ${
      isExpanded ? 'w-[640px]' : 'w-[380px]'
    }`}>
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800/80 bg-slate-900/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-semibold text-xs tracking-wider uppercase text-slate-200">Context Canvas</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
            title={isExpanded ? 'Collapse width' : 'Expand width'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors"
              title="Close Canvas"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation Pills */}
      <div className="flex items-center gap-1 p-2 border-b border-slate-800/60 overflow-x-auto no-scrollbar">
        {[
          { id: 'health', label: 'Watch & Vitals', icon: Watch, color: 'text-emerald-400' },
          { id: 'briefing', label: 'Morning Brief', icon: Sun, color: 'text-amber-400' },
          { id: 'smarthome', label: 'Smart Home', icon: Lock, color: 'text-cyan-400' },
          { id: 'projects', label: 'Projects', icon: Layers, color: 'text-purple-400' }
        ].map(item => {
          const Icon = item.icon;
          const isSelected = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                if (onSelectTab) onSelectTab(item.id);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${item.color}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Container */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs text-slate-300">
        
        {/* 1. HEALTH & WEARABLES */}
        {tab === 'health' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Big Sleep & Readiness Card */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-indigo-950/40 border border-indigo-500/20 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  Last Night's Sleep Architecture
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                  {healthData?.recoveryState ?? '—'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2.5">
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">Sleep Score</div>
                  <div className="text-xl font-black text-slate-100 mt-0.5">{healthData?.sleepScore ?? '—'}<span className="text-xs text-slate-400 font-normal">/100</span></div>
                  <div className="text-[10px] text-emerald-400 font-medium">{healthData?.sleepDurationHours != null ? `${healthData.sleepDurationHours}h total sleep` : 'Sleep duration not recorded'}</div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">Resting HR</div>
                  <div className="text-xl font-black text-slate-100 mt-0.5">{healthData?.restingHeartRate ?? '—'} <span className="text-xs text-slate-400 font-normal">bpm</span></div>
                  <div className="text-[10px] text-cyan-400 font-medium">{healthData?.restingHeartRate != null ? 'Resting HR baseline' : 'No baseline recorded'}</div>
                </div>
              </div>

              <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <span>Deep Sleep: <b className="text-slate-200">{healthData?.deepSleepMinutes != null ? `${healthData.deepSleepMinutes} min` : '—'}</b></span>
                <span>Watch Battery: <b className="text-emerald-400">{healthData?.batteryLevel ?? '—'}%</b></span>
              </div>
            </div>

            {/* Daily Activity Card */}
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between font-semibold text-slate-200">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Today's Activity
                </span>
                <span className="font-mono text-cyan-400">{healthData?.steps != null ? healthData.steps.toLocaleString() : '—'} steps</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full" style={{ width: `${Math.min(100, ((healthData?.steps ?? '—') / 10000) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Goal: 10,000 steps</span>
                <span>{(healthData?.activeCalories ?? '—')} kcal burned</span>
              </div>
            </div>
          </div>
        )}

        {/* 2. MORNING BRIEFING */}
        {tab === 'briefing' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Sun className="w-4 h-4 text-amber-400" />
                Hermes Operations Pulse
              </span>
              <button
                onClick={loadBriefing}
                disabled={isLoadingBrief}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors text-[11px]"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingBrief ? 'animate-spin text-amber-400' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {briefingMarkdown ? (
              <div className="prose prose-invert prose-xs max-w-none p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 leading-relaxed text-slate-300 whitespace-pre-wrap">
                {briefingMarkdown}
              </div>
            ) : (
              <div className="p-4 text-center text-slate-500">
                {isLoadingBrief ? 'Synthesizing morning operations briefing...' : 'Click refresh to synthesize today\'s briefing.'}
              </div>
            )}
          </div>
        )}

        {/* 3. SMART HOME CONTROLS */}
        {tab === 'smarthome' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between font-semibold text-slate-200">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-cyan-400" />
                  Security Locks
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${unlockedLocks.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                  {unlockedLocks.length > 0 ? `${unlockedLocks.length} Unlocked` : 'All Locked'}
                </span>
              </div>
              <div className="space-y-1">
                {locks.map(lock => {
                  const isUnlocked = lock.state === 'unlocked';
                  return (
                    <div key={lock.entity_id} className="flex items-center justify-between p-1.5 rounded-lg bg-slate-950/60 text-[11px]">
                      <span className="truncate max-w-[180px]">{lock.attributes?.friendly_name || lock.entity_id}</span>
                      {/* The label used to read `isUnlocked ? 'Unlock' : 'Locked'`
                          while the action sent `isUnlocked ? 'lock' : 'unlock'`.
                          A locked door therefore rendered a reassuring green
                          button reading "Locked", and pressing it unlocked the
                          house. Both halves now describe the same thing: the
                          button always states the action it will perform. */}
                      <button
                        onClick={() => onExecuteHAService && onExecuteHAService('lock', isUnlocked ? 'lock' : 'unlock', { entity_id: lock.entity_id })}
                        title={isUnlocked ? 'Currently unlocked. Press to lock.' : 'Currently locked. Press to unlock.'}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                          isUnlocked ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-slate-500/20 text-slate-300 hover:bg-slate-500/30'
                        }`}
                      >
                        {isUnlocked ? 'Lock it' : 'Unlock it'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                Active Lights ({onLights.length} ON)
              </span>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {onLights.map(light => (
                  <div key={light.entity_id} className="flex items-center justify-between p-1.5 rounded-lg bg-slate-950/60 text-[11px]">
                    <span className="truncate max-w-[180px]">{light.attributes?.friendly_name || light.entity_id}</span>
                    <button
                      onClick={() => onExecuteHAService && onExecuteHAService('light', 'turn_off', { entity_id: light.entity_id })}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                    >
                      Turn Off
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4. TRACKED PROJECTS */}
        {tab === 'projects' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between font-semibold text-slate-200">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                Tracked Projects & Builds
              </span>
            </div>
            {trackedProjects && trackedProjects.length > 0 ? (
              trackedProjects.map((p, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">{p.name || p.title}</span>
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono">{p.status ?? '—'}</span>
                  </div>
                  {p.description && <p className="text-slate-400 text-[11px]">{p.description}</p>}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-slate-500">
                No active projects tracked. Add repositories or build pipelines in the Dev Workspace.
              </div>
            )}
          </div>
        )}

      </div>
    </aside>
  );
}
