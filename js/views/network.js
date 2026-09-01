// ====================================================================
//  KnowLink 知识星系 — 全屏视图逻辑 (network.js)
//  独立标签页中的沉浸式星系探索体验
// ====================================================================

// ---- PDF.js Worker 初始化 (从内联脚本移出，解决CSP报错) ----
try {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }
} catch (e) { /* file:// 或非扩展环境，忽略 */ }

// ---- i18n 初始化 + 语言切换 ----
if (window.I18n) {
  window.I18n.init();
  var btnLang = document.getElementById('btn-lang');
  if (btnLang) {
    btnLang.addEventListener('click', function() {
      window.I18n.toggleLocale().then(function() {
        updateStats();
        updateBreadcrumb();
        renderGraph();
        refreshSuggestions();
      });
    });
  }
}

// ---- 主题切换（obsidian 简洁 / space 深空） ----
var _currentTheme = 'obsidian';
function applyTheme(name) {
  _currentTheme = name;
  document.documentElement.setAttribute('data-theme', name);
  if (typeof setKnowlinkTheme === 'function') setKnowlinkTheme(name);
  renderGraph();
  try {
    chrome.storage.local.set({ knowlinkTheme: name });
  } catch (e) {}
}
var btnTheme = document.getElementById('btn-theme');
if (btnTheme) {
  btnTheme.addEventListener('click', function() {
    applyTheme(_currentTheme === 'obsidian' ? 'space' : 'obsidian');
  });
}
// 恢复持久化主题
try {
  chrome.storage.local.get(['knowlinkTheme'], function(result) {
    if (result.knowlinkTheme === 'space' || result.knowlinkTheme === 'obsidian') {
      applyTheme(result.knowlinkTheme);
    }
  });
} catch (e) {}

// ---- DOM ----
var canvas       = document.getElementById('knowlink-canvas');
var ctx          = canvas.getContext('2d');
var tooltip      = document.getElementById('tooltip');
var searchInput  = document.getElementById('search-input');
var statsBadge   = document.getElementById('stats-badge');
var detailPanel  = document.getElementById('detail-panel');

// 面包屑
var crumbAll    = document.getElementById('crumb-all');
var crumbKnowlink = document.getElementById('crumb-knowlink');
var crumbStar   = document.getElementById('crumb-star');
var sepKnowlink   = document.getElementById('sep-knowlink');
var sepStar     = document.getElementById('sep-star');

// ---- 状态 ----
var knowledgePoints = [];
var graphNodes      = [];
var graphEdges      = [];
var hoveredNode     = null;
var focusedNode     = null;
var selectedNode    = null;
var draggedNode     = null;
var dragOffset      = { x: 0, y: 0 };
var sourceColorMap  = {};
var filterText      = '';
var viewTransform   = { offsetX: 0, offsetY: 0, scale: 1 };
var isPanning       = false;
var panStart        = { x: 0, y: 0 };
var panOffsetStart  = { x: 0, y: 0 };
var animTime        = 0;
var animFrameId     = null;

// ---- Canvas 自适应 ----
function resizeCanvas() {
  var wrap = document.getElementById('canvas-wrap');
  var rect = wrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  var dpr = window.devicePixelRatio || 1;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width  = rect.width  + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initStarParticles(rect.width, rect.height);
  renderGraph();
}

window.addEventListener('resize', resizeCanvas);
try {
  new ResizeObserver(resizeCanvas).observe(document.getElementById('canvas-wrap'));
} catch(e) {}

// ---- 动画循环 ----
function startAnimLoop() {
  if (animFrameId) return;
  function loop(ts) {
    animTime = ts;
    renderGraph();
    animFrameId = requestAnimationFrame(loop);
  }
  animFrameId = requestAnimationFrame(loop);
}

// ---- 面包屑 ----
function updateBreadcrumb() {
  if (focusedNode !== null && focusedNode !== undefined) {
    var nd = graphNodes[focusedNode];
    var galName = '';
    if (nd && nd.knowlink) {
      var gal = galaxies.find(function(g) { return g.id === nd.knowlink; });
      if (gal) galName = gal.name;
    }

    crumbKnowlink.style.display = '';
    crumbKnowlink.textContent = window.I18n ? window.I18n.t('breadcrumb.knowlink', {name: galName || ''}) : (galName || '星系');
    sepKnowlink.style.display = '';

    crumbStar.style.display = '';
    crumbStar.textContent = nd ? (window.I18n ? window.I18n.t('breadcrumb.star', {label: nd.label}) : nd.label) : '';
    sepStar.style.display = '';

    crumbAll.classList.remove('current');
    crumbKnowlink.classList.remove('current');
    crumbStar.classList.add('current');
  } else {
    crumbKnowlink.style.display = 'none';
    crumbStar.style.display = 'none';
    sepKnowlink.style.display = 'none';
    sepStar.style.display = 'none';
    crumbAll.classList.add('current');
  }
}

