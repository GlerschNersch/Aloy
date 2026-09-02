import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';

// Ranked horizontal bar list of this month's spend by category. A single
// measure across named categories needs one consistent fill (bar length
// already encodes magnitude) and no legend — category names are direct axis
// labels, not color-coded series identity.
export default function FinanceTrendsChart({ categoryTotals }) {
  const [hovered, setHovered] = useState(null);

  const entries = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const maxValue = entries.length > 0 ? entries[0][1] : 0;

  return (
    <div className="glass-panel" style={{ padding: '1rem', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <span style={{ fontSize: '0.75rem', color: '#00f2fe', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '5px' }}>
        <BarChart3 size={14} /> Spending by Category (This Month)
      </span>

      {entries.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>
          No expenses logged this month yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {entries.map(([category, amount]) => {
            const widthPct = maxValue > 0 ? (amount / maxValue) * 100 : 0;
            const isHovered = hovered === category;
            return (
              <div
                key={category}
                onMouseEnter={() => setHovered(category)}
                onMouseLeave={() => setHovered(null)}
                style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{category}</span>
                  <span style={{ color: '#94a3b8', fontWeight: 600 }}>${amount.toFixed(2)}</span>
                </div>
                <div style={{ width: '100%', height: '10px', borderRadius: '5px', background: 'rgba(255, 255, 255, 0.05)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(2, widthPct)}%`,
                    height: '100%',
                    borderRadius: '5px',
                    background: 'linear-gradient(90deg, #00f2fe, #7f00ff)',
                    opacity: isHovered ? 1 : 0.85,
                    transition: 'width 0.4s ease, opacity 0.15s ease'
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
