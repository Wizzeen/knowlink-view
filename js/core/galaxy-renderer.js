// ====================================================================
//  KnowLink 知识星系 — Canvas 2D 渲染管线 (galaxy-renderer.js)
//  负责：背景、节点、边、标签渲染、入场动画、主渲染循环
//  读取 graphNodes/graphEdges/galaxies 全局变量（由 galaxy-layout.js 写入）
//  支持主题：obsidian（默认，纯色简洁）/ space（深空星系）
// ====================================================================

// ====================================================================
//  主题系统
// ====================================================================
var GALAXY_THEMES = {
  // Obsidian 纯色简洁风格（默认）
  obsidian: {
    name: 'Obsidian 简洁',
    background: '#f2f0ec',          // 柔和暖灰白（Obsidian 风格，低明度不刺眼）
    backgroundGrad: '#ece9e4',      // 微渐变底色
    showStarfield: false,           // 不显示星场
    showNebulae: false,             // 不显示星云
    showDust: false,                // 不显示微尘
    nodeFill: 'rgba(0,0,0,0.08)',   // 节点填充（浅灰）
    nodeColor: '#666666',           // Obsidian 关系图谱：灰色圆点（点击后变黑）
    nodeColorActive: '#000000',     // 聚焦/选中时黑色
    nodeBorder: 'rgba(0,0,0,0)',    // obsidian 无边框
    nodeBorderHover: '#000000',     // hover 边框
    labelColor: '#333333',          // 标签颜色
    labelHover: '#000000',          // hover 标签
    labelShadow: 'rgba(255,255,255,0.9)',  // 白底用白阴影（避免模糊）
    edgeKeyword: 'rgba(0,0,0,0.15)',    // 关键词边
    edgeKeywordHover: 'rgba(0,0,0,0.5)',
    edgeSameSource: 'rgba(245,158,11,0.6)',   // 同源边（金色）
    edgeSameSourceHover: 'rgba(245,158,11,0.9)',
    edgeSameDomain: 'rgba(59,130,246,0.5)',   // 同域边（蓝）
    edgeSameDomainHover: 'rgba(59,130,246,0.8)',
    edgeAI: 'rgba(139,92,246,0.5)',           // AI 边（紫）
    edgeAIHover: 'rgba(139,92,246,0.9)',
    emptyText: '#999999',
    focusRing: 'rgba(0,0,0,0.15)',
    selectedRing: 'rgba(245,158,11,0.6)',
    glowColor: 'rgba(0,0,0,0.2)'
  },
  // 深空星系风格（可选）
  space: {
    name: '深空星系',
    background: '#060610',
    backgroundGrad: '#0d0d28',
    showStarfield: true,
    showNebulae: true,
    showDust: true,
    nodeFill: 'rgba(255,255,255,0.75)',
    nodeColor: null,                    // space 用彩色渐变
    nodeBorder: 'rgba(255,255,255,0.25)',
    nodeBorderHover: '#ffffff',
    labelColor: 'rgba(255,255,255,0.92)',
    labelHover: '#ffffff',
    labelShadow: 'rgba(0,0,0,0.9)',     // 深空用黑阴影
    edgeKeyword: 'rgba(180,190,210,0.25)',
    edgeKeywordHover: 'rgba(200,210,230,0.7)',
    edgeSameSource: 'rgba(245,158,11,0.4)',
    edgeSameSourceHover: 'rgba(245,158,11,0.85)',
    edgeSameDomain: 'rgba(59,130,246,0.35)',
    edgeSameDomainHover: 'rgba(59,130,246,0.8)',
    edgeAI: 'rgba(139,92,246,0.45)',
    edgeAIHover: 'rgba(139,92,246,0.9)',
    emptyText: '#9ca3af',
    focusRing: 'rgba(255,255,255,0.3)',
    selectedRing: 'rgba(245,158,11,0.5)',
    glowColor: 'rgba(255,255,255,0.18)'
  }
};

// 当前主题（默认 obsidian）
var _galaxyTheme = 'obsidian';

function getGalaxyTheme() {
  return _galaxyTheme;
}

function setGalaxyTheme(name) {
  if (GALAXY_THEMES[name]) _galaxyTheme = name;
  return _galaxyTheme;
}

function theme() {
  return GALAXY_THEMES[_galaxyTheme] || GALAXY_THEMES.obsidian;
}

