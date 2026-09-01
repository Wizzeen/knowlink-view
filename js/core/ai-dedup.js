// ====================================================================
//  KnowLink 知识星系 — 统一去重引擎 (ai-dedup.js)
//  轻量级 TF-IDF + 余弦相似度，可被 background.js (importScripts)
//  和 ai-wormhole.js 共用，消除多套去重规则
// ====================================================================

// NLP 工具函数已统一到 nlp-engine.js（通过 self.NLP 访问）
// 为兼容 main thread / service worker 两种加载方式，使用 self.NLP
var _NLP = typeof self !== 'undefined' ? self.NLP : null;

// 向后兼容别名（background.js importScripts 模式）
function __extractKeywordsLocal(text, topN) {
  if (_NLP) return _NLP.extractKeywords(text, topN);
  return [];
}
function __cosineSimilarity(kwA, kwB) {
  if (_NLP) return _NLP.cosineSimilarity(kwA, kwB);
  return 0;
}

// ====================================================================
//  统一去重接口
// ====================================================================

// 语义去重检查
// candidate: { text, title, id? }
// existingPoints: [{ text, title, id }]
// threshold: 0-1, 默认 0.75
// 返回: { isDuplicate: bool, confidence: 0-100, matchedId: string|null }
function semanticDedup(candidate, existingPoints, threshold) {
  threshold = threshold || 0.75;
  // 统一实现：self.NLP.dedupCheck（消除与 ai-wormhole / ai-worker 的重复）
  if (_NLP && _NLP.dedupCheck) {
    return _NLP.dedupCheck(candidate, existingPoints, threshold);
  }
  // 降级：NLP 不可用时用精确匹配
  var candText = candidate.text || candidate.title || '';
  for (var j = 0; j < existingPoints.length; j++) {
    var ekText = existingPoints[j].text || existingPoints[j].title || '';
    if (candText && ekText && candText.trim() === ekText.trim()) {
      return { isDuplicate: true, confidence: 100, matchedId: existingPoints[j].id || null };
    }
  }
  return { isDuplicate: false, confidence: 0, matchedId: null };
}

// 批量去重：从候选列表中过滤掉重复项
// candidates: [{ text, title, id }]
// existingPoints: [{ text, title, id }]
// threshold: 0-1
// 返回: { unique: [...], duplicates: [{candidate, matchedId, confidence}] }
function semanticDedupBatch(candidates, existingPoints, threshold) {
  threshold = threshold || 0.75;
  var unique = [];
  var duplicates = [];

  candidates.forEach(function(cand) {
    var result = semanticDedup(cand, existingPoints.concat(unique), threshold);
    if (result.isDuplicate) {
      duplicates.push({ candidate: cand, matchedId: result.matchedId, confidence: result.confidence });
    } else {
      unique.push(cand);
    }
  });

  return { unique: unique, duplicates: duplicates };
}
