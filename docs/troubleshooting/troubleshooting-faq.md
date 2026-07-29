# Troubleshooting & FAQ 故障排查

针对端口占用、SQLite 写锁死、Worker 进程启动失败与插件 Manifest 格式错误提供常见排查方法。

## iframe 课件报错 `SyntaxError: Failed to execute 'postMessage' on 'Window': Invalid target origin 'null'`

**Q: iframe 课件报错 `SyntaxError: Failed to execute 'postMessage' on 'Window': Invalid target origin 'null'`**

**A:** This is automatically handled by the platform's Bridge SDK which uses `Object.defineProperty + Proxy` to intercept and normalize invalid targetOrigin. If you still see this error, ensure bridge.js is loaded. The platform injects it automatically for `/runtime/` served courseware.
