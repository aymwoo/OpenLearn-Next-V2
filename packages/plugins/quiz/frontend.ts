// ============================================================
// ext-quiz-generator 前端脚本
// 在 OpenLearn 微前端沙箱中运行，负责白板随堂测验的 UI 渲染
// ============================================================

const STYLE = {
  primaryColor: '#4f46e5', // indigo-600
  successColor: '#10b981', // emerald-500
  dangerColor: '#ef4444',  // red-500
  bgGray: '#f8fafc',
  borderColor: '#e2e8f0',
  textPrimary: '#0f172a',
  textSecondary: '#64748b',
  radius: '8px',
};

function el(tag: string, attrs: any = {}, ...children: any[]) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(e.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      e.addEventListener(k.slice(2).toLowerCase(), v as any);
    } else {
      e.setAttribute(k, v as any);
    }
  });
  children.forEach((c) => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c instanceof Node) e.appendChild(c);
  });
  return e;
}

// 提取干净的单字母标识符 (A, B, C, D)
function getCleanLetter(selectedOption: string, options: string[]): string {
  const optIndex = options.indexOf(selectedOption);
  const matchLetter = selectedOption.match(/^[A-G](?:\.|\s|、|\b)/i);
  if (matchLetter) {
    return matchLetter[0].charAt(0).toUpperCase();
  } else if (optIndex !== -1) {
    return String.fromCharCode(65 + optIndex);
  }
  return selectedOption;
}

// ============================================================
// 教师端：实时提交统计
// ============================================================
async function renderTeacherPanel(domNode: HTMLElement, ctx: any, { elementId, lessonId }: any) {
  domNode.innerHTML = '';
  domNode.style.padding = '12px';
  domNode.style.height = '100%';
  domNode.style.display = 'flex';
  domNode.style.flexDirection = 'column';
  domNode.style.boxSizing = 'border-box';
  domNode.style.fontFamily = 'system-ui, sans-serif';

  const container = el('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: '0' } });
  domNode.appendChild(container);

  // 轮询更新数据，以保实时更新
  const intervalId = setInterval(async () => {
    if (!document.body.contains(domNode)) {
      clearInterval(intervalId);
      return;
    }
    await refreshData();
  }, 2000);

  const refreshData = async () => {
    try {
      const res = await fetch(`/api/lessons/${lessonId}/whiteboard`);
      if (!res.ok) return;
      const elements = await res.json();
      const currentEl = elements.find((e: any) => e.id === elementId);
      if (currentEl) {
        const data = JSON.parse(currentEl.data);
        renderStats(data);
      }
    } catch (e) {
      console.warn('[Quiz Plugin] Error refreshing stats:', e);
    }
  };

  const renderStats = (data: any) => {
    container.innerHTML = '';
    const submissions = data.submissions || {};
    const totalSubmissions = Object.keys(submissions).length;

    // 计算选项统计
    const optionCounts: Record<string, number> = {};
    Object.values(submissions).forEach((sub: any) => {
      const ans = String(sub.answer).toUpperCase();
      optionCounts[ans] = (optionCounts[ans] || 0) + 1;
    });

    const title = el('p', {
      style: { fontSize: '13px', fontWeight: 'bold', color: STYLE.textPrimary, marginBottom: '10px', lineHeight: '1.4' }
    }, data.question || '');
    container.appendChild(title);

    const statsHeader = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: STYLE.textSecondary, fontWeight: '600', marginBottom: '8px' }
    },
      el('span', {}, '实时提交统计:'),
      el('span', { style: { color: STYLE.primaryColor, fontWeight: '700' } }, `${totalSubmissions} 人已提交`)
    );
    container.appendChild(statsHeader);

    const optionsList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: '1' } });
    container.appendChild(optionsList);

    const options = data.options || [];
    options.forEach((opt: string, i: number) => {
      const optClean = opt.trim().toUpperCase();
      const optLetter = opt.charAt(0).toUpperCase();
      const defaultLetter = String.fromCharCode(65 + i);

      let count = 0;
      const hasLetterPrefix = /^[A-G](?:\.|\s|、|\b)/i.test(optClean);
      if (hasLetterPrefix && optionCounts[optLetter] !== undefined) {
        count += optionCounts[optLetter];
      }
      if (!hasLetterPrefix && optionCounts[defaultLetter] !== undefined) {
        count += optionCounts[defaultLetter];
      }
      if (optionCounts[optClean] !== undefined) {
        count += optionCounts[optClean];
      }

      const percent = totalSubmissions > 0 ? Math.round((count / totalSubmissions) * 100) : 0;
      const isCorrect = (hasLetterPrefix && optLetter === String(data.correctAnswer).toUpperCase())
        || (!hasLetterPrefix && defaultLetter === String(data.correctAnswer).toUpperCase())
        || optClean === String(data.correctAnswer).trim().toUpperCase();

      const optionRow = el('div', {
        style: {
          position: 'relative',
          height: '28px',
          backgroundColor: '#f8fafc',
          border: `1px solid ${STYLE.borderColor}`,
          borderRadius: '6px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          justifyContent: 'space-between',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          boxSizing: 'border-box'
        }
      });

      // 占比背景动画条
      const progressBg = el('div', {
        style: {
          position: 'absolute',
          top: '0',
          left: '0',
          height: '100%',
          width: `${percent}%`,
          backgroundColor: isCorrect ? 'rgba(16, 185, 129, 0.1)' : 'rgba(79, 70, 229, 0.1)',
          transition: 'width 0.5s ease'
        }
      });
      optionRow.appendChild(progressBg);

      const labelDiv = el('div', { style: { zIndex: '10', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' } },
        el('span', { style: { fontWeight: isCorrect ? '700' : '500', color: isCorrect ? '#065f46' : STYLE.textPrimary } }, opt)
      );
      if (isCorrect) {
        labelDiv.appendChild(el('span', {
          style: { fontSize: '8px', backgroundColor: '#d1fae5', color: '#065f46', fontWeight: '700', padding: '1px 4px', borderRadius: '3px' }
        }, '正确答案'));
      }
      optionRow.appendChild(labelDiv);

      const valSpan = el('span', {
        style: { zIndex: '10', fontSize: '10px', fontWeight: '700', color: STYLE.textSecondary }
      }, `${count}人 (${percent}%)`);
      optionRow.appendChild(valSpan);

      optionsList.appendChild(optionRow);
    });
  };

  await refreshData();
}

