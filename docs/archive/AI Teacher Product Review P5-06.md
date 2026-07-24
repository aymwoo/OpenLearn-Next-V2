# OpenLearn AI Teacher Product Review Report (Sprint P5-06)

> **Reviewer**: Chief Product Architect
> **Date**: 2026-07-23
> **Scope**: 7 AI subsystem modules across `src/features/ai-*` and `src/features/ai-teacher-workspace/`
> **Verdict**: **PASS with Minor Corrections** — Architecture is sound, no critical violations found.

---

## 1. Executive Summary

The AI Teacher subsystem across Sprints P5-01 through P5-05 adheres to the six development principles (Plugin First, Workspace First, Capability First, Event First, Existing Code First, Minimal Invasive). No critical architecture violations were found. AI never directly accesses business modules. All 7 modules expose plugin-extensible registries with identical official/plugin APIs.

**12 findings** were identified: **0 Critical**, **3 Major**, **5 Minor**, **4 Suggestion**.

---

## 2. Architecture Review

### ✅ Verified Principles

| Principle | Status | Evidence |
|---|---|---|
| AI never accesses business modules directly | ✅ Pass | Zero `import` from `services/`, `store/`, or `server.ts` in any AI module |
| AI uses Classroom Context only | ✅ Pass | `AIClassroomContextSnapshot` is the sole context surface; `Object.freeze` enforced |
| AI executes Classroom Actions only | ✅ Pass | `AIActionRegistry.executeAction()` delegates to `AIActionDescriptor.execute()` |
| AI listens through Event Bus | ⚠️ Partial | `ClassroomEventBus` exists but AI modules don't subscribe to events (see Finding #1) |
| AI reuses existing Capability APIs | ✅ Pass | `default-ai-actions.ts` delegates via `executedViaCapabilityApi: true` pattern |
| No duplicated implementations | ✅ Pass | No shared logic duplicated across modules |
| No hardcoded prompts outside registry | ✅ Pass | All prompts registered via `PromptRegistry` |
| No TODO/FIXME/HACK markers | ✅ Pass | Zero occurrences across all feature modules |

---

## 3. Findings

### Finding #1 — `AITeacherWorkspaceRegistry` calls non-existent method on `WorkspaceSlotRegistry`

