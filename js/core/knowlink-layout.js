// ====================================================================
//  KnowLink 知识星系 — 图计算与布局引擎 (knowlink-layout.js)
//  负责：图构建、知识簇检测、力模拟、布局计算、坐标系统
//  读取 graphNodes/graphEdges 全局变量，写入位置数据
//  由 knowlink-engine.js 和 knowlink-renderer.js 共享
// ====================================================================

// ---- 确定性随机（seeded RNG）----
// 修复: 用 mulberry32 + 字符串 hash 替代 Math.random()，保证相同输入产生相同布局
function hashString(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
function seededRandom(seed) {
  var t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 常量：领域颜色光谱 ----
var DOMAIN_COLORS = [
  '#ef4444', // 红 — 人文社科
  '#3b82f6', // 蓝 — 科学技术
  '#10b981', // 绿 — 自然生态
  '#f59e0b', // 金 — 实用技巧
  '#8b5cf6', // 紫 — 抽象思想
  '#ec4899', // 粉 — 艺术创意
  '#06b6d4', // 青 — 数据逻辑
  '#f97316', // 橙 — 生活经验
];

// ---- 全局知识簇数据 ----
var galaxies = [];  // { id, name, centerX, centerY, color, armAngle, nodeIds }

// ---- 节点 ID 查找表（稳定字符串 ID → 数组下标） ----
var _nodeIdToIndex = {};

function resolveNodeIndex(edgeEndpoint) {
  if (typeof edgeEndpoint === 'number') return edgeEndpoint;
  if (typeof edgeEndpoint === 'string') {
    var idx = _nodeIdToIndex[edgeEndpoint];
    if (idx !== undefined) return idx;
    // 修复: 查不到时打警告，帮助排查稳定 ID 失效问题
    console.warn('[Knowlink] resolveNodeIndex: 未找到稳定 ID "' + edgeEndpoint + '" 对应的节点下标');
    return -1;
  }
  return -1;
}

// 工具函数 escapeHtml / assignSourceColors 已移至 utils.js 共享

function normalizeUrl(raw) {
  if (!raw) return '';
  try {
    var u = new URL(raw);
    var host = u.hostname.replace(/^www\./, '');
    var path = u.pathname.replace(/\/$/, '');
    return 'https://' + host + path;
  } catch (e) {
    return raw.trim().toLowerCase();
  }
}

// 截断文本为最多 N 个词的短标签
// 中英文混合：按空格、标点、中文字符边界分词
function truncateToWords(text, maxWords) {
  if (!text) return '';
  // 按空格和常见分隔符拆分
  var tokens = text.split(/[\s,;，。；、：:！!？?·•\|/\\\(\)\[\]{}<>]+/).filter(function(t) { return t.length > 0; });
  if (tokens.length <= maxWords) return text.trim();
  return tokens.slice(0, maxWords).join(' ') + '…';
}

function extractKeywords(text) {
  if (!text) return [];
  var cleaned = text.replace(/[，。！？、；：""''【】《》（）\n\r\t.,!?;:'"()\[\]{}]/g, ' ');
  var cn = cleaned.match(/[一-鿿]{2,}/g) || [];
  var en = (cleaned.match(/[a-zA-Z]{3,}/g) || []).map(function(w) { return w.toLowerCase(); });
  return cn.concat(en).filter(function(v, i, a) { return a.indexOf(v) === i; });
}

// assignSourceColors 已移至 utils.js 共享

function screenToWorld(sx, sy, vt) {
  return {
    x: (sx - vt.offsetX) / vt.scale,
    y: (sy - vt.offsetY) / vt.scale
  };
}

// ---- 图计算 ----

function computeStrength(a, b) {
  var urlA = normalizeUrl(a.url);
  var urlB = normalizeUrl(b.url);
  if (urlA && urlB && urlA === urlB) return { strength: 100, reason: 'same-source' };

  try {
    var ua = new URL(a.url), ub = new URL(b.url);
    if (ua.hostname === ub.hostname && urlA !== urlB) return { strength: 75, reason: 'same-domain' };
  } catch (_) {}

  var wa = extractKeywords(a.text), wb = extractKeywords(b.text);
  if (wa.length && wb.length) {
    var intersect = wa.filter(function(w) { return wb.includes(w); });
    var ratio = (2 * intersect.length) / (wa.length + wb.length);
    var s = Math.round(ratio * 60);
    // 提高关键词建边阈值：只保留强关联（≥15），避免弱关联导致全连接
    if (s >= 15) return { strength: s, reason: 'keyword-overlap' };
  }
  return { strength: 0, reason: 'none' };
}

function computeStrengthCached(urlNormA, urlNormB, kwA, kwB, rawUrlA, rawUrlB) {
  if (urlNormA && urlNormB && urlNormA === urlNormB) return { strength: 100, reason: 'same-source' };

  try {
    var ua = new URL(rawUrlA), ub = new URL(rawUrlB);
    if (ua.hostname === ub.hostname && urlNormA !== urlNormB) return { strength: 75, reason: 'same-domain' };
  } catch (_) {}

  if (kwA.length && kwB.length) {
    var intersect = kwA.filter(function(w) { return kwB.includes(w); });
    var ratio = (2 * intersect.length) / (kwA.length + kwB.length);
    var s = Math.round(ratio * 60);
    // 提高关键词建边阈值：只保留强关联（≥15），避免弱关联导致全连接
    if (s >= 15) return { strength: s, reason: 'keyword-overlap' };
  }
  return { strength: 0, reason: 'none' };
}

// ---- 边叙事文案（替代百分比） ----
function getEdgeNarrative(reason, strength) {
  switch (reason) {
    case 'same-source':   return '📖 来自同一篇文章';
    case 'same-domain':   return '🌐 来自同一网站';
    case 'keyword-overlap':
      if (strength >= 40) return '💡 主题高度相关';
      if (strength >= 20) return '🔗 共享部分关键词';
      return '📎 略有交集';
    case 'ai-inferred':   return '🤖 AI 发现的深层关联';
    default:              return '—';
  }
}

// ====================================================================
//  知识簇检测 — 基于连通分量的社区发现
// ====================================================================
function detectGalaxies(graphNodes, graphEdges) {
  var n = graphNodes.length;
  if (!n) { galaxies = []; return; }

  // 构建邻接表（只考虑强关联边）
  var adj = {};
  for (var i = 0; i < n; i++) adj[i] = [];
  graphEdges.forEach(function(e) {
    if (e.strength >= 15) { // 只考虑强度>=15的边做聚类
      adj[e.from].push(e.to);
      adj[e.to].push(e.from);
    }
  });

  // BFS 连通分量
  var visited = {};
  var components = [];
  for (var i = 0; i < n; i++) {
    if (visited[i]) continue;
    var comp = [];
    var queue = [i];
    visited[i] = true;
    while (queue.length) {
      var v = queue.shift();
      comp.push(v);
      (adj[v] || []).forEach(function(w) {
        if (!visited[w]) { visited[w] = true; queue.push(w); }
      });
    }
    components.push(comp);
  }

  // 孤立的单节点合并到最近的知识簇
  var singletons = components.filter(function(c) { return c.length === 1; });
  var clusters   = components.filter(function(c) { return c.length > 1; });

  // 给每个知识簇分配颜色
  galaxies = clusters.map(function(comp, gi) {
    var color = DOMAIN_COLORS[gi % DOMAIN_COLORS.length];
    return {
      id: 'knowlink-' + gi,
      name: '知识星系 ' + (gi + 1),
      color: color,
      armAngle: seededRandom(hashString('knowlink-' + gi))() * Math.PI * 2,
      nodeIds: comp
    };
  });

  // 单节点分配到最近知识簇（基于关键词/来源相似度）
  singletons.forEach(function(sc) {
    var nodeId = sc[0];
    var bestKnowlink = galaxies[0];
    var bestScore = -1;
    galaxies.forEach(function(gal) {
      var score = 0;
      gal.nodeIds.forEach(function(gid) {
        graphEdges.forEach(function(e) {
          if ((e.from === nodeId && e.to === gid) || (e.to === nodeId && e.from === gid)) {
            score += e.strength;
          }
        });
      });
      if (score > bestScore) { bestScore = score; bestKnowlink = gal; }
    });
    if (bestKnowlink && bestScore > 0) {
      bestKnowlink.nodeIds.push(nodeId);
    } else if (galaxies.length > 0) {
      galaxies[0].nodeIds.push(nodeId);
    }
  });

  // 命名知识簇
  galaxies.forEach(function(gal) {
    // 统计节点中最常见的关键词来确定知识簇名称
    var allText = gal.nodeIds.map(function(id) {
      return graphNodes[id].fullText || '';
    }).join(' ');
    var kws = extractKeywords(allText);
    if (kws.length > 0) {
      gal.name = kws.slice(0, 2).join('·');
    }
  });

  // 回写节点的 knowlink 字段
  galaxies.forEach(function(gal) {
    gal.nodeIds.forEach(function(id) {
      graphNodes[id].knowlink = gal.id;
    });
  });

  console.log('[Knowlink] 检测到 ' + galaxies.length + ' 个知识簇，共 ' + n + ' 个节点');
  galaxies.forEach(function(g) {
    console.log('[Knowlink]   ' + g.name + ': ' + g.nodeIds.length + ' 个节点');
  });
}

// ====================================================================
//  知识簇布局引擎 — 螺旋布局 + 同源簇
// ====================================================================
function computeKnowlinkLayout(graphNodes, graphEdges, containerW, containerH) {
  var W = containerW || 800, H = containerH || 600;
  if (W < 10) W = 800; if (H < 10) H = 600;

  var n = graphNodes.length;
  if (!n) return;

  // 情形: 无知识簇 → 用默认圆形布局
  if (!galaxies.length) {
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.3;
    graphNodes.forEach(function(nd, i) {
      var a = (2 * Math.PI * i) / n - Math.PI / 2;
      nd.x = cx + R * Math.cos(a);
      nd.y = cy + R * Math.sin(a);
    });
    return;
  }

  // 每个知识簇分配一个中心位置
  var padding = 220;
  var galCount = galaxies.length;
  var cols = Math.ceil(Math.sqrt(galCount));
  var rows = Math.ceil(galCount / cols);
  var cellW = (W - padding * 2) / cols;
  var cellH = (H - padding * 2) / rows;

  galaxies.forEach(function(gal, gi) {
    var col = gi % cols, row = Math.floor(gi / cols);
    var cx = padding + cellW * (col + 0.5);
    var cy = padding + cellH * (row + 0.5);
    // 向画布中心压缩 50%，缩短知识簇间距离（左右知识簇更靠近）
    gal.centerX = W / 2 + (cx - W / 2) * 0.5;
    gal.centerY = H / 2 + (cy - H / 2) * 0.5;
  });

  // 在每个知识簇内部用螺旋布局排列节点
  galaxies.forEach(function(gal) {
    var ids = gal.nodeIds.slice(); // 修复: 复制后再排序，避免修改 gal.nodeIds
    if (!ids.length) return;
    var cx = gal.centerX, cy = gal.centerY;

    // 按节点重要性（边数）排序，核心节点靠近中心
    var deg = {};
    graphEdges.forEach(function(e) {
      deg[e.from] = (deg[e.from] || 0) + 1;
      deg[e.to]   = (deg[e.to]   || 0) + 1;
    });
    ids.sort(function(a, b) { return (deg[b] || 0) - (deg[a] || 0); });

    var armCount = Math.max(2, Math.min(4, Math.ceil(ids.length / 6)));
    var maxR = Math.min(cellW, cellH) * 0.28;  // 减小 maxR，知识簇更紧凑

    ids.forEach(function(nodeId, i) {
      var nd = graphNodes[nodeId];
      if (!nd) return;

      // 对数螺线: r = a * e^(b*theta)
      var armIndex = i % armCount;
      var armAngle = gal.armAngle + (armIndex / armCount) * Math.PI * 2;
      var t = Math.floor(i / armCount) / (Math.ceil(ids.length / armCount) || 1);
      var r = t * maxR + 40;
      var angle = armAngle + t * 2.5; // 螺线旋转

      nd.x = cx + r * Math.cos(angle);
      nd.y = cy + r * Math.sin(angle);

      // 核心节点更大（缩小：与文字大小接近）
      var importance = (deg[nodeId] || 0) + 1;
      nd.radius = 3 + Math.min(importance * 1.0, 6) + Math.min(nd.fullText.length * 0.04, 2);
      nd.importance = importance;
    });
  });

  // 同源节点的同源簇偏移
  var sourceGroups = {};
  graphNodes.forEach(function(nd) {
    if (!nd.url) return;
    var key = normalizeUrl(nd.url);
    if (!sourceGroups[key]) sourceGroups[key] = [];
    sourceGroups[key].push(nd.id);
  });

  Object.keys(sourceGroups).forEach(function(key) {
    var group = sourceGroups[key];
    if (group.length < 2) return;
    var parent = group[0];
    var px = graphNodes[parent].x, py = graphNodes[parent].y;
    for (var s = 1; s < group.length; s++) {
      var child = graphNodes[group[s]];
      var orbitR = 30 + s * 22;
      var orbitA = (s / group.length) * Math.PI * 2 + seededRandom(hashString('orbit-' + parent))() * 0.5;
      child.x = px + orbitR * Math.cos(orbitA);
      child.y = py + orbitR * Math.sin(orbitA);
      child.orbitParent = parent;
      child.orbitRadius  = orbitR;
      child.orbitAngle   = orbitA;
    }
  });

  // 运行力导向松弛迭代
  runKnowlinkForceSimulation(graphNodes, graphEdges, W, H);
}

function runKnowlinkForceSimulation(graphNodes, graphEdges, W, H) {
  var n = graphNodes.length;
  if (!n) return;
  var ITER = 40, DAMP = 0.8;

  for (var iter = 0; iter < ITER; iter++) {
    var forces = graphNodes.map(function() { return { fx: 0, fy: 0 }; });

    // 排斥力
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var dx = graphNodes[j].x - graphNodes[i].x;
        var dy = graphNodes[j].y - graphNodes[i].y;
        var d  = Math.sqrt(dx*dx + dy*dy) || 1;
        if (d < 1) d = 1;
        var f  = 2000 / (d * d);
        var ffx = (dx / d) * f, ffy = (dy / d) * f;
        forces[i].fx -= ffx; forces[i].fy -= ffy;
        forces[j].fx += ffx; forces[j].fy += ffy;
      }
    }

    // 边引力 (弹簧)
    graphEdges.forEach(function(e) {
      var from = graphNodes[e.from], to = graphNodes[e.to];
      if (!from || !to) return;
      var dx = to.x - from.x, dy = to.y - from.y;
      var d  = Math.sqrt(dx*dx + dy*dy) || 1;
      // 越相关越近：strength 越高理想距离越短（同源 100→50px，弱关联→104px）
      var ideal = 140 - e.strength * 0.9;
      // 同源边（strength 100）加强弹簧系数，保证同源节点紧密聚集
      var k = e.strength >= 100 ? 0.012 : 0.004;
      var f = (d - ideal) * k;
      var ffx = (dx / d) * f, ffy = (dy / d) * f;
      forces[e.from].fx += ffx; forces[e.from].fy += ffy;
      forces[e.to  ].fx -= ffx; forces[e.to  ].fy -= ffy;
    });

    // 知识簇中心引力 + 知识簇间排斥
    graphNodes.forEach(function(nd, i) {
      // 拉向所属知识簇中心
      if (nd.knowlink) {
        var gal = galaxies.find(function(g) { return g.id === nd.knowlink; });
        if (gal) {
          forces[i].fx += (gal.centerX - nd.x) * 0.003;
          forces[i].fy += (gal.centerY - nd.y) * 0.003;
        }
      }
      // 知识簇间排斥：其他知识簇中心推开本知识簇节点（减弱，配合中心压缩）
      galaxies.forEach(function(other) {
        if (other.id === nd.knowlink) return;
        var dx = nd.x - other.centerX, dy = nd.y - other.centerY;
        var d = Math.sqrt(dx*dx + dy*dy) || 1;
        var f = 400 / (d * d);  // 知识簇间排斥力（减弱）
        forces[i].fx += (dx / d) * f;
        forces[i].fy += (dy / d) * f;
      });
      // 全局中心引力（把知识簇拉向中间）
      forces[i].fx += (W/2 - nd.x) * 0.0005;
      forces[i].fy += (H/2 - nd.y) * 0.0005;

      nd.x += forces[i].fx * DAMP;
      nd.y += forces[i].fy * DAMP;
    });
  }
}

// ====================================================================
//  增量图更新（Phase 4a）
// ====================================================================

// 向已有图谱中增量添加节点
// 返回新节点的数组下标列表
function addNodesToGraph(newPoints, containerW, containerH) {
  var W = containerW || 800, H = containerH || 600;
  if (W < 10) W = 800; if (H < 10) H = 600;

  var newCount = newPoints.length;
  if (!newCount) return [];

  var existingCount = graphNodes.length;
  var newIndices = [];
  var keywordCache = [];
  var urlCache = [];

  // 预计算所有节点的关键词和URL缓存（增量版）
  for (var i = 0; i < existingCount; i++) {
    var ept = knowledgePoints[i] || {};
    keywordCache[i] = extractKeywords(ept.text || '');
    urlCache[i] = normalizeUrl(ept.url || '');
  }

  // 创建新节点
  for (var j = 0; j < newCount; j++) {
    var p = newPoints[j];
    var title = p.title || '';
    var txt = p.text || title || '';
    var rawLabel = title || txt;
    var label = truncateToWords(rawLabel, 5);
    var idx = existingCount + j;
    var sid = p.id || ('_idx_' + idx);
    _nodeIdToIndex[sid] = idx;

    graphNodes.push({
      id: idx,
      stableId: sid,
      label:    label,
      fullText: txt,
      source:   p.source || '',
      url:      p.url || '',
      page:     p.page || 0,
      color:    sourceColorMap[p.url] || SOURCE_COLORS[idx % SOURCE_COLORS.length],
      x: 0, y: 0,
      radius: 3 + Math.min(label.length * 0.3, 4),
      matchesFilter: true,
      knowlink: null,
      importance: 1,
      orbitParent: null,
      orbitRadius: 0,
      orbitAngle: 0,
      glowPhase: seededRandom(hashString('glow-' + sid))() * Math.PI * 2
    });

    // 缓存新节点的关键词和URL
    keywordCache[idx] = extractKeywords(txt);
    urlCache[idx] = normalizeUrl(p.url || '');

    newIndices.push(idx);
  }

  // 增量计算边：只计算 newPoints × allPoints
  // 已有节点间边保持不变
  var newEdges = [];
  for (var ni = 0; ni < newCount; ni++) {
    var newIdx = existingCount + ni;
    var newPt = newPoints[ni];

    // 新节点与已有节点的边
    for (var ei = 0; ei < existingCount; ei++) {
      var result = computeStrengthCached(
        urlCache[newIdx], urlCache[ei],
        keywordCache[newIdx], keywordCache[ei],
        newPt.url || '', (knowledgePoints[ei] || {}).url || ''
      );
      if (result.strength > 0) {
        newEdges.push({
          id: newIdx + '-' + ei, from: newIdx, to: ei,
          strength: result.strength,
          reason: result.reason,
          narrative: getEdgeNarrative(result.reason, result.strength),
          visualStrength: result.strength / 100,
          bidirectional: true
        });
      }
    }

    // 新节点之间的边
    for (var nj = ni + 1; nj < newCount; nj++) {
      var otherIdx = existingCount + nj;
      var otherPt = newPoints[nj];
      var result2 = computeStrengthCached(
        urlCache[newIdx], urlCache[otherIdx],
        keywordCache[newIdx], keywordCache[otherIdx],
        newPt.url || '', otherPt.url || ''
      );
      if (result2.strength > 0) {
        newEdges.push({
          id: newIdx + '-' + otherIdx, from: newIdx, to: otherIdx,
          strength: result2.strength,
          reason: result2.reason,
          narrative: getEdgeNarrative(result2.reason, result2.strength),
          visualStrength: result2.strength / 100,
          bidirectional: true
        });
      }
    }
  }

  // 合并边到 graphEdges（去重）
  var existingKeys = {};
  graphEdges.forEach(function(e) { existingKeys[e.from + '-' + e.to] = true; });
  newEdges.forEach(function(e) {
    var key = e.from + '-' + e.to;
    if (!existingKeys[key]) {
      graphEdges.push(e);
      existingKeys[key] = true;
    }
  });

  // 放置新节点：靠近其最强连接的已有节点
  newIndices.forEach(function(newIdx) {
    var bestEdge = null;
    // 找到新节点与已有节点的最强边
    for (var k = 0; k < graphEdges.length; k++) {
      var edge = graphEdges[k];
      if ((edge.from === newIdx && edge.to < existingCount) ||
          (edge.to === newIdx && edge.from < existingCount)) {
        if (!bestEdge || edge.strength > bestEdge.strength) bestEdge = edge;
      }
    }
    var nd = graphNodes[newIdx];
    if (bestEdge) {
      var neighborIdx = bestEdge.from === newIdx ? bestEdge.to : bestEdge.from;
      var neighbor = graphNodes[neighborIdx];
      // 放置在邻居附近（确定性随机偏移）
      var rnd = seededRandom(hashString('new-' + newIdx));
      var angle = rnd() * Math.PI * 2;
      var dist = 80 + rnd() * 120;
      nd.x = neighbor.x + Math.cos(angle) * dist;
      nd.y = neighbor.y + Math.sin(angle) * dist;
    } else {
      // 无连接则放置在视图中心附近（确定性随机偏移）
      var rndFree = seededRandom(hashString('new-free-' + newIdx));
      nd.x = W / 2 + (rndFree() - 0.5) * 200;
      nd.y = H / 2 + (rndFree() - 0.5) * 200;
    }
  });

  console.log('[Knowlink] 增量添加: +' + newCount + ' 节点, +' + newEdges.length + ' 条边 (总计 ' + graphNodes.length + ' 节点, ' + graphEdges.length + ' 边)');

  return newIndices;
}

// ====================================================================
//  增量力模拟（Phase 4b）
// ====================================================================

// 仅对新节点及其一度邻居运行轻量力模拟
// 其他已有节点位置锁定（冻结）
function relaxNewNodes(newNodeIndices, iterations) {
  var ITER = iterations || 6;
  var DAMP = 0.65;
  var n = graphNodes.length;
  if (!n) return;

  // 确定参与节点：新节点 + 一度邻居
  var participating = {};
  newNodeIndices.forEach(function(i) { participating[i] = true; });

  // 找一度邻居（与任何新节点有边连接的已有节点）
  graphEdges.forEach(function(e) {
    if (participating[e.from] && e.to < n) participating[e.to] = true;
    if (participating[e.to] && e.from < n) participating[e.from] = true;
  });

  var partList = Object.keys(participating).map(Number);
  if (partList.length < 2) return;

  // 轻量力模拟
  for (var iter = 0; iter < ITER; iter++) {
    var forces = {};
    partList.forEach(function(i) { forces[i] = { fx: 0, fy: 0 }; });

    // 排斥力（仅在参与节点之间）
    for (var a = 0; a < partList.length; a++) {
      for (var b = a + 1; b < partList.length; b++) {
        var i = partList[a], j = partList[b];
        var dx = graphNodes[j].x - graphNodes[i].x;
        var dy = graphNodes[j].y - graphNodes[i].y;
        var d  = Math.sqrt(dx*dx + dy*dy) || 1;
        if (d < 1) d = 1;
        var f  = 2000 / (d * d);
        var ffx = (dx / d) * f, ffy = (dy / d) * f;
        forces[i].fx -= ffx; forces[i].fy -= ffy;
        forces[j].fx += ffx; forces[j].fy += ffy;
      }
    }

    // 边引力（仅涉及参与节点的边）
    graphEdges.forEach(function(e) {
      if (!participating[e.from] && !participating[e.to]) return;
      var from = graphNodes[e.from], to = graphNodes[e.to];
      if (!from || !to) return;
      var dx = to.x - from.x, dy = to.y - from.y;
      var d  = Math.sqrt(dx*dx + dy*dy) || 1;
      // 越相关越近：strength 越高理想距离越短（同源 100→50px，弱关联→104px）
      var ideal = 140 - e.strength * 0.9;
      // 同源边（strength 100）加强弹簧系数，保证同源节点紧密聚集
      var k = e.strength >= 100 ? 0.012 : 0.004;
      var f = (d - ideal) * k;
      var ffx = (dx / d) * f, ffy = (dy / d) * f;
      if (forces[e.from]) { forces[e.from].fx += ffx; forces[e.from].fy += ffy; }
      if (forces[e.to])   { forces[e.to].fx -= ffx; forces[e.to].fy -= ffy; }
    });

    // 知识簇中心引力（仅对参与节点）
    partList.forEach(function(i) {
      var nd = graphNodes[i];
      if (nd.knowlink) {
        var gal = galaxies.find(function(g) { return g.id === nd.knowlink; });
        if (gal) {
          forces[i].fx += (gal.centerX - nd.x) * 0.003;
          forces[i].fy += (gal.centerY - nd.y) * 0.003;
        }
      }
      nd.x += forces[i].fx * DAMP;
      nd.y += forces[i].fy * DAMP;
    });
  }

  console.log('[Knowlink] 增量力模拟完成: ' + partList.length + ' 个参与节点, ' + ITER + ' 次迭代');
}

// ====================================================================
//  图构建
// ====================================================================
function buildKnowlinkGraph(knowledgePoints, filterText) {
  var n = knowledgePoints.length;
  if (!n) { graphNodes = []; graphEdges = []; return; }

  var sourceColorMap = {};
  assignSourceColors(knowledgePoints, sourceColorMap);

  var keywordCache = knowledgePoints.map(function(p) { return extractKeywords(p.text); });
  var urlCache     = knowledgePoints.map(function(p) { return normalizeUrl(p.url); });

  graphNodes = knowledgePoints.map(function(p, i) {
    var title = p.title || '';
    var txt = p.text || '';
    // 优先使用 AI 提取的短标题（概念级），降级使用全文
    var rawLabel = title || txt;
    // 限制为 ~5 个词的简洁概念标签
    var label = truncateToWords(rawLabel, 5);
    // 注册稳定 ID → 数组下标映射
    var sid = p.id || ('_idx_' + i);
    _nodeIdToIndex[sid] = i;
    return {
      id: i,
      stableId: sid,
      label:    label,
      fullText: txt,
      source:   p.source || '',
      url:      p.url || '',
      // 存储页码（用于 PDF 跳转定位）
      page:     p.page || 0,
      color:    sourceColorMap[p.url] || SOURCE_COLORS[i % SOURCE_COLORS.length],
      x: 0, y: 0,
      radius: 3 + Math.min(label.length * 0.3, 4),
      matchesFilter: true,
      knowlink: null,
      importance: 1,
      orbitParent: null,
      orbitRadius: 0,
      orbitAngle: 0,
      glowPhase: seededRandom(hashString('glow-' + sid))() * Math.PI * 2
    };
  });

  graphEdges = [];
  var ft = filterText ? filterText.toLowerCase().trim() : '';

  // 每节点最大边数限制（避免 hub 节点连接一切导致全连接）
  var MAX_EDGES_PER_NODE = 6;
  var edgeCount = {};  // 每个节点的当前边数

  for (var i = 0; i < n; i++) {
    if (ft) {
      var p = knowledgePoints[i];
      graphNodes[i].matchesFilter = (p.text || '').toLowerCase().includes(ft) ||
                                     (p.source || '').toLowerCase().includes(ft) ||
                                     (p.url || '').toLowerCase().includes(ft);
    } else {
      graphNodes[i].matchesFilter = true;
    }

    for (var j = i + 1; j < n; j++) {
      var result = computeStrengthCached(
        urlCache[i], urlCache[j],
        keywordCache[i], keywordCache[j],
        knowledgePoints[i].url, knowledgePoints[j].url
      );
      if (result.strength > 0) {
        // 每节点边数上限：超过则跳过（保留强关联，避免全连接）
        if ((edgeCount[i] || 0) >= MAX_EDGES_PER_NODE || (edgeCount[j] || 0) >= MAX_EDGES_PER_NODE) continue;
        edgeCount[i] = (edgeCount[i] || 0) + 1;
        edgeCount[j] = (edgeCount[j] || 0) + 1;
        graphEdges.push({
          id: i + '-' + j, from: i, to: j,
          strength: result.strength,
          reason: result.reason,
          narrative: getEdgeNarrative(result.reason, result.strength),
          visualStrength: result.strength / 100,
          bidirectional: true
        });
      }
    }
  }

  console.log('[Knowlink] 构建图: ' + n + ' 节点, ' + graphEdges.length + ' 条边');

  // 自动检测知识簇
  detectGalaxies(graphNodes, graphEdges);
}

// ====================================================================
//  交互 — hover / 坐标检测
// ====================================================================
function findNodeAt(mx, my, vt) {
  var world = screenToWorld(mx, my, vt);
  for (var i = graphNodes.length - 1; i >= 0; i--) {
    var nd = graphNodes[i];
    var hitR = nd.radius + 6;
    if (Math.hypot(world.x - nd.x, world.y - nd.y) < hitR) {
      return i;
    }
  }
  return null;
}
