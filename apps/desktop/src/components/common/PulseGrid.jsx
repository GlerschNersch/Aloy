import React from 'react';
import { motion } from 'framer-motion';

export default function PulseGrid({
  metrics = [],
  columns = 4,
  style = {}
}) {
  if (!metrics || metrics.length === 0) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: '0.85rem',
        padding: '1rem 1.4rem',
        ...style
      }}
    >
      {metrics.map((metric, idx) => {
        const Icon = metric.icon;
        const color = metric.color || '#00f2fe';
        const isClickable = Boolean(metric.onClick);

        return (
          <motion.div
            key={metric.label || idx}
            whileHover={isClickable ? { y: -2 } : {}}
            onClick={metric.onClick}
            className="glass-panel"
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '14px',
              border: `1px solid ${color}28`,
              background: `linear-gradient(135deg, ${color}08 0%, rgba(15, 23, 42, 0.75) 100%)`,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              cursor: isClickable ? 'pointer' : 'default'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em'
                }}
              >
                {metric.label}
              </span>
              {Icon && (
                <div
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '8px',
                    background: `${color}18`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: color
                  }}
                >
                  <Icon size={14} />
                </div>
              )}
            </div>

            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: 800,
                color: '#f8fafc',
                letterSpacing: '-0.02em',
                lineHeight: 1.2
              }}
            >
              {metric.value}
            </div>

            {metric.subtext && (
              <span
                style={{
                  fontSize: '0.72rem',
                  color: color,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {metric.subtext}
              </span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
