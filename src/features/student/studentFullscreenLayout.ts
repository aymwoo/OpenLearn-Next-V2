/**
 * 学生端课节双栏（Lesson Content / 交互区）的全屏显隐规则。
 *
 * ## 根因（Issue IKVSIN）
 *
 * 学生端点「全屏」毫无反应，根因是 **Tailwind v4 的类覆盖顺序**：
 * 生成的 CSS 里
 *
 *   @layer utilities {
 *     .hidden      { display: none; }        ← 更早
 *     @media (min-width: 48rem) {
 *       .md\:block { display: block; }      ← 更晚 ⇒ 胜出
 *     }
 *   }
 *
 * 同层同优先级下后者胜出。而旧实现里「默认态」与「右栏全屏态」产出的是
 * **同一个 class 集合**（都是 `w-1/3 md:block hidden`），右栏全屏只是在其后
 * **追加**了一个 `hidden` —— 追加并不能让 `md:block` 失效，于是桌面端
 * `display:block` 覆盖 `display:none`，被要求隐藏的栏依然可见，
 * 视觉上就是「点了全屏没反应」。
 *
 * ## 规则
 *
 * 每个状态必须产出**唯一且完整**的显隐表达，两种意图不得共用同一个 class 集合：
 *
 *   · 全宽度隐藏   → `hidden`（**不得**再带 `md:block`，否则桌面端会被覆盖）
 *   · 仅桌面端显示 → `hidden md:block`（窄屏隐藏、桌面端显示，仓库既有写法，
 *                    与 `StudentAssignmentQuestionPanel` 一致）
 *   · 全宽度显示   → 不带任何 display 类（交给 `w-full` 等宽度类）
 *
 * 窄屏（<48rem）行为与修复前保持一致：内容栏默认不显示，仅在「左栏全屏」时
 * 占满整行。
 */

/** 学生端课节全屏态：`left` = 内容栏全屏，`right` = 交互区全屏。 */
export type StudentFullscreenPanel = 'left' | 'right' | 'none';

/**
 * 内容栏（Lesson Content）的 class。
 *
 * @param fullscreenPanel 当前全屏态
 * @param collapsed 课程内容是否被折叠（未传视为未折叠）
 */
export function resolveContentPanelClass(fullscreenPanel: StudentFullscreenPanel, collapsed?: boolean): string {
  // 右栏全屏：内容栏必须让位 —— **所有宽度都隐藏**。
  // 这里绝不能再带 `md:block`，否则桌面端会被它覆盖成可见（正是 IKVSIN 的根因）。
  if (fullscreenPanel === 'right') return 'hidden';
  // 左栏全屏：内容栏占满宽度，无需与交互区之间的分隔线。
  // **优先于 collapsed**：左栏全屏的语义就是「看课程内容」，若折叠态优先，
  // 两个栏会同时不可见（空白页），且左栏的「退出全屏」按钮也随之消失。
  if (fullscreenPanel === 'left') return 'w-full';
  // 用户主动折叠：整体隐藏
  if (collapsed) return 'hidden';
  // 默认态：桌面端占 1/3，窄屏不显示。
  // `hidden md:block` 是「仅桌面端显示」的完整表达，与上面的「全宽度隐藏」是两套
  // 不同的 class 集合，因此不会再出现「追加 hidden 却覆盖不掉 md:block」的情况。
  // `border-r` 只在内容栏与交互区并排时才有意义（独占全屏 / 隐藏时不需要分隔线）。
  return 'hidden md:block w-1/3 border-r';
}

/**
 * 交互区（白板 / 课件 / 作业）的 class。
 *
 * @param fullscreenPanel 当前全屏态
 * @param collapsed 课程内容是否被折叠（折叠时交互区本就占满整行；未传视为未折叠）
 */
export function resolveInteractionPanelClass(fullscreenPanel: StudentFullscreenPanel, collapsed?: boolean): string {
  // 左栏全屏：交互区让位
  if (fullscreenPanel === 'left') return 'hidden';
  // 右栏全屏：交互区占满整行
  if (fullscreenPanel === 'right') return 'w-full flex-grow';
  // 内容栏折叠 → 交互区本就独占整行；否则与内容栏按 1/3 : 余量分配
  return collapsed ? 'w-full flex-grow' : 'flex-grow flex-1';
}
