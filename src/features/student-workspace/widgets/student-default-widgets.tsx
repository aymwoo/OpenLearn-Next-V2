/**
 * OpenLearn Student Workspace — Default Widget Wrappers (Sprint P6-01)
 *
 * Thin presentational wrappers that mount EXISTING, reusable implementations
 * inside the Workspace Shell slots. No business logic is duplicated here —
 * each wrapper reuses an official component or registry.
 *
 *   - Whiteboard        → LazyWhiteboard (existing)
 *   - Assignments       → StudentAssignmentEvalPanel (existing)
 *   - Notifications     → NotificationsDropdown (existing)
 *   - AI Learning Asst. → AITeacherWorkspaceWidget (existing AI widget, reused)
 *   - Resources         → ResourceRegistry (existing)
 *   - Activities        → ActivityRegistry (existing)
 *   - Broadcast         → Classroom Runtime event bus (existing)
 *   - Plugin Widgets    → ExtensionPointRenderer 'student.view' (existing)
 */

import React, { useEffect, useState } from 'react';
import { LazyWhiteboard } from '../../../components/LazyWhiteboard.js';
import { StudentAssignmentEvalPanel } from '../../../components/StudentAssignmentEvalPanel.js';
import { NotificationsDropdown } from '../../modals/NotificationsDropdown.js';
import { AITeacherWorkspaceWidget } from '../../ai-teacher-workspace/ai-teacher-workspace-widget.js';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer.js';
import { ResourceRegistry } from '../../resource-runtime/resource-registry.js';
import { ActivityRegistry } from '../../activity-workflow/activity-registry.js';
import type { StudentWorkspaceContext } from '../student-workspace/student-workspace-context.js';

const panelBase: React.CSSProperties = {
  padding: '12px',
  color: '#e2e8f0',
  fontSize: '13px',
};

// ── Whiteboard ───────────────────────────────────────────────────────────
export const StudentWhiteboardWidget: React.FC = () => (
  <div style={{ width: '100%', height: '100%' }}>
    <LazyWhiteboard />
  </div>
);

// ── Lesson ──────────────────────────────────────────────────────────────
export const StudentLessonWidget: React.FC<{ context: StudentWorkspaceContext }> = ({ context }) => {
  const view = context.getView();
  return (
    <div style={panelBase}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>📘 Lesson</div>
      <div>Lesson ID: {view.lessonId ?? '—'}</div>
      <div>Course ID: {view.courseId ?? '—'}</div>
    </div>
  );
};

// ── Resources (reuses ResourceRegistry) ─────────────────────────────────
export const StudentResourcesWidget: React.FC = () => {
  const [resources] = useState(() => new ResourceRegistry().listResources());
  return (
    <div style={panelBase}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>📂 Resources</div>
      {resources.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No resources shared yet.</div>
      ) : (
        <ul>
          {resources.map((r) => (
            <li key={r.id}>{r.type}: {r.url}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Activities (reuses ActivityRegistry) ────────────────────────────────
export const StudentActivitiesWidget: React.FC = () => {
  const [providers] = useState(() => new ActivityRegistry().listProviders());
  return (
    <div style={panelBase}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>🧩 Activities</div>
      {providers.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No active activities.</div>
      ) : (
        <ul>
          {providers.map((p) => (
            <li key={p.id}>{p.type}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Assignments (reuses StudentAssignmentEvalPanel) ─────────────────────
export const StudentAssignmentsWidget: React.FC<{
  studentId: string;
  lessonId?: string;
  lang?: 'en' | 'zh';
}> = ({ studentId, lessonId, lang = 'en' }) => {
  if (!lessonId) {
    return <div style={panelBase}>No active lesson — assignments unavailable.</div>;
  }
  return (
    <StudentAssignmentEvalPanel
      lessonId={lessonId}
      studentId={studentId}
      lang={lang}
      addToast={() => {}}
    />
  );
};

// ── Teacher Broadcast (reuses Classroom Runtime event bus) ───────────────
export const StudentBroadcastWidget: React.FC<{ context: StudentWorkspaceContext }> = ({ context }) => {
  const [feed, setFeed] = useState<Array<{ id: string; text: string }>>([]);
  useEffect(() => {
    const unsubStarted = context.subscribe('LessonStarted', (p) => {
      setFeed((prev) => [...prev, { id: `ls_${p.timestamp}`, text: `Lesson started (${p.lessonId})` }]);
    });
    const unsubStage = context.subscribe('StageChanged', (p) => {
      setFeed((prev) => [...prev, { id: `sc_${p.timestamp}`, text: `Stage changed → ${p.toStageId}` }]);
    });
    return () => {
      unsubStarted();
      unsubStage();
    };
  }, [context]);
  return (
    <div style={panelBase}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>📣 Teacher Broadcast</div>
      {feed.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No announcements yet.</div>
      ) : (
        <ul>
          {feed.map((f) => (
            <li key={f.id}>{f.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── AI Learning Assistant (reuses the existing AI widget) ───────────────
export const StudentAILearningAssistantWidget: React.FC = () => <AITeacherWorkspaceWidget />;

// ── Notifications (reuses NotificationsDropdown) ────────────────────────
export const StudentNotificationsWidget: React.FC<{ studentId: string; lang?: string }> = ({
  studentId,
  lang = 'en',
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [notifications] = useState<any[]>([]);
  return (
    <NotificationsDropdown
      isOpen={isOpen}
      lang={lang}
      activeStudentId={studentId}
      studentNotifications={notifications}
      readNotifications={read}
      setReadNotifications={setRead}
      studentDashboardData={null}
      setIsNotificationsOpen={setIsOpen}
      setSelectedNotificationForModal={() => {}}
    />
  );
};

// ── Plugin Widgets (reuses ExtensionPointRenderer for 'student.view') ────
export const StudentPluginWidgets: React.FC = () => (
  <ExtensionPointRenderer slot="student.view" />
);
