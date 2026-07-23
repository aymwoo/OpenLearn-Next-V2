# OpenLearn Lesson Lifecycle Specification (课程会话生命周期规范)

## 1. Executive Summary (概述)

本文档详细说明了 `LessonSession` 在 Platform Kernel 托管下的状态含义与流转规则。

---

## 2. State Definitions (状态定义)

- **`Created`**: 初始创建，上下文准备中。
- **`Preparing`**: 资源预热与教学素材加载中。
- **`Running`**: 课堂正在授课进行中。
- **`Paused`**: 课堂处于暂停或临时中断状态。
- **`Resuming`**: 从暂停恢复为授课状态。
- **`Completed`**: 课程顺利下课结课。
- **`Archived`**: 会话归档存盘。
- **`Disposed`**: 运行时会话实例已被注销清理。
