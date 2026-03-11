import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '2rem', background: '#0f1117', color: '#e2e8f0',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <div style={{
            maxWidth: 480, textAlign: 'center', padding: '2rem',
            background: '#1a1d27', borderRadius: 12, border: '1px solid #2a2d3a'
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 20 }}>
              The application encountered an unexpected error. Your data is safe.
            </p>
            <code style={{
              display: 'block', fontSize: 12, color: '#f87171', background: '#1e1e2e',
              padding: '8px 12px', borderRadius: 6, marginBottom: 20, wordBreak: 'break-word',
              maxHeight: 100, overflow: 'auto', textAlign: 'left'
            }}>
              {this.state.error?.message || 'Unknown error'}
            </code>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 24px', background: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
