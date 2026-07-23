/**
 * OpenLearn AI Teacher Workspace Widget Component (Sprint P5-05)
 * First-class Workspace Widget converting AI UI into a teaching assistant panel.
 */

import React, { useState } from 'react';
import {
  AITeacherWorkspaceSection,
  AIWidgetDockPosition,
  AITeacherWorkspaceState,
} from './ai-teacher-workspace-types.js';

export interface AITeacherWorkspaceWidgetProps {
  widgetId?: string;
  initialSection?: AITeacherWorkspaceSection;
  onActionExecute?: (actionId: string, params?: Record<string, unknown>) => void;
}

export const AITeacherWorkspaceWidget: React.FC<AITeacherWorkspaceWidgetProps> = ({
  widgetId = 'widget_ai_teacher_workspace',
  initialSection = 'Lesson Assistant',
  onActionExecute,
}) => {
  const [state, setState] = useState<AITeacherWorkspaceState>({
    widgetId,
    visible: true,
    pinned: true,
    collapsed: false,
    fullscreen: false,
    dockPosition: 'right',
    activeSection: initialSection,
  });

  if (!state.visible) {
    return null;
  }

  const sections: AITeacherWorkspaceSection[] = [
    'Lesson Assistant',
    'Whiteboard Assistant',
    'Resource Assistant',
    'Activity Assistant',
    'Student Assistant',
    'Assessment Assistant',
    'Summary Assistant',
    'Plugin Assistant',
  ];

  const handleActionClick = (actionId: string) => {
    if (onActionExecute) {
      onActionExecute(actionId, { section: state.activeSection });
    }
  };

  return (
    <div
      data-testid="ai-teacher-workspace-widget"
      className={`ai-teacher-workspace-panel ${state.dockPosition} ${
        state.collapsed ? 'collapsed' : ''
      } ${state.fullscreen ? 'fullscreen' : ''}`}
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        background: '#ffffff',
        padding: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Widget Header Control Bar */}
      <div
        className="ai-widget-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #f1f5f9',
          paddingBottom: '8px',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>
          🤖 AI Teacher Assistant
        </span>
        <div className="ai-widget-controls" style={{ display: 'flex', gap: '4px' }}>
          <button
            data-testid="btn-pin"
            onClick={() => setState((prev) => ({ ...prev, pinned: !prev.pinned }))}
            style={{ fontSize: '12px', cursor: 'pointer' }}
          >
            {state.pinned ? '📌 Unpin' : '📍 Pin'}
          </button>
          <button
            data-testid="btn-dock"
            onClick={() =>
              setState((prev) => ({
                ...prev,
                dockPosition: prev.dockPosition === 'right' ? 'float' : 'right',
              }))
            }
            style={{ fontSize: '12px', cursor: 'pointer' }}
          >
            {state.dockPosition === 'right' ? '🌊 Float' : '📥 Dock'}
          </button>
          <button
            data-testid="btn-fullscreen"
            onClick={() => setState((prev) => ({ ...prev, fullscreen: !prev.fullscreen }))}
            style={{ fontSize: '12px', cursor: 'pointer' }}
          >
            {state.fullscreen ? '🗗 Restore' : '⛶ Fullscreen'}
          </button>
          <button
            data-testid="btn-collapse"
            onClick={() => setState((prev) => ({ ...prev, collapsed: !prev.collapsed }))}
            style={{ fontSize: '12px', cursor: 'pointer' }}
          >
            {state.collapsed ? '➕ Expand' : '➖ Collapse'}
          </button>
        </div>
      </div>

      {!state.collapsed && (
        <>
          {/* Section Selector */}
          <div
            className="ai-section-tabs"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              marginBottom: '12px',
            }}
          >
            {sections.map((sec) => (
              <button
                key={sec}
                data-testid={`tab-${sec.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setState((prev) => ({ ...prev, activeSection: sec }))}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  background: state.activeSection === sec ? '#3b82f6' : '#f8fafc',
                  color: state.activeSection === sec ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                }}
              >
                {sec}
              </button>
            ))}
          </div>

          {/* Section Action Panel */}
          <div className="ai-section-body" style={{ minHeight: '100px' }}>
            <div style={{ fontSize: '13px', color: '#475569', marginBottom: '8px' }}>
              Active Assistant: <strong>{state.activeSection}</strong>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                data-testid="btn-summarize"
                onClick={() => handleActionClick('ai_summarize_lesson')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                📝 Summarize Content
              </button>
              <button
                data-testid="btn-explain"
                onClick={() => handleActionClick('ai_explain_whiteboard')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                🎨 Explain Visuals
              </button>
              <button
                data-testid="btn-quiz"
                onClick={() => handleActionClick('ai_generate_quiz')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: '#fefce8',
                  border: '1px solid #fef08a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                ⚡ Generate Quiz
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
