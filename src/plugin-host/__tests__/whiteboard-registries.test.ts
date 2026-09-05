// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { fullscreenRendererRegistry } from '../../features/whiteboard/fullscreen/FullscreenRendererRegistry';
import { propertyEditorRegistry } from '../../features/whiteboard/properties/PropertyEditorRegistry';
import { coursewareSourceRegistry } from '../../features/whiteboard/courseware/courseware-source-registry';
import type { CoursewareSourceLoader } from '../../features/whiteboard/courseware/courseware-source-registry';
import type {
  FullscreenRenderer,
  FullscreenRendererProps,
} from '../../features/whiteboard/fullscreen/FullscreenRendererRegistry';
import type { PropertyEditorComponent } from '../../features/whiteboard/properties/PropertyEditorRegistry';
import type {
  IFrontendAPI,
  ISocketService,
  IUIService,
  IStorageService,
  FrontendPluginManifest,
  FrontendPluginContext,
} from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────

const noopRenderer: FullscreenRenderer = () => null;
const noopEditor: PropertyEditorComponent = () => null;

function createMockServices() {
  return {
    frontendApi: {
      get: async () => ({ success: true }),
      post: async () => ({ success: true }),
      del: async () => ({ success: true }),
    } as unknown as IFrontendAPI,
    socketService: { emit: () => {}, on: () => {}, off: () => {}, disconnect: () => {} } as unknown as ISocketService,
    uiService: { showToast: () => {}, showModal: () => {}, closeModal: () => {} } as unknown as IUIService,
    storageService: { get: () => null, set: () => {}, delete: () => {}, clear: () => {} } as unknown as IStorageService,
  };
}

// ── Registry ownership semantics ──────────────────────────────────────────

describe('FullscreenRendererRegistry / PropertyEditorRegistry ownership', () => {
  beforeEach(() => {
    // Clear any registrations left by other tests (singletons are module-level).
    fullscreenRendererRegistry.unregister('ext-owner-a');
    fullscreenRendererRegistry.unregister('ext-owner-b');
    fullscreenRendererRegistry.unregister('host-builtin');
    propertyEditorRegistry.unregister('ext-owner-a');
  });

  it('registers with ownership and only removes entries owned by the given plugin', () => {
    fullscreenRendererRegistry.register('host-builtin', noopRenderer);
    fullscreenRendererRegistry.register('ext-owner-a', noopRenderer, 'plugin-a');
    fullscreenRendererRegistry.register('ext-owner-b', noopRenderer, 'plugin-b');

    // A plugin cannot evict a host built-in renderer.
    fullscreenRendererRegistry.unregister('host-builtin', 'plugin-a');
    expect(fullscreenRendererRegistry.has('host-builtin')).toBe(true);

    // A plugin cannot evict another plugin's renderer.
    fullscreenRendererRegistry.unregister('ext-owner-b', 'plugin-a');
    expect(fullscreenRendererRegistry.has('ext-owner-b')).toBe(true);

    // unregisterPlugin removes only that plugin's registrations.
    fullscreenRendererRegistry.unregisterPlugin('plugin-a');
    expect(fullscreenRendererRegistry.has('ext-owner-a')).toBe(false);
    expect(fullscreenRendererRegistry.has('ext-owner-b')).toBe(true);
    expect(fullscreenRendererRegistry.has('host-builtin')).toBe(true);
  });

  it('returns the registered implementation via get()', () => {
    fullscreenRendererRegistry.register('ext-owner-a', noopRenderer, 'plugin-a');
    expect(fullscreenRendererRegistry.get('ext-owner-a')).toBe(noopRenderer);

    propertyEditorRegistry.register('ext-owner-a', noopEditor, 'plugin-a');
    expect(propertyEditorRegistry.get('ext-owner-a')).toBe(noopEditor);
  });
});

// ── ctx.ui wiring + lifecycle cleanup ─────────────────────────────────────

