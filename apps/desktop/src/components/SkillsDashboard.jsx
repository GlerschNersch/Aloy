import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BarChart3, Eye, FileCheck, Brain, Zap, CheckCircle2, Sparkles } from 'lucide-react';
import { PageHeader, PulseGrid } from './common';
import { apiJson } from '../services/aloyApi.js';

// Pure glance view — no manual research/save/delete controls. Teaching is
// now fully automated (server/skillsDashboard.cjs's runNightlyAutoTeaching,
// scheduled nightly in aloyServer.cjs): Claude researches each gap, Gemini
// independently verifies it, and only entries both agree on land in
// learnedKnowledge automatically. Anything neither model is confident about
// is tagged 'needs_review' instead of being saved — surfaced here as a
// count, not something this view expects you to act on interactively.
export default function SkillsDashboard({ isOpen = true, onClose, isFullPage = false }) {
  const [data, setData] = useState(null);

  const load = () => {
    if (window.electronAPI?.getSkillsDashboard) {
      window.electronAPI.getSkillsDashboard().then(setData);
    } else {
      // Was a bare relative fetch with no token and a silent catch, so the
      // non-Electron path could never work and sat on "Loading…" forever.
      apiJson('/api/skills-dashboard')
        .then(setData)
        .catch((err) => console.warn('[skills] dashboard load failed:', err?.message || err));
    }
  };

  useEffect(() => {
    if (isOpen || isFullPage) load();
  }, [isOpen, isFullPage]);

  const formatLastRun = (iso) => {
    if (!iso) return 'Not yet run';
    const diffMs = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(diffMs / 3600000);
    if (hours < 1) return 'Less than 1h ago';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const dashboardContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '1.25rem' }}>
      {/* Unified Page Header */}
      <PageHeader
        icon={BarChart3}
        title="APOLLO SKILLS & PROFICIENCY"
        subtitle="Autonomous Nightly Knowledge Distillation & Model Calibration"
        accentColor="#c084fc"
        statusBadge={{ label: 'Flywheel Active', color: '#c084fc' }}
        onClose={onClose && !isFullPage ? onClose : null}
      />

      {data && (
        <PulseGrid
          metrics={[
            {
              label: 'Overall Proficiency',
              value: `${data.overallProficiencyScore}%`,
              subtext: 'Synthetic evaluation index',
              icon: Brain,
              color: '#c084fc'
            },
            {
              label: 'Learned Patterns',
              value: data.skillsLearnedCount || 0,
              subtext: 'Tool-call skills compiled',
              icon: Zap,
              color: '#00f2fe'
            },
            {
              label: 'Last Auto-Taught',
              value: formatLastRun(data.lastAutoTeachingRun),
              subtext: 'Nightly dual-LLM pass',
              icon: Sparkles,
              color: '#38bdf8'
            },
            {
              label: 'Needs Review',
              value: data.needsReviewCount || 0,
              subtext: data.needsReviewCount > 0 ? 'Pending user check' : 'All calibrated',
              icon: Eye,
              color: data.needsReviewCount > 0 ? '#fbbf24' : '#22c55e'
            }
          ]}
          columns={4}
        />
      )}

          {data?.documentProofreading && data.documentProofreading.totalLogged > 0 && (() => {
            const dp = data.documentProofreading;
            const streakColor = dp.readyToGraduate ? '#4ade80' : dp.cleanStreak > 0 ? '#38bdf8' : '#94a3b8';
            return (
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <FileCheck size={16} color={streakColor} />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>Document Rewrite Reliability</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
                  {dp.readyToGraduate ? (
                    <span style={{ color: '#4ade80', fontWeight: 700 }}>
                      {dp.cleanStreak} consecutive clean proofreads — Aloy may be ready to handle documents without Claude checking its work.
                    </span>
                  ) : (
                    <>
                      <span style={{ color: streakColor, fontWeight: 700 }}>{dp.cleanStreak} clean in a row</span>
                      {' '}(needs {dp.graduationStreak} to graduate off mandatory proofreading) · last {dp.recentSampleSize}: {dp.recentCleanRate}% clean
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {!data && <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading…</div>}

          {data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {data.categories.map((cat) => {
                const scoreColor = cat.proficiencyScore >= 90 ? '#4ade80' : cat.proficiencyScore >= 70 ? '#38bdf8' : cat.proficiencyScore >= 40 ? '#fbbf24' : '#f87171';
                return (
                  <div key={cat.name} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '12px', padding: '0.75rem 1rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: '#f1f5f9', marginBottom: '0.4rem' }}>
                      <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {cat.name}
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 800, padding: '0.1rem 0.45rem', borderRadius: '6px',
                          background: `${scoreColor}20`, border: `1px solid ${scoreColor}40`, color: scoreColor
                        }}>
                          {cat.proficiencyScore}%
                        </span>
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                        {cat.gapCount > 0 && <span style={{ color: '#f87171' }}>{cat.gapCount} gap{cat.gapCount !== 1 ? 's' : ''}</span>}
                        {cat.gapCount > 0 && cat.confirmedCount > 0 && '  ·  '}
                        {cat.confirmedCount > 0 && <span style={{ color: '#4ade80' }}>{cat.confirmedCount} confirmed</span>}
                        {cat.gapCount === 0 && cat.confirmedCount === 0 && 'no data'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ width: `${cat.proficiencyScore}%`, background: scoreColor, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
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
        gap: '1.5rem'
      }}>
        {dashboardContent}
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
            width: '100%', maxWidth: '620px', maxHeight: '85vh', overflowY: 'auto',
            background: 'rgba(15, 21, 35, 0.95)', border: '1px solid rgba(0, 242, 254, 0.2)',
            borderRadius: '24px', padding: '2rem', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            display: 'flex', flexDirection: 'column', gap: '1.5rem'
          }}
        >
          {dashboardContent}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
