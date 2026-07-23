# OpenLearn Developer Guide - Platform Domain Registry (开发者指南)

## 1. Executive Summary (概述)

本指南介绍如何在 OpenLearn 平台中声明业务域契约并使用 `PlatformDomainRegistry` 管理业务域与其所属模块的关系。

---

## 2. Registering a Business Domain (注册业务域)

```typescript
import {
  PlatformDomainRegistry,
  PlatformDomainDescriptor,
} from './packages/core/bootstrap/index.js';

const domainRegistry = new PlatformDomainRegistry();

const teachingDomain: PlatformDomainDescriptor = {
  id: 'domain_teaching',
  name: 'teaching',
  displayName: 'Teaching & Classroom Domain',
  description: 'Bounded context for interactive lesson management and whiteboard',
  version: '1.0.0',
  category: 'Business',
  modules: ['mod_lesson_engine', 'mod_whiteboard', 'mod_interaction'],
  status: 'Active',
  health: { isHealthy: true, status: 'Healthy' },
  capabilities: ['lesson-flow', 'whiteboard-sync'],
};

domainRegistry.registerDomain(teachingDomain);
```

---

## 3. Querying Domains and Grouped Modules (查询业务域与所属模块)

```typescript
// Query Domain
const domain = domainRegistry.findDomain('domain_teaching');

// List Modules belonging to a Domain
const modules = domainRegistry.listModules('domain_teaching');
// ['mod_lesson_engine', 'mod_whiteboard', 'mod_interaction']
```
