import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AccessibleTableRegion } from '../AccessibleTableRegion';
import { PasswordInput } from '../PasswordInput';
import { LiveSubmissionsPanel } from '../../features/classroom/LiveSubmissionsPanel';

afterEach(() => {
  cleanup();
});

describe('AccessibleTableRegion & Responsive Table Semantics (#489)', () => {
  it('exposes focusable region with aria-labelledby matching the table caption', () => {
    render(
      <AccessibleTableRegion labelledBy="demo-table-caption">
        <table className="responsive-data-table" data-stack-mobile="true">
          <caption id="demo-table-caption" className="sr-only">
            班级成绩概览
          </caption>
          <thead>
            <tr>
              <th scope="col">学生</th>
              <th scope="col">成绩</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" data-label="学生">
                张三
              </th>
              <td data-label="成绩">95</td>
            </tr>
          </tbody>
        </table>
      </AccessibleTableRegion>,
    );

    const region = screen.getByRole('region', { name: '班级成绩概览' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('table-scroll-region');
    expect(screen.getByRole('columnheader', { name: '学生' }).getAttribute('scope')).toBe('col');
    expect(screen.getByRole('rowheader', { name: '张三' }).getAttribute('scope')).toBe('row');
  });

  it('renders LiveSubmissionsPanel table inside keyboard-focusable region with semantic headers', () => {
    render(
      <LiveSubmissionsPanel
        lang="zh"
        selectedLesson="lesson-1"
        liveClassSelectedClassId="cls-1"
        attempts={[
          {
            attemptId: 'att-1',
            studentId: 'stu-1',
            studentName: '李四',
            coursewareId: 'cw-1',
            coursewareName: '互动练习 A',
            status: 'completed',
            score: 88,
            completion: 1,
            started_at: '2026-11-13T10:00:00Z',
            isPromoted: 0,
          },
        ]}
        displayAttempts={[
          {
            attemptId: 'att-1',
            studentId: 'stu-1',
            studentName: '李四',
            coursewareId: 'cw-1',
            coursewareName: '互动练习 A',
            status: 'completed',
            score: 88,
            completion: 1,
            started_at: '2026-11-13T10:00:00Z',
            isPromoted: 0,
          },
        ]}
        loadingAttempts={false}
        searchQuery=""
        setSearchQuery={() => {}}
        submissionFilter="all"
        setSubmissionFilter={() => {}}
        fetchAttempts={() => {}}
        setMiddleTab={() => {}}
        autoRecordRule={{ enabled: false, minCompletion: 0.8, strategy: 'highest' }}
        autoRecordRuleLoaded={true}
        savingAutoRecordRule={false}
        saveAutoRecordRule={async () => {}}
        autoRecordReport={null}
        runAutoRecord={async () => {}}
        autoRecordRunning={false}
        handleViewRaw={() => {}}
        handlePromoteAttempt={() => {}}
        handleMarkAbsent={async () => {}}
      />,
    );

    const region = screen.getByRole('region', { name: '课堂实时提交列表' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('rowheader', { name: /李四/ }).getAttribute('scope')).toBe('row');
  });
});

describe('PasswordInput (#489)', () => {
  it('only binds error id via aria-describedby while an error is shown and toggles visibility via aria-pressed', () => {
    const { rerender } = render(
      <PasswordInput id="pwd-test" label="登录密码" hint="至少 8 位字符" value="" onChange={() => {}} error={null} />,
    );

    const input = document.getElementById('pwd-test') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBe('pwd-test-hint');

    const toggle = screen.getByRole('button', { name: '显示密码' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    rerender(
      <PasswordInput
        id="pwd-test"
        label="登录密码"
        hint="至少 8 位字符"
        value="short"
        onChange={() => {}}
        error="密码长度不足"
      />,
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('pwd-test-hint pwd-test-error');
    expect(screen.getByText('密码长度不足')).toBeTruthy();
  });
});
