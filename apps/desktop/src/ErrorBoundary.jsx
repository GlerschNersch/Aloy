import { Component } from 'react';

// Catches render-time crashes so a bug in one part of the UI shows a
// recoverable screen instead of a blank white window with no way back in
// short of relaunching the whole app.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#0b0f14', color: '#e6edf3', fontFamily: 'sans-serif', padding: 24, textAlign: 'center',
        }}>
          <h2>Aloy hit an unexpected error</h2>
          <pre style={{ maxWidth: 600, whiteSpace: 'pre-wrap', color: '#f87171', fontSize: 13 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#22d3ee', color: '#0b0f14', cursor: 'pointer', fontWeight: 600 }}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
