// ====================================================================
//  KnowLink 知识星系 — i18n 国际化模块 (i18n.js)
//  中英文双语支持：词典 + 翻译函数 + DOM 扫描 + 语言持久化
//  用法：
//    <script src="js/core/i18n.js"></script>  （在 utils.js 之后加载）
//    HTML: <div data-i18n="key">默认文本</div>
//    JS:   I18n.t('key')  /  I18n.t('key', {name: 'xxx'})
//    JS:   I18n.setLocale('en') 切换语言（持久化到 chrome.storage）
// ====================================================================

(function () {
  'use strict';

  // ==================== 词典 ====================
  var DICT = {
    'zh-CN': {
      // ---- 通用 ----
      'app.name': 'KnowLink 知识星系',
      'app.name.short': 'KnowLink 知识库',
      'loading': '加载中...',
      'refresh': '刷新',
      'export': '导出',
      'import': '导入',
      'export.json': '导出 JSON',
      'import.json': '导入 JSON',
      'search.placeholder': '输入关键词过滤...',
      'search.stars': '搜索知识点...',
      'search.points': '🔍 搜索知识点',
      'settings': '搜索 / 导入导出',
      'delete': '删除',
      'rename': '重命名',
      'new.kb': '新建知识库',
      'switch.kb': '切换知识库',
      'fullscreen': '在新标签页中打开全屏知识星系',
      'empty.kb': '知识库中还没有知识点，选中网页文字即可收集。',
      'empty.kb.detail': '知识库「{name}」中还没有知识点',
      'empty.kb.hint': '选中网页文字后点击浮动按钮收集',
      'empty.search': '🔍 未找到匹配的知识点',
      'clear.kb': '🗑️ 清空当前知识库',
      'clear.kb.named': '🗑️ 清空「{name}」',
      'status.void': '空',
      'status.count': '📂 {name} · ✅ {count} / {max}',
      'recent.pdfs': '📂 今天打开过的 PDF',
      'recent.pdfs.today': '📅 今天打开过的 PDF',
      'recent.pdfs.empty': '今天还没有打开过 PDF',
      'recent.pdfs.loading': '加载中...',
      'recent.pdfs.unavailable': '扩展环境不可用',
      'recent.pdfs.fetch.fail': '无法获取',
      'click.trace': '（点击追溯）',
      'delete.point': '删除此知识点',
      'trace.source': '🔗 追溯来源',
      'open.external': '🔗 外部打开',
      'copy.path': '📋 复制路径',
      'copy.url': '复制文件路径',
      'recent.pdfs.btn': '📂 最近 PDF ▾',
      'view.pdf.native': '通过 Chrome 原生 PDF 阅读器查看文档',
      'view.pdf.hint': '从知识星系侧边栏点击知识点即可跳转到对应页面',
      'pdf.load.fail': '无法加载 PDF 文件',
      'pdf.load.fail.hint': '请尝试在浏览器中直接打开该文件，或检查文件路径是否正确。<br>本地文件需要启用「允许访问文件 URL」权限。',
      'retry': '🔄 重试',
      'unknown.file': '未知文件',
      'pdf.title.suffix': 'KnowLink PDF 查看器',
      'pdf.load.error': '文件加载失败，请检查路径是否正确。',
      'pdf.local.doc': '本地 PDF 文档',
      'pdf.local.no.jump': '该知识点来自本地 PDF，无法自动跳转。\n\n💡 请直接打开该 PDF 文件后重新收集该知识点。',
      'pdf.local.no.jump2': '该知识点来自本地文档，无法跳转。',
      'pdf.local.no.jump3': '无法跳转到本地文档。',

      // ---- AI ----
      'wormhole.title': 'AI 分析',
      'wormhole.title.short': '分析',
      'wormhole.ready': 'AI引擎就绪',
      'wormhole.settings': 'AI设置',
      'wormhole.onboarding.title': '☁️ 配置云端 API 以使用 AI 分析',
      'wormhole.onboarding.desc': '配置自定义 API 后可进行 PDF 智能摘要、知识点提取和关联分析',
      'wormhole.onboarding.btn': '⚙️ 配置云端 API',
      'wormhole.drop.text': '拖入 PDF 文件到这里<br>或 <span class="wh-link" id="wh-select-file">点击选择文件</span><br><span class="wh-link" id="wh-analyze-current" style="font-size:10px;">📋 分析当前打开的 PDF</span>',
      'wormhole.drop.simple': '📄 拖入 PDF 分析',
      'wormhole.drop.or': '或 <span class="wh-link" id="wh-drawer-select-file">点击选择</span>',
      'wormhole.analyzing': '正在分析...',
      'wormhole.threshold': '🔗 连接相关性阈值',
      'wormhole.connection.count': '匹配 {count} 条连接',
      'wormhole.connection.count.none': '匹配 -- 条连接',
      'wormhole.suggestions.empty': '暂无 AI 建议连接<br><span style="font-size:10px;">分析PDF后将自动推荐关联</span>',
      'wormhole.apply.all': '✅ 应用全部建议',
      'wormhole.clear.all': '🗑️ 清除所有 AI 连线',
      'wormhole.apply.all.report': '🚀 全部应用（推荐）',
      'wormhole.apply.new.only': '🆕 仅添加新知识点',
      'wormhole.report.title': '变化报告',
      'wormhole.new.points': '🆕 新知识点',
      'wormhole.new.connections': '🔗 发现新关联',
      'wormhole.maybe.duplicates': '🔄 可能重复',
      'wormhole.provider': 'API 提供商',
      'wormhole.api.key': 'API Key',
      'wormhole.endpoint': 'Endpoint URL',
      'wormhole.model': '模型名称',
      'wormhole.test': '🔍 测试连接',
      'wormhole.save': '💾 保存配置',
      'wormhole.security.note': '🔒 API Key 仅存储在本地浏览器存储中，不会上传至任何第三方服务器',
      'wormhole.api.key.placeholder': '输入 API Key...',
      'wormhole.endpoint.placeholder': 'https://api.example.com/v1/chat/completions',
      'wormhole.model.placeholder': 'your-model-name',
      'wormhole.provider.custom': '自定义 API',
      'wormhole.engine.cloud': '云端',
      'wormhole.engine.local': '本地',
      'wormhole.engine.none': '未启用',
      'wormhole.no.config': '☁️ 请先配置云端 API，内置引擎已移除。\n\n点击侧边栏 ⚙️ 设置按钮进行配置。',
      'wormhole.api.fail': '☁️ API 请求失败: {msg}\n\n请检查网络连接和 API Key 配置。',
      'wormhole.text.too.short': '⚠️ 提取到的文本过少（仅{count}字符），分析结果可能不准确。',
      'wormhole.text.empty': '📷 此PDF可能是扫描件/图片型PDF，无法提取文本层。建议使用OCR工具转换后再试。',
      'wormhole.process.fail': '处理失败，请重试',

      // ---- 图例 / 详情 ----
      'legend.star': '节点',
      'legend.orbit': '同源',
      'legend.constellation': '关联',
      'legend.wormhole': 'AI 连线',
      'detail.knowlink': '所属知识簇: {name}',
      'detail.wanderer': '独立节点',
      'detail.connections': '🔗 关联节点: {count} 个（其中 {ai} 个 AI 连接）',
      'detail.index': '📇 索引: #{idx}',
      'tooltip.connections': '关联 {count} 个节点',
      'stats.loading': '加载中...',
      'stats.empty': '知识库中还没有知识点',
      'stats.count': '{n} 节点 · {g} 知识簇 · {e} 连线',
      'breadcrumb.all': '全部',
      'breadcrumb.knowlink': '{name}',
      'breadcrumb.star': '{label}',
      'canvas.empty': '知识库中还没有节点，去收集一些知识点吧',
      'zoom.in': '放大',
      'zoom.out': '缩小',
      'zoom.reset': '重置视图',
      'wormhole.toggle': 'AI 分析面板',

      // ---- 提示 / 确认 ----
      'alert.create.fail': '创建失败：{msg}',
      'alert.rename.fail': '重命名失败：{msg}',
      'alert.delete.fail': '删除失败：{msg}',
      'alert.keep.one': '至少需要保留一个知识库。',
      'confirm.delete.kb': '确定要删除知识库「{name}」吗？',
      'prompt.new.kb': '请输入新知识库名称：',
      'prompt.new.kb.default': '新知识库',
      'prompt.rename.kb': '重命名知识库：',
      'confirm.delete.point': '确定要删除这个知识点吗？\n\n"{preview}..."',
      'confirm.clear.kb': '确定要清空知识库「{name}」中的所有 {count} 条知识点吗？',
      'alert.export.empty': '知识库「{name}」中无内容。',
      'alert.export.empty2': '没有可导出的知识点。',
      'alert.import.format': '格式错误：需要 JSON 数组。',
      'alert.import.invalid': '导入失败：所有条目无效（缺少 text/url 字段）。',
      'alert.import.parse': '解析失败：{msg}',
      'import.summary': '共 {total} 条，有效 {valid} 条',
      'import.skipped': '（跳过 {count} 条无效）',
      'import.mode': '{summary}\n\n点击"确定"合并，点击"取消"替换。',
      'import.mode2': '点击确定合并到「{name}」，取消替换。',
      'edge.same.source': '📖 来自同一篇文章',
      'edge.same.domain': '🌐 来自同一网站',
      'edge.keyword.high': '💡 主题高度相关',
      'edge.keyword.medium': '🔗 共享部分关键词',
      'edge.keyword.low': '📎 略有交集',
      'edge.ai': '🤖 AI 发现的深层关联',
      'edge.none': '—',
      'knowlink.name': '知识星系 {n}',
      'source.web': '🔗 {source}{time}（点击追溯）',
      'source.file': '📄 {source}{time}',
      'time.just.now': '刚刚',
      'time.minutes.ago': '{n} 分钟前',
      'time.hours.ago': '{n} 小时前',
      'recent.pdfs.empty.sp': '📭 今天还没有打开过 PDF',
      'wormhole.warn.pdf.only': '⚠️ 仅支持 PDF 文件，请拖入 .pdf 文件',
      'wormhole.warn.no.tab': '无法获取当前标签页',
      'wormhole.warn.local.pdf': '⚠️ 本地PDF无法直接读取，请将PDF文件拖入此面板进行分析',
      'wormhole.downloading': '正在下载PDF...',
      'wormhole.warn.pdfjs.missing': '❌ PDF解析库未加载，请刷新页面后重试。',
      'wormhole.warn.fetch.fail': '❌ 无法获取PDF文件: {msg}<br><span style="font-size:10px;">请尝试将PDF文件拖入此面板</span>',
      'wormhole.warn.not.pdf': '当前标签页不是PDF文件',
      'wormhole.warn.read.fail': '❌ 无法读取文件，请检查文件是否损坏',
      'wormhole.extracting': '正在提取PDF文本...',
      'wormhole.extracting.page': '提取第 {done}/{total} 页...',
      'wormhole.warn.parse.fail': '❌ PDF解析失败: {msg}',
      'wormhole.warn.scanned': '📷 此PDF可能是扫描件/图片型PDF，无法提取文本层。\n建议使用OCR工具转换后再试。',
      'wormhole.warn.short.text': '⚠️ 提取到的文本过少（仅{count}字符），分析结果可能不准确。',
      'wormhole.test.no.key': '❌ 请先输入 API Key',
      'wormhole.testing': '⏳ 正在测试连接...',
      'wormhole.test.success': '✅ 连接成功！API可用',
      'wormhole.test.fail': '❌ 连接失败: {msg}',
      'detail.source': '📄 {source}',
      'detail.source.unknown': '未知来源',
      'wormhole.warn.no.text.layer': '📷 此PDF无文本层（可能是扫描件）<br><span style="font-size:10px;">建议使用OCR工具转换</span>',
      'wormhole.warn.short.text.drawer': '⚠️ 文本过少（仅{count}字符）<br><span style="font-size:10px;">分析结果可能不准确</span>',
      'wormhole.analyzing.pdf': '⏳ 正在分析PDF...',
      'wormhole.analyze.fail': '❌ 分析失败: {msg}',
      'wormhole.kb.empty': '🪐 知识库为空<br><span style="font-size:10px;">请先收集一些知识点</span>',
      'wormhole.finding': '⏳ 查找关联中...',
      'wormhole.no.strong': '🔍 未找到强关联连接',
      'wormhole.connection.count.detail': '匹配 {visible} 条连接（共 {total} 条建议）',
      'wormhole.too.many': ' ⚠️ 连接过多，建议提高阈值',
      'wormhole.no.match.threshold': '🔍 当前阈值下无匹配连接<br><span style="font-size:10px;">尝试降低阈值或分析更多PDF</span>',
      'wormhole.node': '节点#{id}',
      'wormhole.strength': '关联度: {s}% ',
      'wormhole.remove': '❌ 移除连接',
      'wormhole.accept': '✅ 接受',
      'wormhole.reject': '❌ 拒绝',
      'wormhole.no.apply': '没有可应用的连接建议',
      'wormhole.confirm.apply': '将应用 {count} 条连接建议，是否继续？',
      'wormhole.confirm.clear': '确定清除所有 AI 连线吗？此操作不可撤销。',

      // ---- PDF 查看器 ----
      'pdf.open.none': '没有可打开的文件。请先从最近 PDF 列表中选择一个文件。',
      'pdf.open.fail': '无法打开文件，请手动复制路径后在浏览器中打开。\n\n{url}',
      'pdf.copied': '✅ 已复制',
      'pdf.copy.fail': '复制失败，请手动复制：\n{url}'
    },

    en: {
      // ---- 通用 ----
      'app.name': 'KnowLink',
      'app.name.short': 'KnowLink Knowledge Base',
      'loading': 'Loading...',
      'refresh': 'Refresh',
      'export': 'Export',
      'import': 'Import',
      'export.json': 'Export JSON',
      'import.json': 'Import JSON',
      'search.placeholder': 'Filter by keyword...',
      'search.stars': 'Search knowledge points...',
      'search.points': '🔍 Search knowledge points',
      'settings': 'Search / Import / Export',
      'delete': 'Delete',
      'rename': 'Rename',
      'new.kb': 'New knowledge base',
      'switch.kb': 'Switch knowledge base',
      'fullscreen': 'Open fullscreen knowlink in new tab',
      'empty.kb': 'No knowledge points in the knowledge base yet. Select text on a webpage to collect.',
      'empty.kb.detail': 'No knowledge points in knowledge base "{name}" yet',
      'empty.kb.hint': 'Select text on a webpage and click the floating button to collect',
      'empty.search': '🔍 No matching knowledge points found',
      'clear.kb': '🗑️ Clear current knowledge base',
      'clear.kb.named': '🗑️ Clear "{name}"',
      'status.void': 'Empty',
      'status.count': '📂 {name} · ✅ {count} / {max}',
      'recent.pdfs': '📂 PDFs opened today',
      'recent.pdfs.today': '📅 PDFs opened today',
      'recent.pdfs.empty': 'No PDFs opened today',
      'recent.pdfs.loading': 'Loading...',
      'recent.pdfs.unavailable': 'Extension environment unavailable',
      'recent.pdfs.fetch.fail': 'Failed to fetch',
      'click.trace': ' (click to trace)',
      'delete.point': 'Delete this knowledge point',
      'trace.source': '🔗 Trace source',
      'open.external': '🔗 Open externally',
      'copy.path': '📋 Copy path',
      'copy.url': 'Copy file path',
      'recent.pdfs.btn': '📂 Recent PDFs ▾',
      'view.pdf.native': 'View documents with Chrome native PDF reader',
      'view.pdf.hint': 'Click a knowledge point in the knowlink sidebar to jump to its page',
      'pdf.load.fail': 'Unable to load PDF file',
      'pdf.load.fail.hint': 'Try opening the file directly in your browser, or check the file path.<br>Local files require the "Allow access to file URLs" permission.',
      'retry': '🔄 Retry',
      'unknown.file': 'Unknown file',
      'pdf.title.suffix': 'KnowLink PDF Viewer',
      'pdf.load.error': 'Failed to load file. Please check the path.',
      'pdf.local.doc': 'Local PDF document',
      'pdf.local.no.jump': 'This knowledge point comes from a local PDF and cannot be navigated automatically.\n\n💡 Please open the PDF file directly and re-collect this knowledge point.',
      'pdf.local.no.jump2': 'This knowledge point comes from a local document and cannot be navigated.',
      'pdf.local.no.jump3': 'Cannot navigate to local document.',

      // ---- AI ----
      'wormhole.title': 'AI Analysis',
      'wormhole.title.short': 'Analysis',
      'wormhole.ready': 'AI engine ready',
      'wormhole.settings': 'AI settings',
      'wormhole.onboarding.title': '☁️ Configure a cloud API to use AI analysis',
      'wormhole.onboarding.desc': 'Configure a custom API to enable PDF summarization, knowledge point extraction and relation analysis',
      'wormhole.onboarding.btn': '⚙️ Configure cloud API',
      'wormhole.drop.text': 'Drop PDF files here<br>or <span class="wh-link" id="wh-select-file">click to select a file</span><br><span class="wh-link" id="wh-analyze-current" style="font-size:10px;">📋 Analyze the currently open PDF</span>',
      'wormhole.drop.simple': '📄 Drop PDF to analyze',
      'wormhole.drop.or': 'or <span class="wh-link" id="wh-drawer-select-file">click to select</span>',
      'wormhole.analyzing': 'Analyzing...',
      'wormhole.threshold': '🔗 Connection relevance threshold',
      'wormhole.connection.count': '{count} connections matched',
      'wormhole.connection.count.none': '-- connections matched',
      'wormhole.suggestions.empty': 'No AI suggestions yet<br><span style="font-size:10px;">Analyze a PDF to get automatic relation suggestions</span>',
      'wormhole.apply.all': '✅ Apply all suggestions',
      'wormhole.clear.all': '🗑️ Clear all AI links',
      'wormhole.apply.all.report': '🚀 Apply all (recommended)',
      'wormhole.apply.new.only': '🆕 Add new points only',
      'wormhole.report.title': 'Change Report',
      'wormhole.new.points': '🆕 New knowledge points',
      'wormhole.new.connections': '🔗 New connections found',
      'wormhole.maybe.duplicates': '🔄 Possible duplicates',
      'wormhole.provider': 'API Provider',
      'wormhole.api.key': 'API Key',
      'wormhole.endpoint': 'Endpoint URL',
      'wormhole.model': 'Model name',
      'wormhole.test': '🔍 Test connection',
      'wormhole.save': '💾 Save config',
      'wormhole.security.note': '🔒 API Key is stored only in local browser storage and is never uploaded to any third-party server',
      'wormhole.api.key.placeholder': 'Enter API Key...',
      'wormhole.endpoint.placeholder': 'https://api.example.com/v1/chat/completions',
      'wormhole.model.placeholder': 'your-model-name',
      'wormhole.provider.custom': 'Custom API',
      'wormhole.engine.cloud': 'Cloud',
      'wormhole.engine.local': 'Local',
      'wormhole.engine.none': 'Not enabled',
      'wormhole.no.config': '☁️ Please configure a cloud API first. The built-in engine has been removed.\n\nClick the ⚙️ settings button in the sidebar.',
      'wormhole.api.fail': '☁️ API request failed: {msg}\n\nPlease check your network connection and API Key configuration.',
      'wormhole.text.too.short': '⚠️ Extracted text is too short ({count} chars), results may be inaccurate.',
      'wormhole.text.empty': '📷 This PDF may be a scanned/image PDF with no text layer. Try converting it with an OCR tool first.',
      'wormhole.process.fail': 'Processing failed, please retry',

      // ---- 图例 / 详情 ----
      'legend.star': 'Node',
      'legend.orbit': 'Same source',
      'legend.constellation': 'Related',
      'legend.wormhole': 'AI link',
      'detail.knowlink': 'Knowledge cluster: {name}',
      'detail.wanderer': 'Standalone node',
      'detail.connections': '🔗 Connected nodes: {count} ({ai} AI links)',
      'detail.index': '📇 Index: #{idx}',
      'tooltip.connections': '{count} connected nodes',
      'stats.loading': 'Loading...',
      'stats.empty': 'No knowledge points in the knowledge base',
      'stats.count': '{n} nodes · {g} clusters · {e} links',
      'breadcrumb.all': 'All',
      'breadcrumb.knowlink': '{name}',
      'breadcrumb.star': '{label}',
      'canvas.empty': 'No nodes in the knowledge base yet. Go collect some knowledge points!',
      'zoom.in': 'Zoom in',
      'zoom.out': 'Zoom out',
      'zoom.reset': 'Reset view',
      'wormhole.toggle': 'AI analysis panel',

      // ---- 提示 / 确认 ----
      'alert.create.fail': 'Create failed: {msg}',
      'alert.rename.fail': 'Rename failed: {msg}',
      'alert.delete.fail': 'Delete failed: {msg}',
      'alert.keep.one': 'At least one knowledge base must be kept.',
      'confirm.delete.kb': 'Delete knowledge base "{name}"?',
      'prompt.new.kb': 'Enter new knowledge base name:',
      'prompt.new.kb.default': 'New knowledge base',
      'prompt.rename.kb': 'Rename knowledge base:',
      'confirm.delete.point': 'Delete this knowledge point?\n\n"{preview}..."',
      'confirm.clear.kb': 'Clear all {count} knowledge points in "{name}"?',
      'alert.export.empty': 'Knowledge base "{name}" is empty.',
      'alert.export.empty2': 'No knowledge points to export.',
      'alert.import.format': 'Invalid format: expected a JSON array.',
      'alert.import.invalid': 'Import failed: all items are invalid (missing text/url fields).',
      'alert.import.parse': 'Parse failed: {msg}',
      'import.summary': '{total} items, {valid} valid',
      'import.skipped': ' ({count} invalid skipped)',
      'import.mode': '{summary}\n\nClick "OK" to merge, "Cancel" to replace.',
      'import.mode2': 'Click OK to merge into "{name}", Cancel to replace.',
      'edge.same.source': '📖 From the same article',
      'edge.same.domain': '🌐 From the same website',
      'edge.keyword.high': '💡 Highly related topics',
      'edge.keyword.medium': '🔗 Shares some keywords',
      'edge.keyword.low': '📎 Slight overlap',
      'edge.ai': '🤖 Deep relation found by AI',
      'edge.none': '—',
      'knowlink.name': 'Knowlink {n}',
      'source.web': '🔗 {source}{time} (click to trace)',
      'source.file': '📄 {source}{time}',
      'time.just.now': 'just now',
      'time.minutes.ago': '{n} min ago',
      'time.hours.ago': '{n} hr ago',
      'recent.pdfs.empty.sp': '📭 No PDFs opened today',
      'wormhole.warn.pdf.only': '⚠️ Only PDF files are supported. Drop a .pdf file.',
      'wormhole.warn.no.tab': 'Unable to get the current tab',
      'wormhole.warn.local.pdf': '⚠️ Local PDFs cannot be read directly. Drop the PDF file into this panel to analyze.',
      'wormhole.downloading': 'Downloading PDF...',
      'wormhole.warn.pdfjs.missing': '❌ PDF parser library not loaded. Refresh the page and retry.',
      'wormhole.warn.fetch.fail': '❌ Failed to fetch PDF: {msg}<br><span style="font-size:10px;">Try dropping the PDF file into this panel</span>',
      'wormhole.warn.not.pdf': 'The current tab is not a PDF file',
      'wormhole.warn.read.fail': '❌ Failed to read the file. Check if it is corrupted.',
      'wormhole.extracting': 'Extracting PDF text...',
      'wormhole.extracting.page': 'Extracting page {done}/{total}...',
      'wormhole.warn.parse.fail': '❌ PDF parsing failed: {msg}',
      'wormhole.warn.scanned': '📷 This PDF may be a scanned/image PDF with no text layer.\nTry converting it with an OCR tool first.',
      'wormhole.warn.short.text': '⚠️ Extracted text is too short ({count} chars), results may be inaccurate.',
      'wormhole.test.no.key': '❌ Please enter an API Key first',
      'wormhole.testing': '⏳ Testing connection...',
      'wormhole.test.success': '✅ Connection successful! API is ready',
      'wormhole.test.fail': '❌ Connection failed: {msg}',
      'detail.source': '📄 {source}',
      'detail.source.unknown': 'Unknown source',
      'wormhole.warn.no.text.layer': '📷 This PDF has no text layer (may be scanned)<br><span style="font-size:10px;">Try converting with an OCR tool</span>',
      'wormhole.warn.short.text.drawer': '⚠️ Text too short ({count} chars)<br><span style="font-size:10px;">Results may be inaccurate</span>',
      'wormhole.analyzing.pdf': '⏳ Analyzing PDF...',
      'wormhole.analyze.fail': '❌ Analysis failed: {msg}',
      'wormhole.kb.empty': '🪐 Knowledge base is empty<br><span style="font-size:10px;">Collect some knowledge points first</span>',
      'wormhole.finding': '⏳ Finding connections...',
      'wormhole.no.strong': '🔍 No strong connections found',
      'wormhole.connection.count.detail': '{visible} connections matched (of {total} suggestions)',
      'wormhole.too.many': ' ⚠️ Too many connections, consider raising the threshold',
      'wormhole.no.match.threshold': '🔍 No connections match the current threshold<br><span style="font-size:10px;">Try lowering the threshold or analyzing more PDFs</span>',
      'wormhole.node': 'Node#{id}',
      'wormhole.strength': 'Strength: {s}% ',
      'wormhole.remove': '❌ Remove connection',
      'wormhole.accept': '✅ Accept',
      'wormhole.reject': '❌ Reject',
      'wormhole.no.apply': 'No connection suggestions to apply',
      'wormhole.confirm.apply': 'Apply {count} connection suggestions?',
      'wormhole.confirm.clear': 'Clear all AI links? This cannot be undone.',

      // ---- PDF 查看器 ----
      'pdf.open.none': 'No file to open. Select a file from the recent PDFs list first.',
      'pdf.open.fail': 'Unable to open the file. Copy the path manually and open it in your browser.\n\n{url}',
      'pdf.copied': '✅ Copied',
      'pdf.copy.fail': 'Copy failed. Copy manually:\n{url}'
    }
  };

  // ==================== 内部状态 ====================
  var _locale = 'zh-CN';
  var _storageKey = 'readerLocale';

  // ==================== 工具 ====================
  function _detectLocale() {
    try {
      var nav = (navigator.language || 'zh-CN').toLowerCase();
      if (nav.indexOf('zh') === 0) return 'zh-CN';
      return 'en';
    } catch (e) { return 'zh-CN'; }
  }

  // ==================== 翻译 ====================
  function t(key, params) {
    var dict = DICT[_locale] || DICT['zh-CN'];
    var str = dict[key];
    if (str === undefined) {
      // 回退到中文，仍缺失则返回 key 本身
      str = DICT['zh-CN'][key];
      if (str === undefined) return key;
    }
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split('{' + k + '}').join(params[k]);
      });
    }
    return str;
  }

  // ==================== 语言管理 ====================
  function getLocale() { return _locale; }

  function setLocale(locale, persist) {
    var next = (locale === 'en' || locale === 'zh-CN') ? locale : _detectLocale();
    if (next === _locale) { _applyDom(); return Promise.resolve(next); }
    _locale = next;
    document.documentElement.lang = _locale === 'zh-CN' ? 'zh-CN' : 'en';
    _applyDom();
    if (persist !== false) {
      try {
        chrome.storage.local.set({ readerLocale: _locale });
      } catch (e) {}
    }
    return Promise.resolve(_locale);
  }

  function toggleLocale() {
    return setLocale(_locale === 'zh-CN' ? 'en' : 'zh-CN');
  }

  // ==================== DOM 扫描 ====================
  // 扫描 [data-i18n] 元素：textContent = t(key)
  // 扫描 [data-i18n-html] 元素：innerHTML = t(key)（含 HTML 的文案）
  // 扫描 [data-i18n-placeholder] 元素：placeholder = t(key)
  // 扫描 [data-i18n-title] 元素：title = t(key)
  function _applyDom(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    }
    var htmls = root.querySelectorAll('[data-i18n-html]');
    for (var h = 0; h < htmls.length; h++) {
      var hel = htmls[h];
      var hk = hel.getAttribute('data-i18n-html');
      if (hk) hel.innerHTML = t(hk);
    }
    var phs = root.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < phs.length; j++) {
      var ph = phs[j];
      var pk = ph.getAttribute('data-i18n-placeholder');
      if (pk) ph.setAttribute('placeholder', t(pk));
    }
    var tts = root.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < tts.length; k++) {
      var tt = tts[k];
      var tk = tt.getAttribute('data-i18n-title');
      if (tk) tt.setAttribute('title', t(tk));
    }
  }

  // ==================== 初始化 ====================
  function init() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([_storageKey], function (result) {
          var saved = result[_storageKey];
          if (saved === 'en' || saved === 'zh-CN') {
            _locale = saved;
          } else {
            _locale = _detectLocale();
          }
          document.documentElement.lang = _locale === 'zh-CN' ? 'zh-CN' : 'en';
          _applyDom();
          resolve(_locale);
        });
      } catch (e) {
        _locale = _detectLocale();
        document.documentElement.lang = _locale === 'zh-CN' ? 'zh-CN' : 'en';
        _applyDom();
        resolve(_locale);
      }
    });
  }

  // ==================== 导出 ====================
  window.I18n = {
    t: t,
    getLocale: getLocale,
    setLocale: setLocale,
    toggleLocale: toggleLocale,
    applyI18n: _applyDom,
    init: init,
    DICT: DICT
  };

})();