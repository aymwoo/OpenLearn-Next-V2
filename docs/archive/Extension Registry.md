# Unified Extension Registry

**Module:** `@openlearn/core/plugin-host/unified-extension-registry`  
**Service ID:** `srv_unified_extension_registry`  

---

## Overview

The **Unified Extension Registry** coordinates all platform extension points (`widget`, `panel`, `toolbar`, `sidebar`, `menu`, `context_menu`, `command`, `ai_skill`, `ai_action`, `activity`, `resource`, `theme`, `language`, `setting`).

It provides unified discovery, lookup, category listing, and metadata inspection APIs without duplicating existing registries or executing extension code.

---

## Key Interfaces & Public API

```typescript
export interface ExtensionItemMetadata {
  readonly id: string;
  readonly category: string;
  readonly name?: string;
  readonly version?: string;
  readonly providerId?: string;
  readonly description?: string;
  readonly impl?: unknown;
}

export interface IUnifiedExtensionRegistry {
  registerExtension(
    category: string,
    id: string,
    impl: unknown,
    meta?: Partial<ExtensionItemMetadata>,
  ): void;
  hasExtension(category: string, id: string): boolean;
  getExtension<T = unknown>(category: string, id: string): T | undefined;
  listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata>;
  listCategories(): ReadonlyArray<string>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}
```

---

## Composition Root Integration

Registered in `PluginCompositionModule` under service ID `srv_unified_extension_registry`.
Can be injected or retrieved via `options.infrastructureRefs.get('extensionRegistry')`.
