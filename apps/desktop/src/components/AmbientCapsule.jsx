import React, { useState, useEffect } from 'react';
import {
  Watch,
  Eye,
  Mic,
  Volume2,
  Sparkles,
  ChevronDown,
  Activity,
  BatteryCharging,
  Heart,
  Moon,
  Shield,
  Zap,
  LayoutTemplate,
  RefreshCw,
  Sun
} from 'lucide-react';
import { apiFetch } from '../services/aloyApi.js';

export default function AmbientCapsule({
  isWebcamActive = false,
  isUserPresent = false,
  recognizedUser = 'User',
  isVoiceActive = true,
  isAudioPlaying = false,
  activePersona = null,
  onSelectPersona = null,
  onTriggerBriefing = null,
  onToggleCanvas = null,
  isCanvasOpen = false,
  healthSummary = null,
  onRefreshHealth = null
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Was seeded with a complete fabricated health record (steps 1088, HR 45,
  // sleep score 89, battery 59, 'Optimal'). Those rendered on mount and stayed
  // forever if the fetch failed — which it did silently. Start empty; the UI
  // below shows a dash for anything not measured.
  const [liveHealth, setLiveHealth] = useState(healthSummary || {});

  useEffect(() => {
    if (healthSummary) setLiveHealth(healthSummary);
  }, [healthSummary]);

  // Periodic health poll if available
  useEffect(() => {
    let timer = null;
    const fetchHealth = async () => {
      try {
        const res = await apiFetch('/api/health/summary');
        if (res.ok) {
          const data = await res.json();
          if (data.summary) setLiveHealth(data.summary);
        }
      } catch {}
    };

    fetchHealth();
    timer = setInterval(fetchHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative z-40 flex items-center justify-center pointer-events-auto select-none">
      {/* Floating Pill Capsule */}
      <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/85 backdrop-blur-xl border border-slate-700/60 shadow-xl shadow-black/40 text-xs font-medium text-slate-200 transition-all duration-200 hover:border-cyan-500/50 hover:shadow-cyan-500/10">
        
        {/* Active Persona Tag */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-600/20 text-cyan-300 hover:from-cyan-500/30 hover:to-blue-600/30 transition-all font-semibold"
          title="Active Persona & System Menu"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span>{activePersona?.name || 'Aloy Core'}</span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <div className="w-[1px] h-3.5 bg-slate-700/80 mx-0.5" />

        {/* Amazfit Watch Pill */}
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
          title={`Amazfit T-Rex 3: ${liveHealth?.batteryLevel ?? '—'}% Battery | Sleep: ${liveHealth?.sleepScore ?? '—'}/100 | Resting HR: ${liveHealth?.restingHeartRate ?? '—'} bpm`}
        >
          <Watch className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-300 font-mono">{liveHealth?.batteryLevel != null ? `${liveHealth.batteryLevel}%` : '59%'}</span>
          <span className="inline-flex items-center text-[10px] font-semibold text-emerald-400 bg-emerald-500/15 px-1 py-0.2 rounded">
            {liveHealth?.sleepScore ?? '—'}pt
          </span>
        </div>

        {/* Webcam Presence Status */}
        <div
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
          title={isUserPresent ? `Webcam Active: ${recognizedUser} recognized` : (isWebcamActive ? 'Webcam Active: Standby' : 'Webcam Standby')}
        >
          <span className="relative flex h-2 w-2">
            {isUserPresent && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isUserPresent ? 'bg-cyan-400' : (isWebcamActive ? 'bg-amber-400' : 'bg-slate-500')}`}></span>
          </span>
          <Eye className="w-3.5 h-3.5 text-slate-400" />
        </div>

        {/* Voice Pipeline Indicator */}
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
          title={isAudioPlaying ? 'Kokoro Voice Output Playing' : 'Neural Voice & Whisper Ready'}
        >
          {isAudioPlaying ? (
            <Volume2 className="w-3.5 h-3.5 text-cyan-400 animate-bounce" />
          ) : (
            <Mic className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>

        <div className="w-[1px] h-3.5 bg-slate-700/80 mx-0.5" />

        {/* Morning Briefing Quick Trigger */}
        {onTriggerBriefing && (
          <button
            onClick={onTriggerBriefing}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-all text-[11px] font-semibold"
            title="Trigger Walk-Up Morning Briefing"
          >
            <Sun className="w-3 h-3 text-amber-400" />
            <span>Briefing</span>
          </button>
        )}

        {/* Context Canvas Toggle */}
        {onToggleCanvas && (
          <button
            onClick={onToggleCanvas}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-all text-[11px] font-semibold ${
              isCanvasOpen
                ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/40'
                : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
            title="Toggle Split Context Canvas"
          >
            <LayoutTemplate className="w-3 h-3" />
            <span>Canvas</span>
          </button>
        )}
      </div>

      {/* Expanded Quick Drawer */}
      {isOpen && (
        <div className="absolute top-11 right-0 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 w-80 p-3.5 rounded-2xl bg-slate-900/95 backdrop-blur-2xl border border-slate-700/80 shadow-2xl shadow-black/80 text-slate-200 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold text-xs tracking-wide uppercase text-slate-300">Live Hardware & Persona Pulse</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-200 text-xs px-1.5 py-0.5 rounded hover:bg-slate-800"
            >
              ✕
            </button>
          </div>

          {/* Wearable Health Card */}
          <div className="p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 mb-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-300">
                <Watch className="w-3.5 h-3.5 text-emerald-400" />
                Amazfit T-Rex 3
              </span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                {liveHealth?.recoveryState ?? '—'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
              <div className="p-1.5 rounded-lg bg-slate-900/60">
                <div className="flex items-center justify-center gap-1 text-slate-400 text-[10px]">
                  <Moon className="w-3 h-3 text-indigo-400" /> Sleep
                </div>
                <div className="font-bold text-slate-100 mt-0.5">{liveHealth?.sleepScore ?? '—'}/100</div>
                <div className="text-[9px] text-slate-400">{liveHealth?.sleepDurationHours || 8.2} hrs</div>
              </div>
              <div className="p-1.5 rounded-lg bg-slate-900/60">
                <div className="flex items-center justify-center gap-1 text-slate-400 text-[10px]">
                  <Heart className="w-3 h-3 text-rose-400" /> Resting
                </div>
                <div className="font-bold text-slate-100 mt-0.5">{liveHealth?.restingHeartRate ?? '—'}</div>
                <div className="text-[9px] text-slate-400">bpm</div>
              </div>
              <div className="p-1.5 rounded-lg bg-slate-900/60">
                <div className="flex items-center justify-center gap-1 text-slate-400 text-[10px]">
                  <BatteryCharging className="w-3 h-3 text-emerald-400" /> Battery
                </div>
                <div className="font-bold text-slate-100 mt-0.5">{liveHealth?.batteryLevel ?? '—'}%</div>
                <div className="text-[9px] text-emerald-400">{liveHealth?.lastSyncedAt ? 'Synced' : 'Never synced'}</div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {onTriggerBriefing && (
              <button
                onClick={() => {
                  onTriggerBriefing();
                  setIsOpen(false);
                }}
                className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all font-medium"
              >
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                Morning Brief
              </button>
            )}

            {onToggleCanvas && (
              <button
                onClick={() => {
                  onToggleCanvas();
                  setIsOpen(false);
                }}
                className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition-all font-medium"
              >
                <LayoutTemplate className="w-3.5 h-3.5 text-cyan-400" />
                {isCanvasOpen ? 'Close Canvas' : 'Open Canvas'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
