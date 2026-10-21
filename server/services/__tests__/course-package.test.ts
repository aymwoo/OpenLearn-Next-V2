import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import {
  COURSE_PACKAGE_FORMAT,
  COURSE_PACKAGE_VERSION,
  PRESET_COMPONENT_TYPES,
  buildTemplateCoursePackage,
  parseCoursePackage,
  type CoursePackage,
} from '../course-package.js';
import { countPdfPages, countPptxSlides } from '../course-package-assets.js';

describe('course package template', () => {
  let template: CoursePackage;

  beforeAll(async () => {
    template = await buildTemplateCoursePackage();
  });

  it('carries the format marker and version', () => {
    expect(template.format).toBe(COURSE_PACKAGE_FORMAT);
    expect(template.version).toBe(COURSE_PACKAGE_VERSION);
  });

  it('passes the package validator', () => {
    const parsed = parseCoursePackage(template);
    expect(parsed.ok).toBe(true);
  });

  it('covers every preset component type', () => {
    const covered = new Set(template.elements.map((el) => el.type));
    for (const type of PRESET_COMPONENT_TYPES) {
      expect(covered.has(type), 'template is missing preset component: ' + type).toBe(true);
    }
  });

  it('covers all five teaching segment types', () => {
    const types = new Set(template.lesson.timeline.map((s) => s.type));
    expect(types).toEqual(new Set(['intro', 'lecture', 'practice', 'quiz', 'summary']));
  });

  it('gives every element a segment that exists in the timeline', () => {
    const segmentIds = new Set(template.lesson.timeline.map((s) => s.id));
    for (const element of template.elements) {
      if (element.type === 'page_meta') continue;
      expect(segmentIds.has(element.segmentId!), 'element ' + element.type + ' references unknown segment').toBe(true);
    }
  });

  it('ships a real PDF handout asset', () => {
    const pdf = template.assets.find((a) => a.contentType === 'pdf');
    expect(pdf).toBeDefined();
    const buffer = Buffer.from(pdf!.base64, 'base64');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(1);
  });

  it('ships a real PPTX deck asset with slides', async () => {
    const pptx = template.assets.find((a) => a.contentType === 'pptx');
    expect(pptx).toBeDefined();
    const buffer = Buffer.from(pptx!.base64, 'base64');
    expect(buffer.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(await countPptxSlides(buffer)).toBeGreaterThanOrEqual(1);

    const zip = await JSZip.loadAsync(buffer);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/theme/theme1.xml',
    ]) {
      expect(zip.file(part), 'PPTX is missing part: ' + part).not.toBeNull();
    }
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides.length).toBeGreaterThanOrEqual(1);
  });

  it('references assets only through placeholders', () => {
    const assetIds = new Set(template.assets.map((a) => a.id));
    const raw = JSON.stringify(template.elements);
    const referenced = raw.match(/\$\{asset:[A-Za-z0-9_-]+\}/g) || [];
    expect(referenced.length).toBeGreaterThan(0);
    for (const ref of referenced) {
      const id = ref.slice('${asset:'.length, -1);
      expect(assetIds.has(id), 'placeholder references unknown asset: ' + id).toBe(true);
    }
    expect(raw).not.toContain('/uploads/');
  });
});

describe('parseCoursePackage', () => {
  it('rejects a non-package payload', () => {
    const result = parseCoursePackage({ hello: 'world' });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate segment ids', () => {
    const result = parseCoursePackage({
      format: COURSE_PACKAGE_FORMAT,
      version: 1,
      meta: { name: 'x', description: '', author: '', tags: [] },
      lesson: {
        title: 't',
        content: '',
        progressMode: 'manual',
        timeline: [
          { id: 'dup', title: 'a', type: 'intro' },
          { id: 'dup', title: 'b', type: 'lecture' },
        ],
      },
      assets: [],
      elements: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('dup');
  });

  it('rejects elements pointing at an unknown segment', () => {
    const result = parseCoursePackage({
      format: COURSE_PACKAGE_FORMAT,
      version: 1,
      meta: { name: 'x', description: '', author: '', tags: [] },
      lesson: { title: 't', content: '', progressMode: 'manual', timeline: [] },
      assets: [],
      elements: [{ type: 'quiz', segmentId: 'ghost', data: {} }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ghost');
  });

  it('rejects duplicate asset ids', () => {
    const result = parseCoursePackage({
      format: COURSE_PACKAGE_FORMAT,
      version: 1,
      meta: { name: 'x', description: '', author: '', tags: [] },
      lesson: { title: 't', content: '', progressMode: 'manual', timeline: [] },
      assets: [
        { id: 'a', filename: 'a.pdf', contentType: 'pdf', base64: 'JVBERi0=' },
        { id: 'a', filename: 'b.pdf', contentType: 'pdf', base64: 'JVBERi0=' },
      ],
      elements: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a package whose version is not a positive integer', () => {
    const result = parseCoursePackage({
      format: COURSE_PACKAGE_FORMAT,
      version: 0,
      meta: { name: 'x', description: '', author: '', tags: [] },
      lesson: { title: 't', content: '', progressMode: 'manual', timeline: [] },
      assets: [],
      elements: [],
    });
    expect(result.ok).toBe(false);
  });
});
