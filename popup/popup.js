// ============================================================
//  双木林网申助手 - 弹窗逻辑
//  Author: 双木林 | Contact: 1321727938@qq.com
//  禁止未授权商用 / Unauthorized commercial use prohibited
// ============================================================

// ── 状态 ────────────────────────────────────
let state = {
  resumes: [],
  activeResumeId: null,
  editingResumeId: null, // 正在编辑的简历ID（null=新建）
};

// ── DOM引用 ──────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const dom = {
  // tabs
  tabs: document.querySelectorAll('.tab'),
  tabResume: $('#tab-resume'),
  tabSettings: $('#tab-settings'),
  // 简历列表
  resumeList: $('#resume-list'),
  // 编辑器
  editorTitle: $('#editor-title'),
  resumeName: $('#resume-name'),
  resumeText: $('#resume-text'),
  btnSave: $('#btn-save'),
  btnCancel: $('#btn-cancel'),
  saveStatus: $('#save-status'),
  // 设置
  cfgApiFormat: $('#cfg-apiFormat'),
  cfgBaseUrl: $('#cfg-baseUrl'),
  cfgApiKey: $('#cfg-apiKey'),
  cfgModel: $('#cfg-model'),
  btnSaveCfg: $('#btn-save-cfg'),
  btnTestCfg: $('#btn-test-cfg'),
  cfgStatus: $('#cfg-status'),
  cfgTestStatus: $('#cfg-test-status'),
  // 打赏
  donateBtns: document.querySelectorAll('.btn-donate'),
  donateQr: $('#donate-qr'),
};

// ════════════════════════════════════════════════
// 初始化
// ════════════════════════════════════════════════
async function init() {
  // Tab切换
  dom.tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 保存/取消按钮
  dom.btnSave.addEventListener('click', handleSave);
  dom.btnCancel.addEventListener('click', cancelEdit);

  // 设置保存
  dom.btnSaveCfg.addEventListener('click', saveApiConfig);
  // API连通测试
  dom.btnTestCfg.addEventListener('click', testApiConnection);

  // 格式切换时更新Base URL占位提示
  dom.cfgApiFormat.addEventListener('change', () => {
    const placeholder = dom.cfgApiFormat.value === 'openai'
      ? 'https://api.openai.com（或 https://api.deepseek.com）'
      : 'https://api.deepseek.com/anthropic（或 https://api.anthropic.com）';
    dom.cfgBaseUrl.placeholder = placeholder;
  });

  // 打赏切换
  dom.donateBtns.forEach(btn => {
    btn.addEventListener('click', () => toggleDonate(btn.dataset.code));
  });

  // 加载数据
  await loadResumes();
  await loadApiConfig();
}

// ════════════════════════════════════════════════
// Tab切换
// ════════════════════════════════════════════════
function switchTab(name) {
  dom.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  dom.tabResume.classList.toggle('active', name === 'resume');
  dom.tabSettings.classList.toggle('active', name === 'settings');
}

// ════════════════════════════════════════════════
// 加载简历列表
// ════════════════════════════════════════════════
async function loadResumes() {
  const response = await chrome.runtime.sendMessage({ type: 'get_resumes' });
  if (response.success) {
    state.resumes = response.data.resumes;
    state.activeResumeId = response.data.activeResumeId;
    renderResumeList();
  }
}

