import React from 'react';
import { motion } from 'framer-motion';

export default function TabBar({
  tabs = [],
  activeTab,
  onSelectTab,
  accentColor = '#00f2fe',
  rightExtra = null,
  style = {}
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.65rem 1.4rem',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(15, 23, 42, 0.65)',
        gap: '1rem',
        flexWrap: 'wrap',
        ...style
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', flex: 1 }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <motion.button
              key={tab.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '10px',
                border: isActive ? `1px solid ${accentColor}55` : '1px solid rgba(255, 255, 255, 0.06)',
                background: isActive ? `${accentColor}18` : 'rgba(255, 255, 255, 0.03)',
                color: isActive ? '#f8fafc' : '#94a3b8',
                fontSize: '0.82rem',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap'
              }}
            >
              {Icon && <Icon size={14} color={isActive ? accentColor : '#64748b'} />}
              <span>{tab.label}</span>
              {/* `badge` is the documented prop, but seven call sites in
                  SubAgentsHub pass `count` instead, and their tab counters
                  silently rendered nothing. Accept both rather than leave a
                  contract that half the callers get wrong. */}
              {(tab.badge ?? tab.count) !== undefined && (tab.badge ?? tab.count) !== null && (
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 800,
                    padding: '1px 6px',
                    borderRadius: '10px',
                    background: isActive ? `${accentColor}30` : 'rgba(255, 255, 255, 0.08)',
                    color: isActive ? accentColor : '#64748b'
                  }}
                >
                  {tab.badge ?? tab.count}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

      {rightExtra && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {rightExtra}
        </div>
      )}
    </div>
  );
}
