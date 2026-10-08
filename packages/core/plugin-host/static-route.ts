/**
 * 静态路由路径归一化（L-2 阶段 2 从 `PluginHost` 类里抽出）。
 *
 * ## 归一化规则
 *
 * 1. 转小写 —— URL 路径大小写不敏感（沿用既有行为而非新引入：改动会扩大影响面，
 *    而它本身不是缺陷）
 * 2. 压缩重复斜杠 —— `//a` 等价于 `/a`
 * 3. 去掉末尾斜杠 —— `/a/` 等价于 `/a`；根路径 `/` 例外，保留
 * 4. 补前导斜杠 —— 使 `a/b` 与 `/a/b` 也等价
 *
 * ## 为什么要抽成独立模块
 *
 * 原先是 `PluginHost` 的 `private static` 方法。测试够不着它 —— 类外既不能 import
 * `private` 成员，也无法继承一个 `private static`。于是测试只能**从源码文本里按标记
 * 切出函数体**、再用 `new Function` 求值（25 行字符串手术）。
 *
 * 这与 bootstrap 遮蔽块当年的困境同构：**测试够不着代码**，于是测试本身退化成脆弱的
 * 文本加工 —— 源码一改结构，测试报的是「未找到 normalizeStaticRoute（源码结构变了？）」
 * 而不是「归一化规则错了」。
 *
 * 函数是纯的、无 this 依赖，抽取后测试可直接 import 真货：副本会漂移，真货不会。
 *
 * 语义零变化：类上的 `protected static normalizeStaticRoute` 现在委托到这里。
 */

/** 归一化静态路由路径 —— 纯函数，无副作用 */
export function normalizeStaticRoute(route: string): string {
  const lowered = route.trim().toLowerCase();
  const collapsed = lowered.replace(/\/{2,}/g, '/');
  const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
  // 根路径 '/' 不能被削成 '' —— 它是合法的（虽然本处拒绝把 '/' 注册给插件，
  // 见 SEC-ROUTE-02，但归一化函数本身应保持幂等与正确）
  const withoutTrailing = withLeading.length > 1 ? withLeading.replace(/\/+$/, '') : withLeading;
  return withoutTrailing || '/';
}

export default normalizeStaticRoute;
