/**
 * 课程包（Course Package）—— 可下载、可导入的完整课程模板格式。
 *
 * ## 为什么需要它
 *
 * 平台现有的「批量导入课程」只接受 `title + content` 两列 CSV，写进 `lessons`
 * 表后就没有别的了：没有教学环节（timeline）、没有白板元素（whiteboard_elements）、
 * 没有课件附件。教师导入完得到的是一张**空课**。
 *
 * 课程包把这三样东西打包成**一个自包含的 JSON 文档**：
 *
 * - `lesson.timeline`  → 教学环节（讲授 / 练习 / 测验 / 总结 …）
 * - `lesson.content`   → Markdown 教学大纲
 * - `elements[]`       → 白板元素，逐个对应备课面板里的预设组件
 * - `assets[]`         → 课件附件（PDF / PPTX），base64 内联，导入时重新落盘
 *
 * 附件用 `${asset:<id>}` 占位符表达 —— 因为「课件演示」组件的 PDF/PPTX 分支
 * 存的是 `/uploads/xxxx.pptx` 这种**指向本机 uploads 目录**的相对路径，
 * 直接搬运模板必然 404。导入时占位符被替换成导入方实例上真实落盘后的 URL。
 *
 * 格式版本通过 `version` 字段演进；`format` 常量用于识别「这是不是一个课程包」。
 */
import { z } from 'zod';
import { buildSamplePdfBuffer, buildSamplePptxBuffer, PACKAGE_ASSET_TYPES } from './course-package-assets.js';

/** 课程包格式标识。 */
export const COURSE_PACKAGE_FORMAT = 'openlearn.course-package';

/** 当前课程包格式版本。 */
export const COURSE_PACKAGE_VERSION = 1;

/** 教学环节类型（与 src/features/teacher/lesson-editor/timelineConfig.ts 的 SEGMENT_TYPES 对齐）。 */
export const PACKAGE_SEGMENT_TYPES = ['intro', 'lecture', 'practice', 'quiz', 'summary'] as const;
export type PackageSegmentType = (typeof PACKAGE_SEGMENT_TYPES)[number];

const GateSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

const SegmentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  duration: z.string().optional(),
  notes: z.string().optional(),
  color: z.string().optional(),
  /** 进入条件（与备课编辑器的「环节门禁」同构）。 */
  gates: z.array(GateSchema).optional(),
});

const AssetSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.enum(PACKAGE_ASSET_TYPES),
  base64: z.string().min(1),
});

const ElementSchema = z.object({
  type: z.string().min(1),
  segmentId: z.string().optional(),
  page: z.number().int().min(0).optional(),
  pageId: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

const CoursePackageSchema = z.object({
  format: z.literal(COURSE_PACKAGE_FORMAT),
  version: z.number().int().positive(),
  meta: z
    .object({
      name: z.string().min(1),
      description: z.string().default(''),
      author: z.string().default(''),
      tags: z.array(z.string()).default([]),
    })
    .default({ name: '未命名课程模板', description: '', author: '', tags: [] }),
  lesson: z.object({
    title: z.string().min(1),
    content: z.string().default(''),
    progressMode: z.string().default('manual'),
    timeline: z.array(SegmentSchema).default([]),
  }),
  assets: z.array(AssetSchema).default([]),
  elements: z.array(ElementSchema).default([]),
});

export type CoursePackageSegment = z.infer<typeof SegmentSchema>;
export type CoursePackageAsset = z.infer<typeof AssetSchema>;
export type CoursePackageElement = z.infer<typeof ElementSchema>;
export type CoursePackage = z.infer<typeof CoursePackageSchema>;

/** 课程包解析结果。 */
export type CoursePackageParseResult = { ok: true; package: CoursePackage } | { ok: false; error: string };

/**
 * 解析并校验课程包。
 *
 * 校验失败一律返回 `{ ok: false, error }`（而不是抛异常）——导入入口需要把
 * 错误原样回显给教师，而不是 500。
 */
export function parseCoursePackage(input: unknown): CoursePackageParseResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: '课程包内容不是一个合法的 JSON 对象' };
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.format !== COURSE_PACKAGE_FORMAT) {
    return {
      ok: false,
      error: `不是 OpenLearn 课程包文件（format 应为 "${COURSE_PACKAGE_FORMAT}"，实际为 "${String(candidate.format)}"）`,
    };
  }
  const parsed = CoursePackageSchema.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `课程包结构校验失败 —— ${detail}` };
  }

  // 环节 id 唯一性：白板元素按 segmentId 归属教学环节，重复 id 会让元素归属歧义。
  const seen = new Set<string>();
  for (const segment of parsed.data.lesson.timeline) {
    if (seen.has(segment.id)) {
      return { ok: false, error: `课程包中存在重复的教学环节 id：${segment.id}` };
    }
    seen.add(segment.id);
  }

  // 资产 id 唯一性：占位符 ${asset:<id>} 依赖 id 唯一。
  const assetIds = new Set<string>();
  for (const asset of parsed.data.assets) {
    if (assetIds.has(asset.id)) {
      return { ok: false, error: `课程包中存在重复的资产 id：${asset.id}` };
    }
    assetIds.add(asset.id);
  }

  // 元素引用的 segmentId 必须存在，否则元素在任何环节都不可见。
  for (const element of parsed.data.elements) {
    if (element.segmentId && !seen.has(element.segmentId)) {
      return {
        ok: false,
        error: `白板元素 "${element.type}" 引用了不存在的教学环节：${element.segmentId}`,
      };
    }
  }

  return { ok: true, package: parsed.data };
}