// ============================================================
// 学生端：选项与作答
// ============================================================
async function renderStudentPanel(domNode: HTMLElement, ctx: any, { elementId, lessonId }: any) {
  domNode.innerHTML = '';
  domNode.style.padding = '12px';
  domNode.style.height = '100%';
  domNode.style.display = 'flex';
  domNode.style.flexDirection = 'column';
  domNode.style.boxSizing = 'border-box';
  domNode.style.fontFamily = 'system-ui, sans-serif';

  const container = el('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: '0' } });
  domNode.appendChild(container);

  let selectedOption = '';
  let submitting = false;

  const refreshData = async () => {
    try {
      const res = await fetch(`/api/lessons/${lessonId}/whiteboard`);
      if (!res.ok) return;
      const elements = await res.json();
      const currentEl = elements.find((e: any) => e.id === elementId);
      if (currentEl) {
        const data = JSON.parse(currentEl.data);
        renderView(data);
      }
    } catch (e) {
      console.warn('[Quiz Plugin] Student error refreshing:', e);
    }
  };

  const renderView = (data: any) => {
    container.innerHTML = '';
    
    // 获取当前学生的提交状态
    const activeStudentId = ctx.services.storageService?.get('__student_id__') || 'guest';
    const serverSub = data.submissions?.[activeStudentId];

    const title = el('p', {
      style: { fontSize: '13px', fontWeight: 'bold', color: STYLE.textPrimary, marginBottom: '12px', lineHeight: '1.4' }
    }, data.question || '');
    container.appendChild(title);

    if (serverSub) {
      // 已经提交，展示答题反馈
      const isCorrect = serverSub.score === 100;
      const feedback = el('div', {
        style: {
          backgroundColor: isCorrect ? '#ecfdf5' : '#fef2f2',
          border: `1px solid ${isCorrect ? '#a7f3d0' : '#fecaca'}`,
          borderRadius: STYLE.radius,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '10px'
        }
      },
        el('span', { style: { fontSize: '24px' } }, isCorrect ? '🎉' : '❌'),
        el('p', { style: { fontSize: '13px', fontWeight: 'bold', color: isCorrect ? '#065f46' : '#991b1b', margin: '0' } }, isCorrect ? '回答正确！' : '回答错误'),
        el('p', { style: { fontSize: '10px', color: isCorrect ? '#047857' : '#b91c1c', opacity: '0.8', margin: '0' } }, `您的答案是: ${serverSub.answer} | 正确答案是: ${data.correctAnswer || 'A'}`)
      );
      container.appendChild(feedback);
      return;
    }

    // 选项列表
    const optionsDiv = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', flex: '1', overflowY: 'auto' } });
    container.appendChild(optionsDiv);

    const options = data.options || [];
    options.forEach((opt: string, i: number) => {
      const isPicked = selectedOption === opt;
      const btn = el('button', {
        style: {
          width: '100%',
          textAlign: 'left',
          padding: '8px 12px',
          backgroundColor: isPicked ? '#e0e7ff' : '#f8fafc',
          border: `1px solid ${isPicked ? '#818cf8' : STYLE.borderColor}`,
          borderRadius: STYLE.radius,
          fontSize: '11px',
          fontWeight: '600',
          color: isPicked ? '#3730a3' : STYLE.textSecondary,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          transition: 'all 0.15s ease',
          outline: 'none',
          boxSizing: 'border-box'
        },
        onClick: () => {
          selectedOption = selectedOption === opt ? '' : opt;
          renderView(data);
        }
      });

      const idxCircle = el('div', {
        style: {
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          border: `2px solid ${isPicked ? '#4f46e5' : '#cbd5e1'}`,
          backgroundColor: isPicked ? '#4f46e5' : '#ffffff',
          color: isPicked ? '#ffffff' : '#64748b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '9px',
          fontWeight: '700',
          shrink: '0'
        }
      }, isPicked ? '✓' : opt.charAt(0).toUpperCase());
      btn.appendChild(idxCircle);

      const labelSpan = el('span', {}, opt);
      btn.appendChild(labelSpan);

      optionsDiv.appendChild(btn);
    });

    // 提交按钮
    const canSubmit = !!selectedOption && !submitting;
    const submitBtn = el('button', {
      disabled: !canSubmit,
      style: {
        width: '100%',
        marginTop: '12px',
        padding: '8px 0',
        borderRadius: STYLE.radius,
        fontSize: '12px',
        fontWeight: 'bold',
        color: canSubmit ? '#ffffff' : '#94a3b8',
        backgroundColor: canSubmit ? STYLE.primaryColor : '#cbd5e1',
        border: 'none',
        cursor: canSubmit ? 'pointer' : 'not-allowed',
        transition: 'all 0.2s ease',
        boxSizing: 'border-box'
      },
      onClick: async () => {
        if (!canSubmit) return;
        submitting = true;
        renderView(data);
        
        // 提交单字符答案
        const cleanAns = getCleanLetter(selectedOption, options);
        try {
          const res = await fetch(`/api/lessons/${lessonId}/quiz-submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              elementId,
              answer: cleanAns
            })
          });
          if (res.ok) {
            await refreshData();
          }
        } catch (e) {
          console.error('[Quiz Plugin] submit answer error:', e);
        } finally {
          submitting = false;
        }
      }
    }, submitting ? '提交中...' : '提交答案');
    container.appendChild(submitBtn);
  };

  await refreshData();
}

// ============================================================
// 主入口：注册随堂测验面板
// ============================================================
export default {
  activate: async (frontendCtx: any) => {
    // 教师端统计面板
    frontendCtx.registerPanel({
      slot: 'teacher.dashboard.widget',
      id: 'quiz-teacher-widget',
      title: '随堂测验统计',
      render: async (domNode: HTMLElement, context: any) => {
        // 由于 render 传参为 (domNode, context)，这里的 context = { elementId, lessonId }
        await renderTeacherPanel(domNode, frontendCtx, context);
      }
    });

    // 学生端作答面板
    frontendCtx.registerPanel({
      slot: 'student.view',
      id: 'quiz-student-view',
      title: '随堂测验作答',
      render: async (domNode: HTMLElement, context: any) => {
        await renderStudentPanel(domNode, frontendCtx, context);
      }
    });
  }
};
