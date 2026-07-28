import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClassPasscodeController } from '../ClassPasscodeController';
import type { ClassType } from '../../../../types/app';

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'class-1',
    name: 'Math 101',
    description: '',
    created_at: 0,
    ...overrides,
  };
}

function makeProps(overrides: Partial<ReturnType<typeof baseProps>> = {}) {
  const base = baseProps();
  return { ...base, ...overrides };
}

function baseProps() {
  return {
    cls: makeClass(),
    lang: 'zh' as 'zh' | 'en',
    fetchClasses: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ClassPasscodeController', () => {
  it('renders the zh passcode label when lang is zh', () => {
    render(<ClassPasscodeController {...makeProps()} />);
    expect(screen.getByText('临时班级密码 (支持学生快速一键密码登录)')).toBeTruthy();
  });

  it('renders the en passcode label when lang is en', () => {
    render(<ClassPasscodeController {...makeProps({ lang: 'en' })} />);
    expect(screen.getByText('Temporary Class Passcode')).toBeTruthy();
  });

  it('issues a PUT and refreshes on random-generate click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const props = makeProps();
    render(<ClassPasscodeController {...props} />);

    fireEvent.click(screen.getByTitle('随机生成班级密码'));

    // allow async handlers to resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/classes/class-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toHaveProperty('class_passcode');
    expect(props.fetchClasses).toHaveBeenCalledTimes(1);
  });

  it('shows the clear button only when a passcode exists', () => {
    const { rerender } = render(<ClassPasscodeController {...makeProps({ cls: makeClass({ class_passcode: '1234' }) })} />);
    expect(screen.getByTitle('清除临时密码')).toBeTruthy();
    rerender(<ClassPasscodeController {...makeProps({ cls: makeClass() })} />);
    expect(screen.queryByTitle('清除临时密码')).toBeNull();
  });
});
