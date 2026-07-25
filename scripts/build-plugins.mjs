import esbuild from 'esbuild';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Ensure @openlearn/plugin-sdk is built — needed for esbuild to resolve
// plugin imports.  On servers using npm (not pnpm), the workspace link
// doesn't exist, so we resolve directly from the local dist.
const sdkDist = path.resolve('packages/plugin-sdk/dist/index.js');
if (!fs.existsSync(sdkDist)) {
  console.log('Building @openlearn/plugin-sdk...');
  execSync('node packages/plugin-sdk/build.mjs', { stdio: 'inherit' });
}

// All non-system plugins (rollcall, mindmap, hello-world, memo, raffle-vote,
// quiz-pro, ...) were purged from the system per the "remove all non-system-core
// plugins" directive, so there are no third-party plugin sources to bundle here.
// The 7 system-core @openlearn plugins are loaded at runtime, not zipped by this
// script. Keep this list empty unless a plugin source directory is reintroduced.
const plugins = [];

const outDir = path.resolve('dist/plugins');
fs.mkdirSync(outDir, { recursive: true });

async function build() {
  for (const plugin of plugins) {
    try {
      console.log(`Building plugin from ${plugin.entry}...`);
      
      // 1. esbuild bundle backend in memory
      const result = await esbuild.build({
        entryPoints: [plugin.entry],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        sourcemap: 'inline',
        target: 'node18',
        plugins: [{
          name: 'resolve-plugin-sdk',
          setup(build) {
            build.onResolve({ filter: /^@openlearn\/plugin-sdk$/ }, () => ({
              path: sdkDist,
            }));
          },
        }],
      });

      if (!result.outputFiles || result.outputFiles.length === 0) {
        throw new Error(`Esbuild output empty for ${plugin.entry}`);
      }

      const jsCode = result.outputFiles[0].text;

      // 1b. esbuild bundle frontend in memory if frontendEntry exists
      let frontendJsCode = null;
      if (plugin.frontendEntry) {
        console.log(`Building plugin frontend from ${plugin.frontendEntry}...`);
        const feResult = await esbuild.build({
          entryPoints: [plugin.frontendEntry],
          bundle: true,
          write: false,
          format: 'esm',
          sourcemap: 'inline',
          target: 'es2020',
          external: ['react', 'react-dom'],
        });
        if (!feResult.outputFiles || feResult.outputFiles.length === 0) {
          throw new Error(`Esbuild output empty for ${plugin.frontendEntry}`);
        }
        frontendJsCode = feResult.outputFiles[0].text;
      }

      const manifestContent = fs.readFileSync(path.resolve(plugin.manifest), 'utf8');

      // 2. zip packaging
      const zip = new JSZip();
      zip.file('index.js', jsCode);
      zip.file('manifest.json', manifestContent);
      if (frontendJsCode) {
        zip.file('frontend.js', frontendJsCode);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const destPath = path.join(outDir, plugin.zipName);
      fs.writeFileSync(destPath, zipBuffer);

      console.log(`Plugin successfully bundled and zipped to ${destPath}`);
    } catch (err) {
      console.error(`Failed to build plugin: ${plugin.entry}`, err);
      process.exit(1);
    }
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
