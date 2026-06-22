import esbuild from 'esbuild';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

const plugins = [
  {
    entry: 'packages/plugins/quiz-pro/index.ts',
    manifest: 'packages/plugins/quiz-pro/manifest.json',
    zipName: 'ext-ai-quiz-pro.zip'
  },
  {
    entry: 'packages/plugins/quiz/index.ts',
    manifest: 'packages/plugins/quiz/manifest.json',
    zipName: 'ext-quiz-generator.zip'
  },
  {
    entry: 'packages/plugins/rollcall/index.ts',
    manifest: 'packages/plugins/rollcall/manifest.json',
    zipName: 'ext-roll-call.zip'
  },
  {
    entry: 'packages/plugins/mindmap/index.ts',
    manifest: 'packages/plugins/mindmap/manifest.json',
    zipName: 'ext-mindmap-assistant.zip'
  },
  {
    entry: 'packages/plugins/hello-world/index.ts',
    manifest: 'packages/plugins/hello-world/manifest.json',
    zipName: 'ext-hello-world.zip'
  }
];

const outDir = path.resolve('dist/plugins');
fs.mkdirSync(outDir, { recursive: true });

async function build() {
  for (const plugin of plugins) {
    try {
      console.log(`Building plugin from ${plugin.entry}...`);
      
      // 1. esbuild bundle in memory
      const result = esbuild.buildSync({
        entryPoints: [plugin.entry],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        sourcemap: 'inline',
        target: 'node18'
      });

      if (!result.outputFiles || result.outputFiles.length === 0) {
        throw new Error(`Esbuild output empty for ${plugin.entry}`);
      }

      const jsCode = result.outputFiles[0].text;
      const manifestContent = fs.readFileSync(path.resolve(plugin.manifest), 'utf8');

      // 2. zip packaging
      const zip = new JSZip();
      zip.file('index.js', jsCode);
      zip.file('manifest.json', manifestContent);

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
