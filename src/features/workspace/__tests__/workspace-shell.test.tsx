import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  WorkspaceSlotRegistry,
  WorkspaceProvider,
  WorkspaceLayout,
  useWorkspaceSlot,
} from '../index.js';

describe('Sprint P1-01 Workspace Shell Test Suite', () => {
  it('should register, sort by priority, and unregister slot providers in WorkspaceSlotRegistry', () => {
    const registry = new WorkspaceSlotRegistry();

    registry.register({
      id: 'provider_topbar_default',
      slot: 'TopBar',
      priority: 10,
      render: () => <div data-testid="topbar-default">Default TopBar</div>,
    });

    registry.register({
      id: 'provider_topbar_high',
      slot: 'TopBar',
      priority: 100,
      render: () => <div data-testid="topbar-high">High Priority TopBar</div>,
    });

    const providers = registry.getProviders('TopBar');
    expect(providers.length).toBe(2);
    expect(providers[0].id).toBe('provider_topbar_high');

    registry.unregister('provider_topbar_high');
    expect(registry.getProviders('TopBar').length).toBe(1);
  });

  it('should render custom slot providers in WorkspaceLayout correctly', () => {
    const registry = new WorkspaceSlotRegistry();

    registry.register({
      id: 'provider_topbar',
      slot: 'TopBar',
      render: () => <header data-testid="official-topbar">Classroom Header</header>,
    });

    registry.register({
      id: 'provider_canvas',
      slot: 'MainCanvas',
      render: () => <main data-testid="official-canvas">Canvas Stage</main>,
    });

    render(
      <WorkspaceProvider registry={registry}>
        <WorkspaceLayout />
      </WorkspaceProvider>
    );

    expect(screen.getByTestId('official-topbar')).toBeDefined();
    expect(screen.getByTestId('official-canvas')).toBeDefined();
  });

  it('should dynamically update slots when slot providers are added via context', () => {
    const registry = new WorkspaceSlotRegistry();

    const TestComponent: React.FC = () => {
      const providers = useWorkspaceSlot('StatusBar');
      return (
        <div>
          {providers.map((p) => (
            <React.Fragment key={p.id}>{p.render()}</React.Fragment>
          ))}
        </div>
      );
    };

    const { rerender } = render(
      <WorkspaceProvider registry={registry}>
        <TestComponent />
      </WorkspaceProvider>
    );

    expect(screen.queryByTestId('status-bar-item')).toBeNull();

    registry.register({
      id: 'provider_statusbar',
      slot: 'StatusBar',
      render: () => <footer data-testid="status-bar-item">Ready</footer>,
    });

    rerender(
      <WorkspaceProvider registry={registry}>
        <TestComponent />
      </WorkspaceProvider>
    );

    expect(screen.getByTestId('status-bar-item')).toBeDefined();
  });
});
