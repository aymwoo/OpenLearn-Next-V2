import type {
  HardwareDeviceType,
  HardwareStandardAction,
  HardwareEvent,
} from '../types';

export type HardwareEventListener = (event: HardwareEvent) => void;

export class HardwareBridgeService {
  private static instance: HardwareBridgeService | null = null;
  private listeners: Set<HardwareEventListener> = new Set();
  private deviceBindings: Map<string, { studentId: string; studentNumber: string; studentName?: string }> = new Map();
  private isSimulationMode: boolean = false;

  private constructor() {
    this.initKeyboardSimulationListener();
  }

  public static getInstance(): HardwareBridgeService {
    if (!HardwareBridgeService.instance) {
      HardwareBridgeService.instance = new HardwareBridgeService();
    }
    return HardwareBridgeService.instance;
  }

  /**
   * 绑定硬件答题器 ID 到具体学生
   */
  public bindDeviceToStudent(deviceId: string, studentId: string, studentNumber: string, studentName?: string): void {
    this.deviceBindings.set(deviceId, { studentId, studentNumber, studentName });
  }

  public getDeviceBinding(deviceId: string) {
    return this.deviceBindings.get(deviceId);
  }

  public getAllBindings() {
    return Array.from(this.deviceBindings.entries()).map(([deviceId, info]) => ({
      deviceId,
      ...info,
    }));
  }

  /**
   * 硬件驱动或网关调用入口：将底层原始报文转换为标准化平台事件
   */
  public dispatchRawInput(raw: {
    deviceId: string;
    deviceType: HardwareDeviceType;
    keyOrAction: string;
    value?: any;
  }): HardwareEvent {
    let standardAction: HardwareStandardAction = 'CLICKER_SUBMIT_OPTION';

    if (raw.deviceType === 'RF_CLICKER') {
      const keyUpper = String(raw.keyOrAction).toUpperCase();
      if (['A', 'B', 'C', 'D', 'E', 'F', 'TRUE', 'FALSE'].includes(keyUpper)) {
        standardAction = 'CLICKER_SUBMIT_OPTION';
      } else if (keyUpper === 'BUZZER' || keyUpper === 'OK' || keyUpper === 'ENTER') {
        standardAction = 'CLICKER_BUZZER_PRESS';
      }
    } else if (raw.deviceType === 'PRESENTER_PEN') {
      const key = String(raw.keyOrAction).toLowerCase();
      if (key === 'pagedown' || key === 'right' || key === 'next') {
        standardAction = 'PRESENTER_NEXT_PAGE';
      } else if (key === 'pageup' || key === 'left' || key === 'prev') {
        standardAction = 'PRESENTER_PREV_PAGE';
      } else if (key === 'laser' || key === 'b') {
        standardAction = 'PRESENTER_LASER_TOGGLE';
      } else if (key === 'blank' || key === 'period' || key === '.') {
        standardAction = 'PRESENTER_BLANK_SCREEN';
      }
    } else if (raw.deviceType === 'DIGITAL_TABLET') {
      standardAction = 'TABLET_DRAW_STROKE';
    }

    const binding = this.deviceBindings.get(raw.deviceId);

    const event: HardwareEvent = {
      deviceId: raw.deviceId,
      deviceType: raw.deviceType,
      action: standardAction,
      studentId: binding?.studentId,
      studentNumber: binding?.studentNumber,
      value: raw.value ?? raw.keyOrAction,
      rawPayload: raw,
      timestamp: Date.now(),
    };

    this.notify(event);
    return event;
  }

  /**
   * 键盘仿真模式：在开发或无物理设备调试时，监听快捷键模拟翻页笔与答题器
   */
  public enableKeyboardSimulation(enable: boolean = true): void {
    this.isSimulationMode = enable;
  }

  private initKeyboardSimulationListener(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (!this.isSimulationMode) return;

      // 翻页笔快捷键监听 (PageDown / PageUp)
      if (e.key === 'PageDown') {
        this.dispatchRawInput({
          deviceId: 'virtual-presenter-01',
          deviceType: 'PRESENTER_PEN',
          keyOrAction: 'next',
        });
      } else if (e.key === 'PageUp') {
        this.dispatchRawInput({
          deviceId: 'virtual-presenter-01',
          deviceType: 'PRESENTER_PEN',
          keyOrAction: 'prev',
        });
      }
    });
  }

  public subscribe(listener: HardwareEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: HardwareEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error('Error executing hardware event listener:', err);
      }
    });
  }
}

export const hardwareBridgeService = HardwareBridgeService.getInstance();
