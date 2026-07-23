/**
 * OpenLearn AI Teacher Workspace Widget - Data Types & Contracts (Sprint P5-05)
 */

export type AITeacherWorkspaceSection =
  | 'Lesson Assistant'
  | 'Whiteboard Assistant'
  | 'Resource Assistant'
  | 'Activity Assistant'
  | 'Student Assistant'
  | 'Assessment Assistant'
  | 'Summary Assistant'
  | 'Plugin Assistant';

export type AIWidgetDockPosition = 'left' | 'right' | 'float' | 'fullscreen';

export interface AITeacherWorkspaceState {
  widgetId: string;
  visible: boolean;
  pinned: boolean;
  collapsed: boolean;
  fullscreen: boolean;
  dockPosition: AIWidgetDockPosition;
  activeSection: AITeacherWorkspaceSection;
}
