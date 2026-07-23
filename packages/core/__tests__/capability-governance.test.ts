import { describe, it, expect, beforeEach } from 'vitest';
import {
  CapabilityGovernanceKernel,
  GovernanceSpecification,
  NamespaceManager,
  DependencyGraph,
  LifecycleEngine,
  PolicyEngine,
  HealthMonitor,
  SearchEngine,
  ManifestExporter,
} from '../capability-governance/index.js';

describe('OpenLearn Capability Governance Test Suite', () => {
  let governanceKernel: CapabilityGovernanceKernel;

  beforeEach(() => {
    governanceKernel = new CapabilityGovernanceKernel();
  });

  const validSpec: GovernanceSpecification = {
    id: 'gov_lesson_quiz',
    namespace: 'lesson.generate.quiz',
    displayName: 'Quiz Generator',
    description: 'Generates multiple choice quizzes',
    version: '1.0.0',
    provider: 'lesson_engine',
    category: 'Assessment',
    permission: ['Teacher', 'System'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    metadata: {},
    dependencies: [],
    owner: 'openlearn-team',
    license: 'MIT',
    visibility: 'Public',
    deprecated: false,
    tags: ['quiz', 'lesson', 'assessment'],
    approvalTier: 'Official',
    status: 'Stable',
  };

  describe('1. Namespace Manager', () => {
    it('should validate dot-separated namespace and prevent collisions', () => {
      const nsManager = new NamespaceManager();
      nsManager.registerNamespace('lesson.generate.quiz');
      expect(nsManager.hasNamespace('lesson.generate.quiz')).toBe(true);

      expect(() => nsManager.registerNamespace('lesson.generate.quiz')).toThrow('Namespace Collision');
      expect(() => nsManager.registerNamespace('invalid_namespace')).toThrow('Invalid Namespace Format');
    });
  });

  describe('2. Dependency Graph & Cycle Detection', () => {
    it('should build DAG and throw error on circular dependency', () => {
      const graph = new DependencyGraph();
      graph.addNode({ ...validSpec, id: 'cap_a' });
      graph.addNode({ ...validSpec, id: 'cap_b' });

      graph.addEdge('cap_a', 'cap_b');
      expect(() => graph.addEdge('cap_b', 'cap_a')).toThrow('Circular Dependency Detected');
    });
  });

  describe('3. Lifecycle Transitions', () => {
    it('should allow valid transitions and reject invalid transitions', () => {
      expect(LifecycleEngine.transition('Draft', 'Experimental')).toBe('Experimental');
      expect(LifecycleEngine.transition('Experimental', 'Stable')).toBe('Stable');
      expect(LifecycleEngine.transition('Stable', 'Deprecated')).toBe('Deprecated');

      expect(() => LifecycleEngine.transition('Archived', 'Stable')).toThrow('Invalid Lifecycle Transition');
    });
  });

  describe('4. Policy Engine', () => {
    it('should enforce security and plugin policies', () => {
      const policy1 = PolicyEngine.evaluatePolicies(validSpec);
      expect(policy1.allowed).toBe(true);

      const riskySpec: GovernanceSpecification = {
        ...validSpec,
        category: 'Plugin',
        approvalTier: 'Internal',
        permission: ['System'],
      };

      const policy2 = PolicyEngine.evaluatePolicies(riskySpec);
      expect(policy2.allowed).toBe(false);
      expect(policy2.reason).toContain('Security Policy Violation');
    });
  });

  describe('5. Health Monitor Metrics', () => {
    it('should record invocation metrics, success rate, and latency', () => {
      const monitor = new HealthMonitor();
      monitor.recordInvocation('gov_lesson_quiz', true, 100, 'gemini');
      monitor.recordInvocation('gov_lesson_quiz', true, 200, 'gemini');
      monitor.recordInvocation('gov_lesson_quiz', false, 300, 'openai');

      const metrics = monitor.getMetrics('gov_lesson_quiz');
      expect(metrics?.invocationCount).toBe(3);
      expect(metrics?.successCount).toBe(2);
      expect(metrics?.averageLatencyMs).toBe(200);
      expect(metrics?.successRate).toBe(66.67);
      expect(metrics?.providerUsage['gemini']).toBe(2);
    });
  });

  describe('6. Search Engine & Manifest Exporter', () => {
    it('should search specifications and export JSON manifest', () => {
      governanceKernel.sdk.registerCapability(validSpec);

      const searchResults = SearchEngine.search([validSpec], { keyword: 'Quiz' });
      expect(searchResults.length).toBe(1);
      expect(searchResults[0].specification.id).toBe('gov_lesson_quiz');

      const jsonManifest = ManifestExporter.exportManifest(validSpec);
      expect(jsonManifest).toContain('gov_lesson_quiz');
      expect(jsonManifest).toContain('schemaVersion');
    });
  });
});
