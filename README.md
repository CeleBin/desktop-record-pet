<p align="center">
  <img src="src/assets/dog_logo.png" alt="Desktop Record Pet" width="180" />
</p>

<h1 align="center">Desktop Record Pet</h1>

<p align="center">
  一个本地优先的桌面记录与学习助手，把文字、截图、文件和待办收进同一个可回看的工作记忆里。
</p>

<p align="center">
  <a href="#功能特性">功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#隐私与数据">隐私与数据</a> ·
  <a href="#参与贡献">参与贡献</a>
</p>

![Tauri](https://img.shields.io/badge/Tauri-2.x-FFC131)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)
![Rust](https://img.shields.io/badge/Rust-edition%202021-DEA584)
![Vite](https://img.shields.io/badge/Vite-7-646CFF)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4)

> 一只常驻桌面的宠物，帮你在信息出现的瞬间把它记录下来，再交给 AI 整理成任务、摘要和可复习的知识。

Desktop Record Pet 把「记录」这件事做得尽可能轻：一只透明置顶的小宠物常驻桌面，配合全局快捷键，随时唤起快速输入或区域截图，把文字、图片、文件统一收进本地 SQLite。记录可以一键转为待办，待办支持分类、优先级、截止日期、重复规则和拖拽排序。接入 Anthropic、OpenAI-compatible 或其他兼容服务后，还能让 AI 为记录生成摘要、标签、行动建议，并围绕知识点进行学习对话。

项目的核心不是“再做一个笔记应用”，而是连接三个瞬间：

**捕获**：降低记录文字、截图和文件的阻力。  
**行动**：把值得处理的记录转成带截止日期和提醒的任务。  
**理解**：让 AI 基于已有记录生成摘要、知识点和复习线索。

除 AI 请求外，记录、附件、任务和知识记忆都留在本地机器上，不依赖云端账户或服务端数据库。

---

## 功能特性

### 桌面宠物

透明置顶常驻桌面、不占任务栏的小家伙。拥有待机动画（眨眼、左顾右盼）与光晕投影，可以随意拖拽到屏幕任意位置，重启后自动恢复。左键打开主面板，右键唤出快捷菜单。

### 快捷记录

通过全局快捷键随时唤起一个极简输入框，随手记下一笔文字。除文本外，还支持多种来源的记录捕获：内置区域截图、拖拽文件、剪贴板粘贴图片、文件选择器。每条记录可归类为笔记、任务、经验、问题或文件笔记，并可一键转为待办。

### 截图捕获

全局快捷键进入全屏区域选择，框选屏幕任意区域截图。截图完成后可补充文字说明，自动保存为带图片附件的记录。附件以文件哈希去重，避免重复存储。

### 记录管理

主面板提供全部记录的浏览、过滤与搜索。可按类型、状态或关键词筛选，查看记录详情时会聚合展示其附件、关联任务与 AI 分析结果。支持编辑、归档与删除。

### 待办管理

一个桌面常驻的浮层式待办列表，随时可见。任务有四种状态（待办 / 进行中 / 完成 / 取消）和三级优先级，可设置截止日期、提醒（宠物气泡或系统通知两种渠道）以及重复规则（每天 / 工作日 / 每周指定星期）。支持拖拽排序与分类夹管理，分类夹本身也可重排。

### AI 增强

在设置中配置 AI Provider 和 API key 后，可对任意记录发起分析。请求会携带记录文本与首张图片（视觉输入），返回结构化的摘要、标签、建议任务、研究洞察与敏感度标记，并存回记录详情。学习教练会把知识点、证据和掌握状态关联起来，支持基于原始记录继续追问。

### 全局快捷键与设置

快速捕获和截图快捷键设计为可在设置面板中自定义，修改时会进行冲突检测并即时生效。设置面板同时管理 AI Provider、模型、API 地址和 API key 等配置项，支持一键重置。

---

## 隐私与数据

- 记录、任务、标签、知识记忆和附件保存在本地 SQLite 与附件目录中。
- 默认不需要登录，也没有内置云端同步或遥测服务。
- 只有在主动使用 AI 功能时，相关记录内容和图片才会发送到你配置的 AI 服务。
- API key 不会通过设置列表直接返回到前端；使用自定义 Provider 时，请确认对应服务的隐私政策和数据保留规则。

## 当前状态

项目目前处于早期开发阶段（`v0.1.0`），主要在 Windows 上开发和验证。核心记录、附件、任务、桌面宠物、AI 分析和知识记忆功能已具备，但仍可能发生数据模型、交互和跨平台行为变化。

当前优先级是打磨 Windows 使用体验、完善安装与备份流程，并逐步开放更多 Provider 和导入导出能力。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端框架 | React 19 + TypeScript 5.8 |
| 构建工具 | Vite 7 |
| 样式 | Tailwind CSS v4 |
| 状态管理 | Zustand |
| 拖拽交互 | dnd-kit |
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust（edition 2021） |
| 本地存储 | rusqlite（SQLite，bundled） |
| 截图 | xcap |
| HTTP / AI | reqwest（调用 Anthropic Claude API） |
| 图像处理 | image crate |
| 异步运行时 | tokio |

---

## 架构设计

### 多窗口架构

应用由 6 个独立窗口组成，通过 URL 参数 `?window=` 路由到各自的前端入口，各自拥有独立的生命周期与可见性控制：

| 窗口 | 职责 | 特性 |
| --- | --- | --- |
| `pet` | 桌面宠物本体 | 透明、置顶、跳过任务栏 |
| `quick-input` | 快速文本输入 | 置顶、按需唤出 |
| `screenshot-overlay` | 全屏区域截图 | 全屏透明覆盖层 |
| `supplement-box` | 截图后补充说明 | 置顶、按需唤出 |
| `main-panel` | 记录管理主界面 | 默认隐藏，点击宠物打开 |
| `todo-overlay` | 待办浮层 | 透明置顶、可缩放 |

### 全链路数据流

一个功能从用户操作到落库，典型路径为：

```
用户操作 → React 组件 → Zustand store → lib/tauri.ts 封装
       → Tauri 命令(commands.rs) → db.rs(SQL) → SQLite
       ← data-changed 事件广播 ← 命令返回 ← store 更新 ← 组件重渲染
```

写操作完成后，后端通过 `data-changed` 事件广播变更，各窗口的 store 监听后自行刷新，保证多窗口间状态一致。

### 目录结构

```
desktop-record-pet/
├── src/                       # 前端
│   ├── assets/                # 品牌图标与前端静态资源
│   ├── components/
│   │   ├── capture/           # 快速输入、截图覆盖层、补充框
│   │   ├── panel/             # 主面板、记录列表、记录详情
│   │   ├── pet/               # 桌面宠物本体与右键菜单
│   │   ├── settings/          # 设置面板
│   │   └── todo/              # 待办浮层、分类、拖拽排序
│   ├── store/                 # Zustand 状态（records/tasks/settings/...）
│   ├── lib/tauri.ts           # Tauri 命令前端封装
│   ├── types/                 # TypeScript 类型定义
│   └── App.tsx                # 多窗口路由入口
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── commands.rs        # Tauri 命令层（校验 + 广播）
│   │   ├── db.rs              # SQLite 持久化（纯 SQL）
│   │   ├── screenshot.rs      # 截图与文件哈希
│   │   ├── windows.rs         # 窗口生命周期 / 可见性
│   │   └── models.rs          # 数据模型与序列化
│   ├── capabilities/          # Tauri 权限配置
│   ├── icons/                 # 应用图标
│   └── tauri.conf.json        # Tauri 构建与窗口配置
├── docs/                      # 开发笔记与学习记录
└── package.json
```

---

## 快速开始

### 环境要求

- Node.js（建议 18+）
- Rust 工具链（stable，含 cargo）
- 系统依赖参见 [Tauri 2 前置要求](https://v2.tauri.app/start/prerequisites/)
- 主要在 Windows 上开发与测试

### 开发运行

```bash
# 安装前端依赖
npm install

# 启动开发模式（同时拉起 Vite 与 Tauri 窗口）
npm run tauri dev
```

### 构建打包

```bash
# 类型检查 + 前端构建 + Rust 编译，输出安装包
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

### 验证命令

日常开发中可用于检查两端的命令：

```bash
# 前端类型检查与构建
npm run build

# Rust 编译检查
cargo check --manifest-path src-tauri/Cargo.toml

# 运行前端测试
npm test -- --run

# 运行 Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 开发笔记

这个项目同时也是一次「边做边学」的 Tauri 全栈实践。`docs/` 目录下记录了每个功能 case 的开发过程与复盘，包含架构思考、踩过的坑和暴露出的知识缺口：

- `docs/cases/` — 各功能 case 的实现记录
- `docs/learning/` — 对应的学习复盘与成长日志
- `docs/superpowers/` — 设计方案与计划文档

这些笔记体现了项目演进过程中的架构决策，例如「全链路 Tauri feature 模式」（DB 列 → Rust 命令 → TS 类型 → Tauri 封装 → Zustand store → React 组件）如何在多个功能中反复出现并逐步被识别为一个可复用的心智模型。

## 参与贡献

欢迎通过 Issue 分享使用反馈、复现步骤和功能建议，也欢迎提交 Pull Request。对于较大的改动，建议先创建 Issue 讨论目标和实现范围。

比较适合社区参与的方向包括：

- macOS / Linux 适配与桌面窗口行为修复
- Ollama、OpenAI-compatible 等本地或第三方 Provider 适配
- 数据导入、导出、备份与迁移工具
- 宠物动画、主题和无障碍体验
- 截图、快捷键、附件存储等边界场景的测试

---

## 许可

本项目基于 [MIT 许可证](LICENSE) 开源，版权所有 © 2026 Bin Chen。

本项目处于早期开发阶段（v0.1.0）。如需提交问题或建议，请在仓库的 Issues 中反馈。
