import React from 'react';
import {
  Watch,
  Moon,
  Heart,
  Lock,
  Unlock,
  Lightbulb,
  CheckCircle2,
  Calendar,
  Zap,
  Activity,
  BatteryCharging
} from 'lucide-react';

/**
 * Parses message text to see if it contains structured health or smart home data,
 * and renders interactive micro-cards.
 */
export default function InteractiveWidget({ text, onExecuteHAService }) {
  if (!text || typeof text !== 'string') return null;

  // Every number in this card used to be a literal. The component tested the
  // reply text for the WORDS "Sleep Score", then rendered a fixed 89/100,
  // 8h 10m, 1h 55m and 45 bpm that were parsed from nothing — so any answer
  // mentioning sleep produced a confident, wrong wearable card. `text` was a
  // trigger, never a source.
  //
  // It is a source now. Each field is pulled out of the reply, and a tile is
  // only rendered if its value was actually found. If nothing parses, the card
  // does not appear at all.
  const num = (re) => {
    const m = text.match(re);
    return m ? m[1] : null;
  };
  const sleepScore   = num(/sleep score[^0-9]{0,15}(\d{1,3})/i);
  const restingHr    = num(/resting (?:heart rate|hr)[^0-9]{0,15}(\d{2,3})/i);
  const deepSleep    = num(/deep sleep[^0-9]{0,15}((?:\d+h\s*)?\d+\s*m(?:in)?|\d+(?:\.\d+)?\s*h(?:rs?)?)/i);
  const sleepTotal   = num(/sleep(?: duration| total)?[^0-9]{0,15}((?:\d+h\s*\d+m)|\d+(?:\.\d+)?\s*h(?:rs?)?)/i);
  const recovery     = num(/(?:recovery|readiness)[^A-Za-z]{0,15}(Optimal|Needs Rest|High Stress|Fair|Poor|Good)/i);

  const sleepTiles = [
    sleepScore && { label: 'Sleep Score', value: sleepScore, unit: '/100', sub: sleepTotal, subClass: 'text-emerald-400' },
    deepSleep  && { label: 'Deep Sleep',  value: deepSleep,  unit: '',     sub: null,       subClass: 'text-indigo-300' },
    restingHr  && { label: 'Resting HR',  value: restingHr,  unit: ' bpm', sub: null,       subClass: 'text-cyan-300' }
  ].filter(Boolean);

  const hasSleepPattern = sleepTiles.length > 0;
  const hasSmartHomePattern = /Lights:|Locks:|Thermostat Temp:|Security Locks:/i.test(text);

  if (!hasSleepPattern && !hasSmartHomePattern) return null;

  return (
    <div className="my-2.5 space-y-2 select-none">
      {/* 1. Sleep & Recovery Micro-Card — only the fields actually found */}
      {hasSleepPattern && (
        <div className="p-3 rounded-2xl bg-gradient-to-r from-slate-900/95 via-slate-900/90 to-indigo-950/40 border border-indigo-500/25 shadow-lg max-w-md">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200 mb-2">
            <span className="flex items-center gap-1.5">
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              Wearable Recovery Pulse
            </span>
            {/* Was an unconditional "Optimal Recovery" badge. */}
            {recovery && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono text-[10px]">
                {recovery}
              </span>
            )}
          </div>

          <div className={`grid gap-1.5 text-center grid-cols-${sleepTiles.length}`}>
            {sleepTiles.map((t) => (
              <div key={t.label} className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <div className="text-[10px] text-slate-400 font-medium">{t.label}</div>
                <div className="text-base font-bold text-slate-100 mt-0.5">
                  {t.value}<span className="text-[10px] text-slate-400 font-normal">{t.unit}</span>
                </div>
                {t.sub && <div className={`text-[9px] font-medium ${t.subClass}`}>{t.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Smart Home Quick Action Bar */}
      {hasSmartHomePattern && onExecuteHAService && (
        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700/60 shadow-md max-w-md">
          <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
            <span className="flex items-center gap-1 font-medium">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              Smart Home Quick Actions:
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onExecuteHAService('lock', 'lock', { entity_id: 'lock.front_door' })}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-all text-[11px] font-semibold"
            >
              <Lock className="w-3 h-3 text-emerald-400" />
              Lock Front Door
            </button>

            <button
              onClick={() => onExecuteHAService('light', 'turn_off', { entity_id: 'all' })}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-all text-[11px] font-medium"
            >
              <Lightbulb className="w-3 h-3 text-amber-400" />
              Turn Off Active Lights
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
