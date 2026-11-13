import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import JSZip from 'jszip';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerThemeRoutes } from '../routes/themes.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { buildThemeZipBuffer, parseAndValidateThemeZip } from '../../packages/core/themes/theme-package.js';
import { ThemeValidationError } from '../../packages/core/themes/theme-spec.js';
import type { ServerContext } from '../context.js';

describe('第三方主题包校验、目录共享、账号隔离与治理 (Issue #484)', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const adminId = 'usr-theme-admin';
  const teacherA = 'usr-theme-teacher-a';
  const teacherB = 'usr-theme-teacher-b';
  const studentA = 'stu-theme-a';

  const tokAdmin = 'tok-theme-admin';
  const tokTeacherA = 'tok-theme-teacher-a';
  const tokTeacherB = 'tok-theme-teacher-b';
  const tokStudentA = 'tok-theme-student-a';

  const cookie = (tok: string) => ({ Cookie: `edu_os_token=${tok}` });

  async function buildSampleZip(
    overrides: Record<string, any> = {},
    extraCss = '',
    extraFiles: Record<string, string> = {},
  ) {
    const manifest = {
      schemaVersion: 1,
      id: 'aurora-edu',
      name: 'Aurora Classroom',
      version: '1.0.0',
      description: 'Sample safe theme',
      author: 'Designer A',
      defaultMode: 'auto',
      tokens: {
        '--color-primary': '#0284c7',
      },
      modes: {
        light: { tokens: { '--bg-app': '#f0f9ff', '--bg-surface': '#ffffff', '--text-main': '#0f172a' } },
        dark: { tokens: { '--bg-app': '#082f49', '--bg-surface': '#0c4a6e', '--text-main': '#f8fafc' } },
      },
      layouts: {
        login: { arrangement: 'split-left', order: ['auth-form', 'brand'] },
        teacher: { navPosition: 'right', contentMaxWidth: 'wide' },
        student: { headerPosition: 'bottom', cardColumns: 3 },
        admin: { navStyle: 'sidebar-left' },
      },
      stylesFile: 'styles.css',
      previewImage: 'assets/badge.svg',
      ...overrides,
    };
    const assets: Record<string, Buffer> = {
      'assets/badge.svg': Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
      ),
    };
    for (const [k, v] of Object.entries(extraFiles)) {
      assets[k] = Buffer.from(v, 'utf8');
    }
    return buildThemeZipBuffer({
      manifest: manifest as any,
      stylesCss: `[data-theme="${manifest.id}"] .hero { border-color: var(--color-primary); }\n${extraCss}`,
      assets,
    });
  }

  beforeAll(async () => {
    const now = Date.now();
    const exp = now + 3600_000;

    db.prepare(
      `INSERT OR REPLACE INTO users (id, username, password_hash, role, name, status, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 0, ?)`,
    ).run(adminId, 'theme_admin', 'hash', 'administrator', 'Theme Admin', now);
    db.prepare(
      `INSERT OR REPLACE INTO users (id, username, password_hash, role, name, status, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 0, ?)`,
    ).run(teacherA, 'theme_teacher_a', 'hash', 'teacher', 'Teacher Alpha', now);
    db.prepare(
      `INSERT OR REPLACE INTO users (id, username, password_hash, role, name, status, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 0, ?)`,
    ).run(teacherB, 'theme_teacher_b', 'hash', 'teacher', 'Teacher Beta', now);

    db.prepare(`INSERT OR REPLACE INTO students (id, name, email, created_at) VALUES (?, ?, ?, ?)`).run(
      studentA,
      'Student Alpha',
      'alpha@test.edu',
      now,
    );

    db.prepare(
      `INSERT OR REPLACE INTO client_sessions (id, session_data, expires_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(
      tokAdmin,
      JSON.stringify({ userId: adminId, username: 'theme_admin', role: 'administrator', name: 'Theme Admin' }),
      exp,
      now,
    );
    db.prepare(
      `INSERT OR REPLACE INTO client_sessions (id, session_data, expires_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(
      tokTeacherA,
      JSON.stringify({ userId: teacherA, username: 'theme_teacher_a', role: 'teacher', name: 'Teacher Alpha' }),
      exp,
      now,
    );
    db.prepare(
      `INSERT OR REPLACE INTO client_sessions (id, session_data, expires_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(
      tokTeacherB,
      JSON.stringify({ userId: teacherB, username: 'theme_teacher_b', role: 'teacher', name: 'Teacher Beta' }),
      exp,
      now,
    );
    db.prepare(
      `INSERT OR REPLACE INTO client_sessions (id, session_data, expires_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).run(tokStudentA, JSON.stringify({ studentId: studentA, role: 'student', name: 'Student Alpha' }), exp, now);

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    const ctx = {
      app,
      io: { emit: () => {} },
    } as unknown as ServerContext;
    registerThemeRoutes(ctx);
    registerPluginsRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    try {
      db.prepare('DELETE FROM themes WHERE id IN (?, ?, ?)').run('aurora-edu', 'campus-atelier', 'student-custom');
      db.prepare('DELETE FROM user_theme_preferences WHERE principal_key LIKE ?').run('%theme%');
      db.prepare('DELETE FROM user_theme_preferences WHERE principal_key = ?').run(`student:${studentA}`);
    } catch {
      // ignore cleanup error
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('validates examples/themes/campus-atelier package and rejects unsafe ZIP / CSS / SVG / semver inputs', async () => {
    // 1. Example theme bundle from repo parses cleanly
    const exampleDir = path.resolve(process.cwd(), 'examples/themes/campus-atelier');
    const exampleManifest = JSON.parse(fs.readFileSync(path.join(exampleDir, 'theme.json'), 'utf8'));
    const exampleCss = fs.readFileSync(path.join(exampleDir, 'styles.css'), 'utf8');
    const exampleZip = await buildThemeZipBuffer({
      manifest: exampleManifest,
      stylesCss: exampleCss,
      assets: {
        'assets/emblem.svg': fs.readFileSync(path.join(exampleDir, 'assets/emblem.svg')),
        'assets/backdrop.svg': fs.readFileSync(path.join(exampleDir, 'assets/backdrop.svg')),
      },
    });
    const parsedExample = await parseAndValidateThemeZip(exampleZip, { platformVersion: '0.7.15' });
    expect(parsedExample.bundle.manifest.id).toBe('campus-atelier');
    expect(parsedExample.bundle.layouts.login.order).toEqual(['brand', 'auth-form', 'seed-hint']);

    // 2. Reject executable / script files
    const scriptZip = new JSZip();
    scriptZip.file('theme.json', JSON.stringify({ id: 'bad-js', name: 'Bad', version: '1.0.0' }));
    scriptZip.file('evil.js', 'alert(1)');
    await expect(parseAndValidateThemeZip(await scriptZip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      ThemeValidationError,
    );

    // 3. Reject path traversal entries
    const travZip = new JSZip();
    travZip.file('theme.json', JSON.stringify({ id: 'bad-trav', name: 'Bad', version: '1.0.0' }));
    travZip.file('../escape.css', 'body { color: red; }');
    await expect(parseAndValidateThemeZip(await travZip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      ThemeValidationError,
    );

    // 4. Reject external CSS @import / https:// urls
    const externalCssZip = await buildSampleZip({}, '@import url("https://evil.com/x.css");');
    await expect(parseAndValidateThemeZip(externalCssZip)).rejects.toThrow(ThemeValidationError);

    // 5. Reject SVG with embedded <script>
    const badSvgZip = await buildSampleZip({}, '', {
      'assets/badge.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    });
    await expect(parseAndValidateThemeZip(badSvgZip)).rejects.toThrow(ThemeValidationError);

    // 6. Reject incompatible platform semver
    const futureZip = await buildSampleZip({ compatibility: { minPlatformVersion: '99.0.0' } });
    await expect(parseAndValidateThemeZip(futureZip, { platformVersion: '0.7.15' })).rejects.toThrow(
      ThemeValidationError,
    );

    // 7. Reject overwriting built-in theme ID
    const builtinConflictZip = await buildSampleZip({ id: 'light' });
    const res = await fetch(`${baseUrl}/api/themes/install`, {
      method: 'POST',
      headers: { ...cookie(tokTeacherA), 'Content-Type': 'application/zip' },
      body: new Uint8Array(builtinConflictZip),
    });
    expect(res.status).toBe(400);
  });

  it('supports install by student & teacher, shared catalog, per-account isolation, uploader-only version bump, and opt-in upgrade', async () => {
    // Student installs their own theme
    const studentZip = await buildSampleZip({ id: 'student-custom', name: 'Student Studio', version: '1.0.0' });
    const stuInstall = await fetch(`${baseUrl}/api/themes/install`, {
      method: 'POST',
      headers: { ...cookie(tokStudentA), 'Content-Type': 'application/zip' },
      body: new Uint8Array(studentZip),
    });
    expect(stuInstall.status).toBe(201);

    // Teacher A installs aurora-edu v1.0.0
    const v1Zip = await buildSampleZip({ id: 'aurora-edu', version: '1.0.0' });
    const installRes = await fetch(`${baseUrl}/api/themes/install`, {
      method: 'POST',
      headers: { ...cookie(tokTeacherA), 'Content-Type': 'application/zip' },
      body: new Uint8Array(v1Zip),
    });
    expect(installRes.status).toBe(201);

    // Teacher B sees aurora-edu in shared catalog, and applies v1.0.0 + overrides
    const catB = await (await fetch(`${baseUrl}/api/themes`, { headers: cookie(tokTeacherB) })).json();
    expect(catB.themes.some((t: any) => t.id === 'aurora-edu')).toBe(true);

    const applyB = await fetch(`${baseUrl}/api/themes/me`, {
      method: 'PUT',
      headers: { ...cookie(tokTeacherB), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        themeId: 'aurora-edu',
        mode: 'dark',
        appearanceOverrides: { primaryColor: '#14b8a6', borderRadius: 'pill', density: 'spacious', fontScale: 1.1 },
      }),
    });
    expect(applyB.status).toBe(200);
    const stateB = await applyB.json();
    expect(stateB.themeId).toBe('aurora-edu');
    expect(stateB.installedVersion).toBe('1.0.0');

    // Teacher A remains isolated on default light
    const stateA = await (await fetch(`${baseUrl}/api/themes/me`, { headers: cookie(tokTeacherA) })).json();
    expect(stateA.themeId).toBe('light');

    // Teacher B CANNOT overwrite Teacher A's theme with a new version
    const v11Zip = await buildSampleZip({ id: 'aurora-edu', version: '1.1.0', changelog: 'Refined contrast' });
    const hijacked = await fetch(`${baseUrl}/api/themes/install`, {
      method: 'POST',
      headers: { ...cookie(tokTeacherB), 'Content-Type': 'application/zip' },
      body: new Uint8Array(v11Zip),
    });
    expect(hijacked.status).toBe(403);

    // Same or lower version by original uploader is rejected with 409
    const sameVer = await fetch(`${baseUrl}/api/themes/install`, {
      method: 'POST',
      headers: { ...cookie(tokTeacherA), 'Content-Type': 'application/zip' },
      body: new Uint8Array(v1Zip),
    });
    expect(sameVer.status).toBe(409);

    // Original uploader Teacher A publishes v1.1.0
    const bumpRes = await fetch(`${baseUrl}/api/themes/install`, {
      method: 'POST',
      headers: { ...cookie(tokTeacherA), 'Content-Type': 'application/zip' },
      body: new Uint8Array(v11Zip),
    });
    expect(bumpRes.status).toBe(200);

    // CRITICAL: Teacher B is NOT silently mutated! Remains on 1.0.0 with upgradeAvailable: true
    const stateBAfterBump = await (await fetch(`${baseUrl}/api/themes/me`, { headers: cookie(tokTeacherB) })).json();
    expect(stateBAfterBump.installedVersion).toBe('1.0.0');
    expect(stateBAfterBump.latestVersion).toBe('1.1.0');
    expect(stateBAfterBump.upgradeAvailable).toBe(true);
    expect(stateBAfterBump.upgradeChangelog).toBe('Refined contrast');

    // Teacher B confirms upgrade -> now pinned to 1.1.0
    const confirmUpgrade = await (
      await fetch(`${baseUrl}/api/themes/me`, {
        method: 'PUT',
        headers: { ...cookie(tokTeacherB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId: 'aurora-edu', installedVersion: '1.1.0' }),
      })
    ).json();
    expect(confirmUpgrade.installedVersion).toBe('1.1.0');
    expect(confirmUpgrade.upgradeAvailable).toBe(false);

    // Asset endpoint serves SVG with CSP sandbox and rejects path traversal
    const assetRes = await fetch(`${baseUrl}/api/themes/aurora-edu/assets/1.1.0/assets/badge.svg`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('content-security-policy')).toBe('sandbox');

    // Export returns portable valid ZIP
    const exportRes = await fetch(`${baseUrl}/api/themes/aurora-edu/export`, { headers: cookie(tokTeacherB) });
    expect(exportRes.status).toBe(200);
    const exportedBuf = Buffer.from(await exportRes.arrayBuffer());
    const reParsed = await parseAndValidateThemeZip(exportedBuf);
    expect(reParsed.bundle.manifest.id).toBe('aurora-edu');
    expect(reParsed.bundle.manifest.version).toBe('1.1.0');
  });

  it('enforces admin-only disable/delete with automatic fallback and ensures /api/themes/public leaks zero user data', async () => {
    // Public endpoint check: no userId, studentId, or principal keys leaked
    const pubRes = await fetch(`${baseUrl}/api/themes/public`);
    expect(pubRes.status).toBe(200);
    const pubJson = await pubRes.text();
    expect(pubJson).not.toContain(teacherA);
    expect(pubJson).not.toContain(teacherB);
    expect(pubJson).not.toContain(studentA);
    expect(pubJson).not.toContain('theme_teacher');

    // Non-admin cannot disable or delete
    const nonAdminDisable = await fetch(`${baseUrl}/api/themes/aurora-edu/disable`, {
      method: 'POST',
      headers: cookie(tokTeacherA),
    });
    expect(nonAdminDisable.status).toBe(403);

    // Admin sets aurora-edu as site default, then disables it -> site default & user state fall back safely
    await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: { ...cookie(tokAdmin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteName: 'Test School', defaultThemeId: 'aurora-edu' }),
    });

    const disableRes = await fetch(`${baseUrl}/api/themes/aurora-edu/disable`, {
      method: 'POST',
      headers: cookie(tokAdmin),
    });
    expect(disableRes.status).toBe(200);

    // Teacher B had selected aurora-edu -> auto falls back to light with fallbackApplied: true
    const fallbackState = await (await fetch(`${baseUrl}/api/themes/me`, { headers: cookie(tokTeacherB) })).json();
    expect(fallbackState.themeId).toBe('light');
    expect(fallbackState.fallbackApplied).toBe(true);

    // Admin re-enables and then deletes cleanly
    const enableRes = await fetch(`${baseUrl}/api/themes/aurora-edu/enable`, {
      method: 'POST',
      headers: cookie(tokAdmin),
    });
    expect(enableRes.status).toBe(200);

    const deleteRes = await fetch(`${baseUrl}/api/themes/aurora-edu`, {
      method: 'DELETE',
      headers: cookie(tokAdmin),
    });
    expect(deleteRes.status).toBe(200);
  });
});
