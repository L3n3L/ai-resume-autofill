/* ============================================================
   双木林网申助手 - 网页注入脚本
   职责：检测表单 → 收集字段 → 调AI匹配 → 自动填入
   支持：按表单容器分组，同一页面多个项目表单分别填写
   Author: 双木林 | Contact: 1321727938@qq.com
   禁止未授权商用 / Unauthorized commercial use prohibited
   ============================================================ */

// ── 配置 ──────────────────────────────────────
const CONFIG = {
  minFieldCount: 3,       // 至少3个表单字段才弹按钮
  scanDebounce: 500,      // 页面变化后延迟扫描
  highlightDuration: 1500, // 填入后高亮持续时间
};

// ── 全局状态：表单分组缓存 ──────────────────────
let formGroups = [];

// ════════════════════════════════════════════════
// 表单分组扫描：按容器分组字段
// ════════════════════════════════════════════════
function findFormGroups() {
  const groups = [];
  const assignedEls = new Set();

  // 收集所有表单相关元素
  const allInputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
    'textarea, select'
  );

  // 优先按 <form> 标签分组
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    const fields = collectFieldsIn(form, assignedEls);
    if (fields.length >= CONFIG.minFieldCount) {
      const title = findContainerTitle(form);
      groups.push({ container: form, title, fields });
    }
  });

  // 未归入任何 <form> 的字段，按 <section>/<fieldset>/card 容器分组
  const containers = document.querySelectorAll('section, fieldset, [class*="card"], [class*="panel"], [class*="block"]');
  containers.forEach(container => {
    // 跳过已在 form 内的容器
    if (container.closest('form')) return;
    const fields = collectFieldsIn(container, assignedEls);
    if (fields.length >= CONFIG.minFieldCount) {
      const title = findContainerTitle(container);
      groups.push({ container, title, fields });
    }
  });

  // 剩余未归组的字段 → 单独一组
  const restFields = [];
  const seen = new Set();
  allInputs.forEach((el, i) => {
    if (assignedEls.has(el)) return;
    if (el.offsetParent === null && el.type !== 'hidden') return;
    const field = buildField(el, i);
    const key = `${field.label}|${field.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    restFields.push(field);
  });
  if (restFields.length >= CONFIG.minFieldCount) {
    groups.push({ container: document.body, title: '表单区域', fields: restFields });
  }

  return groups;
}

// ── 收集容器内的表单字段 ────────────────────────
function collectFieldsIn(container, assignedSet) {
  const fields = [];
  const seen = new Set();
  const inputs = container.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
    'textarea, select'
  );

  inputs.forEach((el, i) => {
    if (assignedSet && assignedSet.has(el)) return;
    // 跳过不可见元素（但有特殊class的除外-如Element UI的隐藏元素）
    if (el.offsetParent === null && !el.closest('[style*="display:"]') && el.type !== 'hidden') return;

    const field = buildField(el, i);
    const key = `${field.label}|${field.name}`;
    if (seen.has(key)) return;
    seen.add(key);

    if (assignedSet) assignedSet.add(el);
    fields.push(field);
  });

  return fields;
}

// ── 构造单个字段对象 ────────────────────────────
function buildField(el, index) {
  const label = findLabel(el);
  const placeholder = el.getAttribute('placeholder') || '';
  const name = el.getAttribute('name') || el.id || '';
  const type = el.tagName === 'SELECT' ? 'select' : (el.type || 'text');

  let options = null;
  if (el.tagName === 'SELECT') {
    options = Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
  }

  return {
    id: `field_${index}`,
    label, type, placeholder, name, options,
    element: el,
  };
}

// ── 查找容器的标题 ──────────────────────────────
function findContainerTitle(container) {
  // 优先找 h1-h6 或 class 含 title/header/caption 的元素
  const titleEl = container.querySelector('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="header"],[class*="caption"]');
  if (titleEl) {
    return titleEl.textContent.trim().slice(0, 40);
  }
  // 其次找 data-title 或 aria-label
  if (container.dataset.title) return container.dataset.title;
  if (container.getAttribute('aria-label')) return container.getAttribute('aria-label');
  return null;
}

// ── 查找元素关联的label文本 ────────────────────
function findLabel(el) {
  // 方法1：id关联的<label>
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent.trim();
  }

  // 方法2：父级<label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const text = parentLabel.textContent.trim();
    // 去掉表单元素自身的文本（如果有）
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
    const clean = clone.textContent.trim();
    if (clean) return clean;
  }

  // 方法3：往上找包含文本的相邻/父元素
  let current = el.parentElement;
  for (let i = 0; i < 5 && current; i++) {
    const prev = current.previousElementSibling;
    if (prev && prev.textContent.trim().length < 30) {
      return prev.textContent.trim();
    }
    // 在父元素内找纯文本
    const textNodes = Array.from(current.childNodes).filter(
      n => n.nodeType === 3 && n.textContent.trim()
    );
    if (textNodes.length > 0) {
      return textNodes[0].textContent.trim().slice(0, 30);
    }
    current = current.parentElement;
  }

  // 方法4：placeholder
  if (el.placeholder) return el.placeholder;

  // 方法5：name/id属性
  if (el.name) return el.name;
  if (el.id) return el.id;

  return '';
}

// ════════════════════════════════════════════════
// 自动填充（支持单组或全部）
// ════════════════════════════════════════════════
async function autoFillForm(groupIndex) {
  const groups = findFormGroups();
  if (groups.length === 0) {
    showToast('未检测到表单区域', 'warning');
    return;
  }

  const isSingle = (groupIndex !== undefined);
  const targetGroups = isSingle ? [groups[groupIndex]] : groups;
  // 始终全量发送，让AI看到完整图景（单独填也需要上下文区分子区域）
  const allGroups = groups;
  const totalLabel = isSingle
    ? (targetGroups[0].title || `区域${groupIndex + 1}`)
    : `全部 ${groups.length} 个区域`;

  showToast(`正在匹配 ${totalLabel}...`, 'info');

  try {
    // 始终遍历全部区域发送，id 加绝对索引前缀
    const allFields = [];
    allGroups.forEach((group, absIdx) => {
      const groupLabel = group.title || `区域${absIdx + 1}`;
      group.fields.forEach(f => {
        allFields.push({
          id: `g${absIdx}_${f.id}`,
          label: `[${groupLabel}] ${f.label}`,
          type: f.type,
          placeholder: f.placeholder,
          name: f.name,
          options: f.options,
        });
      });
    });

    const targetPrefix = isSingle ? `g${groupIndex}_` : null;

    const response = await chrome.runtime.sendMessage({
      type: 'auto_fill',
      formFields: allFields,
      groupCount: groups.length,
      targetPrefix,
    });

    if (!response.success) {
      const msg = response.debug
        ? response.error + '\n原始返回(前500字): ' + response.debug
        : response.error;
      console.error('[网申助手]', msg);
      showToast(response.error, 'error');
      return;
    }

    // 按区域前缀分配并填入
    const mapping = response.data;
    let totalFilled = 0;

    const prefix = isSingle ? `g${groupIndex}_` : '';
    const fillGroups = isSingle ? targetGroups : groups;

    fillGroups.forEach((group, gi) => {
      const gPrefix = isSingle ? prefix : `g${gi}_`;
      for (const field of group.fields) {
        const mappedKey = `${gPrefix}${field.id}`;
        const value = mapping[mappedKey];
        if (value === undefined || value === null || value === '') continue;
        const filled = fillField(field, value);
        if (filled) totalFilled++;
      }
    });

    if (totalFilled > 0) {
      showToast(`已自动填写 ${totalFilled} 个字段`, 'success');
    } else {
      showToast('未能匹配到可填写的字段', 'warning');
    }
  } catch (err) {
    showToast('填表失败: ' + err.message, 'error');
  }
}

// ── 填入单个字段 ───────────────────────────────
function fillField(field, value) {
  const el = field.element;
  if (!el) return false;

  try {
    if (field.type === 'select') {
      return fillSelect(el, value);
    } else if (field.type === 'checkbox' || field.type === 'radio') {
      return fillCheckable(el, value, field.type);
    } else {
      return fillInput(el, value);
    }
  } catch (e) {
    return false;
  }
}

// ── 填入input/textarea ─────────────────────────
function fillInput(el, value) {
  // 使用原生setter触发React/Vue的响应
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  if (el.tagName === 'TEXTAREA' && nativeTextareaSetter) {
    nativeTextareaSetter.call(el, String(value));
  } else if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, String(value));
  } else {
    el.value = String(value);
  }

  // 触发事件，让框架感知变化
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // 高亮反馈
  highlightElement(el);
  return true;
}

// ── 填入select下拉 ─────────────────────────────
function fillSelect(el, value) {
  const options = Array.from(el.options);
  const str = String(value).toLowerCase();

  // 精确匹配
  let match = options.find(o => o.textContent.trim() === value);
  // 包含匹配
  if (!match) match = options.find(o => o.textContent.toLowerCase().includes(str));
  // 模糊匹配（value包含option文本）
  if (!match) match = options.find(o => str.includes(o.textContent.toLowerCase().trim()));
  // 学历特殊处理（"本科"/"学士"等）
  if (!match) {
    const eduMap = { '本科': ['本科', '学士', '大学本科'], '硕士': ['硕士', '研究生'], '博士': ['博士'] };
    const aliases = eduMap[value] || [];
    match = options.find(o => aliases.some(a => o.textContent.includes(a)));
  }

  if (match) {
    el.value = match.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    highlightElement(el);
    return true;
  }
  return false;
}

// ── 填入checkbox/radio ─────────────────────────
function fillCheckable(el, value, type) {
  // 对于单选/多选，匹配label文本
  const wrapper = el.closest('label') || el.parentElement;
  const labelText = wrapper?.textContent?.toLowerCase() || '';

  if (labelText.includes(String(value).toLowerCase())) {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    highlightElement(wrapper || el);
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════
// 视觉效果：高亮 + Toast
// ════════════════════════════════════════════════
function highlightElement(el) {
  const origOutline = el.style.outline;
  const origTransition = el.style.transition;

  el.style.transition = 'outline 0.15s';
  el.style.outline = '3px solid #22c55e';

  setTimeout(() => {
    el.style.outline = '3px solid transparent';
  }, CONFIG.highlightDuration);

  setTimeout(() => {
    el.style.outline = origOutline;
    el.style.transition = origTransition;
  }, CONFIG.highlightDuration + 300);
}

function showToast(msg, type) {
  const old = document.getElementById('__autoapply_toast');
  if (old) old.remove();

  const bgMap = {
    success: '#059669',
    error: '#dc2626',
    warning: '#d97706',
    info: '#3b82f6',
  };

  const toast = document.createElement('div');
  toast.id = '__autoapply_toast';
  toast.textContent = msg;
  toast.style.cssText = [
    'position:fixed;bottom:80px;right:20px;z-index:2147483647;',
    'padding:10px 20px;border-radius:10px;font-size:13.5px;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'box-shadow:0 8px 24px rgba(0,0,0,0.12),0 2px 6px rgba(0,0,0,0.06);',
    'background:' + (bgMap[type] || bgMap.info) + ';color:#fff;',
    'letter-spacing:0.01em;transition:opacity 0.25s,transform 0.25s;',
    'animation:__aa_slideup 0.3s ease;',
  ].join('');

  // 注入 keyframes（仅一次）
  if (!document.getElementById('__aa_anim')) {
    const style = document.createElement('style');
    style.id = '__aa_anim';
    style.textContent = '@keyframes __aa_slideup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(4px)';
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

// ════════════════════════════════════════════════
// 分组按钮：在每个表单区域注入填写按钮
// ════════════════════════════════════════════════
function createGroupButtons() {
  const groups = findFormGroups();
  formGroups = groups;

  removeAllButtons();
  if (groups.length === 0) return;

  groups.forEach((group, index) => {
    const label = group.title || `表单区域 ${index + 1}`;
    const mountPoint = group.container;
    if (!mountPoint || !mountPoint.parentNode) return;

    // 按钮容器（加分割线）
    const wrapper = document.createElement('div');
    wrapper.className = '__autoapply_group_wrap';
    wrapper.style.cssText = [
      'display:flex;align-items:center;gap:10px;margin:12px 0 16px;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    ].join('');

    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:10px;font-weight:600;color:#3b82f6;letter-spacing:.04em;text-transform:uppercase;';
    badge.textContent = 'Auto-fill';

    const btn = document.createElement('button');
    btn.className = '__autoapply_group_btn';
    btn.textContent = label;
    btn.style.cssText = [
      'padding:5px 14px;border:1px solid #e2e8f0;border-radius:6px;',
      'font-size:12px;font-weight:500;cursor:pointer;',
      'background:#ffffff;color:#475569;',
      'transition:all 0.15s ease;',
    ].join('');

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#3b82f6';
      btn.style.color = '#fff';
      btn.style.borderColor = '#3b82f6';
      btn.style.boxShadow = '0 1px 4px rgba(59,130,246,0.25)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#ffffff';
      btn.style.color = '#475569';
      btn.style.borderColor = '#e2e8f0';
      btn.style.boxShadow = 'none';
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      autoFillForm(index);
    });

    wrapper.appendChild(badge);
    wrapper.appendChild(btn);

    const firstChild = mountPoint.firstChild;
    if (firstChild) {
      mountPoint.insertBefore(wrapper, firstChild);
    } else {
      mountPoint.appendChild(wrapper);
    }
  });
}

// ════════════════════════════════════════════════
// 悬浮按钮（固定右下角）
// ════════════════════════════════════════════════
function createFloatingButton() {
  if (document.getElementById('__autoapply_btn')) return;

  const btn = document.createElement('button');
  btn.id = '__autoapply_btn';
  btn.style.cssText = [
    'position:fixed;bottom:24px;right:24px;z-index:2147483646;',
    'padding:0;border:none;background:none;cursor:pointer;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
  ].join('');

  // 内层 pill
  const pill = document.createElement('span');
  pill.style.cssText = [
    'display:inline-flex;align-items:center;gap:8px;',
    'padding:10px 18px;border-radius:24px;',
    'font-size:13px;font-weight:600;letter-spacing:.01em;',
    'color:#fff;background:#3b82f6;',
    'box-shadow:0 2px 12px rgba(59,130,246,0.28);',
    'transition:transform 0.18s ease,box-shadow 0.18s ease,background 0.18s ease;',
  ].join('');

  const dot = document.createElement('span');
  dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#93c5fd;';

  const label = document.createElement('span');
  label.id = '__autoapply_btn_label';

  pill.appendChild(dot);
  pill.appendChild(label);
  btn.appendChild(pill);

  btn.addEventListener('mouseenter', () => {
    pill.style.transform = 'translateY(-1px)';
    pill.style.boxShadow = '0 4px 16px rgba(59,130,246,0.35)';
    pill.style.background = '#2563eb';
  });
  btn.addEventListener('mouseleave', () => {
    pill.style.transform = 'translateY(0)';
    pill.style.boxShadow = '0 2px 12px rgba(59,130,246,0.28)';
    pill.style.background = '#3b82f6';
  });

  btn.addEventListener('click', () => {
    const groups = findFormGroups();
    if (groups.length <= 1) {
      autoFillForm(0);
    } else {
      showGroupSelector(groups);
    }
  });

  updateFloatingButtonLabel();
  document.body.appendChild(btn);
}

function updateFloatingButtonLabel() {
  const label = document.getElementById('__autoapply_btn_label');
  if (!label) return;
  const groups = findFormGroups();
  label.textContent = groups.length <= 1
    ? '自动填写'
    : `全部填写 (${groups.length})`;
}

function removeFloatingButton() {
  const btn = document.getElementById('__autoapply_btn');
  if (btn) btn.remove();
  removeGroupSelector();
}

function removeAllButtons() {
  document.querySelectorAll('.__autoapply_group_btn,.__autoapply_group_wrap').forEach(b => b.remove());
}

// ════════════════════════════════════════════════
// 区域选择器弹窗
// ════════════════════════════════════════════════
function showGroupSelector(groups) {
  removeGroupSelector();

  const overlay = document.createElement('div');
  overlay.id = '__autoapply_selector_overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:2147483645;',
    'background:rgba(15,23,42,0.40);backdrop-filter:blur(2px);',
    'display:flex;align-items:center;justify-content:center;',
  ].join('');
  overlay.addEventListener('click', removeGroupSelector);

  const panel = document.createElement('div');
  panel.id = '__autoapply_selector_panel';
  panel.style.cssText = [
    'background:#fff;border-radius:16px;padding:28px 28px 20px;',
    'min-width:340px;max-width:440px;',
    'box-shadow:0 20px 60px rgba(0,0,0,0.12),0 0 0 1px rgba(0,0,0,0.04);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
  ].join('');
  panel.addEventListener('click', (e) => e.stopPropagation());

  const groupCards = groups.map((g, i) => {
    const title = g.title || `表单区域 ${i + 1}`;
    return `
      <button class="__autoapply_sel_btn" data-index="${i}" style="
        display:flex;align-items:center;justify-content:space-between;
        width:100%;padding:14px 16px;margin-bottom:8px;
        border:1px solid #f1f5f9;border-radius:10px;
        background:#f8fafc;cursor:pointer;text-align:left;
        font-size:13px;font-weight:500;color:#0f172a;
        transition:all 0.15s ease;
      ">
        <span style="
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;
        ">${title}</span>
        <span style="
          flex-shrink:0;margin-left:12px;padding:2px 10px;border-radius:20px;
          background:#eff6ff;color:#3b82f6;font-size:11px;font-weight:500;
        ">${g.fields.length} items</span>
      </button>`;
  }).join('');

  panel.innerHTML = `
    <div style="
      display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;
    ">
      <span style="font-size:16px;font-weight:700;color:#0f172a;">选择表单区域</span>
      <span style="font-size:12px;color:#94a3b8;font-weight:500;">${groups.length} detected</span>
    </div>
    <div>${groupCards}</div>
    <div style="margin-top:18px;display:flex;gap:10px;">
      <button id="__autoapply_sel_all" style="
        flex:1;padding:10px 0;border:none;border-radius:10px;
        background:#3b82f6;color:#fff;cursor:pointer;
        font-size:13px;font-weight:600;letter-spacing:.01em;
        transition:background 0.15s;
      ">全部填写</button>
      <button id="__autoapply_sel_cancel" style="
        padding:10px 20px;border:1.5px solid #f1f5f9;border-radius:10px;
        background:#fff;color:#64748b;cursor:pointer;
        font-size:13.5px;font-weight:500;
        transition:background 0.15s;
      ">取消</button>
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // hover 效果
  panel.querySelectorAll('.__autoapply_sel_btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#fff';
      btn.style.borderColor = '#93c5fd';
      btn.style.boxShadow = '0 2px 8px rgba(59,130,246,0.08)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#f8fafc';
      btn.style.borderColor = '#f1f5f9';
      btn.style.boxShadow = 'none';
    });
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      removeGroupSelector();
      autoFillForm(idx);
    });
  });

  panel.querySelector('#__autoapply_sel_all').addEventListener('click', () => {
    removeGroupSelector();
    autoFillForm(undefined);
  });
  panel.querySelector('#__autoapply_sel_all').addEventListener('mouseenter', function () {
    this.style.background = '#2563eb';
  });
  panel.querySelector('#__autoapply_sel_all').addEventListener('mouseleave', function () {
    this.style.background = '#3b82f6';
  });
  panel.querySelector('#__autoapply_sel_cancel').addEventListener('click', removeGroupSelector);
  panel.querySelector('#__autoapply_sel_cancel').addEventListener('mouseenter', function () {
    this.style.background = '#f8fafc';
  });
  panel.querySelector('#__autoapply_sel_cancel').addEventListener('mouseleave', function () {
    this.style.background = '#fff';
  });
}

function removeGroupSelector() {
  const overlay = document.getElementById('__autoapply_selector_overlay');
  if (overlay) overlay.remove();
}

// ════════════════════════════════════════════════
// 检测是否应该显示按钮
// ════════════════════════════════════════════════
function checkAndUpdateButton() {
  const groups = findFormGroups();

  if (groups.length > 0) {
    createGroupButtons();       // 每个区域注入按钮
    createFloatingButton();     // 右下角悬浮按钮
    updateFloatingButtonLabel();
  } else {
    removeAllButtons();
    removeFloatingButton();
  }
}

// ════════════════════════════════════════════════
// 页面监听（防抖）
// ════════════════════════════════════════════════
let debounceTimer = null;

function debouncedCheck() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(checkAndUpdateButton, CONFIG.scanDebounce);
}

// 监听DOM变化（SPA页面切换）
const observer = new MutationObserver(() => {
  debouncedCheck();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// 初始检测
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAndUpdateButton);
} else {
  checkAndUpdateButton();
}

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  observer.disconnect();
  removeAllButtons();
  removeFloatingButton();
});
