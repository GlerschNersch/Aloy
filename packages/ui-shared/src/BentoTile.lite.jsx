import { useStore } from '@builder.io/mitosis';

export default function BentoTile(props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '18px',
        borderRadius: '16px',
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        border: '1px solid rgba(51, 65, 85, 0.5)',
        boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.35)',
        marginBottom: '12px'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#f8fafc',
              letterSpacing: '-0.01em'
            }}
          >
            {props.title}
          </span>
          {props.subtitle ? (
            <span
              style={{
                fontSize: '12px',
                color: '#94a3b8',
                marginTop: '2px'
              }}
            >
              {props.subtitle}
            </span>
          ) : null}
        </div>
        {props.status ? (
          <div
            style={{
              padding: '3px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)'
            }}
          >
            {props.status}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {props.children}
      </div>
    </div>
  );
}
