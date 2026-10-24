import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  splitCsvLine,
  splitCsvRecords,
  downloadCSVTemplate,
  parseAndImportClassesOrStudents,
} from '../bulkImportService';

describe('splitCsvLine', () => {
  it('splits a plain comma line', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps separators inside quoted fields (regression: 备注里写逗号曾被拆错)', () => {
    expect(splitCsvLine('高一A班,"数学较弱, 需重点关注"')).toEqual(['高一A班', '数学较弱, 需重点关注']);
  });

  it('unescapes doubled quotes', () => {
    expect(splitCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', 'x']);
  });

  it('supports an alternate separator', () => {
    expect(splitCsvLine('a;b', ';')).toEqual(['a', 'b']);
  });
});

describe('splitCsvRecords (G-05：引号字段跨物理行)', () => {
  it('keeps a multi-line quoted field as one record', () => {
    const records = splitCsvRecords(['"课程A","第一行', '第二行', '第三行",']);
    expect(records).toHaveLength(1);
    expect(records[0]).toContain('第一行\n第二行\n第三行');
  });

  it('splits by newline outside quotes', () => {
    expect(splitCsvRecords(['a,b', 'c,d'])).toEqual(['a,b', 'c,d']);
  });

  it('does not let doubled quotes break the record boundary', () => {
    // "" 是转义引号，开合相消，记录不应被误判为「仍在引号内」
    const records = splitCsvRecords(['"He said ""hi""",x', 'next,row']);
    expect(records).toEqual(['"He said ""hi""",x', 'next,row']);
  });

  it('skips blank lines between records', () => {
    expect(splitCsvRecords(['a,b', '', '  ', 'c,d'])).toEqual(['a,b', 'c,d']);
  });

  it('keeps an unterminated trailing quote instead of dropping data', () => {
    const records = splitCsvRecords(['a,b', '"未闭合']);
    expect(records).toHaveLength(2);
    expect(records[1]).toBe('"未闭合');
  });
});

