import React from 'react';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  CODE_SANDBOX_DESCRIPTION,
  CodeSandboxWrapper,
  buildSandboxWorkerSource,
  getSandboxRunBlock,
} from '../widgets/CodeSandboxWrapper';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSandbox(props?: { readOnly?: boolean; code?: string }) {
  return render(
    <CodeSandboxWrapper
      elementId="cs-1"
      data={{ code: props?.code ?? "console.log('Hello from sandbox!');" }}
      readOnly={props?.readOnly}
      onPointerDown={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

interface FetchCall {
  url: string;
  credentials: string;
  cookie: string;
}

interface RunnerResult {
  messages: Array<{ source?: string; success?: boolean; logs?: string; error?: string }>;
  fetchCalls: FetchCall[];
  cookieReads: string[];
}

/**
 * Execute the real worker source in a fresh realm. The realm starts with a
 * credentialed fetch and the parent session cookie; the runner must remove both
 * before the snippet runs.
 */
async function runRunner(userCode: string): Promise<RunnerResult> {
  const fetchCalls: FetchCall[] = [];
  const messages: RunnerResult['messages'] = [];
  const cookieReads: string[] = [];
  const jar = { value: 'edu_os_token=parent-secret' };
  const document = {};
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    enumerable: true,
    get() {
      cookieReads.push(jar.value);
      return jar.value;
    },
    set(next: string) {
      jar.value = next;
    },
  });

  const record = (url: string, credentials: string) => {
    fetchCalls.push({ url: String(url), credentials, cookie: jar.value });
  };
  const credentialedFetch = (url: string, opts?: { credentials?: string }) => {
    record(url, opts?.credentials ?? 'same-origin');
    return Promise.resolve({ ok: true, text: async () => 'secret-body' });
  };

  class CredentialedXHR {
    private target = '';
    open(_method: string, url: string) {
      this.target = url;
    }
    send() {
      record(this.target, 'include');
    }
  }

  const sandbox: Record<string, unknown> = {
    document,
    console: { log() {} },
    postMessage: (data: RunnerResult['messages'][number]) => {
      messages.push(data);
    },
    navigator: {
      sendBeacon(url: string) {
        record(url, 'include');
        return true;
      },
    },
    // Own-property credentialed fetch, the shape a same-origin worker starts with.
    fetch: credentialedFetch,
    importScripts(url: string) {
      record(url, 'same-origin');
    },
    XMLHttpRequest: CredentialedXHR,
    // Also installed on the prototype inside the realm, below.
    __credentialedFetch: credentialedFetch,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(
    `
      self = globalThis;
      const proto = {};
      Object.defineProperty(proto, 'fetch', { configurable: true, writable: true, value: self.__credentialedFetch });
      Object.defineProperty(proto, 'importScripts', {
        configurable: true,
        writable: true,
        value: function (url) { self.__credentialedFetch(url, { credentials: 'same-origin' }); },
      });
      Object.setPrototypeOf(self, proto);
    `,
    context,
  );
  const pending = vm.runInContext(buildSandboxWorkerSource(userCode), context) as Promise<unknown>;
  await pending;
  return { messages, fetchCalls, cookieReads };
}

describe('CodeSandboxWrapper — session isolation', () => {
  it('keeps the Run button and shows the pure-computation limitation', () => {
    renderSandbox();
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
    expect(screen.getByTestId('code-sandbox-description').textContent).toBe(CODE_SANDBOX_DESCRIPTION);
    expect(CODE_SANDBOX_DESCRIPTION).toMatch(/pure computation/i);
    expect(CODE_SANDBOX_DESCRIPTION).toMatch(/page session/i);
    expect(CODE_SANDBOX_DESCRIPTION).toMatch(/LMS API/);
  });

  it('hides Run in read-only mode and still shows the limitation', () => {
    renderSandbox({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    expect(screen.getByTestId('code-sandbox-description').textContent).toBe(CODE_SANDBOX_DESCRIPTION);
  });

  it('does not evaluate the snippet with new Function on the parent page', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/features/whiteboard/widgets/CodeSandboxWrapper.tsx'),
      'utf8',
    );
    expect(source).not.toContain('new Function');
    expect(source).not.toContain('eval(');
    const workerSource = buildSandboxWorkerSource('return 1');
    expect(workerSource).not.toContain('new Function');
    expect(workerSource).not.toContain('parent-secret');
  });

  it('posts a snippet return value back to the parent', async () => {
    const { messages, fetchCalls } = await runRunner("console.log('sum'); return 40 + 2;");
    expect(fetchCalls).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      source: 'openlearn-code-sandbox',
      success: true,
      logs: 'sum\nReturn: 42',
    });
  });

  it('gives the runner no credentialed fetch', async () => {
    const direct = await runRunner(
      "try { fetch('/api/auth/session', { credentials: 'include' }); return 'called'; } catch (e) { return 'blocked'; }",
    );
    expect(direct.fetchCalls).toEqual([]);
    expect(direct.messages[0]?.logs).toContain('Return: blocked');

    const viaConstructor = await runRunner(
      'try { const fn = (function () {}).constructor(\'return fetch("/api/auth/session", { credentials: "include" })\'); return String(fn()); } catch (e) { return \'blocked\'; }',
    );
    expect(viaConstructor.fetchCalls).toEqual([]);
    expect(viaConstructor.messages[0]?.logs).toContain('Return: blocked');

    const viaXhr = await runRunner(
      "try { const xhr = new XMLHttpRequest(); xhr.open('GET', '/api/auth/session'); xhr.send(); return 'called'; } catch (e) { return 'blocked'; }",
    );
    expect(viaXhr.fetchCalls).toEqual([]);
    expect(viaXhr.messages[0]?.logs).toContain('Return: blocked');

    const viaImportScripts = await runRunner(
      "try { importScripts('/api/auth/session'); return 'called'; } catch (e) { return 'blocked'; }",
    );
    expect(viaImportScripts.fetchCalls).toEqual([]);
    expect(viaImportScripts.messages[0]?.logs).toContain('Return: blocked');

    const viaPrototype = await runRunner(
      "try { Object.getPrototypeOf(self).fetch('/api/auth/session', { credentials: 'include' }); return 'called'; } catch (e) { return 'blocked'; }",
    );
    expect(viaPrototype.fetchCalls).toEqual([]);
    expect(viaPrototype.messages[0]?.logs).toContain('Return: blocked');
  });

  it('does not let the runner read the parent cookie', async () => {
    document.cookie = 'edu_os_token=parent-secret';
    const source = buildSandboxWorkerSource('return document.cookie');
    expect(source).not.toContain('parent-secret');
    expect(source).not.toContain('edu_os_token');

    const { messages, cookieReads } = await runRunner('return document.cookie');
    expect(messages[0]?.success).toBe(true);
    expect(String(messages[0]?.logs)).not.toContain('parent-secret');
    expect(String(messages[0]?.logs)).toBe('Return: ');
    expect(cookieReads).not.toContain('edu_os_token=parent-secret');
  });

  it('refuses import syntax before starting a worker', () => {
    expect(getSandboxRunBlock("return import('/api/auth/session')")).toMatch(/Pure computation only/);
    expect(getSandboxRunBlock("import { x } from './mod.js'")).toMatch(/Pure computation only/);
    expect(getSandboxRunBlock('return 1 + 1;')).toBeNull();

    const workers: unknown[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          workers.push(this);
        }
        terminate() {}
      },
    );
    renderSandbox({ code: "return import('/api/auth/session')" });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(workers).toHaveLength(0);
    expect(screen.getByText(`Error: ${CODE_SANDBOX_DESCRIPTION}`)).toBeTruthy();
  });

  it('shows a worker return value in the output panel', async () => {
    const workers: Array<{ onmessage: ((event: { data: unknown }) => void) | null }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: { message?: string }) => void) | null = null;
        constructor(_url: string) {
          workers.push(this);
        }
        terminate() {}
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sandbox');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    renderSandbox({ code: 'return 40 + 2;' });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(
      screen.getByText(new RegExp(`Running\\. ${CODE_SANDBOX_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)),
    ).toBeTruthy();
    expect(workers).toHaveLength(1);

    await act(async () => {
      workers[0].onmessage?.({
        data: { source: 'openlearn-code-sandbox', success: true, logs: 'Return: 42' },
      });
    });
    expect(screen.getByText('Return: 42')).toBeTruthy();
    expect(screen.getByTestId('code-sandbox-description').textContent).toBe(CODE_SANDBOX_DESCRIPTION);
  });
});
