/**
 * System Error and Diagnostics Types for OpenLearn
 */

export type SystemErrorType = 'react' | 'promise' | 'runtime' | 'api' | 'custom';

export interface SystemErrorItem {
  id: string;
  type: SystemErrorType;
  title: string;
  message: string;
  stack?: string;
  componentStack?: string;
  endpoint?: string;
  status?: number;
  timestamp: number;
  url: string;
  userAgent?: string;
}
