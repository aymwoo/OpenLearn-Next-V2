/**
 * 学案活动配置：教师端编排与学生端渲染共用的类型 / 解析工具。
 *
 * 各类型统一存放在 `lesson_activities.config_json`，学生提交统一走
 * `activity_progress.submission_json`（`{ type, content }`，其中结构化答案以 JSON 字符串存入 content）。
 */

export type SurveyQuestionType = 'single' | 'multiple' | 'text';

export interface SurveyQuestion {
  id: string;
  title: string;
  type: SurveyQuestionType;
  options: string[];
  required: boolean;
}

export interface SurveyConfig {
  description: string;
  questions: SurveyQuestion[];
}

export type FormFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  options: string[];
  required: boolean;
}

export interface FormConfig {
  description: string;
  fields: FormField[];
}

export interface ReadingConfig {
  content: string;
  url: string;
}

export interface SubmissionConfig {
  instructions: string;
  acceptText: boolean;
  acceptLink: boolean;
}

export interface DiscussionConfig {
  prompt: string;
  allowReplies: boolean;
}

/** 结构化答案的提交格式。 */
export interface StructuredAnswers {
  answers: Record<string, string | string[] | boolean>;
}

export function parseActivityConfig(configJson?: string | null): Record<string, unknown> {
  if (!configJson) return {};
  try {
    const parsed = JSON.parse(configJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function newConfigItemId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function readString(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key];
  return typeof value === 'string' ? value : fallback;
}

export function readBoolean(source: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function readSurveyConfig(config: Record<string, unknown>): SurveyConfig {
  const rawQuestions = Array.isArray(config.questions) ? config.questions : [];
  const questions: SurveyQuestion[] = rawQuestions
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const type = record.type === 'multiple' || record.type === 'text' ? record.type : 'single';
      return {
        id: readString(record, 'id', `q${index + 1}`),
        title: readString(record, 'title'),
        type,
        options: Array.isArray(record.options) ? record.options.filter((o): o is string => typeof o === 'string') : [],
        required: record.required !== false,
      } satisfies SurveyQuestion;
    })
    .filter((item): item is SurveyQuestion => item !== null);
  return { description: readString(config, 'description'), questions };
}

export function readFormConfig(config: Record<string, unknown>): FormConfig {
  const rawFields = Array.isArray(config.fields) ? config.fields : [];
  const fields: FormField[] = rawFields
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const type =
        record.type === 'textarea' || record.type === 'number' || record.type === 'select' || record.type === 'checkbox'
          ? record.type
          : 'text';
      return {
        id: readString(record, 'id', `f${index + 1}`),
        label: readString(record, 'label'),
        type,
        options: Array.isArray(record.options) ? record.options.filter((o): o is string => typeof o === 'string') : [],
        required: record.required === true,
      } satisfies FormField;
    })
    .filter((item): item is FormField => item !== null);
  return { description: readString(config, 'description'), fields };
}

/** 从已有提交中恢复结构化答案（兼容字符串形式的旧提交）。 */
export function readSubmittedAnswers(submissionJson?: string | null): {
  payload: StructuredAnswers | null;
  legacyText: string | null;
} {
  if (!submissionJson) return { payload: null, legacyText: null };
  try {
    const parsed = JSON.parse(submissionJson) as unknown;
    if (typeof parsed === 'string') return { payload: null, legacyText: parsed };
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const content = typeof record.content === 'string' ? record.content : '';
      if (content) {
        try {
          const inner = JSON.parse(content) as unknown;
          if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            const answers = (inner as Record<string, unknown>).answers;
            if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
              return { payload: { answers: answers as StructuredAnswers['answers'] }, legacyText: null };
            }
          }
        } catch {
          // content 不是 JSON：按普通文本提交处理
        }
        return { payload: null, legacyText: content };
      }
    }
  } catch {
    // submission_json 损坏时视为未提交
  }
  return { payload: null, legacyText: null };
}
