# KnowLink 知识星系 — 项目结构

> Chrome Extension Manifest V3 · 知识可视化 · 星系隐喻  
> 最后更新：2026-08-20

---

## 目录树

```
knowlink-view/
│
├── 📄 入口 / 配置
│   ├── manifest.json                48 行   Chrome Extension Manifest V3
│   ├── background.js          🔧    925 行   Service Worker
│   ├── content.js                   490 行   Content Script（页面注入）
│   ├── sidepanel.html              1359 行   侧边栏 UI（inline CSS）
│   ├── network.html                 867 行   全屏星系 UI（inline CSS + 虫洞抽屉）
│   └── pdf-viewer.html              367 行   PDF 阅读器 UI
│
├── 🧠 js/core — 引擎 / 数据层（无 UI 依赖）
│   │
│   ├── 🧠 AI 引擎层
│   │   ├── nlp-engine.js      🆕   389 行   统一 NLP 引擎
│   │   │                                        · TF-IDF 关键词提取
│   │   │                                        · TextRank 摘要生成
│   │   │                                        · 余弦相似度 / 标题重叠
│   │   │                                        · 语义去重辅助
│   │   │                                        · Chinese 2-4 gram 分词
│   │   ├── cloud-adapter.js   🆕   343 行   云端 API 适配器
│   │   │                                        · Map-Reduce 长文摘要
│   │   │                                        · 自动重试 + 指数退避
│   │   │                                        · Token 估算
│   │   │                                        · JSON 结构化解析
│   │   ├── ai-store.js        🆕   194 行   AI 结果持久化存储
│   │   │                                        · 3 个 storage key 管理
│   │   │                                        · 自动裁剪（上限 20 条）
│   │   │                                        · 跨视图广播
│   │   ├── ai-edges.js        🆕   125 行   AI 连线 CRUD
│   │   │                                        · 双向去重添加
│   │   │                                        · 孤边清理
│   │   │                                        · 稳定 ID 映射
│   │   ├── ai-dedup.js              76 行   语义去重 → 委托给 nlp-engine
│   │   ├── ai-worker.js            272 行   Web Worker → 委托给 nlp-engine
│   │   ├── ai-wormhole.js     🔧   609 行   虫洞编排器（原 1309 行 God 模块）
│   │   │                                        · PDF 分析流程
│   │   │                                        · 关联发现 / 对比分析
│   │   │                                        · Worker 管理（降级回退）
│   │   │                                        · 公共 API 27 方法未变
│   │   └── ai-config.js             47 行   AI API 配置（provider, key, model）
│   │   └── ai-config.example.js     47 行   配置模板（提交到 git 的脱敏版本）
│   │
│   ├── 💾 数据层
│   │   └── kb-store.js        🆕   426 行   统一知识库数据层（唯一数据源）
│   │                                           · KB CRUD（增删改查切换）
│   │                                           · Point CRUD（知识点 + 精确去重）
│   │                                           · 容量限制（默认 200 条）
│   │                                           · 旧版数据迁移
│   │                                           · 变更广播（KB_STORE_CHANGED）
│   │                                           · 消费方：background / sidepanel / network
│   │
│   ├── 🌌 星系可视化引擎
│   │   ├── galaxy-layout.js   🆕   694 行   图计算与布局引擎
│   │   │                                        · buildGalaxyGraph     图构建
│   │   │                                        · detectGalaxies       BFS 星系检测
│   │   │                                        · computeGalaxyLayout  螺旋臂布局
│   │   │                                        · runGalaxyForceSim    力导向模拟
│   │   │                                        · addNodesToGraph      增量添加
│   │   │                                        · relaxNewNodes        增量力松弛
│   │   │                                        · findNodeAt           点击检测
│   │   │                                        · computeStrength      边强度计算
│   │   ├── galaxy-renderer.js 🆕   615 行   Canvas 2D 渲染管线
│   │   │                                        · renderStarfield      深空星场
│   │   │                                        · renderNebulae        星系星云
│   │   │                                        · renderGalaxyDust     中心微尘
│   │   │                                        · renderOrbitRings     行星轨道
│   │   │                                        · renderGalaxyEdges    连线渲染
│   │   │                                        · renderGalaxyNodes    恒星节点
│   │   │                                        · renderEntryAnimations 超新星/虫洞动画
│   │   │                                        · renderGalaxy          主渲染入口
│   │   └── galaxy-engine.js   🔧   278 行   KnowLinkAI API 瘦 facade（原 1575 行）
│   │                                           · AI 连线增删
│   │                                           · 密度控制（阈值/上限）
│   │                                           · 与 AIWormhole 持久化同步
│   │
│   └── 🔗 共享工具
│       └── utils.js                 143 行   共享工具
│                                             · SOURCE_COLORS 颜色光谱
│                                             · assignSourceColors 来源着色
│                                             · escapeHtml / resolveRealUrl / navigateToSource
│
├── 🖥️ js/views — 视图逻辑
│   ├── sidepanel.js           🔧   1577 行   侧边栏逻辑
│   │                                        · 知识库选择器 / CRUD
│   │                                        · 知识点卡片渲染
│   │                                        · PDF 拖放 → AI 分析 → 去重 → 入库
│   │                                        · 变化报告确认
│   │                                        · 搜索 / 导出 / 导入
│   ├── network.js             🔧    924 行   全屏星系逻辑
│   │                                        · Canvas 交互（拖拽/缩放/hover）
│   │                                        · 增量刷新
│   │                                        · 虫洞抽屉（阈值/建议/应用）
│   │                                        · 导入 / 连线管理
│   └── pdf-viewer.js                362 行   PDF 阅读器逻辑（PDF.js 渲染）
│
└── 📦 第三方库
    └── lib/
        ├── pdf.min.js              ~320 KB   PDF.js v3
        └── pdf.worker.min.js      ~1.1 MB   PDF.js Worker
```

