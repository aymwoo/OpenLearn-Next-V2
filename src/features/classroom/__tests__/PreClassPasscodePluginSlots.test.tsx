import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreClassReadyView } from '../PreClassReadyView';

// Mock ExtensionPointRenderer to verify plugin slot behavior
vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: ({ slot, slotProps }: { slot: string; slotProps?: any }) => (
    <div data-testid={`plugin-slot-${slot}`} data-slot-props={JSON.stringify(slotProps || {})}>
      Slot: {slot}
    </div>
  ),
}));

describe('PreClassReadyView 班级上课临时密码与第三方插件扩展槽', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染班级临时密码卡片并预留第三方插件扩展槽', async () => {
    // 模拟 fetch 返回班级临时密码
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classes/class-101/passcode')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              classId: 'class-101',
              className: '高一(1)班',
              classPasscode: '7788',
              expiresAt: Date.now() + 3600000,
              isExpired: false,
              remainingSeconds: 3600,
              studentCount: 30,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });

    render(
      <PreClassReadyView
        selectedLesson="lesson-1"
        lessonTitle="物理教学"
        selectedClassId="class-101"
        className="高一(1)班"
        students={[{ id: 's1', name: '张三' } as any]}
        onlineStudentIds={['s1']}
        timelineSegments={[]}
        lang="zh"
        isClassLocked={false}
        onToggleClassLock={vi.fn()}
        onStartClass={vi.fn()}
        onOpenStudentWindow={vi.fn()}
        isStudentWindowOpen={false}
        addToast={vi.fn()}
      />,
    );

    // 1. 验证班级临时密码标题及说明文案
    expect(screen.getByText('班级上课临时密码')).toBeDefined();
    expect(screen.getByText(/设置后所在班级学生可凭此临时密码或个人密码登录系统/)).toBeDefined();

    // 2. 验证异步拉取到的密码展示
    await waitFor(() => {
      expect(screen.getByText('7788')).toBeDefined();
    });

    // 3. 验证预留的第三方插件扩展槽
    const actionSlot = screen.getByTestId('plugin-slot-classroom.preclass.passcode_action');
    expect(actionSlot).toBeDefined();
    const actionProps = JSON.parse(actionSlot.getAttribute('data-slot-props') || '{}');
    expect(actionProps.classId).toBe('class-101');
    expect(actionProps.classPasscode).toBe('7788');

    const addonSlot = screen.getByTestId('plugin-slot-classroom.preclass.passcode_addon');
    expect(addonSlot).toBeDefined();
    const addonProps = JSON.parse(addonSlot.getAttribute('data-slot-props') || '{}');
    expect(addonProps.classId).toBe('class-101');
  });

  it('点击随机生成密码会触发 PUT 请求更新班级口令', async () => {
    let putRequested = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/api/classes/class-101/passcode')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              classId: 'class-101',
              className: '高一(1)班',
              classPasscode: null,
              expiresAt: null,
              isExpired: false,
              remainingSeconds: null,
              studentCount: 30,
            }),
        });
      }
      if (url.includes('/api/classes/class-101') && init?.method === 'PUT') {
        putRequested = true;
        const body = JSON.parse(init.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, passcode: body.class_passcode }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });

    const addToast = vi.fn();
    render(
      <PreClassReadyView
        selectedLesson="lesson-1"
        lessonTitle="物理教学"
        selectedClassId="class-101"
        className="高一(1)班"
        students={[{ id: 's1', name: '张三' } as any]}
        onlineStudentIds={['s1']}
        timelineSegments={[]}
        lang="zh"
        isClassLocked={false}
        onToggleClassLock={vi.fn()}
        onStartClass={vi.fn()}
        onOpenStudentWindow={vi.fn()}
        isStudentWindowOpen={false}
        addToast={addToast}
      />,
    );

    // 等待未设定口令状态渲染
    await waitFor(() => {
      expect(screen.getByText('未设定')).toBeDefined();
    });

    // 点击“随机生成密码”按钮
    const genBtn = screen.getByText('随机生成密码');
    fireEvent.click(genBtn);

    await waitFor(() => {
      expect(putRequested).toBe(true);
      expect(addToast).toHaveBeenCalled();
    });
  });
});