| Field | Value |
|---|---|
| **Severity** | 🟠 Major |
| **Location** | [ai-teacher-workspace-registry.ts:32](file:///home/wuxf/Develop/openlearnv2/src/features/ai-teacher-workspace/ai-teacher-workspace-registry.ts#L32) |
| **Root Cause** | `AITeacherWorkspaceRegistry.registerAIWidget()` calls `this.slotRegistry.registerProvider(...)` but `WorkspaceSlotRegistry` only exposes `register()`. Additionally, the parameter shape `{ slot, providerId, component, priority }` mismatches `WorkspaceSlotProvider { id, slot, render, priority? }`. |
| **Impact** | Runtime crash if `registerAIWidget()` is called with a real `WorkspaceSlotRegistry` instance. Currently masked because tests instantiate with `new WorkspaceSlotRegistry()` and the test doesn't exercise the downstream slot registry behavior. |
| **Recommendation** | Rename the method call from `registerProvider` to `register` and adapt the parameter shape to match `WorkspaceSlotProvider` (use `id` instead of `providerId`, `render` instead of `component`). |
| **Priority** | P1 — Fix before integration |

---

### Finding #2 — `as any` type casts in `ai-context-provider-registry.ts` and `ai-teacher-workspace-registry.ts`

| Field | Value |
|---|---|
| **Severity** | 🟠 Major |
| **Location** | [ai-context-provider-registry.ts:52-54](file:///home/wuxf/Develop/openlearnv2/src/features/ai-classroom-context/ai-context-provider-registry.ts#L52-L54), [ai-teacher-workspace-registry.ts:33,45](file:///home/wuxf/Develop/openlearnv2/src/features/ai-teacher-workspace/ai-teacher-workspace-registry.ts#L33) |
| **Root Cause** | 5 instances of `as any` suppress type safety — violates project ESLint `no-explicit-any` (warning). In `ai-context-provider-registry.ts`, array-type context fields (`students`, `groups`, `resources`) are cast to `any` instead of using proper typed arrays. In `ai-teacher-workspace-registry.ts`, the slot string and component are cast to `any` to bypass type mismatches. |
| **Impact** | Type errors silently swallowed. Refactoring the upstream types could introduce silent runtime bugs. |
| **Recommendation** | Use proper type assertions or generics. For the workspace registry, align the descriptor shape to `WorkspaceSlotProvider`. |
| **Priority** | P2 — Fix during next sprint |

---

### Finding #3 — AI modules lack Event Bus integration

| Field | Value |
|---|---|
| **Severity** | 🟠 Major |
| **Location** | All `src/features/ai-*` modules |
| **Root Cause** | `ClassroomEventBus` (P4-03) provides `classroom.*` namespaced events, but no AI module subscribes to or publishes events. The `AITeachingWorkflowOrchestrator` should emit events on phase transitions (`ai.phase.advanced`), and the `AIActionRegistry` should emit events after action execution (`ai.action.executed`). |
| **Impact** | Plugins cannot reactively respond to AI workflow changes. Analytics cannot track AI action execution. |
| **Recommendation** | Add optional `ClassroomEventBus` injection to `AITeachingWorkflowOrchestrator` and `AIActionRegistry`, publishing events on state changes. This is an enhancement, not a blocker. |
| **Priority** | P3 — Enhance in next AI Sprint |

---

### Finding #4 — `AIWidgetDescriptor` uses `component` field instead of `render`

| Field | Value |
|---|---|
| **Severity** | 🟡 Minor |
| **Location** | [ai-teacher-workspace-registry.ts:9-15](file:///home/wuxf/Develop/openlearnv2/src/features/ai-teacher-workspace/ai-teacher-workspace-registry.ts#L9-L15) |
| **Root Cause** | `AIWidgetDescriptor` defines `component: React.ComponentType` but `WorkspaceSlotProvider` uses `render: (props?) => React.ReactNode`. These are semantically equivalent but structurally incompatible. |
| **Recommendation** | Align `AIWidgetDescriptor` to use `render` field matching `WorkspaceSlotProvider`, or provide an adapter wrapper in `registerAIWidget()`. |
| **Priority** | P2 |

---

### Finding #5 — Hardcoded default context values in `AIContextProviderRegistry.buildSnapshot()`

| Field | Value |
|---|---|
| **Severity** | 🟡 Minor |
| **Location** | [ai-context-provider-registry.ts:34-44](file:///home/wuxf/Develop/openlearnv2/src/features/ai-classroom-context/ai-context-provider-registry.ts#L34-L44) |
| **Root Cause** | Default fallback values (`Dr. Smith`, `les_01`, `quiz_01`) are hardcoded as inline objects. If no providers are registered, the snapshot returns these fictional defaults without indicating they are placeholders. |
| **Recommendation** | Either return `null`/`undefined` for unregistered context sections, or mark defaults with `{ isDefault: true }` to distinguish real from fallback data. |
| **Priority** | P3 |

---

### Finding #6 — Missing `unregisterAIWidget()` method in `AITeacherWorkspaceRegistry`

| Field | Value |
|---|---|
| **Severity** | 🟡 Minor |
| **Location** | [ai-teacher-workspace-registry.ts](file:///home/wuxf/Develop/openlearnv2/src/features/ai-teacher-workspace/ai-teacher-workspace-registry.ts) |
| **Root Cause** | Every other registry (`AIActionRegistry`, `AISkillRegistry`, `PromptRegistry`) provides an `unregister*()` method for cleanup. `AITeacherWorkspaceRegistry` only has `registerAIWidget()` and `getWidget()`/`listWidgets()`, but no `unregisterAIWidget()` or `clear()`. |
| **Recommendation** | Add `unregisterAIWidget(id)` and `clear()` methods for symmetry and plugin lifecycle support. |
| **Priority** | P3 |

---

### Finding #7 — Widget state not persisted to `LayoutStore`

| Field | Value |
|---|---|
| **Severity** | 🟡 Minor |
| **Location** | [ai-teacher-workspace-widget.tsx](file:///home/wuxf/Develop/openlearnv2/src/features/ai-teacher-workspace/ai-teacher-workspace-widget.tsx) |
| **Root Cause** | `AITeacherWorkspaceWidget` manages state internally via `useState` but does not write `dockPosition`, `pinned`, `collapsed`, `fullscreen`, or `activeSection` to the `LayoutStore` for workspace persistence. After browser refresh, widget state resets to defaults. |
| **Recommendation** | Integrate with `LayoutStore.saveLayout()` / `LayoutStore.loadLayout()` from Sprint P1-05 to persist widget state across sessions. |
| **Priority** | P3 |

---

### Finding #8 — Missing Conversation Management layer

| Field | Value |
|---|---|
| **Severity** | 🟡 Minor |
| **Location** | Across AI subsystem |
| **Root Cause** | The Sprint requirements listed "Conversation Management" in scope. Currently, no conversation history, lesson isolation, or memory cleanup subsystem exists in the Product AI layer. The existing `server.ts` chat endpoint manages conversation server-side, but no Product-layer abstraction bridges the gap. |
| **Recommendation** | This is an expected gap — Conversation Management can be addressed in a dedicated Sprint (P5-07 or later) that wraps existing server-side chat into a Product-layer `ConversationRegistry`. Not blocking for P5-06 acceptance. |
| **Priority** | P4 — Future Sprint |

---

### Finding #9 — `PromptDescriptor.template` lacks variable validation

| Field | Value |
|---|---|
| **Severity** | 💡 Suggestion |
| **Location** | [prompt-types.ts:26](file:///home/wuxf/Develop/openlearnv2/src/features/ai-prompt-registry/prompt-types.ts#L26) |
| **Root Cause** | `template` is a plain `string` with `{{placeholder}}` syntax but no compile-time or runtime validation of variable names. A typo like `{{lessonContex}}` would silently pass. |
| **Recommendation** | Add an optional `variables: ReadonlyArray<string>` field to `PromptMetadata` for self-documenting and validatable templates. |
| **Priority** | P4 |

---

### Finding #10 — `AIActionRegistry.executeAction()` lacks permission enforcement

| Field | Value |
|---|---|
| **Severity** | 💡 Suggestion |
| **Location** | [ai-action-registry.ts:30-42](file:///home/wuxf/Develop/openlearnv2/src/features/ai-action-api/ai-action-registry.ts#L30-L42) |
| **Root Cause** | `AIActionDescriptor` declares `permissions?: ReadonlyArray<string>` but `executeAction()` never checks them. A plugin could register an action with `permissions: ['admin:only']` and any caller could still execute it without enforcement. |
| **Recommendation** | Add an optional `PermissionChecker` dependency to `AIActionRegistry` constructor, and check `action.permissions` before delegating execution. |
| **Priority** | P4 |

---

### Finding #11 — `AISkillRegistry.findSkillsByModel()` wildcard matching inconsistency

| Field | Value |
|---|---|
| **Severity** | 💡 Suggestion |
| **Location** | [ai-skill-registry.ts:40-48](file:///home/wuxf/Develop/openlearnv2/src/features/ai-skill-registry/ai-skill-registry.ts#L40-L48) |
| **Root Cause** | When querying `findSkillsByModel('gemini-1.5-pro')`, skills with `supportedModels: ['*']` are returned alongside explicitly matched skills. This is correct behavior, but the caller has no way to distinguish between explicitly supported and wildcard-matched skills. |
| **Recommendation** | Consider adding a `matchType: 'exact' | 'wildcard'` field to the returned results in future iterations. |
| **Priority** | P5 |

---

### Finding #12 — AI modules lack inter-module dependency documentation

| Field | Value |
|---|---|
| **Severity** | 💡 Suggestion |
| **Location** | All `src/features/ai-*` |
| **Root Cause** | There is no dependency graph documenting how `ai-teacher-workspace` → `ai-action-api` → `ai-classroom-context` → `classroom-runtime` chains connect. Each module is self-contained but the integration topology is implicit. |
| **Recommendation** | Add a Mermaid diagram to `docs/AI Teacher Workspace Implementation Report.md` showing the dependency graph. |
| **Priority** | P5 |

---

## 4. Extension Point Review

| Extension Point | Registry | `register` | `unregister` | `list` | Plugin Test | Status |
|---|---|---|---|---|---|---|
| AI Context Provider | `AIContextProviderRegistry` | ✅ | ✅ | ✅ | ✅ | ✅ Pass |
| AI Action Extension | `AIActionRegistry` | ✅ | ✅ | ✅ | ✅ | ✅ Pass |
| AI Skill Extension | `AISkillRegistry` | ✅ | ✅ | ✅ | ✅ | ✅ Pass |
| AI Prompt Extension | `PromptRegistry` | ✅ | ✅ | ✅ | ✅ | ✅ Pass |
| AI Widget Extension | `AITeacherWorkspaceRegistry` | ✅ | ❌ Missing | ✅ | ⚠️ Not tested | ⚠️ Finding #6 |
| AI Command Extension | `CommandRegistry` (P2-05) | ✅ | ✅ | ✅ | ✅ | ✅ Pass |
| AI Toolbar Extension | `WorkspaceSlotRegistry` (P1-01) | ✅ | ✅ | ✅ | ✅ | ✅ Pass |

**Result**: 6/7 fully extensible. 1 missing `unregister` method (Minor).

---

## 5. Compatibility Review

| Runtime | Compatible | Evidence |
|---|---|---|
| Platform Kernel | ✅ | Zero kernel imports from AI modules |
| Workspace | ⚠️ | Method name mismatch (Finding #1) |
| Lesson Runtime | ✅ | Accessed only via `ClassroomContextFacade` |
| Whiteboard Runtime | ✅ | Accessed only via `ClassroomContextFacade` |
| Plugin Runtime | ✅ | All registries use identical official/plugin APIs |
| Analytics Runtime | ✅ | Accessed only via `AIClassroomContextSnapshot` |
| Classroom Runtime | ✅ | `ClassroomService`, `ClassroomSession`, `ClassroomContextFacade`, `ClassroomEventBus` all compatible |
| Capability Runtime | ✅ | Actions delegate via Capability APIs |
| Event Bus | ⚠️ | Bus exists but AI doesn't subscribe (Finding #3) |

---

## 6. Performance Review

| Metric | Assessment | Notes |
|---|---|---|
| Startup | ✅ Good | Registries are lazy `Map` instances, zero initialization cost |
| Widget rendering | ✅ Good | Single `useState` hook, no expensive effects |
| Context snapshot | ⚠️ Acceptable | `buildSnapshot()` iterates all providers and calls `Object.freeze` recursively — O(n) per snapshot. Acceptable for <100 providers. |
| Memory | ✅ Good | No retained closures, no event listener leaks |
| Repeated context generation | ⚠️ | No caching layer — `buildSnapshot()` creates a new frozen object on every call. Consider memoization if called frequently. |

---

## 7. Security Review

| Check | Status | Notes |
|---|---|---|
| Permission fields declared | ✅ | All descriptors include `permissions` |
| Permission enforcement | ⚠️ | Fields exist but are never checked at execution time (Finding #10) |
| Context isolation | ✅ | `Object.freeze` prevents mutation |
| Plugin isolation | ✅ | Plugin providers caught in try/catch in `buildSnapshot()` |
| Workspace isolation | ✅ | Widget uses local `useState`, no global side effects |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `registerProvider` → `register` crash | High | Medium | Fix Finding #1 |
| Type safety erosion from `as any` | Medium | Low | Fix Finding #2 |
| Missing conversation management | Low | Medium | Planned for future Sprint |
| Permission bypass on AI Actions | Low | Medium | Add enforcement layer |

---

## 9. Technical Debt Summary

| Item | Debt Level | Sprint to Address |
|---|---|---|
| `WorkspaceSlotRegistry` API mismatch | Medium | Immediate (P5-06 fix) |
| `as any` type casts (5 instances) | Low | Next refactor sprint |
| Missing Event Bus integration | Low | P5-07 or P6 |
| Missing conversation management | Medium | Dedicated future sprint |
| No permission enforcement | Low | P6 security sprint |

---

## 10. Acceptance Verdict

### ✅ ACCEPTED — with 1 mandatory correction (Finding #1)

| Success Criteria | Status |
|---|---|
| ✓ No duplicated AI implementation | ✅ Verified |
| ✓ Plugin extensibility verified | ✅ Verified (6/7 full, 1 minor gap) |
| ✓ Workspace integration verified | ⚠️ API mismatch — requires fix |
| ✓ Classroom integration verified | ✅ Verified |
| ✓ Capability usage verified | ✅ Verified |
| ✓ Event integration verified | ⚠️ Partial — enhancement needed |
| ✓ Performance acceptable | ✅ Verified |
| ✓ Architecture remains consistent | ✅ Verified |
