/**
 * 学案活动类型专属配置（阅读 / 作品提交 / 调查 / 填表 / 讨论）。
 * 试题活动仍走「引用试卷」的原子接口，不在此组件内编辑。
 */
import {
  newConfigItemId,
  readBoolean,
  readFormConfig,
  readString,
  readSurveyConfig,
  type FormField,
  type FormFieldType,
  type SurveyQuestion,
  type SurveyQuestionType,
} from '../../xuean/activity-config';

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40';

const textareaClass = `${inputClass} text-xs font-mono`;

function splitOptions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function ActivityConfigEditor({
  type,
  value,
  onChange,
}: {
  type: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (type === 'reading') {
    return (
      <div className="space-y-2 rounded-lg border border-theme p-3">
        <p className="text-xs font-bold text-main">阅读内容</p>
        <textarea
          value={readString(value, 'content')}
          onChange={(event) => onChange({ ...value, content: event.target.value })}
          rows={6}
          aria-label="阅读内容"
          placeholder="粘贴阅读材料正文（支持换行，学生端按纯文本展示）"
          className={textareaClass}
        />
        <input
          type="url"
          value={readString(value, 'url')}
          onChange={(event) => onChange({ ...value, url: event.target.value })}
          aria-label="阅读材料链接"
          placeholder="可选：外部阅读链接，如 https://…"
          className={inputClass}
        />
      </div>
    );
  }

  if (type === 'submission') {
    return (
      <div className="space-y-2 rounded-lg border border-theme p-3">
        <p className="text-xs font-bold text-main">练习要求</p>
        <textarea
          value={readString(value, 'instructions')}
          onChange={(event) => onChange({ ...value, instructions: event.target.value })}
          rows={4}
          aria-label="练习要求"
          placeholder="说明学生需要提交什么，例如：写出实验结论并附上过程截图链接"
          className={textareaClass}
        />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={readBoolean(value, 'acceptText', true)}
              onChange={(event) => onChange({ ...value, acceptText: event.target.checked })}
            />
            允许文字作答
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={readBoolean(value, 'acceptLink', true)}
              onChange={(event) => onChange({ ...value, acceptLink: event.target.checked })}
            />
            允许提交作品链接
          </label>
        </div>
      </div>
    );
  }

  if (type === 'survey') {
    const { description, questions } = readSurveyConfig(value);
    const setQuestions = (next: SurveyQuestion[]) => onChange({ ...value, description, questions: next });
    return (
      <div className="space-y-3 rounded-lg border border-theme p-3">
        <div className="space-y-2">
          <p className="text-xs font-bold text-main">调查设置</p>
          <textarea
            value={description}
            onChange={(event) => onChange({ ...value, description: event.target.value, questions })}
            rows={2}
            aria-label="调查说明"
            placeholder="可选：向学生说明本次调查的目的"
            className={textareaClass}
          />
        </div>
        <div className="space-y-2">
          {questions.map((question, index) => (
            <div
              key={question.id}
              className="space-y-2 rounded-lg border border-theme/70 bg-surface-secondary/40 p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-muted shrink-0">Q{index + 1}</span>
                <input
                  type="text"
                  value={question.title}
                  onChange={(event) => {
                    const next = questions.slice();
                    next[index] = { ...question, title: event.target.value };
                    setQuestions(next);
                  }}
                  aria-label={`调查题目 ${index + 1}`}
                  placeholder="题目"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setQuestions(questions.filter((item) => item.id !== question.id))}
                  className="px-2 py-1 text-xs rounded border border-rose-500/30 text-rose-600 hover:bg-rose-500/10 shrink-0"
                >
                  删除
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={question.type}
                  onChange={(event) => {
                    const next = questions.slice();
                    next[index] = { ...question, type: event.target.value as SurveyQuestionType };
                    setQuestions(next);
                  }}
                  aria-label={`调查题目 ${index + 1} 类型`}
                  className={inputClass}
                >
                  <option value="single">单选</option>
                  <option value="multiple">多选</option>
                  <option value="text">填空</option>
                </select>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(event) => {
                      const next = questions.slice();
                      next[index] = { ...question, required: event.target.checked };
                      setQuestions(next);
                    }}
                  />
                  必答
                </label>
              </div>
              {question.type !== 'text' ? (
                <textarea
                  value={question.options.join('\n')}
                  onChange={(event) => {
                    const next = questions.slice();
                    next[index] = { ...question, options: splitOptions(event.target.value) };
                    setQuestions(next);
                  }}
                  rows={3}
                  aria-label={`调查题目 ${index + 1} 选项`}
                  placeholder="每行一个选项"
                  className={textareaClass}
                />
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setQuestions([
                ...questions,
                {
                  id: newConfigItemId('q'),
                  title: '',
                  type: 'single',
                  options: ['选项 1', '选项 2'],
                  required: true,
                },
              ])
            }
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-theme hover:bg-surface-secondary"
          >
            + 添加题目
          </button>
        </div>
      </div>
    );
  }

  if (type === 'form') {
    const { description, fields } = readFormConfig(value);
    const setFields = (next: FormField[]) => onChange({ ...value, description, fields: next });
    return (
      <div className="space-y-3 rounded-lg border border-theme p-3">
        <div className="space-y-2">
          <p className="text-xs font-bold text-main">填表设置</p>
          <textarea
            value={description}
            onChange={(event) => onChange({ ...value, description: event.target.value, fields })}
            rows={2}
            aria-label="填表说明"
            placeholder="可选：向学生说明填表要求"
            className={textareaClass}
          />
        </div>
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="space-y-2 rounded-lg border border-theme/70 bg-surface-secondary/40 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-muted shrink-0">F{index + 1}</span>
                <input
                  type="text"
                  value={field.label}
                  onChange={(event) => {
                    const next = fields.slice();
                    next[index] = { ...field, label: event.target.value };
                    setFields(next);
                  }}
                  aria-label={`表单字段 ${index + 1} 名称`}
                  placeholder="字段名称"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setFields(fields.filter((item) => item.id !== field.id))}
                  className="px-2 py-1 text-xs rounded border border-rose-500/30 text-rose-600 hover:bg-rose-500/10 shrink-0"
                >
                  删除
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={field.type}
                  onChange={(event) => {
                    const next = fields.slice();
                    next[index] = { ...field, type: event.target.value as FormFieldType };
                    setFields(next);
                  }}
                  aria-label={`表单字段 ${index + 1} 类型`}
                  className={inputClass}
                >
                  <option value="text">单行文本</option>
                  <option value="textarea">多行文本</option>
                  <option value="number">数字</option>
                  <option value="select">下拉选择</option>
                  <option value="checkbox">勾选（是/否）</option>
                </select>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => {
                      const next = fields.slice();
                      next[index] = { ...field, required: event.target.checked };
                      setFields(next);
                    }}
                  />
                  必填
                </label>
              </div>
              {field.type === 'select' ? (
                <textarea
                  value={field.options.join('\n')}
                  onChange={(event) => {
                    const next = fields.slice();
                    next[index] = { ...field, options: splitOptions(event.target.value) };
                    setFields(next);
                  }}
                  rows={3}
                  aria-label={`表单字段 ${index + 1} 选项`}
                  placeholder="每行一个选项"
                  className={textareaClass}
                />
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setFields([
                ...fields,
                { id: newConfigItemId('f'), label: '', type: 'text', options: [], required: false },
              ])
            }
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-theme hover:bg-surface-secondary"
          >
            + 添加字段
          </button>
        </div>
      </div>
    );
  }

  if (type === 'discussion') {
    return (
      <div className="space-y-2 rounded-lg border border-theme p-3">
        <p className="text-xs font-bold text-main">讨论设置</p>
        <textarea
          value={readString(value, 'prompt')}
          onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          rows={3}
          aria-label="讨论话题"
          placeholder="讨论话题或引导问题，例如：你如何看待…？"
          className={textareaClass}
        />
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={readBoolean(value, 'allowReplies', true)}
            onChange={(event) => onChange({ ...value, allowReplies: event.target.checked })}
          />
          允许学生互相回复
        </label>
      </div>
    );
  }

  return null;
}
