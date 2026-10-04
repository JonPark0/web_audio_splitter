import React from 'react';
import { href } from '../../router';
import TextButton from '../TextButton';

/**
 * Catches a render error in the routed screen so one crash no longer blanks
 * the whole app (header and navigation stay usable). Navigating elsewhere
 * (`resetKey` = the route path) clears it.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Screen crashed:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex max-w-3xl flex-col gap-2 py-4">
        <h1 className="m-0 text-h3 font-light">This screen ran into a problem.</h1>
        <p className="m-0 break-words text-caption">
          <span className="text-muted">Error — </span>
          {String(error?.message || error)}
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <TextButton onClick={() => window.location.reload()}>Reload</TextButton>
          <a href={href('/split')} data-label="Go to Split" className="link">
            Go to Split
          </a>
        </div>
      </div>
    );
  }
}
