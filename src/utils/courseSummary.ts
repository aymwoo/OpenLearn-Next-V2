/**
 * Course Summary & Markdown Text Extraction Utility
 *
 * 用于在课程卡片、列表展示等场景中，安全提取纯文本简介：
 * 1. 彻底过滤大模型思维链 (<think>...</think>、未闭合 <think>、```think 等)
 * 2. 剥离 Markdown 标题、粗体、代码块、列表符号、图片等标记
 * 3. 截取规范长度的单段平铺纯文本，避免存量脏数据与排版错乱
 */

/**
 * 剥离大模型思维链与内部推理伪标记
 */
export function stripReasoningArtifacts(raw: string): string {
  if (typeof raw !== 'string') return '';
  let out = raw;

  // 1. 成对闭合的思考块（跨行、大小写不敏感、支持可选属性）
  out = out.replace(/<(think|thinking|reasoning|analysis)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/gi, '');

  // 2. 未闭合的思考块（截断场景）
  out = out.replace(/<(think|thinking|reasoning|analysis)(?:\s+[^>]*)?>[\s\S]*$/gi, '');

  // 3. Markdown 代码围栏内的思考块
  out = out.replace(/```(?:think|thinking|reasoning|analysis)[\s\S]*?```/gi, '');

  // 4. 整体包裹的外层代码围栏
  out = out.replace(/^```(?:json|markdown|md)?\s*/i, '').replace(/```\s*$/i, '');

  return out.trim();
}

/**
 * 将课程 Markdown 正文清洗为单段平铺的纯文本摘要。
 *
 * @param content 原始课程大纲或 Markdown 内容
 * @param maxLength 最大字符截取长度，默认 160
 */
export function extractCourseSummary(content: string | undefined | null, maxLength = 160): string {
  if (!content || typeof content !== 'string') return '';

  // 第一步：清洗所有模型思考块
  let text = stripReasoningArtifacts(content);
  if (!text) return '';

  // 第二步：清洗 Markdown 结构与代码块
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');
  text = text.replace(/\[(.*?)\]\(.*?\)/g, '$1');
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/^\s*>\s+/gm, '');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~(.*?)~~/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');

  // 第三步：压缩连续空白与换行为单空格
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}
