/**
 * MfeErrorBoundary — Per-instance React error boundary class component.
 *
 * D-14: Each MfeLoader is wrapped in its own ErrorBoundary instance,
 *       isolating render crashes so one failing remote doesn't break others.
 * D-16: Catches render-phase errors and renders MfeErrorFallback with
 *       retry and dismiss actions.
 * D-17: Manual retry via handleRetry — resets error state to re-render children.
 *
 * Follows the exact class-component pattern from ExtensionErrorBoundary
 * (src/plugin-host/extension-point-renderer.tsx lines 46-82) with enhancements:
 *   - Stores the actual Error object in state (not just boolean)
 *   - Provides onRetry and onDismiss callbacks
 *   - Default fallback component (MfeErrorFallback)
 *   - name prop for per-instance identification logging
 *
 * Usage:
 *   <MfeErrorBoundary name="mfe_whiteboard">
 *     <MfeLoaderCore name="mfe_whiteboard" />
 *   </MfeErrorBoundary>
 */

import React from 'react';
import MfeErrorFallback from '../components/MfeErrorFallback';
import type { MfeErrorFallbackProps } from '../components/MfeErrorFallback';

export interface MfeErrorBoundaryProps {
  children: React.ReactNode;
  /** Remote module name for identification in logs */
  name: string;
  /** Custom error fallback override. Defaults to MfeErrorFallback. */
  fallback?: React.ComponentType<MfeErrorFallbackProps>;
}

interface MfeErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class MfeErrorBoundary extends React.Component<
  MfeErrorBoundaryProps,
  MfeErrorBoundaryState
> {
  constructor(props: MfeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): MfeErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `[MfeErrorBoundary:${this.props.name}]`,
      error,
      errorInfo,
    );
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleDismiss = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const Fallback = this.props.fallback || MfeErrorFallback;
      return (
        <Fallback
          error={this.state.error}
          name={this.props.name}
          onRetry={this.handleRetry}
          onDismiss={this.handleDismiss}
        />
      );
    }

    return this.props.children;
  }
}
