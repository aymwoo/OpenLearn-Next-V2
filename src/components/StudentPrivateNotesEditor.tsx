import React, { useState, useEffect, useRef } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  List, 
  ListOrdered, 
  Save, 
  Check, 
  Trash2, 
  EyeOff, 
  Lock, 
  Sparkles, 
  Type, 
  Highlighter, 
  Heading1, 
  Heading2, 
  Quote, 
  SquareDot,
  FileText,
  Clock,
  Tag,
  GraduationCap,
  Brain,
  Bookmark,
  AlertCircle
} from 'lucide-react';

interface StudentPrivateNotesEditorProps {
  studentId: string;
  studentName: string;
  initialValue?: string | null;
  onSave: (notes: string) => Promise<boolean>;
  lang?: 'zh' | 'en';
}

const CATEGORIES = {
  zh: [
    { key: 'General', label: '日常备忘', color: 'bg-emerald-50 text-emerald-700 border-emerald-250 hover:bg-emerald-100', icon: 'Bookmark' },
    { key: 'Academic', label: '学术表现', color: 'bg-blue-50 text-blue-700 border-blue-250 hover:bg-blue-100', icon: 'GraduationCap' },
    { key: 'Behavioral', label: '行为状态', color: 'bg-purple-50 text-purple-700 border-purple-250 hover:bg-purple-100', icon: 'Brain' },
    { key: 'SpecialCare', label: '特别关注', color: 'bg-rose-50 text-rose-700 border-rose-250 hover:bg-rose-100', icon: 'AlertCircle' },
  ],
  en: [
    { key: 'General', label: 'General', color: 'bg-emerald-50 text-emerald-700 border-emerald-250 hover:bg-emerald-100', icon: 'Bookmark' },
    { key: 'Academic', label: 'Academic', color: 'bg-blue-50 text-blue-700 border-blue-250 hover:bg-blue-100', icon: 'GraduationCap' },
    { key: 'Behavioral', label: 'Behavioral', color: 'bg-purple-50 text-purple-700 border-purple-250 hover:bg-purple-100', icon: 'Brain' },
    { key: 'SpecialCare', label: 'Special Care', color: 'bg-rose-50 text-rose-700 border-rose-250 hover:bg-rose-100', icon: 'AlertCircle' },
  ]
};

const getCategoryIcon = (iconName: string, size = 12) => {
  switch (iconName) {
    case 'GraduationCap': return <GraduationCap size={size} />;
    case 'Brain': return <Brain size={size} />;
    case 'AlertCircle': return <AlertCircle size={size} />;
    default: return <Bookmark size={size} />;
  }
};

