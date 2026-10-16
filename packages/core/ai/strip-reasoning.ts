/**
 * OpenLearn AI Infrastructure - Reasoning Artifacts Stripper
 *
 * 剥离大模型输出中的思维链与内部推理伪标记（如 DeepSeek-R1、QwQ、Claude 思考模式输出的 <think>...</think>）。
 * 提供生成源头与各业务消费层的统一防护。
 */

export interface StripReasoningOptions {
  /**
   * 若清洗后内容为空，是否回退为去除首尾空白后的原文。
   * 默认为 false，即彻底剥除思考块；若输出仅包含思考块，则返回空字符串。
   */
  fallbackToRawIfEmpty?: boolean;
}

/**
 * 移除大模型返回文本中的 <think> 等思考/推理块。
 *
 * 支持：
 * 1. 成对闭合的思考块（跨行、不区分大小写、可选属性）：
 *    <think>...</think>、<thinking>...</thinking>、<reasoning>...</reasoning>、<analysis>...</analysis>
 * 2. 未闭合的截断思考块（如 max_tokens 截断时的尾部思考流）：
 *    <think>...$
 * 3. Markdown 代码围栏内的思考块：
 *    ```think ... ```、```reasoning ... ```
 * 4. 整体包裹的 json/markdown 外层代码围栏剥离
 * 5. 多余换行规范化（压缩 3+ 换行为 2）
 */
export function stripReasoningArtifacts(raw: string, options?: StripReasoningOptions): string {
  if (typeof raw !== 'string') return '';
  let out = raw;

  // 1. 成对闭合的思考块（跨行、大小写不敏感、支持标签属性如 <think id="x">）
  out = out.replace(/<(think|thinking|reasoning|analysis)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/gi, '');

  // 2. 未闭合的思考块（截断输出场景，直到字符串末尾）
  out = out.replace(/<(think|thinking|reasoning|analysis)(?:\s+[^>]*)?>[\s\S]*$/gi, '');

  // 3. Markdown 代码围栏内的思考块
  out = out.replace(/```(?:think|thinking|reasoning|analysis)[\s\S]*?```/gi, '');

  // 4. 剥掉包裹整体的外层 json/markdown 代码围栏
  out = out.replace(/^```(?:json|markdown|md)?\s*/i, '').replace(/```\s*$/i, '');

  // 5. 压缩多余连续换行与首尾空白
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  // 若清洗后为空且指定了回退，则返回去除空白的原文本；否则返回清洗后的空字符串
  if (out.length === 0 && options?.fallbackToRawIfEmpty) {
    return raw.trim();
  }

  return out;
}

/**
 * 兼容别名，默认保留与 server/routes/classroom-extras.ts 一致的回退行为（fallbackToRawIfEmpty: true）
 */
export function stripModelArtifacts(raw: string, options?: StripReasoningOptions): string {
  return stripReasoningArtifacts(raw, { fallbackToRawIfEmpty: true, ...options });
}
