import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  edgeLanDetector,
  hardwareBridgeService,
  classroomMacroEngine,
  CLASSROOM_MACRO_PRESETS,
  EdgeLanStatusIndicator,
  HardwareBridgeSettingsModal,
  ClassroomMacroRunnerModal,
} from '../index';

afterEach(() => {
  cleanup();
  classroomMacroEngine.reset();
});

describe('Ecosystem & Architecture Subsystem', () => {
  describe('1. Edge LAN Mesh Fallback (EdgeLanDetector)', () => {
    it('能够正确识别并降级到 EDGE_LAN_ONLY 模式并缓存离线事件', async () => {
      await edgeLanDetector.setSimulatedState(false, true); // 外网断，本地通
      const state = edgeLanDetector.getState();
      expect(state.mode).toBe('EDGE_LAN_ONLY');
      expect(state.isInternetReachable).toBe(false);
      expect(state.isLocalServerReachable).toBe(true);

      // 暂存离线学情日志
      edgeLanDetector.recordOfflineEvent('quiz_submission', { score: 100 });
      expect(edgeLanDetector.getState().bufferedOfflineEventsCount).toBe(1);

      // 设置对账刷新回调并恢复网络
      const flushHandler = vi.fn().mockResolvedValue(true);
      edgeLanDetector.setSyncFlushHandler(flushHandler);

      await edgeLanDetector.setSimulatedState(true, true); // 外网恢复
      expect(edgeLanDetector.getState().mode).toBe('CLOUD_ONLINE');
      expect(flushHandler).toHaveBeenCalledTimes(1);
      expect(edgeLanDetector.getState().bufferedOfflineEventsCount).toBe(0);
    });
  });

  describe('2. Hardware Bridge Standardization (hardwareBridgeService)', () => {
    it('将物理答题器与翻页笔原始报文标准化为系统事件', () => {
      hardwareBridgeService.bindDeviceToStudent('clicker-101', 'st-1', '202601', '张同学');
      const listener = vi.fn();
      const unsub = hardwareBridgeService.subscribe(listener);

      // 模拟答题器按下按键 A
      const ev1 = hardwareBridgeService.dispatchRawInput({
        deviceId: 'clicker-101',
        deviceType: 'RF_CLICKER',
        keyOrAction: 'A',
      });
      expect(ev1.action).toBe('CLICKER_SUBMIT_OPTION');
      expect(ev1.studentNumber).toBe('202601');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ action: 'CLICKER_SUBMIT_OPTION' }));

      // 模拟答题器按下抢答键
      const ev2 = hardwareBridgeService.dispatchRawInput({
        deviceId: 'clicker-101',
        deviceType: 'RF_CLICKER',
        keyOrAction: 'BUZZER',
      });
      expect(ev2.action).toBe('CLICKER_BUZZER_PRESS');

      // 模拟翻页笔按下 PageDown
      const ev3 = hardwareBridgeService.dispatchRawInput({
        deviceId: 'pen-01',
        deviceType: 'PRESENTER_PEN',
        keyOrAction: 'pagedown',
      });
      expect(ev3.action).toBe('PRESENTER_NEXT_PAGE');

      unsub();
    });
  });

  describe('3. Classroom Action Macros (ClassroomMacroEngine)', () => {
    it('执行 3分钟随堂突击检测 宏动作流并顺利完成', async () => {
      const stepExecutor = vi.fn().mockResolvedValue(true);
      classroomMacroEngine.setStepExecutor(stepExecutor);

      const successPromise = classroomMacroEngine.runMacro('MACRO_BURST_QUIZ');
      const result = await successPromise;

      expect(result).toBe(true);
      expect(stepExecutor).toHaveBeenCalledTimes(5);
      expect(classroomMacroEngine.getState().status).toBe('completed');
      expect(classroomMacroEngine.getState().progressPercent).toBe(100);
    });

    it('支持教师在执行过程中手动中止宏动作', async () => {
      let stepCount = 0;
      classroomMacroEngine.setStepExecutor(async () => {
        stepCount++;
        if (stepCount === 2) {
          classroomMacroEngine.abortCurrentMacro();
        }
      });

      const result = await classroomMacroEngine.runMacro('MACRO_BURST_QUIZ');
      expect(result).toBe(false);
      expect(classroomMacroEngine.getState().status).toBe('aborted');
    });
  });

  describe('4. Ecosystem UI Components', () => {
    it('EdgeLanStatusIndicator: 展开浮层并展示网络拓扑', () => {
      render(<EdgeLanStatusIndicator />);
      const btn = screen.getByRole('button');
      fireEvent.click(btn);

      expect(screen.getByText('网络拓扑与边缘节点监控')).toBeTruthy();
      expect(screen.getByText('智慧教室本地主机')).toBeTruthy();
    });

    it('HardwareBridgeSettingsModal: 模拟按键触发', () => {
      const addToast = vi.fn();
      render(<HardwareBridgeSettingsModal isOpen={true} onClose={vi.fn()} addToast={addToast} />);

      expect(screen.getByText('硬件教具生态标准化网关 (Hardware Bridge)')).toBeTruthy();

      const btnA = screen.getByRole('button', { name: /按键 A/i });
      fireEvent.click(btnA);

      expect(addToast).toHaveBeenCalledWith(
        expect.stringContaining('模拟硬件触发'),
        expect.stringContaining('A'),
        'info',
      );
    });

    it('ClassroomMacroRunnerModal: 选择并一键执行宏动作', async () => {
      const addToast = vi.fn();
      render(<ClassroomMacroRunnerModal isOpen={true} onClose={vi.fn()} addToast={addToast} />);

      expect(screen.getByText(/课堂宏动作编排中枢/i)).toBeTruthy();

      const runBtn = screen.getByRole('button', { name: /立即一键执行宏动作/i });
      fireEvent.click(runBtn);

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith(
          expect.stringContaining('教学动作流启动'),
          expect.any(String),
          'info',
        );
      });
    });
  });
});
