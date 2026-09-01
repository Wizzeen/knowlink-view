// ====================================================================
//  KnowLink 知识星系 — 统一 NLP 引擎 (nlp-engine.js)
//  所有 NLP 实现的唯一来源：TF-IDF、TextRank、知识点提取、余弦相似度
//  同时支持主线程 (<script> → window.NLP)、Worker (importScripts → self.NLP)
//  和 Service Worker (importScripts → self.NLP)
//
//  来源：算法从 ai-worker.js 移植（最完整的实现），替代 ai-wormhole.js
//  和 ai-dedup.js 中的简化副本。
// ====================================================================

(function () {
  'use strict';

  // ==================== 文本分句 ====================
  function tokenizeSentences(text) {
    if (!text) return [];
    var result = [];
    var current = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      current += ch;
      // 句子边界：中英文句号、问号、感叹号、分号、换行
      // 概念分隔符：• (bullet)、— (em dash)、– (en dash)、列表项标记
      var isSentenceEnd = (
        '。！？；\n\r'.indexOf(ch) !== -1 ||
        (ch === '.' && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) ||
        (ch === '?' && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) ||
        (ch === '!' && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n'))
      );
      // bullet / 列表分隔
      var isBullet = (ch === '•' || ch === '–' || ch === '—');
      // 英文冒号分隔概念 (但排除时间/URL中的冒号)
      var isConceptSep = false;
      if (ch === ':' && i > 2 && i < text.length - 1) {
        var before = text.substring(i - 2, i);
        if (!/\d/.test(before) && text[i + 1] === ' ') {
          isConceptSep = true;
        }
      }

      if (isSentenceEnd || isBullet || isConceptSep) {
        var s = current.trim();
        // 去掉末尾分隔符
        if (s.length > 0 && '•–—:。！？；.!?;'.indexOf(s[s.length - 1]) !== -1) {
          s = s.substring(0, s.length - 1).trim();
        }
        if (s.length > 2) result.push(s);
        current = '';
      }
    }
    if (current.trim().length > 2) {
      var cs = current.trim();
      if (cs.length > 0 && '•–—:。！？；.!?;'.indexOf(cs[cs.length - 1]) !== -1) {
        cs = cs.substring(0, cs.length - 1).trim();
      }
      if (cs.length > 2) result.push(cs);
    }

    // 如果分句太少，按逗号和中文顿号再分
    if (result.length <= 2 && text.length > 80) {
      result = text.split(/[，,、]|(?:\s{2,})/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 5; });
    }

    // 如果仍然太少，按 - 分隔（常见于标题列表）
    if (result.length <= 2 && text.length > 60) {
      result = text.split(/\s*[-–—]\s+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 4; });
    }

    return result.length ? result : [text];
  }

  // ==================== 中文分词 (N-gram) ====================
  function _tokenizeChinese(text) {
    var cleaned = text.replace(/[\s，。！？、；：""''【】《》（）\n\r\t.,!?;:'"()\[\]{}0-9%+\-=*/<>|&@#$^~`]/g, '');
    var tokens = [];

    // 2-gram
    for (var i = 0; i < cleaned.length - 1; i++) {
      var bigram = cleaned.substring(i, i + 2);
      if (!/[a-zA-Z]/.test(bigram)) tokens.push(bigram);
    }
    // 3-gram (对长词更好)
    for (var j = 0; j < cleaned.length - 2; j++) {
      var trigram = cleaned.substring(j, j + 3);
      if (!/[a-zA-Z]/.test(trigram)) tokens.push(trigram);
    }

    // 英文单词
    var enWords = text.match(/[a-zA-Z]{3,}/g) || [];
    enWords.forEach(function (w) {
      tokens.push(w.toLowerCase());
    });

    return tokens;
  }

  // ==================== TF-IDF ====================
  // documents: string[] — 每句作为一个文档
  function _computeTFIDF(documents, topN) {
    var N = documents.length;
    if (!N) return [];

    // TF per doc
    var tfs = documents.map(function (doc) {
      var tokens = _tokenizeChinese(doc);
      var freq = {};
      tokens.forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });
      var total = tokens.length || 1;
      var tf = {};
      Object.keys(freq).forEach(function (t) { tf[t] = freq[t] / total; });
      return { tf: tf, tokens: tokens.length };
    });

    // DF (document frequency)
    var df = {};
    tfs.forEach(function (doc) {
      Object.keys(doc.tf).forEach(function (t) {
        df[t] = (df[t] || 0) + 1;
      });
    });

    // IDF
    var idf = {};
    Object.keys(df).forEach(function (t) {
      idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
    });

    // TF-IDF per doc
    var tfidfDocs = tfs.map(function (doc) {
      var scores = {};
      Object.keys(doc.tf).forEach(function (t) {
        scores[t] = doc.tf[t] * (idf[t] || 0);
      });
      return scores;
    });

    // Global scores (sum across all docs)
    var globalScores = {};
    tfidfDocs.forEach(function (doc) {
      Object.keys(doc).forEach(function (t) {
        globalScores[t] = (globalScores[t] || 0) + doc[t];
      });
    });

    // Sort and filter
    var entries = Object.keys(globalScores).map(function (k) {
      return { word: k, score: globalScores[k] };
    });
    entries.sort(function (a, b) { return b.score - a.score; });

    // 去重: 移除子串关键词
    var result = [];
    for (var i = 0; i < entries.length && result.length < (topN || 15); i++) {
      var candidate = entries[i].word;
      var isSub = result.some(function (r) {
        return r.indexOf(candidate) !== -1 || candidate.indexOf(r) !== -1;
      });
      if (!isSub) result.push(candidate);
    }

    return result;
  }

  // ==================== 句子相似度 ====================
  function _sentenceSimilarity(s1, s2, keywords) {
    var kwSet = {};
    if (keywords) keywords.forEach(function (k) { kwSet[k] = true; });

    var tokens1 = _tokenizeChinese(s1);
    var tokens2 = _tokenizeChinese(s2);

    var set1 = {}, set2 = {};
    tokens1.forEach(function (t) { set1[t] = true; });
    tokens2.forEach(function (t) { set2[t] = true; });

    var intersection = 0;
    Object.keys(set1).forEach(function (t) {
      if (set2[t]) {
        intersection++;
        if (kwSet[t]) intersection += 2; // 关键词匹配加权
      }
    });

    var union = Object.keys(set1).length + Object.keys(set2).length - intersection + 1;
    return intersection / union;
  }

  // ==================== TextRank 摘要 ====================
  function _textRankSummarize(sentences, keywords, topN) {
    if (sentences.length <= topN) {
      return sentences.slice();
    }

    // 构建句子相似度矩阵
    var n = sentences.length;
    var simMatrix = [];
    for (var i = 0; i < n; i++) {
      simMatrix[i] = [];
      for (var j = 0; j < n; j++) {
        if (i === j) {
          simMatrix[i][j] = 0;
        } else if (j < i) {
          simMatrix[i][j] = simMatrix[j][i];
        } else {
          simMatrix[i][j] = _sentenceSimilarity(sentences[i], sentences[j], keywords);
        }
      }
    }

    // PageRank 迭代
    var scores = new Array(n).fill(1.0 / n);
    var d = 0.85; // 阻尼系数
    var ITER = 30;

    for (var iter = 0; iter < ITER; iter++) {
      var newScores = new Array(n).fill((1 - d) / n);
      for (var u = 0; u < n; u++) {
        var sumOut = 0;
        for (var v = 0; v < n; v++) {
          if (u !== v && simMatrix[u][v] > 0) sumOut += simMatrix[u][v];
        }
        if (sumOut === 0) continue;
        for (var w = 0; w < n; w++) {
          if (u !== w && simMatrix[u][w] > 0) {
            var outSum = 0;
            for (var x = 0; x < n; x++) { if (u !== x && simMatrix[u][x] > 0) outSum += simMatrix[u][x]; }
            if (outSum > 0) newScores[w] += d * scores[u] * (simMatrix[u][w] / outSum);
          }
        }
      }
      scores = newScores;
    }

    // 位置加权
    var scored = sentences.map(function (s, i) {
      var posWeight = 1.0;
      if (i < n * 0.15) posWeight = 1.4;      // 开头
      else if (i > n * 0.85) posWeight = 1.2;  // 结尾
      return { text: s, score: scores[i] * posWeight, index: i };
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    var selected = scored.slice(0, Math.min(topN, n));
    selected.sort(function (a, b) { return a.index - b.index; });

    return selected.map(function (s) { return s.text; });
  }

  // ==================== 标题字符重叠度 (Jaccard) ====================
  function titleOverlap(t1, t2) {
    if (!t1 || !t2) return 0;
    if (t1 === t2) return 1;
    var set1 = {}, set2 = {};
    for (var i = 0; i < t1.length; i++) set1[t1[i]] = true;
    for (var j = 0; j < t2.length; j++) set2[t2[j]] = true;
    var inter = 0, union = 0;
    var all = {};
    for (var k = 0; k < t1.length; k++) all[t1[k]] = true;
    for (var l = 0; l < t2.length; l++) all[t2[l]] = true;
    var keys = Object.keys(all);
    for (var m = 0; m < keys.length; m++) {
      if (set1[keys[m]] && set2[keys[m]]) inter++;
      union++;
    }
    return union > 0 ? inter / union : 0;
  }

  // ==================== 提取短概念短语 ====================
  // 从一段文本中提取核心概念短语（≤5词）
  function _extractConceptPhrase(text, keywords) {
    if (!text) return '';
    var cleaned = text.replace(/\s+/g, ' ').trim();

    // 策略1：查找关键词锚点，提取包含关键词的最短有意义片段
    if (keywords && keywords.length) {
      for (var k = 0; k < keywords.length; k++) {
        var kw = keywords[k];
        var idx = cleaned.toLowerCase().indexOf(kw.toLowerCase());
        if (idx === -1) continue;

        // 以关键词为中心，向左扩展到前一个分隔符或2-4个词
        var before = cleaned.substring(0, idx).trim();
        var beforeWords = before.split(/\s+/);
        var startWords = Math.max(0, beforeWords.length - 3);
        var prefix = beforeWords.slice(startWords).join(' ');

        // 向右扩展2-5个词
        var after = cleaned.substring(idx + kw.length).trim();
        var afterWords = after.split(/\s+/).slice(0, 4);
        var suffix = afterWords.join(' ');

        var phrase = (prefix + ' ' + kw + ' ' + suffix).replace(/\s+/g, ' ').trim();

        // 截断到约5个词
        var words = phrase.split(/\s+/);
        if (words.length > 6) {
          // 保留包含关键词的核心片段
          phrase = words.slice(0, 6).join(' ');
        }

        // 去掉末尾不完整的标点
        phrase = phrase.replace(/[,;，。；、:：•\-–—]+$/g, '').trim();
        if (phrase.length > 3) return phrase;
      }
    }

    // 策略2：没有关键词匹配 → 取第一句或冒号前的内容
    var colonIdx = cleaned.indexOf(':');
    if (colonIdx > 3 && colonIdx < 60) {
      return cleaned.substring(0, colonIdx).trim();
    }

    // 策略3：取前5个词
    var words = cleaned.split(/\s+/);
    return words.slice(0, 5).join(' ');
  }

  // ==================== 知识点提取 ====================
  function _extractKnowledgePoints(sentences, keywords) {
    if (!sentences.length) return [];

    // 将长句子进一步切分为更小的概念片段
    var allChunks = [];
    sentences.forEach(function(s) {
      // 如果句子仍然很长(>80字符)，按内部标点再切
      if (s.length > 80) {
        var subChunks = s.split(/[;；|、](?=\s|$)/);
        subChunks.forEach(function(sc) {
          var trimmed = sc.trim();
          if (trimmed.length > 4) {
            // 进一步按逗号切分过长的片段
            if (trimmed.length > 70) {
              var subSub = trimmed.split(/[，,](?=\s|$)/);
              subSub.forEach(function(ss) {
                var t = ss.trim();
                if (t.length > 3) allChunks.push(t);
              });
            } else {
              allChunks.push(trimmed);
            }
          }
        });
      } else if (s.length > 4) {
        allChunks.push(s);
      }
    });

    // 为每个片段计算得分
    var scored = allChunks.map(function(chunk, i) {
      var kwCount = 0;
      keywords.forEach(function(kw) {
        if (chunk.toLowerCase().indexOf(kw.toLowerCase()) !== -1) kwCount++;
      });
      var ratio = i / Math.max(allChunks.length - 1, 1);
      var posWeight = 1.0;
      if (ratio < 0.15) posWeight = 1.4;
      else if (ratio > 0.85) posWeight = 1.1;

      // 理想长度 10-50 字符（短概念），太长或太短都降权
      var len = chunk.length;
      var lenScore = 1.0;
      if (len < 8) lenScore = 0.5;
      else if (len > 150) lenScore = 0.4;
      else if (len > 80) lenScore = 0.65;
      else if (len <= 60) lenScore = 1.15;

      return { text: chunk, score: (kwCount + 0.3) * posWeight * lenScore, index: i };
    });

    scored.sort(function(a, b) { return b.score - a.score; });

    var topN = Math.min(12, Math.max(5, Math.ceil(allChunks.length * 0.25)));
    var candidates = scored.slice(0, topN);
    // 按原始位置排序
    candidates.sort(function(a, b) { return a.index - b.index; });

    var maxScore = candidates.length > 0
      ? Math.max.apply(null, candidates.map(function(c) { return c.score; })) : 1;

    var points = candidates.map(function(c) {
      var ratio = c.score / maxScore;
      // 提取短概念短语作为 title
      var conceptTitle = _extractConceptPhrase(c.text, keywords);

      // title 限制在5词左右
      var words = conceptTitle.split(/\s+/);
      if (words.length > 6) {
        conceptTitle = words.slice(0, 6).join(' ') + '…';
      }

      // detail：取原始片段文本，适度截断
      var detail = c.text;
      if (detail.length > 100) detail = detail.substring(0, 100) + '…';

      return {
        title: conceptTitle || c.text.substring(0, 50),
        detail: detail,
        confidence: ratio > 0.7 ? 'high' : (ratio > 0.4 ? 'medium' : 'low'),
        score: c.score,
        index: c.index
      };
    });

    // 同批次去重（基于 title 重叠度）
    var deduped = [];
    for (var p = 0; p < points.length; p++) {
      var isDup = false;
      for (var q = 0; q < deduped.length; q++) {
        if (titleOverlap(points[p].title, deduped[q].title) > 0.6) {
          isDup = true;
          break;
        }
      }
      if (!isDup) deduped.push(points[p]);
    }

    return deduped.map(function(p) {
      return { title: p.title, detail: p.detail, confidence: p.confidence };
    });
  }

  // ==================== 余弦相似度 ====================
  function cosineSimilarity(kwA, kwB) {
    if (!kwA || !kwB || !kwA.length || !kwB.length) return 0;

    var vecA = {}, vecB = {};
    kwA.forEach(function (w) { vecA[w] = (vecA[w] || 0) + 1; });
    kwB.forEach(function (w) { vecB[w] = (vecB[w] || 0) + 1; });

    var allWords = {};
    Object.keys(vecA).forEach(function (w) { allWords[w] = true; });
    Object.keys(vecB).forEach(function (w) { allWords[w] = true; });

    var dot = 0, magA = 0, magB = 0;
    Object.keys(allWords).forEach(function (w) {
      var a = vecA[w] || 0;
      var b = vecB[w] || 0;
      dot += a * b;
      magA += a * a;
      magB += b * b;
    });

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  // ==================== 匹配去重（保留最高相似度） ====================
  function dedupeMatches(matches, keyField) {
    var best = {};
    matches.forEach(function(m) {
      var k = m[keyField];
      if (!best[k] || m.similarity > best[k].similarity) {
        best[k] = m;
      }
    });
    return Object.keys(best).map(function(k) { return best[k]; });
  }

  // ==================== 单文本关键词提取 ====================
  function extractKeywords(text, topN) {
    if (!text) return [];
    var sentences = tokenizeSentences(text);
    return _computeTFIDF(sentences.length > 1 ? sentences : [text], topN || 10);
  }

  // ==================== 摘要（组合管线） ====================
  function summarize(text, maxLength) {
    maxLength = maxLength || 200;

    var sentences = tokenizeSentences(text);
    if (!sentences.length) {
      return {
        summary: '',
        keywords: [],
        knowledgePoints: [],
        relations: [],
        sentences: 0
      };
    }

    // TF-IDF 提取关键词
    var keywords = _computeTFIDF(sentences, 15);

    // TextRank 摘要
    var topN = Math.max(3, Math.min(8, Math.ceil(sentences.length * 0.2)));
    var selectedSentences = _textRankSummarize(sentences, keywords, topN);

    // 知识点提取
    var knowledgePoints = _extractKnowledgePoints(sentences, keywords);

    // 组装摘要
    var summary = selectedSentences.join(' ');
    var maxChars = maxLength * 3; // 中文摘要约3倍字符
    if (summary.length > maxChars) {
      summary = summary.substring(0, maxChars) + '…';
    }

    return {
      summary: summary,
      keywords: keywords,
      knowledgePoints: knowledgePoints,
      relations: [],   // 本地引擎不生成伪关系，仅云端API返回语义关系
      sentences: sentences.length
    };
  }

  // ==================== 关联发现（统一实现） ====================
  // 修复: 从 ai-worker.handleFindConnections / ai-wormhole._localFindConnectionsSync 下沉，
  // 消除重复实现。遍历点对：同源检测 + 余弦相似度，返回按强度降序的边数组。
  function findConnections(points, threshold, maxEdges, onProgress) {
    threshold = threshold || 0.4;
    maxEdges = maxEdges || 35;
    if (!points || points.length < 2) return [];

    var kwCache = points.map(function (p) {
      return {
        keywords: extractKeywords(p.text || p.title || '', 10),
        url: (p.url || '').replace(/^(file:\/\/\/|https?:\/\/)/i, '')
      };
    });

    var edges = [];
    var total = points.length;
    var totalPairs = (total * (total - 1)) / 2;
    var processed = 0;

    for (var i = 0; i < total; i++) {
      for (var j = i + 1; j < total; j++) {
        processed++;
        if (onProgress && processed % Math.max(1, Math.floor(totalPairs / 20)) === 0) {
          onProgress(20 + Math.floor((processed / totalPairs) * 70), 'computing');
        }
        if (kwCache[i].url && kwCache[j].url && kwCache[i].url === kwCache[j].url) {
          edges.push({ from: i, to: j, strength: 100, reason: 'same-source' });
          continue;
        }
        var sim = cosineSimilarity(kwCache[i].keywords, kwCache[j].keywords);
        if (sim >= threshold) {
          edges.push({ from: i, to: j, strength: Math.round(sim * 100), reason: 'ai-inferred' });
        }
      }
    }

    edges.sort(function (a, b) { return b.strength - a.strength; });
    return edges.slice(0, maxEdges);
  }

  // ==================== 比对引擎（统一实现） ====================
  // 修复: 从 ai-worker.handleCompare / ai-wormhole._localCompareSync 下沉。
  // 语义去重 + 疑似重复 + 新关联，返回统一结构。
  function comparePoints(newPoints, existingPoints, options) {
    options = options || {};
    var dupThreshold = options.dupThreshold || 0.75;
    var maybeThreshold = options.maybeThreshold || 0.6;
    var connectThreshold = options.connectThreshold || 0.4;
    var maxConnections = options.maxConnections || 35;

    var newKwData = newPoints.map(function(p) {
      var text = p.text || p.title || '';
      return { id: p.id, text: text, keywords: extractKeywords(text, 10) };
    });
    var existingKwData = existingPoints.map(function(p) {
      var text = p.text || p.title || '';
      return { id: p.id, text: text, keywords: extractKeywords(text, 10) };
    });

    var duplicates = [];
    var maybeDuplicates = [];
    var newConnections = [];

    for (var i = 0; i < newKwData.length; i++) {
      var nk = newKwData[i];
      for (var j = 0; j < existingKwData.length; j++) {
        var ek = existingKwData[j];
        var sim = cosineSimilarity(nk.keywords, ek.keywords);
        var simPct = Math.round(sim * 100);

        if (sim >= dupThreshold) {
          duplicates.push({ newId: nk.id, newText: nk.text, existingId: ek.id, existingText: ek.text, similarity: simPct, confidence: 'high' });
        } else if (sim >= maybeThreshold) {
          maybeDuplicates.push({ newId: nk.id, newText: nk.text, existingId: ek.id, existingText: ek.text, similarity: simPct, confidence: 'medium' });
        } else if (sim >= connectThreshold) {
          newConnections.push({ fromId: nk.id, fromText: nk.text, toId: ek.id, toText: ek.text, similarity: simPct });
        }
      }
    }

    duplicates = dedupeMatches(duplicates, 'newId');
    maybeDuplicates = dedupeMatches(maybeDuplicates, 'newId');
    var dupIds = {};
    duplicates.forEach(function(d) { dupIds[d.newId] = true; });
    maybeDuplicates = maybeDuplicates.filter(function(m) { return !dupIds[m.newId]; });

    return {
      duplicates: duplicates,
      maybeDuplicates: maybeDuplicates,
      newConnections: newConnections.slice(0, maxConnections),
      contradictions: []
    };
  }

  // ==================== 单点去重检查（统一实现） ====================
  // 修复: 从 ai-worker.handleDedupCheck / ai-wormhole._localDedupCheckSync / ai-dedup.semanticDedup 下沉。
  function dedupCheck(candidate, existing, threshold) {
    threshold = threshold || 0.75;
    var candText = candidate.text || candidate.title || '';
    var candKws = extractKeywords(candText, 10);

    var bestSim = 0;
    var bestId = null;
    for (var j = 0; j < existing.length; j++) {
      var ekText = existing[j].text || existing[j].title || '';
      // 快速路径：完全相同的文本，直接判定重复
      if (candText && ekText && candText.trim() === ekText.trim()) {
        return { isDuplicate: true, confidence: 100, matchedId: existing[j].id || null };
      }
      var ekKws = extractKeywords(ekText, 10);
      var sim = cosineSimilarity(candKws, ekKws);
      if (sim > bestSim) { bestSim = sim; bestId = existing[j].id || null; }
    }
    return {
      isDuplicate: bestSim >= threshold,
      confidence: Math.round(bestSim * 100),
      matchedId: bestSim >= threshold ? bestId : null
    };
  }

  // ==================== 导出 ====================
  // self 在 Page/Worker/ServiceWorker 中均为全局作用域
  self.NLP = {
    tokenizeSentences: tokenizeSentences,
    extractKeywords: extractKeywords,
    cosineSimilarity: cosineSimilarity,
    titleOverlap: titleOverlap,
    summarize: summarize,
    dedupeMatches: dedupeMatches,
    findConnections: findConnections,
    comparePoints: comparePoints,
    dedupCheck: dedupCheck
  };

})();
