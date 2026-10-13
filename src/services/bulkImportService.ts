/** 归一化后的学生导入行（与后端 `RosterImportInput` 字段一一对应） */
export interface ParsedStudent {
  name: string;
  email: string;
  student_number: string;
  password: string;
  private_notes: string;
}

/**
 * 拆分一行 CSV。
 *
 * 原实现用 `line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)`，对**含逗号的引号字段**
 * 会拆错（例如备注里写「数学, 较弱」）。这里改为逐字符状态机，正确处理引号转义。
 */
export function splitCsvLine(line: string, separator = ','): string[] {
  const cells: string[] = [];
  let current = '';
  let insideQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === separator && !insideQuote) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 在已小写化的表头数组里定位列位置。
 *
 * 两级匹配，兼顾「精确」与「容错」：
 *
 * 1. **规范化后精确匹配**（去掉空格/下划线/连字符）—— `Student Number`、
 *    `student_number`、`学生学号` 视为同一列；
 * 2. 精确匹配失败才回退到**包含匹配**，且按候选词长度降序尝试，让
 *    「学生姓名」永远先于「学生」。
 *
 * 为什么不用朴素的 `headers.findIndex(h => h.includes('学生'))`：模板新增
 * 「学生备注」列后，它会先命中备注列，导致姓名/邮箱/学号整体错位。
 * 为什么不只用精确匹配：教师手写表头常有 `学生姓名(必填)` 这类变体。
 */
export function findHeaderIdx(headers: string[], candidates: string[]): number {
  const norm = (s: string) => s.replace(/[\s_\-()（）]/g, '');
  const normHeaders = headers.map(norm);

  for (const candidate of candidates) {
    const idx = normHeaders.indexOf(norm(candidate));
    if (idx !== -1) return idx;
  }

  for (const candidate of [...candidates].sort((a, b) => norm(b).length - norm(a).length)) {
    const nc = norm(candidate);
    const idx = normHeaders.findIndex((h) => h.includes(nc));
    if (idx !== -1) return idx;
  }

  return -1;
}

/** JSON 分支的学生字段归一化（兼容多种历史键名） */
function normalizeStudentRecord(st: any): ParsedStudent {
  return {
    name: st?.name || st?.studentName || st?.student_name || '',
    email: st?.email || st?.studentEmail || st?.student_email || '',
    student_number: st?.student_number || st?.studentNumber || st?.studentNo || '',
    password: st?.password || st?.initialPassword || st?.initial_password || '',
    private_notes: st?.private_notes || st?.privateNotes || st?.notes || st?.note || '',
  };
}

/**
 * 把「系统自动生成的初始密码」拼进导入成功提示。
 *
 * 这些密码只在此刻可见（库里只有 bcrypt 哈希），教师必须分发给学生，
 * 因此不能只报一个数字就完事。密码由 CSV 指定时不回传，这里也就不会有内容。
 */
function formatCredentials(
  credentials: { student_number: string; name: string; initial_password: string }[] | undefined,
  lang: 'zh' | 'en',
): string {
  if (!credentials || credentials.length === 0) return '';
  const lines = credentials.map((c) => `${c.student_number || '-'} / ${c.name} / ${c.initial_password}`).join('\n');
  return lang === 'zh'
    ? `\n\n🔑 以下 ${credentials.length} 名学生使用系统生成的初始密码（仅本次显示，请及时分发）：\n${lines}`
    : `\n\n🔑 Initial passwords for ${credentials.length} student(s) (shown once — distribute them now):\n${lines}`;
}

/**
 * 导入模板列定义。
 *
 * 全部为**可选识别**列：解析侧按表头模糊匹配（中英文均可），多退少补 ——
 * 教师沿用旧模板（只有姓名+邮箱）依然能导入，补上学号/密码列即可获得完整能力。
 *
 * - `学号` 是学生登录账号，强烈建议填写：不填则系统按 `S001` 序列自动生成；
 *   已存在同邮箱或同学号的学生会被识别为同一人，不会重复建档。
 * - `初始密码` 留空时系统自动生成 12 位随机密码，并在导入结果中回传给教师分发；
 *   填写则按填写的值设置，且不回传。
 * - `学生备注` 对应教师私有备注（private_notes），仅本平台教师可见。
 */
