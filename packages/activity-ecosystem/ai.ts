/**
 * OpenLearn Activity Ecosystem — AI Integration (Sprint P7-01)
 *
 * Activities may expose AI Skills, contribute AI Context and register AI
 * Actions. These all reuse the EXISTING AI runtime surfaces:
 *   - AI Actions  → the existing ActionRegistry (GenAI tool pipeline)
 *   - AI Context  → merged into the classroom AI context snapshot
 * No new AI runtime logic is introduced here.
 */

import type { IActionRegistryService } from '../core/di/interfaces.js';
import type {
  ActivityProvider,
  ActivityProviderDescriptor,
} from './types.js';

/**
 * Register an activity's AI Action into the existing ActionRegistry. The AI
 * agent can then invoke the activity as a tool, exactly like any other action.
 */
export function registerActivityAIAction(
  actionRegistry: IActionRegistryService,
  descriptor: ActivityProviderDescriptor,
): void {
  if (descriptor.aiAction) {
    actionRegistry.register(descriptor.aiAction);
  }
}

/** Register AI Actions for a batch of providers (official bootstrap helper). */
export function registerActivityAIActions(
  actionRegistry: IActionRegistryService,
  providers: ReadonlyArray<ActivityProvider>,
): void {
  for (const p of providers) {
    registerActivityAIAction(actionRegistry, p.descriptor);
  }
}

/**
 * Build the AI-context fragment for the currently registered activities so it
 * can be merged into the classroom AI context snapshot. Reuses the descriptor
 * metadata — no bespoke context system.
 */
export function buildActivityAIContext(
  providers: ReadonlyArray<ActivityProvider>,
): Record<string, unknown> {
  return {
    activities: providers.map((p) => ({
      id: p.descriptor.id,
      name: p.descriptor.name,
      category: p.descriptor.category,
      provider: p.descriptor.provider,
      commandType: p.descriptor.commandType,
      aiAction: p.descriptor.aiAction?.commandType,
    })),
  };
}
