import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AssignmentBindingField } from '../components/AssignmentBindingField';
import { AssignmentSubmitDialog } from '../components/AssignmentSubmitDialog';
import { AssignmentPeerReviewPanel } from '../components/AssignmentPeerReviewPanel';
import { AssignmentPeerProgressPanel } from '../components/AssignmentPeerProgressPanel';

/**
 * 作业中心 P1 的两个白板组件：
 * - AssignmentBindingField：教师端把白板元素绑定到真实作业实体
 * - AssignmentSubmitDialog：学生端提交文件 / 文本 / 链接并查看版本历史
 *
 * 两个组件都不使用 createPortal，因此普通 render + screen 即可。
 */

const ASSIGNMENT = {
  id: 'asg-1',
  lesson_id: 'lesson-1',
  title: '第一次作业',
  description: '请提交实验报告',
  status: 'published',
  due_at: null,
  allow_text: 1,
  allow_link: 1,
  allow_late: 1,
};

function jsonResponse(data: any, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  } as any;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  // vitest 未开启 globals，@testing-library 不会自动清理，必须显式 cleanup，
  // 否则前一个用例的 DOM 会残留并干扰 getByText / getByRole 查询。
  cleanup();
  vi.unstubAllGlobals();
});

describe('AssignmentBindingField（教师端绑定控件）', () => {
  function Harness() {
    const [id, setId] = useState<string | null>(null);
    return (
      <AssignmentBindingField
        lessonId="lesson-1"
        elementId="el-1"
        value={id}
        draftTitle="课堂作业"
        draftDescription="请提交实验报告"
        onChange={(next) => setId(next)}
      />
    );
  }

  it('加载课时作业、可绑定 / 解除绑定，且在没有 toast 宿主时就地提示', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      const target = String(url);
      const method = init?.method || 'GET';
      seen.push(`${method} ${target}`);
      if (target.startsWith('/api/assignments?lessonId=')) {
        return jsonResponse({ success: true, assignments: [ASSIGNMENT] });
      }
      if (method === 'POST' && target === '/api/assignments') {
        return jsonResponse({ success: true, assignmentId: 'asg-new', created: true });
      }
      if (target === '/api/assignments/asg-1') {
        return jsonResponse({ success: true, assignment: ASSIGNMENT });
      }
      return jsonResponse({ success: false, error: `unexpected ${method} ${target}` }, { ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<Harness />);

    // 未绑定时的告警
    expect(await screen.findByText(/尚未绑定作业/)).toBeTruthy();
    // 列表里带出本课时作业
    await waitFor(() => expect(screen.getByText(/第一次作业/)).toBeTruthy());

    // 绑定已有作业 → 显示绑定卡片与详情
    fireEvent.change(container.querySelector('select') as HTMLSelectElement, { target: { value: 'asg-1' } });
    await waitFor(() => expect(screen.getByTitle('解除绑定')).toBeTruthy());
    expect(screen.queryByText(/尚未绑定作业/)).toBeNull();

    // 解除绑定 → 回到告警状态
    fireEvent.click(screen.getByTitle('解除绑定'));
    await waitFor(() => expect(screen.getByText(/尚未绑定作业/)).toBeTruthy());

    // 新建作业：带上白板元素的标题/描述，并在面板内就地提示（白板没有 toast 宿主）
    fireEvent.click(screen.getByText('新建'));
    await waitFor(() => expect(screen.getByText(/已创建并绑定作业/)).toBeTruthy());
    const createCall = fetchMock.mock.calls.find((c) => (c[1] as any)?.method === 'POST');
    expect(JSON.parse(String((createCall?.[1] as any)?.body))).toMatchObject({
      title: '课堂作业',
      description: '请提交实验报告',
      lessonId: 'lesson-1',
      elementId: 'el-1',
      status: 'published',
    });
    await waitFor(() => expect(screen.getByTitle('解除绑定')).toBeTruthy());
  });

  it('新建失败时把错误显示在面板里（不再静默丢弃）', async () => {
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      const target = String(url);
      if (target.startsWith('/api/assignments?lessonId=')) {
        return jsonResponse({ success: true, assignments: [] });
      }
      if (init?.method === 'POST') {
        return jsonResponse(
          { success: false, error: 'Missing required property "classId"' },
          { ok: false, status: 500 },
        );
      }
      return jsonResponse({ success: false }, { ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AssignmentBindingField lessonId="lesson-1" elementId="el-1" value="" onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /新建/ }));
    expect(await screen.findByText(/创建作业失败/)).toBeTruthy();
    expect(screen.getByText(/classId/)).toBeTruthy();
  });
});

