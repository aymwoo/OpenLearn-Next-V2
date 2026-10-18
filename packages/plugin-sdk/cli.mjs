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

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join, dirname, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID, createHash, createPrivateKey, sign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAFFOLD_DIR = join(__dirname, 'scaffold', 'templates');

// ── Color helpers ────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};
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
  return new Promise((resolve) => {
    rl.question(`${c.cyan}?${c.reset} ${question} `, (answer) => resolve(answer.trim()));
  });
}

// ── Commands ─────────────────────────────────────────────────────────────

async function cmdInit(args) {
  let name = '',
    description = '',
    author = '',
    template = 'server-only';

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
    if (!name) {
      console.error(`${c.red}Error:${c.reset} name is required`);
      process.exit(1);
    }

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
    console.error(
      `${c.red}Error:${c.reset} unknown template "${template}". Use: server-only, full-stack, frontend-only`,
    );
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
  const componentName = name
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');

  const vars = {
    name,
    description,
    author,
    pluginId,
    pluginName: name
      .split('-')
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(' '),
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
  const entries = readdirSync(dir).filter((e) => e !== 'node_modules');
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

// ── Signature Helpers ───────────────────────────────────────────────────

const ATTESTATION_V2_PREFIX = 'openlearn-plugin-attestation-v2';

function buildAttestationPayload(id, version, integrityHex) {
  return `${ATTESTATION_V2_PREFIX}\n${id || ''}\n${version || ''}\n${integrityHex.trim()}`;
}

async function signZip({ zip, manifest, privKeyPem, publisherName }) {
  const privKey = createPrivateKey(privKeyPem);
  const publisher = publisherName || manifest.author || 'community';

  // 1. Remove existing signature.json to compute clean unsigned buffer
  zip.remove('signature.json');
  const unsignedBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const unsignedHashHex = createHash('sha256').update(unsignedBuf).digest('hex');

  // 2. Compute signature over unsigned archive
  const payload = buildAttestationPayload(manifest.id, manifest.version, unsignedHashHex);
  const signature = sign(null, Buffer.from(payload, 'utf8'), privKey).toString('base64');

  // 3. Write signature.json into zip
  const sigManifest = {
    version: 2,
    algorithm: 'ed25519',
    signature,
    publisher,
  };
  zip.file('signature.json', JSON.stringify(sigManifest, null, 2));

  // 4. Generate final zip buffer & compute outer integrity + signature for external registry/metadata
  const finalZipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const finalHashHex = createHash('sha256').update(finalZipBuf).digest('hex');
  const finalPayload = buildAttestationPayload(manifest.id, manifest.version, finalHashHex);
  const finalSig = sign(null, Buffer.from(finalPayload, 'utf8'), privKey).toString('base64');

  return {
    finalZipBuf,
    publisher,
    unsignedHashHex,
    signature,
    finalHashHex,
    finalSig,
  };
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
    // SDK 必须保持 external（裸说明符原样保留，运行时由宿主 node_modules 解析——
    // 宿主依赖自带 @openlearn/plugin-sdk）。SDK dist 引用宿主侧 pino/express/uuid/semver，
    // 打进插件 bundle 会导致脚手架项目构建失败，产物在宿主上被 token-enforcer 拒绝。
    external: ['@openlearn/plugin-sdk', ...external],
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
            let depth = 0,
              inString = false,
              escaped = false;
            for (let i = start; i < builtCode.length; i++) {
              const ch = builtCode[i];
              if (escaped) {
                escaped = false;
                continue;
              }
              if (ch === '\\') {
                escaped = true;
                continue;
              }
              if (ch === '"') {
                inString = !inString;
                continue;
              }
              if (inString) continue;
              if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) {
                  try {
                    // esbuild preserves JS object syntax (unquoted keys), not JSON
                    // Use Function constructor to evaluate safely
                    manifest = new Function('return ' + builtCode.substring(start, i + 1))();
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
      const cwdZip = join(cwd, zipName);

      const keyFlagIdx = args.findIndex((a) => a === '--key' || a === '--sign');
      const keyFilePath = keyFlagIdx !== -1 && args[keyFlagIdx + 1] ? resolve(cwd, args[keyFlagIdx + 1]) : null;
      const pubFlagIdx = args.findIndex((a) => a === '--publisher');
      const publisherName = pubFlagIdx !== -1 && args[pubFlagIdx + 1] ? args[pubFlagIdx + 1] : null;

      if (keyFilePath) {
        if (!existsSync(keyFilePath)) {
          console.error(`${c.red}Error:${c.reset} Private key file not found: ${keyFilePath}`);
          process.exit(1);
        }
        const privKeyPem = readFileSync(keyFilePath, 'utf8');
        const signed = await signZip({ zip, manifest, privKeyPem, publisherName });

        writeFileSync(zipPath, signed.finalZipBuf);
        writeFileSync(cwdZip, signed.finalZipBuf);

        const sizeKB = (signed.finalZipBuf.length / 1024).toFixed(1);
        console.log(`${tick} Packaged & Signed ${zipName} (${sizeKB} KB)`);
        console.log(`  → ${cwdZip}`);
        console.log(`  ${info} Publisher: ${signed.publisher}`);
        console.log(`  ${info} Integrity (SHA-256): ${signed.finalHashHex}`);
        console.log(`  ${info} Signature: ${signed.finalSig}`);
        return;
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      writeFileSync(zipPath, zipBuffer);
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

async function cmdSign(args) {
  const cwd = process.cwd();
  const keyFlagIdx = args.findIndex((a) => a === '--key' || a === '-k');
  if (keyFlagIdx === -1 || !args[keyFlagIdx + 1]) {
    console.error(`${c.red}Error:${c.reset} Private key is required. Use --key <private-key.pem>`);
    process.exit(1);
  }
  const keyFilePath = resolve(cwd, args[keyFlagIdx + 1]);
  if (!existsSync(keyFilePath)) {
    console.error(`${c.red}Error:${c.reset} Private key file not found: ${keyFilePath}`);
    process.exit(1);
  }

  const pubFlagIdx = args.findIndex((a) => a === '--publisher');
  const publisherName = pubFlagIdx !== -1 && args[pubFlagIdx + 1] ? args[pubFlagIdx + 1] : null;

  const remainingArgs = args.filter(
    (_, i) => i !== keyFlagIdx && i !== keyFlagIdx + 1 && i !== pubFlagIdx && i !== pubFlagIdx + 1,
  );
  let targetZip = remainingArgs[0] ? resolve(cwd, remainingArgs[0]) : null;

  if (!targetZip) {
    const zipFiles = readdirSync(cwd).filter((f) => f.endsWith('.zip'));
    if (zipFiles.length === 1) {
      targetZip = join(cwd, zipFiles[0]);
    } else if (zipFiles.length > 1) {
      console.error(
        `${c.red}Error:${c.reset} Multiple ZIP files found in directory. Specify one explicitly.`,
      );
      process.exit(1);
    } else {
      console.error(`${c.red}Error:${c.reset} No ZIP file specified or found in current directory.`);
      process.exit(1);
    }
  }

  if (!existsSync(targetZip)) {
    console.error(`${c.red}Error:${c.reset} Target ZIP file not found: ${targetZip}`);
    process.exit(1);
  }

  let JSZip;
  try {
    JSZip = (await import('jszip')).default;
  } catch {
    const projectEsbuild = join(cwd, 'node_modules', 'jszip', 'lib', 'index.js');
    JSZip = (await import(projectEsbuild)).default;
  }

  const privKeyPem = readFileSync(keyFilePath, 'utf8');
  const zipData = readFileSync(targetZip);
  const zip = await JSZip.loadAsync(zipData);

  const manifestFile = zip.file('manifest.json');
  let manifest = { id: basename(targetZip, '.zip'), version: '1.0.0' };
  if (manifestFile) {
    try {
      manifest = JSON.parse(await manifestFile.async('string'));
    } catch (_) {}
  }

  const signed = await signZip({ zip, manifest, privKeyPem, publisherName });
  writeFileSync(targetZip, signed.finalZipBuf);

  console.log(`${tick} Successfully signed ${basename(targetZip)}`);
  console.log(`  ${info} Publisher: ${signed.publisher}`);
  console.log(`  ${info} Integrity: ${signed.finalHashHex}`);
  console.log(`  ${info} Signature: ${signed.finalSig}`);
}

// ── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '-h' || command === '--help') {
  console.log(`
${c.bold}@openlearn/plugin-sdk${c.reset} — Plugin scaffolding, build & signing tool

${c.bold}Usage:${c.reset}
  npx @openlearn/plugin-sdk ${c.cyan}<command>${c.reset} [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}init${c.reset}     Scaffold a new OpenLearn plugin project
  ${c.cyan}build${c.reset}    Build plugin into a distributable ZIP file
  ${c.cyan}sign${c.reset}     Sign a packaged plugin ZIP with Ed25519 private key

${c.bold}Init options:${c.reset}
  --name <name>          Plugin package name (kebab-case)
  --description <desc>   Short description
  --author <author>      Plugin author
  --template <tpl>       Template: server-only | full-stack | frontend-only

${c.bold}Build options:${c.reset}
  --watch, -w            Watch for changes and rebuild
  --key <file>           Sign package with Ed25519 private key during build
  --publisher <name>     Publisher identity (defaults to manifest author)

${c.bold}Sign options:${c.reset}
  --key <file>           Ed25519 private key PEM file (required)
  --publisher <name>     Publisher identity (defaults to manifest author)

${c.bold}Examples:${c.reset}
  npx @openlearn/plugin-sdk init
  npx @openlearn/plugin-sdk build --key publisher.pem
  npx @openlearn/plugin-sdk sign --key publisher.pem my-plugin.zip
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
  case 'sign':
    cmdSign(args.slice(1));
    break;
  default:
    console.error(`${c.red}Unknown command:${c.reset} ${command}`);
    console.error(`Available: init, build, sign`);
    process.exit(1);
}

