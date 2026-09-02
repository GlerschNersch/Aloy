import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Server,
  Hammer,
  RefreshCw,
  Trash2,
  Check,
  AlertCircle,
  Activity,
  Zap,
  Power,
  Radio
} from 'lucide-react';
import {
  pickProjectFolder,
  getGitStatus,
  checkPortOpen,
  runBuildCommand,
  listListeningPorts,
  killPortProcess
} from '../services/projectMonitor';

function formatRelativeTime(timestamp) {
  if (!timestamp) return null;
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ProjectsPanel({
  isOpen = true,
  onClose,
  projects,
  onAddProject,
  onRemoveProject,
  onUpdateProject,
  isFullPage = false
}) {
  const [liveStatus, setLiveStatus] = useState({});
  const [runningBuildId, setRunningBuildId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [listeningPorts, setListeningPorts] = useState([]);
  const [killingPort, setKillingPort] = useState(null);
  const [showPortDrawer, setShowPortDrawer] = useState(false);

  const refreshProject = useCallback(async (project) => {
    setLiveStatus(prev => ({ ...prev, [project.id]: { ...(prev[project.id] || {}), loading: true } }));
    const [git, portOpen] = await Promise.all([
      getGitStatus(project.folderPath),
      project.port ? checkPortOpen(project.port) : Promise.resolve(false)
    ]);
    setLiveStatus(prev => ({ ...prev, [project.id]: { git, portOpen, loading: false } }));
  }, []);

  const refreshAll = useCallback(async () => {
    projects.forEach(refreshProject);
    const ports = await listListeningPorts();
    setListeningPorts(ports || []);
  }, [projects, refreshProject]);

  const handleKillPort = async (port) => {
    if (!port) return;
    setKillingPort(port);
    try {
      await killPortProcess(port);
      await refreshAll();
    } finally {
      setKillingPort(null);
    }
  };

  // Refresh live status (git + port) whenever the panel is opened.
  useEffect(() => {
    if (isOpen || isFullPage) refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isFullPage]);

  const handleAddProject = async () => {
    setIsAdding(true);
    try {
      const folderPath = await pickProjectFolder();
      if (folderPath) {
        const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
        const project = { id: `proj-${Date.now()}`, name, folderPath, port: '', buildCommand: 'npm run build', lastBuild: null };
        onAddProject(project);
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleRunBuild = async (project) => {
    if (!project.buildCommand) return;
    setRunningBuildId(project.id);
    const start = Date.now();
    try {
      const result = await runBuildCommand(project.folderPath, project.buildCommand);
      const durationMs = Date.now() - start;
      const lastBuild = { success: result.success, error: result.error, timestamp: Date.now(), durationMs };
      onUpdateProject({ ...project, lastBuild });
    } finally {
      setRunningBuildId(null);
    }
  };

  const panelContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '1.25rem' }}>
            {/* Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '12px',
                  background: 'rgba(0, 242, 254, 0.15)',
                  border: '1px solid rgba(0, 242, 254, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00f2fe'
                }}>
                  <FolderGit2 size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                    Projects & Builds
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Local dev servers, git status & build checks
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={refreshAll}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '6px', borderRadius: '8px' }}
                  title="Refresh all projects"
                >
                  <RefreshCw size={18} />
                </button>
                {onClose && !isFullPage && (
                  <button
                    onClick={onClose}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '6px', borderRadius: '8px' }}
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            </div>

            {/* Add Project */}
            <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <button
                onClick={handleAddProject}
                disabled={isAdding}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  borderRadius: '10px',
                  background: 'rgba(0, 242, 254, 0.12)',
                  border: '1px solid rgba(0, 242, 254, 0.3)',
                  color: '#00f2fe',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: isAdding ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <FolderPlus size={16} /> {isAdding ? 'Choosing folder...' : 'Add Project Folder'}
              </button>
              {!window.electronAPI?.isElectron && (
                <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <AlertCircle size={13} /> Only available in the Desktop App.
                </div>
              )}
            </div>

            {/* Project Cards */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {projects.length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic', padding: '0.5rem', textAlign: 'center' }}>
                  No projects tracked yet. Add a folder to monitor its git status, dev server, and build health.
                </div>
              ) : (
                projects.map((project) => {
                  const status = liveStatus[project.id] || {};
                  const { git, portOpen, loading } = status;
                  const lastBuild = project.lastBuild;
                  const isBuilding = runningBuildId === project.id;

                  return (
                    <div
                      key={project.id}
                      className="glass-panel"
                      style={{
                        padding: '0.9rem 1.1rem',
                        borderRadius: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.6rem',
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.06)'
                      }}
                    >
                      {/* Name row */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f8fafc' }}>{project.name}</div>
                          <div style={{
                            fontSize: '0.72rem',
                            color: '#64748b',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {project.folderPath}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                          <button
                            onClick={() => refreshProject(project)}
                            title="Refresh status"
                            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                          >
                            <RefreshCw size={14} className={loading ? 'spin' : ''} />
                          </button>
                          <button
                            onClick={() => onRemoveProject(project.id)}
                            title="Remove project"
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Git status */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                        <GitBranch size={13} color={git?.isGitRepo ? '#00f2fe' : '#64748b'} />
                        {git?.isGitRepo ? (
                          <>
                            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{git.branch}</span>
                            {git.uncommittedCount > 0 ? (
                              <span style={{ color: '#fde047' }}>{git.uncommittedCount} uncommitted</span>
                            ) : (
                              <span style={{ color: '#4ade80' }}>clean</span>
                            )}
                            {git.ahead > 0 && <span style={{ color: '#c084fc' }}>↑{git.ahead}</span>}
                            {git.behind > 0 && <span style={{ color: '#f87171' }}>↓{git.behind}</span>}
                          </>
                        ) : (
                          <span style={{ color: '#64748b' }}>{git === undefined ? 'Checking...' : 'Not a git repo'}</span>
                        )}
                      </div>

                      {/* Dev server / port */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                          <Server size={13} color={portOpen ? '#4ade80' : '#64748b'} />
                          <span style={{ color: '#94a3b8' }}>Port</span>
                          <input
                            type="number"
                            value={project.port}
                            onChange={(e) => onUpdateProject(project.id, { port: e.target.value })}
                            placeholder="5173"
                            autoComplete="off"
                            className="glass-input"
                            style={{ width: '64px', padding: '2px 6px', borderRadius: '6px', fontSize: '0.75rem' }}
                          />
                          {project.port && (
                            <span style={{
                              color: portOpen ? '#4ade80' : '#f87171',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}>
                              {portOpen ? (() => {
                                const portInfo = listeningPorts.find(p => p.port === Number(project.port));
                                return portInfo ? `${portInfo.processName} (PID ${portInfo.pid})` : 'Running';
                              })() : 'Not running'}
                            </span>
                          )}
                        </div>
                        {portOpen && project.port && (
                          <button
                            onClick={() => handleKillPort(project.port)}
                            disabled={killingPort === project.port}
                            title="Kill Process & Release Port"
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              color: '#f87171',
                              borderRadius: '6px',
                              padding: '2px 7px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              flexShrink: 0
                            }}
                          >
                            <Power size={11} className={killingPort === project.port ? 'spin' : ''} />
                            {killingPort === project.port ? 'Releasing...' : 'Release Port'}
                          </button>
                        )}
                      </div>

                      {/* Live status URL — fed into chat context when this
                          project is mentioned (see App.jsx handleSendMessage) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Activity size={13} color={project.statusUrl ? '#00f2fe' : '#64748b'} />
                        <input
                          type="text"
                          value={project.statusUrl || ''}
                          onChange={(e) => onUpdateProject(project.id, { statusUrl: e.target.value })}
                          placeholder="Status URL (e.g. http://127.0.0.1:5000/api/status)"
                          autoComplete="off"
                          className="glass-input"
                          style={{ flex: 1, padding: '5px 8px', borderRadius: '8px', fontSize: '0.72rem' }}
                        />
                      </div>

                      {/* Build command + run */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="text"
                          value={project.buildCommand}
                          onChange={(e) => onUpdateProject(project.id, { buildCommand: e.target.value })}
                          autoComplete="off"
                          className="glass-input"
                          style={{ flex: 1, padding: '5px 8px', borderRadius: '8px', fontSize: '0.78rem' }}
                        />
                        <button
                          onClick={() => handleRunBuild(project)}
                          disabled={isBuilding}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'rgba(0, 242, 254, 0.15)',
                            color: '#00f2fe',
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            cursor: isBuilding ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <Hammer size={13} className={isBuilding ? 'spin' : ''} /> {isBuilding ? 'Running' : 'Run Build'}
                        </button>
                      </div>

                      {/* Last build result */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                        {lastBuild ? (
                          <>
                            {lastBuild.success ? <Check size={13} color="#4ade80" /> : <AlertCircle size={13} color="#f87171" />}
                            <span style={{ color: lastBuild.success ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                              {lastBuild.success ? 'Passed' : 'Failed'}
                            </span>
                            <span style={{ color: '#64748b' }}>
                              · {formatRelativeTime(lastBuild.timestamp)} · {(lastBuild.durationMs / 1000).toFixed(1)}s
                            </span>
                          </>
                        ) : (
                          <span style={{ color: '#64748b' }}>Never run</span>
                        )}
                      </div>
                      {lastBuild && !lastBuild.success && lastBuild.error && (
                        <div style={{
                          fontSize: '0.7rem',
                          color: '#f87171',
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: '8px',
                          padding: '0.5rem',
                          maxHeight: '80px',
                          overflowY: 'auto',
                          fontFamily: 'var(--font-mono)',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {lastBuild.error}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* PortPal Active Ports Sentinel */}
            <div style={{
              marginTop: '1.25rem',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '0.85rem'
            }}>
              <div
                onClick={() => setShowPortDrawer(prev => !prev)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Radio size={14} color="#38bdf8" />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9' }}>
                    Active Network Ports ({listeningPorts.length})
                  </span>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 600 }}>
                  {showPortDrawer ? 'Hide Ports' : 'Inspect Ports'}
                </span>
              </div>

              {showPortDrawer && (
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {listeningPorts.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>No active listening ports detected.</div>
                  ) : (
                    listeningPorts.map((lp) => (
                      <div
                        key={`${lp.port}-${lp.pid}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: 'rgba(0, 0, 0, 0.3)',
                          padding: '0.35rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8', fontWeight: 700 }}>
                            :{lp.port}
                          </span>
                          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{lp.service}</span>
                          <span style={{ color: '#64748b' }}>PID {lp.pid} ({lp.processName})</span>
                        </div>
                        {!lp.isProtected && (
                          <button
                            onClick={() => handleKillPort(lp.port)}
                            disabled={killingPort === lp.port}
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              color: '#f87171',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                          >
                            {killingPort === lp.port ? 'Killing...' : 'Kill'}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
    </div>
  );

  if (isFullPage || !onClose) {
    return (
      <div style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}>
        {panelContent}
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'flex-end',
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="glass-panel"
          style={{
            width: '460px',
            maxWidth: '90vw',
            height: '100%',
            background: 'rgba(11, 15, 25, 0.98)',
            borderLeft: '1px solid rgba(0, 242, 254, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-10px 0 50px rgba(0, 0, 0, 0.9)'
          }}
        >
          {panelContent}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