// ════════════════════════════════════════════════
// 渲染简历列表
// ════════════════════════════════════════════════
function renderResumeList() {
  if (state.resumes.length === 0) {
    dom.resumeList.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <p>暂无简历</p>
        <p style="font-size:12px;color:#94a3b8;margin-top:4px;">粘贴简历原文并保存，AI 将自动匹配表单</p>
      </div>`;
    return;
  }

  dom.resumeList.innerHTML = state.resumes.map(r => {
    const isActive = r.id === state.activeResumeId;
    const date = new Date(r.createdAt).toLocaleDateString('zh-CN');
    const len = r.rawText?.length || 0;
    return `
      <div class="resume-card ${isActive ? 'active' : ''}" data-id="${r.id}">
        <div class="info">
          <div class="name">
            ${escHtml(r.name)}
            ${isActive ? '<span class="badge">当前使用</span>' : ''}
          </div>
          <div class="date">${len} chars · ${date}</div>
        </div>
        <div class="actions">
          <button title="设为活跃" data-action="activate" class="action-star">Star</button>
          <button title="编辑" data-action="edit" class="action-edit">Edit</button>
          <button title="删除" data-action="delete" class="action-delete">Del</button>
        </div>
      </div>`;
  }).join('');

  // 事件委托
  dom.resumeList.querySelectorAll('.resume-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const action = e.target.dataset.action || e.target.closest('button')?.dataset.action;
      const id = card.dataset.id;

      if (action === 'activate') setActiveResume(id);
      else if (action === 'edit') startEdit(id);
      else if (action === 'delete') deleteResume(id);
    });
  });
}

// ════════════════════════════════════════════════
// 设置活跃简历
// ════════════════════════════════════════════════
async function setActiveResume(id) {
  await chrome.runtime.sendMessage({ type: 'set_active_resume', resumeId: id });
  state.activeResumeId = id;
  renderResumeList();
}

// ════════════════════════════════════════════════
// 删除简历
// ════════════════════════════════════════════════
async function deleteResume(id) {
  if (!confirm('确定删除这份简历吗？')) return;
  await chrome.runtime.sendMessage({ type: 'delete_resume', resumeId: id });
  await loadResumes();
  if (state.editingResumeId === id) cancelEdit();
}

// ════════════════════════════════════════════════
// 编辑简历
// ════════════════════════════════════════════════
function startEdit(id) {
  state.editingResumeId = id;
  const resume = state.resumes.find(r => r.id === id);

  if (resume) {
    dom.editorTitle.textContent = '编辑简历';
    dom.resumeName.value = resume.name;
    dom.resumeText.value = resume.rawText || '';
  } else {
    dom.editorTitle.textContent = '新建简历';
    dom.resumeName.value = '';
    dom.resumeText.value = '';
  }

  dom.btnCancel.classList.remove('hidden');
}

function cancelEdit() {
  state.editingResumeId = null;
  dom.editorTitle.textContent = '新建简历';
  dom.resumeName.value = '';
  dom.resumeText.value = '';
  dom.btnCancel.classList.add('hidden');
  dom.saveStatus.classList.add('hidden');
}

// ════════════════════════════════════════════════
// 保存简历
// ════════════════════════════════════════════════
async function handleSave() {
  const name = dom.resumeName.value.trim();
  const rawText = dom.resumeText.value.trim();

  if (!name) {
    alert('请输入简历名称');
    return;
  }
  if (!rawText) {
    alert('请粘贴简历文本');
    return;
  }

  const resume = {
    id: state.editingResumeId || `resume_${Date.now()}`,
    name: name,
    createdAt: new Date().toISOString(),
    rawText: rawText,
  };

  await chrome.runtime.sendMessage({ type: 'save_resume', resume });
  showStatus('success', '保存成功');
  await loadResumes();
  cancelEdit();
}

// ════════════════════════════════════════════════
// 状态提示
// ════════════════════════════════════════════════
function showStatus(type, msg) {
  dom.saveStatus.textContent = msg;
  dom.saveStatus.className = `status-msg ${type}`;
  dom.saveStatus.classList.remove('hidden');
  if (type === 'success') {
    setTimeout(() => dom.saveStatus.classList.add('hidden'), 3000);
  }
}

// ════════════════════════════════════════════════
// API配置
// ════════════════════════════════════════════════
async function loadApiConfig() {
  const result = await chrome.storage.local.get(['apiKey', 'baseUrl', 'model', 'apiFormat']);
  dom.cfgApiFormat.value = result.apiFormat || 'anthropic';
  dom.cfgBaseUrl.value = result.baseUrl || 'https://api.deepseek.com/anthropic';
  dom.cfgApiKey.value = result.apiKey || '';
  dom.cfgModel.value = result.model || 'deepseek-v4-pro';
}

async function saveApiConfig() {
  await chrome.runtime.sendMessage({
    type: 'save_api_config',
    apiFormat: dom.cfgApiFormat.value,
    apiKey: dom.cfgApiKey.value.trim(),
    baseUrl: dom.cfgBaseUrl.value.trim(),
    model: dom.cfgModel.value.trim(),
  });
  dom.cfgStatus.textContent = '配置已保存';
  dom.cfgStatus.className = 'status-msg success';
  dom.cfgStatus.classList.remove('hidden');
  setTimeout(() => dom.cfgStatus.classList.add('hidden'), 2000);
}

// ════════════════════════════════════════════════
// API连通测试
// ════════════════════════════════════════════════
async function testApiConnection() {
  const apiFormat = dom.cfgApiFormat.value;
  const baseUrl = dom.cfgBaseUrl.value.trim();
  const apiKey = dom.cfgApiKey.value.trim();
  const model = dom.cfgModel.value.trim();

  if (!baseUrl || !apiKey) {
    dom.cfgTestStatus.textContent = '请先填写 Base URL 和 API Key';
    dom.cfgTestStatus.className = 'status-msg error';
    dom.cfgTestStatus.classList.remove('hidden');
    return;
  }

  // 进入 loading
  dom.btnTestCfg.classList.add('loading');
  dom.btnTestCfg.disabled = true;
  dom.cfgTestStatus.classList.add('hidden');

  const t0 = performance.now();

  try {
    let body;

    // 智能拼接三段式：
    //   A) 已是完整端点(/chat/completions 或 /messages 结尾) → 直接用
    //   B) 路径末段是版本号(/v1, /v3, /v4) → 只拼端点名
    //   C) 裸域名 → 拼 /v1/chat/completions 或 /v1/messages
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const lastSeg = cleanUrl.split('/').pop();
    let endpoint;

    if (/\/chat\/completions$/i.test(cleanUrl) || /\/messages$/i.test(cleanUrl)) {
      endpoint = cleanUrl;                                        // A
    } else if (/^v\d+$/i.test(lastSeg)) {
      const suffix = apiFormat === 'openai' ? '/chat/completions' : '/messages';
      endpoint = cleanUrl + suffix;                               // B
    } else {
      const suffix = apiFormat === 'openai' ? '/v1/chat/completions' : '/v1/messages';
      endpoint = cleanUrl + suffix;                               // C
    }

    if (apiFormat === 'openai') {
      body = {
        model: model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      };
    } else {
      body = {
        model: model || 'claude-3-haiku',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const elapsed = Math.round(performance.now() - t0);

    if (res.ok) {
      const data = await res.json();
      const returnedModel = data.model || model;
      dom.cfgTestStatus.innerHTML = `连通 <span style="opacity:0.6;font-weight:400;">(${elapsed}ms) · ${escHtml(returnedModel)}</span>`;
      dom.cfgTestStatus.className = 'status-msg success';
    } else {
      const errText = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status} ${res.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) errMsg += ': ' + errJson.error.message;
      } catch (_) {
        if (errText) errMsg += ': ' + errText.slice(0, 120);
      }
      dom.cfgTestStatus.textContent = `连接失败: ${errMsg}`;
      dom.cfgTestStatus.className = 'status-msg error';
      dom.cfgTestStatus.title = `请求地址: ${endpoint}`;
    }
  } catch (e) {
    dom.cfgTestStatus.textContent = `网络错误: ${e.message}`;
    dom.cfgTestStatus.className = 'status-msg error';
  }

  dom.cfgTestStatus.classList.remove('hidden');
  dom.btnTestCfg.classList.remove('loading');
  dom.btnTestCfg.disabled = false;
}

// ════════════════════════════════════════════════
// 打赏
// ════════════════════════════════════════════════
function toggleDonate(code) {
  const isSame = dom.donateQr.dataset.active === code;
  
  // 高亮按钮
  dom.donateBtns.forEach(b => b.classList.toggle('active', b.dataset.code === code && !isSame));

  if (isSame) {
    // 再点同一个就收起
    dom.donateQr.classList.add('hidden');
    delete dom.donateQr.dataset.active;
  } else {
    const labels = { wx: '微信', zfb: '支付宝' };
    dom.donateQr.innerHTML = `<img src="../icons/${code}.jpg" alt="${labels[code]}" /><div class="qr-label">${labels[code]}扫码</div>`;
    dom.donateQr.classList.remove('hidden');
    dom.donateQr.dataset.active = code;
  }
}

// ════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

// ── 启动 ──────────────────────────────────────
init();
