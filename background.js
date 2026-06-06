// ============================================================
//  双木林网申助手 - Service Worker
//  Author: 双木林 | Contact: 1321727938@qq.com
//  禁止未授权商用 / Unauthorized commercial use prohibited
// ============================================================

const API_CONFIG = {
  baseUrl: 'https://api.deepseek.com/anthropic',
  apiKey: '',
  model: 'deepseek-v4-pro',
  apiFormat: 'anthropic',        // 'anthropic' | 'openai'
  maxTokens: 8192
};

// ── 存储：获取API配置 ──────────────────────────────
async function getApiConfig() {
  const result = await chrome.storage.local.get(['apiKey', 'baseUrl', 'model', 'apiFormat']);
  return {
    baseUrl: result.baseUrl || API_CONFIG.baseUrl,
    apiKey: result.apiKey || API_CONFIG.apiKey,
    model: result.model || API_CONFIG.model,
    apiFormat: result.apiFormat || API_CONFIG.apiFormat,
    maxTokens: API_CONFIG.maxTokens
  };
}

// ── 存储：获取所有简历 ──────────────────────────────
async function getResumes() {
  const result = await chrome.storage.local.get('resumes');
  return result.resumes || [];
}

// ── 存储：保存简历列表 ──────────────────────────────
async function saveResumes(resumes) {
  await chrome.storage.local.set({ resumes });
}

// ── 存储：获取当前选中的简历ID ──────────────────────
async function getActiveResumeId() {
  const result = await chrome.storage.local.get('activeResumeId');
  return result.activeResumeId || null;
}

// ── 核心：调用 AI API（兼容 OpenAI / Anthropic 两种格式）───
async function callAI(messages) {
  const config = await getApiConfig();
  const fmt = config.apiFormat || 'anthropic';

  if (fmt === 'openai') {
    return callOpenAI(config, messages);
  }
  return callAnthropic(config, messages);
}

// ── 智能拼接 API 端点 ──────────────────────────
function buildEndpoint(baseUrl, apiFormat) {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const lastSeg = cleanUrl.split('/').pop();

  // A) 已是完整端点 → 直接用
  if (/\/chat\/completions$/i.test(cleanUrl) || /\/messages$/i.test(cleanUrl)) {
    return cleanUrl;
  }
  // B) 末段是版本号(/v1,/v3,/v4) → 只拼端点名
  if (/^v\d+$/i.test(lastSeg)) {
    return cleanUrl + (apiFormat === 'openai' ? '/chat/completions' : '/messages');
  }
  // C) 裸域名 → 拼完整路径
  return cleanUrl + (apiFormat === 'openai' ? '/v1/chat/completions' : '/v1/messages');
}

// ── OpenAI 格式 ────────────────────────────────
async function callOpenAI(config, messages) {
  const url = buildEndpoint(config.baseUrl, 'openai');

  const msgs = messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : (
      Array.isArray(m.content)
        ? m.content.map(b => b.text || '').join('\n')
        : ''
    )
  }));

  const body = {
    model: config.model,
    max_tokens: config.maxTokens,
    messages: msgs
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API错误 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  console.log('[网申助手] OpenAI响应:', JSON.stringify(data).slice(0, 300));

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI响应中无内容: ' + JSON.stringify(data).slice(0, 300));
  }
  return content;
}

// ── Anthropic 格式 ─────────────────────────────
async function callAnthropic(config, messages) {
  const url = buildEndpoint(config.baseUrl, 'anthropic');

  const normalized = messages.map(m => ({
    role: m.role,
    content: Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: m.content }]
  }));

  const body = {
    model: config.model,
    max_tokens: config.maxTokens,
    messages: normalized
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API错误 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  console.log('[网申助手] Anthropic响应结构:', JSON.stringify(data, null, 2).slice(0, 500));

  let content = data.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    throw new Error(`API返回content格式异常: ${typeof content}`);
  }

  const textBlock = content.find(b => b.type === 'text');
  if (!textBlock) {
    if (content.length > 0 && content[0].text) {
      return content[0].text;
    }
    throw new Error('API返回中没有文本内容，content类型: ' + content.map(b => b.type).join(', '));
  }
  return textBlock.text;
}

// ── 从AI返回中提取JSON ──────────────────────────────
function extractJSON(text) {
  // 去掉可能的markdown代码块标记
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // 查找第一个 { 到最后一个 }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1) {
    throw new Error('AI未返回有效JSON');
  }

  // 完整JSON直接解析
  if (end !== -1) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {
      // 有 } 但解析失败，走截断修复
    }
  }

  // 截断修复：从尾部找最后一个完整的键值对
  console.warn('[网申助手] JSON被截断，尝试修复...');
  const jsonStr = cleaned.slice(start);
  // 倒退找到最后一个 " , 结尾的完整行
  const lines = jsonStr.split('\n');
  // 从后往前找最后一个有 : 的行
  let lastValid = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.includes(':')) {
      lastValid = i;
      break;
    }
  }
  if (lastValid < 0) throw new Error('AI未返回有效JSON');

  // 截取到最后一个完整键值对，补上 }
  const repaired = lines.slice(0, lastValid + 1).join('\n')
    .replace(/,\s*$/, '') + '\n}';
  console.log('[网申助手] 修复后JSON(前300字):', repaired.slice(0, 300));

  try {
    return JSON.parse(repaired);
  } catch (e2) {
    throw new Error('AI未返回有效JSON，且截断修复失败');
  }
}

