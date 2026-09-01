// ====================================================================
//  KnowLink 知识星系 — 云端 API 适配器 (cloud-adapter.js)
//  无状态模块：封装 LLM API 调用、Map-Reduce、重试、JSON 解析
//  只依赖 self.NLP（分句），不依赖 chrome API
// ====================================================================

(function () {
  'use strict';

  // ==================== 常量 ====================
  var CHARS_PER_TOKEN_CN = 1.5;
  var MAX_CHUNK_CHARS    = 4000;   // 单次API调用文本上限
  var MAX_API_CHARS      = 8000;   // 绝对硬上限
  var API_TIMEOUT_MS     = 60000;  // API超时60秒
  var MAP_DELAY_MS       = 1000;   // Map阶段请求间隔
  var MAX_RETRIES        = 3;      // 429重试次数

  // ==================== Prompt 模板 ====================
  var SUMMARY_JSON_PROMPT = [
    '你是学术知识提取助手。请分析以下文本，返回一个JSON对象（不要Markdown代码块，纯JSON）：',
    '{',
    '  "summary": "200-300字的整体摘要",',
    '  "knowledgePoints": [',
    '    {"title": "知识点名称", "detail": "50-100字详细说明", "confidence": "high|medium|low"}',
    '  ],',
    '  "keywords": ["关键词1", "关键词2", ...],',
    '  "relations": [',
    '    {"from": "知识点A的title", "to": "知识点B的title", "type": "因果|并列|层级|支撑", "desc": "20字关系描述"}',
    '  ]',
    '}',
    '要求：knowledgePoints提取3-8个核心知识点；relations提取知识点间的逻辑关系；只返回JSON。'
  ].join('\n');

  var REDUCE_JSON_PROMPT = [
    '你是学术知识整合助手。以下是多个文本片段提取的知识点，请整合去重，返回一个JSON对象（纯JSON，不要代码块）：',
    '{',
    '  "summary": "300字以内的整体摘要",',
    '  "knowledgePoints": [{"title":"...","detail":"...","confidence":"high|medium|low"}],',
    '  "keywords": ["..."],',
    '  "relations": [{"from":"...","to":"...","type":"因果|并列|层级|支撑","desc":"..."}]',
    '}',
    '要求：合并相似知识点，保留3-8个最重要的；只返回JSON。'
  ].join('\n');

  // ==================== Token 估算 ====================
  function estimateTokens(text) {
    return Math.ceil(text.length * CHARS_PER_TOKEN_CN);
  }

  // ==================== 文本分块 ====================
  function _chunkText(text, maxChars) {
    var chunks = [];
    var sentences = self.NLP.tokenizeSentences(text);
    var current = '';
    for (var i = 0; i < sentences.length; i++) {
      if (current.length + sentences[i].length > maxChars && current.length > 0) {
        chunks.push(current.trim());
        current = sentences[i];
      } else {
        current += (current ? ' ' : '') + sentences[i];
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length ? chunks : [text.substring(0, maxChars)];
  }

  // ==================== API 调用（底层） ====================
  function _callAPI(config, systemPrompt, userContent, maxTokens, jsonMode) {
    return new Promise(function (resolve, reject) {
      if (!config.enabled) {
        reject(new Error('云端API未启用'));
        return;
      }

      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);

      var body = {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: maxTokens || 1024,
        temperature: 0.3
      };

      if (jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      .then(function (r) {
        clearTimeout(timeout);
        if (!r.ok) {
          return r.json().then(function (body) {
            throw new Error('API错误 ' + r.status + ': ' + ((body.error && body.error.message) || r.statusText));
          }).catch(function (parseErr) {
            if (parseErr.message && parseErr.message.indexOf('API错误') === 0) throw parseErr;
            throw new Error('API错误 ' + r.status + ': ' + r.statusText);
          });
        }
        return r.json();
      })
      .then(function (data) {
        var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        resolve(content.trim());
      })
      .catch(function (e) {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  // 带重试的API调用（处理429速率限制）
  function _callAPIWithRetry(config, systemPrompt, userContent, maxTokens, jsonMode, retriesLeft) {
    retriesLeft = (retriesLeft === undefined) ? MAX_RETRIES : retriesLeft;
    return _callAPI(config, systemPrompt, userContent, maxTokens, jsonMode).catch(function (err) {
      if (retriesLeft > 0 && err.message && err.message.indexOf('429') !== -1) {
        var delay = (MAX_RETRIES - retriesLeft + 1) * 2000;
        console.warn('[CloudAdapter] 429限流，' + delay / 1000 + '秒后重试 (剩余' + (retriesLeft - 1) + '次)');
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(_callAPIWithRetry(config, systemPrompt, userContent, maxTokens, jsonMode, retriesLeft - 1));
          }, delay);
        });
      }
      throw err;
    });
  }

  // 串行执行Map阶段，每次之间有延迟
  function _sequentialMap(chunks, delayMs, config, onProgress) {
    var results = [];
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, i) {
      chain = chain.then(function () {
        if (onProgress) {
          onProgress({ percent: 10 + Math.round((i / chunks.length) * 70), stage: 'cloud', chunk: i + 1, total: chunks.length });
        }
        return _callAPIWithRetry(
          config,
          '提取以下文本片段的核心知识点（2-5个），返回JSON: {"points":[{"title":"知识点","detail":"说明"}]}',
          '文本片段 ' + (i + 1) + '/' + chunks.length + ':\n\n' + chunk,
          384,
          true
        ).then(function (r) {
          results.push(r);
          return new Promise(function (resolve) { setTimeout(resolve, delayMs); });
        });
      });
    });
    return chain.then(function () { return results; });
  }

  // ==================== JSON 解析 ====================
  function _parseStructuredResult(raw) {
    var summary = '';
    var keywords = [];
    var knowledgePoints = [];
    var relations = [];

    try {
      var jsonStr = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      var parsed = JSON.parse(jsonStr);

      summary = (parsed.summary || '').trim();
      keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map(function(k) { return ('' + k).trim(); }).filter(Boolean) : [];

      if (Array.isArray(parsed.knowledgePoints)) {
        knowledgePoints = parsed.knowledgePoints.map(function(p) {
          return {
            title: (p.title || '').trim(),
            detail: (p.detail || '').trim(),
            confidence: p.confidence || 'medium'
          };
        }).filter(function(p) { return p.title; });
      }

      if (Array.isArray(parsed.relations)) {
        relations = parsed.relations.map(function(r) {
          return {
            from: (r.from || '').trim(),
            to: (r.to || '').trim(),
            type: r.type || 'related',
            desc: (r.desc || '').trim()
          };
        }).filter(function(r) { return r.from && r.to; });
      }

      console.log('[CloudAdapter] JSON解析成功: ' + knowledgePoints.length + '个知识点, ' + relations.length + '条关系');
    } catch (e) {
      console.warn('[CloudAdapter] JSON解析失败，降级正则提取:', e.message);

      var kwMatch = raw.match(/关键词[：:]\s*(.+)/i);
      if (kwMatch) {
        keywords = kwMatch[1].split(/[,，、]/).map(function (k) { return k.trim(); }).filter(Boolean);
      }

      var ptMatch = raw.match(/知识点[：:]/i);
      if (ptMatch) {
        var pts = raw.substring(ptMatch.index).split(/\n[•\-\*\d]+\.?\s*/).slice(1);
        knowledgePoints = pts.map(function(p) { return { title: p.trim().substring(0, 60), detail: p.trim(), confidence: 'low' }; }).filter(function(p) { return p.title; });
      }

      summary = raw.replace(/关键词[：:].*/gi, '').replace(/知识点[：:].*/gi, '').replace(/^\d+[\.\、]\s*摘要[：:]?/i, '').trim();
      if (!summary && raw.length < 500) summary = raw;
    }

    return {
      summary: summary,
      keywords: keywords,
      knowledgePoints: knowledgePoints,
      relations: relations
    };
  }

  // ==================== 云端摘要（Map-Reduce 管线） ====================
  function summarize(text, config, onProgress) {
    var tokens = estimateTokens(text);
    console.log('[CloudAdapter] Token估算:', tokens, '文本长度:', text.length);

    if (text.length <= MAX_CHUNK_CHARS) {
      return _callAPIWithRetry(
        config,
        SUMMARY_JSON_PROMPT,
        '请分析以下文本：\n\n' + text,
        1024,
        true
      ).then(function (result) {
        return _parseStructuredResult(result);
      });
    }

    var chunks = _chunkText(text, MAX_CHUNK_CHARS);
    console.log('[CloudAdapter] Map-Reduce摘要: ' + chunks.length + ' 个分块 (串行+' + MAP_DELAY_MS + 'ms间隔)');

    return _sequentialMap(chunks, MAP_DELAY_MS, config, onProgress).then(function (chunkResults) {
      var combinedInput = chunkResults.map(function (r, i) { return '片段' + (i + 1) + ': ' + r; }).join('\n\n');
      if (combinedInput.length > MAX_API_CHARS) {
        combinedInput = combinedInput.substring(0, MAX_API_CHARS);
      }
      return _callAPIWithRetry(
        config,
        REDUCE_JSON_PROMPT,
        combinedInput,
        1536,
        true
      );
    }).then(function (result) {
      return _parseStructuredResult(result);
    });
  }

  // ==================== 云端关联查找 ====================
  function findConnections(knowledgePoints, config, threshold, maxEdges) {
    var kwSummary = knowledgePoints.map(function (p, i) {
      var kws = self.NLP.extractKeywords(p.text || '', 8);
      return '[' + i + '] ' + kws.join(', ');
    }).join('\n');

    if (kwSummary.length > MAX_API_CHARS) {
      kwSummary = kwSummary.substring(0, MAX_API_CHARS);
    }

    var prompt = '以下是' + knowledgePoints.length + '个知识点的关键词。请找出其中语义相关的配对，仅返回JSON数组。\n' +
      '每个配对格式: {"from": 索引, "to": 索引, "strength": 0-100的相关度, "reason": "关联原因"}\n' +
      '只返回相关度≥' + Math.round(threshold * 100) + '的配对，最多' + maxEdges + '条。\n\n' + kwSummary;

    return _callAPI(
      config,
      '你是知识图谱关联分析专家。找出知识点间的语义关联。只返回JSON，不要额外文字。',
      prompt,
      2048
    ).then(function (raw) {
      try {
        var jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        if (jsonStr.startsWith('[')) {
          var edges = JSON.parse(jsonStr);
          return edges.filter(function (e) { return e.from !== e.to && e.strength > 0; }).slice(0, maxEdges);
        }
        throw new Error('非数组格式');
      } catch (e) {
        console.warn('[CloudAdapter] 云关联结果解析失败:', e.message);
        return [];
      }
    });
  }

  // ==================== 连接测试 ====================
  function testConnection(config) {
    return new Promise(function (resolve, reject) {
      if (!config.apiKey || !config.endpoint) {
        reject(new Error('请先配置API Key和Endpoint'));
        return;
      }
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 15000);

      fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiKey
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        }),
        signal: controller.signal
      })
      .then(function (r) {
        clearTimeout(timeout);
        if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (r.status === 401 ? 'API Key无效' : r.statusText));
        return r.json();
      })
      .then(function () { resolve(true); })
      .catch(function (e) {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  // ==================== 导出 ====================
  window.CloudAdapter = {
    summarize: summarize,
    findConnections: findConnections,
    testConnection: testConnection,
    estimateTokens: estimateTokens
  };

})();
