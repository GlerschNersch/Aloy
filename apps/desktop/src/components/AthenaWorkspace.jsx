import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Search,
  Plus,
  Compass,
  CheckCircle2,
  Clock,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  X,
  Zap,
  Activity,
  Layers,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { renderMarkdown } from '../services/markdown';
import { apiFetch } from '../services/aloyApi.js';
import { PageHeader, TabBar, PulseGrid, EmptyState } from './common';


export default function AthenaWorkspace({ isFullPage = false, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form state
  const [newQuery, setNewQuery] = useState('');
  const [newDepth, setNewDepth] = useState('standard');
  const [newFocusAreas, setNewFocusAreas] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadTasks = async () => {
    try {
      if (window.electronAPI?.athenaListTasks) {
        const list = await window.electronAPI.athenaListTasks();
        setTasks(list || []);
        if (!selectedTaskId && list && list.length > 0) {
          setSelectedTaskId(list[0].id);
        }
        return;
      }

      const res = await apiFetch('/api/athena/tasks');
      if (res.ok) {
        const list = await res.json();
        setTasks(list || []);
        if (!selectedTaskId && list && list.length > 0) {
          setSelectedTaskId(list[0].id);
        }
      }
    } catch (err) {
      console.warn('Failed to load Athena tasks:', err);
    }
  };

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateMission = async (e) => {
    e.preventDefault();
    if (!newQuery.trim()) return;

    setIsLoading(true);
    try {
      const focusAreas = newFocusAreas.split(',').map(s => s.trim()).filter(Boolean);
      const payload = {
        query: newQuery.trim(),
        depth: newDepth,
        focusAreas,
        requestedBy: 'athena_workspace'
      };

      let created = null;
      if (window.electronAPI?.athenaCreateTask) {
        created = await window.electronAPI.athenaCreateTask(payload);
      } else {
        const res = await apiFetch('/api/athena/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) created = await res.json();
      }

      if (created) {
        setNewQuery('');
        setNewFocusAreas('');
        setIsCreating(false);
        await loadTasks();
        setSelectedTaskId(created.id);
      }
    } catch (err) {
      console.error('Failed to create Athena research task:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDispatch = async (queryText, depth = 'deep') => {
    setIsLoading(true);
    try {
      const payload = {
        query: queryText,
        depth: depth,
        focusAreas: ['architecture', 'benchmarks', 'recommendations'],
        requestedBy: 'athena_workspace_quick'
      };
      let created = null;
      if (window.electronAPI?.athenaCreateTask) {
        created = await window.electronAPI.athenaCreateTask(payload);
      } else {
        const res = await apiFetch('/api/athena/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) created = await res.json();
      }
      if (created) {
        await loadTasks();
        setSelectedTaskId(created.id);
      }
    } catch (err) {
      console.error('Quick dispatch failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTask = async (taskId, e) => {
    e?.stopPropagation();
    if (!confirm('Dismiss this research dossier?')) return;
    try {
      if (window.electronAPI?.athenaDeleteTask) {
        await window.electronAPI.athenaDeleteTask(taskId);
      } else {
        await apiFetch(`/api/athena/tasks/${taskId}`, {
          method: 'DELETE',
        });
      }
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      await loadTasks();
    } catch (err) {
      console.error('Failed to delete Athena task:', err);
    }
  };

  const handleRetryTask = async (task) => {
    if (!task) return;
    setIsLoading(true);
    try {
      const payload = {
        query: task.query,
        depth: task.depth || 'standard',
        focusAreas: task.focusAreas || [],
        requestedBy: 'athena_retry'
      };
      let created = null;
      if (window.electronAPI?.athenaCreateTask) {
        created = await window.electronAPI.athenaCreateTask(payload);
      } else {
        const res = await apiFetch('/api/athena/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) created = await res.json();
      }
      if (created) {
        await loadTasks();
        setSelectedTaskId(created.id);
      }
    } catch (err) {
      console.error('Failed to retry Athena mission:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyReport = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredTasks = tasks.filter(t => {
    const q = (searchTerm || '').trim().toLowerCase();
    const matchesSearch = !q ||
      (t.query && t.query.toLowerCase().includes(q)) ||
      (t.id && t.id.toLowerCase().includes(q)) ||
      (t.statusMessage && t.statusMessage.toLowerCase().includes(q));
    const matchesStatus = statusFilter === 'all' || (t.status && t.status.toLowerCase() === statusFilter.toLowerCase());
    return matchesSearch && matchesStatus;
  });

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || (filteredTasks.length > 0 ? filteredTasks[0] : null);

  const depthLabels = {
    quick: { label: 'Quick Brief', color: '#38bdf8', icon: Zap },
    standard: { label: 'Standard Report', color: '#818cf8', icon: Compass },
    deep_dive: { label: 'Deep Dive', color: '#c084fc', icon: Sparkles }
  };

  const statusColors = {
    completed: { bg: 'rgba(34, 197, 94, 0.15)', border: 'rgba(34, 197, 94, 0.3)', text: '#4ade80' },
    researching: { bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.3)', text: '#38bdf8' },
    synthesizing: { bg: 'rgba(192, 132, 252, 0.15)', border: 'rgba(192, 132, 252, 0.3)', text: '#c084fc' },
    queued: { bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.3)', text: '#fbbf24' },
    failed: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', text: '#f87171' },
    cancelled: { bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.3)', text: '#94a3b8' }
  };

  const workspaceBody = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '1rem' }}>
      {/* Unified KPI Pulse Row */}
      <PulseGrid
        metrics={[
          {
            label: 'Total Dossiers',
            value: tasks.length,
            subtext: `${tasks.filter(t => t.status === 'completed').length} completed`,
            icon: BookOpen,
            color: '#38bdf8'
          },
          {
            label: 'Active Missions',
            value: tasks.filter(t => t.status === 'in_progress').length,
            subtext: 'Deep synthesis in-flight',
            icon: Compass,
            color: '#f59e0b'
          },
          {
            label: 'Synthesis Depth',
            value: 'Standard / Deep',
            subtext: 'Multi-source citation engine',
            icon: Layers,
            color: '#a855f7'
          },
          {
            label: 'System Gate',
            value: 'Verified',
            subtext: 'Gemini & Claude cross-check',
            icon: CheckCircle2,
            color: '#22c55e'
          }
        ]}
        columns={4}
      />

      {/* Collapsible Mission Creation Bar */}
      <AnimatePresence>
        {isCreating && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreateMission}
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(16, 20, 31, 0.95))',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '14px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                🚀 Launch Background Research Mission
              </span>
              <button type="button" onClick={() => setIsCreating(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            <input
              type="text"
              placeholder="What topic or technology should Athena investigate? (e.g. 'Compare top LFP vs NMC battery storage options for home solar')"
              value={newQuery}
              onChange={(e) => setNewQuery(e.target.value)}
              className="glass-input"
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                fontSize: '0.95rem',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(0, 0, 0, 0.4)',
                color: '#fff'
              }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Research Depth:</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {Object.entries(depthLabels).map(([key, info]) => {
                    const Icon = info.icon;
                    const isSelected = newDepth === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setNewDepth(key)}
                        style={{
                          flex: 1,
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: isSelected ? `1px solid ${info.color}` : '1px solid rgba(255, 255, 255, 0.08)',
                          background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                          color: isSelected ? info.color : '#94a3b8',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        <Icon size={14} />
                        <span>{info.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>Focus Angles & Priorities (Optional, comma-separated):</label>
                <input
                  type="text"
                  placeholder="e.g. Cost per kWh, degradation curves, fire safety"
                  value={newFocusAreas}
                  onChange={(e) => setNewFocusAreas(e.target.value)}
                  className="glass-input"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(0, 0, 0, 0.4)',
                    color: '#fff'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'transparent',
                  color: '#94a3b8',
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !newQuery.trim()}
                style={{
                  padding: '6px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#38bdf8',
                  color: '#07090e',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: newQuery.trim() ? 'pointer' : 'default',
                  opacity: newQuery.trim() ? 1 : 0.5
                }}
              >
                {isLoading ? 'Dispatching...' : 'Launch Mission'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Main Two-Column Master/Detail Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        gap: '1.25rem',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden'
      }}>
        {/* Left Mission List */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '14px',
          padding: '12px',
          overflow: 'hidden',
          minHeight: 0
        }}>
          {/* Pinned Top Bar: Search & Status Filters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0, paddingBottom: '6px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            {/* Search Box */}
            <div style={{ position: 'relative' }}>
              <Search size={14} color="#64748b" style={{ position: 'absolute', left: '10px', top: '10px' }} />
              <input
                type="text"
                placeholder="Filter research missions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px 6px 30px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '0.8rem',
                  outline: 'none'
                }}
              />
            </div>

            {/* Status Filter Pills Bar */}
            <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', scrollbarWidth: 'none', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: 'All', count: tasks.length },
                { id: 'completed', label: 'Done', count: tasks.filter(t => t.status === 'completed').length, color: '#4ade80' },
                { id: 'researching', label: 'Scouting', count: tasks.filter(t => t.status === 'researching').length, color: '#38bdf8' },
                { id: 'synthesizing', label: 'Synthesis', count: tasks.filter(t => t.status === 'synthesizing').length, color: '#c084fc' },
                { id: 'queued', label: 'Queued', count: tasks.filter(t => t.status === 'queued').length, color: '#fbbf24' },
                { id: 'failed', label: 'Failed', count: tasks.filter(t => t.status === 'failed').length, color: '#f87171' },
                { id: 'cancelled', label: 'Cancelled', count: tasks.filter(t => t.status === 'cancelled').length, color: '#94a3b8' }
              ].filter(f => f.id === 'all' || f.count > 0).map(f => {
                const isActive = statusFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStatusFilter(prev => prev === f.id ? 'all' : f.id)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      background: isActive ? (f.color ? `${f.color}30` : 'rgba(56, 189, 248, 0.25)') : 'rgba(255, 255, 255, 0.05)',
                      border: isActive ? `1px solid ${f.color || '#38bdf8'}` : '1px solid rgba(255, 255, 255, 0.1)',
                      color: isActive ? (f.color || '#38bdf8') : '#cbd5e1',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{f.label}</span>
                    <span style={{ fontSize: '0.65rem', opacity: 0.85 }}>({f.count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Missions List Container */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
            {filteredTasks.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: '#64748b', textAlign: 'center', padding: '30px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <span>
                  {statusFilter !== 'all'
                    ? `No missions with status "${statusFilter}"${searchTerm ? ` matching "${searchTerm}"` : ''}.`
                    : searchTerm
                      ? `No missions matching "${searchTerm}".`
                      : 'No research missions found. Click "+ New Mission" to dispatch Athena.'}
                </span>
                {(statusFilter !== 'all' || searchTerm) && (
                  <button
                    type="button"
                    onClick={() => { setStatusFilter('all'); setSearchTerm(''); }}
                    style={{
                      fontSize: '0.72rem',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#38bdf8',
                      cursor: 'pointer'
                    }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              filteredTasks.map((t) => {
                const isSelected = selectedTask?.id === t.id;
                const statusCfg = statusColors[t.status] || statusColors.queued;
                const depthCfg = depthLabels[t.depth] || depthLabels.standard;
                const DepthIcon = depthCfg.icon;

                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTaskId(t.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                      border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', lineHeight: 1.3, flex: 1 }}>
                        {t.query}
                      </span>
                      <button
                        onClick={(e) => handleDeleteTask(t.id, e)}
                        style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px' }}
                        title="Dismiss dossier"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                      <span
                        onClick={(e) => { e.stopPropagation(); setStatusFilter(t.status); }}
                        title={`Filter by ${t.status}`}
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          textTransform: 'uppercase',
                          background: statusCfg.bg,
                          border: `1px solid ${statusCfg.border}`,
                          color: statusCfg.text,
                          cursor: 'pointer'
                        }}
                      >
                        {t.status}
                      </span>

                      <span style={{ fontSize: '0.7rem', color: depthCfg.color, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <DepthIcon size={12} /> {depthCfg.label}
                      </span>
                    </div>

                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      {new Date(t.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Dossier Viewer */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '14px',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          overflowY: 'auto'
        }}>
          {selectedTask ? (
            <>
              {/* Dossier Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                paddingBottom: '1rem',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '6px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)'
                    }}>
                      #{selectedTask.id}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Requested by: <code>{selectedTask.requestedBy}</code>
                    </span>
                    {selectedTask.provider && (
                      <span style={{ fontSize: '0.72rem', color: '#a78bfa', background: 'rgba(167, 139, 250, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                        🧠 {selectedTask.provider}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                    {selectedTask.query}
                  </h2>
                </div>

                {selectedTask.status === 'completed' && selectedTask.reportMarkdown && (
                  <button
                    onClick={() => handleCopyReport(selectedTask.reportMarkdown)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? 'Copied!' : 'Copy Markdown'}</span>
                  </button>
                )}
              </div>

              {/* In-Flight Progress Card */}
              {(selectedTask.status || '').toLowerCase() !== 'completed' && (selectedTask.status || '').toLowerCase() !== 'failed' && (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(99, 102, 241, 0.08))',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Activity size={16} className="spin" /> {selectedTask.statusMessage || 'Synthesizing knowledge...'}
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc' }}>
                      {selectedTask.progress || 0}%
                    </span>
                  </div>

                  <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${selectedTask.progress || 0}%` }}
                      style={{ height: '100%', background: 'linear-gradient(90deg, #38bdf8, #6366f1)', borderRadius: '3px' }}
                    />
                  </div>
                </div>
              )}

              {/* Rendered Markdown Report */}
              {(selectedTask.status || '').toLowerCase() === 'completed' && selectedTask.reportMarkdown ? (
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedTask.reportMarkdown) }}
                  style={{
                    background: 'rgba(7, 9, 14, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    color: '#e2e8f0',
                    fontSize: '0.9rem',
                    lineHeight: 1.6,
                    overflowY: 'auto'
                  }}
                />
              ) : ((selectedTask.status || '').toLowerCase() === 'failed' || !selectedTask.reportMarkdown) ? (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '12px',
                  padding: '2rem 1.5rem',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  margin: 'auto 0'
                }}>
                  <AlertCircle size={36} color="#ef4444" />
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fca5a5' }}>Research Mission Interrupted</div>
                  <div style={{ fontSize: '0.84rem', color: '#cbd5e1', maxWidth: '480px', lineHeight: 1.5 }}>
                    {selectedTask.statusMessage || 'Task was orphaned or encountered an upstream connection error.'}
                  </div>
                  <button
                    onClick={() => handleRetryTask(selectedTask)}
                    disabled={isLoading}
                    style={{
                      marginTop: '0.5rem',
                      background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(99, 102, 241, 0.25))',
                      border: '1px solid #38bdf8',
                      color: '#bae6fd',
                      padding: '0.55rem 1.25rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 0 14px rgba(56, 189, 248, 0.25)'
                    }}
                  >
                    <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                    Restart Research Mission
                  </button>
                </div>
              ) : null}

              {/* Discovered Sources Footer */}
              {selectedTask.sources && selectedTask.sources.length > 0 && (
                <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                    🌐 Discovered Sources & Footnotes ({selectedTask.sources.length}):
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedTask.sources.map((s, idx) => (
                      <div key={idx} style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#38bdf8', fontWeight: 700 }}>[{idx + 1}]</span>
                        <span>{s.title}</span>
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#64748b', fontSize: '0.9rem', textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
                boxShadow: '0 0 25px rgba(56, 189, 248, 0.2)'
              }}>
                <Compass size={28} />
              </div>
              <div>
                <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '1.2rem', display: 'block' }}>No Dossier Selected</span>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8', maxWidth: '460px', lineHeight: 1.5, display: 'block', marginTop: '4px' }}>
                  Select a past mission from the left or launch an autonomous deep investigation below.
                </span>
              </div>

              {/* Quick Mission Presets */}
              <div style={{ width: '100%', maxWidth: '640px', marginTop: '12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', textAlign: 'left', marginBottom: '10px' }}>
                  ⚡ Quick Launch Research Missions
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
                  {[
                    {
                      title: '🌐 NextTrace BGP & IXP Peering',
                      desc: 'Audit regional ISP transit, Six IXP interchange, and Cloudflare Anycast edge paths',
                      query: 'BGP Peering, Seattle SIX IXP exchange, and Anycast routing topology audit',
                      depth: 'deep'
                    },
                    {
                      title: '🧠 Local LLM Inference & VRAM Optimization',
                      desc: 'Benchmark Q4_K_M vs Q8_0 GGUF latency, memory bandwidth, and context windows',
                      query: 'Local LLM inference optimization, VRAM memory bandwidth, and GGUF quantization tradeoffs',
                      depth: 'standard'
                    },
                    {
                      title: '⚡ Home Assistant Automation Sentinel',
                      desc: 'Analyze perimeter sensor rules, Aqara U400 door state integrity, and Zigbee mesh stability',
                      query: 'Home Assistant perimeter security architecture, smart lock failsafes, and IoT reliability',
                      depth: 'deep'
                    }
                  ].map((preset, idx) => (
                    <motion.div
                      key={idx}
                      whileHover={{ y: -2, borderColor: 'rgba(56, 189, 248, 0.4)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleQuickDispatch(preset.query, preset.depth)}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '12px',
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{preset.title}</span>
                        <Plus size={14} color="#38bdf8" />
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.4 }}>
                        {preset.desc}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const headerActions = [
    {
      label: isLoading ? 'Refreshing...' : 'Refresh Dossiers',
      icon: RefreshCw,
      onClick: loadTasks,
      loading: isLoading,
      variant: 'secondary'
    },
    {
      label: isCreating ? 'Cancel' : 'New Mission',
      icon: Plus,
      onClick: () => setIsCreating(prev => !prev),
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
          icon={BookOpen}
          title="ATHENA"
          subtitle="Deep Intelligence Scout"
          accentColor="#38bdf8"
          statusBadge="SCOUT"
          onClose={onClose}
          actions={headerActions}
        />

        {/* Main Content Viewport */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1150px', width: '100%', margin: '0 auto', flex: 1 }}>
            {workspaceBody}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '2rem'
    }}>
      <div style={{
        backgroundColor: '#090d16',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '20px',
        width: '92vw',
        maxWidth: '1200px',
        height: '86vh',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <PageHeader
          icon={BookOpen}
          title="ATHENA"
          subtitle="Deep Intelligence Scout"
          accentColor="#38bdf8"
          statusBadge="SCOUT"
          onClose={onClose}
          actions={headerActions}
        />
        <div style={{ padding: '1.5rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {workspaceBody}
        </div>
      </div>
    </div>
  );
}
