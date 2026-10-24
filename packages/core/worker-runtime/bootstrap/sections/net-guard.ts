/**
 * Bootstrap section · 出网守卫（worker_threads 模式，Issue #237）。
 *
 * 子进程模式由 `plugin-net-preload.cjs`（`--require` 注入）完成同样的封锁；
 * 线程模式此前**没有任何**出网管控 —— 受信任插件在 worker 模式下可任意出网。
 * 本 section 在 bootstrap 内补齐同口径守卫：
 *
 * - 原始 socket / UDP / TLS / HTTP2 / DNS 一律拒绝（与 preload 逐项对齐）；
 * - `fetch` 仅放行「已批准域名」（workerData.approvedNetHosts，宿主已按
 *   插件出站授权计算），请求经 `ol-net-proxy` 消息交给宿主代发
 *   （复用 `plugin-net-proxy.ts` 的 DNS-rebinding / 内网地址 / 体积防护）；
 * - `http(s).request` 不做代理形态（preload 的 EventEmitter shim 过重），
 *   由 socket 层封锁兜底 —— 底层建连必然经过 net/tls，直接报
 *   ERR_ACCESS_DENIED。内置插件无 http.request 直连（已核实），出网走 fetch。
 *
 * ⚠️ 这段代码在模板字符串里，写注释时**不能出现反引号**。
 * 判别用 runtime-shim 已就绪的 `__wt`：子进程模式的封锁由 preload 负责，
 * 这里不重复 patch（保持子进程路径逐字节不变，降低回归面）。
 */
