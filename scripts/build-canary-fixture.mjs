import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const { buildCanaryZip } = await import('../server/__tests__/canary/canary.builder.ts');
  const zip = await buildCanaryZip();
  const outDir = path.join(ROOT, 'e2e/fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'canary.zip');
  fs.writeFileSync(outFile, zip);
  console.log(`[build-canary-fixture] Generated ${outFile} (${zip.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
