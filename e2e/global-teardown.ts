import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function globalTeardown(): void {
  const script = path.resolve(process.cwd(), 'scripts/cleanup-test-data.mjs');
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
}
