/**
 * ext-mode-pack-lab：第三方模式包安装链路示例。
 *
 * 这个包只做声明式贡献（manifest 里的 `contributes['mode.pack']`），
 * 激活时不需要注册服务或扩展点 —— 用于验证「打包 → 安装 → 激活 → 目录收录 →
 * 课时绑定」这条真实路径。需要能力诊断的 adapter / channel 场景由
 * `mode-pack-lab.acceptance.test.ts` 的纯函数用例覆盖。
 */
interface ModePackLabContext {
  log?: {
    info?: (message: string) => void;
  };
}

export default {
  manifest: {
    id: 'ext-mode-pack-lab',
    name: '探究学习模式包示例',
    version: '1.0.0',
    main: 'index.js',
  },

  async activate(ctx: ModePackLabContext) {
    ctx.log?.info?.('[mode-pack-lab] 模式包声明已生效');
  },

  async deactivate() {
    // 声明式贡献由宿主回收，无需额外清理。
  },
};
