import React from 'react';
import { Newspaper, Settings2, RefreshCw, Plus, X } from 'lucide-react';

export default function NewsSection({
  newsArticles = [],
  newsSources = [],
  newsInterests = [],
  isNewsRefreshing = false,
  newsSettingsOpen = false,
  setNewsSettingsOpen,
  newSourceUrl = '',
  setNewSourceUrl,
  newSourceName = '',
  setNewSourceName,
  newsInterestsInput = '',
  setNewsInterestsInput,
  onRefreshNews,
  onAddNewsSource,
  onRemoveNewsSource,
  onSaveNewsInterests,
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
            <Newspaper size={16} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Curated Intelligence & Feeds
            </h3>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
              Personalized tech, AI, and developer feeds
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setNewsSettingsOpen(!newsSettingsOpen)}
            style={{
              background: newsSettingsOpen ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: newsSettingsOpen ? '#00f2fe' : '#94a3b8',
              padding: '6px 10px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Settings2 size={13} />
            Sources
          </button>
          <button
            onClick={onRefreshNews}
            disabled={isNewsRefreshing}
            style={{
              background: 'rgba(0, 242, 254, 0.1)',
              border: '1px solid rgba(0, 242, 254, 0.3)',
              color: '#00f2fe',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <RefreshCw size={13} className={isNewsRefreshing ? 'spin' : ''} />
            {isNewsRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* News Settings Drawer */}
      {newsSettingsOpen && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '1rem',
            borderRadius: '12px',
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 700 }}>
              SOURCES
            </div>
            {newsSources.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.35rem 0',
                }}
              >
                <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>{s.name || s.url}</span>
                <button
                  onClick={() => onRemoveNewsSource(s.id)}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
              <input
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                placeholder="https://example.com"
                style={{
                  flex: 2,
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#f1f5f9',
                }}
              />
              <input
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="Name (optional)"
                style={{
                  flex: 1,
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#f1f5f9',
                }}
              />
              <button
                onClick={onAddNewsSource}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(0,242,254,0.3)',
                  background: 'rgba(0,242,254,0.1)',
                  color: '#38bdf8',
                  cursor: 'pointer',
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 700 }}>
              INTERESTS (comma-separated)
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                value={newsInterestsInput}
                onChange={(e) => setNewsInterestsInput(e.target.value)}
                placeholder="e.g. AI/LLM engineering, GPU hardware, open source"
                style={{
                  flex: 1,
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#f1f5f9',
                }}
              />
              <button
                onClick={onSaveNewsInterests}
                style={{
                  padding: '0.4rem 0.8rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(0,242,254,0.3)',
                  background: 'rgba(0,242,254,0.1)',
                  color: '#38bdf8',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {newsArticles.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
            maxHeight: '260px',
            overflowY: 'auto',
          }}
        >
          {newsArticles.slice(0, 12).map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {a.sourceType === 'youtube' && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      color: '#f87171',
                      background: 'rgba(248, 113, 113, 0.12)',
                      padding: '1px 6px',
                      borderRadius: '5px',
                      flexShrink: 0,
                    }}
                  >
                    ▶ VIDEO
                  </span>
                )}
                {a.title}
              </span>
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                {a.sourceName}
                {a.relevanceReason ? ` — ${a.relevanceReason}` : ''}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '0.75rem' }}>
          {newsSources.length === 0
            ? 'No sources configured yet — add one above to get started.'
            : 'No articles yet — click Refresh or wait for the next scheduled scrape.'}
        </div>
      )}
    </div>
  );
}