// ---- 深空背景色（space 主题用） ----
var SPACE_BG        = '#060610';
var SPACE_BG_GRAD   = '#0d0d28';
var NEBULA_COLORS   = ['rgba(59,130,246,0.05)', 'rgba(139,92,246,0.05)', 'rgba(99,102,241,0.04)', 'rgba(236,72,153,0.03)'];

// ====================================================================
//  深空背景粒子系统
// ====================================================================
var starParticles = [];

// 星体颜色光谱 (用于背景星的不同色温)
var STAR_SPECTRUM = [
  'rgba(255,255,255,__A__)',      // 纯白
  'rgba(200,215,255,__A__)',     // 蓝白
  'rgba(255,245,220,__A__)',     // 暖黄
  'rgba(180,200,255,__A__)',     // 淡蓝
  'rgba(255,220,200,__A__)',     // 暖橙
];

function initStarParticles(W, H) {
  starParticles = [];
  var count = Math.floor((W * H) / 1000); // 增加密度
  if (count < 120) count = 120;
  if (count > 800) count = 800; // 提高上限，避免大屏星星太少
  // 大幅扩大生成区域：覆盖视口 16 倍范围 (世界坐标 -6W~10W, -6H~10H)
  // 确保在最小缩放级别 (0.15x) 时仍有充足星星覆盖整个可见区域
  var areaW = W * 16;
  var areaH = H * 16;
  var offsetX = -W * 6;
  var offsetY = -H * 6;
  for (var i = 0; i < count; i++) {
    var colorIdx = Math.floor(Math.random() * STAR_SPECTRUM.length);
    starParticles.push({
      x: Math.random() * areaW + offsetX,
      y: Math.random() * areaH + offsetY,
      r: Math.random() * 1.8 + 0.2,
      twinkle: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.025 + 0.003,
      alpha: Math.random() * 0.5 + 0.25,
      colorIdx: colorIdx,
      // 稀疏的十字星芒 (亮度高的星星有)
      hasCross: Math.random() < 0.08
    });
  }
}

function renderStarfield(ctx, vt, W, H, time) {
  var T = theme();

  // 背景：obsidian 纯色 / space 深空渐变
  if (!T.showStarfield) {
    ctx.fillStyle = T.background;
    ctx.fillRect(-vt.offsetX / vt.scale, -vt.offsetY / vt.scale, W / vt.scale, H / vt.scale);
    return;
  }

  // 深空背景渐变 — 使用视口中心的世界坐标，避免缩放/平移时的拖影
  var worldCX = (W/2 - vt.offsetX) / vt.scale;
  var worldCY = (H/2 - vt.offsetY) / vt.scale;
  var gradR = Math.max(W, H) * 0.9 / vt.scale;
  var grad = ctx.createRadialGradient(worldCX, worldCY, 0, worldCX, worldCY, Math.max(gradR, 100));
  grad.addColorStop(0, '#0d0d2b');
  grad.addColorStop(0.4, '#08081f');
  grad.addColorStop(0.7, '#050514');
  grad.addColorStop(1, '#020208');
  ctx.fillStyle = grad;
  ctx.fillRect(-vt.offsetX / vt.scale, -vt.offsetY / vt.scale, W / vt.scale, H / vt.scale);

  // 星场粒子
  starParticles.forEach(function(s) {
    s.twinkle += s.speed;
    var twinkleVal = Math.sin(s.twinkle);
    var alpha = s.alpha + twinkleVal * 0.35;
    alpha = Math.max(0.08, Math.min(0.95, alpha));

    // 使用色温光谱
    var baseColor = STAR_SPECTRUM[s.colorIdx];
    var color = baseColor.replace('__A__', alpha.toFixed(3));

    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // 亮星加辉光
    if (s.r > 1.0) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = baseColor.replace('__A__', (alpha * 0.12).toFixed(4));
      ctx.fill();
    }

    // 十字星芒效果 (最亮的星星)
    if (s.hasCross && s.r > 1.2 && alpha > 0.7) {
      var crossAlpha = alpha * 0.25;
      ctx.strokeStyle = baseColor.replace('__A__', crossAlpha.toFixed(4));
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(s.x - s.r * 5, s.y);
      ctx.lineTo(s.x + s.r * 5, s.y);
      ctx.moveTo(s.x, s.y - s.r * 5);
      ctx.lineTo(s.x, s.y + s.r * 5);
      ctx.stroke();
    }
  });
}

