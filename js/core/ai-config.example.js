// ====================================================================
//  KnowLink 知识星系 — AI 配置模板 (ai-config.example.js)
//  复制此文件为 ai-config.js 并填入你自己的API Key
//  ai-config.js 已加入 .gitignore，不会被提交到仓库
// ====================================================================

window.AIConfig = (function () {
  'use strict';

  // ==================== 默认配置 ====================
  var DEFAULT_CONFIG = {
    provider: 'custom',     // 自定义 API
    apiKey: 'your-api-key-here',                                 // 👈 填入你的API Key
    endpoint: 'https://api.example.com/v1/chat/completions',     // 👈 填入你的 API 端点
    model: 'your-model-name',                                    // 👈 填入模型名称
    enabled: false          // 填入Key后改为 true 启用云端API
  };

  // ==================== 提供商预设 ====================
  var PROVIDER_PRESETS = {
    custom: {
      endpoint: '',
      model: '',
      description: '自定义 API 端点'
    }
  };

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    PROVIDER_PRESETS: PROVIDER_PRESETS
  };
})();