describe('AssignmentSubmitDialog（学生端提交弹窗）', () => {
  /** 只实现组件实际用到的 XMLHttpRequest 表面 */
  class FakeUploadXhr {
    static instances: FakeUploadXhr[] = [];
    upload: { onprogress: ((event: any) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    responseText = JSON.stringify({ success: true, file: { id: 'f-new', name: 'report.pdf', size: 12 } });
    method = '';
    url = '';
    headers: Record<string, string> = {};

    constructor() {
      FakeUploadXhr.instances.push(this);
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }
    send() {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 6, total: 12 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 12, total: 12 });
      this.onload?.();
    }
    abort() {
      this.onabort?.();
    }
  }

  const FILES = [
    { id: 'f-pending', original_name: 'draft.pdf', size: 12, uploaded_at: Date.now(), version_id: null },
    { id: 'f-archived', original_name: 'old.pdf', size: 12, uploaded_at: Date.now(), version_id: 'sv-1' },
  ];

  it('展示待提交附件与版本历史，上传后可提交并提示版本号', async () => {
    const submitBodies: any[] = [];
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      const target = String(url);
      if (target === '/api/assignments/asg-1/files') {
        return jsonResponse({ success: true, files: FILES });
      }
      if (target === '/api/assignments/asg-1/submit') {
        submitBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ success: true, submissionId: 'sub-1', version: 2, versionId: 'sv-2' });
      }
      if (target === '/api/assignments/asg-1') {
        return jsonResponse({
          success: true,
          assignment: ASSIGNMENT,
          submission: { id: 'sub-1', version: 1 },
          versions: [{ id: 'v1', version: 1, text_content: '第一版文本作答', created_at: Date.now() }],
          grade: { status: 'draft' },
          stats: { submissionCount: 1, gradedCount: 0, pendingPeerReviews: 0 },
        });
      }
      return jsonResponse({ success: false, error: `unexpected ${target}` }, { ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('XMLHttpRequest', FakeUploadXhr as any);
    FakeUploadXhr.instances = [];

    const onClose = vi.fn();
    const { container } = render(<AssignmentSubmitDialog assignmentId="asg-1" onClose={onClose} lang="zh" />);

    // 作业信息 / 待提交附件 / 历史版本
    expect(await screen.findByText('第一次作业')).toBeTruthy();
    expect(screen.getByText('draft.pdf')).toBeTruthy();
    // 已随提交归档的附件不再出现在待提交列表
    expect(screen.queryByText('old.pdf')).toBeNull();
    expect(screen.getByText(/提交历史（共 1 版）/)).toBeTruthy();
    expect(screen.getByText('第一版文本作答')).toBeTruthy();
    // 未确认的成绩不展示分数
    expect(screen.getByText(/成绩待教师确认/)).toBeTruthy();

    // 选择文件 → XHR 串行上传（带编码后的文件名头）
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello world'], 'report.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(FakeUploadXhr.instances.length).toBe(1));
    const xhr = FakeUploadXhr.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/assignments/asg-1/files');
    expect(xhr.headers['X-File-Name']).toBe(encodeURIComponent('report.pdf'));

    // 上传成功后提交，body 只带归档后的 fileId
    const submitButton = await screen.findByRole('button', { name: /提交作业/ });
    await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submitButton);

    await waitFor(() => expect(submitBodies.length).toBe(1));
    // 上传完成的文件同时进了「待提交附件」与「上传队列」，必须去重后提交
    const submitted = submitBodies[0];
    expect(Object.keys(submitted)).toEqual(['fileIds']);
    expect(submitted.fileIds.slice().sort()).toEqual(['f-new', 'f-pending']);
    expect(new Set(submitted.fileIds).size).toBe(submitted.fileIds.length);
    expect(await screen.findByText(/已提交第 2 版/)).toBeTruthy();
  });

  it('提交失败时显示服务端返回的错误且不清空选择', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      const target = String(url);
      if (target === '/api/assignments/asg-1/files') {
        return jsonResponse({
          success: true,
          files: [{ id: 'f-pending', original_name: 'draft.pdf', size: 12, uploaded_at: Date.now(), version_id: null }],
        });
      }
      if (target === '/api/assignments/asg-1/submit') {
        return jsonResponse({ success: false, error: 'Assignment is closed' }, { ok: false, status: 400 });
      }
      return jsonResponse({
        success: true,
        assignment: ASSIGNMENT,
        submission: null,
        versions: [],
        grade: { status: 'confirmed', calculated_final_score: 88 },
        stats: { submissionCount: 0, gradedCount: 0, pendingPeerReviews: 0 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<AssignmentSubmitDialog assignmentId="asg-1" onClose={() => {}} lang="zh" />);
    expect(await screen.findByText('draft.pdf')).toBeTruthy();
    // 教师已确认的成绩直接展示分数
    expect(screen.getByText(/88/)).toBeTruthy();

    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '这是我的作业' },
    });
    fireEvent.click(screen.getByRole('button', { name: /提交作业/ }));
    expect(await screen.findByText(/Assignment is closed/)).toBeTruthy();
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('这是我的作业');
  });
});