describe('ctx.ui whiteboard registries', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
      services: null,
      initialized: false,
    });
    fullscreenRendererRegistry.unregisterPlugin('whiteboard-test-plugin');
    propertyEditorRegistry.unregisterPlugin('whiteboard-test-plugin');
  });

  it('wires ctx.ui.registerFullscreenRenderer / registerPropertyEditor and cleans up on deactivate', async () => {
    const manifest: FrontendPluginManifest = {
      id: 'whiteboard-test-plugin',
      name: 'Whiteboard Test',
      version: '1.0.0',
    };

    let receivedCtx: FrontendPluginContext | undefined;
    const plugin = {
      manifest,
      activate: async (ctx: FrontendPluginContext) => {
        receivedCtx = ctx;
        ctx.ui.registerFullscreenRenderer('ext-test/widget', ({ data }: FullscreenRendererProps) => null);
        ctx.ui.registerPropertyEditor('ext-test/widget', () => null);
      },
      deactivate: async () => {},
    };

    const moduleLoader = async () => ({
      default: {
        manifest: plugin.manifest,
        activate: plugin.activate,
        deactivate: plugin.deactivate,
      },
    });

    host = new FrontendPluginHost({ moduleLoader });
    const mocks = createMockServices();
    await host.initialize(mocks.frontendApi, mocks.socketService, mocks.uiService, mocks.storageService);

    await host.installPlugin(manifest, 'export default {}');
    await host.activatePlugin(manifest.id);

    expect(receivedCtx).toBeDefined();
    expect(fullscreenRendererRegistry.has('ext-test/widget')).toBe(true);
    expect(propertyEditorRegistry.has('ext-test/widget')).toBe(true);

    await host.deactivatePlugin(manifest.id);

    expect(fullscreenRendererRegistry.has('ext-test/widget')).toBe(false);
    expect(propertyEditorRegistry.has('ext-test/widget')).toBe(false);
  });
});

describe('ctx.ui.registerCoursewareSource', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
      services: null,
      initialized: false,
    });
    coursewareSourceRegistry.unregisterPlugin('courseware-source-plugin');
  });

  it('wires registerCoursewareSource and resolves custom src URL, cleaned on deactivate', async () => {
    const manifest: FrontendPluginManifest = {
      id: 'courseware-source-plugin',
      name: 'CS',
      version: '1.0.0',
    };
    const loader: CoursewareSourceLoader = {
      id: 'ext-moodle/courseware',
      resolve: (data, ctx) =>
        data.sourceType === 'moodle'
          ? `https://moodle.example.com/course/${data.sourceId}?lesson=${ctx.lessonId}`
          : null,
    };

    const plugin = {
      manifest,
      activate: async (ctx: FrontendPluginContext) => {
        ctx.ui.registerCoursewareSource(loader);
      },
      deactivate: async () => {},
    };
    const moduleLoader = async () => ({
      default: { manifest: plugin.manifest, activate: plugin.activate, deactivate: plugin.deactivate },
    });

    host = new FrontendPluginHost({ moduleLoader });
    const mocks = createMockServices();
    await host.initialize(mocks.frontendApi, mocks.socketService, mocks.uiService, mocks.storageService);
    await host.installPlugin(manifest, 'export default {}');
    await host.activatePlugin(manifest.id);

    expect(
      coursewareSourceRegistry.resolve({ sourceType: 'moodle', sourceId: '42' }, { lessonId: 'L1' }),
    ).toBe('https://moodle.example.com/course/42?lesson=L1');
    expect(coursewareSourceRegistry.resolve({ code: '<div/>' }, { lessonId: 'L1' })).toBeNull();

    await host.deactivatePlugin(manifest.id);
    expect(
      coursewareSourceRegistry.resolve({ sourceType: 'moodle', sourceId: '42' }, { lessonId: 'L1' }),
    ).toBeNull();
  });
});
