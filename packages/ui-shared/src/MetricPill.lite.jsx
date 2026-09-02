import { useStore } from '@builder.io/mitosis';

export default function MetricPill(props) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        padding: '8px 14px',
        borderRadius: '12px',
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        border: '1px solid rgba(51, 65, 85, 0.45)',
        minWidth: '80px'
      }}
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 500,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '2px'
        }}
      >
        {props.label}
      </span>
      <span
        style={{
          fontSize: '16px',
          fontWeight: 700,
          color: props.highlight ? '#38bdf8' : '#f8fafc'
        }}
      >
        {props.value}
      </span>
    </div>
  );
}
