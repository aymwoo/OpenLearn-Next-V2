import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdminPanel } from '../AdminPanel';

describe('AdminPanel (管理后台页面样式规范化与标签切换)', () => {
  const defaultProps = {
    currentUserId: 'usr_admin',
    currentUserRole: 'administrator' as const,
    lang: 'zh' as const,
    onLogout: vi.fn(),
    aiProviders: [
      {
        id: 'prov_1',
        name: 'Demo DeepSeek',
        api_url: 'https://api.deepseek.com/v1',
        model_name: 'deepseek-chat',
      },
    ],
    testingProviderId: null,
    onAIProvidersChanged: vi.fn(),
    siteInfo: {
      siteName: 'OpenLearn Next',
      slogan: 'Next-Gen Educational OS',
      logoUrl: null,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/users') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 'usr_admin',
                username: 'admin',
                name: '系统管理员',
                role: 'administrator',
                created_at: Date.now(),
                status: 'active',
              },
              {
                id: 'usr_teacher1',
                username: 'teacher1',
                name: '张老师',
                role: 'teacher',
                created_at: Date.now(),
                status: 'active',
              },
            ]),
        });
      }
      if (url === '/api/db-status') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'connected',
              type: 'SQLite',
              pageSize: 4096,
              pageCount: 100,
              diskUsageBytes: 409600,
              diskUsageFriendly: '400 KB',
              sizeMb: 0.4,
              tableCount: 14,
              systemTableCount: 2,
              journalMode: 'wal',
              autoVacuum: 0,
              integrity: 'ok',
              freelistCount: 0,
              tables: [{ name: 'users', rows: 2 }],
              totalRows: 2,
              latencyMs: 1.2,
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders within the unified card shell container (rounded-xl, border, shadow-sm)', () => {
    const { container } = render(<AdminPanel {...defaultProps} />);
    const root = container.querySelector('#admin_panel_root');
    expect(root).toBeTruthy();
    const classAttr = root?.getAttribute('class') || '';
    expect(classAttr).toContain('rounded-xl');
    expect(classAttr).toContain('shadow-sm');
    expect(classAttr).toContain('border-gray-200');
  });

  it('renders modern segmented pill tabs and switches active tabs', () => {
    render(<AdminPanel {...defaultProps} />);

    // Default tab: 教职及系统配置
    expect(screen.getByText('学校教职及系统配置')).toBeTruthy();
    expect(screen.getByPlaceholderText('检索姓名、教工用户名...')).toBeTruthy();

    // Switch to AI Providers tab
    const aiProvidersTab = screen.getByText('AI 模型提供商');
    fireEvent.click(aiProvidersTab);
    expect(screen.getByText('OpenAI 兼容 / 自定义模型 AI 提供商列表')).toBeTruthy();
    expect(screen.getByText('Demo DeepSeek')).toBeTruthy();

    // Switch to System Monitor tab
    const sqliteTab = screen.getByText('系统监控');
    fireEvent.click(sqliteTab);
    expect(screen.getByText('SQLite引擎状况')).toBeTruthy();

    // Switch to Site Settings tab
    const siteSettingsTab = screen.getByText('站点信息设置');
    fireEvent.click(siteSettingsTab);
    expect(screen.getByText('平台站点信息（名称 / 口号 / Logo）')).toBeTruthy();
  });

  it('filters users by search query in the directory tab', async () => {
    render(<AdminPanel {...defaultProps} />);

    // Wait for users to load from mock fetch
    await screen.findByText('系统管理员');

    const searchInput = screen.getByPlaceholderText('检索姓名、教工用户名...');
    fireEvent.change(searchInput, { target: { value: '不存在的姓名' } });
    expect(await screen.findByText('未检索到任何符合条件的教师账户')).toBeTruthy();
  });
});