export const NET_GUARD_SECTION = `
if (__wt) {
  var __netAllowed = new Set(
    (Array.isArray(workerData.approvedNetHosts) ? workerData.approvedNetHosts : [])
      .map(function (h) { return String(h || '').trim().toLowerCase(); })
      .filter(Boolean),
  );

  function __netDenied(message) {
    var error = new Error(message);
    error.code = 'ERR_ACCESS_DENIED';
    return error;
  }

  function __netHostAllowed(hostname) {
    return __netAllowed.has(String(hostname || '').trim().toLowerCase());
  }

  // ── 宿主代发：与子进程 preload 同一条 ol-net-proxy 协议 ──
  function __netProxy(method, url, headers, body) {
    var id = Date.now() + '-' + Math.random().toString(16).slice(2);
    return new Promise(function (resolve, reject) {
      var onMessage = function (msg) {
        if (!msg || msg.type !== 'ol-net-proxy-result' || msg.id !== id) return;
        parentPort.off('message', onMessage);
        if (!msg.ok) {
          reject(__netDenied(msg.error || 'network proxy denied'));
          return;
        }
        resolve(msg);
      };
      parentPort.on('message', onMessage);
      try {
        var bodyBase64 = '';
        if (body) {
          bodyBase64 = Buffer.isBuffer(body) ? body.toString('base64') : Buffer.from(body).toString('base64');
        }
        parentPort.postMessage({
          type: 'ol-net-proxy',
          id: id,
          method: method,
          url: url,
          headers: headers || {},
          bodyBase64: bodyBase64,
        });
      } catch (error) {
        parentPort.off('message', onMessage);
        reject(error);
      }
    });
  }

  // ── 原始 socket / UDP / TLS / HTTP2 / DNS：一律拒绝 ──
  try {
    var __net = requireFn('node:net');
    function __blockConnect() {
      throw __netDenied('plugin outbound sockets are denied; use fetch/http for an approved host');
    }
    __net.Socket.prototype.connect = __blockConnect;
    __net.connect = __blockConnect;
    __net.createConnection = __blockConnect;
    if (__net.default) {
      __net.default.connect = __blockConnect;
      __net.default.createConnection = __blockConnect;
    }
  } catch (e) { /* node:net unavailable */ }

  try {
    var __dgram = requireFn('node:dgram');
    function __blockDgram() {
      throw __netDenied('plugin UDP sockets are denied');
    }
    __dgram.createSocket = __blockDgram;
    if (__dgram.Socket && __dgram.Socket.prototype) {
      __dgram.Socket.prototype.bind = __blockDgram;
      __dgram.Socket.prototype.connect = __blockDgram;
      __dgram.Socket.prototype.send = __blockDgram;
    }
  } catch (e) { /* node:dgram unavailable */ }

  try {
    var __tls = requireFn('node:tls');
    __tls.connect = __blockConnect;
  } catch (e) { /* node:tls unavailable */ }

  try {
    var __http2 = requireFn('node:http2');
    __http2.connect = __blockConnect;
  } catch (e) { /* node:http2 unavailable */ }

  try {
    var __dns = requireFn('node:dns');
    function __blockDns() {
      throw __netDenied('plugin DNS lookups are denied');
    }
    var __names = Object.getOwnPropertyNames(__dns);
    for (var __i = 0; __i < __names.length; __i++) {
      var __name = __names[__i];
      if (
        typeof __dns[__name] === 'function' &&
        (__name.indexOf('resolve') === 0 || __name.indexOf('lookup') === 0 || __name === 'reverse')
      ) {
        __dns[__name] = __blockDns;
      }
    }
    if (__dns.promises) {
      var __pnames = Object.getOwnPropertyNames(__dns.promises);
      for (var __j = 0; __j < __pnames.length; __j++) {
        var __pname = __pnames[__j];
        if (
          typeof __dns.promises[__pname] === 'function' &&
          (__pname.indexOf('resolve') === 0 || __pname.indexOf('lookup') === 0 || __pname === 'reverse')
        ) {
          __dns.promises[__pname] = function () { return Promise.reject(__netDenied('plugin DNS lookups are denied')); };
        }
      }
    }
    if (__dns.Resolver && __dns.Resolver.prototype) {
      var __rnames = Object.getOwnPropertyNames(__dns.Resolver.prototype);
      for (var __k = 0; __k < __rnames.length; __k++) {
        var __rname = __rnames[__k];
        if (
          typeof __dns.Resolver.prototype[__rname] === 'function' &&
          (__rname.indexOf('resolve') === 0 || __rname.indexOf('reverse') === 0 || __rname.indexOf('set') === 0)
        ) {
          __dns.Resolver.prototype[__rname] = __blockDns;
        }
      }
    }
  } catch (e) { /* node:dns unavailable */ }

  // ── fetch：仅放行已批准域名，经宿主代发 ──
  globalThis.fetch = async function pluginWorkerFetch(input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    var parsed = new URL(url);
    if (!__netHostAllowed(parsed.hostname)) {
      throw __netDenied('outbound host "' + parsed.hostname + '" is not approved');
    }
    var method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';
    var body = init && init.body;
    var bodyBuffer = null;
    if (body) {
      if (Buffer.isBuffer(body)) {
        bodyBuffer = body;
      } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        bodyBuffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
      } else if (typeof body === 'string') {
        bodyBuffer = Buffer.from(body, 'utf8');
      } else {
        bodyBuffer = Buffer.from(String(body), 'utf8');
      }
    }
    var headers = {};
    var rawHeaders = (init && init.headers) || (typeof input !== 'string' && input.headers);
    if (rawHeaders) {
      if (typeof rawHeaders.forEach === 'function') {
        rawHeaders.forEach(function (value, key) {
          headers[key] = value;
        });
      } else if (Array.isArray(rawHeaders)) {
        for (var h = 0; h < rawHeaders.length; h++) {
          headers[rawHeaders[h][0]] = rawHeaders[h][1];
        }
      } else if (typeof rawHeaders === 'object') {
        Object.assign(headers, rawHeaders);
      }
    }
    var result = await __netProxy(method, parsed.toString(), headers, bodyBuffer);
    var text = Buffer.from(result.bodyBase64 || '', 'base64').toString('utf8');
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: {
        get: function (name) {
          return result.headers ? result.headers[String(name).toLowerCase()] : undefined;
        },
      },
      text: async function () { return text; },
      json: async function () { return JSON.parse(text || 'null'); },
      arrayBuffer: async function () { return Buffer.from(result.bodyBase64 || '', 'base64'); },
    };
  };
}
`;