crumbAll.addEventListener('click', function() {
  focusedNode = null; selectedNode = null;
  viewTransform = { offsetX: 0, offsetY: 0, scale: 1 };
  updateBreadcrumb();
  hideDetail();
  renderGraph();
});

crumbKnowlink.addEventListener('click', function() {
  if (focusedNode !== null && graphNodes[focusedNode]) {
    var nd = graphNodes[focusedNode];
    if (nd.knowlink) {
      var gal = galaxies.find(function(g) { return g.id === nd.knowlink; });
      if (gal) {
        var wrap = document.getElementById('canvas-wrap');
        var rect = wrap.getBoundingClientRect();
        viewTransform.scale = 1.5;
        viewTransform.offsetX = rect.width/2 - gal.centerX * 1.5;
        viewTransform.offsetY = rect.height/2 - gal.centerY * 1.5;
      }
    }
    focusedNode = null;
    updateBreadcrumb();
    hideDetail();
    renderGraph();
  }
});

// ---- 数据加载 ----
var activeKBName = '知识库';

function loadData() {
  try {
    knowledgePoints = self.KBStore.getPoints();
    var activeKB = self.KBStore.getActiveKB();
    activeKBName = activeKB ? activeKB.name : '知识库';
    console.log('[Knowlink Network] 加载知识库「' + activeKBName + '」: ' + knowledgePoints.length + ' 条');
    buildGraph();
    resizeCanvas();
    updateStats();
  } catch(e) { console.error('[Knowlink Network] loadData:', e); }
}

function updateStats() {
  var n = graphNodes.length;
  var e = graphEdges.length;
  var g = galaxies.length;
  var I = window.I18n;
  if (n) {
    var density = n > 1 ? Math.round((2 * e) / (n * (n - 1)) * 100) : 0;
    statsBadge.textContent = I ? I.t('stats.count', {n: n, g: g, e: e}) : (n + ' 节点 · ' + g + ' 星系 · ' + e + ' 连线');
  } else {
    statsBadge.textContent = I ? I.t('stats.empty') : '知识宇宙空旷无垠';
  }
}

// ---- 构建图 ----
function buildGraph() {
  var wrap = document.getElementById('canvas-wrap');
  var rect = wrap.getBoundingClientRect();
  var W = rect.width || 1000, H = rect.height || 700;
  buildKnowlinkGraph(knowledgePoints, filterText);
  computeKnowlinkLayout(graphNodes, graphEdges, W, H);
}

// ---- 渲染 ----
function renderGraph() {
  var wrap = document.getElementById('canvas-wrap');
  var rect = wrap.getBoundingClientRect();
  var W = rect.width, H = rect.height;
  if (!W || !H) return;

  var aiEdges = window.KnowLinkAI ? window.KnowLinkAI._getAIEdges() : [];

  renderKnowlink(ctx, viewTransform, W, H, {
    hoveredNode: hoveredNode,
    focusedNode: focusedNode,
    selectedNode: selectedNode,
    filterText: filterText,
    time: animTime,
    aiEdges: aiEdges
  });

}

// ---- 详情面板 ----
function showDetail(idx) {
  if (idx === null) { hideDetail(); return; }
  selectedNode = idx;
  var nd = graphNodes[idx];
  document.getElementById('detail-title').textContent = nd.label;
  document.getElementById('detail-source').textContent = window.I18n ? window.I18n.t('detail.source', {source: nd.source || window.I18n.t('detail.source.unknown')}) : (nd.source || '未知来源');

  // 叙事风格详情
  var connCount = graphEdges.filter(function(e) { return e.from === idx || e.to === idx; }).length;
  var aiEdges = window.KnowLinkAI ? window.KnowLinkAI._getAIEdges() : [];
  var nodeStableId = nd.stableId || '';
  var aiConnCount = aiEdges.filter(function(e) { return e.from === nodeStableId || e.to === nodeStableId; }).length;
  var galName = '';
  if (nd.knowlink) {
    var gal = galaxies.find(function(g) { return g.id === nd.knowlink; });
    if (gal) galName = gal.name;
  }

  document.getElementById('detail-text').textContent = nd.fullText;
  var I = window.I18n;
  document.getElementById('detail-stats').innerHTML =
    (I ? I.t('detail.knowlink', {name: galName || I.t('detail.wanderer')}) : ('所属星系: ' + (galName || '流浪恒星'))) + '<br>' +
    (I ? I.t('detail.connections', {count: connCount, ai: aiConnCount}) : ('关联节点: ' + connCount + ' 个（其中 ' + aiConnCount + ' 个 AI 连线）')) + '<br>' +
    (I ? I.t('detail.index', {idx: idx}) : ('索引: #' + idx));

  detailPanel.style.display = 'block';
  renderGraph();
}

function hideDetail() {
  detailPanel.style.display = 'none';
  selectedNode = null;
  renderGraph();
}

document.getElementById('detail-close').addEventListener('click', hideDetail);

