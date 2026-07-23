/**
 * OpenLearn AI Skill Registry - Registry (Sprint P5-03)
 * Central registry for official and plugin AI Skill providers.
 */

import { IAISkillProvider, AISkillMetadata } from './ai-skill-types.js';

export class AISkillRegistry {
  private skills = new Map<string, IAISkillProvider>();

  public registerSkill(skill: IAISkillProvider): void {
    if (!skill || !skill.metadata || !skill.metadata.id || !skill.metadata.name) {
      throw new Error('AISkillRegistry Error: IAISkillProvider must have valid metadata with ID and Name.');
    }
    this.skills.set(skill.metadata.id, skill);
  }

  public unregisterSkill(skillId: string): boolean {
    return this.skills.delete(skillId);
  }

  public getSkill(skillId: string): IAISkillProvider | undefined {
    return this.skills.get(skillId);
  }

  public listSkills(): ReadonlyArray<IAISkillProvider> {
    return Object.freeze(Array.from(this.skills.values()));
  }

  public findSkillsByContext(contextKey: string): ReadonlyArray<IAISkillProvider> {
    const results: IAISkillProvider[] = [];
    for (const skill of this.skills.values()) {
      if (skill.metadata.requiredContext.includes(contextKey) || skill.metadata.requiredContext.includes('*')) {
        results.push(skill);
      }
    }
    return Object.freeze(results);
  }

  public findSkillsByModel(modelName: string): ReadonlyArray<IAISkillProvider> {
    const results: IAISkillProvider[] = [];
    for (const skill of this.skills.values()) {
      if (skill.metadata.supportedModels.includes(modelName) || skill.metadata.supportedModels.includes('*')) {
        results.push(skill);
      }
    }
    return Object.freeze(results);
  }

  public clear(): void {
    this.skills.clear();
  }
}
