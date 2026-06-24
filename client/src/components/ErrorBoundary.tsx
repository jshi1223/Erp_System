import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

// Shows the error text instead of a silent blank page, so problems are visible.
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'Inter, sans-serif', color: '#9b1c1c' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#2a1f1d' }}>{String(this.state.error.message || this.state.error)}</pre>
          <p><a href="/login">Go to login</a></p>
        </div>
      );
    }
    return this.props.children;
  }
}