// ════════════════════════════════════════════════════
// 消息路由
// ════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 必须返回true以支持异步sendResponse
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    // ── 保存/更新简历 ──────────────────────────
    case 'save_resume': {
      const { resume } = message;
      const resumes = await getResumes();
      const idx = resumes.findIndex(r => r.id === resume.id);
      if (idx >= 0) {
        resumes[idx] = resume;
      } else {
        resumes.push(resume);
      }
      await saveResumes(resumes);
      // 新建简历时自动设为活跃
      if (idx < 0) {
        await chrome.storage.local.set({ activeResumeId: resume.id });
      }
      return { success: true };
    }

    // ── 获取所有简历 ──────────────────────────────
    case 'get_resumes': {
      const resumes = await getResumes();
      const activeId = await getActiveResumeId();
      return { success: true, data: { resumes, activeResumeId: activeId } };
    }

    // ── 删除简历 ──────────────────────────────────
    case 'delete_resume': {
      const { resumeId } = message;
      let resumes = await getResumes();
      resumes = resumes.filter(r => r.id !== resumeId);
      await saveResumes(resumes);

      // 如果删的是活跃简历，清除
      const activeId = await getActiveResumeId();
      if (activeId === resumeId) {
        await chrome.storage.local.set({ activeResumeId: resumes[0]?.id || null });
      }
      return { success: true };
    }

    // ── 设置活跃简历 ──────────────────────────────
    case 'set_active_resume': {
      await chrome.storage.local.set({ activeResumeId: message.resumeId });
      return { success: true };
    }

    // ── 保存API配置 ──────────────────────────────
    case 'save_api_config': {
      const { apiKey, baseUrl, model, apiFormat } = message;
      if (apiKey !== undefined) await chrome.storage.local.set({ apiKey });
      if (baseUrl !== undefined) await chrome.storage.local.set({ baseUrl });
      if (model !== undefined) await chrome.storage.local.set({ model });
      if (apiFormat !== undefined) await chrome.storage.local.set({ apiFormat });
      return { success: true };
    }

    // ── 自动填表：AI实时匹配 ──────────────────
    case 'auto_fill': {
      const { formFields, resumeId, groupCount, targetPrefix } = message;
      const resumes = await getResumes();
      const targetId = resumeId || await getActiveResumeId();
      const resume = resumes.find(r => r.id === targetId);

      if (!resume || !resume.rawText) {
        return { success: false, error: '没有可用的简历，请先在插件中保存简历原文' };
      }

      const dedupRule = (groupCount && groupCount > 1)
        ? `\n9. 当前页面有 ${groupCount} 个表单区域（id前缀g0_/g1_/g2_区分），不同区域必须匹配简历中不同段的内容，严禁两个区域填入相同的经历/项目/公司。如简历不足以区分所有区域，宁可留空也不重复。`
        : '';
      const targetRule = targetPrefix
        ? `\n10. 你只需要填写id以"${targetPrefix}"开头的字段，其他前缀的字段全部忽略，不要在JSON中包含它们。`
        : '';

      const prompt = `你是一个表单匹配专家。根据简历原文，为每个表单字段匹配最合适的值。

━━━ 简历原文 ━━━
${resume.rawText}

━━━ 表单字段列表 ━━━
${JSON.stringify(formFields, null, 2)}

━━━ 规则 ━━━
1. 返回JSON对象，key是表单字段的id，value是匹配的简历值
2. 对于select类型字段，尽量在options中选择最匹配的，不要编造不存在的选项
3. 数值字段（身高/体重/GPA/薪资等）只返回纯数字
4. 日期字段用 YYYY-MM-DD 格式
5. 性别字段返回 "男" 或 "女"
6. 找不到匹配的字段不要包含该key
7. 只返回JSON，不要任何其他文字
8. textarea/多行字段（项目描述、工作内容、获奖说明等）用\\n分隔段落或条目，不要写成一大段${dedupRule}${targetRule}

返回格式示例：
{"field_0": "张三", "field_1": "男", "field_3": "1999-06-01"}`;

      try {
        const aiResponse = await callAI([
          { role: 'user', content: prompt }
        ]);
        try {
          const mapping = extractJSON(aiResponse);
          return { success: true, data: mapping };
        } catch (parseErr) {
          // 解析失败时把AI原始返回带回前端显示
          return {
            success: false,
            error: `JSON解析失败: ${parseErr.message}`,
            debug: aiResponse.slice(0, 500)
          };
        }
      } catch (err) {
        return { success: false, error: `匹配失败: ${err.message}` };
      }
    }

    default:
      return { success: false, error: `未知消息类型: ${message.type}` };
  }
}