document.getElementById('detail-goto').addEventListener('click', function() {
  if (selectedNode === null) return;
  var kp = knowledgePoints[selectedNode];
  if (!kp) return;
  var nd = graphNodes[selectedNode];
  var page = (kp.page || (nd ? nd.page : 0) || 0);
  var searchText = kp.title || kp.text || '';
  if (typeof navigateToSource === 'function') {
    navigateToSource(kp.url, kp.text, page, searchText);
  } else {
    var url = resolveRealUrl(kp.url);
    if (!url || url === '本地 PDF 文档') { alert(window.I18n ? window.I18n.t('pdf.local.no.jump2') : '该知识点来自本地文档，无法跳转。'); return; }
    if (page > 0) url += '#page=' + page;
    chrome.tabs.create({ url: url });
  }
});

// ---- 画布交互 ----
canvas.addEventListener('wheel', function(e) {
  e.preventDefault();
  var rect = canvas.getBoundingClientRect();
  var mx = e.clientX - rect.left, my = e.clientY - rect.top;
  var factor = e.deltaY < 0 ? 1.1 : 0.9;
  var newScale = Math.max(0.15, Math.min(4.0, viewTransform.scale * factor));
  viewTransform.offsetX = mx - (mx - viewTransform.offsetX) * (newScale / viewTransform.scale);
  viewTransform.offsetY = my - (my - viewTransform.offsetY) * (newScale / viewTransform.scale);
  viewTransform.scale = newScale;
  renderGraph();
}, { passive: false });

canvas.addEventListener('mousedown', function(e) {
  if (hoveredNode !== null) {
    draggedNode = hoveredNode;
    var world = screenToWorld(
      e.clientX - canvas.getBoundingClientRect().left,
      e.clientY - canvas.getBoundingClientRect().top, viewTransform);
    dragOffset.x = world.x - graphNodes[hoveredNode].x;
    dragOffset.y = world.y - graphNodes[hoveredNode].y;
    canvas.style.cursor = 'grabbing';
  } else {
    isPanning = true;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
    panOffsetStart.x = viewTransform.offsetX;
    panOffsetStart.y = viewTransform.offsetY;
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mousemove', function(e) {
  if (draggedNode !== null) {
    var world = screenToWorld(
      e.clientX - canvas.getBoundingClientRect().left,
      e.clientY - canvas.getBoundingClientRect().top, viewTransform);
    graphNodes[draggedNode].x = world.x - dragOffset.x;
    graphNodes[draggedNode].y = world.y - dragOffset.y;
    renderGraph(); return;
  }
  if (isPanning) {
    viewTransform.offsetX = panOffsetStart.x + (e.clientX - panStart.x);
    viewTransform.offsetY = panOffsetStart.y + (e.clientY - panStart.y);
    renderGraph(); return;
  }

  var r = canvas.getBoundingClientRect();
  var prev = hoveredNode;
  hoveredNode = findNodeAt(e.clientX - r.left, e.clientY - r.top, viewTransform);
  if (hoveredNode !== prev) renderGraph();

  if (hoveredNode !== null) {
    var nd = graphNodes[hoveredNode];
    var sx = nd.x * viewTransform.scale + viewTransform.offsetX;
    var sy = nd.y * viewTransform.scale + viewTransform.offsetY;
    tooltip.style.left = (sx + nd.radius + 16) + 'px';
    tooltip.style.top  = (sy - 12) + 'px';

    var connCount = graphEdges.filter(function(e) { return e.from === hoveredNode || e.to === hoveredNode; }).length;
    tooltip.innerHTML = (nd.fullText.length > 60 ? nd.fullText.slice(0, 58) + '…' : nd.fullText)
      + '<span class="tt-narrative">' + (window.I18n ? window.I18n.t('tooltip.connections', {count: connCount}) : ('关联 ' + connCount + ' 个节点'))
      + (nd.knowlink ? ' · ' + (nd.knowlink || '') : '')
      + '</span>';
    tooltip.style.opacity = '1';
  } else {
    tooltip.style.opacity = '0';
  }
  canvas.style.cursor = hoveredNode !== null ? 'pointer' : 'default';
});

canvas.addEventListener('mouseup', function() {
  draggedNode = null; isPanning = false;
  canvas.style.cursor = hoveredNode !== null ? 'pointer' : 'default';
});

canvas.addEventListener('mouseleave', function() {
  hoveredNode = null; draggedNode = null; isPanning = false;
  tooltip.style.opacity = '0'; renderGraph();
});

// 单击 → 聚焦 / 详情（再次点击同一节点或点击空白处取消高亮）
canvas.addEventListener('click', function(e) {
  if (draggedNode !== null) return;
  if (hoveredNode !== null) {
    // 再次点击同一节点 → 取消高亮
    if (focusedNode === hoveredNode) {
      focusedNode = null;
      updateBreadcrumb();
      hideDetail();
      renderGraph();
      return;
    }
    focusedNode = hoveredNode;
    updateBreadcrumb();
    showDetail(hoveredNode);
  } else {
    // 点击空白处 → 取消高亮
    focusedNode = null;
    updateBreadcrumb();
    hideDetail();
    renderGraph();
  }
});

// 双击 → 追溯来源 / 重置
canvas.addEventListener('dblclick', function(e) {
  if (hoveredNode === null) {
    focusedNode = null; selectedNode = null;
    viewTransform = { offsetX: 0, offsetY: 0, scale: 1 };
    updateBreadcrumb();
    hideDetail();
    return;
  }
  var kp = knowledgePoints[hoveredNode];
  if (!kp) return;
  var nd = graphNodes[hoveredNode];
  var page = (kp.page || (nd ? nd.page : 0) || 0);
  var searchText = kp.title || kp.text || '';
  if (typeof navigateToSource === 'function') {
    navigateToSource(kp.url, kp.text, page, searchText);
  } else {
    var url = resolveRealUrl(kp.url);
    if (!url || url === '本地 PDF 文档') { alert(window.I18n ? window.I18n.t('pdf.local.no.jump3') : '无法跳转到本地文档。'); return; }
    if (page > 0) url += '#page=' + page;
    chrome.tabs.create({ url: url });
  }
});

// ---- 搜索 ----
searchInput.addEventListener('input', function() {
  filterText = searchInput.value;
  buildGraph();
  renderGraph();
});
searchInput.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { searchInput.value = ''; filterText = ''; buildGraph(); renderGraph(); }
});

