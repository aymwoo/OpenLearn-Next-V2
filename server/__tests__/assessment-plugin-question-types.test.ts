// @vitest-environment node
/**
 * 测评中心的插件题型生态（Issue #196）。
 *
 * 覆盖三件事：
 * 1. **自定义 AI 批改提示词**：`QuestionTypeDefinition.getAiGradingPrompt` 存在时优先使用，
 *    让代码题/语音题这类插件题型能把测试用例、判分细则交给大模型（内置通用模板只看得到
 *    题干/满分/答案/作答，给不出针对性的建议）。
 * 2. **试卷导出/导入互通**：含插件题型的试卷导出后能原样导入，`config` 与题型标记
 *    `<pluginId>:<name>` 一格不丢。
 * 3. **未安装题型的明确报错**：导入方没装对应插件时给 `400 QUESTION_TYPE_NOT_INSTALLED`
 *    + 缺失清单，而不是解析崩溃或静默丢题（后者会让题目落库后渲染成白屏）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { AssessmentService, AssessmentError } from '../services/assessment-service.js';
import { QuestionTypeRegistry } from '../../packages/core/assessment/question-types/registry.js';
import type { QuestionTypeDefinition } from '../../packages/core/assessment/question-types/types.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const db = kernelContainer.db;
const OWNER = 'usr-plugin-qt-owner';
const STUDENT = 'stu-plugin-qt';
const CLASS = 'cls-plugin-qt';

const PLUGIN_TYPE = 'ext-code:python';

/** 抓取真正发给大模型的提示词 —— 断言「用的是题型自己的提示词」的唯一可靠方式。 */
const capturedPrompts: string[] = [];
let aiReturnNullPrompt = false;

const fakeAi = {
  generateText: async (prompt: string) => {
    capturedPrompts.push(prompt);
    return '{"suggestedScore": 4, "rationale": "关键分支覆盖了", "confidence": 0.7}';
  },
};

interface PythonConfig {
  testCases: Array<{ input: string; expected: string }>;
  rubric: string;
}

const pythonType: QuestionTypeDefinition<PythonConfig, string> = {
  type: PLUGIN_TYPE,
  label: { zh: '代码填空（Python）', en: 'Python Coding' },
  category: 'subjective',
  supports: ['exam'],
  autoGradable: false,
  createDefaultConfig: () => ({ testCases: [{ input: '1', expected: '1' }], rubric: '按用例通过数给分' }),
  // validateConfig 的形参是 `unknown`（外部数据入口），这里显式收窄后再看字段
  validateConfig: (config) =>
    Array.isArray((config as PythonConfig | null)?.testCases) ? null : 'config.testCases 必须是数组',
  validateAnswer: () => null,
  validateAnswerKey: () => null,
  grade: () => ({ score: null, needsManualReview: true }),
  getAiGradingPrompt: (config, answerKey, answer) => {
    if (aiReturnNullPrompt) return null;
    return [
      '你正在批改一道 Python 代码题。',
      `测试用例：${JSON.stringify(config.testCases)}`,
      `判分细则：${config.rubric}`,
      `参考实现：${String(answerKey)}`,
      `学生代码：${String(answer)}`,
    ].join('\n');
  },
};

const registry = new QuestionTypeRegistry();
registry.register(pythonType, { pluginId: 'ext-code' });

const service = new AssessmentService({ db: db as any, ai: fakeAi, registry, aiTimeoutMs: 5000 });