---

## 架构演进

```
重构前                                    重构后
────────                                  ────────

ai-wormhole.js 1309 行 God 模块         → ai-wormhole.js     609 行  编排器
  混合：API调用 + 存储 + 连线 + NLP        cloud-adapter.js    343 行  🆕
                                          ai-store.js         194 行  🆕
                                          ai-edges.js         125 行  🆕

3 处 NLP 实现重复                       → nlp-engine.js       389 行  🆕
  ai-worker.js + ai-wormhole.js            ai-worker.js        272 行  委托
  + ai-dedup.js 各自实现                   ai-dedup.js          76 行  委托

15+ 处 chrome.storage 直接访问          → kb-store.js         426 行  🆕
  background / sidepanel / network

galaxy-engine.js 1575 行 混合           → galaxy-layout.js    694 行  🆕
  图计算 + Canvas 渲染紧耦合               galaxy-renderer.js  615 行  🆕
                                          galaxy-engine.js    278 行  瘦 facade

❌ wormhole-ui.js 评估后跳过
   侧边栏虫洞（工作流）与全屏虫洞（抽屉）功能不同，非真正重复
```

---

## 模块依赖图

```
                    ┌─────────────┐
                    │  utils.js   │  SOURCE_COLORS, assignSourceColors, escapeHtml
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────────┐
          │                │                    │
          ▼                ▼                    ▼
   ┌──────────────┐ ┌──────────────┐   ┌────────────────┐
   │ nlp-engine.js│ │galaxy-layout │   │   kb-store.js  │
   │  self.NLP    │ │  .js         │   │  self.KBStore   │
   │              │ │ graphNodes[] │   │                │
   │ TF-IDF       │ │ graphEdges[] │   │ KBS / Points   │
   │ TextRank     │ │ galaxies[]   │   │ CRUD + 广播    │
   │ cosineSim    │ │ forceSim     │   │ 旧数据迁移      │
   └───┬───┬──────┘ └──────┬───────┘   └──────┬─────────┘
       │   │               │                  │
       ▼   ▼               ▼                  │
   ┌──────┐┌────────┐┌──────────────┐         │
   │ai-   ││ai-dedup││galaxy-       │         │
   │worker││.js     ││renderer.js   │         │
   │.js   ││        ││              │         │
   │      ││语义去重 ││ Canvas 2D    │         │
   └──┬───┘└────────┘│ 渲染管线     │         │
      │               └──────┬───────┘         │
      │                      │                 │
      ▼                      ▼                 │
   ┌──────────────────────────────────┐        │
   │         ai-wormhole.js           │        │
   │  window.AIWormhole  编排器       │        │
   │  · summarizePDF                  │        │
   │  · findConnections               │        │
   │  · compareWithKB                 │        │
   │  · dedupCheck                    │        │
   └────────────────┬─────────────────┘        │
                    │                          │
          ┌─────────┼─────────┐                │
          │         │         │                │
          ▼         ▼         ▼                │
   ┌──────────┐┌────────┐┌──────────┐          │
   │cloud-    ││ai-store││ai-edges  │          │
   │adapter.js││.js     ││.js       │          │
   │          ││        ││          │          │
   │API调用   ││持久化  ││连线CRUD  │          │
   │MapReduce ││3 keys  ││双向去重  │          │
   └──────────┘└────────┘└──────────┘          │
                                               │
   ┌───────────────────────────────────────────┘
   │
   ▼
   ┌──────────────────────────────────────────────────┐
   │              视图 / 后台                          │
   │                                                  │
   │  background.js ←→ sidepanel.js ←→ network.js     │
   │  Service Worker   侧边栏          全屏星系         │
   │                                                  │
   │  统一通过 self.KBStore / window.AIWormhole       │
   │  访问数据层和 AI 引擎                             │
   └──────────────────────────────────────────────────┘
```

