import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightSidebar } from '../RightSidebar';
import { AGENT_PERSONA_STORAGE_KEY } from '../../../hooks/useAgentChat';
import { AiPersonasSection } from '../../admin/AiPersonasSection';

describe('IKVA8R · 前端 Persona 持久化、defaultForRole 与后台 CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('RightSidebar 持久化选择的 personaId 至 localStorage，并在无缓存时按 defaultForRole 兜底', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/agent/personas') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            defaultPersonaId: 'teacher_default_bot',
            personas: [
              { id: 'plain_assistant', nameZh: '普通助教', nameEn: 'Plain', source: 'builtin' },
              {
                id: 'teacher_default_bot',
                nameZh: '教师默认助教',
                nameEn: 'Teacher Default',
                source: 'admin',
                defaultForRole: ['teacher'],
              },
              { id: 'socratic_questioner', nameZh: '苏格拉底追问者', nameEn: 'Socratic', source: 'builtin' },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    function Wrapper() {
      const [personaId, setPersonaId] = useState<string>(() => localStorage.getItem(AGENT_PERSONA_STORAGE_KEY) || '');
      const updatePersonaId = (id: string) => {
        setPersonaId(id);
        if (id) localStorage.setItem(AGENT_PERSONA_STORAGE_KEY, id);
        else localStorage.removeItem(AGENT_PERSONA_STORAGE_KEY);
      };
      return (
        <RightSidebar
          showRightSidebar={true}
          rightSidebarTab="agent"
          personaId={personaId}
          setPersonaId={updatePersonaId}
          aiProviders={[{ id: 'p1', name: 'DeepSeek', model_name: 'ds' }]}
          selectedAgentProvider={{ id: 'p1', name: 'DeepSeek', model_name: 'ds' }}
          chatLog={[]}
          lang="zh"
          t={{}}
        />
      );
    }

    render(<Wrapper />);

    const select = (await screen.findByLabelText('选择 AI 助教角色')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('teacher_default_bot'));
    expect(localStorage.getItem(AGENT_PERSONA_STORAGE_KEY)).toBe('teacher_default_bot');

    fireEvent.change(select, { target: { value: 'socratic_questioner' } });
    expect(select.value).toBe('socratic_questioner');
    expect(localStorage.getItem(AGENT_PERSONA_STORAGE_KEY)).toBe('socratic_questioner');

    // 重新挂载时保留用户上次选择
    cleanup();
    render(<Wrapper />);
    const remountSelect = (await screen.findByLabelText('选择 AI 助教角色')) as HTMLSelectElement;
    await waitFor(() => expect(remountSelect.value).toBe('socratic_questioner'));
  });

  it('AiPersonasSection 渲染角色表并支持新建与删除自定义角色模板', async () => {
    let serverPersonas: Array<{
      id: string;
      nameZh: string;
      nameEn: string;
      descriptionZh?: string;
      descriptionEn?: string;
      instructionZh: string;
      instructionEn: string;
      source: string;
      enabled?: boolean;
      mode: string;
      basePolicy: string;
      defaultForRole?: string[];
      references?: { defaultForRoles: string[] };
    }> = [
      {
        id: 'plain_assistant',
        nameZh: '普通助教',
        nameEn: 'Plain Assistant',
        instructionZh: '',
        instructionEn: '',
        source: 'builtin',
        mode: 'overlay',
        basePolicy: 'inherit',
      },
    ];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/agent/personas?scope=all' && (!init?.method || init.method === 'GET')) {
        return { ok: true, json: async () => ({ success: true, personas: serverPersonas }) } as Response;
      }
      if (url === '/api/agent/personas' && init?.method === 'POST') {
        const created = { ...JSON.parse(String(init.body)), source: 'admin' };
        serverPersonas = [...serverPersonas, created];
        return { ok: true, status: 201, json: async () => ({ success: true, persona: created }) } as Response;
      }
      if (url === '/api/agent/personas/custom_bot' && init?.method === 'DELETE') {
        serverPersonas = serverPersonas.filter((p) => p.id !== 'custom_bot');
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({ success: false }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AiPersonasSection lang="zh" />);
    await screen.findByText('普通助教');

    fireEvent.click(screen.getByRole('button', { name: /新建角色模板/i }));

    fireEvent.change(screen.getByLabelText(/唯一 ID/i), { target: { value: 'custom_bot' } });
    fireEvent.change(screen.getByLabelText(/中文名称/i), { target: { value: '物理导师' } });
    fireEvent.change(screen.getByLabelText(/英文名称/i), { target: { value: 'Physics Tutor' } });
    fireEvent.change(screen.getByLabelText(/中文系统指令/i), { target: { value: '只围绕物理建模提问' } });
    fireEvent.change(screen.getByLabelText(/英文系统指令/i), { target: { value: 'Focus on physics modeling' } });

    fireEvent.click(screen.getByRole('button', { name: /保存角色模板/i }));

    await screen.findByText('物理导师');
    const delBtn = screen.getByRole('button', { name: /删除角色模板 物理导师 \(custom_bot\)/i });
    fireEvent.click(delBtn);

    await waitFor(() => expect(screen.queryByText('物理导师')).toBeNull());
  });

  it('Issue #510 · AiPersonasSection 展示用途说明、过滤仅共享模型绑定，并在停用默认角色时弹出引用确认框', async () => {
    let serverPersonas: Array<{
      id: string;
      nameZh: string;
      nameEn: string;
      descriptionZh?: string;
      descriptionEn?: string;
      instructionZh: string;
      instructionEn: string;
      source: string;
      enabled?: boolean;
      mode: string;
      basePolicy: string;
      defaultForRole?: string[];
      references?: { defaultForRoles: string[] };
    }> = [
      {
        id: 'plain_assistant',
        nameZh: '普通助教（默认）',
        nameEn: 'Plain Assistant (Default)',
        descriptionZh: '系统兜底助教',
        descriptionEn: 'Fallback assistant',
        instructionZh: '',
        instructionEn: '',
        source: 'builtin',
        enabled: true,
        mode: 'overlay',
        basePolicy: 'inherit',
      },
      {
        id: 'socratic_questioner',
        nameZh: '苏格拉底追问者',
        nameEn: 'Socratic Questioner',
        descriptionZh: '通过分层追问引导学生思考',
        descriptionEn: 'Guides students via Socratic questions',
        instructionZh: '追问引导',
        instructionEn: 'Socratic guidance',
        source: 'builtin',
        enabled: true,
        defaultForRole: ['student'],
        references: { defaultForRoles: ['student'] },
        mode: 'overlay',
        basePolicy: 'inherit',
      },
    ];

    const patchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/agent/personas?scope=all' && (!init?.method || init.method === 'GET')) {
        return { ok: true, json: async () => ({ success: true, personas: serverPersonas }) } as Response;
      }
      if (url.startsWith('/api/agent/personas/socratic_questioner') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchCalls.push({ url, body });
        serverPersonas = serverPersonas.map((p) =>
          p.id === 'socratic_questioner'
            ? { ...p, enabled: false, defaultForRole: undefined, references: { defaultForRoles: [] } }
            : p,
        );
        return { ok: true, json: async () => ({ success: true, persona: serverPersonas[1] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({ success: false }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AiPersonasSection
        lang="zh"
        aiProviders={[
          { id: 'prov_shared_1', name: '平台共享 DeepSeek', model_name: 'deepseek-chat', is_shared: 1 },
          { id: 'prov_private_1', name: '个人私有 Key', model_name: 'gpt-4o', is_shared: 0 },
        ]}
      />,
    );

    // 列表直接展示用途说明
    await screen.findByText('通过分层追问引导学生思考');

    // 打开新建窗口校验共享模型下拉仅包含平台共享提供商，不含个人私有提供商
    fireEvent.click(screen.getByRole('button', { name: /新建角色模板/i }));
    const providerSelect = screen.getByLabelText(/绑定平台共享 AI 提供商/i) as HTMLSelectElement;
    const optionTexts = Array.from(providerSelect.options).map((o) => o.textContent || '');
    expect(optionTexts.some((t) => t.includes('平台共享 DeepSeek'))).toBe(true);
    expect(optionTexts.some((t) => t.includes('个人私有 Key'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /取消/i }));

    // 点击停用已设为学生默认的苏格拉底角色 -> 弹出引用确认 Dialog 而非直接提交
    fireEvent.click(screen.getByRole('button', { name: /停用角色模板 苏格拉底追问者 \(socratic_questioner\)/i }));
    expect(patchCalls).toHaveLength(0);
    expect(await screen.findByText(/确认停用正在引用的助教角色/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /确认停用并自动回退/ }));
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0].url).toContain('?force=true');
    expect(patchCalls[0].body.enabled).toBe(false);
  });
});
