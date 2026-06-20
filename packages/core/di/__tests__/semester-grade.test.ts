import { describe, it, expect } from 'vitest';
import { Token } from '../token.js';
import { ISemesterGradeServiceToken, ISemesterGradeService } from '../interfaces.js';
import { SEMESTER_GRADE_SERVICE_TOKEN } from '../../../../src/plugin-host/types';
import { MfeServiceRegistryProxy, DI_WHITELIST } from '../../../../src/mfe/MfeContextProvider';
import { ServiceRegistry } from '../service-registry.js';

describe('SemesterGradeService - Token Contracts and Whitelist (Wave 1)', () => {
  it('should define ISemesterGradeServiceToken correctly', () => {
    expect(ISemesterGradeServiceToken).toBeInstanceOf(Token);
    expect(ISemesterGradeServiceToken.name).toBe('@openlearn/core:ISemesterGradeService');
  });

  it('should define frontend SEMESTER_GRADE_SERVICE_TOKEN correctly', () => {
    expect(SEMESTER_GRADE_SERVICE_TOKEN).toBe('@openlearn/frontend:ISemesterGradeService');
  });

  it('should include the frontend semester grade Token in DI_WHITELIST', () => {
    expect(DI_WHITELIST).toContain(SEMESTER_GRADE_SERVICE_TOKEN);
  });

  it('should allow resolving the semester grade Token via MfeServiceRegistryProxy without access denied', async () => {
    const rawRegistry = new ServiceRegistry();
    const mockService: ISemesterGradeService = {
      saveSemesterGrade: async () => {}
    };

    // Register backend service (in production this token is mapped, we mock the FrontendServiceRegistry behavior)
    // Frontend registry mimics proxying it. Let's mock a simple FrontendServiceRegistry
    const fakeFrontendRegistry = {
      resolve: async (token: string) => {
        if (token === SEMESTER_GRADE_SERVICE_TOKEN) return mockService;
        throw new Error('Not found');
      },
      services: new Map<string, any>([[SEMESTER_GRADE_SERVICE_TOKEN, mockService]]),
      has: (token: string) => token === SEMESTER_GRADE_SERVICE_TOKEN
    };

    const proxy = new MfeServiceRegistryProxy(fakeFrontendRegistry);

    // Resolve should succeed
    const resolved = await proxy.resolve<ISemesterGradeService>(SEMESTER_GRADE_SERVICE_TOKEN);
    expect(resolved).toBe(mockService);

    // get should succeed
    const gotten = proxy.get<ISemesterGradeService>(SEMESTER_GRADE_SERVICE_TOKEN);
    expect(gotten).toBe(mockService);

    // has should be true
    expect(proxy.has(SEMESTER_GRADE_SERVICE_TOKEN)).toBe(true);
  });

  it('should throw Access Denied on non-whitelisted token resolution', async () => {
    const fakeFrontendRegistry = {
      resolve: async () => ({}),
      services: new Map<string, any>(),
      has: () => true
    };

    const proxy = new MfeServiceRegistryProxy(fakeFrontendRegistry);
    const privateToken = '@openlearn/frontend:IPrivateHostService';

    await expect(proxy.resolve(privateToken)).rejects.toThrow(/Access Denied/);
    expect(() => proxy.get(privateToken)).toThrow(/Access Denied/);
    expect(() => proxy.has(privateToken)).toThrow(/Access Denied/);
  });
});
