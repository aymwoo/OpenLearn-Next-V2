/**
 * Bootstrap section 4/5 · V5.2 Worker 端 RESTful Router。
 *
 * 在隔离上下文里为插件提供 HTTP 风格的路由注册与匹配。纯逻辑（`compileRoutePattern`
 * 是纯函数），但同样受沙箱 import 限制而内联在此。
 */

export const HTTP_ROUTER_SECTION = `
// ── V5.2: Worker 端 RESTful Router ──
function compileRoutePattern(pattern) {
  var normalized = pattern.indexOf('/') === 0 ? pattern : '/' + pattern;
  var paramNames = [];
  var regexStr = normalized
    .replace(/:([a-zA-Z0-9_]+)/g, function(_m, p) {
      paramNames.push(p);
      return '([^/]+)';
    })
    .replace(/\\*/g, function() {
      paramNames.push('wildcard');
      return '(.*)';
    });
  return { regex: new RegExp('^' + regexStr + '$'), paramNames: paramNames };
}

function createPluginHttpRouter() {
  var routes = [];
  var routeFn = function(method, path, handler) {
    var upperMethod = method.toUpperCase();
    var normalized = path.indexOf('/') === 0 ? path : '/' + path;
    var compiled = compileRoutePattern(normalized);
    routes.push({
      method: upperMethod,
      pattern: normalized,
      regex: compiled.regex,
      paramNames: compiled.paramNames,
      handler: handler,
      isStream: false
    });
  };
  var routeStreamFn = function(method, path, handler) {
    var upperMethod = method.toUpperCase();
    var normalized = path.indexOf('/') === 0 ? path : '/' + path;
    var compiled = compileRoutePattern(normalized);
    routes.push({
      method: upperMethod,
      pattern: normalized,
      regex: compiled.regex,
      paramNames: compiled.paramNames,
      streamHandler: handler,
      isStream: true
    });
  };

  return {
    get: function(path, handler) { routeFn('GET', path, handler); },
    post: function(path, handler) { routeFn('POST', path, handler); },
    put: function(path, handler) { routeFn('PUT', path, handler); },
    patch: function(path, handler) { routeFn('PATCH', path, handler); },
    delete: function(path, handler) { routeFn('DELETE', path, handler); },
    route: routeFn,
    stream: function(methodOrPath, pathOrHandler, maybeHandler) {
      if (typeof pathOrHandler === 'function') {
        var path = methodOrPath;
        var handler = pathOrHandler;
        routeStreamFn('GET', path, handler);
        routeStreamFn('POST', path, handler);
      } else {
        var method = methodOrPath.toUpperCase();
        var path = pathOrHandler;
        var handler = maybeHandler;
        routeStreamFn(method, path, handler);
      }
    },
    match: function(method, path) {
      var upperMethod = method.toUpperCase();
      var normalized = path.indexOf('/') === 0 ? path : '/' + path;
      for (var i = 0; i < routes.length; i++) {
        var entry = routes[i];
        if (entry.method !== upperMethod) continue;
        var m = normalized.match(entry.regex);
        if (m) {
          var params = {};
          for (var j = 0; j < entry.paramNames.length; j++) {
            params[entry.paramNames[j]] = decodeURIComponent(m[j + 1] || '');
          }
          return {
            handler: entry.handler,
            streamHandler: entry.streamHandler,
            isStream: entry.isStream,
            params: params
          };
        }
      }
      return null;
    },
    handle: async function(req) {
      var matched = this.match(req.method, req.path);
      if (!matched) {
        return { status: 404, body: { error: 'Cannot ' + req.method + ' ' + req.path } };
      }
      if (matched.isStream) {
        return { status: 400, body: { error: req.path + ' is a streaming route, please use SSE or ctx.http.stream' } };
      }
      if (!matched.handler) {
        return { status: 404, body: { error: 'Cannot ' + req.method + ' ' + req.path } };
      }
      var requestWithParams = Object.assign({}, req, {
        params: Object.assign({}, req.params, matched.params)
      });
      var rawResult = await matched.handler(requestWithParams);
      if (rawResult !== null && typeof rawResult === 'object' && 'body' in rawResult && (typeof rawResult.status === 'number' || rawResult.status === undefined)) {
        return {
          status: rawResult.status !== undefined ? rawResult.status : 200,
          headers: rawResult.headers,
          body: rawResult.body
        };
      }
      return { status: 200, body: rawResult };
    },
    handleStream: async function(req, stream) {
      var matched = this.match(req.method, req.path);
      if (!matched || !matched.streamHandler) {
        stream.error(new Error('Cannot ' + req.method + ' ' + req.path + ' (Stream route not found)'));
        stream.end();
        return;
      }
      var requestWithParams = Object.assign({}, req, {
        params: Object.assign({}, req.params, matched.params)
      });
      try {
        await matched.streamHandler(requestWithParams, stream);
      } catch (err) {
        if (!stream.isClosed) {
          stream.error(err instanceof Error ? err : new Error(String(err)));
          stream.end();
        }
      }
    },
    getRegisteredRoutes: function() {
      return routes.map(function(r) {
        return { method: r.method, pattern: r.pattern, isStream: r.isStream };
      });
    },
    clear: function() {
      routes = [];
    }
  };
}
`;