// ---- 缩放按钮 ----
document.getElementById('btn-zoom-in').addEventListener('click', function() {
  viewTransform.scale = Math.min(4.0, viewTransform.scale * 1.25);
  renderGraph();
});
document.getElementById('btn-zoom-out').addEventListener('click', function() {
  viewTransform.scale = Math.max(0.15, viewTransform.scale * 0.8);
  renderGraph();
});
document.getElementById('btn-reset').addEventListener('click', function() {
  focusedNode = null; selectedNode = null;
  viewTransform = { offsetX: 0, offsetY: 0, scale: 1 };
  updateBreadcrumb();
  hideDetail();
});

// ---- 导出/导入 ----
document.getElementById('btn-export').addEventListener('click', function() {
  if (!knowledgePoints.length) { alert(window.I18n ? window.I18n.t('alert.export.empty2') : '没有可导出的知识点。'); return; }
  var data = JSON.stringify(knowledgePoints, null, 2);
  var blob = new Blob([data], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'knowlink-knowlink-' + activeKBName + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

var fileInput2 = document.getElementById('import-file');
document.getElementById('btn-import').addEventListener('click', function() { fileInput2.click(); });
fileInput2.addEventListener('change', function() {
  var file = fileInput2.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) { alert(window.I18n ? window.I18n.t('alert.import.format') : '格式错误：需要 JSON 数组。'); return; }
      if (confirm(window.I18n ? window.I18n.t('import.mode2', {name: activeKBName}) : ('点击确定合并到「' + activeKBName + '」，取消替换。'))) {
        imported.reverse().forEach(function(item) { knowledgePoints.unshift(item); });
        self.KBStore.replacePoints(knowledgePoints).then(loadData);
      } else {
        self.KBStore.replacePoints(imported).then(function() {
          knowledgePoints = imported;
          loadData();
        });
      }
    } catch(err) { alert(window.I18n ? window.I18n.t('alert.import.parse', {msg: err.message}) : ('解析失败：' + err.message)); }
  };
  reader.readAsText(file);
  fileInput2.value = '';
});

// ---- 监听数据变化 ----
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function(message) {
    if (message.type === 'REFRESH_KNOWLEDGE') {
      if (!message.kbId || message.kbId === self.KBStore.getActiveKBId()) {
        incrementalRefresh(message);
      }
    }
    if (message.type === 'KB_STORE_CHANGED') {
      incrementalRefresh(message);
  }
  // 漏洞4: AI结果更新消息
  if (message.type === 'AI_RESULT_UPDATED') {
    console.log('[Knowlink Network] 收到AI结果更新:', message.pdfUrl);
    loadAIResults();
  }
  if (message.type === 'AI_EDGES_UPDATED') {
    console.log('[Knowlink Network] 收到AI连线更新, 共 ' + message.count + ' 条');
    loadAIResults();
  }
  });
}

