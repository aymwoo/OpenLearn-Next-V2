# Gitee 与 GitHub 的 main 快进

两条 GitHub Actions 只移动 `main`，而且只做快进。SHA 已经相同就什么都不推。两边历史分叉就停下来，等人来看。

| 方向           | 工作流                                                                                               | 什么时候推                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GitHub → Gitee | [`.github/workflows/sync-gitee-mirror.yml`](../../.github/workflows/sync-gitee-mirror.yml)           | Gitee `main` 是 GitHub `main` 的祖先。同时推送 tag。                          |
| Gitee → GitHub | [`.github/workflows/sync-github-from-gitee.yml`](../../.github/workflows/sync-github-from-gitee.yml) | GitHub `main` 是 Gitee `main` 的祖先。只动 `main`，不动 tag，也不动其它分支。 |

判定和推送在 [`.github/scripts/sync-github-from-gitee.sh`](../../.github/scripts/sync-github-from-gitee.sh)。脚本不读 `repository_dispatch` 附带的字段，提交号只来自刚刚 `fetch` 到的 `gitee/main`。

不要打开 Gitee 仓库设置里的「仓库镜像管理 / 镜像推送」。那条官方能力会强推，可能盖掉另一侧的提交。这里的同步不使用它。

## 四种结果

| GitHub `main` | Gitee `main` | Gitee → GitHub | GitHub → Gitee                       |
| ------------- | ------------ | -------------- | ------------------------------------ |
| 相同          | 相同         | 空操作，不推送 | 推送时远端已是最新，不会产生新的更新 |
| 祖先          | 后代         | 快进 GitHub    | 发现 Gitee 不是祖先，停止            |
| 后代          | 祖先         | 空操作         | 快进 Gitee                           |
| 互不为祖先    | 互不为祖先   | 失败，不推送   | 失败，不推送                         |

Gitee → GitHub 这条**没有** `continue-on-error`。运行结论是失败，就表示 GitHub `main` 没有被快进。请看该次运行的 Step Summary「Gitee → GitHub main 快进结果」。

另一条 GitHub → Gitee 在 `push` / `schedule` 上仍有 `continue-on-error`。那条工作流给出成功，不能当成镜像已经对齐；以它的 Step Summary 为准。手动触发那条时可以选 `strict=true`。

## 为什么不会打转

1. 两侧 SHA 相同：反向工作流不调用 `git push`。正向工作流即使跑起来，也只是发现远端已最新，Gitee 不会再发出一次 Push。
2. Gitee 领先：反向工作流用默认的 `GITHUB_TOKEN` 快进 GitHub `main`。这个令牌产生的 push **不会**再触发 `on: push` 工作流，所以不会接着跑 GitHub → Gitee。
3. GitHub 领先：反向工作流不推送。正向工作流快进 Gitee。若因此触发下面的 WebHook，反向工作流再跑一次时两侧已经相同，于是空操作。

不要把反向工作流的推送改成个人访问令牌。那样的 push 会触发 GitHub → Gitee。两侧相同时仍然不会循环，但没有必要。

两条工作流的并发组不同（`gitee-mirror-sync` 与 `gitee-to-github-ff`），可以重叠运行。重叠时每条仍按上表停在自己的方向上，不会强推。

## 触发

反向工作流有三种触发，没有 `push`：

| 触发                                       | 作用                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `repository_dispatch`，事件名 `gitee_push` | Gitee 推送 `main` 之后，由下面的中转通知 GitHub，减少等待                                  |
| `schedule`：`47 */6 * * *`                 | 每 6 小时的第 47 分钟兜底。正向工作流是 `17 */6 * * *`，错开 30 分钟，避免两条总是一起起步 |
| `workflow_dispatch`                        | 在 GitHub Actions 页面手动跑                                                               |

定时和 `repository_dispatch` 都要等这个文件出现在默认分支 `main` 上之后才会生效。

Cursor 自带的 GitHub App 不能对这个仓库发 `workflow_dispatch`（接口返回 403，缺少 Actions 写权限）。手动触发请用 Actions 页面，或使用自带 Actions 写权限的用户令牌。不要依赖那个 App。

## 已有 Secret

读取 Gitee 复用仓库里已经配置的 Actions Secret，不新增 Secret：

| Secret           | 用途                            |
| ---------------- | ------------------------------- |
| `GITEE_USERNAME` | Gitee 用户名                    |
| `GITEE_TOKEN`    | Gitee 私人令牌，勾选 `projects` |

两个都在时，脚本用 HTTP Basic 头去 `fetch`，令牌不写入 `git config`，也不放进远端 URL。缺任何一个时，改为匿名读取公开仓库。公开仓库匿名可读；私有仓库或被限流时，这次运行会失败，下一轮定时会再试。

正向工作流使用同一对 Secret。令牌失效或没有 `projects` 权限时，两条同步都会读失败。

## GitHub 权限

反向工作流声明 `permissions: contents: write`，用默认 `GITHUB_TOKEN` 快进 `main`。这是推送所必需的权限。

