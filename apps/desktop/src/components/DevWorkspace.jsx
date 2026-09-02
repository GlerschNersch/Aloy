import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Code2, Plus, MessageSquare, Check, Trash2, ChevronDown, ChevronRight, Bot, User, Flame, ShieldAlert, RotateCcw, Play, CheckCircle2, AlertTriangle, FolderGit2, Sparkles, Activity, Layers, RefreshCw } from 'lucide-react';
import ProjectsPanel from './ProjectsPanel.jsx';
import { apiFetch } from '../services/aloyApi.js';
import { PageHeader, TabBar, PulseGrid, EmptyState } from './common';

export default function DevWorkspace({
  isOpen = true,
  onClose,
  onAskAloy,
  isFullPage = false,
  initialTab = 'cauldron',
  projects = [],
  onAddProject,
  onRemoveProject,
  onUpdateProject
}) {
  const [activeTab, setActiveTab] = useState(initialTab || 'cauldron'); // 'cauldron' | 'deployments' | 'backlog' | 'projects'

  // Hephaestus State
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [trainingStats, setTrainingStats] = useState(null);
  const [taskFilter, setTaskFilter] = useState('active'); // 'active' | 'all' | 'expired'
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('feature');
  const [newDesc, setNewDesc] = useState('');
  const [newTargetFiles, setNewTargetFiles] = useState('');
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Backlog State
  const [ideas, setIdeas] = useState(null);
  const [available, setAvailable] = useState(true);
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaDescription, setIdeaDescription] = useState('');
  const [ideaTargetFile, setIdeaTargetFile] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const loadHephaestus = async () => {
    setIsRefreshing(true);
    try {
      let list = [];
      let stats = null;

      if (window.electronAPI?.hephListTasks) {
        list = await window.electronAPI.hephListTasks();
        if (window.electronAPI.hephGetTrainingStats) {
          stats = await window.electronAPI.hephGetTrainingStats();
        }
      } else {
        const [tasksRes, statsRes] = await Promise.all([
          apiFetch('/api/hephaestus/tasks').catch(() => null),
          apiFetch('/api/hephaestus/training-stats').catch(() => null)
        ]);
        if (tasksRes && tasksRes.ok) list = await tasksRes.json();
        if (statsRes && statsRes.ok) stats = await statsRes.json();
      }

      setTasks(list || []);
      const activeList = (list || []).filter(t => t.status !== 'deployed');
      // selectedTaskRef, not selectedTask: the 3s interval is created in an
      // effect keyed on [isOpen], so it permanently calls the closure from that
      // render, where selectedTask was its mount-time value (null). The branch
      // below therefore never ran and every poll fell through to
      // setSelectedTask(activeList[0]) — click task #4 and three seconds later
      // you were back on #1, repeatedly. A ref reads the current value.
      const current = selectedTaskRef.current;
      if (current) {
        const refreshed = (list || []).find(t => t.id === current.id);
        if (refreshed && refreshed.status !== 'deployed') {
          setSelectedTask(refreshed);
        } else {
          setSelectedTask(activeList[0] || null);
        }
      } else if (activeList.length > 0) {
        setSelectedTask(activeList[0]);
      } else {
        setSelectedTask(null);
      }

      if (stats) setTrainingStats(stats);
    } catch (err) {
      console.warn('Failed to load Hephaestus tasks:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadIdeas = async () => {
    if (!window.electronAPI?.listDevIdeas) {
      setAvailable(false);
      return;
    }
    const list = await window.electronAPI.listDevIdeas();
    setIdeas(list);
  };

  // Mirrors selectedTask so the long-lived poll can read the current value
  // rather than the one captured when the interval was created.
  const selectedTaskRef = useRef(null);
  useEffect(() => { selectedTaskRef.current = selectedTask; }, [selectedTask]);

  useEffect(() => {
    if (isOpen) {
      loadHephaestus();
      loadIdeas();
      const interval = setInterval(loadHephaestus, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Task Actions
  const handleCreateHephTask = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const targetFiles = newTargetFiles.trim() ? newTargetFiles.split(',').map(s => s.trim()) : [];
    const created = await window.electronAPI.hephCreateTask({
      title: newTitle.trim(),
      category: newCategory,
      description: newDesc.trim(),
      targetFiles,
      requestedBy: 'desktop_user'
    });
    if (created) {
      setNewTitle('');
      setNewDesc('');
      setNewTargetFiles('');
      setIsCreatingTask(false);
      await loadHephaestus();
      setSelectedTask(created);
    }
  };

  const handleApproveDeploy = async (taskId) => {
    if (!confirm('Deploy staged code changes directly to codebase?')) return;
    const res = await window.electronAPI.hephApprove(taskId);
    if (res?.success) {
      alert('Deployment applied successfully with rollback snapshot!');
      setSelectedTask(null);
      await loadHephaestus();
    } else {
      alert('Deployment failed: ' + (res?.error || 'Unknown error'));
    }
  };

  const handleRollback = async (taskId) => {
    if (!confirm('Trigger EMERGENCY ROLLBACK to revert files to pre-deployment snapshot?')) return;
    const res = await window.electronAPI.hephRollback(taskId);
    if (res?.success) {
      alert('Rollback succeeded! Original files restored.');
      loadHephaestus();
    } else {
      alert('Rollback failed: ' + (res?.error || 'Unknown error'));
    }
  };

  const handleArchiveExpiredTasks = async () => {
    const expired = tasks.filter(t => t.status === 'expired' || t.status === 'failed');
    if (expired.length === 0) {
      alert('No expired or stale work orders to archive.');
      return;
    }
    if (!confirm(`Archive and clear ${expired.length} expired work order(s)?`)) return;
    try {
      if (window.electronAPI?.hephDeleteTask) {
        for (const t of expired) {
          await window.electronAPI.hephDeleteTask(t.id);
        }
      }
      setSelectedTask(null);
      await loadHephaestus();
    } catch (err) {
      console.error('Failed to archive tasks:', err);
    }
  };

  // Backlog Actions
  const handleAddIdea = async (e) => {
    e.preventDefault();
    if (!ideaTitle.trim()) return;
    const res = await window.electronAPI.addDevIdea({
      title: ideaTitle.trim(),
      description: ideaDescription.trim(),
      targetFile: ideaTargetFile.trim() || null,
      source: 'user'
    });
    if (res?.success) {
      setIdeaTitle('');
      setIdeaDescription('');
      setIdeaTargetFile('');
      loadIdeas();
    }
  };

  const handleStatusIdea = async (id, status) => {
    await window.electronAPI.updateDevIdeaStatus(id, status);
    loadIdeas();
  };

  const handleDeleteIdea = async (id) => {
    await window.electronAPI.deleteDevIdea(id);
    loadIdeas();
  };

  const handleAskAloy = (idea) => {
    const filePart = idea.targetFile ? ` (likely in src/${idea.targetFile})` : '';
    const desc = (idea.description || 'no further detail given').trim().replace(/[.!?]+$/, '');
    onAskAloy(
      `Please delegate this engineering task to HEPHAESTUS: "${idea.title}"${filePart} — ${desc}. Have Hephaestus stage and verify the diff.`
    );
  };

  const activeIdeas = (ideas || []).filter((i) => i.status === 'idea');
  const historyIdeas = (ideas || []).filter((i) => i.status !== 'idea');

  const workspaceBody = (
    <>
      {/* Unified KPI Pulse Row */}
      <PulseGrid
        metrics={[
          {
            label: 'Active Orders',
            value: tasks.filter(t => t.status !== 'deployed').length,
            subtext: `${tasks.filter(t => t.status === 'review_needed').length} awaiting review`,
            icon: Code2,
            color: '#f59e0b'
          },
          {
            label: 'Deployed Patches',
            value: tasks.filter(t => t.status === 'deployed').length,
            subtext: 'Verified production diffs',
            icon: CheckCircle2,
            color: '#22c55e'
          },
          {
            label: 'QLoRA Flywheel',
            value: trainingStats ? `${trainingStats.totalSamples}` : '0',
            subtext: trainingStats ? `${trainingStats.positiveCount} verified pairs` : 'Ready',
            icon: Activity,
            color: '#c084fc'
          },
          {
            label: 'Monitored Builds',
            value: projects.length,
            subtext: 'Git & port tracking',
            icon: FolderGit2,
            color: '#38bdf8'
          }
        ]}
        columns={4}
      />

      {/* Unified Navigation Tabs */}
      <TabBar
        tabs={[
          { id: 'cauldron', label: 'Work Orders', icon: Code2, badge: tasks.filter(t => t.status !== 'deployed').length },
          { id: 'deployments', label: 'Deployed History', icon: CheckCircle2, badge: tasks.filter(t => t.status === 'deployed').length },
          { id: 'backlog', label: 'Feature Backlog', icon: Sparkles, badge: activeIdeas.length },
          { id: 'projects', label: 'Projects & Builds', icon: FolderGit2, badge: projects.length }
        ]}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        accentColor="#f59e0b"
        rightExtra={
          trainingStats ? (
            <div
              style={{
                fontSize: '0.72rem',
                color: '#c084fc',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '8px',
                background: 'rgba(168, 85, 247, 0.12)',
                border: '1px solid rgba(168, 85, 247, 0.25)'
              }}
            >
              🧠 QLoRA Buffer: {trainingStats.totalSamples} Pairs ({trainingStats.positiveCount} Verified)
            </div>
          ) : null
        }
      />

          {/* TAB 1: THE CAULDRON (HEPHAESTUS) */}
          {activeTab === 'cauldron' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {/* Task Creation & Filter Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', marginRight: '6px' }}>Engineering Orders</span>
                  <button
                    onClick={() => setTaskFilter('active')}
                    style={{
                      padding: '3px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                      background: taskFilter === 'active' ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                      border: taskFilter === 'active' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                      color: taskFilter === 'active' ? '#fbbf24' : '#94a3b8'
                    }}
                  >
                    Active ({tasks.filter(t => t.status !== 'deployed' && t.status !== 'expired' && t.status !== 'failed').length})
                  </button>
                  <button
                    onClick={() => setTaskFilter('all')}
                    style={{
                      padding: '3px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                      background: taskFilter === 'all' ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                      border: taskFilter === 'all' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                      color: taskFilter === 'all' ? '#fbbf24' : '#94a3b8'
                    }}
                  >
                    All ({tasks.filter(t => t.status !== 'deployed').length})
                  </button>
                  {tasks.some(t => t.status === 'expired' || t.status === 'failed') && (
                    <button
                      onClick={handleArchiveExpiredTasks}
                      style={{
                        padding: '3px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                        background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5',
                        display: 'flex', alignItems: 'center', gap: '3px'
                      }}
                      title="Clear expired/failed orders"
                    >
                      <Trash2 size={11} /> Clean Expired
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setIsCreatingTask(!isCreatingTask)}
                  style={{
                    padding: '5px 12px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.4)',
                    background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontSize: '0.78rem', fontWeight: 700,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                  }}
                >
                  <Plus size={14} /> {isCreatingTask ? 'Cancel' : 'New Task'}
                </button>
              </div>

              {isCreatingTask && (
                <form onSubmit={handleCreateHephTask} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  <input
                    type="text"
                    placeholder="Task Title, e.g. 'Add sound effect on level complete'"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    className="glass-input"
                    style={{ padding: '0.5rem 0.8rem', borderRadius: '8px', fontSize: '0.85rem' }}
                  />
                  <textarea
                    placeholder="Requirements and technical specifications for Hephaestus..."
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                    rows={2}
                    className="glass-input"
                    style={{ padding: '0.5rem 0.8rem', borderRadius: '8px', fontSize: '0.82rem', resize: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <select
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      className="glass-input"
                      style={{ padding: '0.4rem 0.7rem', borderRadius: '8px', fontSize: '0.8rem' }}
                    >
                      <option value="feature">Feature</option>
                      <option value="bugfix">Bugfix</option>
                      <option value="refactor">Refactor</option>
                      <option value="mcp_tool">MCP Tool</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Target files, e.g. server/tools.cjs (optional)"
                      value={newTargetFiles}
                      onChange={e => setNewTargetFiles(e.target.value)}
                      className="glass-input"
                      style={{ flex: 1, padding: '0.4rem 0.7rem', borderRadius: '8px', fontSize: '0.8rem' }}
                    >
                    </input>
                    <button
                      type="submit"
                      disabled={!newTitle.trim()}
                      style={{
                        padding: '0.4rem 1rem', borderRadius: '8px', border: 'none',
                        background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      Dispatch
                    </button>
                  </div>
                </form>
              )}

              {/* Task List Grid / Selected Task Inspector */}
              {(() => {
                const nonDeployed = tasks.filter(t => t.status !== 'deployed');
                const filteredTasks = taskFilter === 'active'
                  ? nonDeployed.filter(t => t.status !== 'expired' && t.status !== 'failed')
                  : nonDeployed;
                const activeTasks = filteredTasks.length > 0 ? filteredTasks : nonDeployed;
                const activeSelectedTask = activeTasks.find(t => t.id === selectedTask?.id) || (activeTasks.length > 0 ? activeTasks[0] : null);

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '14px' }}>
                    {/* List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
                      {activeTasks.length === 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '2px' }}>
                            Monitored Workspaces
                          </div>
                          {(projects && projects.length > 0 ? projects : [
                            { name: 'Aloy Desktop', branch: 'main', status: 'clean' },
                            { name: 'Media Automation Stack', branch: 'main', status: 'clean' },
                            { name: 'Home Assistant Sentinel', branch: 'main', status: 'clean' }
                          ]).map((proj, pIdx) => (
                            <div
                              key={pIdx}
                              onClick={() => setIsCreatingTask(true)}
                              style={{
                                padding: '8px 10px',
                                borderRadius: '8px',
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.06)',
                                cursor: 'pointer'
                              }}
                            >
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f1f5f9' }}>{proj.name}</div>
                              <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '2px' }}>Branch: {proj.branch || 'main'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        activeTasks.map(t => (
                          <div
                            key={t.id}
                            onClick={() => setSelectedTask(t)}
                            style={{
                              padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                              background: activeSelectedTask?.id === t.id ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.03)',
                              border: activeSelectedTask?.id === t.id ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.06)',
                              display: 'flex', flexDirection: 'column', gap: '2px'
                            }}
                          >
                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {t.title}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{t.category}</span>
                              <span style={{
                                fontSize: '0.65rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase',
                                background: t.status === 'deployed' ? 'rgba(34,197,94,0.2)' : t.status === 'failed' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                                color: t.status === 'deployed' ? '#4ade80' : t.status === 'failed' ? '#f87171' : '#fbbf24'
                              }}>
                                {t.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Selected Inspector */}
                    <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {activeSelectedTask ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>{activeSelectedTask.title}</div>
                              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Branch: {activeSelectedTask.branch} • ID: {activeSelectedTask.id}</div>
                            </div>
                            <span style={{
                              fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase',
                              background: activeSelectedTask.status === 'deployed' ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)',
                              color: activeSelectedTask.status === 'deployed' ? '#4ade80' : '#fbbf24'
                            }}>
                              {activeSelectedTask.status.replace(/_/g, ' ')}
                            </span>
                          </div>

                          {/* AI Code Review Box */}
                          {activeSelectedTask.aiReview && (
                            <div style={{ background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '8px', padding: '8px 10px', fontSize: '0.75rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#c084fc', marginBottom: '2px' }}>
                                <span>AI Judge ({activeSelectedTask.aiReview.provider?.toUpperCase()}): {activeSelectedTask.aiReview.verdict}</span>
                                <span>Score: {activeSelectedTask.aiReview.score}/100</span>
                              </div>
                              <div style={{ color: '#cbd5e1' }}>{activeSelectedTask.aiReview.summary}</div>
                              {activeSelectedTask.aiReview.critique && (
                                <div style={{ color: '#94a3b8', fontStyle: 'italic', marginTop: '3px' }}>"{activeSelectedTask.aiReview.critique}"</div>
                              )}
                            </div>
                          )}

                          {/* Diff View */}
                          <div style={{
                            background: '#07090e', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px',
                            padding: '8px', maxHeight: '180px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.4
                          }}>
                            {activeSelectedTask.stagedChanges && activeSelectedTask.stagedChanges.length > 0 ? (
                              activeSelectedTask.stagedChanges.map((sc, idx) => (
                                <div key={idx}>
                                  <div style={{ color: '#94a3b8', fontWeight: 700 }}>--- File: {sc.relativePath || sc.filePath} (+{sc.additions}/-{sc.deletions}) ---</div>
                                  {(sc.patch || '').split('\n').map((line, lIdx) => (
                                    <div key={lIdx} style={{
                                      color: line.startsWith('+') && !line.startsWith('+++') ? '#4ade80' : line.startsWith('-') && !line.startsWith('---') ? '#f87171' : '#94a3b8',
                                      background: line.startsWith('+') && !line.startsWith('+++') ? 'rgba(34,197,94,0.1)' : line.startsWith('-') && !line.startsWith('---') ? 'rgba(239,68,68,0.1)' : 'transparent'
                                    }}>
                                      {line}
                                    </div>
                                  ))}
                                </div>
                              ))
                            ) : (
                              <div style={{ color: '#64748b' }}>// No staged changes recorded yet.</div>
                            )}
                          </div>

                          {/* Action Controls */}
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 'auto' }}>
                            {activeSelectedTask.status === 'deployed' && (
                              <button
                                onClick={() => handleRollback(activeSelectedTask.id)}
                                style={{
                                  padding: '5px 12px', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.4)',
                                  background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontSize: '0.75rem', fontWeight: 700,
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                                }}
                              >
                                <RotateCcw size={13} /> Rollback
                              </button>
                            )}
                            {activeSelectedTask.status !== 'deployed' && (
                              <button
                                onClick={() => handleApproveDeploy(activeSelectedTask.id)}
                                style={{
                                  padding: '5px 14px', borderRadius: '8px', border: 'none',
                                  background: '#16a34a', color: '#fff', fontSize: '0.75rem', fontWeight: 700,
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                                }}
                              >
                                <CheckCircle2 size={14} /> Approve & Deploy
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center', padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                          <CheckCircle2 size={32} color="#22c55e" />
                          <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem' }}>All Work Orders Deployed</span>
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8', maxWidth: '420px', lineHeight: 1.4 }}>
                            All engineering tasks are complete and running in production. Click the <strong>Deployed History</strong> tab above to view the deployment ledger, diffs, and rollback snapshots.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* TAB 2: DEPLOYED HISTORY & CHANGELOG */}
          {activeTab === 'deployments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>
                  Deployment Ledger & Audit Log ({tasks.filter(t => t.status === 'deployed').length} deployed)
                </span>
                <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={13} /> Rollback Protection Active
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '480px', overflowY: 'auto' }}>
                {tasks.filter(t => t.status === 'deployed').length === 0 ? (
                  <div style={{ fontSize: '0.85rem', color: '#64748b', textAlign: 'center', padding: '40px' }}>
                    No deployed tasks recorded yet.
                  </div>
                ) : (
                  tasks.filter(t => t.status === 'deployed').map((t, idx) => {
                    const depIndex = String(idx + 1).padStart(3, '0');
                    return (
                      <div
                        key={t.id}
                        style={{
                          background: 'rgba(15, 23, 42, 0.85)',
                          border: '1px solid rgba(34, 197, 94, 0.25)',
                          borderRadius: '12px',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        {/* Header Row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.15)',
                              color: '#4ade80', fontSize: '0.75rem', fontWeight: 800, border: '1px solid rgba(34, 197, 94, 0.3)'
                            }}>
                              #HEPH-DEP-{depIndex}
                            </span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc' }}>{t.title}</span>
                            <span style={{ fontSize: '0.7rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>
                              {t.category}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            {t.deployedAt ? new Date(t.deployedAt).toLocaleString() : 'Recently'}
                          </span>
                        </div>

                        {t.description && (
                          <div style={{ fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                            {t.description}
                          </div>
                        )}

                        {/* Metadata Footer Bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.72rem', color: '#94a3b8' }}>
                            <span>🔑 ID: <code style={{ color: '#f59e0b' }}>{t.id}</code></span>
                            {t.rollbackSnapshotId && (
                              <span>🛡 Snapshot: <code style={{ color: '#a855f7' }}>{t.rollbackSnapshotId}</code></span>
                            )}
                            {t.aiReview && (
                              <span style={{ color: '#c084fc', fontWeight: 600 }}>
                                🤖 AI Review: {t.aiReview.verdict} ({t.aiReview.score}/100)
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleRollback(t.id)}
                            style={{
                              padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(168, 85, 247, 0.4)',
                              background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontSize: '0.72rem', fontWeight: 700,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                            }}
                          >
                            <RotateCcw size={12} /> Rollback
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: BACKLOG & PLANNING */}
          {activeTab === 'backlog' && (
            <>
              {!available ? (
                <div style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>
                  The Dev Workspace is only available in the desktop dev app (npm run dev).
                </div>
              ) : (
                <>
                  <form onSubmit={handleAddIdea} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <input
                      type="text"
                      placeholder="Idea title, e.g. 'Shrink sidebar padding'"
                      value={ideaTitle}
                      onChange={(e) => setIdeaTitle(e.target.value)}
                      className="glass-input"
                      style={{ padding: '0.65rem 0.9rem', borderRadius: '10px', fontSize: '0.9rem' }}
                    />
                    <textarea
                      placeholder="What should change, and why? (optional)"
                      value={ideaDescription}
                      onChange={(e) => setIdeaDescription(e.target.value)}
                      rows={2}
                      className="glass-input"
                      style={{ padding: '0.65rem 0.9rem', borderRadius: '10px', fontSize: '0.85rem', resize: 'none' }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Target file, e.g. components/Sidebar.jsx (optional)"
                        value={ideaTargetFile}
                        onChange={(e) => setIdeaTargetFile(e.target.value)}
                        className="glass-input"
                        style={{ flex: 1, padding: '0.6rem 0.9rem', borderRadius: '10px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
                      />
                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        type="submit"
                        disabled={!ideaTitle.trim()}
                        style={{
                          padding: '0.6rem 1.1rem', borderRadius: '10px', border: '1px solid rgba(0, 242, 254, 0.4)',
                          background: 'rgba(0, 242, 254, 0.15)', color: '#00f2fe', fontWeight: 700, fontSize: '0.85rem',
                          cursor: ideaTitle.trim() ? 'pointer' : 'default', opacity: ideaTitle.trim() ? 1 : 0.5,
                          display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap'
                        }}
                      >
                        <Plus size={15} /> Add
                      </motion.button>
                    </div>
                  </form>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {ideas === null ? (
                      <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Loading…</div>
                    ) : activeIdeas.length === 0 ? (
                      <div style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic', padding: '0.5rem' }}>
                        No open ideas — add one above, or ask Aloy in chat to suggest one.
                      </div>
                    ) : (
                      activeIdeas.map((idea) => (
                        <div key={idea.id} className="glass-panel" style={{ padding: '0.85rem 1rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>
                              {idea.source === 'aloy' ? <Bot size={13} color="#c084fc" /> : <User size={13} color="#64748b" />}
                              {idea.title}
                            </div>
                            <button onClick={() => handleDeleteIdea(idea.id)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', opacity: 0.6, flexShrink: 0 }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                          {idea.description && (
                            <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4 }}>{idea.description}</div>
                          )}
                          {idea.targetFile && (
                            <div style={{ fontSize: '0.72rem', color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>src/{idea.targetFile}</div>
                          )}
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem' }}>
                            <button
                              onClick={() => handleAskAloy(idea)}
                              style={{
                                flex: 1, padding: '0.4rem 0.7rem', borderRadius: '8px', cursor: 'pointer',
                                border: '1px solid rgba(245, 158, 11, 0.4)', background: 'rgba(245, 158, 11, 0.12)',
                                color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem'
                              }}
                            >
                              <Flame size={12} /> Dispatch to Heph
                            </button>
                            <button
                              onClick={() => handleStatusIdea(idea.id, 'dismissed')}
                              style={{
                                padding: '0.4rem 0.7rem', borderRadius: '8px', cursor: 'pointer',
                                border: '1px solid rgba(255, 255, 255, 0.1)', background: 'transparent',
                                color: '#64748b', fontWeight: 600, fontSize: '0.75rem'
                              }}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {historyIdeas.length > 0 && (
                    <div>
                      <button
                        onClick={() => setHistoryExpanded((v) => !v)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', padding: 0 }}
                      >
                        {historyExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        History ({historyIdeas.length})
                      </button>
                      {historyExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                          {historyIdeas.map((idea) => (
                            <div key={idea.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', padding: '0.4rem 0.2rem' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {idea.status === 'applied' ? <Check size={12} color="#4ade80" /> : <X size={12} color="#64748b" />}
                                {idea.title}
                              </span>
                              <button onClick={() => handleDeleteIdea(idea.id)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', opacity: 0.5, flexShrink: 0 }}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* TAB 4: MONITORED PROJECTS & BUILDS */}
          {activeTab === 'projects' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
              <ProjectsPanel
                isOpen={true}
                isFullPage={false}
                projects={projects}
                onAddProject={onAddProject}
                onRemoveProject={onRemoveProject}
                onUpdateProject={onUpdateProject}
              />
            </div>
          )}
    </>
  );

  const headerActions = [
    {
      label: isRefreshing ? 'Refreshing...' : 'Refresh Forge',
      icon: RefreshCw,
      onClick: loadHephaestus,
      loading: isRefreshing,
      variant: 'secondary'
    },
    {
      label: isCreatingTask ? 'Cancel' : 'New Task',
      icon: Plus,
      onClick: () => setIsCreatingTask(prev => !prev),
      variant: 'primary'
    }
  ];

  if (isFullPage) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#090d16',
        color: '#f8fafc',
        overflow: 'hidden',
        flex: 1
      }}>
        {/* Top Standardized PageHeader - Edge to Edge */}
        <PageHeader
          icon={Flame}
          title="HEPHAESTUS"
          subtitle="Code Forge & Monitored Projects"
          accentColor="#f59e0b"
          statusBadge="HEPH"
          onClose={onClose}
          actions={headerActions}
        />

        {/* Main Content Viewport */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1150px', margin: '0 auto' }}>
            {workspaceBody}
          </div>
        </div>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '1rem', background: 'rgba(5, 8, 14, 0.85)', backdropFilter: 'blur(14px)'
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            width: '100%', maxWidth: '920px', maxHeight: '88vh', overflowY: 'auto',
            background: '#090d16', border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '20px', padding: '0', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}
        >
          <PageHeader
            icon={Flame}
            title="HEPHAESTUS"
            subtitle="Code Forge & Monitored Projects"
            accentColor="#f59e0b"
            statusBadge="HEPH"
            onClose={onClose}
            actions={headerActions}
          />
          <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {workspaceBody}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
