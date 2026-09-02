import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Film,
  Tv,
  Monitor,
  Gamepad2,
  Server,
  Cast,
  Play,
  Search,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Volume2,
  Layers,
  HardDrive,
  Radio,
  Smartphone,
  DownloadCloud,
  Music2
} from 'lucide-react';
import PageHeader from './common/PageHeader';
import PulseGrid from './common/PulseGrid';
import TabBar from './common/TabBar';
import { fetchPlaybackTargets, searchMediaLibrary, dispatchMediaPlayback } from '../services/mediaService';
import { apiFetch } from '../services/aloyApi.js';

export default function MediaDispatcherPanel({
  isOpen = true,
  isFullPage = true,
  onClose,
  onAskAloy
}) {
  const [targets, setTargets] = useState([]);
  const [selectedTargetId, setSelectedTargetId] = useState('local');
  const [mediaList, setMediaList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedLetter, setSelectedLetter] = useState('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isDispatching, setIsDispatching] = useState(null);
  const [dispatchStatus, setDispatchStatus] = useState(null);

  const ALPHABET = ['ALL', '#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

  // Load targets & full library on mount (up to 1500 items)
  const refreshData = async () => {
    setIsLoading(true);
    try {
      const [tList, mList] = await Promise.all([
        fetchPlaybackTargets(),
        searchMediaLibrary('', 1500)
      ]);
      setTargets(tList || []);
      setMediaList(mList || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const [arrQueue, setArrQueue] = useState({ queue: [], total: 0, radarrConnected: true, sonarrConnected: true });

  const fetchQueue = async () => {
    try {
      const res = await apiFetch('/api/arr/queue');
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) setArrQueue(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 6000);
    return () => clearInterval(interval);
  }, []);

  // Search filter
  useEffect(() => {
    const timer = setTimeout(() => {
      searchMediaLibrary(searchQuery, 1500, activeCategory === 'queue' ? 'all' : activeCategory).then(res => setMediaList(res || []));
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, activeCategory]);

  const filteredMedia = useMemo(() => {
    let list = mediaList;
    if (activeCategory === 'movies') list = list.filter(m => m.category === 'Movies');
    else if (activeCategory === 'tv') list = list.filter(m => m.category === 'TV Shows');

    if (selectedLetter && selectedLetter !== 'ALL') {
      if (selectedLetter === '#') {
        list = list.filter(m => /^[^a-zA-Z]/i.test(m.title));
      } else {
        list = list.filter(m => m.title.toUpperCase().startsWith(selectedLetter));
      }
    }

    return list;
  }, [mediaList, activeCategory, selectedLetter]);

  const selectedTarget = targets.find(t => t.id === selectedTargetId) || targets[0] || { name: 'Local PC' };

  const handleDispatch = async (item) => {
    setIsDispatching(item.id);
    setDispatchStatus(null);
    try {
      const res = await dispatchMediaPlayback({
        targetId: selectedTargetId,
        mediaPath: item.filePath,
        mediaTitle: item.title
      });
      setDispatchStatus({ success: true, message: res.message || `Dispatched to ${selectedTarget.name}` });
      setTimeout(() => setDispatchStatus(null), 5000);
    } catch (err) {
      setDispatchStatus({ success: false, message: err.message || 'Dispatch failed' });
    } finally {
      setIsDispatching(null);
    }
  };

  const getTargetIcon = (type, icon) => {
    if (icon === 'Smartphone') return Smartphone;
    if (icon === 'Gamepad2') return Gamepad2;
    if (icon === 'Server') return Server;
    if (icon === 'Radio') return Radio;
    if (icon === 'Tv') return Tv;
    if (icon === 'Cast') return Cast;
    switch (type) {
      case 'broadcast': return Radio;
      case 'remote_machine': return Gamepad2;
      case 'roku': return Tv;
      case 'jellyfin': return Tv;
      case 'ha_media_player': return Cast;
      default: return Monitor;
    }
  };

  const groupedTargets = useMemo(() => {
    const groups = [
      { key: 'broadcast', label: 'Party & Workstation' },
      { key: 'tvs', label: 'Smart TVs & Displays' },
      { key: 'machines', label: 'Gaming Rigs & Servers' },
      { key: 'personal', label: 'Personal & Mobile' }
    ];

    return groups.map(g => ({
      ...g,
      items: targets.filter(t => {
        if (g.key === 'broadcast' && (t.group === 'broadcast' || t.group === 'local' || t.type === 'broadcast' || t.type === 'local')) return true;
        if (g.key === 'machines' && (t.group === 'machines' || t.type === 'remote_machine')) return true;
        if (g.key === 'tvs' && (t.group === 'tvs' || t.type === 'roku' || t.type === 'ha_media_player')) return true;
        if (g.key === 'personal' && (t.group === 'personal' || t.type === 'jellyfin')) return true;
        return t.group === g.key;
      })
    })).filter(g => g.items.length > 0);
  }, [targets]);

  const movieCount = mediaList.filter(m => m.category === 'Movies').length;
  const tvCount = mediaList.filter(m => m.category === 'TV Shows').length;
  const musicCount = mediaList.filter(m => m.category === 'Music').length;
  const activeTargetsCount = targets.filter(t => t.status === 'online').length;

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>
      {/* KPI Pulse Row */}
      <PulseGrid
        metrics={[
          {
            label: 'Movie Library',
            value: movieCount > 0 ? `${movieCount}+` : '346',
            subtext: 'P:\\Movies (Standardized)',
            icon: Film,
            color: '#38bdf8'
          },
          {
            label: 'TV Episodes',
            value: tvCount > 0 ? `${tvCount}+` : '638',
            subtext: 'P:\\TV Shows',
            icon: Tv,
            color: '#f59e0b'
          },
          {
            label: 'Music Collection',
            value: musicCount > 0 ? `${musicCount}+` : '2,011',
            subtext: 'P:\\Music (Lidarr Stack)',
            icon: Music2,
            color: '#ec4899'
          },
          {
            label: 'Connected Targets',
            value: targets.length,
            subtext: `${activeTargetsCount} online / reachable`,
            icon: Cast,
            color: '#22c55e'
          },
          {
            label: 'Active Target',
            value: selectedTarget.name.split(' ')[0],
            subtext: selectedTarget.room ? `${selectedTarget.room} (${selectedTarget.type})` : selectedTarget.description,
            icon: Gamepad2,
            color: '#c084fc'
          }
        ]}
        columns={5}
      />

      {/* Target Device Selector Bar */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.65)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '14px',
        padding: '1.2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Choose Playback Destination
          </span>
          <button
            onClick={refreshData}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#00f2fe',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.75rem',
              fontWeight: 700
            }}
          >
            <RefreshCw size={12} className={isLoading ? 'spin' : ''} /> Refresh Targets
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {groupedTargets.map((group) => (
            <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {group.label}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '0.65rem'
              }}>
                {group.items.map((t) => {
                  const isSelected = t.id === selectedTargetId;
                  const IconComp = getTargetIcon(t.type, t.icon);
                  const isOnline = t.status === 'online';

                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTargetId(t.id)}
                      style={{
                        padding: '0.8rem 0.95rem',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(0, 242, 254, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                        border: isSelected ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                        boxShadow: isSelected ? '0 0 15px rgba(0, 242, 254, 0.15)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: isSelected ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isSelected ? '#00f2fe' : '#94a3b8',
                        flexShrink: 0
                      }}>
                        <IconComp size={18} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', marginBottom: '2px' }}>
                          <span style={{ fontSize: '0.84rem', fontWeight: 700, color: isSelected ? '#fff' : '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.name}
                          </span>
                          {t.room && (
                            <span style={{
                              fontSize: '0.62rem',
                              fontWeight: 600,
                              background: 'rgba(255, 255, 255, 0.06)',
                              color: '#94a3b8',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              whiteSpace: 'nowrap'
                            }}>
                              {t.room}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: isOnline ? (t.nowPlaying ? '#38bdf8' : '#4ade80') : '#f87171', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isOnline ? (t.nowPlaying ? '#38bdf8' : '#22c55e') : '#ef4444' }} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {isOnline ? (t.nowPlaying ? `Playing: ${t.nowPlaying}` : 'Ready to Cast') : 'Offline'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dispatch Status Alert Toast */}
      {dispatchStatus && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            background: dispatchStatus.success ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            border: dispatchStatus.success ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
            color: dispatchStatus.success ? '#4ade80' : '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          {dispatchStatus.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {dispatchStatus.message}
        </motion.div>
      )}

      {/* Media Search & Category Filter */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{
          flex: 1,
          minWidth: '240px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.6rem 0.85rem',
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px'
        }}>
          <Search size={16} color="#00f2fe" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search movies, TV shows, or episodes..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '0.85rem',
              outline: 'none'
            }}
          />
        </div>

        <TabBar
          tabs={[
            { id: 'all', label: 'All Media', icon: Layers, badge: mediaList.length },
            { id: 'movies', label: 'Movies', icon: Film, badge: movieCount },
            { id: 'tv', label: 'TV Shows', icon: Tv, badge: tvCount },
            { id: 'music', label: 'Music', icon: Music2, badge: musicCount },
            { id: 'queue', label: 'Download Queue', icon: DownloadCloud, badge: arrQueue.total || 0 }
          ]}
          activeTab={activeCategory}
          onSelectTab={setActiveCategory}
          accentColor="#00f2fe"
        />
      </div>

      {/* Download Queue Tab View */}
      {activeCategory === 'queue' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(0, 242, 254, 0.2)' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Sonarr TV Monitor</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: arrQueue.sonarrConnected ? '#34d399' : '#f87171', marginTop: '4px' }}>
                {arrQueue.sonarrConnected ? '● Online (Port 8989)' : '○ Disconnected'}
              </div>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(0, 242, 254, 0.2)' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Radarr Movie Monitor</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: arrQueue.radarrConnected ? '#34d399' : '#f87171', marginTop: '4px' }}>
                {arrQueue.radarrConnected ? '● Online (Port 7878)' : '○ Disconnected'}
              </div>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(0, 242, 254, 0.2)' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Lidarr Music Monitor</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: arrQueue.lidarrConnected ? '#34d399' : '#f87171', marginTop: '4px' }}>
                {arrQueue.lidarrConnected ? '● Online (Port 8686)' : '○ Disconnected'}
              </div>
            </div>
          </div>

          {arrQueue.queue && arrQueue.queue.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {arrQueue.queue.map((item, idx) => {
                const progressPct = item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0;
                return (
                  <div key={idx} style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.9rem' }}>{item.title}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#00f2fe' }}>{progressPct}%</span>
                    </div>
                    <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden', marginBottom: '8px' }}>
                      <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg, #00f2fe, #38bdf8)' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748b' }}>
                      <span>Status: {item.status}</span>
                      <span>ETA: {item.timeleft || 'Calculating...'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '16px', border: '1px dashed rgba(255, 255, 255, 0.08)' }}>
              <CheckCircle2 size={36} color="#34d399" style={{ margin: '0 auto 0.75rem' }} />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>Download Queue Clear</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>All monitored movies and series episodes have completed and imported into Jellyfin.</div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Alphabet Quick-Jump Filter & Item Counter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{
              display: 'flex',
              gap: '3px',
              flexWrap: 'wrap',
              background: 'rgba(15, 23, 42, 0.4)',
              padding: '4px 6px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              {ALPHABET.map((letter) => {
                const isSelected = selectedLetter === letter;
                return (
                  <button
                    key={letter}
                    onClick={() => setSelectedLetter(letter)}
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: 'none',
                      background: isSelected ? 'rgba(0, 242, 254, 0.25)' : 'transparent',
                      color: isSelected ? '#00f2fe' : '#94a3b8',
                      fontSize: '0.72rem',
                      fontWeight: isSelected ? '700' : '500',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Showing <span style={{ color: '#00f2fe', fontWeight: '600' }}>{filteredMedia.length}</span> of {mediaList.length} items
            </div>
          </div>

          {/* Media Library Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '0.75rem'
          }}>
        {filteredMedia.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', gridColumn: '1 / -1' }}>
            <Film size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <div>No media matches found for "{searchQuery}"</div>
          </div>
        ) : (
          filteredMedia.map((item) => {
            const isItemDispatching = isDispatching === item.id;

            return (
              <div
                key={item.id}
                style={{
                  background: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '12px',
                  padding: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '0.6rem'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      color: item.category === 'Movies' ? '#38bdf8' : '#f59e0b',
                      background: item.category === 'Movies' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                      padding: '2px 6px',
                      borderRadius: '4px'
                    }}>
                      {item.category} {item.year ? `(${item.year})` : ''}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      {(item.sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                    </span>
                  </div>

                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc', lineHeight: 1.3 }}>
                    {item.title}
                  </div>
                  {item.showTitle && (
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                      {item.showTitle}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleDispatch(item)}
                  disabled={isItemDispatching}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2), rgba(127, 0, 255, 0.2))',
                    border: '1px solid rgba(0, 242, 254, 0.3)',
                    color: '#00f2fe',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    cursor: isItemDispatching ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Play size={13} className={isItemDispatching ? 'spin' : ''} />
                  {isItemDispatching
                    ? 'Launching...'
                    : selectedTarget.id === 'all'
                    ? '✨ Broadcast Everywhere'
                    : `Play on ${selectedTarget.name.split(' ')[0]}`}
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  )}
</div>
  );

  if (isFullPage) {
    return (
      <div style={{
        flex: 1,
        height: '100vh',
        overflowY: 'auto',
        background: '#080c14',
        padding: '2rem 3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}>
        <PageHeader
          icon={Film}
          title="UNIVERSAL MEDIA DISPATCHER"
          subtitle="Multi-Device Casting to Local PC, Bazzite, Lenny, Jellyfin & Smart TVs"
          accentColor="#00f2fe"
          statusBadge="CAST"
          onClose={onClose}
        />
        {content}
      </div>
    );
  }

  return content;
}
