import React from 'react';
import { motion } from 'framer-motion';

export default function EmptyState({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  accentColor = '#00f2fe',
  style = {}
}) {
  return (
    <div
      className="glass-panel"
      style={{
        padding: '3rem 2rem',
        borderRadius: '16px',
        border: '1px dashed rgba(255, 255, 255, 0.12)',
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '0.75rem',
        margin: '1.5rem',
        ...style
      }}
    >
      {Icon && (
        <div
          style={{
            width: '54px',
            height: '54px',
            borderRadius: '16px',
            background: `${accentColor}15`,
            border: `1px solid ${accentColor}35`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accentColor,
            marginBottom: '4px'
          }}
        >
          <Icon size={26} />
        </div>
      )}

      <h3
        style={{
          fontSize: '1.05rem',
          fontWeight: 700,
          color: '#f8fafc',
          margin: 0
        }}
      >
        {title}
      </h3>

      {subtitle && (
        <p
          style={{
            fontSize: '0.84rem',
            color: '#94a3b8',
            maxWidth: '420px',
            margin: 0,
            lineHeight: 1.45
          }}
        >
          {subtitle}
        </p>
      )}

      {actionLabel && onAction && (
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          type="button"
          onClick={onAction}
          style={{
            marginTop: '8px',
            padding: '0.65rem 1.25rem',
            borderRadius: '10px',
            border: `1px solid ${accentColor}55`,
            background: `linear-gradient(135deg, ${accentColor}25 0%, ${accentColor}10 100%)`,
            color: '#f8fafc',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: `0 0 16px ${accentColor}20`
          }}
        >
          {actionLabel}
        </motion.button>
      )}
    </div>
  );
}
