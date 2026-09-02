import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Brain, BarChart3, FolderGit2, ShieldCheck, Code2 } from 'lucide-react';

// Landing-screen "at a glance" summary of every workspace (minus Finances,
// which the user deliberately excluded) — one real stat per workspace,
// reusing data App.jsx already fetches for the sidebar rather than adding
// new polling. Each card opens the matching workspace panel, same as the
// sidebar's own workspace list. Dev Workspace's idea count is fetched
// locally here since nothing else in the app currently tracks it in state.
export default function WorkspaceOverview({
  memories,
  lastBackupStatus,
  isLockConfigured,
  skillsStats,
  trackedProjects,
  smartHomeStats,
  onOpenMemoryModal,
  onOpenSkillsDashboard,
  onOpenProjectsPanel,
  onOpenSmartHomeDrawer,
  onOpenDevWorkspace
}) {
  const [devIdeaCount, setDevIdeaCount] = useState(null);

  useEffect(() => {
    if (!window.electronAPI?.listDevIdeas) return;
    window.electronAPI.listDevIdeas().then((list) => {
      setDevIdeaCount((list || []).filter((i) => i.status === 'idea').length);
    });
  }, []);

  const smartHomeNeedsAttention = !!(smartHomeStats && smartHomeStats.locksUnlocked > 0);

  const backupLabel = lastBackupStatus === null
    ? 'Not backed up yet'
    : lastBackupStatus.success ? 'Backed up' : 'Backup failed';

  const cards = [
    {
      key: 'memory',
      icon: Brain,
      color: '#c084fc',
      bg: 'rgba(127, 0, 255, 0.15)',
      label: 'Memory & Profile',
      stat: `${(memories || []).length} memories`,
      sub: `${backupLabel} · ${isLockConfigured ? 'Lock on' : 'No lock'}`,
      onClick: onOpenMemoryModal
    },
    {
      key: 'skills',
      icon: BarChart3,
      color: '#00f2fe',
      bg: 'rgba(0, 242, 254, 0.15)',
      label: 'Skills Dashboard',
      stat: skillsStats ? `${skillsStats.overallProficiencyScore}%` : '—',
      sub: skillsStats?.needsReviewCount > 0 ? `${skillsStats.needsReviewCount} need review` : 'All clear',
      onClick: onOpenSkillsDashboard
    },
    {
      key: 'projects',
      icon: FolderGit2,
      color: '#00f2fe',
      bg: 'rgba(0, 242, 254, 0.15)',
      label: 'Projects & Builds',
      stat: `${(trackedProjects || []).length} tracked`,
      sub: 'Git & build status',
      onClick: onOpenProjectsPanel
    },
    {
      key: 'smarthome',
      icon: ShieldCheck,
      color: smartHomeNeedsAttention ? '#f87171' : '#00f2fe',
      bg: smartHomeNeedsAttention ? 'rgba(248, 113, 113, 0.15)' : 'rgba(0, 242, 254, 0.15)',
      label: 'Smart Home',
      stat: smartHomeStats ? `${smartHomeStats.lightsOn}/${smartHomeStats.totalLights} lights` : '—',
      sub: smartHomeStats ? `${smartHomeStats.locksUnlocked} unlocked · ${smartHomeStats.climateTemp}` : 'No live data',
      onClick: onOpenSmartHomeDrawer
    },
    {
      key: 'dev',
      icon: Code2,
      color: '#00f2fe',
      bg: 'rgba(0, 242, 254, 0.15)',
      label: 'Dev Workspace',
      stat: devIdeaCount === null ? '—' : `${devIdeaCount} idea${devIdeaCount !== 1 ? 's' : ''}`,
      sub: 'Open',
      onClick: onOpenDevWorkspace
    }
  ];

  return (
    <div style={{ width: '100%', alignSelf: 'stretch' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.6rem', textAlign: 'left' }}>
        Workspace Overview
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '0.85rem',
        width: '100%'
      }}>
        {cards.map((card) => {
          const IconComp = card.icon;
          return (
            <motion.div
              key={card.key}
              whileHover={{ y: -3, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={card.onClick}
              className="glass-panel"
              style={{
                padding: '1.1rem',
                borderRadius: '16px',
                cursor: 'pointer',
                textAlign: 'left',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(15, 21, 35, 0.7)'
              }}
            >
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: card.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: card.color,
                marginBottom: '0.75rem'
              }}>
                <IconComp size={17} />
              </div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f1f5f9' }}>{card.stat}</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600, marginTop: '3px' }}>{card.label}</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.sub}</div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
