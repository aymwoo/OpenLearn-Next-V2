/**
 * scripts/sweep/types.ts —— 功能巡检工具的共享类型
 *
 * @module
 */

/** 参与巡检的角色。 */
export type SweepRoleId = 'admin' | 'teacher' | 'student' | 'student-live' | 'teacher-live';

/**
 * 一次巡检中「点击某个可访问名称的按钮」的描述。
 *
 * `name` 是正则源字符串（不区分大小写），用于匹配按钮的可访问名（aria-label 或文本）。
 */
export interface SweepClickSpec {
  /** 按钮可访问名的正则源，例如 `我的测评|Assessments`。 */
  name?: string;
  /** 按钮文本的正则源（当可访问名不包含图标文本时使用）。 */
  text?: string;
  /** 命中多个时取第 n 个（从 0 开始）。 */
  nth?: number;
  /** 直接指定 CSS 选择器（优先级最高，用于 id 稳定的按钮）。 */
  selector?: string;
}

/** 视图内的二级页签。 */
export interface SweepSubTab {
  /** 机器可读 ID，用于生成截图文件名。 */
  id: string;
  /** 报告中显示的名字。 */
  label: string;
  /** 页签按钮可访问名的正则源。 */
  name: string;
  /**
   * 进入页签之前的必要点击。
   *
   * 例：班级管理的页签要**先展开某个班级**才会出现（先点班级行，再点页签）。
   */
  preClick?: SweepClickSpec;
}

/** 一个待巡检的写流程剧本。 */
export interface SweepScenario {
  /** 机器可读 ID。 */
  id: string;
  /** 报告中显示的中文名。 */
  label: string;
  /** 需要哪些角色参与（引擎为它们各开一个浏览器上下文，全程保持登录态）。 */
  roles: SweepRoleId[];
  /** 剧本步骤（按顺序执行）。 */
  steps: SweepScenarioStep[];
}

/** 剧本里的一步。 */
export interface SweepScenarioStep {
  /** 步骤名（报告里显示）。 */
  label: string;
  /** 执行这一步的角色。 */
  role: SweepRoleId;
  /**
   * 业务动作：在该角色的会话下调用 API。
   *
   * 写操作走 API 而不是 UI —— UI 一改版剧本就碎，而 API 契约是稳定的。
   * 剧本的价值不在「把按钮点一遍」，而在**动作前后浏览器的真实渲染**。
   */
  api?: {
    method: 'POST' | 'GET';
    path: string;
    body?: Record<string, unknown>;
  };
  /** 动作后要打开的界面（浏览器），用于收集沿途噪音。 */
  view?: {
    /** 路径（含查询串），默认 `/` */
    path?: string;
    /** hash 路由（如 `classes` → `/#/classes`） */
    hash?: string;
  };
  /** 断言：API 响应体里某个点分路径的字段。 */
  expect?: {
    /** 点分路径，如 `assignmentId` / `result.calculatedFinalScore` */
    path: string;
    equals?: unknown;
    notEmpty?: boolean;
  };
  /** 把 API 响应体里某个字段存成变量，供后续步骤用 `{{name}}` 引用。 */
  capture?: {
    name: string;
    path: string;
  };
}

/** 剧本里单步的结果。 */
export interface SweepScenarioStepResult {
  label: string;
  role: SweepRoleId;
  roleLabel: string;
  status: 'ok' | 'error' | 'skipped';
  issues: SweepIssue[];
  screenshot?: string;
  detail?: string;
  durationMs: number;
}

/** 一个剧本的整体结果。 */
export interface SweepScenarioResult {
  id: string;
  label: string;
  status: 'ok' | 'error' | 'skipped';
  steps: SweepScenarioStepResult[];
}

/** 一个待巡检的视图。 */
export interface SweepTarget {
  /** 机器可读 ID（截图文件名由此生成）。 */
  id: string;
  /** 报告中显示的中文名。 */
  label: string;
  /**
   * 教师/管理员工作台的 hash 路由（见 src/utils/teacherTabHash.ts）。
   * 例：`courses` → `/#/courses`。与 `path` 二选一。
   */
  hash?: string;
  /**
   * 直接路径（学生端用）。例：`/?mode=student_live&lessonId=demo-lesson`。
   * 与 `hash` 二选一；缺省为 `/`。
   */
  path?: string;
  /** 进入视图后额外点击的元素（用于进入「我的测评」这类非路由可达的子视图）。 */
  click?: SweepClickSpec;
  /**
   * 点击 {@link click} 之前必须先做的展开动作。
   *
   * 例：学生端的「查看待办作业」按钮藏在快捷操作浮层里，浮层默认收起，
   * 得先点开浮层（`#student-quick-actions-fab-btn`）按钮才存在。
   */
  open?: SweepClickSpec;
  /** 需要逐一钻取的二级页签。 */
  subTabs?: SweepSubTab[];
  /**
   * 该入口在当前轮次**本来就不该存在**（缺少前置条件）。
   *
   * 例：没有进行中的课堂会话时，学生端的「进入实时课堂」入口不会渲染。
   * 这种“没找到”是预期结果，报告会单独归类，不算缺陷。
   */
  expectMissing?: boolean;
  /** 备注，出现在报告的「说明」列。 */
  note?: string;
}

/** 角色的登录方式。 */
export interface SweepLogin {
  /** 登录入口。 */
  entrance: 'teacher' | 'student';
  /** 教师/管理员账号名。 */
  username?: string;
  /** 教师/管理员口令。 */
  password?: string;
  /** 学生学号（或学生 id）。 */
  studentId?: string;
}

/** 一个角色的巡检计划。 */
export interface SweepRole {
  id: SweepRoleId;
  /** 报告中显示的角色名。 */
  label: string;
  login: SweepLogin;
  /**
   * 本轮巡检前需要补齐的前置数据。
   *
   * 例：`assignment`（学生有待办作业）、`classroomSession`（有进行中的课堂会话）。
   */
  prepare?: ('assignment' | 'classroomSession' | 'classroomInProgress')[];
  targets: SweepTarget[];
}

/** 巡检过程中发现的一个问题。 */
export interface SweepIssue {
  kind: 'pageerror' | 'console' | 'requestfailed' | 'http' | 'nav';
  severity: 'error' | 'warning';
  message: string;
  url?: string;
  status?: number;
  /**
   * 是否属于「全局问题」——每次进入系统都会复现的那种。
   * 由报告阶段回填（见 report.ts 的 classifyGlobalIssues）。
   */
  global?: boolean;
}

/** 单个视图的巡检结果。 */
export interface SweepViewResult {
  role: SweepRoleId;
  roleLabel: string;
  targetId: string;
  targetLabel: string;
  subTabId?: string;
  subTabLabel?: string;
  /** `ok` 干净 / `warn` 有 4xx 或失败请求 / `error` 有页面异常、console 错误或 5xx / `missing` 目标元素没找到。 */
  status: 'ok' | 'warn' | 'error' | 'missing';
  issues: SweepIssue[];
  /** 相对 artifacts 目录的截图路径。 */
  screenshot?: string;
  /** 未找到入口时，是否属于「预期内不存在」。 */
  expectedMissing?: boolean;
  /** 巡检时实际落在的 URL。 */
  url: string;
  durationMs: number;
}

/** 一次完整巡检的产物。 */
export interface SweepReport {
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  /** 数据环境说明（演示库 / 外部地址）。 */
  dataEnv: string;
  roles: SweepRoleId[];
  results: SweepViewResult[];
}