const TEMPLATE_COLUMNS = {
  zh: {
    className: '班级名称',
    classDesc: '班级描述',
    studentNumber: '学生学号',
    studentName: '学生姓名',
    studentEmail: '学生邮箱',
    password: '初始密码',
    notes: '学生备注',
  },
  en: {
    className: 'Class Name',
    classDesc: 'Class Desc',
    studentNumber: 'Student Number',
    studentName: 'Student Name',
    studentEmail: 'Student Email',
    password: 'Initial Password',
    notes: 'Student Notes',
  },
} as const;

/** 拼接一行 CSV，自动给含逗号/引号的字段加引号 */
function csvRow(cells: string[]): string {
  return cells
    .map((cell) => {
      const v = cell ?? '';
      return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(',');
}

export function downloadCSVTemplate(type: 'class' | 'student', lang: 'zh' | 'en') {
  const col = TEMPLATE_COLUMNS[lang === 'zh' ? 'zh' : 'en'];

  let filename: string;
  let headers: string;
  let sampleRows: string[];

  if (type === 'class') {
    filename = lang === 'zh' ? '班级及学生批量导入模板.csv' : 'class_import_template.csv';
    headers = csvRow([
      col.className,
      col.classDesc,
      col.studentNumber,
      col.studentName,
      col.studentEmail,
      col.password,
      col.notes,
    ]);
    sampleRows =
      lang === 'zh'
        ? [
            csvRow(['高一A班', '基础英语课程', '20260101', '李明', 'liming@example.com', '', '']),
            csvRow(['高一A班', '基础英语课程', '20260102', '王华', 'wanghua@example.com', '', '数学较弱']),
          ]
        : [
            csvRow(['Class 101', 'Introduction to English', '20260101', 'John Doe', 'john@example.com', '', '']),
            csvRow(['Class 101', 'Introduction to English', '20260102', 'Jane Smith', 'jane@example.com', '', '']),
          ];
  } else {
    filename = lang === 'zh' ? '学生批量导入模板.csv' : 'student_import_template.csv';
    headers = csvRow([col.studentNumber, col.studentName, col.studentEmail, col.password, col.notes]);
    sampleRows =
      lang === 'zh'
        ? [
            csvRow(['20260101', '张三', 'zhangsan@example.com', '', '']),
            csvRow(['20260102', '李四', 'lisi@example.com', '', '']),
          ]
        : [
            csvRow(['20260101', 'Alice Cooper', 'alice@example.com', '', '']),
            csvRow(['20260102', 'Bob Dylan', 'bob@example.com', '', '']),
          ];
  }

  const blob = new Blob(['\uFEFF' + headers + '\n' + sampleRows.join('\n') + '\n'], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function parseAndImportClassesOrStudents(
  file: File,
  options: {
    lang: 'zh' | 'en';
    fetchClasses: () => Promise<void>;
    fetchStudents: () => Promise<void>;
  },
): Promise<{ success: boolean; message: string }> {
  const { lang, fetchClasses, fetchStudents } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) {
          throw new Error('File content is empty');
        }

        let parsedData: any[] = [];
        let parsedStudents: any[] = [];
        let isClassImport = true;

        if (file.name.endsWith('.json')) {
          const data = JSON.parse(text);
          if (!Array.isArray(data)) {
            throw new Error('JSON structure must be an array');
          }
          const hasClassElement = data.some(
            (item: any) => item.className || (item.name && (item.students || item.classDescription)),
          );

          if (hasClassElement) {
            isClassImport = true;
            parsedData = data
              .map((cls) => {
                const name = cls.name || cls.className || cls.class_name;
                const description = cls.description || cls.classDescription || '';
                const rawStudents = cls.students || cls.studentList || [];
                const students = (Array.isArray(rawStudents) ? rawStudents : [])
                  .map(normalizeStudentRecord)
                  .filter((st: any) => st.name);
                return { name, description, students };
              })
              .filter((cls) => cls.name);
          } else {
            isClassImport = false;
            parsedStudents = data.map(normalizeStudentRecord).filter((st: any) => st.name);
          }
        } else {
          const lines = text.split(/\r?\n/);
          if (lines.length < 2) {
            throw new Error('CSV has empty or insufficient data');
          }
          const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

          const classNameIdx = findHeaderIdx(headers, ['班级名称', 'class name', 'classname', 'class_name', '班级']);
          const classDescIdx = findHeaderIdx(headers, ['班级描述', 'class desc', 'classdesc', 'class_desc', '描述']);
          const studentNumberIdx = findHeaderIdx(headers, [
            '学生学号',
            'student number',
            'studentnumber',
            'student_number',
            'student no',
            '学号',
            '编号',
          ]);
          const studentNameIdx = findHeaderIdx(headers, [
            '学生姓名',
            'student name',
            'studentname',
            'student_name',
            '姓名',
            '学生',
          ]);
          const studentEmailIdx = findHeaderIdx(headers, [
            '学生邮箱',
            'student email',
            'studentemail',
            'student_email',
            '邮箱',
            'email',
            'mail',
          ]);
          const passwordIdx = findHeaderIdx(headers, [
            '初始密码',
            'initial password',
            'password',
            'passwd',
            'pwd',
            '密码',
          ]);
          const notesIdx = findHeaderIdx(headers, [
            '学生备注',
            'student notes',
            'private_notes',
            '备注',
            'note',
            'remark',
          ]);

          if (studentNameIdx === -1) {
            throw new Error('CSV is missing column: "Student Name" (学生姓名/姓名/学生)');
          }

          /** 按已识别的列索引抽取一行学生数据 */
          const pickStudent = (cells: string[]) => ({
            name: cells[studentNameIdx] || '',
            email: studentEmailIdx !== -1 ? cells[studentEmailIdx] || '' : '',
            student_number: studentNumberIdx !== -1 ? cells[studentNumberIdx] || '' : '',
            password: passwordIdx !== -1 ? cells[passwordIdx] || '' : '',
            private_notes: notesIdx !== -1 ? cells[notesIdx] || '' : '',
          });

          if (classNameIdx !== -1) {
            isClassImport = true;
            const classesMap: {
              [className: string]: {
                name: string;
                description: string;
                students: ParsedStudent[];
              };
            } = {};

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              const cleanParts = splitCsvLine(line);

              const className = cleanParts[classNameIdx];
              if (!className) continue;

              const classDesc = classDescIdx !== -1 ? cleanParts[classDescIdx] || '' : '';
              const student = pickStudent(cleanParts);

              if (!classesMap[className]) {
                classesMap[className] = {
                  name: className,
                  description: classDesc,
                  students: [],
                };
              }

              if (student.name) {
                classesMap[className].students.push(student);
              }
            }
            parsedData = Object.values(classesMap);
          } else {
            isClassImport = false;
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              const student = pickStudent(splitCsvLine(line));
              if (student.name) {
                parsedStudents.push(student);
              }
            }
          }
        }

        if (isClassImport) {
          if (parsedData.length === 0) {
            throw new Error('No valid class elements found inside file.');
          }

          const response = await fetch('/api/classes/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ classes: parsedData }),
          });

          if (!response.ok) {
            const errBody = await response.json();
            throw new Error(errBody.error || 'Server importation failed');
          }

          const resData = await response.json();
          await fetchClasses();
          await fetchStudents();

          const classCount = resData.imported.length;
          const studentCount = resData.imported.reduce((sum: number, c: any) => sum + (c.studentsCount || 0), 0);
          const credentialLines = formatCredentials(resData.credentials, lang);

          resolve({
            success: true,
            message:
              lang === 'zh'
                ? `成功导入 ${classCount} 个班级、${studentCount} 名学生。${credentialLines}`
                : `Imported ${classCount} class(es) and ${studentCount} student(s).${credentialLines}`,
          });
        } else {
          if (parsedStudents.length === 0) {
            throw new Error('No valid student elements found inside file.');
          }

          const response = await fetch('/api/students/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ students: parsedStudents }),
          });

          if (!response.ok) {
            const errBody = await response.json();
            throw new Error(errBody.error || 'Server student importation failed');
          }

          const resData = await response.json();
          await fetchStudents();

          const createdCount = resData.created ?? resData.imported.filter((s: any) => s.new).length;
          const existingCount = resData.existing ?? resData.imported.filter((s: any) => !s.new).length;
          const credentials = (resData.imported || [])
            .filter((s: any) => s.created && s.initial_password)
            .map((s: any) => ({
              student_number: s.student_number,
              name: s.name,
              initial_password: s.initial_password,
            }));
          const credentialLines = formatCredentials(credentials, lang);

          resolve({
            success: true,
            message:
              lang === 'zh'
                ? `成功导入 ${createdCount} 名新学生${existingCount ? `，${existingCount} 名已存在（按邮箱或学号匹配，已跳过重复创建）` : ''}。${credentialLines}`
                : `Imported ${createdCount} new student(s)${existingCount ? `, skipped ${existingCount} existing one(s) matched by email or student number` : ''}.${credentialLines}`,
          });
        }
      } catch (err: any) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file from disk.'));
    };

    reader.readAsText(file);
  });
}