describe('AssignmentPeerReviewPanel（学生端互评面板）', () => {
  const makeTask = (overrides: Record<string, unknown> = {}) => ({
    taskId: 'prt-1',
    submissionId: 'sub-1',
    status: 'pending',
    anonymous: true,
    dueAt: null,
    createdAt: Date.now(),
    stale: false,
    review: null,
    submission: {
      version: 1,
      textContent: '这是我的方案',
      linkUrl: '',
      submittedAt: Date.now(),
      isLate: false,
      files: [{ id: 'f-1', original_name: 'plan.pdf', size: 2048, mime: 'application/pdf' }],
    },
    ...overrides,
  });

  it('双盲展示 + 量规打分：提交互评时带 taskId / submissionId / score / comment', async () => {
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      if (String(url) === '/api/assignments/asg-1/peer-review') {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ success: true, reviewId: 'rev-1' });
      }
      return jsonResponse({ success: false, error: `unexpected ${url}` }, { ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSubmitted = vi.fn();
    render(
      <AssignmentPeerReviewPanel
        assignmentId="asg-1"
        tasks={[makeTask() as any]}
        onSubmitted={onSubmitted}
        lang="zh"
      />,
    );

    expect(screen.getByTestId('peer-review-panel')).toBeTruthy();
    // 看不到作者身份，只看到「匿名同学 A」
    expect(screen.getByText('匿名同学 A')).toBeTruthy();
    expect(screen.getByText('这是我的方案')).toBeTruthy();
    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(screen.getByText(/已完成 0 \/ 1/)).toBeTruthy();

    // 量规四维 × 四档；未选择维度时不给建议分（ rubricTotal 为 null）
    expect(screen.getAllByText('未达标')).toHaveLength(4);
    expect(screen.queryByText(/量规建议/)).toBeNull();
    fireEvent.click(screen.getAllByText('未达标')[0]);
    // 内容完整计 30 分档 0.4（其余三维按「基本达标」0.7）→ 12 + 21 + 14 + 14 = 61
    expect(await screen.findByText(/量规建议 61 分/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/写点具体建议/), {
      target: { value: '结构可以再清楚一点' },
    });
    fireEvent.click(screen.getByRole('button', { name: /提交互评/ }));

    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toEqual({
      submissionId: 'sub-1',
      score: 61,
      comment: '结构可以再清楚一点',
      taskId: 'prt-1',
    });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/已给 匿名同学 A 打 61 分/)).toBeTruthy();
  });

  it('互评截止后锁定输入，已评但作者更新过提交时提示复核', async () => {
    render(
      <AssignmentPeerReviewPanel
        assignmentId="asg-1"
        tasks={[
          makeTask({
            dueAt: Date.now() - 1000,
            stale: true,
            review: { score: 60, comment: '旧意见', submittedAt: Date.now() - 5000 },
          }) as any,
        ]}
        lang="zh"
      />,
    );

    expect(screen.getByText(/该作者在你评价后又更新了提交/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: /互评已截止/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect((screen.getByPlaceholderText(/写点具体建议/) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /重填/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('手输分数会覆盖量规估算，越界分数直接拒绝提交', async () => {
    render(
      <AssignmentPeerReviewPanel
        assignmentId="asg-1"
        tasks={[makeTask() as any]}
        lang="zh"
      />,
    );
    const scoreInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(scoreInput, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /提交互评/ }));
    expect(await screen.findByText(/请给出 0-100 的互评分数/)).toBeTruthy();
  });
});

describe('AssignmentPeerProgressPanel（教师端互评进度）', () => {
  const PROGRESS = {
    submissions: 3,
    tasks: 3,
    completed: 1,
    pending: 2,
    reviewers: [
      { studentId: 'stu-1', name: '张三', pending: 2, submitted: 0 },
      { studentId: 'stu-2', name: '李四', pending: 0, submitted: 1 },
    ],
    flags: [{ type: 'peer_review_pending', reviewerId: 'stu-1', detail: '张三 还有 2 份待评' }],
  };

  it('展示进度与异常标记，随机分配时带上分配份数', async () => {
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      if (String(url) === '/api/assignments/asg-1/assign-peer-reviews') {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ success: true, created: 3, submissions: 3 });
      }
      return jsonResponse({ success: false, error: `unexpected ${url}` }, { ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onAssigned = vi.fn();
    render(
      <AssignmentPeerProgressPanel
        assignmentId="asg-1"
        progress={PROGRESS as any}
        onAssigned={onAssigned}
        lang="zh"
      />,
    );

    expect(screen.getByText('互评进度')).toBeTruthy();
    expect(screen.getByText(/1 \/ 3 已完成/)).toBeTruthy();
    expect(screen.getByText('提交 3')).toBeTruthy();
    expect(screen.getByText('待完成 2')).toBeTruthy();
    expect(screen.getByText(/1 项待复核/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /展开/ }));
    expect(screen.getByText(/未完成互评/)).toBeTruthy();
    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.getByText(/已评 0 · 待评 2/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /随机分配互评/ }));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].reviewerCount).toBe(2);
    expect(bodies[0].dueAt).toBeUndefined();
    expect(onAssigned).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/互评已分配：新增 3 个互评任务/)).toBeTruthy();
  });

  it('还没有互评任务时给出分配提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, peerProgress: null })),
    );
    render(
      <AssignmentPeerProgressPanel
        assignmentId="asg-1"
        progress={{ submissions: 2, tasks: 0, completed: 0, pending: 0, reviewers: [], flags: [] } as any}
        lang="zh"
      />,
    );
    expect(await screen.findByText(/还没有分配互评/)).toBeTruthy();
  });
});
