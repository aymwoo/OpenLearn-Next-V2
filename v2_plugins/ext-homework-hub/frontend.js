// ============================================================
// ext-homework-hub 前端脚本
// 在 OpenLearn 微前端沙箱中运行，负责教师端和学生端的 UI 渲染
// ============================================================

// 样式常量 —— 统一维护，方便后续调整
const STYLE = {
  primaryColor: '#2563eb',
  successColor: '#16a34a',
  warningColor: '#ea580c',
  dangerColor: '#dc2626',
  bgGray: '#f9fafb',
  borderColor: '#e5e7eb',
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  radius: '8px',
};

// 工具函数：创建带样式的 DOM 元素
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(e.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      e.setAttribute(k, v);
    }
  });
  children.forEach((c) => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c instanceof Node) e.appendChild(c);
  });
  return e;
}

// ============================================================
// 教师面板
// ============================================================
async function renderTeacherPanel(domNode, frontendCtx) {
  domNode.innerHTML = '';
  domNode.style.padding = '16px';
  domNode.style.fontFamily = 'system-ui, sans-serif';

  // ---------- 头部 ----------
  const header = el('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }
  },
    el('h2', { style: { margin: '0', fontSize: '20px', color: STYLE.textPrimary } }, '📋 作业中心'),
    el('button', {
      id: 'btn-new-assignment',
      style: {
        padding: '8px 16px', backgroundColor: STYLE.primaryColor, color: '#fff',
        border: 'none', borderRadius: STYLE.radius, cursor: 'pointer', fontSize: '14px'
      }
    }, '＋ 创建新作业')
  );
  domNode.appendChild(header);

  // ---------- 创建作业表单（默认隐藏） ----------
  const formContainer = el('div', {
    id: 'form-create-assignment',
    style: { display: 'none', marginBottom: '20px', padding: '16px', backgroundColor: STYLE.bgGray, borderRadius: STYLE.radius, border: `1px solid ${STYLE.borderColor}` }
  },
    el('h3', { style: { margin: '0 0 12px 0', fontSize: '16px' } }, '📝 创建新作业'),
    el('div', { style: { marginBottom: '10px' } },
      el('label', { style: { display: 'block', marginBottom: '4px', fontSize: '13px', color: STYLE.textSecondary } }, '作业标题'),
      el('input', { id: 'input-title', type: 'text', placeholder: '请输入作业标题', style: { width: '100%', padding: '8px', border: `1px solid ${STYLE.borderColor}`, borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' } })
    ),
    el('div', { style: { marginBottom: '10px' } },
      el('label', { style: { display: 'block', marginBottom: '4px', fontSize: '13px', color: STYLE.textSecondary } }, '作业描述'),
      el('textarea', { id: 'input-desc', placeholder: '请输入作业描述或要求', rows: '3', style: { width: '100%', padding: '8px', border: `1px solid ${STYLE.borderColor}`, borderRadius: '4px', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box' } })
    ),
    el('div', { style: { marginBottom: '12px' } },
      el('label', { style: { display: 'block', marginBottom: '4px', fontSize: '13px', color: STYLE.textSecondary } }, '截止时间（可选）'),
      el('input', { id: 'input-deadline', type: 'datetime-local', style: { padding: '8px', border: `1px solid ${STYLE.borderColor}`, borderRadius: '4px', fontSize: '14px' } })
    ),
    el('div', { style: { display: 'flex', gap: '8px' } },
      el('button', {
        id: 'btn-submit-create',
        style: { padding: '8px 20px', backgroundColor: STYLE.successColor, color: '#fff', border: 'none', borderRadius: STYLE.radius, cursor: 'pointer', fontSize: '14px' }
      }, '✅ 发布作业'),
      el('button', {
        id: 'btn-cancel-create',
        style: { padding: '8px 20px', backgroundColor: '#fff', color: STYLE.textSecondary, border: `1px solid ${STYLE.borderColor}`, borderRadius: STYLE.radius, cursor: 'pointer', fontSize: '14px' }
      }, '取消')
    )
  );
  domNode.appendChild(formContainer);

  // ---------- 作业列表容器 ----------
  const listContainer = el('div', { id: 'assignment-list' });
  domNode.appendChild(listContainer);

  // ---------- 消息提示区 ----------
  const msgBox = el('div', { id: 'msg-box', style: { marginTop: '12px' } });
  domNode.appendChild(msgBox);

  // ---------- 事件绑定 ----------
  // 显示/隐藏创建表单
  domNode.querySelector('#btn-new-assignment').addEventListener('click', () => {
    formContainer.style.display = 'block';
  });
  domNode.querySelector('#btn-cancel-create').addEventListener('click', () => {
    formContainer.style.display = 'none';
    formContainer.querySelector('#input-title').value = '';
    formContainer.querySelector('#input-desc').value = '';
    formContainer.querySelector('#input-deadline').value = '';
  });

  // 创建作业
  const submitBtn = domNode.querySelector('#btn-submit-create');
  submitBtn.addEventListener('click', async () => {
    if (submitBtn.disabled) return;
    const title = domNode.querySelector('#input-title').value.trim();
    const description = domNode.querySelector('#input-desc').value.trim();
    const deadline = domNode.querySelector('#input-deadline').value;

    if (!title) {
      showMessage(msgBox, '请输入作业标题', 'warn');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ 发布中...';
    try {
      await frontendCtx.invokeCommand('create_assignment', { title, description, deadline });
      showMessage(msgBox, `作业「${title}」发布成功！`, 'success');
      formContainer.style.display = 'none';
      domNode.querySelector('#input-title').value = '';
      domNode.querySelector('#input-desc').value = '';
      domNode.querySelector('#input-deadline').value = '';
      await loadAssignmentList(listContainer, frontendCtx, msgBox, 'teacher');
    } catch (err) {
      showMessage(msgBox, `创建失败: ${err.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '✅ 发布作业';
    }
  });

  // 初始加载
  await loadAssignmentList(listContainer, frontendCtx, msgBox, 'teacher');
}

// ============================================================
// 学生面板
// ============================================================
async function renderStudentPanel(domNode, frontendCtx) {
  domNode.innerHTML = '';
  domNode.style.padding = '16px';
  domNode.style.fontFamily = 'system-ui, sans-serif';

  const header = el('h2', { style: { margin: '0 0 16px 0', fontSize: '20px', color: STYLE.textPrimary } }, '📖 我的作业');
  domNode.appendChild(header);

  const listContainer = el('div', { id: 'student-assignment-list' });
  domNode.appendChild(listContainer);

  const msgBox = el('div', { id: 'student-msg-box', style: { marginTop: '12px' } });
  domNode.appendChild(msgBox);

  await loadAssignmentList(listContainer, frontendCtx, msgBox, 'student');
}

// ============================================================
// 共用：加载作业列表
// ============================================================
async function loadAssignmentList(container, frontendCtx, msgBox, role) {
  container.innerHTML = '<p style="color:#9ca3af; text-align:center; padding:24px;">⏳ 加载中...</p>';

  try {
    const data = await frontendCtx.invokeCommand('list_assignments', { role });
    const assignments = data.assignments || [];

    if (assignments.length === 0) {
      container.innerHTML = '<p style="color:#9ca3af; text-align:center; padding:32px;">📭 暂无作业</p>';
      return;
    }

    container.innerHTML = '';
    assignments.forEach((asgn) => {
      const card = buildAssignmentCard(asgn, frontendCtx, msgBox, role, container);
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<p style="color:${STYLE.dangerColor}; text-align:center; padding:24px;">加载失败: ${err.message}</p>`;
  }
}

// ============================================================
// 构建单条作业卡片
// ============================================================
function buildAssignmentCard(asgn, frontendCtx, msgBox, role, listContainer) {
  const submitted = asgn.submission !== null;
  const graded = submitted && asgn.submission && asgn.submission.score >= 0;

  let statusBadge = '';
  if (role === 'student') {
    if (graded) {
      statusBadge = `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;font-size:12px;">已批改 ${asgn.submission.score}分</span>`;
    } else if (submitted) {
      statusBadge = `<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px;font-size:12px;">已提交</span>`;
    } else {
      statusBadge = `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-size:12px;">待提交</span>`;
    }
  }

  const card = el('div', {
    style: {
      border: `1px solid ${STYLE.borderColor}`,
      borderRadius: STYLE.radius,
      padding: '14px',
      marginBottom: '12px',
      backgroundColor: '#fff',
    }
  });

  // 作业基本信息
  const infoHtml = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <strong style="font-size:15px;color:${STYLE.textPrimary};">${escapeHtml(asgn.title)}</strong>
          ${statusBadge}
        </div>
        ${asgn.description ? `<p style="margin:0 0 6px 0;font-size:13px;color:${STYLE.textSecondary};">${escapeHtml(asgn.description)}</p>` : ''}
        <div style="font-size:12px;color:${STYLE.textSecondary};">
          📅 发布时间: ${formatDate(asgn.createdAt)}
          ${asgn.deadline ? `&nbsp;&nbsp;⏰ 截止: ${formatDate(asgn.deadline)}` : ''}
          ${asgn.teacherId ? `&nbsp;&nbsp;👤 教师: ${escapeHtml(asgn.teacherId)}` : ''}
        </div>
      </div>
    </div>
  `;
  card.innerHTML = infoHtml;

  // ---------- 操作区 ----------
  const actions = el('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } });

  if (role === 'teacher') {
    // 教师操作按钮
    actions.appendChild(el('button', {
      style: btnStyle(STYLE.primaryColor),
      onClick: async () => {
        await toggleSubmissionList(card, asgn.id, frontendCtx, msgBox);
      }
    }, '📋 查看提交'));

    actions.appendChild(el('button', {
      style: btnStyle('#fff', STYLE.borderColor, STYLE.textPrimary),
      onClick: async () => {
        try {
          const r = await frontendCtx.invokeCommand('batch_download_urls', { assignmentId: asgn.id });
          if (!r.files || r.files.length === 0) {
            showMessage(msgBox, '暂无提交文件可下载', 'warn');
            return;
          }
          // 逐个触发下载
          r.files.forEach((f, i) => {
            setTimeout(() => window.open(f.downloadUrl, '_blank'), i * 300);
          });
          showMessage(msgBox, `开始下载 ${r.files.length} 个文件...`, 'success');
        } catch (err) {
          showMessage(msgBox, `下载失败: ${err.message}`, 'error');
        }
      }
    }, '📥 批量下载'));

    actions.appendChild(el('button', {
      style: btnStyle(STYLE.successColor),
      onClick: async () => {
        try {
          const r = await frontendCtx.invokeCommand('export_scores', { assignmentId: asgn.id });
          window.open(r.downloadUrl, '_blank');
          showMessage(msgBox, `成绩单已导出: ${r.fileName}`, 'success');
        } catch (err) {
          showMessage(msgBox, `导出失败: ${err.message}`, 'error');
        }
      }
    }, '📊 导出成绩'));

    // 统计信息
    actions.appendChild(el('span', {
      id: `stats-${asgn.id}`,
      style: { fontSize: '12px', color: STYLE.textSecondary, alignSelf: 'center', marginLeft: 'auto' }
    }, ''));
    // 异步加载统计
    frontendCtx.invokeCommand('get_stats', { assignmentId: asgn.id }).then((stats) => {
      const elm = card.querySelector(`#stats-${asgn.id}`);
      if (elm && stats) {
        elm.textContent = `已交 ${stats.totalSubmissions} | 已批 ${stats.gradedCount} | 均分 ${stats.averageScore ?? '-'}`;
      }
    }).catch(() => {});

  } else {
    // ---------- 学生操作区 ----------
    if (graded) {
      // 显示评分反馈
      const fb = el('div', {
        style: {
          marginTop: '8px', padding: '10px', backgroundColor: '#f0fdf4',
          borderRadius: '6px', border: '1px solid #bbf7d0'
        }
      });
      fb.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;color:${STYLE.successColor};">✅ 得分: ${asgn.submission.score} 分</span>
          <span style="font-size:12px;color:${STYLE.textSecondary};">${formatDate(asgn.submission.submittedAt)}</span>
        </div>
        ${asgn.submission.feedback ? `<p style="margin:6px 0 0 0;font-size:13px;color:#374151;">💬 教师反馈: ${escapeHtml(asgn.submission.feedback)}</p>` : ''}
      `;
      card.appendChild(fb);
    }

    // 构造通用的文件上传 UI 区域
    const createUploadArea = (isReSubmit = false, onCancel = null) => {
      const uploadArea = el('div', {
        style: {
          marginTop: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }
      });

      const fileInput = el('input', {
        type: 'file',
        id: `file-${asgn.id}-${isReSubmit ? 're' : 'init'}`,
        style: { display: 'none' }
      });

      const dropZone = el('div', {
        style: {
          border: `2px dashed ${STYLE.borderColor}`,
          borderRadius: '8px',
          padding: '20px 24px',
          textAlign: 'center',
          backgroundColor: '#fafafa',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        },
        onDragOver: (e) => {
          e.preventDefault();
          dropZone.style.borderColor = STYLE.primaryColor;
          dropZone.style.backgroundColor = '#eff6ff';
        },
        onDragLeave: () => {
          dropZone.style.borderColor = STYLE.borderColor;
          dropZone.style.backgroundColor = '#fafafa';
        },
        onDrop: (e) => {
          e.preventDefault();
          dropZone.style.borderColor = STYLE.borderColor;
          dropZone.style.backgroundColor = '#fafafa';
          const files = e.dataTransfer?.files;
          if (files && files.length > 0) {
            fileInput.files = files;
            fileInput.dispatchEvent(new Event('change'));
          }
        },
        onClick: () => {
          fileInput.click();
        }
      });

      dropZone.addEventListener('mouseenter', () => {
        if (!fileInput.files?.length) {
          dropZone.style.borderColor = STYLE.primaryColor;
          dropZone.style.backgroundColor = '#f3f4f6';
        }
      });
      dropZone.addEventListener('mouseleave', () => {
        if (!fileInput.files?.length) {
          dropZone.style.borderColor = STYLE.borderColor;
          dropZone.style.backgroundColor = '#fafafa';
        }
      });

      const icon = el('span', { style: { fontSize: '28px' } }, '📁');
      const text = el('div', { style: { fontSize: '13px', color: STYLE.textSecondary, fontWeight: '500' } }, '点击或将作业文件拖拽到此处选择');
      const subText = el('div', { style: { fontSize: '11px', color: '#9ca3af' } }, '支持任意文件格式');

      dropZone.appendChild(icon);
      dropZone.appendChild(text);
      dropZone.appendChild(subText);

      const fileInfoRow = el('div', {
        style: {
          display: 'none',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          backgroundColor: '#f3f4f6',
          borderRadius: '6px',
          border: `1px solid ${STYLE.borderColor}`,
          fontSize: '13px'
        }
      });

      const fileNameSpan = el('span', { style: { fontWeight: '500', color: STYLE.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' } });
      const clearBtn = el('button', {
        style: {
          background: 'none',
          border: 'none',
          color: STYLE.dangerColor,
          cursor: 'pointer',
          fontSize: '14px',
          padding: '2px 6px'
        },
        onClick: (e) => {
          e.stopPropagation();
          fileInput.value = '';
          fileInput.dispatchEvent(new Event('change'));
        }
      }, '❌');

      fileInfoRow.appendChild(fileNameSpan);
      fileInfoRow.appendChild(clearBtn);

      const actionRow = el('div', {
        style: {
          display: 'none',
          gap: '8px',
          alignItems: 'center',
          marginTop: '4px'
        }
      });

      const uploadBtn = el('button', {
        style: btnStyle(STYLE.primaryColor),
        onClick: async () => {
          if (uploadBtn.disabled) return;
          const file = fileInput.files?.[0];
          if (!file) {
            showMessage(msgBox, '请先选择文件', 'warn');
            return;
          }

          uploadBtn.disabled = true;
          uploadBtn.textContent = '⏳ 提交中...';
          try {
            const base64 = await readFileAsBase64(file);
            const base64Content = base64.split(',')[1];

            showMessage(msgBox, '正在提交...', 'info');
            await frontendCtx.invokeCommand('submit', {
              assignmentId: asgn.id,
              filename: file.name,
              fileContentBase64: base64Content
            });
            showMessage(msgBox, '✅ 提交成功！', 'success');
            setTimeout(() => loadAssignmentList(listContainer, frontendCtx, msgBox, 'student'), 800);
          } catch (err) {
            showMessage(msgBox, `提交失败: ${err.message}`, 'error');
          } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = '📤 确认提交作业';
          }
        }
      }, '📤 确认提交作业');

      actionRow.appendChild(uploadBtn);

      if (isReSubmit && onCancel) {
        const cancelBtn = el('button', {
          style: btnStyle('#fff', STYLE.borderColor, STYLE.textSecondary),
          onClick: onCancel
        }, '取消');
        actionRow.appendChild(cancelBtn);
      }

      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
          fileNameSpan.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
          fileInfoRow.style.display = 'flex';
          dropZone.style.display = 'none';
          actionRow.style.display = 'flex';
        } else {
          fileInfoRow.style.display = 'none';
          dropZone.style.display = 'flex';
          actionRow.style.display = 'none';
        }
      });

      uploadArea.appendChild(fileInput);
      uploadArea.appendChild(dropZone);
      uploadArea.appendChild(fileInfoRow);
      uploadArea.appendChild(actionRow);

      return uploadArea;
    };

    if (!submitted) {
      card.appendChild(createUploadArea(false));
    } else if (!graded) {
      const pendingArea = el('div', {
        style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }
      });

      const pendingStatus = el('div', {
        style: { padding: '10px', backgroundColor: '#eff6ff', borderRadius: '6px', fontSize: '13px', color: '#1e40af', border: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
      });
      pendingStatus.innerHTML = `
        <span style="font-weight:500;">📎 已交: ${escapeHtml(asgn.submission.filename || '已提交')}</span>
        <span style="font-size:11px;color:#6b7280;margin-left:auto;margin-right:10px;">🕐 ${formatDate(asgn.submission.submittedAt)}</span>
      `;

      let reUploadArea = null;
      const reSubmitBtn = el('button', {
        style: btnStyle('#fff', STYLE.primaryColor, STYLE.primaryColor),
        onClick: () => {
          pendingStatus.style.display = 'none';
          reSubmitBtn.style.display = 'none';
          
          reUploadArea = createUploadArea(true, () => {
            reUploadArea.remove();
            pendingStatus.style.display = 'flex';
            reSubmitBtn.style.display = 'block';
          });
          pendingArea.appendChild(reUploadArea);
        }
      }, '🔄 重新提交');

      pendingArea.appendChild(pendingStatus);
      pendingArea.appendChild(reSubmitBtn);
      card.appendChild(pendingArea);
    }
  }

  card.appendChild(actions);

  // 提交详情展开区（教师端用）
  const detailArea = el('div', {
    id: `detail-${asgn.id}`,
    style: { display: 'none', marginTop: '10px', borderTop: `1px solid ${STYLE.borderColor}`, paddingTop: '10px' }
  });
  card.appendChild(detailArea);

  return card;
}

// ============================================================
// 展开/收起作业的提交列表（教师端）
// ============================================================
async function toggleSubmissionList(card, assignmentId, frontendCtx, msgBox) {
  const detailArea = card.querySelector(`#detail-${assignmentId}`);
  if (!detailArea) return;

  // 如果已展开，就收起
  if (detailArea.style.display === 'block') {
    detailArea.style.display = 'none';
    detailArea.innerHTML = '';
    return;
  }

  detailArea.style.display = 'block';
  detailArea.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:12px;">⏳ 加载提交记录...</p>';

  try {
    const data = await frontendCtx.invokeCommand('list_submissions', { assignmentId });
    const submissions = data.submissions || [];

    detailArea.innerHTML = '';
    if (submissions.length === 0) {
      detailArea.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px;">暂无提交记录</p>';
      return;
    }

    submissions.forEach((sub) => {
      const isGraded = sub.score >= 0;
      const row = el('div', {
        style: {
          padding: '10px', marginBottom: '8px', backgroundColor: STYLE.bgGray,
          borderRadius: '6px', border: '1px solid ' + STYLE.borderColor, fontSize: '13px'
        }
      });

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <span style="font-weight:600;">👤 ${escapeHtml(sub.studentId)}</span>
            <span style="color:${STYLE.textSecondary};margin-left:8px;">📎 ${escapeHtml(sub.filename)}</span>
            <span style="color:${STYLE.textSecondary};margin-left:8px;">🕐 ${formatDate(sub.submittedAt)}</span>
            ${isGraded ? `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;margin-left:8px;">${sub.score}分</span>` : '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;margin-left:8px;">待批改</span>'}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn-dl" data-url="/files${encodeURIComponent(sub.filePath)}" style="${inlineBtnStyle(STYLE.primaryColor)}">📥 下载</button>
            <button class="btn-grade-toggle" style="${inlineBtnStyle(isGraded ? '#fff' : STYLE.warningColor, isGraded ? STYLE.borderColor : STYLE.warningColor)}">${isGraded ? '✏️ 修改评分' : '📝 评分'}</button>
          </div>
        </div>
      `;

      // 评分表单（默认隐藏）
      const gradeForm = el('div', {
        style: { display: 'none', marginTop: '8px', padding: '10px', backgroundColor: '#fff', borderRadius: '6px', border: `1px dashed ${STYLE.borderColor}` }
      });
      gradeForm.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:13px;">得分:</label>
          <input type="number" class="input-score" min="0" max="100" value="${isGraded ? sub.score : ''}" placeholder="0-100" style="width:70px;padding:4px 8px;border:1px solid ${STYLE.borderColor};border-radius:4px;font-size:13px;">
          <label style="font-size:13px;">反馈:</label>
          <input type="text" class="input-feedback" value="${escapeHtml(sub.feedback || '')}" placeholder="评语..." style="flex:1;min-width:120px;padding:4px 8px;border:1px solid ${STYLE.borderColor};border-radius:4px;font-size:13px;">
          <button class="btn-grade-submit" style="${inlineBtnStyle(STYLE.successColor)}">✅ 提交评分</button>
        </div>
      `;
      row.appendChild(gradeForm);

      // 下载按钮事件
      row.querySelector('.btn-dl').addEventListener('click', () => {
        window.open(`/files${sub.filePath}`, '_blank');
      });

      // 评分切换
      row.querySelector('.btn-grade-toggle').addEventListener('click', () => {
        gradeForm.style.display = gradeForm.style.display === 'none' ? 'block' : 'none';
      });

      // 提交评分
      row.querySelector('.btn-grade-submit').addEventListener('click', async () => {
        const score = parseFloat(row.querySelector('.input-score').value);
        const feedback = row.querySelector('.input-feedback').value;

        if (isNaN(score) || score < 0 || score > 100) {
          showMessage(msgBox, '请输入 0-100 的有效分数', 'warn');
          return;
        }

        try {
          await frontendCtx.invokeCommand('grade', {
            submissionId: sub.id,
            score,
            feedback
          });
          showMessage(msgBox, '评分提交成功！', 'success');
          // 简单刷新显示
          gradeForm.style.display = 'none';
          setTimeout(() => toggleSubmissionList(card, assignmentId, frontendCtx, msgBox), 500);
        } catch (err) {
          showMessage(msgBox, `评分失败: ${err.message}`, 'error');
        }
      });

      detailArea.appendChild(row);
    });

  } catch (err) {
    detailArea.innerHTML = `<p style="color:${STYLE.dangerColor};text-align:center;">加载失败: ${err.message}</p>`;
  }
}

// ============================================================
// 工具函数
// ============================================================
function showMessage(msgBox, text, type) {
  const colors = {
    success: '#16a34a',
    error: '#dc2626',
    warn: '#ea580c',
    info: '#2563eb'
  };
  msgBox.innerHTML = `<div style="padding:8px 12px;border-radius:6px;font-size:13px;color:#fff;background-color:${colors[type] || colors.info};margin-bottom:8px;">${text}</div>`;
  setTimeout(() => { msgBox.innerHTML = ''; }, 4000);
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function btnStyle(bgColor, borderColor, textColor) {
  return {
    padding: '6px 14px',
    backgroundColor: bgColor,
    color: textColor || '#fff',
    border: borderColor ? `1px solid ${borderColor}` : 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    whiteSpace: 'nowrap'
  };
}

function inlineBtnStyle(bgColor, borderColor) {
  return `padding:4px 10px;background-color:${bgColor};color:${borderColor && bgColor === '#fff' ? '#374151' : '#fff'};border:${borderColor ? `1px solid ${borderColor}` : 'none'};border-radius:4px;cursor:pointer;font-size:12px;`;
}

// ============================================================
// 主入口：注册教师面板和学生面板
// ============================================================
export default {
  activate: async (frontendCtx) => {
    // 教师面板
    frontendCtx.registerPanel({
      slot: 'teacher.dashboard.widget',
      id: 'homework-teacher-widget',
      title: '作业中心',
      render: async (domNode) => {
        await renderTeacherPanel(domNode, frontendCtx);
      }
    });

    // 学生面板
    frontendCtx.registerPanel({
      slot: 'student.view',
      id: 'homework-student-view',
      title: '我的作业',
      render: async (domNode) => {
        await renderStudentPanel(domNode, frontendCtx);
      }
    });
  }
};
