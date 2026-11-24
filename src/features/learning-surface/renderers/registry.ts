import type { RendererDescriptor, SurfaceRenderer } from '../types';

/**
 * 渲染器注册表（阶段 4）。
 *
 * 内置渲染器在模块加载时注册；插件渲染器不预先注册，由宿主按目录项
 * （pluginId + view）生成 sandbox 描述。未注册 / 未声明的 id 一律显示占位。
 */
const registry = new Map<string, SurfaceRenderer>();

export function registerSurfaceRenderer(renderer: SurfaceRenderer): void {
  registry.set(renderer.id, renderer);
}

export function getSurfaceRenderer(id: string): SurfaceRenderer | undefined {
  return registry.get(id);
}

export function listSurfaceRenderers(): SurfaceRenderer[] {
  return Array.from(registry.values());
}

/** 把目录项转换为 sandbox 渲染器描述；缺少 pluginId / view 时返回 null。 */
export function sandboxRendererFromDescriptor(descriptor: RendererDescriptor): SurfaceRenderer | null {
  if (!descriptor.pluginId || !descriptor.view) return null;
  return {
    id: descriptor.id,
    execution: 'sandbox',
    attemptMode: 'surface',
    capabilities: descriptor.capabilities,
    sourceKinds: descriptor.sourceKinds,
    sandbox: { pluginId: descriptor.pluginId, view: descriptor.view },
  };
}

let directoryPromise: Promise<RendererDescriptor[]> | null = null;

/** 目录只拉一次；失败时清空缓存，允许下一次重试。 */
export function loadSurfaceRendererDirectory(): Promise<RendererDescriptor[]> {
  if (!directoryPromise) {
    directoryPromise = fetch('/api/learning-surface-renderers')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data?: RendererDescriptor[] };
        return Array.isArray(body.data) ? body.data : [];
      })
      .catch((err: unknown) => {
        directoryPromise = null;
        throw err;
      });
  }
  return directoryPromise;
}
