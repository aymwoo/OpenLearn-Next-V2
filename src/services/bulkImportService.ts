export function downloadCSVTemplate(type: 'class' | 'student', lang: 'zh' | 'en') {
  let filename = '';
  let headers = '';
  let sampleRow = '';
  if (type === 'class') {
    filename = lang === 'zh' ? '班级及学生批量导入模板.csv' : 'class_import_template.csv';
    headers = 'Class Name,Class Desc,Student Name,Student Email';
    sampleRow = lang === 'zh' 
      ? '高一A班,基础英语课程,李明,liming@example.com\n高一A班,基础英语课程,王华,wanghua@example.com' 
      : 'Class 101,Introduction to English,John Doe,john@example.com\nClass 101,Introduction to English,Jane Smith,jane@example.com';
  } else {
    filename = lang === 'zh' ? '学生批量导入模板.csv' : 'student_import_template.csv';
    headers = 'Student Name,Student Email';
    sampleRow = lang === 'zh'
      ? '张三,zhangsan@example.com\n李四,lisi@example.com'
      : 'Alice Cooper,alice@example.com\nBob Dylan,bob@example.com';
  }
  
  const blob = new Blob(['\uFEFF' + headers + '\n' + sampleRow], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
            (item: any) =>
              item.className ||
              (item.name && (item.students || item.classDescription)),
          );

          if (hasClassElement) {
            isClassImport = true;
            parsedData = data
              .map((cls) => {
                const name = cls.name || cls.className || cls.class_name;
                const description =
                  cls.description || cls.classDescription || '';
                const rawStudents = cls.students || cls.studentList || [];
                const students = (
                  Array.isArray(rawStudents) ? rawStudents : []
                )
                  .map((st: any) => ({
                    name: st.name || st.studentName || '',
                    email: st.email || st.studentEmail || '',
                  }))
                  .filter((st: any) => st.name);
                return { name, description, students };
              })
              .filter((cls) => cls.name);
          } else {
            isClassImport = false;
            parsedStudents = data
              .map((st: any) => ({
                name:
                  st.name || st.studentName || st.student_name || '',
                email:
                  st.email || st.studentEmail || st.student_email || '',
              }))
              .filter((st: any) => st.name);
          }
        } else {
          const lines = text.split(/\r?\n/);
          if (lines.length < 2) {
            throw new Error('CSV has empty or insufficient data');
          }
          const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

          const classNameIdx = headers.findIndex(
            (h) =>
              h.includes('class name') ||
              h.includes('班级名称') ||
              h.includes('班级') ||
              h.includes('classname') ||
              h.includes('class_name'),
          );
          const classDescIdx = headers.findIndex(
            (h) =>
              h.includes('class desc') ||
              h.includes('班级描述') ||
              h.includes('描述') ||
              h.includes('class_desc'),
          );
          const studentNameIdx = headers.findIndex(
            (h) =>
              h.includes('student name') ||
              h.includes('学生姓名') ||
              h.includes('姓名') ||
              h.includes('学生') ||
              h.includes('studentname') ||
              h.includes('student_name'),
          );
          const studentEmailIdx = headers.findIndex(
            (h) =>
              h.includes('student email') ||
              h.includes('学生邮箱') ||
              h.includes('邮箱') ||
              h.includes('email') ||
              h.includes('studentemail') ||
              h.includes('student_email'),
          );

          if (studentNameIdx === -1) {
            throw new Error('CSV is missing column: "Student Name" (学生姓名/姓名/学生)');
          }

          if (classNameIdx !== -1) {
            isClassImport = true;
            const classesMap: {
              [className: string]: {
                name: string;
                description: string;
                students: { name: string; email: string }[];
              };
            } = {};

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              const parts =
                line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || line.split(',');
              const cleanParts = parts.map((p) => p.replace(/^"|"$/g, '').trim());

              const className = cleanParts[classNameIdx];
              if (!className) continue;

              const classDesc =
                classDescIdx !== -1 ? cleanParts[classDescIdx] || '' : '';
              const studentName =
                studentNameIdx !== -1 ? cleanParts[studentNameIdx] || '' : '';
              const studentEmail =
                studentEmailIdx !== -1 ? cleanParts[studentEmailIdx] || '' : '';

              if (!classesMap[className]) {
                classesMap[className] = {
                  name: className,
                  description: classDesc,
                  students: [],
                };
              }

              if (studentName) {
                classesMap[className].students.push({
                  name: studentName,
                  email: studentEmail,
                });
              }
            }
            parsedData = Object.values(classesMap);
          } else {
            isClassImport = false;
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              const parts =
                line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || line.split(',');
              const cleanParts = parts.map((p) => p.replace(/^"|"$/g, '').trim());

              const studentName =
                studentNameIdx !== -1 ? cleanParts[studentNameIdx] || '' : '';
              const studentEmail =
                studentEmailIdx !== -1 ? cleanParts[studentEmailIdx] || '' : '';

              if (studentName) {
                parsedStudents.push({
                  name: studentName,
                  email: studentEmail,
                });
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
          resolve({
            success: true,
            message:
              lang === 'zh'
                ? `成功导入 ${resData.imported.length} 个班级数据！`
                : `Successfully imported ${resData.imported.length} classes data!`,
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
          resolve({
            success: true,
            message:
              lang === 'zh'
                ? `成功导入 ${resData.imported.filter((s: any) => s.new).length} 名新学者，匹配并更新了其中的 ${resData.imported.filter((s: any) => !s.new).length} 名同学！`
                : `Successfully imported ${resData.imported.filter((s: any) => s.new).length} new students and updated ${resData.imported.filter((s: any) => !s.new).length} existing ones!`,
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
          throw new Error(lang === 'zh' ? 'CSV 文件行数不足，请包含标题和至少一行数据。' : 'CSV is missing content or headers.');
        }

        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const titleIndex = headers.findIndex((h) => h.includes('title') || h.includes('标题') || h.includes('课程'));
        const contentIndex = headers.findIndex((h) => h.includes('content') || h.includes('内容') || h.includes('正文'));

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
