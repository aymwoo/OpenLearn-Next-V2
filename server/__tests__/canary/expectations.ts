/**
 * 金丝雀插件期望表（canary README §5）
 *
 * 纯数据定义：PROBE_MATRIX / MODE_DIFFS / TOKEN_SWEEP / REQUIRE_SWEEP / POISON_MATRIX。
 * 驱动 canary.e2e.test.ts 的双模式参数化测试。
 */

export interface ProbeExpectation {
  id: string;
  expectedOk: boolean;
  matchPattern?: RegExp | string;
}

/** 两模式通用基准探针断言 */
export const PROBE_MATRIX: ProbeExpectation[] = [
  { id: '2.1-pluginId', expectedOk: true, matchPattern: /.+/ },
  { id: '4.1-ensure-table', expectedOk: true, matchPattern: /^plugin_/ },
  { id: '4.2-sql-identifier', expectedOk: true, matchPattern: /\[SEC\] Invalid SQL identifier for ensureTable/ },
  { id: '4.4-sql-empty-schema', expectedOk: true, matchPattern: /\[SEC\] (?:createTable schema must be a non-empty string|Invalid CREATE TABLE schema fragment)/ },
  { id: '4.10-db-migrate', expectedOk: true, matchPattern: /^ran:1$/ },
  { id: '3.4-capabilities', expectedOk: true, matchPattern: /read:true/ },
  { id: '2.5-token:IClassroomCountdownServiceToken(synthetic)', expectedOk: true, matchPattern: /No provider registered for token: @openlearn\/core:IClassroomCountdownService/ },
];

/** 双模式行为差异（模式差异优先级高于通用矩阵） */
export const MODE_DIFFS = {
  inline: {
    '2.2-services': /keys=9, pointsDimension=set/,
    '4.3-sql-semicolon': /\[SEC\] createTable schema must not contain ";" \(multiple statements are not allowed\)/,
    '4.7-db-exec': /^sync$/,
    '4.8-db-transaction': /^function$/,
    '6.1-provide': /^provided$/,
    '6-require:xlsx': /cannot require "xlsx"\. Allowed modules/,
    '6-require:fs': /cannot require "fs"\. Allowed modules/,
    '6-require:lodash': /cannot require "lodash"\. Allowed modules/,
  },
  worker: {
    '2.2-services': /keys=worker, pointsDimension=null/,
    '4.3-sql-semicolon': /\[SEC\] Invalid CREATE TABLE schema fragment: must be non-empty and contain no semicolon/,
    '4.7-db-exec': /^promise$/,
    '4.8-db-transaction': /^undefined$/,
    '6.1-provide': /^worker:skipped$/,
    '6-require:xlsx': /(?:Failed to load local dependency "xlsx"|cannot require "xlsx")/,
    '6-require:fs': /\[SecurityError\] Direct access to Node\.js native module "fs" is forbidden/,
    '6-require:lodash': /(?:Failed to load local dependency "lodash"|cannot require "lodash")/,
  },
} as const;

/** 33 个 DI Token 扫描清单 */
export const TOKEN_SWEEP = [
  'ICommandBusServiceToken',
  'IEventBusServiceToken',
  'IActionRegistryServiceToken',
  'ICapabilityServiceToken',
  'IProcessServiceToken',
  'IStorageServiceToken',
  'IAIServiceToken',
  'IPointsDimensionRegistryToken',
  'IPointsLedgerServiceToken',
  'IDatabaseToken',
  'ISemesterGradeServiceToken',
  'ILessonEngineServiceToken',
  'IClassroomRuntimeServiceToken',
  'IPresenceEngineServiceToken',
  'ITeachingCollaborationServiceToken',
  'ILearningAnalyticsServiceToken',
  'IAICapabilityServiceToken',
  'ICapabilityRuntimeServiceToken',
  'ICapabilityGovernanceServiceToken',
  'IPlatformServiceRegistryToken',
  'ICapabilityRegistryToken',
  'IPluginLifecycleManagerToken',
  'IPluginCapabilityGatewayToken',
  'IUnifiedExtensionRegistryToken',
  'IPluginDistributionManagerToken',
  'IPluginRuntimeCompositionToken',
  'ICoursewareRuntimeScriptRegistryToken',
  'IClassroomLifecycleServiceToken',
  'IInteractionRuntimeServiceToken',
  'IActivityRegistryToken',
  'IAuthSessionBridgeToken',
  'IPluginHostToken',
  'IClassroomCountdownServiceToken',
] as const;

/** require 白名单与黑名单扫描清单 */
export const REQUIRE_SWEEP = [
  { module: 'recharts', allowed: true },
  { module: 'react-markdown', allowed: true },
  { module: 'jspdf', allowed: true },
  { module: 'jspdf-autotable', allowed: true },
  { module: 'exceljs', allowed: true },
  { module: 'lucide-react', allowed: true },
  { module: 'uuid', allowed: true },
  { module: 'xlsx', allowed: false },
  { module: 'fs', allowed: false },
  { module: 'lodash', allowed: false },
] as const;

/** 毒丸变体拒绝矩阵（供第 4 步复用） */
export const POISON_MATRIX = [
  { variant: 'nested-zip', expectedStatus: 400, errorPattern: /Invalid plugin ZIP structure|manifest\.json/ },
  { variant: 'engine99', expectedStatus: 400, errorPattern: /Incompatible platform version|engines/ },
  { variant: 'engine02', expectedStatus: 400, errorPattern: /Incompatible platform version|engines/ },
  { variant: 'missing-entry', expectedStatus: 400, errorPattern: /entry point not found|Entry file not found/ },
  { variant: 'bomb', expectedStatus: 400, errorPattern: /exceeds maximum allowed|ZIP bomb/ },
  { variant: 'all-method', expectedStatus: 400, errorPattern: /ALL|Invalid method/ },
  { variant: 'traversal', expectedStatus: 400, errorPattern: /path traversal|illegal file name/i },
  { variant: 'noprovides', expectedStatus: 400, errorPattern: /not declared in manifest\.provides/ },
] as const;
