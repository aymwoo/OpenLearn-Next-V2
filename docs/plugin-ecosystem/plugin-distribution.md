# Plugin Distribution 插件打包与分发

OpenLearn V2 提供了基于 VFS 虚拟文件系统与 Zip 包的插件发布分发工作流。

---

## 插件构建与打包

开发者在插件工程目录下执行 CLI 构建指令：

```bash
npx @openlearn/plugin-sdk build
```

构建器将在根目录生成标准的 `.zip` 扩展包：
- `dist/index.js` (编译后的 ESM 代码)
- `manifest.json` (插件声明文件)
- `assets/` (相关静态资源)

---

## 插件加载与 VFS 存储

1. **ZIP 文件解压**: 运行在 `server.ts` 中的 Plugin Host 自动接收 `.zip` 插件上传包。
2. **VFS 存储**: 插件代码保存至平台 SQLite VFS / `storage/` 存储区。
3. **安全审计**: 校验 Manifest Schema 格式与敏感权限列表，通过后载入沙箱。
