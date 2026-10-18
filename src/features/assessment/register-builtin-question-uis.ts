/**
 * 内置 5 种题型的 UI 注册（与 `packages/core/assessment/question-types/builtin.ts` 一一对应）。
 *
 * 默认配置也照抄 core：新题在出题页看到的初始值 == 服务端判分器期待的初始值。
 */
import { assessmentQuestionTypeUiRegistry } from './question-type-ui-registry';
import {
  FillBlankEditor,
  MultipleChoiceEditor,
  ShortAnswerEditor,
  SingleChoiceEditor,
  TrueFalseEditor,
} from './builtin-question-uis';

const DEFAULT_OPTIONS = ['选项 A', '选项 B', '选项 C', '选项 D'];

let registered = false;

/** 幂等安装内置题型 UI（模块级调用一次，测试里可重复调用）。 */
export function registerBuiltinQuestionTypeUis(): void {
  if (registered) return;
  registered = true;

  assessmentQuestionTypeUiRegistry.register({
    type: 'single_choice',
    label: { zh: '单选题', en: 'Single choice' },
    category: 'objective',
    supports: ['quiz', 'exam', 'survey'],
    Editor: SingleChoiceEditor,
    createDefaultConfig: () => ({ options: [...DEFAULT_OPTIONS] }),
    createDefaultAnswerKey: () => ({ index: 0 }),
  });

  assessmentQuestionTypeUiRegistry.register({
    type: 'multiple_choice',
    label: { zh: '多选题', en: 'Multiple choice' },
    category: 'objective',
    supports: ['quiz', 'exam', 'survey'],
    Editor: MultipleChoiceEditor,
    createDefaultConfig: () => ({ options: [...DEFAULT_OPTIONS] }),
    createDefaultAnswerKey: () => ({ indexes: [0] }),
  });

  assessmentQuestionTypeUiRegistry.register({
    type: 'true_false',
    label: { zh: '判断题', en: 'True / false' },
    category: 'objective',
    supports: ['quiz', 'exam', 'survey'],
    Editor: TrueFalseEditor,
    createDefaultConfig: () => ({ trueLabel: '正确', falseLabel: '错误' }),
    createDefaultAnswerKey: () => ({ value: true }),
  });

  assessmentQuestionTypeUiRegistry.register({
    type: 'fill_blank',
    label: { zh: '填空题', en: 'Fill in the blank' },
    category: 'objective',
    supports: ['quiz', 'exam', 'survey'],
    Editor: FillBlankEditor,
    createDefaultConfig: () => ({ blanks: [{ id: 'b1', inputType: 'text' }] }),
    createDefaultAnswerKey: () => null,
  });

  assessmentQuestionTypeUiRegistry.register({
    type: 'short_answer',
    label: { zh: '简答/论述', en: 'Short answer' },
    category: 'subjective',
    supports: ['quiz', 'exam', 'survey'],
    Editor: ShortAnswerEditor,
    createDefaultConfig: () => ({ placeholder: '请输入你的作答', maxLength: 2000 }),
    createDefaultAnswerKey: () => null,
  });
}

registerBuiltinQuestionTypeUis();
