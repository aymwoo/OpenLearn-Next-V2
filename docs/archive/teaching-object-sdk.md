# OpenLearn Teaching Object Plugin SDK

> **Target Audience**: Core Developers & Third-Party Plugin Authors  
> **Target Module**: `src/features/whiteboard/teaching-object/plugin-sdk/teaching-plugin-sdk.ts`  
> **Status**: Approved & Integrated

---

## 1. Registering Custom Teaching Objects

Plugin developers can register semantic Teaching Objects with default capabilities and metadata:

```ts
import { teachingPluginSDK } from '../features/whiteboard/teaching-object';

teachingPluginSDK.registerTeachingObject({
  type: 'chemdraw-widget',
  displayName: 'ChemDraw 3D 分子结构编辑器',
  category: 'interactive',
  defaultCapabilities: {
    editable: true,
    runnable: true,
    answerable: true,
    scorable: true,
    collaborative: true,
    presentable: true,
    replayable: true,
    evaluatable: true,
    aiEditable: true,
    pluginExtendable: true,
  },
  createDefaultPayload: () => ({
    moleculeData: 'C6H12O6',
    displayMode: 'ball-and-stick',
  }),
});
```

---

## 2. Integrating Assessment & AI Interfaces

```ts
import { teachingEngine } from '../features/whiteboard/teaching-object';

// Submit student answer
teachingEngine.assessment.score(objectId, studentId, 95, 100, 'Excellent molecular geometry!');

// Execute AI Explanation
const explanation = await teachingEngine.ai.explain(teachingObject);
```