const TEMPLATES = {
  zh: [
    {
      title: '📋 学术表现观察',
      content: `<div><strong>【学术表现观察 (Academic Observation)】</strong></div>
<div>• <strong>课堂参与:</strong> 在讨论中表现活跃，能够主动提出有深度的问题。</div>
<div>• <strong>理解与熟练度:</strong> 对于今天教授的核心概念理解迅速，但在算法步骤上仍有一些小失误。</div>
<div>• <strong>随堂练习完成度:</strong> 练习题完成度 100%，正确率约 90%。</div>`
    },
    {
      title: '🧠 心理/行为表现',
      content: `<div><strong>【学生行为与专注力评估 (Behavioral Assessment)】</strong></div>
<div>• <strong>专注状态:</strong> 课堂前20分钟非常专注，但在后半段自由练习时容易分心说话。</div>
<div>• <strong>合作与沟通:</strong> 小组协作中展现了良好的领导力，积极帮助同伴。</div>
<div>• <strong>特别关注事项:</strong> 需要在未来课堂中通过设立子任务来帮助他们保持全流程专注。</div>`
    },
    {
      title: '🎯 改进促进行动方案',
      content: `<div><strong>【个性化促进行动方案 (Action Plan)】</strong></div>
<div>1. 在随堂环节分配进阶难度（分层教学）。</div>
<div>2. 将大任务拆解为 5 分钟周期的微任务，并予以高频反馈。</div>
<div>3. 在下次评估前进行 1 对 1 简短辅导，强化薄弱知识点。</div>`
    }
  ],
  en: [
    {
      title: '📋 Academic Milestone',
      content: `<div><strong>[Academic Observation]</strong></div>
<div>• <strong>Class Engagement:</strong> Heavily engaged during interactive quizzes. Quick to formulate answers.</div>
<div>• <strong>Concept Mastery:</strong> Grasped the core framework immediately, but struggled with syntax detail.</div>
<div>• <strong>Practice Performance:</strong> Handled 100% of standard questions, needs challenge tasks.</div>`
    },
    {
      title: '🧠 Behavior & Focus',
      content: `<div><strong>[Behavioral & Focus Assessment]</strong></div>
<div>• <strong>Focus Span:</strong> Exceptionally focused first 15m. Slightly distracted during independent lab.</div>
<div>• <strong>Collaboration:</strong> Helpful peer-mentoring. Communicates thoughts with clarity.</div>
<div>• <strong>Intervention Needed:</strong> Guide them back and reward milestones to increase sustained focus.</div>`
    },
    {
      title: '🎯 Individual Action Plan',
      content: `<div><strong>[Customized Action Plan]</strong></div>
<div>1. Assign intermediate/advanced problem sheets to foster interest.</div>
<div>2. Set a visual 10-minute target schedule on their student desk module.</div>
<div>3. Follow up with private chat/review session on unresolved concepts.</div>`
    }
  ]
};

