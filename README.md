# KnowLink 知识星系

> Chrome Extension · Manifest V3 · 知识可视化

![Version](https://img.shields.io/badge/version-2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

本项目源于复习期间的一次"手残"：打开一堆 PDF 课件时总是不小心关掉浏览器，不得不反复翻找课件。其余功能则是在接触 AI 与 Obsidian 后的尝试与模仿。这是我的第一个开源项目，欢迎提出任何建议和问题。

## ✨ 功能特性

- **知识星系可视化**：将知识点渲染为节点，关联关系渲染为连线，自动聚类为知识簇
- **PDF 智能分析**：拖入 PDF 自动提取知识点、生成摘要、发现关联（云端 AI 可选）
- **语义去重**：TF-IDF + 余弦相似度，避免重复知识点入库
- **AI 分析**：跨知识库发现隐藏关联，一键应用
- **多视图**：侧边栏（Side Panel）+ 全屏星系（Network）+ PDF 阅读器
- **自定义 API**：支持任意 OpenAI 兼容的 API 端点

## 🚀 快速开始

### 安装（开发者模式）

1. 克隆仓库并进入目录：
   ```bash
   git clone <your-repo-url>
   cd knowlink-view
   ```
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `knowlink-view/` 目录
5. 点击工具栏的扩展图标，侧边栏即打开

### 配置 AI（可选）

云端 AI 功能（PDF 摘要、关联发现）需要 API Key：

```bash
# 复制配置模板
cp js/core/ai-config.example.js js/core/ai-config.js
```

编辑 `js/core/ai-config.js`：

```js
var DEFAULT_CONFIG = {
  provider: 'custom',     // 自定义 API
  apiKey: 'your-api-key-here',  // 👈 填入你的 API Key
  endpoint: 'https://api.example.com/v1/chat/completions',  // 👈 填入你的 API 端点
  model: 'your-model-name',     // 👈 填入模型名称
  enabled: true           // 填入 Key 后改为 true 启用
};
```

> ⚠️ `ai-config.js` 已加入 `.gitignore`，**切勿**提交你的 API Key。

不配置 AI 也能使用核心功能（本地 NLP 引擎负责关键词提取、去重、连线计算）。

## 📁 项目结构

```
knowlink-view/
├── manifest.json            Chrome Extension Manifest V3
├── background.js            Service Worker（数据层 + 标签页监听）
├── content.js               Content Script（页面注入）
├── sidepanel.html           侧边栏 UI
├── network.html             全屏星系 UI
├── pdf-viewer.html          PDF 阅读器 UI
├── js/
│   ├── core/                引擎 / 数据层（无 UI 依赖）
│   │   ├── nlp-engine.js    统一 NLP 引擎（TF-IDF / TextRank / 余弦相似度）
│   │   ├── cloud-adapter.js 云端 API 适配器（Map-Reduce 摘要 / 重试退避）
│   │   ├── ai-store.js      AI 结果持久化
│   │   ├── ai-edges.js      AI 连线 CRUD
│   │   ├── ai-dedup.js      语义去重（委托 nlp-engine）
│   │   ├── ai-worker.js     Web Worker（委托 nlp-engine）
│   │   ├── ai-wormhole.js   AI 分析编排器（PDF 分析 / 关联发现）
│   │   ├── ai-config.js     AI 配置（gitignore，不入库）
│   │   ├── kb-store.js      统一知识库数据层（唯一数据源）
│   │   ├── knowlink-layout.js 图计算与布局引擎
│   │   ├── knowlink-renderer.js Canvas 2D 渲染管线
│   │   ├── knowlink-engine.js KnowLinkAI API 瘦 facade
│   │   ├── i18n.js          国际化
│   │   └── utils.js         共享工具
│   └── views/               视图逻辑
│       ├── sidepanel.js     侧边栏逻辑
│       ├── network.js       全屏星系逻辑
│       └── pdf-viewer.js    PDF 阅读器逻辑
└── lib/                     第三方库（PDF.js）
```

详细的架构说明（模块依赖图、架构演进）见 [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)。

## 🧠 架构设计

- **分层清晰**：`js/core` 无 UI 依赖，`js/views` 只做视图逻辑
- **唯一数据源**：所有 `chrome.storage` 访问统一收敛到 `kb-store.js`
- **NLP 统一**：TF-IDF / TextRank / 去重全部委托 `nlp-engine.js`，消除重复实现
- **AI 编排**：`ai-wormhole.js` 编排 PDF 分析流程，`cloud-adapter.js` 负责 API 调用

## 🛠️ 开发

### 环境要求

- Chrome / Edge（支持 Manifest V3 + Side Panel API）
- 无需构建工具，纯原生 JS

### 开发流程

1. 修改代码后，在 `chrome://extensions/` 点击扩展的 **刷新** 按钮
2. 打开 DevTools 查看 `[KnowLink BG]` / `[KnowLink]` 前缀日志
3. 新增 JS 文件时，记得同步更新 `manifest.json` 的 `web_accessible_resources`

### 代码规范

- 原生 ES5/ES6 语法（无框架、无构建步骤）
- 全局命名空间：`self.KBStore` / `window.AIWormhole` / `window.NLP` / `window.AIConfig`
- 日志前缀：`[KnowLink BG]`（后台）/ `[KnowLink]`（视图）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请先阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 📄 License

[MIT](./LICENSE)