/**
 * ClassroomSyncChannel — 互动课堂跨窗口（教师端 ↔ 学生端弹窗）实时协同通信信道
 *
 * 基于现代浏览器原生 BroadcastChannel API 构建，具备以下核心优势：
 * 1. 同源 0 往返网络延迟（1~5ms 瞬时同步）；
 * 2. 状态机握手协议（Handshake）：新弹出的学生窗口加载后立即索取全量授课快照；
 * 3. 双向互动闭环：支持教师端教学指令广播与学生端动作（举手/签到/作答）即时回传。
 */

export interface ClassroomCountdownState {
  lessonId: string | null;
  totalDuration: number;
  timeRemaining: number;
  isRunning: boolean;
  isPaused: boolean;
  label: string;
  endsAt: number | null;
  updatedAt: number;
}

export interface LiveClassSyncState {
  selectedLesson: string | null;
  activeSegmentId: string | null;
  activeTab: 'whiteboard' | 'courseware' | 'assignment';
  isClassLocked: boolean;
  liveClassTimeRemaining: number;
  liveClassSelectedClassId: string | null;
  liveClassIsActive: boolean;
  fullscreenElementId?: string | null;
  countdown?: ClassroomCountdownState | null;
}

export type ClassroomSyncMessage =
  | { type: 'TEACHER_INIT_STATE'; payload: LiveClassSyncState }
  | { type: 'TEACHER_CHANGE_LESSON'; payload: { lessonId: string | null } }
  | { type: 'TEACHER_CHANGE_SEGMENT'; payload: { segmentId: string | null } }
  | { type: 'TEACHER_CHANGE_TAB'; payload: { tab: 'whiteboard' | 'courseware' | 'assignment' } }
  | { type: 'TEACHER_LOCK_CLASS'; payload: { locked: boolean } }
  | { type: 'TEACHER_PICK_STUDENT'; payload: { studentId: string; studentName: string } }
  | { type: 'TEACHER_SYNC_TIMER'; payload: { timeRemaining: number; isRunning: boolean } }
  | { type: 'TEACHER_BROADCAST_COUNTDOWN'; payload: ClassroomCountdownState }
  | { type: 'TEACHER_PING_STUDENT'; payload: { studentId: string; message?: string } }
  | { type: 'TEACHER_BROADCAST_FULLSCREEN'; payload: { elementId: string | null; lessonId?: string } }
  | { type: 'STUDENT_HANDSHAKE_REQUEST' }
  | { type: 'STUDENT_ACKNOWLEDGE_PICK'; payload: { studentId: string } }
  | { type: 'STUDENT_HEARTBEAT'; payload: { studentId: string; timestamp: number } };

export const CLASSROOM_SYNC_CHANNEL_NAME = 'openlearn_live_classroom_sync';

export class ClassroomSyncChannel {
  private channel: BroadcastChannel | null = null;
  private isDestroyed = false;
  private messageListeners: ((msg: ClassroomSyncMessage) => void)[] = [];

  constructor(channelName: string = CLASSROOM_SYNC_CHANNEL_NAME) {
    if (typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = (event: MessageEvent<ClassroomSyncMessage>) => {
        if (this.isDestroyed || !event.data) return;
        this.messageListeners.forEach((listener) => {
          try {
            listener(event.data);
          } catch (e) {
            console.error('[ClassroomSyncChannel] Listener error:', e);
          }
        });
      };
    }
  }

  /**
   * 注册消息监听器
   */
  public onMessage(listener: (msg: ClassroomSyncMessage) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  /**
   * 发送同步消息
   */
  public postMessage(msg: ClassroomSyncMessage): void {
    if (this.isDestroyed || !this.channel) return;
    try {
      this.channel.postMessage(msg);
    } catch (e) {
      console.warn('[ClassroomSyncChannel] Failed to post message:', e);
    }
  }

  // ── 教师端快捷广播方法 ───────────────────────────────────────────────

  public broadcastInitState(state: LiveClassSyncState): void {
    this.postMessage({ type: 'TEACHER_INIT_STATE', payload: state });
  }

  public broadcastChangeLesson(lessonId: string | null): void {
    this.postMessage({ type: 'TEACHER_CHANGE_LESSON', payload: { lessonId } });
  }

  public broadcastChangeSegment(segmentId: string | null): void {
    this.postMessage({ type: 'TEACHER_CHANGE_SEGMENT', payload: { segmentId } });
  }

  public broadcastChangeTab(tab: 'whiteboard' | 'courseware' | 'assignment'): void {
    this.postMessage({ type: 'TEACHER_CHANGE_TAB', payload: { tab } });
  }

  public broadcastLockClass(locked: boolean): void {
    this.postMessage({ type: 'TEACHER_LOCK_CLASS', payload: { locked } });
  }

  public broadcastPickStudent(studentId: string, studentName: string): void {
    this.postMessage({ type: 'TEACHER_PICK_STUDENT', payload: { studentId, studentName } });
  }

  public broadcastSyncTimer(timeRemaining: number, isRunning: boolean): void {
    this.postMessage({ type: 'TEACHER_SYNC_TIMER', payload: { timeRemaining, isRunning } });
  }

  public broadcastCountdown(countdown: ClassroomCountdownState): void {
    this.postMessage({ type: 'TEACHER_BROADCAST_COUNTDOWN', payload: countdown });
    // Also post legacy sync timer for backward compatibility
    this.broadcastSyncTimer(countdown.timeRemaining, countdown.isRunning);
  }

  public broadcastPingStudent(studentId: string, message?: string): void {
    this.postMessage({ type: 'TEACHER_PING_STUDENT', payload: { studentId, message } });
  }

  public broadcastFullscreen(elementId: string | null, lessonId?: string): void {
    this.postMessage({ type: 'TEACHER_BROADCAST_FULLSCREEN', payload: { elementId, lessonId } });
  }

  // ── 学生端快捷回传方法 ───────────────────────────────────────────────

  public requestHandshake(): void {
    this.postMessage({ type: 'STUDENT_HANDSHAKE_REQUEST' });
  }

  public acknowledgePick(studentId: string): void {
    this.postMessage({ type: 'STUDENT_ACKNOWLEDGE_PICK', payload: { studentId } });
  }

  public sendHeartbeat(studentId: string): void {
    this.postMessage({ type: 'STUDENT_HEARTBEAT', payload: { studentId, timestamp: Date.now() } });
  }

  /**
   * 销毁信道连接
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.messageListeners = [];
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