export function parseLessonCSV(file: File, lang: 'zh' | 'en'): Promise<{ title: string; content: string }[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) {
          throw new Error('Empty CSV file');
        }

        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
          throw new Error(
            lang === 'zh' ? 'CSV 文件行数不足，请包含标题和至少一行数据。' : 'CSV is missing content or headers.',
          );
        }

        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const titleIndex = headers.findIndex((h) => h.includes('title') || h.includes('标题') || h.includes('课程'));
        const contentIndex = headers.findIndex(
          (h) => h.includes('content') || h.includes('内容') || h.includes('正文'),
        );

        if (titleIndex === -1 || contentIndex === -1) {
          throw new Error(
            lang === 'zh'
              ? 'CSV 缺少必要表头列：必须包含 "Title"（课程标题）和 "Content"（课程内容）。'
              : 'CSV must contain "Title" and "Content" headers.',
          );
        }

        const parsedList: { title: string; content: string }[] = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || line.split(',');
          const cleanParts = parts.map((p) => p.replace(/^"|"$/g, '').trim());

          const title = cleanParts[titleIndex];
          const content = cleanParts[contentIndex];

          if (title && content) {
            parsedList.push({ title, content });
          }
        }

        if (parsedList.length === 0) {
          throw new Error(lang === 'zh' ? '未能从 CSV 解析出有效课程数据。' : 'No valid courses found in CSV.');
        }

        resolve(parsedList);
      } catch (err: any) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error(lang === 'zh' ? '无法读取选取的 CSV 文件！' : 'Failure to read the CSV!'));
    };

    reader.readAsText(file);
  });
}

export async function submitCSVLessons(
  previewImportData: { title: string; content: string }[],
  options: {
    lang: 'zh' | 'en';
    setImportProgress: (n: number) => void;
    fetchLessons: () => Promise<void>;
  },
): Promise<{ success: boolean; errorMsg?: string }> {
  const { lang, setImportProgress, fetchLessons } = options;

  let succeeded = 0;
  for (let i = 0; i < previewImportData.length; i++) {
    const item = previewImportData[i];
    try {
      const response = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          content: item.content,
        }),
      });

      if (response.ok) {
        succeeded++;
      } else {
        const errData = await response.json();
        console.warn(`Failed to import item ${i + 1}:`, errData);
      }
    } catch (err) {
      console.warn(`Error importing item ${i + 1}:`, err);
    }
    setImportProgress(i + 1);
  }

  if (succeeded > 0) {
    await fetchLessons();
    return { success: true };
  } else {
    return {
      success: false,
      errorMsg:
        lang === 'zh'
          ? '所有课程项导入均失败。请检查控制台或格式。'
          : 'Failed to import any of the courses. Please check your console or schema.',
    };
  }
}