// ---- 辅助: hex 转 rgba ----
function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return 'rgba(139,92,246,' + alpha + ')';
  var r = parseInt(hex.slice(1,3), 16);
  var g = parseInt(hex.slice(3,5), 16);
  var b = parseInt(hex.slice(5,7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ---- 辅助: hex 颜色变亮/变暗（percent: -1 到 1，负变暗正变亮） ----
function shadeColor(hex, percent) {
  if (!hex || hex[0] !== '#') return hex;
  var r = parseInt(hex.slice(1,3), 16);
  var g = parseInt(hex.slice(3,5), 16);
  var b = parseInt(hex.slice(5,7), 16);
  var t = percent < 0 ? 0 : 255;
  var p = Math.abs(percent);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ---- 星云渲染 ----
function renderNebulae(ctx, vt) {
  if (!theme().showNebulae) return;
  // 在每个星系中心渲染多层柔和光晕
  galaxies.forEach(function(gal) {
    if (!gal.nodeIds || gal.nodeIds.length < 3) return;
    var cx = gal.centerX, cy = gal.centerY;

    // 外层大范围柔光
    var outerGrad = ctx.createRadialGradient(cx, cy, 50, cx, cy, 280);
    outerGrad.addColorStop(0, hexToRgba(gal.color, 0.05));
    outerGrad.addColorStop(0.4, hexToRgba(gal.color, 0.02));
    outerGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 280, 0, Math.PI * 2);
    ctx.fill();

    // 内层核心柔光
    var innerGrad = ctx.createRadialGradient(cx, cy, 15, cx, cy, 100);
    innerGrad.addColorStop(0, hexToRgba(gal.color, 0.1));
    innerGrad.addColorStop(0.5, hexToRgba(gal.color, 0.04));
    innerGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = innerGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 100, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ---- 星系中心微尘 ----
var galaxyDustParticles = [];
var galaxyDustGeneratedFor = ''; // 跟踪是为哪些星系生成的

function initGalaxyDust() {
  galaxyDustParticles = [];
  galaxyDustGeneratedFor = galaxies.map(function(g) { return g.id + ':' + g.nodeIds.length; }).join(',');
  galaxies.forEach(function(gal) {
    var count = Math.min((gal.nodeIds || []).length * 6, 50);
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var dist = 30 + Math.random() * 180;
      galaxyDustParticles.push({
        gx: gal.centerX + Math.cos(angle) * dist,
        gy: gal.centerY + Math.sin(angle) * dist,
        r: Math.random() * 0.8 + 0.2,
        alpha: Math.random() * 0.3 + 0.05,
        speed: Math.random() * 0.003 + 0.001,
        phase: Math.random() * Math.PI * 2,
        orbitCenterX: gal.centerX,
        orbitCenterY: gal.centerY,
        orbitDist: dist,
        orbitAngle: angle,
        color: gal.color
      });
    }
  });
}

function renderGalaxyDust(ctx, vt, time) {
  if (!theme().showDust) return;
  // 检查是否需要重新生成
  var currentSig = galaxies.map(function(g) { return g.id + ':' + g.nodeIds.length; }).join(',');
  if (galaxyDustGeneratedFor !== currentSig) {
    initGalaxyDust();
  }

  if (!galaxyDustParticles.length) return;
  galaxyDustParticles.forEach(function(d) {
    d.phase += d.speed;
    d.alpha += Math.sin(d.phase) * 0.04;
    d.alpha = Math.max(0.03, Math.min(0.35, d.alpha));

    var colorStr = hexToRgba(d.color, d.alpha);

    ctx.beginPath();
    ctx.arc(d.gx, d.gy, d.r, 0, Math.PI * 2);
    ctx.fillStyle = colorStr;
    ctx.fill();
  });
}

// ---- 边渲染 ----
function renderGalaxyEdges(ctx, vt, allEdges, hoveredNode, focusedNode, filterText, time) {
  var ft = filterText ? filterText.toLowerCase().trim() : '';

  allEdges.forEach(function(e) {
    var fromIdx = resolveNodeIndex(e.from);
    var toIdx   = resolveNodeIndex(e.to);
    var from = graphNodes[fromIdx], to = graphNodes[toIdx];
    if (!from || !to) return;

    // 聚焦模式：淡化不相关边
    var hl = false;
    if (focusedNode !== null && focusedNode !== undefined) {
      hl = (focusedNode === fromIdx || focusedNode === toIdx);
    } else if (hoveredNode !== null && hoveredNode !== undefined) {
      hl = (hoveredNode === fromIdx || hoveredNode === toIdx);
    }

    var alpha = 0.35;
    if (focusedNode !== null && focusedNode !== undefined) {
      alpha = hl ? 0.8 : 0.04;
    } else if (ft) {
      if (!from.matchesFilter && !to.matchesFilter) alpha = 0.03;
      else if (!from.matchesFilter || !to.matchesFilter) alpha = 0.1;
      else alpha = 0.55;
    } else if (hl) {
      alpha = 0.9;
    }

    var vs = e.visualStrength !== undefined ? e.visualStrength : (e.strength / 100);
    var reason = e.reason || 'keyword-overlap';
    var T = theme();

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);

    // 颜色与样式按连接类型（主题化）
    if (reason === 'ai-inferred') {
      // AI 边: 紫色虚线
      ctx.strokeStyle = hl ? T.edgeAIHover : T.edgeAI;
      ctx.lineWidth   = hl ? 3 : 1.2 + vs * 1.5;
      ctx.setLineDash([2, 8]);
    } else if (reason === 'same-source') {
      // 同源: 金色实线
      ctx.strokeStyle = hl ? T.edgeSameSourceHover : T.edgeSameSource;
      ctx.lineWidth   = hl ? 3.5 : 1.5 + vs * 2;
      ctx.setLineDash([]);
    } else if (reason === 'same-domain') {
      // 同域名: 蓝色虚点线
      ctx.strokeStyle = hl ? T.edgeSameDomainHover : T.edgeSameDomain;
      ctx.lineWidth   = hl ? 2.8 : 1.2 + vs * 1.5;
      ctx.setLineDash([6, 6]);
    } else {
      // 关键词: 半透明连线
      ctx.strokeStyle = hl ? T.edgeKeywordHover : T.edgeKeyword;
      ctx.lineWidth   = hl ? 2.2 : 0.8 + vs * 1.2;
      ctx.setLineDash([3, 8]);
    }

    // 辉光效果 — 使用 shadowBlur
    if (hl) {
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 8;
    }

    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // 不显示百分比标签 — 悬停时显示叙事文案在 tooltip 中
  });
}

// ---- 节点渲染 ----
function renderGalaxyNodes(ctx, vt, hoveredNode, focusedNode, selectedNode, filterText, time) {
  var ft = filterText ? filterText.toLowerCase().trim() : '';

  graphNodes.forEach(function(nd, i) {
    var hl = (hoveredNode === i);
    var fc = (focusedNode === i);
    var sl = (selectedNode === i);

    // 聚焦模式：淡化其他节点
    var alpha = 1;
    if (focusedNode !== null && focusedNode !== undefined) {
      if (!fc && !hl) {
        // 检查是否与聚焦节点有关联边
        var connected = false;
        if (typeof graphEdges !== 'undefined') {
          connected = graphEdges.some(function(e) {
            return (e.from === focusedNode && e.to === i) || (e.to === focusedNode && e.from === i);
          });
        }
        if (typeof window.KnowLinkAI !== 'undefined') {
          var aiE = window.KnowLinkAI._getAIEdges();
          var focusedStableId = graphNodes[focusedNode] ? graphNodes[focusedNode].stableId : '';
          var nodeStableId = nd.stableId || '';
          connected = connected || aiE.some(function(e) {
            return (e.from === focusedStableId && e.to === nodeStableId) ||
                   (e.to === focusedStableId && e.from === nodeStableId);
          });
        }
        alpha = connected ? 0.7 : 0.1;
      }
    } else if (ft) {
      if (!nd.matchesFilter) { alpha = 0.12; if (hl) alpha = 0.5; }
    }

    ctx.globalAlpha = alpha;

    var x = nd.x, y = nd.y, r = nd.radius;
    var color = nd.color;
    var T = theme();

    // ---- 聚焦光环 ----
    if (fc) {
      ctx.beginPath();
      ctx.arc(x, y, r + 10, 0, Math.PI * 2);
      var ringGrad = ctx.createRadialGradient(x, y, r + 2, x, y, r + 12);
      ringGrad.addColorStop(0, T.focusRing);
      ringGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ringGrad;
      ctx.fill();
    }

    // ---- 选中高亮 ----
    if (sl) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = T.selectedRing;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- 辉光 (shadowBlur) ----
    if (hl || fc) {
      if (color.startsWith('#')) {
        ctx.shadowColor = hexToRgba(color, 0.5);
      } else {
        ctx.shadowColor = color.replace(')', ',0.5)').replace('rgb', 'rgba');
      }
      // 除以缩放比例，使模糊在屏幕空间保持恒定，避免放大后边缘发虚
      ctx.shadowBlur = vt.scale > 0.01 ? 14 / vt.scale : 14;
    }

    // ==================== 小球本体（obsidian 黑点 / space 渐变） ====================
    if (_galaxyTheme === 'obsidian') {
      // Obsidian 关系图谱风格：灰色圆点（缩小一倍，无边框；聚焦/选中变黑）
      var dotR = r * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = (hl || fc || sl) ? (T.nodeColorActive || '#000000') : (T.nodeColor || color);
      ctx.fill();
    } else {
      // Space 深空：径向渐变（中心 75% 透明度 → 边缘淡出）
      var ballGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
      ballGrad.addColorStop(0, hexToRgba(color, hl ? 0.9 : 0.75));    // 中心 75%（hover 90%）
      ballGrad.addColorStop(0.6, hexToRgba(color, hl ? 0.5 : 0.4));   // 中段
      ballGrad.addColorStop(1, 'rgba(0,0,0,0)');                       // 边缘淡出
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();

      // Space 渐变外环：柔和光晕环（营造星球氛围）
      var haloGrad = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.8);
      haloGrad.addColorStop(0, hexToRgba(color, hl ? 0.25 : 0.12));
      haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = haloGrad;
      ctx.fill();
    }

    // 2. 细边框（精致描边）
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = hl ? T.nodeBorderHover : T.nodeBorder;
    ctx.lineWidth = hl ? 1.5 : 1;
    ctx.stroke();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // ==================== 标签（移到小球下方，提升可读性） ====================
    var lbl = nd.label || '';
    ctx.font = 'bold ' + (hl || fc ? 12 : 11) + 'px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = T.labelShadow;
    ctx.shadowBlur = 4;
    ctx.fillStyle = hl ? T.labelHover : T.labelColor;
    ctx.fillText(lbl, x, y + r + 4);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // ---- 悬停脉动动画 ----
    if (hl) {
      var pulse = 1 + Math.sin(time * 0.005 + nd.glowPhase) * 0.12;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.25 + pulse * 0.25), 0, Math.PI * 2);
      ctx.strokeStyle = T.glowColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  });
}

// ====================================================================
//  入场动画渲染（Phase 4c）
// ====================================================================
// ---- 入场动画队列 ----
var _animQueue = [];  // {type:'supernova'|'wormhole', startTime, duration, nodeIdx|fromIdx|toIdx}

function startSupernovaAnimation(nodeIdx) {
  _animQueue.push({ type: 'supernova', nodeIdx: nodeIdx, startTime: performance.now(), duration: 250 });
}

function startWormholePulseAnimation(fromIdx, toIdx) {
  _animQueue.push({ type: 'wormhole', fromIdx: fromIdx, toIdx: toIdx, startTime: performance.now(), duration: 500 });
}

// 清理过期动画，返回活跃动画列表
function cleanupAnimations(now) {
  _animQueue = _animQueue.filter(function(a) { return (now - a.startTime) < a.duration; });
  return _animQueue;
}

function renderEntryAnimations(ctx, allEdges, time) {
  if (!_animQueue.length) return;
  var now = performance.now();
  var dpr = window.devicePixelRatio || 1;

  // 检查 prefers-reduced-motion
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch(e) {}
  if (reducedMotion) {
    _animQueue = [];
    return;
  }

  var alive = [];

  _animQueue.forEach(function(anim) {
    var elapsed = now - anim.startTime;
    if (elapsed >= anim.duration) return; // 已过期，移除
    alive.push(anim);

    var t = elapsed / anim.duration; // 0 → 1 进度

    if (anim.type === 'supernova') {
      var nd = graphNodes[anim.nodeIdx];
      if (!nd) return;

      // 超新星爆发：光环从 3x 半径缩小到 0，alpha 从 0.9 → 0
      var ringR = nd.radius * 3 * (1 - t);
      var alpha = 0.9 * (1 - t);

      // 外层大光环
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, ringR + nd.radius * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.lineWidth = 2 + 4 * (1 - t);
      ctx.shadowColor = 'rgba(192,132,252,' + alpha.toFixed(3) + ')';
      ctx.shadowBlur = 20;
      ctx.stroke();

      // 内层光环
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, ringR * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(139,92,246,' + (alpha * 0.7).toFixed(3) + ')';
      ctx.lineWidth = 1 + 2 * (1 - t);
      ctx.shadowBlur = 12;
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

    } else if (anim.type === 'wormhole') {
      var fromNd = graphNodes[anim.fromIdx];
      var toNd = graphNodes[anim.toIdx];
      if (!fromNd || !toNd) return;

      // 虫洞脉冲：光点沿连线传播
      // 缓动：ease-in-out
      var easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      var px = fromNd.x + (toNd.x - fromNd.x) * easeT;
      var py = fromNd.y + (toNd.y - fromNd.y) * easeT;

      // 前导光晕
      var glowAlpha = 0.6 * (1 - Math.abs(t - 0.5) * 2); // 中间最亮
      ctx.beginPath();
      ctx.arc(px, py, 5 + 3 * glowAlpha, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139,92,246,' + glowAlpha.toFixed(3) + ')';
      ctx.shadowColor = 'rgba(139,92,246,0.5)';
      ctx.shadowBlur = 15;
      ctx.fill();

      // 拖尾点
      ctx.beginPath();
      var trail = Math.max(0, easeT - 0.08);
      var trailX = fromNd.x + (toNd.x - fromNd.x) * trail;
      var trailY = fromNd.y + (toNd.y - fromNd.y) * trail;
      ctx.arc(trailX, trailY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(192,132,252,' + (glowAlpha * 0.5).toFixed(3) + ')';
      ctx.shadowBlur = 8;
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
  });

  _animQueue = alive;
}

// ====================================================================
//  主渲染入口
// ====================================================================
function renderGalaxy(ctx, vt, W, H, opt) {
  opt = opt || {};
  var hoveredNode  = opt.hoveredNode;
  var focusedNode  = opt.focusedNode;
  var selectedNode = opt.selectedNode;
  var filterText   = opt.filterText || '';
  var time         = opt.time || 0;
  var aiEdges      = opt.aiEdges || [];

  if (!ctx || !W || !H) return;

  var dpr = window.devicePixelRatio || 1;
  ctx.save();
  // 注意: offsetX/Y 是 CSS 像素，需要乘以 dpr 转换为设备像素
  // canvas 后备存储是 W*dpr × H*dpr，平移量必须匹配设备像素坐标系
  ctx.setTransform(
    dpr * vt.scale, 0,
    0, dpr * vt.scale,
    vt.offsetX * dpr, vt.offsetY * dpr
  );

  var vpX = -vt.offsetX / vt.scale;
  var vpY = -vt.offsetY / vt.scale;
  var vpW = W / vt.scale;
  var vpH = H / vt.scale;

  ctx.clearRect(vpX, vpY, vpW, vpH);

  // ---- Layer 1: 深空背景 + 星场 ----
  renderStarfield(ctx, vt, W, H, time);

  // ---- Layer 2: 星云光晕（密集知识区域） ----
  renderNebulae(ctx, vt);

  // ---- Layer 2.5: 星系中心微尘 ----
  renderGalaxyDust(ctx, vt, time);

  // ---- Layer 4: 边（连线） ----
  var allEdges = graphEdges.concat(aiEdges);
  renderGalaxyEdges(ctx, vt, allEdges, hoveredNode, focusedNode, filterText, time);

  // ---- Layer 5: 星座连线（跨星系的语义关联） ----
  // (已在 renderGalaxyEdges 中通过 reason 区分渲染)

  // ---- Layer 6: 恒星节点 ----
  renderGalaxyNodes(ctx, vt, hoveredNode, focusedNode, selectedNode, filterText, time);

  // ---- Layer 6.5: 入场动画（超新星 + 虫洞脉冲） ----
  renderEntryAnimations(ctx, allEdges, time);

  ctx.restore();

  // ---- Layer 7: 空状态消息 ----
  if (!graphNodes.length) {
    ctx.fillStyle = theme().emptyText;
    ctx.font = '15px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('知识宇宙中还没有节点，去收集一些知识点吧', W / 2, H / 2);
  }
}