/**
 * 备课面板「预设组件」的完整清单。
 *
 * 与 `src/features/teacher/lesson-editor/paletteConfig.ts` 的 PALETTE_ITEMS 一一对应
 * （外加 3 个基础画布图元）。课程包模板必须覆盖这里的每一项 —— 这正是「测试样例课」
 * 的意义：导入一次即可逐个验证每个组件能否正常渲染。
 */
export const PRESET_COMPONENT_TYPES = [
  'presentation',
  'code-sandbox',
  'math-graph',
  'html-applet',
  'quiz',
  'assignment',
  'rollcall',
  'hello-world',
  // 基础画布图元（画板直接绘制，不在调色板里，但同属「预设内容」）
  'text',
  'rectangle',
  'circle',
] as const;

/** 模板中的教学环节 id —— 供白板元素引用。 */
const SEG = {
  intro: 'seg-intro',
  lecture: 'seg-lecture',
  practice: 'seg-practice',
  quiz: 'seg-quiz',
  summary: 'seg-summary',
} as const;

/** 模板白板页 id —— 供白板元素按页归属。 */
const PAGE = {
  overview: 'page-overview',
  interaction: 'page-interaction',
} as const;

/**
 * 构建内置课程模板（测试样例课）。
 *
 * 覆盖：
 * - 5 个教学环节（准备 / 讲授 / 练习 / 测验 / 总结）—— 对齐 SEGMENT_TYPES；
 * - 2 个白板页；
 * - PALETTE_ITEMS 里的 8 个预设组件 + 3 个基础图元；
 * - 2 个真实附件（PDF 讲义 + PPTX 课件），走「课件演示」组件的 PDF / PPTX 分支。
 */
