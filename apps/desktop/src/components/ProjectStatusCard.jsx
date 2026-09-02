import React from 'react';
import { Disc3, CheckCircle2, Circle, Loader2 } from 'lucide-react';

// Renders a structured "live process" card from parsed project-status data
// (see services/projectMonitor.js#parseProjectStatusSummary) — deliberately
// built from actual fetched fields rather than the model's prose, so the
// numbers/labels shown are always accurate regardless of what the LLM said.
export default function ProjectStatusCard({ name, summary }) {
  if (!summary) return null;
  const { statusMessage, progressPct, step, lastCompleted } = summary;

  const lowerMsg = (statusMessage || '').toLowerCase();
  const isDone = progressPct === 100 || /\b(complete|finished|ready|success)\b/.test(lowerMsg);
  const isActive = !isDone && (progressPct !== null || step !== null);

  const badge = isDone
    ? { label: 'DONE', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.35)' }
    : isActive
      ? { label: 'RUNNING', color: '#00f2fe', bg: 'rgba(0, 242, 254, 0.12)', border: 'rgba(0, 242, 254, 0.35)' }
      : { label: 'IDLE', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.25)' };

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: '16px',
        padding: '1rem 1.1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        marginBottom: '0.75rem',
        maxWidth: '420px',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      {/* Header: project name + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Disc3 size={16} color="#00f2fe" />
          <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f8fafc' }}>{name}</span>
        </div>
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          fontSize: '0.68rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: badge.color,
          background: badge.bg,
          border: `1px solid ${badge.border}`,
          padding: '2px 9px',
          borderRadius: '20px'
        }}>
          {isActive && <Loader2 size={10} className="spin" />}
          {badge.label}
        </span>
      </div>

      {/* Step indicator */}
      {step && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            {Array.from({ length: step.total }, (_, i) => i + 1).map((n) => (
              n < step.current
                ? <CheckCircle2 key={n} size={13} color="#4ade80" />
                : n === step.current
                  ? <Loader2 key={n} size={13} color="#00f2fe" className="spin" />
                  : <Circle key={n} size={13} color="#475569" />
            ))}
          </div>
          <span>Step {step.current}/{step.total} · {step.label}</span>
        </div>
      )}

      {/* Progress bar */}
      {progressPct !== null && (
        <div>
          <div style={{
            width: '100%',
            height: '7px',
            borderRadius: '20px',
            background: 'rgba(255, 255, 255, 0.06)',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${Math.max(0, Math.min(100, progressPct))}%`,
              height: '100%',
              borderRadius: '20px',
              background: isDone
                ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                : 'linear-gradient(90deg, #00f2fe, #7f00ff)',
              transition: 'width 0.4s ease'
            }} />
          </div>
          <div style={{ marginTop: '4px', fontSize: '0.72rem', color: '#64748b' }}>
            {progressPct}% complete
          </div>
        </div>
      )}

      {/* Status message caption */}
      {statusMessage && (
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4 }}>
          {statusMessage}
        </div>
      )}

      {/* Last completed metadata */}
      {lastCompleted && (
        <div style={{
          fontSize: '0.72rem',
          color: '#64748b',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          paddingTop: '0.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          <span style={{ color: '#94a3b8', fontWeight: 600 }}>Last completed</span>
          <span>
            {lastCompleted.disc_label || lastCompleted.name || lastCompleted.title || JSON.stringify(lastCompleted).slice(0, 60)}
            {lastCompleted.episodes_saved ? ` · ${lastCompleted.episodes_saved} episode(s)` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