describe('downloadCSVTemplate', () => {
  let blobs: Blob[];

  beforeEach(() => {
    blobs = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:mock';
    }) as any;
    URL.revokeObjectURL = vi.fn() as any;
    // 拦截 <a download> 触发的浏览器下载
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function templateText(type: 'class' | 'student', lang: 'zh' | 'en') {
    downloadCSVTemplate(type, lang);
    return await blobs[0].text();
  }

  async function templateBytes(type: 'class' | 'student', lang: 'zh' | 'en') {
    downloadCSVTemplate(type, lang);
    return new Uint8Array(await blobs[0].arrayBuffer());
  }

  it('班级模板应包含学号、初始密码、学生备注列', async () => {
    const text = await templateText('class', 'zh');
    const header = text.replace(/^\uFEFF/, '').split('\n')[0];
    expect(header).toBe('班级名称,班级描述,学生学号,学生姓名,学生邮箱,初始密码,学生备注');
  });

  it('独立学生模板应包含学号、初始密码、学生备注列', async () => {
    const text = await templateText('student', 'zh');
    const header = text.replace(/^\uFEFF/, '').split('\n')[0];
    expect(header).toBe('学生学号,学生姓名,学生邮箱,初始密码,学生备注');
  });

  it('英文模板使用英文表头', async () => {
    const text = await templateText('student', 'en');
    const header = text.replace(/^\uFEFF/, '').split('\n')[0];
    expect(header).toBe('Student Number,Student Name,Student Email,Initial Password,Student Notes');
  });

  it('示例行的密码与备注列留空，避免教师直接沿用示例密码', async () => {
    const text = await templateText('student', 'zh');
    const rows = text
      .replace(/^\uFEFF/, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(rows.length).toBe(3); // 表头 + 2 行示例
    const first = splitCsvLine(rows[1]);
    expect(first[3]).toBe(''); // 初始密码留空 → 系统自动生成
    expect(first[4]).toBe(''); // 备注留空
  });

  it('示例行带 UTF-8 BOM，保证 Excel 打开中文表头不乱码', async () => {
    // 注意：不能用 Blob.text() 断言 —— 它的 UTF-8 解码按规范会吃掉 BOM。
    const bytes = await templateBytes('class', 'zh');
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('示例数据中含逗号的字段被正确加引号', async () => {
    const text = await templateText('class', 'zh');
    const rows = text
      .replace(/^\uFEFF/, '')
      .split('\n')
      .filter((l) => l.trim());
    const second = splitCsvLine(rows[2]);
    expect(second[6]).toBe('数学较弱'); // 备注列
  });
});

describe('parseAndImportClassesOrStudents —— CSV 字段透传', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeFile(name: string, content: string): File {
    return new File([content], name, { type: 'text/csv' });
  }

  /** 捕获 POST /api/students/import 的请求体 */
  async function importStudentsCsv(csv: string) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, created: 1, existing: 0, imported: [] }),
    });
    await parseAndImportClassesOrStudents(makeFile('students.csv', csv), {
      lang: 'zh',
      fetchClasses: vi.fn(),
      fetchStudents: vi.fn(),
    });
    return JSON.parse(fetchMock.mock.calls[0][1].body).students;
  }

  /** 捕获 POST /api/classes/import 的请求体 */
  async function importClassesCsv(csv: string) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, imported: [], credentials: [] }) });
    await parseAndImportClassesOrStudents(makeFile('classes.csv', csv), {
      lang: 'zh',
      fetchClasses: vi.fn(),
      fetchStudents: vi.fn(),
    });
    return JSON.parse(fetchMock.mock.calls[0][1].body).classes;
  }

  it('应把学号/密码/备注一并透传给后端（此前这三项被静默丢弃）', async () => {
    const students = await importStudentsCsv(
      '学生学号,学生姓名,学生邮箱,初始密码,学生备注\n20260101,李明,liming@example.com,Pw@2026,数学较弱',
    );

    expect(students).toEqual([
      {
        name: '李明',
        email: 'liming@example.com',
        student_number: '20260101',
        password: 'Pw@2026',
        private_notes: '数学较弱',
      },
    ]);
  });

  it('「学生备注」列不得被误判为「学生姓名」列', async () => {
    // 备注列刻意排在姓名列之前：模糊匹配会命中「学生」而整体错位
    const students = await importStudentsCsv('学生备注,学生姓名,学生邮箱\n数学较弱,李明,liming@example.com');
    expect(students[0].name).toBe('李明');
    expect(students[0].private_notes).toBe('数学较弱');
  });

  it('旧模板（仅姓名+邮箱）仍可正常导入，缺失列补空串', async () => {
    const students = await importStudentsCsv('学生姓名,学生邮箱\n张三,zhangsan@example.com');
    expect(students[0].name).toBe('张三');
    expect(students[0].email).toBe('zhangsan@example.com');
    expect(students[0].student_number).toBe('');
    expect(students[0].password).toBe('');
  });

  it('英文表头同样被识别', async () => {
    const students = await importStudentsCsv(
      'Student Number,Student Name,Student Email,Initial Password\n20260102,Alice,alice@example.com,Pw123',
    );
    expect(students[0]).toMatchObject({
      student_number: '20260102',
      name: 'Alice',
      email: 'alice@example.com',
      password: 'Pw123',
    });
  });

  it('班级模板应把学号透传到嵌套的 students 中', async () => {
    const classes = await importClassesCsv(
      '班级名称,班级描述,学生学号,学生姓名,学生邮箱\n高一A班,基础英语,20260101,李明,liming@example.com',
    );
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('高一A班');
    expect(classes[0].students[0]).toMatchObject({ name: '李明', student_number: '20260101' });
  });

  it('同一班级多行应聚合成一个班级对象', async () => {
    const classes = await importClassesCsv(
      '班级名称,学生学号,学生姓名,学生邮箱\n高一A班,1,李明,a@x.com\n高一A班,2,王华,b@x.com',
    );
    expect(classes).toHaveLength(1);
    expect(classes[0].students).toHaveLength(2);
  });

  it('JSON 分支也应透传学号/密码/备注', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, created: 1, existing: 0, imported: [] }),
    });
    const file = new File(
      [JSON.stringify([{ name: '李明', email: 'l@x.com', student_number: 'S1', password: 'pw', private_notes: 'n' }])],
      's.json',
      { type: 'application/json' },
    );

    await parseAndImportClassesOrStudents(file, { lang: 'zh', fetchClasses: vi.fn(), fetchStudents: vi.fn() });

    const students = JSON.parse(fetchMock.mock.calls[0][1].body).students;
    expect(students[0]).toMatchObject({ student_number: 'S1', password: 'pw', private_notes: 'n' });
  });

  it('JSON 班级分支应把学生字段一并透传', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, imported: [], credentials: [] }) });
    const file = new File(
      [
        JSON.stringify([
          {
            className: '高一A班',
            description: '英语',
            students: [{ name: '李明', student_number: 'S9', email: 'l@x.com' }],
          },
        ]),
      ],
      'c.json',
      { type: 'application/json' },
    );

    await parseAndImportClassesOrStudents(file, { lang: 'zh', fetchClasses: vi.fn(), fetchStudents: vi.fn() });

    const classes = JSON.parse(fetchMock.mock.calls[0][1].body).classes;
    expect(classes[0].students[0].student_number).toBe('S9');
  });
});