若仓库或组织把 Actions 的默认令牌限制成只读，工作流文件里的写权限不会被抬高，推送会失败，`main` 保持原样。处理办法：在 GitHub 仓库的 **Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**。组织策略如果把这里锁成只读，需要组织管理员放行。

这次改动不修改分支保护或 ruleset。若以后的规则拒绝 `github-actions[bot]` 更新 `main`，运行会失败并且不会改写历史。需要放行的是这个机器人对 `main` 的快进，而不是换一把可以强推的个人令牌。

## Gitee WebHook

Gitee 的 Push WebHook 不能直接填到 GitHub 的接口上。Gitee 发送的是自己的 JSON（`ref`、`hook_name`、明文 `password` 等），请求头是 `X-Gitee-Token`。GitHub 的 `repository_dispatch` 要求：

- `POST https://api.github.com/repos/aymwoo/OpenLearn-Next-V2/dispatches`
- `Authorization: Bearer <token>`
- 正文 `{"event_type":"gitee_push"}`
- 成功时返回 **204**

两边的鉴权和正文都不同。中转由维护者放在自己的 HTTPS 服务上，不在这个仓库里运行。不配中转也可以：定时任务最多大约 6 小时会补一次。

### 1. 只给中转使用的 GitHub 令牌

这不是 Actions Secret，不要写进仓库，也不要配进 `git remote`。

优先用细粒度个人访问令牌，只授权这一个仓库：

- Repository access：仅 `aymwoo/OpenLearn-Next-V2`
- Permissions：**Contents: Read and write**（GitHub 规定创建 `repository_dispatch` 需要这项；Metadata 会随之打开）

经典令牌则需要 `repo` scope。细粒度令牌的 Contents 写权限同样可以用来 `git push`，所以中转只能拿它调用上面的 dispatches 接口。

反向工作流忽略事件附带的 JSON。令牌泄露出后，别人也只能让工作流再去读一次真实的 Gitee `main`，不能指定要推的提交。令牌本身仍要当成可以写入这个仓库的凭据来保管，并设置过期时间。

### 2. 在 Gitee 添加 WebHook

路径：**仓库主页 → 管理 → WebHooks → 添加 WebHook**。

| 项   | 值                                                                               |
| ---- | -------------------------------------------------------------------------------- |
| URL  | 中转地址，例如 `https://<你的主机>/gitee`                                        |
| 密码 | 随机长密码。Gitee 会以明文放在 `X-Gitee-Token`，也会放进 JSON 的 `password` 字段 |
| 钩子 | 只勾选 **Push**                                                                  |

不要勾选「仓库镜像」。密码不要写进日志，也不要转发给 GitHub。

签名验证的算法见 Gitee 帮助中心「WebHook 密钥验证和验证算法」。下面的示例用密码头比对；若改用签名，以该文档为准。

### 3. 中转示例

示例只做三件事：核对密码、确认是 `refs/heads/main` 且不是删除分支、向 GitHub 发送 `gitee_push`。用 Node.js 22 或更新版本，放在维护者自己的主机上。

```js
import crypto from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.PORT || 8787);
const hookPassword = process.env.GITEE_WEBHOOK_PASSWORD || '';
const githubToken = process.env.GITHUB_DISPATCH_TOKEN || '';

function sameSecret(got, expected) {
  const a = Buffer.from(String(got || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length || b.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/gitee') {
    res.writeHead(404);
    res.end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!sameSecret(req.headers['x-gitee-token'], hookPassword)) {
    res.writeHead(401);
    res.end();
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (payload.ref !== 'refs/heads/main' || payload.deleted === true) {
    res.writeHead(204);
    res.end();
    return;
  }
  const response = await fetch('https://api.github.com/repos/aymwoo/OpenLearn-Next-V2/dispatches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ event_type: 'gitee_push' }),
  });
  res.writeHead(response.status === 204 ? 204 : 502);
  res.end();
});

server.listen(port);
```

环境变量：`GITEE_WEBHOOK_PASSWORD`（与 Gitee WebHook 密码相同）、`GITHUB_DISPATCH_TOKEN`（上一节的令牌）。不要把请求体打到日志里，里面有明文密码。

也可以不部署中转，直接确认接口是否接受事件：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST \
  -H 'Accept: application/vnd.github+json' \
  -H "Authorization: Bearer $GITHUB_DISPATCH_TOKEN" \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  https://api.github.com/repos/aymwoo/OpenLearn-Next-V2/dispatches \
  -d '{"event_type":"gitee_push"}'
```

输出 `204` 表示 GitHub 已排队。工作流随后自己 `fetch` Gitee `main`。

## 分叉时

两条工作流都会停。不要用强推把一侧盖掉。先对照两侧的 `main` 历史，决定保留哪一段，再用普通合并或另行评审的提交把它们接上。接上之后，快进同步会从新的共同历史上继续。

本地夹具（不访问网络）在 `.github/scripts/sync-github-from-gitee.test.sh`，`pnpm test` 会跑它。覆盖：两侧相同不推送、GitHub 领先不推送、分叉失败且不推送、Gitee 领先只快进一次且不复制 tag。