// 增量刷新：仅添加新知识点
function incrementalRefresh(message) {
  var newPoints = self.KBStore.getPoints();

  // 如果没有已有节点（首建），走全量构建
  if (!graphNodes.length) {
    knowledgePoints = newPoints;
    buildGraph();
    resizeCanvas();
    updateStats();
    return;
  }

  // 找出新增的知识点（通过 stableId 去重）
  var existingIds = {};
  knowledgePoints.forEach(function(p) {
    if (p.id) existingIds[p.id] = true;
  });

  var trulyNewPoints = newPoints.filter(function(p) {
    return p.id && !existingIds[p.id];
  });

  if (!trulyNewPoints.length) {
    // 无新增，但可能有 AI 连线更新
    loadAIResults();
    renderGraph();
    return;
  }

  console.log('[Knowlink Network] 增量刷新: +' + trulyNewPoints.length + ' 新知识点');

  // 追加到 knowledgePoints
  for (var i = 0; i < trulyNewPoints.length; i++) {
    knowledgePoints.push(trulyNewPoints[i]);
  }

  // 获取容器尺寸
  var wrap = document.getElementById('canvas-wrap');
  var rect = wrap.getBoundingClientRect();
  var W = rect.width || 1000, H = rect.height || 700;

  // 增量添加节点
  var newNodeIndices = addNodesToGraph(trulyNewPoints, W, H);

  // 重新检测星系（为新节点分配星系）
  detectGalaxies(graphNodes, graphEdges);

  // 轻量力模拟
  relaxNewNodes(newNodeIndices, 6);

  // 启动入场动画
  newNodeIndices.forEach(function(idx) { startSupernovaAnimation(idx); });

  // 同步 AI 连线状态（从持久化存储）
  if (window.KnowLinkAI && typeof window.KnowLinkAI._normalize === 'function') {
    window.KnowLinkAI._normalize();
  }

  // 为新 AI 连线启动虫洞脉冲动画
  setTimeout(function() {
    if (window.KnowLinkAI && typeof window.KnowLinkAI._getAIEdges === 'function') {
      var aiEdges = window.KnowLinkAI._getAIEdges();
      aiEdges.forEach(function(e) {
        var fromIdx = typeof resolveNodeIndex === 'function' ? resolveNodeIndex(e.from) : -1;
        var toIdx = typeof resolveNodeIndex === 'function' ? resolveNodeIndex(e.to) : -1;
        if (fromIdx >= 0 && toIdx >= 0) {
          startWormholePulseAnimation(fromIdx, toIdx);
        }
      });
    }
  }, 100);

  // 更新统计
  updateStats();
  renderGraph();
}

// ==================== 🌀 虫洞 · AI 抽屉逻辑 ====================

// ---- DOM 引用 ----
var btnWormholeToggle    = document.getElementById('btn-wormhole-toggle');
var wormholeDrawer       = document.getElementById('wormhole-drawer');
var btnWhDrawerClose     = document.getElementById('btn-wh-drawer-close');
var whDrawerDropzone     = document.getElementById('wh-drawer-dropzone');
var whDrawerFileInput    = document.getElementById('wh-drawer-file-input');
var whDrawerSelectFile   = document.getElementById('wh-drawer-select-file');
var whThresholdSlider    = document.getElementById('wh-threshold-slider');
var whThresholdVal       = document.getElementById('wh-threshold-val');
var whConnectionCount    = document.getElementById('wh-connection-count');
var whSuggestionList     = document.getElementById('wh-suggestion-list');
var whSuggestionEmpty    = document.getElementById('wh-suggestion-empty');
var btnWhApplyAll        = document.getElementById('btn-wh-apply-all');
var btnWhClearAll        = document.getElementById('btn-wh-clear-all');

// ---- 状态 ----
var whDrawerOpen     = false;
var whSuggestionEdges = [];  // {from, to, strength, reason, accepted: bool, rejected: bool}
var whThreshold      = 0.4;
var whDebounceTimer  = null;

// ---- 抽屉开关 ----
function toggleWormholeDrawer(force) {
  whDrawerOpen = (force !== undefined) ? force : !whDrawerOpen;
  if (whDrawerOpen) {
    wormholeDrawer.classList.add('open');
    btnWormholeToggle.classList.add('active');
    refreshSuggestions();
  } else {
    wormholeDrawer.classList.remove('open');
    btnWormholeToggle.classList.remove('active');
  }
}

if (btnWormholeToggle) {
  btnWormholeToggle.addEventListener('click', function() {
    toggleWormholeDrawer();
  });
}

if (btnWhDrawerClose) {
  btnWhDrawerClose.addEventListener('click', function() {
    toggleWormholeDrawer(false);
  });
}

// ---- 文件选择 ----
if (whDrawerSelectFile && whDrawerFileInput) {
  whDrawerSelectFile.addEventListener('click', function(e) {
    e.stopPropagation();
    whDrawerFileInput.click();
  });
}

if (whDrawerFileInput) {
  whDrawerFileInput.addEventListener('change', function() {
    var file = whDrawerFileInput.files[0];
    if (file) handleDrawerPDFFile(file);
    whDrawerFileInput.value = '';
  });
}

