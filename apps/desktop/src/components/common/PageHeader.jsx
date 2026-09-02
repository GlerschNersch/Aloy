import React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  accentColor = '#00f2fe',
  statusBadge,
  actions,
  onClose,
  style = {}
}) {
  return (
    <div
      className="glass-panel"
      style={{
        padding: '0.85rem 1.4rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px 16px 0 0',
        background: `linear-gradient(135deg, ${accentColor}12 0%, rgba(15, 23, 42, 0.95) 100%)`,
        position: 'relative',
        zIndex: 10,
        ...style
      }}
    >
      {/* Left: Brand / Agent Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
        {Icon && (
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '11px',
              background: `linear-gradient(135deg, ${accentColor}25 0%, ${accentColor}10 100%)`,
              border: `1px solid ${accentColor}45`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: accentColor,
              boxShadow: `0 0 16px ${accentColor}22`,
              flexShrink: 0
            }}
          >
            <Icon size={19} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2
              style={{
                fontSize: '1.05rem',
                fontWeight: 800,
                color: '#f8fafc',
                margin: 0,
                letterSpacing: '-0.01em',
                lineHeight: 1.2
              }}
            >
              {title}
            </h2>
            {statusBadge && (
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: typeof statusBadge === 'object' && statusBadge.color ? `${statusBadge.color}22` : `${accentColor}18`,
                  color: typeof statusBadge === 'object' && statusBadge.color ? statusBadge.color : accentColor,
                  border: `1px solid ${typeof statusBadge === 'object' && statusBadge.color ? statusBadge.color : accentColor}40`,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em'
                }}
              >
                {typeof statusBadge === 'object' ? statusBadge.label : statusBadge}
              </span>
            )}
          </div>
          {subtitle && (
            <p
              style={{
                fontSize: '0.74rem',
                color: '#94a3b8',
                margin: '2px 0 0 0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right: Actions & Close Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
        {Array.isArray(actions)
          ? actions.map((act, idx) => {
              if (React.isValidElement(act)) return <React.Fragment key={idx}>{act}</React.Fragment>;
              if (!act || typeof act !== 'object') return null;
              const { label, icon: ActionIcon, onClick, variant = 'secondary', loading = false, disabled = false } = act;
              const isPrimary = variant === 'primary';
              return (
                <motion.button
                  key={label || idx}
                  whileHover={!disabled && !loading ? { scale: 1.03 } : {}}
                  whileTap={!disabled && !loading ? { scale: 0.97 } : {}}
                  type="button"
                  onClick={onClick}
                  disabled={disabled || loading}
                  style={{
                    background: isPrimary
                      ? `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}cc 100%)`
                      : 'rgba(255, 255, 255, 0.06)',
                    border: isPrimary ? 'none' : '1px solid rgba(255, 255, 255, 0.12)',
                    color: isPrimary ? '#07090e' : '#f8fafc',
                    padding: '0.45rem 0.9rem',
                    borderRadius: '9px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: disabled || loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    opacity: disabled ? 0.6 : 1,
                    boxShadow: isPrimary ? `0 0 14px ${accentColor}35` : 'none'
                  }}
                >
                  {ActionIcon && (
                    <ActionIcon
                      size={14}
                      style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}
                    />
                  )}
                  <span>{label}</span>
                </motion.button>
              );
            })
          : actions}

        {onClose && (
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              borderRadius: '9px',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '4px'
            }}
          >
            <X size={16} />
          </motion.button>
        )}
      </div>
    </div>
  );
}
