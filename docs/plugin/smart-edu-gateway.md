# 国家智慧教育平台数据网关契约（Smart-Edu Gateway Contract）

> 消费方：内核插件 `@openlearn/plugin-smart-edu`（[packages/plugins/national-smart-edu.ts](../../packages/plugins/national-smart-edu.ts)）。
> 该插件**只发起真实 HTTP 请求**：网关未配置或不可达时，UI 如实呈现失败/未配置状态，不存在本地模拟数据兜底。

## 服务端配置（.env）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SMARTEDU_API_BASE` | 是 | 网关基址，如 `https://gateway.example.edu/smart-edu`（末尾 `/` 会被归一化）。留空 = 未配置 |
| `SMARTEDU_APP_KEY` | 网关启用鉴权时必填 | 请求签名凭据 AppKey |
| `SMARTEDU_APP_SECRET` | 网关启用鉴权时必填 | HMAC-SHA256 签名密钥 |
| `SMARTEDU_TIMEOUT_MS` | 否 | 单请求超时，默认 `8000` |

## 请求签名

启用凭据后，连接器对每个请求附加：

```
X-SE-App-Key:   <SMARTEDU_APP_KEY>
X-SE-Timestamp: <毫秒时间戳>
X-SE-Signature: HMAC-SHA256(SMARTEDU_APP_SECRET, "<timestamp>.<path>.<sha256(body)>")
```

其中 `path` 为带查询串的路径（如 `/resources/search?query=x`），GET 请求 `sha256(body)` 取空字符串的哈希。网关应在时间戳偏差窗口（建议 ±5 分钟）内重放校验。

## 端点契约

### 1. 健康探测 `GET {base}/health`

```json
{ "ok": true, "status": "HEALTHY" }
```

`ok !== true` 或非 2xx 一律判定离线。连接器以此测量真实 RTT。

### 2. 资源检索 `GET {base}/resources/search?query=&subject=&grade=&awardLevel=`

参数均可省略；`all` 视为不筛。响应：

```json
{
  "resources": [
    {
      "id": "res-001",
      "code": "SED-2026-IT-0089",
      "title": "算法与程序设计：…",
      "subject": "information_tech",
      "grade": "high_1",
      "edition": "zhejiang",
      "awardLevel": "national_gold",
      "teacherName": "…",
      "schoolName": "…",
      "summary": "…",
      "tags": ["…"],
      "timeline": [
        { "id": "seg-1", "title": "…", "type": "lecture", "duration": 10, "description": "…" }
      ]
    }
  ]
}
```

字段以网关实际返回为准（未知取值原样透传，连接器不做枚举约束）；`timeline` 可缺省。

### 3. 资源详情 `GET {base}/resources/{id}`

返回单个资源，形状同上，导入功能额外读取可选字段：

```json
{
  "whiteboardElements": [
    { "type": "markdown", "data": { "title": "…", "content": "…", "x": 40, "y": 40, "width": 520, "height": 280 } }
  ]
}
```

### 4. 学情上报 `POST {base}/metrics/report`

请求体（`X-SE-Payload-Hash` 请求头携带连接器对完整提交体的真实 SHA-256，网关应重算校验）：

```json
{
  "lessonId": "lesson-…",
  "classId": "class-…",
  "reportData": { "…": "宿主采集的真实学情指标" },
  "source": "openlearn-next",
  "submittedAt": "2026-10-11T…"
}
```

响应：

```json
{ "receiptId": "平台回执号（缺省时连接器生成 CELTS-REC-*）", "status": "ACCEPTED", "message": "…" }
```

## 授权链

网关命令在内核 `actionRegistry` 注册了 `capabilityRequired`：
`smart_edu:read`（检索/状态，教师与学生）、`smart_edu:write`（导入，教师）、`smart_edu:export`（上报，教师）。
角色→能力映射见 [`packages/core/capability/guard/capability-guard.ts`](../../packages/core/capability/guard/capability-guard.ts)；未注册 descriptor 的命令被内核拦截器 default-deny。