/** 建卷 → 布置 → 学生作答并交卷（AI 建议只在已交卷的作答上生成）。 */
async function buildSubmittedPluginAttempt(prompt = '请用 Python 写一个累加函数') {
  const assessment = service.createAssessment({ ownerId: OWNER, kind: 'exam', title: '插件题型试卷' });
  service.replaceItems(assessment.id, OWNER, [
    {
      type: PLUGIN_TYPE,
      stem: prompt,
      answerKey: 'def add(n): return sum(range(1, n + 1))',
      maxScore: 10,
      config: { testCases: [{ input: '3', expected: '6' }], rubric: '每个用例 5 分' },
    },
  ]);
  const assignment = service.publish(assessment.id, OWNER, { classId: CLASS, createdBy: OWNER });
  const payload: any = service.startAttempt(assignment.id, STUDENT);
  const itemId = payload.items[0].id;
  service.saveAnswer(payload.attempt.id, STUDENT, itemId, 'def add(n):\n    return n * (n + 1) // 2');
  service.submitAttempt(payload.attempt.id, STUDENT);
  return { assessmentId: assessment.id, attemptId: payload.attempt.id as string, itemId: itemId as string };
}

beforeAll(() => {
  ensureTestSchema();
  const now = Date.now();
  db.prepare(
    'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(OWNER, 'plugin_qt_owner', 'x', 'teacher', '插件题型教师', now);
  db.prepare(
    'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(STUDENT, 'plugin_qt_student', 'x', 'student', '插件题型学生', now);
  db.prepare(
    'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(CLASS, '插件题型班', '', 'x', OWNER, now);
});

afterAll(() => {
  db.prepare(
    'DELETE FROM assessment_answers WHERE attempt_id IN (SELECT id FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?)))',
  ).run(OWNER);
  db.prepare(
    'DELETE FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?))',
  ).run(OWNER);
  db.prepare(
    'DELETE FROM assessment_assignments WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?)',
  ).run(OWNER);
  db.prepare('DELETE FROM assessment_items WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?)').run(
    OWNER,
  );
  db.prepare('DELETE FROM assessments WHERE owner_id = ?').run(OWNER);
  db.prepare('DELETE FROM classes WHERE id = ?').run(CLASS);
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(OWNER, STUDENT);
});

describe('插件题型的自定义 AI 批改提示词', () => {
  it('题型提供 getAiGradingPrompt 时优先使用它（测试用例与判分细则进入提示词）', async () => {
    capturedPrompts.length = 0;
    const { attemptId, itemId } = await buildSubmittedPluginAttempt();

    const suggestion = await service.suggestAiGrade(attemptId, OWNER, itemId, { actorId: OWNER });

    expect(suggestion.suggestedScore).toBe(4);
    expect(capturedPrompts).toHaveLength(1);
    const prompt = capturedPrompts[0];
    // 自定义提示词的独有内容：测试用例 + 判分细则 + 学生代码
    expect(prompt).toContain('你正在批改一道 Python 代码题');
    expect(prompt).toContain('"expected":"6"');
    expect(prompt).toContain('每个用例 5 分');
    expect(prompt).toContain('return n * (n + 1) // 2');
    // 内置通用模板的固定措辞不该出现在这里（说明没有回落、也没有拼接两份）
    expect(prompt).not.toContain('满分');
  });

  it('题型返回 null 时保守拒绝（不退回通用提示词，也不产生建议）', async () => {
    const { attemptId, itemId } = await buildSubmittedPluginAttempt('null 提示词用例');
    aiReturnNullPrompt = true;
    capturedPrompts.length = 0;
    try {
      await expect(service.suggestAiGrade(attemptId, OWNER, itemId, { actorId: OWNER })).rejects.toThrow(
        /该题型不提供 AI 批改建议/,
      );
      expect(capturedPrompts).toHaveLength(0);
    } finally {
      aiReturnNullPrompt = false;
    }
  });
});

describe('插件题型的试卷导出 / 导入互通', () => {
  it('JSON 往返：config 与 <pluginId>:<name> 题型标记完整保留', async () => {
    const { assessmentId } = await buildSubmittedPluginAttempt('JSON 往返用例');

    const exported = await service.exportPaper(assessmentId, OWNER, 'json');
    const doc = JSON.parse(String(exported.body));
    // 导出包里必须带题型标记与完整 config
    expect(doc.items[0].type).toBe(PLUGIN_TYPE);
    expect(doc.items[0].config).toEqual({ testCases: [{ input: '3', expected: '6' }], rubric: '每个用例 5 分' });

    const imported = service.importPaper(OWNER, String(exported.body), 'json');
    expect(imported.itemCount).toBe(1);

    const reExported = await service.exportPaper(imported.assessmentId, OWNER, 'json');
    const reDoc = JSON.parse(String(reExported.body));
    // 逐字段对比：题干 / 题型标记 / config / answerKey / 满分 都不能丢
    expect(reDoc.items[0].type).toBe(PLUGIN_TYPE);
    expect(reDoc.items[0].stem).toBe('JSON 往返用例');
    expect(reDoc.items[0].config).toEqual(doc.items[0].config);
    expect(reDoc.items[0].answerKey).toEqual(doc.items[0].answerKey);
    expect(reDoc.items[0].maxScore).toBe(10);
    expect(reDoc.assessment.kind).toBe('exam');
  });

  it('CSV 往返：config 以 JSON 字符串存放，读回来仍是同一份对象', async () => {
    const { assessmentId } = await buildSubmittedPluginAttempt('CSV 往返用例');

    const exported = await service.exportPaper(assessmentId, OWNER, 'csv');
    const csv = String(exported.body);
    expect(csv.split('\n')[0]).toContain('type,stem,config,answerKey,maxScore');

    const imported = service.importPaper(OWNER, csv, 'csv', { title: 'CSV 导入卷' });
    const reExported = await service.exportPaper(imported.assessmentId, OWNER, 'json');
    const reDoc = JSON.parse(String(reExported.body));

    expect(reDoc.assessment.title).toBe('CSV 导入卷');
    expect(reDoc.items[0].type).toBe(PLUGIN_TYPE);
    expect(reDoc.items[0].config).toEqual({ testCases: [{ input: '3', expected: '6' }], rubric: '每个用例 5 分' });
    expect(reDoc.items[0].answerKey).toBe('def add(n): return sum(range(1, n + 1))');
  });

  it('导入未安装的题型：400 QUESTION_TYPE_NOT_INSTALLED，并带上缺失清单', () => {
    const payload = JSON.stringify({
      schema: 'openlearn.assessment.paper/v1',
      assessment: { title: '含未安装题型的卷', kind: 'quiz' },
      items: [
        {
          order: 1,
          type: 'ext-ghost:robot',
          stem: '给机器人写一条指令',
          config: { joints: 6 },
          answerKey: null,
          maxScore: 5,
        },
      ],
    });

    let caught: any;
    try {
      service.importPaper(OWNER, payload, 'json');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AssessmentError);
    expect(caught.status).toBe(400);
    expect(caught.code).toBe('QUESTION_TYPE_NOT_INSTALLED');
    expect(caught.missingTypes).toEqual(['ext-ghost:robot']);
    expect(String(caught.message)).toContain('ext-ghost:robot');
    // 报错必须给出可操作的下一步（去插件中心安装），而不是只有技术细节
    expect(String(caught.message)).toContain('插件');
  });

  it('导入时用题型自己的校验器验 config（外部数据不因“看起来对”就被信任）', () => {
    const payload = JSON.stringify({
      schema: 'openlearn.assessment.paper/v1',
      assessment: { title: '配置非法的卷', kind: 'quiz' },
      items: [
        {
          order: 1,
          type: PLUGIN_TYPE,
          stem: '坏配置',
          // 缺 testCases → pythonType.validateConfig 返回错误
          config: { rubric: '没有用例' },
          answerKey: null,
          maxScore: 5,
        },
      ],
    });

    let caught: any;
    try {
      service.importPaper(OWNER, payload, 'json');
    } catch (e) {
      caught = e;
    }
    expect(caught?.status).toBe(400);
    expect(caught?.code).toBe('PAPER_IMPORT_INVALID_ITEM');
  });
});
