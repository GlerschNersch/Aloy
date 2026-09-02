import { useStore } from '@builder.io/mitosis';

export default function StatusBadge(props) {
  const state = useStore({
    get statusColor() {
      if (props.status === 'online' || props.status === 'healthy') return '#10b981';
      if (props.status === 'busy' || props.status === 'warning') return '#f59e0b';
      if (props.status === 'offline' || props.status === 'error') return '#ef4444';
      return '#6b7280';
    }
  });

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '9999px',
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.12)'
      }}
    >
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: state.statusColor
        }}
      />
      <span
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#e2e8f0',
          letterSpacing: '0.02em'
        }}
      >
        {props.label || props.status}
      </span>
    </div>
  );
}
