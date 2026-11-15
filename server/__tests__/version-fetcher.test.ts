import { describe, it, expect, beforeEach } from 'vitest';
import { checkVersion, clearCache } from '../services/version-fetcher.js';

describe('version-fetcher.checkVersion', () => {
  beforeEach(() => {
    clearCache();
  });

  it('fetches HTTP release ZIP downloadUrl and changelog even when git ls-remote detects a new tag', async () => {
    const result = await checkVersion({ type: 'github-release', repo: 'aymwoo/demo-plugin' }, '1.0.0', {
      gitExecImpl: () => 'abc123\trefs/tags/v1.2.0\n',
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v1.2.0',
              prerelease: false,
              html_url: 'https://github.com/aymwoo/demo-plugin/releases/tag/v1.2.0',
              body: 'Added cool features',
              assets: [
                {
                  name: 'demo-plugin-1.2.0.zip',
                  browser_download_url:
                    'https://github.com/aymwoo/demo-plugin/releases/download/v1.2.0/demo-plugin-1.2.0.zip',
                },
              ],
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    expect(result).toMatchObject({
      hasUpdate: true,
      installedVersion: '1.0.0',
      latestVersion: '1.2.0',
      downloadUrl: 'https://github.com/aymwoo/demo-plugin/releases/download/v1.2.0/demo-plugin-1.2.0.zip',
      releaseUrl: 'https://github.com/aymwoo/demo-plugin/releases/tag/v1.2.0',
      changelog: 'Added cool features',
    });
  });

  it('does NOT fall back downloadUrl to html_url when a release has no .zip asset', async () => {
    const result = await checkVersion({ type: 'gitee-release', repo: 'aymwoo/demo-plugin' }, '1.0.0', {
      gitExecImpl: () => {
        throw new Error('git unavailable');
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v1.3.0',
              prerelease: false,
              html_url: 'https://gitee.com/aymwoo/demo-plugin/releases/v1.3.0',
              body: 'Source only release',
              assets: [{ name: 'notes.txt', browser_download_url: 'https://gitee.com/notes.txt' }],
            },
          ]),
          { status: 200 },
        ),
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe('1.3.0');
    expect(result.downloadUrl).toBeNull();
    expect(result.releaseUrl).toBe('https://gitee.com/aymwoo/demo-plugin/releases/v1.3.0');
  });

  it('falls back to git tag hint when HTTP Releases API fails after git ls-remote succeeds', async () => {
    const result = await checkVersion({ type: 'github-release', repo: 'aymwoo/demo-plugin' }, '1.0.0', {
      gitExecImpl: () => 'def456\trefs/tags/v2.0.0\n',
      fetchImpl: async () => new Response('rate limited', { status: 403 }),
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe('2.0.0');
    expect(result.downloadUrl).toBeNull();
    expect(result.releaseUrl).toBe('https://github.com/aymwoo/demo-plugin/releases/tag/v2.0.0');
  });

  it('scopes cache key by installedVersion so upgrading removes stale update notice', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(
        JSON.stringify([
          {
            tag_name: 'v1.2.0',
            prerelease: false,
            html_url: 'https://github.com/aymwoo/demo-plugin/releases/tag/v1.2.0',
            assets: [{ name: 'pkg.zip', browser_download_url: 'https://github.com/pkg.zip' }],
          },
        ]),
        { status: 200 },
      );
    };

    const r1 = await checkVersion({ type: 'github-release', repo: 'aymwoo/demo-plugin' }, '1.0.0', {
      gitExecImpl: () => '',
      fetchImpl,
    });
    expect(r1.hasUpdate).toBe(true);

    // After upgrade to 1.2.0, checkVersion with 1.2.0 must NOT return cached hasUpdate: true from 1.0.0
    const r2 = await checkVersion({ type: 'github-release', repo: 'aymwoo/demo-plugin' }, '1.2.0', {
      gitExecImpl: () => '',
      fetchImpl,
    });
    expect(r2.hasUpdate).toBe(false);
    expect(calls).toBe(2);
  });
});
