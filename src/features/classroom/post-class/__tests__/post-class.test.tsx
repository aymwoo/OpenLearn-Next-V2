import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  generateCoPilotReflection,
  buildFollowupTiers,
  classifyStudentTier,
  generateStudentPersonalDigest,
  DifferentiatedFollowupHub,
  StudentLearningDigestModal,
} from '../index';
import type { RawStudentRecord } from '../followup-tiering-engine';

afterEach(cleanup);

describe('post-class copilot reflection & followup tiering', () => {
  const mockStudents: RawStudentRecord[] = [
    {
      id: 'st-1',
      name: '张同学',
      studentNumber: '101',
      attendance: '出勤',
      quizScore: 95,
      accuracy: 1.0,
      pollsAnswered: 4,
      rating: 5,
    },
    {
      id: 'st-2',
      name: '李同学',
      studentNumber: '102',
      attendance: '出勤',
      quizScore: 78,
      accuracy: 0.78,
      pollsAnswered: 2,
      rating: 3,
    },
    {
      id: 'st-3',
      name: '王同学',
      studentNumber: '103',
      attendance: '出勤',
      quizScore: 55,
      accuracy: 0.55,
      pollsAnswered: 1,
      rating: 2,
      puzzledConcept: '牛顿第二定律变式',
    },
  ];

  it('generateCoPilotReflection: 准确量化归因高讲授时长与困惑波峰', () => {
    const report = generateCoPilotReflection({
      lessonTitle: '牛顿第二定律',
      durationMin: 45,
      totalStudents: 30,
      quizAccuracy: 72,
      interactiveCount: 10,
      pacingData: { CLEAR: 15, CONFUSED: 5, TOO_FAST: 2 },
      primaryPuzzledConcept: '加速度与力正交分解',
    });

    expect(report.lectureRatio).toBeGreaterThan(55);
    expect(report.bottlenecks.some((b) => b.title.includes('单向讲授用时偏高'))).toBe(true);
    expect(report.pacingAlerts.length).toBeGreaterThan(0);
    expect(report.actionableSuggestions.some((s) => s.timing === 'next_pre_class')).toBe(true);
  });

  it('classifyStudentTier: 能够区分 A/B/C 三级能力梯队', () => {
    expect(classifyStudentTier(mockStudents[0])).toBe('TIER_A_ADVANCED');
    expect(classifyStudentTier(mockStudents[1])).toBe('TIER_B_STANDARD');
    expect(classifyStudentTier(mockStudents[2])).toBe('TIER_C_REINFORCE');
  });

  it('buildFollowupTiers: 正确归组并生成差异化资源包', () => {
    const tiers = buildFollowupTiers(mockStudents, '力学基础');
    expect(tiers).toHaveLength(3);
    const tierA = tiers.find((t) => t.tier === 'TIER_A_ADVANCED');
    const tierB = tiers.find((t) => t.tier === 'TIER_B_STANDARD');
    const tierC = tiers.find((t) => t.tier === 'TIER_C_REINFORCE');

    expect(tierA?.students.map((s) => s.studentName)).toContain('张同学');
    expect(tierB?.students.map((s) => s.studentName)).toContain('李同学');
    expect(tierC?.students.map((s) => s.studentName)).toContain('王同学');
  });

  it('generateStudentPersonalDigest: 授予勋章并生成家长端文案', () => {
    const digestA = generateStudentPersonalDigest(mockStudents[0], '牛顿第二定律', '高一(1)班');
    expect(digestA.badges.some((b) => b.name === '神准解题官' || b.name === '抢答先锋')).toBe(true);
    expect(digestA.parentReportText).toContain('高一(1)班·课堂成长日报');
    expect(digestA.parentReportText).toContain('张同学');

    const digestC = generateStudentPersonalDigest(mockStudents[2], '牛顿第二定律', '高一(1)班');
    expect(digestC.parentReportText).toContain('牛顿第二定律变式');
  });

  it('DifferentiatedFollowupHub: 交互与一键派发', async () => {
    const initialTiers = buildFollowupTiers(mockStudents, '力学基础');
    const onDispatch = vi.fn();
    const addToast = vi.fn();

    render(
      <DifferentiatedFollowupHub
        initialTiers={initialTiers}
        lessonTitle="力学基础"
        onDispatchHomework={onDispatch}
        addToast={addToast}
      />,
    );

    expect(screen.getByText('差异化课后巩固派发中枢 (Differentiated Follow-up Hub)')).toBeTruthy();
    expect(screen.getByText('张同学')).toBeTruthy();

    const dispatchBtn = screen.getByRole('button', { name: /一键派发至全班/i });
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(onDispatch).toHaveBeenCalledTimes(1);
      expect(addToast).toHaveBeenCalledWith(
        expect.stringContaining('差异化课后任务已成功派发'),
        expect.any(String),
        'success',
      );
    });
  });

  it('StudentLearningDigestModal: 渲染个人小结与复制文案', async () => {
    const digest = generateStudentPersonalDigest(mockStudents[0], '牛顿第二定律', '高一(1)班');
    const onClose = vi.fn();
    const addToast = vi.fn();

    render(<StudentLearningDigestModal digest={digest} onClose={onClose} addToast={addToast} />);

    expect(screen.getByText('张同学')).toBeTruthy();
    expect(screen.getByText('95分')).toBeTruthy();
    expect(screen.getByText(/当堂获得成就勋章/i)).toBeTruthy();

    const copyBtn = screen.getByRole('button', { name: /一键复制文案/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalled();
    });
  });
});
