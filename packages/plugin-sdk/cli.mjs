#!/usr/bin/env node

/**
 * @openlearn/plugin-sdk CLI — plugin scaffolding & build tool.
 *
 * Commands:
 *   init    Scaffold a new OpenLearn plugin project
 *   build   Bundle plugin source into a distributable ZIP
 *
 * Usage:
 *   npx @openlearn/plugin-sdk init                # interactive
 *   npx @openlearn/plugin-sdk init --name my-app  # non-interactive
 *   npx @openlearn/plugin-sdk build               # build from cwd
 *   npx @openlearn/plugin-sdk build --watch        # watch mode
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAFFOLD_DIR = join(__dirname, 'scaffold', 'templates');

// ── Color helpers ────────────────────────────────────────────────────────
const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m' };
const tick = `${c.green}✔${c.reset}`;
const info = `${c.cyan}ℹ${c.reset}`;
const warn = `${c.yellow}⚠${c.reset}`;

// ── Helpers ──────────────────────────────────────────────────────────────

function sv(name) {
  const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
  return pkg.version;
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function replaceInFile(filePath, vars) {
  let content = readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  writeFileSync(filePath, content, 'utf8');
}

function replaceInDir(dir, vars) {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const fp = join(entry.parentPath || dir, entry.name);
      replaceInFile(fp, vars);
    }
  }
}

async function ask(rl, question) {
  return new Promise(resolve => {
    rl.question(`${c.cyan}?${c.reset} ${question} `, answer => resolve(answer.trim()));
  });
}

// ── Commands ─────────────────────────────────────────────────────────────

async function cmdInit(args) {
  let name = '', description = '', author = '', template = 'server-only';

  // Parse non-interactive args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) name = args[++i];
    else if (args[i] === '--description' && args[i + 1]) description = args[++i];
    else if (args[i] === '--author' && args[i + 1]) author = args[++i];
    else if (args[i] === '--template' && args[i + 1]) template = args[++i];
  }

  const interactive = !name; // if --name is provided, skip interactive

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    console.log(`\n${c.bold}OpenLearn Plugin Scaffolder${c.reset}  v${sv()}\n`);

    name = await ask(rl, 'Plugin package name (kebab-case):');
    if (!name) { console.error(`${c.red}Error:${c.reset} name is required`); process.exit(1); }

    description = await ask(rl, `Description (default: "${name} plugin"):`);
    if (!description) description = `${name} plugin`;

    author = await ask(rl, `Author (default: "OpenLearn Developer"):`);
    if (!author) author = 'OpenLearn Developer';

    console.log(`\n${c.dim}Available templates:${c.reset}`);
    console.log(`  ${c.bold}server-only${c.reset}   — Backend plugin (commands, events, AI tools)`);
    console.log(`  ${c.bold}full-stack${c.reset}    — Full plugin (server + React frontend)`);
    console.log(`  ${c.bold}frontend-only${c.reset} — Pure UI extension (React component)`);

    template = await ask(rl, `\nTemplate (default: server-only):`);
    if (!template) template = 'server-only';

    rl.close();
  }

  if (!['server-only', 'full-stack', 'frontend-only'].includes(template)) {
    console.error(`${c.red}Error:${c.reset} unknown template "${template}". Use: server-only, full-stack, frontend-only`);
    process.exit(1);
  }

  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`${c.red}Error:${c.reset} name must be lowercase alphanumeric with hyphens, starting with a letter`);
    process.exit(1);
  }

  const targetDir = resolve(process.cwd(), name);
  if (existsSync(targetDir)) {
    console.error(`${c.red}Error:${c.reset} directory "${name}" already exists`);
    process.exit(1);
  }

  const srcDir = join(SCAFFOLD_DIR, template);
  if (!existsSync(srcDir)) {
    console.error(`${c.red}Error:${c.reset} template "${template}" not found at ${srcDir}`);
    process.exit(1);
  }

  // Scaffold
  console.log(`\n${info} Scaffolding "${name}" with template "${template}"...`);

  copyDir(srcDir, targetDir);

  const pluginId = `@${author.toLowerCase().replace(/[^a-z0-9]/g, '-')}/${name}`;
  const sdkVersion = sv();
  const componentName = name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');

  const vars = {
    name,
    description,
    author,
    pluginId,
    pluginName: name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' '),
    sdkVersion,
    componentName,
  };

  replaceInDir(targetDir, vars);

  // Rename frontend.tsx if template has it
  const feFile = join(targetDir, 'src', 'frontend.tsx');
  if (existsSync(feFile)) {
    replaceInFile(feFile, vars);
  }

  console.log(`\n  ${tick} Created ${name}/`);
  listDir(targetDir, 2);

  console.log(`\n${c.bold}Next steps:${c.reset}`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  openlearn-plugin-sdk build`);
  console.log(`\nThen upload ${name}.zip in OpenLearn Plugin Center.\n`);
}

function listDir(dir, depth, prefix = '') {
  const entries = readdirSync(dir).filter(e => e !== 'node_modules');
  for (const entry of entries.slice(0, 12)) {
    const fp = join(dir, entry);
    const isDir = statSync(fp).isDirectory();
    console.log(`  ${prefix}${isDir ? '📁' : '📄'} ${entry}${isDir ? '/' : ''}`);
    if (isDir && depth > 0) {
      listDir(fp, depth - 1, prefix + '  ');
    }
  }
  if (entries.length > 12) console.log(`  ${prefix}... and ${entries.length - 12} more`);
}

async function cmdBuild(args) {
  const cwd = process.cwd();
  const pkgPath = join(cwd, 'package.json');

  if (!existsSync(pkgPath)) {
    console.error(`${c.red}Error:${c.reset} package.json not found. Run this command in your plugin project root.`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const pluginName = pkg.name || basename(cwd);

  const srcDir = join(cwd, 'src');
  const distDir = join(cwd, 'dist');
  const indexEntry = join(srcDir, 'index.ts');
  const frontendEntry = join(srcDir, 'frontend.tsx');

  if (!existsSync(indexEntry)) {
    console.error(`${c.red}Error:${c.reset} src/index.ts not found. Each plugin needs a server entry point.`);
    process.exit(1);
  }

  const watchMode = args.includes('--watch') || args.includes('-w');

  if (!watchMode) {
    rmSync(distDir, { recursive: true, force: true });
  }
  mkdirSync(distDir, { recursive: true });

  const sdkDist = join(__dirname, 'dist', 'index.js');

  console.log(`${info} Building ${pluginName}...`);

  const buildOpts = (entry, outfile, external = []) => ({
    entryPoints: [entry],
    bundle: true,
    write: true,
    format: 'esm',
    platform: 'node',
    sourcemap: 'inline',
    target: 'node18',
    outfile,
    external: ['@openlearn/plugin-sdk', ...external],
    plugins: [{
      name: 'resolve-plugin-sdk',
      setup(build) {
        build.onResolve({ filter: /^@openlearn\/plugin-sdk$/ }, () => ({
          path: sdkDist,
        }));
      },
    }],
  });

  // Load esbuild (try package-local first, then plugin-sdk bundled)
  let esbuild;
  try {
    esbuild = (await import('esbuild')).default;
  } catch {
    try {
      const projectEsbuild = join(cwd, 'node_modules', 'esbuild', 'lib', 'main.js');
      esbuild = (await import(projectEsbuild)).default;
    } catch {
      console.error(`${c.red}Error:${c.reset} esbuild not found. Install it: npm install --save-dev esbuild`);
      process.exit(1);
    }
  }

  // Load JSZip
  let JSZip;
  try {
    JSZip = (await import('jszip')).default;
  } catch {
    try {
      JSZip = (await import(join(cwd, 'node_modules', 'jszip', 'lib', 'index.js'))).default;
    } catch {
      console.error(`${c.red}Error:${c.reset} jszip not found. Install it: npm install --save-dev jszip`);
      process.exit(1);
    }
  }

  try {
    if (watchMode) {
      const ctx = await esbuild.context(buildOpts(indexEntry, join(distDir, 'index.js')));
      await ctx.watch();
      console.log(`${tick} Watching server entry...`);
      if (existsSync(frontendEntry)) {
        const feCtx = await esbuild.context({
          ...buildOpts(frontendEntry, join(distDir, 'frontend.js'), ['react', 'react-dom', 'recharts', 'lucide-react']),
          platform: 'browser',
          target: 'es2020',
        });
        await feCtx.watch();
        console.log(`${tick} Watching frontend entry...`);
      }
      console.log(`${c.green}Build watch started.${c.reset} Press Ctrl+C to stop.`);
      await new Promise(() => {});
    } else {
      // Build server
      await esbuild.build(buildOpts(indexEntry, join(distDir, 'index.js')));

      let hasFrontend = false;
      if (existsSync(frontendEntry)) {
        await esbuild.build({
          ...buildOpts(frontendEntry, join(distDir, 'frontend.js'), ['react', 'react-dom', 'recharts', 'lucide-react']),
          platform: 'browser',
          target: 'es2020',
        });
        hasFrontend = true;
      }
      console.log(`${tick} Bundled server${hasFrontend ? ' + frontend' : ''}`);

      // Extract or load manifest
      const manifestPath = join(cwd, 'manifest.json');
      let manifest;
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } else {
        // Brace-aware manifest extraction from built code
        const builtCode = readFileSync(join(distDir, 'index.js'), 'utf8');
        const m = builtCode.match(/manifest:\s*/);
        if (m) {
          const start = m.index + m[0].length;
          if (builtCode[start] === '{') {
            let depth = 0, inString = false, escaped = false;
            for (let i = start; i < builtCode.length; i++) {
              const ch = builtCode[i];
              if (escaped) { escaped = false; continue; }
              if (ch === '\\') { escaped = true; continue; }
              if (ch === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) {
                  try {
                    // esbuild preserves JS object syntax (unquoted keys), not JSON
                    // Use Function constructor to evaluate safely
                    manifest = (new Function('return ' + builtCode.substring(start, i + 1)))();
                  } catch (_) {}
                  break;
                }
              }
            }
          }
        }
        if (!manifest) {
          console.warn(`  ${warn} Could not extract manifest. Create a manifest.json file.`);
          manifest = { id: pluginName, name: pluginName, version: '0.1.0' };
        }
      }

      // Package ZIP
      const zip = new JSZip();
      zip.file('index.js', readFileSync(join(distDir, 'index.js'), 'utf8'));
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));
      if (hasFrontend) {
        zip.file('frontend.js', readFileSync(join(distDir, 'frontend.js'), 'utf8'));
      }

      const zipName = `${pluginName.replace(/\//g, '-').replace(/@/g, '')}.zip`;
      const zipPath = join(distDir, zipName);
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      writeFileSync(zipPath, zipBuffer);

      const cwdZip = join(cwd, zipName);
      writeFileSync(cwdZip, zipBuffer);

      const sizeKB = (zipBuffer.length / 1024).toFixed(1);
      console.log(`${tick} Packaged ${zipName} (${sizeKB} KB)`);
      console.log(`  → ${cwdZip}`);
    }
  } catch (err) {
    console.error(`${c.red}Build failed:${c.reset}`, err.message);
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '-h' || command === '--help') {
  console.log(`
${c.bold}@openlearn/plugin-sdk${c.reset} — Plugin scaffolding & build tool

${c.bold}Usage:${c.reset}
  npx @openlearn/plugin-sdk ${c.cyan}<command>${c.reset} [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}init${c.reset}     Scaffold a new OpenLearn plugin project
  ${c.cyan}build${c.reset}    Build plugin into a distributable ZIP file

${c.bold}Init options:${c.reset}
  --name <name>          Plugin package name (kebab-case)
  --description <desc>   Short description
  --author <author>      Plugin author
  --template <tpl>       Template: server-only | full-stack | frontend-only

${c.bold}Build options:${c.reset}
  --watch, -w            Watch for changes and rebuild

${c.bold}Examples:${c.reset}
  npx @openlearn/plugin-sdk init
  npx @openlearn/plugin-sdk init --name my-poll --template full-stack
  npx @openlearn/plugin-sdk build
  npx @openlearn/plugin-sdk build --watch
`);
  process.exit(0);
}

switch (command) {
  case 'init':
    cmdInit(args.slice(1));
    break;
  case 'build':
    cmdBuild(args.slice(1));
    break;
  default:
    console.error(`${c.red}Unknown command:${c.reset} ${command}`);
    console.error(`Available: init, build`);
    process.exit(1);
}