// ---- 拖放 ----
if (whDrawerDropzone) {
  whDrawerDropzone.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    whDrawerDropzone.classList.add('dragover');
  });

  whDrawerDropzone.addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    whDrawerDropzone.classList.remove('dragover');
  });

  whDrawerDropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    whDrawerDropzone.classList.remove('dragover');
    var files = e.dataTransfer.files;
    if (files.length > 0 && (files[0].type === 'application/pdf' || files[0].name.toLowerCase().endsWith('.pdf'))) {
      handleDrawerPDFFile(files[0]);
    }
  });

  whDrawerDropzone.addEventListener('click', function() {
    if (whDrawerFileInput) whDrawerFileInput.click();
  });
}

function handleDrawerPDFFile(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    if (typeof pdfjsLib !== 'undefined') {
      extractDrawerPDFWithPDFJS(e.target.result, file.name);
    } else {
      showDrawerWarning(window.I18n ? window.I18n.t('wormhole.warn.pdfjs.missing') : '❌ PDF解析库未加载，请刷新页面后重试。');
    }
  };
  reader.readAsArrayBuffer(file);
}

function extractDrawerPDFWithPDFJS(arrayBuffer, fileName) {
  if (typeof pdfjsLib === 'undefined') {
    showDrawerWarning(window.I18n ? window.I18n.t('wormhole.warn.pdfjs.missing') : '❌ PDF解析库未加载，请刷新页面后重试。');
    return;
  }

  pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function(pdf) {
    var numPages = pdf.numPages;
    var textParts = [];
    var completed = 0;

    function extractNext(idx) {
      if (idx > numPages) {
        processDrawerPDFText(textParts.join('\n'), fileName);
        return;
      }
      pdf.getPage(idx).then(function(page) {
        return page.getTextContent();
      }).then(function(textContent) {
        textParts.push(textContent.items.map(function(item) { return item.str; }).join(' '));
        completed++;
        extractNext(idx + 1);
      }).catch(function() {
        completed++;
        extractNext(idx + 1);
      });
    }
    extractNext(1);
  }).catch(function(err) {
    console.error('[Wormhole Drawer] PDF解析失败:', err);
  });
}

function processDrawerPDFText(text, fileName) {
  // 漏洞1: 文本校验
  if (!text || text.trim().length < 50) {
    var charCount = text ? text.trim().length : 0;
    if (charCount === 0) {
      whSuggestionEmpty.innerHTML = window.I18n ? window.I18n.t('wormhole.warn.no.text.layer') : '📷 此PDF无文本层（可能是扫描件）<br><span style="font-size:10px;">建议使用OCR工具转换</span>';
    } else {
      whSuggestionEmpty.innerHTML = window.I18n ? window.I18n.t('wormhole.warn.short.text.drawer', {count: charCount}) : ('⚠️ 文本过少（仅' + charCount + '字符）<br><span style="font-size:10px;">分析结果可能不准确</span>');
    }
    whSuggestionEmpty.style.display = '';
    if (whSuggestionList) whSuggestionList.innerHTML = '';
    if (charCount === 0) return;
  }

  if (window.AIWormhole && typeof window.AIWormhole.summarizePDF === 'function') {
    whSuggestionEmpty.innerHTML = window.I18n ? window.I18n.t('wormhole.analyzing.pdf') : '⏳ 正在分析PDF...';
    whSuggestionEmpty.style.display = '';

    window.AIWormhole.summarizePDF(text, fileName).then(function(result) {
      if (result.error && result.emptyText) {
        whSuggestionEmpty.innerHTML = '📷 ' + result.error.replace(/\n/g, '<br>');
        whSuggestionEmpty.style.display = '';
        return;
      }
      // 自动查找关联
      return findDrawerConnections(result.keywords);
    }).catch(function(err) {
      whSuggestionEmpty.innerHTML = window.I18n ? window.I18n.t('wormhole.analyze.fail', {msg: err.message}) : ('❌ 分析失败: ' + err.message);
      whSuggestionEmpty.style.display = '';
    });
  }
}

function findDrawerConnections(keywords) {
  var kp = (typeof knowledgePoints !== 'undefined') ? knowledgePoints : [];
  if (!kp.length) {
    whSuggestionEmpty.innerHTML = window.I18n ? window.I18n.t('wormhole.kb.empty') : '🪐 知识库为空<br><span style="font-size:10px;">请先收集一些知识点</span>';
    whSuggestionEmpty.style.display = '';
    return;
  }

  whSuggestionEmpty.innerHTML = window.I18n ? window.I18n.t('wormhole.finding') : '⏳ 查找关联中...';
  whSuggestionEmpty.style.display = '';

  if (window.AIWormhole && typeof window.AIWormhole.findConnections === 'function') {
    window.AIWormhole.findConnections(kp, { threshold: whThreshold }).then(function(edges) {
      whSuggestionEdges = edges.map(function(e) {
        return { from: e.from, to: e.to, strength: e.strength, reason: e.reason, accepted: false, rejected: false };
      });
      refreshSuggestions();
    }).catch(function() {
      whSuggestionEmpty.innerHTML = window.I18n ? window.I18n.t('wormhole.no.strong') : '🔍 未找到强关联连接';
      whSuggestionEmpty.style.display = '';
    });
  }
}