---

## 加载顺序

### sidepanel.html
```
js/core/utils.js → lib/pdf.min.js → js/core/nlp-engine.js → js/core/cloud-adapter.js
→ js/core/ai-store.js → js/core/ai-edges.js → js/core/kb-store.js → js/core/ai-dedup.js
→ js/core/ai-config.js → js/core/ai-wormhole.js → js/views/sidepanel.js
```

### network.html
```
js/core/utils.js → lib/pdf.min.js → js/core/nlp-engine.js → js/core/cloud-adapter.js
→ js/core/ai-store.js → js/core/ai-edges.js → js/core/kb-store.js
→ js/core/galaxy-layout.js → js/core/galaxy-renderer.js → js/core/galaxy-engine.js
→ js/core/ai-config.js → js/core/ai-wormhole.js → js/views/network.js
```

### background.js (Service Worker)
```
importScripts('js/core/nlp-engine.js')
importScripts('js/core/ai-dedup.js')
importScripts('js/core/kb-store.js')
```

### ai-worker.js (Web Worker)
```
importScripts('nlp-engine.js')   // 同目录 js/core/
```

---

## 全局命名空间

| 命名空间 | 模块 | 可用上下文 |
|----------|------|-----------|
| `self.NLP` | nlp-engine.js | Page · Worker · Service Worker |
| `self.KBStore` | kb-store.js | Page · Service Worker |
| `window.AIWormhole` | ai-wormhole.js | Page only |
| `window.CloudAdapter` | cloud-adapter.js | Page only |
| `window.AIStore` | ai-store.js | Page only |
| `window.AIEdges` | ai-edges.js | Page only |
| `window.KnowLinkAI` | galaxy-engine.js | Page only |

---

## 关键数据流

```
用户选中文本 → content.js → NEW_KNOWLEDGE 消息
                                  │
                                  ▼
                          background.js
                          semanticDedup → KBStore.addPoint()
                                  │
                          _persist() → KB_STORE_CHANGED 广播
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              sidepanel.js   network.js    content.js
              loadData()     incremental   refreshKBName()
                             Refresh()

PDF 拖放 → ai-wormhole.js → nlp-engine (本地) 或 cloud-adapter (云端)
                │
                ▼
         知识点 + 连线 → addKnowledgePointsToBase() → KBStore
```
