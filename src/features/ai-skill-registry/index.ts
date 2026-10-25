/**
 * ⚠️ EXPERIMENTAL — 未接入生产链路，请勿作为依赖使用。
 *
 * @experimental 未接入生产链路；接线前请先满足下方前置条件。
 *
 * ## 为什么保留而没接
 *
 * 这套 AI Skill 是一份**完整实现 + 单测**的注册表设计，但当前**没有任何生产引用**：
 * `server/ai-agent.ts` 并不查它；AI 技能目前由插件 actor 派发，
 * 不经过本注册表。
 *
 * 换句话说，接线它不会带来任何新能力，而是**重写一条正在工作的链路** ——
 * 而 AI 功能需要配置 provider 才能验证，CI 无法覆盖。代价与风险都高于收益，
 * 所以在 2026-10 的孤儿模块清点中决定「标注保留、不接线」。
 *
 * ## 若要真正接入，前置条件
 *
 * 1. 先在 `server/ai-agent.ts` 里把能力判定（`action.capabilityRequired`）与
 *    provider 解析抽成可复用的一层 —— **不能让新注册表绕过现有授权**；
 * 2. 配好至少一个 AI provider，为本模块补集成测试（当前只有纯单元测试，
 *    全绿但从未在真实链路上跑过）；
 * 3. 逐个迁移现有 AI 入口（`/api/lessons/:id/ai-tutor`、白板 AI 工具栏、
 *    `ai_sidebar.tab` 槽位），确认行为等价后再删旧路径。
 *
 * 详见 docs/experimental-modules.md。
 */

export * from './ai-skill-types.js';
export * from './ai-skill-registry.js';
export * from './default-ai-skills.js';
