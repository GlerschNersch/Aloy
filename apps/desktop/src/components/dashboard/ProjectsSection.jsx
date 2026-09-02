import React from 'react';
import { FolderGit2, ArrowRight, Disc3 } from 'lucide-react';

export default function ProjectsSection({
  projectLiveStatus = {},
  trackedProjects = [],
  onOpenProjectsPanel,
}) {
  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: '20px',
        padding: '1.5rem',
        background: 'rgba(15, 21, 35, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: 'rgba(0, 242, 254, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#00f2fe',
            }}
          >
            <FolderGit2 size={16} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Tracked Projects & Pipelines
            </h3>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
              AutoRip disc monitoring, Git branches, and build health
            </p>
          </div>
        </div>

        <button
          onClick={onOpenProjectsPanel}
          style={{
            background: 'rgba(0, 242, 254, 0.08)',
            border: '1px solid rgba(0, 242, 254, 0.25)',
            color: '#00f2fe',
            padding: '4px 10px',
            borderRadius: '8px',
            fontSize: '0.75rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          Manage Projects <ArrowRight size={12} />
        </button>
      </div>

      {/* Live Status Cards */}
      {projectLiveStatus && Object.keys(projectLiveStatus).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          {Object.entries(projectLiveStatus).map(([name, summary]) => {
            const stepLabel = summary.step
              ? `${summary.step.label}${summary.step.total ? ` ${summary.step.current}/${summary.step.total}` : ''}`
              : summary.statusMessage;
            return (
              <div
                key={name}
                style={{
                  padding: '0.9rem 1.1rem',
                  borderRadius: '14px',
                  background: 'rgba(0, 242, 254, 0.05)',
                  border: '1px solid rgba(0, 242, 254, 0.25)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Disc3 size={16} color="#00f2fe" className={summary.progressPct != null ? 'spin' : ''} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }}>{name}</span>
                  </div>
                  {typeof summary.progressPct === 'number' && (
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#00f2fe' }}>
                      {summary.progressPct}%
                    </span>
                  )}
                </div>
                {stepLabel && (
                  <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: '6px' }}>{stepLabel}</div>
                )}
                {typeof summary.progressPct === 'number' && (
                  <div
                    style={{
                      height: '6px',
                      borderRadius: '3px',
                      background: '#0c111c',
                      marginTop: '8px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${summary.progressPct}%`,
                        background: 'linear-gradient(90deg, #00f2fe, #4facfe)',
                        borderRadius: '3px',
                      }}
                    />
                  </div>
                )}
                {summary.lastCompleted?.disc_label && (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                    Last: {summary.lastCompleted.disc_label} ({summary.lastCompleted.episodes_saved || 0} episodes)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tracked Projects List */}
      {trackedProjects && trackedProjects.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
          {trackedProjects.map((p) => (
            <div
              key={p.id || p.path}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>{p.name}</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Branch: {p.branch || 'main'}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '0.75rem' }}>
          No active projects tracked. Click Manage Projects to link a repository or AutoRip workspace.
        </div>
      )}
    </div>
  );
}