export async function buildTemplateCoursePackage(): Promise<CoursePackage> {
  const pdf = buildSamplePdfBuffer();
  const pptx = await buildSamplePptxBuffer();

  return {
    format: COURSE_PACKAGE_FORMAT,
    version: COURSE_PACKAGE_VERSION,
    meta: {
      name: 'OpenLearn 预设组件全览 · 测试样例课',
      description:
        '覆盖备课面板全部预设组件的样例课程：课件演示（Markdown / PDF / PPTX 三种来源）、随堂测试、' +
        '代码沙箱、数学函数、交互网页课件、作业提交、随机点名、问候插件，以及基础画布图元。' +
        '用于验证课程导入链路是否完整保留时间线、白板元素与课件附件。',
      author: 'OpenLearn',
      tags: ['模板', '测试样例', '全部预设组件'],
    },
    lesson: {
      title: '【样例】OpenLearn 预设组件全览',
      content: [
        '## 🎯 教学目标',
        '',
        '- 逐一验证备课面板的每一个预设组件在导入后仍可正常渲染与交互；',
        '- 验证课程导入后**教学环节、白板元素、课件附件**三者均完整落库；',
        '- 为「课件演示」组件的 Markdown / PDF / PPTX 三种数据来源各准备一份素材。',
        '',
        '## 🧭 教学重难点',
        '',
        '- 重点：区分「课程内容（lessons.content）」与「白板元素（whiteboard_elements）」两套数据载体；',
        '- 难点：附件的 `fileUrl` 是本机相对路径，跨实例搬运必须重新落盘。',
        '',
        '## 🕒 课堂流程设计',
        '',
        '1. 准备环节：认识样例课的结构与本节课要覆盖的组件清单。',
        '2. 讲授新课：逐个打开内容呈现类组件（演示文稿 / 代码沙箱 / 数学函数 / 交互网页课件）。',
        '3. 互动练习：使用随堂测试与作业提交组件。',
        '4. 随堂测验：随机点名与问候插件。',
        '5. 要点总结：回顾组件清单，确认全部可用。',
        '',
        '## ❓ 关键问题链',
        '',
        '1. 导入一节课程后，白板上为什么什么都没有？',
        '2. 演示文稿的 PDF 版本与 Markdown 版本在数据上有什么不同？',
        '3. 教学环节（timeline）如何决定白板元素的可见范围？',
        '',
        '## 📝 课堂练习与随堂检测',
        '',
        '- 练习：把「代码沙箱」里的示例改成自己的名字并运行。',
        '- 检测：使用「随堂测试」组件回答一道题目。',
        '',
        '## 📥 课后作业',
        '',
        '- 使用「作业提交」组件提交一份本节课的组件截图笔记。',
      ].join('\n'),
      progressMode: 'manual',
      timeline: [
        {
          id: SEG.intro,
          title: '准备环节',
          type: 'intro',
          duration: '5m',
          notes: '介绍样例课结构，演示本白板包含的组件清单。',
        },
        {
          id: SEG.lecture,
          title: '讲授新课',
          type: 'lecture',
          duration: '20m',
          notes: '逐个讲解内容呈现类组件：演示文稿（Markdown / PDF / PPTX）、代码沙箱、数学函数、交互网页课件。',
        },
        {
          id: SEG.practice,
          title: '互动练习',
          type: 'practice',
          duration: '15m',
          notes: '使用随堂测试与作业提交组件，组织学生完成任务。',
        },
        {
          id: SEG.quiz,
          title: '随堂测验',
          type: 'quiz',
          duration: '10m',
          notes: '使用随机点名组件抽取学生回答，必要时用问候插件活跃气氛。',
          gates: [{ id: 'gate-quiz-completed', type: 'quiz_completed' }],
        },
        {
          id: SEG.summary,
          title: '要点总结',
          type: 'summary',
          duration: '5m',
          notes: '回顾全部组件清单，确认导入结果完整。',
          gates: [{ id: 'gate-assignment-submitted', type: 'assignment_submitted' }],
        },
      ],
    },
    assets: [
      {
        id: 'asset-sample-handout',
        filename: 'openlearn-sample-handout.pdf',
        contentType: 'pdf',
        base64: pdf.toString('base64'),
      },
      {
        id: 'asset-sample-deck',
        filename: 'openlearn-sample-deck.pptx',
        contentType: 'pptx',
        base64: pptx.toString('base64'),
      },
    ],
    elements: [
      // ── 分页元数据（决定白板有两页，并给每页一个稳定 id）────────────────
      {
        type: 'page_meta',
        data: {
          pages: [
            { id: PAGE.overview, title: 'P1 · 组件总览', order: 0 },
            { id: PAGE.interaction, title: 'P2 · 课堂互动', order: 1 },
          ],
        },
      },

      // ── P1 · 组件总览 ────────────────────────────────────────────────────
      {
        type: 'text',
        segmentId: SEG.intro,
        page: 0,
        pageId: PAGE.overview,
        x: 40,
        y: 40,
        width: 560,
        height: 80,
        data: {
          text: 'OpenLearn 预设组件全览（导入测试样例）',
          fontFamily: 'sans-serif',
          fontSize: 26,
          fill: '#1e293b',
          align: 'left',
        },
      },
      {
        type: 'presentation',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 40,
        y: 150,
        width: 600,
        height: 400,
        data: {
          markdown: [
            '# 课件演示 · Markdown 版',
            '',
            '这是「课件演示」组件的**内联 Markdown** 数据源。',
            '',
            '---',
            '',
            '## 组件能做什么',
            '',
            '- 用 `---` 单独一行分隔幻灯片；',
            '- 支持标题、列表、表格等 Markdown 语法；',
            '- 支持自动播放与全屏放映。',
            '',
            '---',
            '',
            '## 试一试',
            '',
            '按方向键翻页，或点击右下角的「全屏放映」。',
          ].join('\n'),
          slideX: 0,
          slideY: 0,
          isFullscreenSynced: true,
          isFullscreenForced: false,
        },
      },
      {
        type: 'presentation',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 680,
        y: 150,
        width: 600,
        height: 400,
        data: {
          fileUrl: '${asset:asset-sample-handout}',
          fileName: 'openlearn-sample-handout.pdf',
          fileType: 'pdf',
          slideX: 0,
          slideCount: 3,
          isFullscreenSynced: true,
          isFullscreenForced: false,
        },
      },
      {
        type: 'presentation',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 1320,
        y: 150,
        width: 600,
        height: 400,
        data: {
          fileUrl: '${asset:asset-sample-deck}',
          fileName: 'openlearn-sample-deck.pptx',
          fileType: 'pptx',
          slideX: 0,
          slideCount: 2,
          isFullscreenSynced: true,
          isFullscreenForced: false,
        },
      },
      {
        type: 'code-sandbox',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 40,
        y: 600,
        width: 400,
        height: 320,
        data: {
          code: [
            '// 代码沙箱 · 改一处再运行看看',
            'const components = [',
            "  'presentation',",
            "  'quiz',",
            "  'code-sandbox',",
            "  'math-graph',",
            "  'html-applet',",
            "  'assignment',",
            "  'rollcall',",
            "  'hello-world',",
            '];',
            '',
            'console.log(`本次导入覆盖 ${components.length} 个预设组件`);',
            'console.log(components.join(',
            '));',
          ].join('\n'),
          language: 'javascript',
        },
      },
      {
        type: 'math-graph',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 480,
        y: 600,
        width: 400,
        height: 350,
        data: {
          equation: 'Math.sin(x) * Math.exp(-x / 6)',
        },
      },
      {
        type: 'html-applet',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 920,
        y: 600,
        width: 400,
        height: 300,
        data: {
          title: '交互网页课件样例',
          code: [
            '<div style="font-family: system-ui; padding: 16px;">',
            '  <h3 style="margin: 0 0 8px;">交互网页课件（内联 HTML）</h3>',
            '  <p style="color: #475569; margin: 0 0 12px;">点击按钮试试 —— 课件运行在沙箱 iframe 中。</p>',
            '  <button id="hit" style="padding: 6px 14px; border-radius: 8px; border: 1px solid #4f46e5;',
            '          background: #eef2ff; color: #4338ca; cursor: pointer;">点我</button>',
            '  <p id="out" style="margin-top: 12px; color: #0f766e;"></p>',
            '  <script>',
            "    document.getElementById('hit').addEventListener('click', () => {",
            "      document.getElementById('out').textContent = '点击成功 ✅ 交互正常';",
            '    });',
            '  </script>',
            '</div>',
          ].join('\n'),
        },
      },
      {
        type: 'rectangle',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 1360,
        y: 600,
        width: 220,
        height: 160,
        data: {
          shapeType: 'rect',
          fill: '#e0e7ff',
          stroke: '#4f46e5',
          strokeWidth: 2,
          cornerRadius: 8,
          text: '矩形图元',
        },
      },
      {
        type: 'circle',
        segmentId: SEG.lecture,
        page: 0,
        pageId: PAGE.overview,
        x: 1620,
        y: 600,
        width: 160,
        height: 160,
        data: {
          shapeType: 'circle',
          fill: '#fef3c7',
          stroke: '#d97706',
          strokeWidth: 2,
          text: '圆形图元',
        },
      },

      // ── P2 · 课堂互动 ────────────────────────────────────────────────────
      {
        type: 'quiz',
        segmentId: SEG.practice,
        page: 1,
        pageId: PAGE.interaction,
        x: 40,
        y: 40,
        width: 340,
        height: 380,
        data: {
          question: '课程导入后，「教学环节」保存在哪张表里？',
          options: ['lessons.timeline', 'whiteboard_elements', 'vfs_nodes', 'system_resources'],
          correctIndex: 0,
        },
      },
      {
        type: 'assignment',
        segmentId: SEG.practice,
        page: 1,
        pageId: PAGE.interaction,
        x: 420,
        y: 40,
        width: 340,
        height: 400,
        data: {
          title: '课后作业 · 组件截图笔记',
          description:
            '请截取本节课中**代码沙箱**、**数学函数**、**交互网页课件**三个组件的运行画面，' +
            '整理成一份笔记并通过本组件提交。',
        },
      },
      {
        type: 'rollcall',
        segmentId: SEG.quiz,
        page: 1,
        pageId: PAGE.interaction,
        x: 800,
        y: 40,
        width: 340,
        height: 420,
        data: {
          allStudents: [],
        },
      },
      {
        type: 'hello-world',
        segmentId: SEG.quiz,
        page: 1,
        pageId: PAGE.interaction,
        x: 1180,
        y: 40,
        width: 360,
        height: 260,
        data: {},
      },
      {
        type: 'text',
        segmentId: SEG.summary,
        page: 1,
        pageId: PAGE.interaction,
        x: 800,
        y: 500,
        width: 740,
        height: 120,
        data: {
          text: '要点总结：本次导入覆盖 8 个预设组件 + 3 个基础图元，含 PDF / PPTX 两份课件附件。',
          fontFamily: 'sans-serif',
          fontSize: 20,
          fill: '#0f172a',
          align: 'left',
        },
      },
    ],
  };
}