// ---- 阈值滑块 (漏洞5) ----
if (whThresholdSlider) {
  whThresholdSlider.addEventListener('input', function() {
    whThreshold = parseFloat(this.value);
    if (whThresholdVal) whThresholdVal.textContent = whThreshold.toFixed(2);

    // 防抖300ms
    if (whDebounceTimer) clearTimeout(whDebounceTimer);
    whDebounceTimer = setTimeout(function() {
      // 更新KnowLinkAI阈值
      if (window.KnowLinkAI && typeof window.KnowLinkAI.setConnectionThreshold === 'function') {
        window.KnowLinkAI.setConnectionThreshold(whThreshold);
      }
      refreshSuggestions();
      if (typeof renderGraph === 'function') renderGraph();
    }, 300);
  });
}

// ---- 刷新建议列表 ----
function refreshSuggestions() {
  if (!whSuggestionList || !whSuggestionEmpty) return;

  // 过滤: 按阈值过滤
  var filtered = whSuggestionEdges.filter(function(e) {
    return (e.strength / 100) >= whThreshold && !e.rejected;
  });

  // 漏洞5: 绝对上限35条
  filtered.sort(function(a, b) { return b.strength - a.strength; });
  var displayed = filtered.slice(0, 35);

  // 更新统计
  if (whConnectionCount) {
    var total = whSuggestionEdges.length;
    var visible = displayed.length;
    whConnectionCount.textContent = window.I18n ? window.I18n.t('wormhole.connection.count.detail', {visible: visible, total: total}) : ('匹配 ' + visible + ' 条连接（共 ' + total + ' 条建议）');
    if (visible > 30) {
      whConnectionCount.classList.add('warning');
      whConnectionCount.textContent += window.I18n ? window.I18n.t('wormhole.too.many') : ' ⚠️ 连接过多，建议提高阈值';
    } else {
      whConnectionCount.classList.remove('warning');
    }
  }

  if (displayed.length === 0) {
    whSuggestionEmpty.style.display = '';
    whSuggestionList.innerHTML = '';
    whSuggestionEmpty.innerHTML = whSuggestionEdges.length === 0
      ? (window.I18n ? window.I18n.t('wormhole.suggestions.empty') : '🪐 暂无AI建议连接<br><span style="font-size:10px;">分析PDF后将自动推荐关联</span>')
      : (window.I18n ? window.I18n.t('wormhole.no.match.threshold') : '🔍 当前阈值下无匹配连接<br><span style="font-size:10px;">尝试降低阈值或分析更多PDF</span>');
    return;
  }

  whSuggestionEmpty.style.display = 'none';
  whSuggestionList.innerHTML = '';

  var gn = (typeof graphNodes !== 'undefined') ? graphNodes : [];

  displayed.forEach(function(edge, idx) {
    var fromNode = gn[edge.from];
    var toNode = gn[edge.to];
    var fromLabel = fromNode ? (fromNode.fullText || fromNode.label || '').substring(0, 40) : (window.I18n ? window.I18n.t('wormhole.node', {id: edge.from}) : ('节点#' + edge.from));
    var toLabel   = toNode   ? (toNode.fullText   || toNode.label   || '').substring(0, 40) : (window.I18n ? window.I18n.t('wormhole.node', {id: edge.to}) : ('节点#' + edge.to));

    var statusClass = '';
    var statusIcon = '';
    if (edge.accepted) { statusClass = 'accepted'; statusIcon = '✅'; }
    else if (edge.rejected) { statusClass = 'rejected'; statusIcon = '❌'; }

    var li = document.createElement('li');
    li.className = 'wh-suggestion-item ' + statusClass;
    li.innerHTML =
      (statusIcon ? '<span class="wh-sugg-status">' + statusIcon + '</span>' : '') +
      '<div class="wh-sugg-nodes">' +
        '<span>' + escapeHtml(fromLabel) + '</span>' +
        ' ↔ ' +
        '<span>' + escapeHtml(toLabel) + '</span>' +
      '</div>' +
      '<div class="wh-sugg-strength">' +
        (window.I18n ? window.I18n.t('wormhole.strength', {s: edge.strength}) : ('关联度: ' + edge.strength + '% ')) +
        '<span class="strength-bar"><span class="strength-fill" style="width:' + edge.strength + '%"></span></span>' +
      '</div>' +
      '<div class="wh-sugg-actions">' +
        (edge.accepted
          ? '<button class="wh-reject">' + (window.I18n ? window.I18n.t('wormhole.remove') : '❌ 移除连接') + '</button>'
          : '<button class="wh-accept">' + (window.I18n ? window.I18n.t('wormhole.accept') : '✅ 接受') + '</button>' +
            '<button class="wh-reject">' + (window.I18n ? window.I18n.t('wormhole.reject') : '❌ 拒绝') + '</button>') +
      '</div>';

    // 接受按钮
    var acceptBtn = li.querySelector('.wh-accept');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', function() {
        edge.accepted = true;
        edge.rejected = false;
        // 添加到KnowLinkAI
        if (window.KnowLinkAI && typeof window.KnowLinkAI.addEdge === 'function') {
          window.KnowLinkAI.addEdge(edge.from, edge.to, edge.strength, edge.reason);
        }
        refreshSuggestions();
      });
    }

    // 拒绝/移除按钮
    var rejectBtn = li.querySelector('.wh-reject');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', function() {
        if (edge.accepted) {
          // 移除已接受的连接
          edge.accepted = false;
          edge.rejected = true;
          if (window.KnowLinkAI && typeof window.KnowLinkAI.removeAIEdge === 'function') {
            window.KnowLinkAI.removeAIEdge(edge.from, edge.to);
          }
        } else {
          edge.rejected = true;
        }
        refreshSuggestions();
      });
    }

    whSuggestionList.appendChild(li);
  });
}

