/**
 * 子进程出站网络默认拒绝。
 *
 * Node 22/24 的权限模型没有 --allow-net，所以在进程入口包一层：
 * 原始 socket / UDP / DNS 一律拒绝；fetch 与 http(s).request 只把「已批准域名」
 * 交给宿主代发。允许名单在本文件加载时从环境变量拍下来，随后删掉，
 * 插件代码改环境变量不能把自己加进名单。
 */
'use strict';

const EventEmitter = require('node:events');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

const ALLOW_ENV = 'OPENLEARN_PLUGIN_NET_ALLOW';
const allowed = new Set(
  String(process.env[ALLOW_ENV] || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
delete process.env[ALLOW_ENV];

function denied(message) {
  const error = new Error(message);
  error.code = 'ERR_ACCESS_DENIED';
  return error;
}

function hostAllowed(hostname) {
  return allowed.has(
    String(hostname || '')
      .trim()
      .toLowerCase(),
  );
}

function proxy(method, url, headers, body) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (!msg || msg.type !== 'ol-net-proxy-result' || msg.id !== id) return;
      process.off('message', onMessage);
      if (!msg.ok) {
        reject(denied(msg.error || 'network proxy denied'));
        return;
      }
      resolve(msg);
    };
    process.on('message', onMessage);
    try {
      let bodyBase64 = '';
      if (body) {
        bodyBase64 = Buffer.isBuffer(body) ? body.toString('base64') : Buffer.from(body).toString('base64');
      }
      process.send({
        type: 'ol-net-proxy',
        id,
        method,
        url,
        headers: headers || {},
        bodyBase64,
      });
    } catch (error) {
      process.off('message', onMessage);
      reject(error);
    }
  });
}

function blockConnect() {
  throw denied('plugin outbound sockets are denied; use fetch/http for an approved host');
}

net.Socket.prototype.connect = blockConnect;
net.connect = blockConnect;
net.createConnection = blockConnect;
if (net.default) {
  net.default.connect = blockConnect;
  net.default.createConnection = blockConnect;
}

// 拦截 UDP (dgram)
try {
  const dgram = require('node:dgram');
  function blockDgram() {
    throw denied('plugin UDP sockets are denied');
  }
  dgram.createSocket = blockDgram;
  if (dgram.Socket && dgram.Socket.prototype) {
    dgram.Socket.prototype.bind = blockDgram;
    dgram.Socket.prototype.connect = blockDgram;
    dgram.Socket.prototype.send = blockDgram;
  }
} catch {
  /* node:dgram unavailable */
}

// 拦截 TLS 与 HTTP2 底层连接
try {
  const tls = require('node:tls');
  tls.connect = blockConnect;
} catch {}

try {
  const http2 = require('node:http2');
  http2.connect = blockConnect;
} catch {}

// 拦截 DNS 全方法与 Resolver 原型
function blockDns() {
  throw denied('plugin DNS lookups are denied');
}

for (const name of Object.getOwnPropertyNames(dns)) {
  if (
    typeof dns[name] === 'function' &&
    (name.startsWith('resolve') || name.startsWith('lookup') || name === 'reverse')
  ) {
    dns[name] = blockDns;
  }
}

if (dns.promises) {
  for (const name of Object.getOwnPropertyNames(dns.promises)) {
    if (
      typeof dns.promises[name] === 'function' &&
      (name.startsWith('resolve') || name.startsWith('lookup') || name === 'reverse')
    ) {
      dns.promises[name] = async () => blockDns();
    }
  }
}

if (dns.Resolver && dns.Resolver.prototype) {
  for (const name of Object.getOwnPropertyNames(dns.Resolver.prototype)) {
    if (
      typeof dns.Resolver.prototype[name] === 'function' &&
      (name.startsWith('resolve') || name.startsWith('reverse') || name.startsWith('set'))
    ) {
      dns.Resolver.prototype[name] = blockDns;
    }
  }
}

globalThis.fetch = async function pluginFetch(input, init) {
  const url = typeof input === 'string' ? input : input && input.url;
  const parsed = new URL(url);
  if (!hostAllowed(parsed.hostname)) {
    throw denied(`outbound host "${parsed.hostname}" is not approved`);
  }
  const method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';
  let body = init && init.body;
  let bodyBuffer = null;
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

  const headers = {};
  const rawHeaders = (init && init.headers) || (typeof input !== 'string' && input.headers);
  if (rawHeaders) {
    if (typeof rawHeaders.forEach === 'function') {
      rawHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key] = value;
      }
    } else if (typeof rawHeaders === 'object') {
      Object.assign(headers, rawHeaders);
    }
  }

  const result = await proxy(method, parsed.toString(), headers, bodyBuffer);
  const text = Buffer.from(result.bodyBase64 || '', 'base64').toString('utf8');
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    headers: { get: (name) => result.headers?.[String(name).toLowerCase()] },
    text: async () => text,
    json: async () => JSON.parse(text || 'null'),
    arrayBuffer: async () => Buffer.from(result.bodyBase64 || '', 'base64'),
  };
};

function proxiedRequest(protocol) {
  return function pluginHttpRequest(urlOrOptions, options, callback) {
    let url;
    let opts = options;
    let cb = callback;
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
      url = new URL(urlOrOptions);
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
    } else {
      opts = urlOrOptions || {};
      if (typeof options === 'function') cb = options;
      const host = opts.hostname || opts.host;
      url = new URL(`${protocol}//${host}${opts.path || '/'}`);
    }
    if (!hostAllowed(url.hostname)) {
      throw denied(`outbound host "${url.hostname}" is not approved`);
    }

    const chunks = [];
    const request = new EventEmitter();
    request.setHeader = () => request;
    request.write = (chunk) => {
      chunks.push(Buffer.from(chunk));
      return true;
    };
    request.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      proxy(opts.method || 'GET', url.toString(), opts.headers, body)
        .then((result) => {
          const response = new EventEmitter();
          response.statusCode = result.status;
          response.headers = result.headers || {};
          if (typeof cb === 'function') cb(response);
          request.emit('response', response);
          process.nextTick(() => {
            response.emit('data', Buffer.from(result.bodyBase64 || '', 'base64'));
            response.emit('end');
          });
        })
        .catch((error) => {
          request.emit('error', error);
        });
      return request;
    };
    request.abort = () => {};
    request.destroy = () => {};

    return request;
  };
}

http.request = proxiedRequest('http:');
http.get = function pluginHttpGet(url, options, callback) {
  const request = http.request(url, options, callback);
  request.end();
  return request;
};
https.request = proxiedRequest('https:');
https.get = function pluginHttpsGet(url, options, callback) {
  const request = https.request(url, options, callback);
  request.end();
  return request;
};
