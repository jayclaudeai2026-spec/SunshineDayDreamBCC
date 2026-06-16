import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Top-level error boundary. Catches render errors anywhere in the tree and
// shows a friendly recovery screen instead of a blank page. Logs to console
// so developer tools surface the stack.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('BCC ErrorBoundary caught:', error, info);
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-ia-cream">
        <div className="ia-card max-w-xl w-full">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-ia-danger flex-shrink-0 mt-1" size={24} />
            <div className="flex-1">
              <h2 className="text-ia-navy">Something went wrong</h2>
              <p className="mt-2 text-sm text-ia-muted">
                The BCC hit an unexpected error. The error has been logged. You can try
                to recover the current view, or refresh the page to start fresh.
              </p>
              {this.state.error?.message && (
                <pre className="mt-3 text-xs bg-ia-cream-dark p-2 rounded overflow-auto max-h-32">
                  {String(this.state.error.message)}
                </pre>
              )}
              <div className="mt-4 flex gap-2">
                <button className="ia-button" onClick={this.handleReset}>
                  Try to recover
                </button>
                <button className="ia-button-ghost" onClick={() => window.location.reload()}>
                  Refresh page
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