export function StudentPrivateNotesEditor({ 
  studentId, 
  studentName, 
  initialValue, 
  onSave, 
  lang = 'zh' 
}: StudentPrivateNotesEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  
  const [loadedCategory, setLoadedCategory] = useState<string>('General');
  const [selectedCategory, setSelectedCategory] = useState<string>('General');
  const [lastSavedContent, setLastSavedContent] = useState('');

  // Reset editor content and state when active student shifts or initialValue updates
  useEffect(() => {
    const val = initialValue || '';
    let parsedCategory = 'General';
    let htmlContent = val;

    if (val.trim().startsWith('{') && val.trim().endsWith('}')) {
      try {
        const parsed = JSON.parse(val);
        parsedCategory = parsed.category || 'General';
        htmlContent = parsed.html || '';
      } catch (e) {
        htmlContent = val;
      }
    }

    if (editorRef.current) {
      editorRef.current.innerHTML = htmlContent;
    }
    
    setLoadedCategory(parsedCategory);
    setSelectedCategory(parsedCategory);
    setLastSavedContent(htmlContent);
    setHasUnsavedChanges(false);
    setSaveSuccess(false);
  }, [studentId, initialValue]);

  // Check if content or category differs from saved state
  const checkChanges = (currentHtml: string, currentCategory: string) => {
    const normalizedHtml = currentHtml === '<br>' ? '' : currentHtml;
    const isHtmlChanged = normalizedHtml !== lastSavedContent;
    const isCategoryChanged = currentCategory !== loadedCategory;
    setHasUnsavedChanges(isHtmlChanged || isCategoryChanged);
  };

  // Execute formatting actions via document.execCommand
  const format = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      checkChanges(editorRef.current.innerHTML, selectedCategory);
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      checkChanges(editorRef.current.innerHTML, selectedCategory);
    }
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    if (editorRef.current) {
      checkChanges(editorRef.current.innerHTML, cat);
    } else {
      setHasUnsavedChanges(cat !== loadedCategory);
    }
  };

  const saveNotes = async () => {
    if (editorRef.current) {
      const notesHTML = editorRef.current.innerHTML;
      const normalizedHTML = notesHTML === '<br>' ? '' : notesHTML;
      const serialized = JSON.stringify({ category: selectedCategory, html: normalizedHTML });
      
      setIsSaving(true);
      setSaveSuccess(false);
      try {
        const success = await onSave(serialized);
        if (success) {
          setLastSavedContent(normalizedHTML);
          setLoadedCategory(selectedCategory);
          setHasUnsavedChanges(false);
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 2500);
        }
      } catch (e) {
        console.error('Failed to save private student notes:', e);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const insertTemplate = (templateContent: string) => {
    if (editorRef.current) {
      const editor = editorRef.current;
      editor.focus();
      
      // Inject at current selection cursor or append if none
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
        // Append to the end
        editor.innerHTML += (editor.innerHTML === '' || editor.innerHTML === '<br>' ? '' : '<br><br>') + templateContent;
      } else {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const el = document.createElement('div');
        el.innerHTML = templateContent;
        const frag = document.createDocumentFragment();
        let node;
        while ((node = el.firstChild)) {
          frag.appendChild(node);
        }
        range.insertNode(frag);
      }
      
      handleInput();
    }
  };

  const clearEditor = () => {
    const confirmClear = window.confirm(
      lang === 'zh' 
        ? '您确定要清空编辑器中的内容吗？' 
        : 'Are you sure you want to clear the editor contents?'
    );
    if (confirmClear && editorRef.current) {
      editorRef.current.innerHTML = '';
      handleInput();
    }
  };

  return (
    <div className="flex flex-col bg-slate-50 rounded-xl border border-slate-200/60 overflow-hidden shadow-xs h-full text-gray-800">
      {/* Informational Warning Alert */}
      <div className="bg-amber-50/70 border-b border-amber-100 px-3 py-2 text-[10px] md:text-xs text-amber-800 flex items-center justify-between shrink-0 select-none">
        <span className="flex items-center gap-1.5 font-medium">
          <EyeOff size={13} className="text-amber-600 animate-pulse" />
          <span className="font-semibold text-amber-900">
            {lang === 'zh' ? '私密教师备忘档案' : 'Confidential Teacher Dossier'}
          </span>
          • {lang === 'zh' ? '此内容仅对教师端可见，学生端完全屏蔽/不呈现' : 'Notes are secure, strictly hidden from the student portal.'}
        </span>
        <span className="flex items-center gap-1 text-[10px] bg-amber-100/65 text-amber-905 px-1.5 py-0.5 rounded-md border border-amber-200">
          <Lock size={10} /> 
          {lang === 'zh' ? '已加密' : 'Confidential'}
        </span>
      </div>

      {/* Tag Category Selection Bar */}
      <div className="bg-slate-55 border-b border-gray-150 p-2 px-3 flex flex-col md:flex-row md:items-center justify-between gap-1.5 shrink-0 select-none">
        <div className="flex items-center gap-1.5">
          <Tag size={12} className="text-slate-400" />
          <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-slate-500">
            {lang === 'zh' ? '选择备忘分类' : 'Observation Category'}:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(lang === 'zh' ? CATEGORIES.zh : CATEGORIES.en).map(cat => {
            const isSelected = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => handleCategoryChange(cat.key)}
                className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-full border flex items-center gap-1 cursor-pointer transition-all duration-200 ${
                  isSelected 
                    ? `${cat.color.split(' ')[0]} ${cat.color.split(' ')[1]} border-indigo-400 ring-2 ring-indigo-50 font-bold scale-[1.03]`
                    : 'bg-white text-gray-500 border-gray-200/80 hover:bg-gray-50 hover:text-gray-700'
                }`}
              >
                {getCategoryIcon(cat.icon, 10)}
                <span>{cat.label}</span>
                {isSelected && <span className="w-1 h-1 rounded-full bg-current"></span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Modern Formatting Actions Toolbar */}
      <div className="bg-white border-b border-gray-150 p-2 flex flex-wrap items-center justify-between gap-2 shrink-0 select-none">
        <div className="flex flex-wrap items-center gap-1">
          {/* Text decoration styles */}
          <button
            onClick={() => format('bold')}
            className="p-1 px-1.5 text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors font-semibold"
            title={lang === 'zh' ? '加粗' : 'Bold'}
          >
            <Bold size={13} />
          </button>
          <button
            onClick={() => format('italic')}
            className="p-1 px-1.5 text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
            title={lang === 'zh' ? '斜体' : 'Italic'}
          >
            <Italic size={13} />
          </button>
          <button
            onClick={() => format('underline')}
            className="p-1 px-1.5 text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
            title={lang === 'zh' ? '下划线' : 'Underline'}
          >
            <Underline size={13} />
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-1" />

          {/* Heading structures */}
          <button
            onClick={() => format('formatBlock', '<h2>')}
            className="p-1 px-1.5 text-[10px] font-bold text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors flex items-center"
            title={lang === 'zh' ? '大标题 H2' : 'Heading 2'}
          >
            <Heading1 size={13} />
          </button>
          <button
            onClick={() => format('formatBlock', '<h3>')}
            className="p-1 px-1.5 text-[10px] font-bold text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors flex items-center"
            title={lang === 'zh' ? '中标题 H3' : 'Heading 3'}
          >
            <Heading2 size={13} />
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-1" />

          {/* Bullets & Numbers */}
          <button
            onClick={() => format('insertUnorderedList')}
            className="p-1 px-1.5 text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
            title={lang === 'zh' ? '无序列表' : 'Bullet List'}
          >
            <List size={13} />
          </button>
          <button
            onClick={() => format('insertOrderedList')}
            className="p-1 px-1.5 text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
            title={lang === 'zh' ? '有序列表' : 'Numbered List'}
          >
            <ListOrdered size={13} />
          </button>
          <button
            onClick={() => format('formatBlock', '<blockquote>')}
            className="p-1 px-1.5 text-gray-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
            title={lang === 'zh' ? '块引用' : 'Blockquote'}
          >
            <Quote size={13} />
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-1" />

          {/* Background Highlight block */}
          <button
            onClick={() => format('hiliteColor', '#fef08a')}
            className="p-1 px-1.5 text-yellow-600 hover:bg-yellow-50 rounded transition-colors flex items-center gap-0.5"
            title={lang === 'zh' ? '高亮黄色' : 'Highlight Yellow'}
          >
            <Highlighter size={13} />
          </button>
          <button
            onClick={() => format('foreColor', '#dc2626')}
            className="p-1 px-1.5 text-red-650 hover:bg-red-50 rounded text-xs font-semibold font-sans transition-colors"
            title={lang === 'zh' ? '红色字体' : 'Red Text'}
          >
            <span className="text-red-600 font-bold">A</span>
          </button>
          <button
            onClick={() => format('removeFormat')}
            className="p-1 px-1.5 text-[9px] font-bold text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all"
            title={lang === 'zh' ? '清除格式' : 'Clear Formatting'}
          >
            Txt
          </button>
        </div>

        {/* Clear block */}
        <button
          onClick={clearEditor}
          className="text-[10px] text-gray-400 hover:text-red-600 p-1 hover:bg-red-50 rounded transition-colors font-medium flex items-center gap-1 cursor-pointer"
          title={lang === 'zh' ? '清空所有文档' : 'Clear Dossier'}
        >
          <Trash2 size={12} />
          <span>{lang === 'zh' ? '清空' : 'Clear'}</span>
        </button>
      </div>

      {/* Editor Main Content & Preset Templates Side Pane */}
      <div className="flex-1 flex min-h-0 divide-x divide-gray-150">
        
        {/* WYSIWYG Editable Sheet */}
        <div className="flex-1 flex flex-col p-3 bg-white overflow-hidden relative">
          <div className="text-[10px] font-bold text-gray-450 tracking-wider flex items-center gap-1.5 mb-2 select-none border-b border-gray-50 pb-1">
            <FileText size={11} className="text-indigo-400" />
            <span>{studentName} — {lang === 'zh' ? '专属备忘档案' : 'Confidential Profile Notes'}</span>
          </div>
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            className="flex-1 overflow-y-auto outline-none focus:outline-none text-xs leading-relaxed text-gray-800 bg-white min-h-[140px] prose prose-xs max-w-none pr-1 select-text"
            style={{
              backgroundImage: 'radial-gradient(#e5e7eb 1.1px, transparent 1.1px)',
              backgroundSize: '16px 16px',
              minHeight: '100px'
            }}
          />
          {(!initialValue && (!editorRef.current || editorRef.current.innerHTML === '')) && (
            <div className="absolute pointer-events-none top-[44px] left-3.5 pr-8 text-xs text-slate-400 italic font-sans max-w-[85%] leading-relaxed select-none">
              {lang === 'zh' 
                ? '输入私有备忘档案，或选用右侧课堂观察模板...' 
                : 'Enter details... Click templates on the right for swift assessment log structures.'}
            </div>
          )}
        </div>

        {/* Quick Insert Templates Panel */}
        <div className="w-48 bg-slate-50 flex flex-col p-2.5 overflow-y-auto shrink-0 select-none">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1 mb-2.5 border-b border-slate-200 pb-1.5">
            <Sparkles size={11} className="text-amber-500 animate-pulse" />
            <span>{lang === 'zh' ? '课堂评估模板' : 'Observation Templates'}</span>
          </div>

          <div className="space-y-2">
            {(lang === 'zh' ? TEMPLATES.zh : TEMPLATES.en).map((tpl, i) => (
              <button
                key={i}
                onClick={() => insertTemplate(tpl.content)}
                className="w-full text-left bg-white hover:bg-indigo-50/70 border border-slate-200 hover:border-indigo-200 rounded-lg p-2 transition-all duration-200 shadow-3xs cursor-pointer flex flex-col gap-1 hover:shadow-xs hover:translate-x-0.5"
              >
                <span className="text-[11px] font-semibold text-slate-700 truncate w-full">{tpl.title}</span>
                <span className="text-[9px] text-slate-400 line-clamp-2 leading-tight">
                  {lang === 'zh' ? '一键置入预设段落结构' : 'Insert observation scaffolding.'}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-auto pt-3 border-t border-slate-200 text-[9px] text-slate-400 leading-tight">
            <Clock size={10} className="inline mr-1" />
            {lang === 'zh' ? '备注采用实时保存' : 'Save draft manually or auto.'}
          </div>
        </div>
      </div>

      {/* Editor Status bar / Save Buttons footer */}
      <div className="bg-slate-100 border-t border-slate-200 p-2 px-3 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-1.5">
          {hasUnsavedChanges ? (
            <div className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              <SquareDot size={10} className="animate-ping" />
              <span>{lang === 'zh' ? '未保存的编辑' : 'Unsaved Changes'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-150 px-1.5 py-0.5 rounded-full">
              <Check size={11} />
              <span>{lang === 'zh' ? '所有更改已同步' : 'Changes Synchronized'}</span>
            </div>
          )}

          {saveSuccess && (
            <span className="text-[10px] text-green-600 font-bold animate-pulse">
              ✓ {lang === 'zh' ? '保存成功!' : 'Saved successfully!'}
            </span>
          )}
        </div>

        <button
          onClick={saveNotes}
          disabled={isSaving}
          className={`px-3 py-1 text-xs font-semibold rounded-lg shadow-sm border transition-all flex items-center gap-1.5 cursor-pointer ${
            hasUnsavedChanges 
              ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700 hover:shadow-md' 
              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-55 hover:text-gray-700'
          }`}
        >
          {isSaving ? (
            <span className="w-3 h-3 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin"></span>
          ) : (
            <Save size={12} />
          )}
          <span>{lang === 'zh' ? '保存备忘档案' : 'Save Dossier'}</span>
        </button>
      </div>
    </div>
  );
}
