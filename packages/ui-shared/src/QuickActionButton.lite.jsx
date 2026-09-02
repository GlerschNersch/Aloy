import { useStore } from '@builder.io/mitosis';

export default function QuickActionButton(props) {
  return (
    <button
      onClick={(event) => {
        if (props.onClick) {
          props.onClick(event);
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px 18px',
        borderRadius: '10px',
        backgroundColor: props.primary ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)',
        color: props.primary ? '#0f172a' : '#f8fafc',
        border: props.primary ? 'none' : '1px solid rgba(255, 255, 255, 0.15)',
        fontWeight: 600,
        fontSize: '13px',
        cursor: 'pointer'
      }}
    >
      {props.label}
    </button>
  );
}
