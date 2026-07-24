# Contributing Guidelines 贡献指南

感谢关注并参与 OpenLearn V2 平台的建设！请在提交 Pull Request 前遵循以下代码标准与 Commit 约定。

---

## Commit 提交规范

项目采用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <short summary>
```

### Commit Types
- `feat`: 新功能或新领域扩展
- `fix`: Bug 修复
- `docs`: 文档变更与 Sphinx 同步
- `refactor`: 重构且不改变外部 API
- `test`: 增加或修正单元测试
- `tool`: CLI 与构建工具更新

### Scope 示例
- `kernel`, `plugin`, `whiteboard`, `di`, `ai`, `db`

示例：
```bash
git commit -m "feat(kernel): add 3-layer kernel initialization support"
git commit -m "docs(sphinx): refactor documentation structure and fix build warnings"
```
