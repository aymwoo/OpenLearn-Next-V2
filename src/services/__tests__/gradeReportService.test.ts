/**
 * PDF 导出冒烟测试（`generateClassPDFReport`）
 *
 * 回归背景：jspdf-autotable@5 的自注册块是
 *   `var jsPDF = anyWindow.jsPDF || anyWindow.jspdf?.jsPDF; if (jsPDF) applyPlugin(jsPDF);`
 * —— 只在 UMD 全局存在时注册。ESM 入口下该全局永远不存在，于是
 * `await import('jspdf-autotable')` 是空操作，`doc.autoTable` 恒为 undefined，
 * 三处表格调用（summary / ranking / assignment）全部抛
 * `doc.autoTable is not a function`，点「导出 PDF」必然失败。
 * 修复方式：显式 `applyPlugin(jsPDF)`（见 gradeReportService.ts）。
 *
 * 关于断言方式（两点环境事实，均已实测）：
 *
 * 1. 真实渲染不需要 canvas polyfill —— jsPDF 在 jsdom 下能完成
 *    `doc.text` / `autoTable` / `doc.output('arraybuffer')`，所以这里断言的是
 *    一个真实序列化的 PDF（字节数 > 0 且以 `%PDF-` 开头），
 *    而不只是 `typeof autoTable === 'function'`。
 *
 * 2. `doc.save()` 在 jsdom 下是**真的能跑通**的：jsPDF 用
 *    `dispatchEvent(new MouseEvent('click'))` 触发 `<a download>`，jsdom 会把
 *    文件写到当前工作目录。但它用的 `URL` 属于 jsdom 的 window realm，
 *    `vi.spyOn(URL, 'createObjectURL')` 拦不到（实测拦截次数为 0）。
 *    因此这里 `process.chdir()` 到一个临时目录再跑，让产物落在临时目录里 ——
 *    既断言了真实产物，又不会让每次跑测试都往仓库根目录扔一个 PDF。
 *    （`pool: 'forks'` 下每个测试文件是独立进程，chdir 不会影响其它文件。）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StudentType } from '../../types/app';
import { generateClassPDFReport } from '../gradeReportService';

const students: StudentType[] = [
  { id: 's1', name: 'Ada Lovelace', email: 'ada@example.com', created_at: 1 },
  { id: 's2', name: 'Alan Turing', email: 'alan@example.com', created_at: 2 },
];

const dashData = {
  assignments: [
    { id: 'a1', title: 'Quiz 1' },
    { id: 'a2', title: 'Assignment 1' },
  ],
  performance: [
    { student_id: 's1', assignment_id: 'a1', submission_status: 'graded', score: 92 },
    { student_id: 's1', assignment_id: 'a2', submission_status: 'graded', score: 78 },
    { student_id: 's2', assignment_id: 'a1', submission_status: 'graded', score: 55 },
    { student_id: 's2', assignment_id: 'a2', submission_status: 'submitted', score: null },
  ],
};

/** jsdom resolves the download target lazily via process.cwd(). */
const flushDownload = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('gradeReportService PDF export', () => {
  let toasts: { title: string; msg: string; type: string }[];
  let loadingFlags: Record<string, boolean>[];

  beforeEach(async () => {
    toasts = [];
    loadingFlags = [];

    // The service imports jspdf lazily *inside* the function. Reset the registry
    // and then re-import here, so the module instance the service is about to
    // load is the very same object mutated below.
    vi.resetModules();

    // Undo any plugin registration, so every test starts from the exact broken
    // state the bug produced (ESM side-effect import => no `doc.autoTable`).
    // This makes the service test an order-independent regression guard: the
    // service itself is the only thing that can make `autoTable` available.
    const { jsPDF } = await import('jspdf');
    delete (jsPDF as any).API.autoTable;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateClassPDFReport writes a non-empty PDF instead of throwing on autoTable', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-grade-report-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      await expect(
        generateClassPDFReport({
          classId: 'c1',
          className: 'CS 101',
          students,
          dashData,
          lang: 'en',
          addToast: (title, msg, type) => toasts.push({ title, msg, type }),
          setIsGeneratingPDFReport: (updater) => {
            loadingFlags.push(updater({}));
          },
        }),
      ).resolves.toBeUndefined();

      // The service swallows errors, so a missing plugin surfaces as a warning
      // toast. These two assertions are the actual regression guard.
      expect(toasts.filter((t) => t.type === 'warning')).toEqual([]);
      expect(toasts.filter((t) => t.type === 'success')).toHaveLength(1);

      // Loading flag is raised for the class and always cleared in `finally`.
      expect(loadingFlags).toEqual([{ c1: true }, { c1: false }]);

      // `doc.save()` fires its download click on a timer.
      await flushDownload();

      const pdfFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.pdf'));
      expect(pdfFiles).toHaveLength(1);
      expect(pdfFiles[0]).toMatch(/^Class_Report_cs_101_\d{4}-\d{2}-\d{2}\.pdf$/);

      const bytes = fs.readFileSync(path.join(tmpDir, pdfFiles[0]));
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('applyPlugin gives jsPDF instances autoTable and records lastAutoTable', async () => {
    const { jsPDF } = await import('jspdf');
    const { applyPlugin } = await import('jspdf-autotable');
    applyPlugin(jsPDF);

    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.text('CLASS PERFORMANCE REPORT', 14, 18);

    // Same call shape as the three table call sites in the service.
    expect(typeof (doc as any).autoTable).toBe('function');
    (doc as any).autoTable({
      startY: 30,
      head: [['Rank', 'Student Name', 'Average Score']],
      body: [
        ['1', 'Ada Lovelace', '85.0%'],
        ['2', 'Alan Turing', '55.0%'],
      ],
      theme: 'grid',
      margin: { left: 14, right: 14 },
    });

    // The service reads `lastAutoTable.finalY` right after each draw.
    expect(typeof (doc as any).lastAutoTable.finalY).toBe('number');
    expect((doc as any).lastAutoTable.finalY).toBeGreaterThan(30);

    const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