// ---- 应用全部/清除全部 ----
if (btnWhApplyAll) {
  btnWhApplyAll.addEventListener('click', function() {
    var toApply = whSuggestionEdges.filter(function(e) { return !e.accepted && !e.rejected && (e.strength / 100) >= whThreshold; });
    if (toApply.length === 0) {
      alert(window.I18n ? window.I18n.t('wormhole.no.apply') : '没有可应用的连接建议');
      return;
    }
    if (!confirm(window.I18n ? window.I18n.t('wormhole.confirm.apply', {count: toApply.length}) : ('将应用 ' + toApply.length + ' 条连接建议，是否继续？'))) return;

    toApply.forEach(function(e) {
      e.accepted = true;
      if (window.KnowLinkAI && typeof window.KnowLinkAI.addEdge === 'function') {
        window.KnowLinkAI.addEdge(e.from, e.to, e.strength, e.reason);
      }
    });

    refreshSuggestions();
    if (typeof renderGraph === 'function') renderGraph();
  });
}

if (btnWhClearAll) {
  btnWhClearAll.addEventListener('click', function() {
    if (!confirm(window.I18n ? window.I18n.t('wormhole.confirm.clear') : '确定清除所有 AI 连线吗？此操作不可撤销。')) return;
    whSuggestionEdges = [];
    if (window.KnowLinkAI && typeof window.KnowLinkAI.removeAIEdges === 'function') {
      window.KnowLinkAI.removeAIEdges();
    }
    if (window.AIWormhole && typeof window.AIWormhole.removeAIEdges === 'function') {
      window.AIWormhole.removeAIEdges();
    }
    refreshSuggestions();
    if (typeof renderGraph === 'function') renderGraph();
  });
}

// ---- AI结果加载 (漏洞4: 状态同步) ----
function loadAIResults() {
  if (!window.AIWormhole || typeof window.AIWormhole.getAIEdges !== 'function') return;

  // 从持久化存储恢复连线
  var persistedEdges = window.AIWormhole.getAIEdges();
  if (persistedEdges.length > 0) {
    // 合并到建议列表（不与已接受的重复）
    var existingKeys = {};
    whSuggestionEdges.forEach(function(e) { existingKeys[e.from + '-' + e.to] = true; existingKeys[e.to + '-' + e.from] = true; });

    persistedEdges.forEach(function(e) {
      if (!existingKeys[e.from + '-' + e.to] && !existingKeys[e.to + '-' + e.from]) {
        whSuggestionEdges.push({
          from: e.from, to: e.to,
          strength: e.strength,
          reason: e.reason || 'ai-inferred',
          accepted: true,
          rejected: false
        });
      }
    });
  }

  // 从KnowLinkAI恢复
  if (window.KnowLinkAI && typeof window.KnowLinkAI.initFromWormhole === 'function') {
    window.KnowLinkAI.initFromWormhole();
  }

  refreshSuggestions();
}

// ---- 启动时初始化 ----
function initWormholeDrawer() {
  // 恢复阈值
  if (window.KnowLinkAI && typeof window.KnowLinkAI.getConnectionThreshold === 'function') {
    whThreshold = window.KnowLinkAI.getConnectionThreshold();
    if (whThresholdSlider) whThresholdSlider.value = whThreshold;
    if (whThresholdVal) whThresholdVal.textContent = whThreshold.toFixed(2);
  }

  loadAIResults();
}

// ---- 启动 ----
// file:// 或非扩展环境：chrome.storage 不可用，用空数据降级渲染
self.KBStore.init().then(function() {
  loadData();
  startAnimLoop();
  initWormholeDrawer();
}).catch(function(e) {
  console.warn('[Knowlink Network] KBStore 初始化失败（非扩展环境），使用空数据:', e && e.message);
  knowledgePoints = [];
  buildGraph();
  resizeCanvas();
  startAnimLoop();
});
