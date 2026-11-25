/**
 * 声明式题型 UI 的宿主包装（`manifest.contributes['assessment.question_type']`）。
 *
 * manifest 只声明三个沙箱页面（editorView / answerView / reviewView），
 * 这里把它们包成题型注册表能消费的 React 组件，并通过 `question.*` 桥接
 * 与 iframe 交换配置 / 答案键 / 作答值。
 *
 * 安全边界：
 * - answer 角色永不接收 `answerKey`（由 `sanitizeQuestionState` 再兜一层）；
 * - 所有回写 op 必须与角色匹配，payload 必须 JSON 安全且 ≤64KB；
 * - review 角色只读，拒绝一切 setter。
 */
import React from 'react';
import {
  PluginSandboxIframeView,
  type PluginHostCallResult,
  type QuestionSandboxState,
} from '../../components/PluginSandboxIframeView';
import type { AssessmentKind, QuestionCategory } from '../../../packages/core/assessment/index.js';
import type {
  AssessmentQuestionTypeUi,
  QuestionAnswerProps,
  QuestionEditorProps,
  QuestionReviewProps,
} from './question-type-ui-registry';

const MAX_QUESTION_PAYLOAD = 64 * 1024;

function isJsonSafe(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= MAX_QUESTION_PAYLOAD;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ManifestQuestionUiInput {
  pluginId: string;
  type: string;
  label: string;
  labelEn?: string;
  category: QuestionCategory;
  supports?: AssessmentKind[];
  editorView?: string;
  answerView?: string;
  reviewView?: string;
  defaultConfig?: Record<string, unknown>;
  defaultAnswerKey?: unknown;
}

/** 把 manifest 声明转成题型注册表条目；缺编辑器时返回 null。 */
export function createManifestQuestionUi(input: ManifestQuestionUiInput): AssessmentQuestionTypeUi | null {
  const { pluginId, type } = input;
  if (!input.editorView) return null;

  const Editor: React.FC<QuestionEditorProps> = ({ config, answerKey, onChange, disabled }) => (
    <div style={{ height: 320 }}>
      <PluginSandboxIframeView
        pluginId={pluginId}
        view={input.editorView as string}
        label={input.label}
        slot="assessment.question_type.editor"
        maxContextBytes={MAX_QUESTION_PAYLOAD}
        style={{ height: 320 }}
        question={{ type, role: 'editor', config, answerKey, readOnly: disabled }}
        onHostCall={({ op, args }): PluginHostCallResult => {
          if (op === 'question.setConfig') {
            if (!isPlainObject(args[0]) || !isJsonSafe(args[0])) {
              return { handled: true, error: 'config must be a JSON object within 64KB' };
            }
            onChange({ config: args[0], answerKey });
            return { handled: true };
          }
          if (op === 'question.setAnswerKey') {
            if (!isJsonSafe(args[0])) {
              return { handled: true, error: 'answerKey must serialize within 64KB' };
            }
            onChange({ config, answerKey: args[0] ?? null });
            return { handled: true };
          }
          return { handled: false };
        }}
      />
    </div>
  );

  const Answer: React.FC<QuestionAnswerProps> | undefined = input.answerView
    ? ({ config, value, onChange, readOnly }) => (
        <div style={{ minHeight: 200 }}>
          <PluginSandboxIframeView
            pluginId={pluginId}
            view={input.answerView as string}
            label={input.label}
            slot="assessment.question_type.answer"
            maxContextBytes={MAX_QUESTION_PAYLOAD}
            style={{ minHeight: 200 }}
            question={{ type, role: 'answer', config, value, readOnly }}
            onHostCall={({ op, args }): PluginHostCallResult => {
              if (op !== 'question.setValue') return { handled: false };
              if (!isJsonSafe(args[0])) {
                return { handled: true, error: 'answer must serialize within 64KB' };
              }
              onChange(args[0] ?? null);
              return { handled: true };
            }}
          />
        </div>
      )
    : undefined;

  const Review: React.FC<QuestionReviewProps> | undefined = input.reviewView
    ? ({ config, answer, answerKey, score, isCorrect, feedback, readOnly }) => {
        const question: QuestionSandboxState = {
          type,
          role: 'review',
          config,
          answerKey,
          value: answer,
          score,
          isCorrect,
          feedback,
          readOnly: readOnly ?? true,
        };
        return (
          <div style={{ minHeight: 200 }}>
            <PluginSandboxIframeView
              pluginId={pluginId}
              view={input.reviewView as string}
              label={input.label}
              slot="assessment.question_type.review"
              maxContextBytes={MAX_QUESTION_PAYLOAD}
              style={{ minHeight: 200 }}
              question={question}
              onHostCall={() => ({ handled: false })}
            />
          </div>
        );
      }
    : undefined;

  return {
    type,
    label: { zh: input.label, en: input.labelEn ?? input.label },
    category: input.category,
    supports: input.supports ?? ['quiz', 'exam', 'survey'],
    Editor,
    Answer,
    Review,
    createDefaultConfig: () => ({ ...(input.defaultConfig ?? {}) }),
    createDefaultAnswerKey: () => input.defaultAnswerKey ?? null,
  };
}
