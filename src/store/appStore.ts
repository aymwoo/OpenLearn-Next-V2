import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  createLessonSlice,
  createClassSlice,
  createLiveClassSlice,
  createSessionSlice,
  createSystemDataSlice,
  createStudentViewSlice,
  createSharedUISlice,
  type LessonSlice,
  type ClassSlice,
  type LiveClassSlice,
  type SessionSlice,
  type SystemDataSlice,
  type StudentViewSlice,
  type SharedUISlice,
} from './slices/index.js';

// ── Combined State interface (assembled from domain slices) ─────────────────

export type AppState = LessonSlice &
  ClassSlice &
  LiveClassSlice &
  SessionSlice &
  SystemDataSlice &
  StudentViewSlice &
  SharedUISlice;

// ── Create vanilla store via Zustand slice pattern ──────────────────────────

export const appStore = createStore<AppState>()((...a) => ({
  ...createLessonSlice(...a),
  ...createClassSlice(...a),
  ...createLiveClassSlice(...a),
  ...createSessionSlice(...a),
  ...createSystemDataSlice(...a),
  ...createStudentViewSlice(...a),
  ...createSharedUISlice(...a),
}));

// ── React-bound hook ───────────────────────────────────────────────────────

export const useAppStore = <T>(selector: (state: AppState) => T) => useStore(appStore, selector);

// ── Re-export domain slices and types for backward compatibility ────────────

export * from './slices/index.js';

export type {
  Lesson,
  WhiteboardElement,
  ClassType,
  StudentType,
  PluginType,
  AIProvider,
  ProcessType,
  VFSNode,
  ScheduleType,
  SessionType,
  Toast,
  AssignmentType,
  SubmissionType,
  AttendanceType,
  StudentProgressType,
} from '../types/app';
