/**
 * scripts/file-reorg.ts — 按存储布局策略重整既有物理文件（不改变 file_assets.id 与 file_aliases）
 *
 * 用法：
 *   pnpm file:reorg -- --dry-run
 *   pnpm file:reorg -- --scheme by-course --limit 100
 *   pnpm file:reorg -- --scheme custom --template "assets/{purpose}/{assetId}-{filename}"
 *   pnpm file:reorg -- --backend local
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FileLayoutScheme, ReorgPlanItem } from '../server/services/file-storage/types.js';
import type { FileStorageService } from '../server/services/file-storage/file-storage-service.js';

const VALID_SCHEMES: ReadonlySet<string> = new Set(['flat', 'by-date', 'by-course', 'by-author', 'custom']);

export interface FileReorgCliOptions {
  dryRun: boolean;
  scheme?: FileLayoutScheme;
  template?: string;
  backendId?: string;
  limit?: number;
  help: boolean;
}

export interface FileReorgSummary {
  options: FileReorgCliOptions;
  plan: ReorgPlanItem[];
  moved: number;
  planned: number;
  unchanged: number;
  errors: number;
}

export function parseFileReorgArgs(argv: string[]): FileReorgCliOptions {
  const options: FileReorgCliOptions = {
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    const readValue = (flag: string): string => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
      }
      i += 1;
      return next;
    };

    if (arg === '--scheme') {
      const val = readValue('--scheme');
      if (!VALID_SCHEMES.has(val)) {
        throw new Error(`Invalid --scheme "${val}". Expected one of: ${Array.from(VALID_SCHEMES).join(', ')}`);
      }
      options.scheme = val as FileLayoutScheme;
      continue;
    }
    if (arg.startsWith('--scheme=')) {
      const val = arg.slice('--scheme='.length);
      if (!VALID_SCHEMES.has(val)) {
        throw new Error(`Invalid --scheme "${val}". Expected one of: ${Array.from(VALID_SCHEMES).join(', ')}`);
      }
      options.scheme = val as FileLayoutScheme;
      continue;
    }
    if (arg === '--template') {
      options.template = readValue('--template');
      continue;
    }
    if (arg.startsWith('--template=')) {
      options.template = arg.slice('--template='.length);
      continue;
    }
    if (arg === '--backend') {
      options.backendId = readValue('--backend');
      continue;
    }
    if (arg.startsWith('--backend=')) {
      options.backendId = arg.slice('--backend='.length);
      continue;
    }
    if (arg === '--limit') {
      const raw = readValue('--limit');
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit "${raw}". Expected a positive integer.`);
      }
      options.limit = parsed;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit "${raw}". Expected a positive integer.`);
      }
      options.limit = parsed;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.template && !options.scheme) {
    options.scheme = 'custom';
  }

  return options;
}

export async function runFileReorg(service: FileStorageService, argv: string[]): Promise<FileReorgSummary> {
  const options = parseFileReorgArgs(argv);
  if (options.help) {
    return {
      options,
      plan: [],
      moved: 0,
      planned: 0,
      unchanged: 0,
      errors: 0,
    };
  }

  const plan = await service.reorgAssets({
    dryRun: options.dryRun,
    scheme: options.scheme,
    template: options.template,
    backendId: options.backendId,
    limit: options.limit,
  });

  return {
    options,
    plan,
    moved: plan.filter((p) => p.status === 'moved').length,
    planned: plan.filter((p) => p.status === 'planned').length,
    unchanged: plan.filter((p) => p.status === 'unchanged').length,
    errors: plan.filter((p) => p.status === 'error').length,
  };
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/file-reorg.ts [options]

Options:
  --dry-run            Preview planned physical key/backend moves without modifying blobs or DB
  --scheme <name>      Override target layout scheme (flat|by-date|by-course|by-author|custom)
  --template <tpl>     Override custom layout template (implies or pairs with --scheme custom)
  --backend <id>       Target storage backend ID (default: configured defaultBackend)
  --limit <n>          Maximum number of distinct blobs to evaluate
  -h, --help           Show this help message`);
}

async function main(): Promise<void> {
  const options = parseFileReorgArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const { db } = await import('../packages/core/db/index.js');
  const { getDefaultMigrationsDir, loadMigrationsFromDirectory, runMigrations } =
    await import('../packages/core/db/migrator.js');
  const { FileStorageService } = await import('../server/services/file-storage/file-storage-service.js');

  const migrations = loadMigrationsFromDirectory(getDefaultMigrationsDir());
  runMigrations(db, migrations);
  const service = new FileStorageService(db);
  const summary = await runFileReorg(service, process.argv.slice(2));

  console.log(
    `[file-reorg] mode=${summary.options.dryRun ? 'dry-run' : 'apply'} total=${summary.plan.length} moved=${summary.moved} planned=${summary.planned} unchanged=${summary.unchanged} errors=${summary.errors}`,
  );
  for (const item of summary.plan) {
    if (item.status === 'unchanged') continue;
    const arrow = `${item.fromBackend}:${item.fromKey} -> ${item.toBackend}:${item.toKey}`;
    const suffix = item.reason ? ` (${item.reason})` : '';
    console.log(`  [${item.status}] blob=${item.blobId} asset=${item.assetId} ${arrow}${suffix}`);
  }

  if (summary.errors > 0) {
    process.exit(1);
  }
}

const isEntrypoint = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error('[file-reorg] Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
