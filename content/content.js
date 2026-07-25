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
  logLevel: 3,            // 0=off 1=error 2=warn 3=info 4=debug
};

// ── 日志设施 ──────────────────────────────────
const LOG = {
  SILENT: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4,
  _level: CONFIG.logLevel,
  _check() {
    // 允许通过 URL 参数 ?__log=4 临时调高日志级别
    try {
      const m = location.search.match(/[?&]__log=(\d)/);
      if (m) return parseInt(m[1]);
    } catch(e) {}
    return this._level;
  },
  _fmt(module, msg, data) {
    const ts = new Date().toISOString().slice(11, 23);
    const tag = `[${ts}][${module}]`;
    return data !== undefined ? [tag, msg, data] : [tag, msg];
  },
  error(module, msg, data) { if (this._check() >= this.ERROR) console.error(...this._fmt(module, msg, data)); },
  warn(module, msg, data)  { if (this._check() >= this.WARN)  console.warn(...this._fmt(module, msg, data)); },
  info(module, msg, data)  { if (this._check() >= this.INFO)  console.info(...this._fmt(module, msg, data)); },
  debug(module, msg, data) { if (this._check() >= this.DEBUG) console.log(...this._fmt(module, msg, data)); },
  // 性能计时
  time(module, label) { if (this._check() >= this.INFO) console.time(`[${module}] ${label}`); },
  timeEnd(module, label) { if (this._check() >= this.INFO) console.timeEnd(`[${module}] ${label}`); },
};

// ── 可见性检测（对标求职方舟 isDomVisible）────
function isVisible(el) {
  if (!el || !el.ownerDocument?.contains(el)) return false;

  // contentEditable 特殊处理
  if (el.isContentEditable) return el.offsetParent !== null && el.offsetWidth > 0;

  // 检查自身和祖先
  let node = el;
  while (node) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (node.hidden) return false;
    // 零尺寸检查（但允许处于加载中的元素）
    if (node.offsetWidth === 0 && node.offsetHeight === 0 && style.overflow === 'hidden') return false;
    node = node.parentElement;
  }

  // overflow:hidden 裁剪检查
  node = el.parentElement;
  while (node && node.tagName !== 'BODY') {
    const style = getComputedStyle(node);
    if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
      const rect = el.getBoundingClientRect();
      const parentRect = node.getBoundingClientRect();
      if (rect.bottom <= parentRect.top || rect.top >= parentRect.bottom) return false;
      const visibleHeight = Math.min(rect.bottom, parentRect.bottom) - Math.max(rect.top, parentRect.top);
      if (visibleHeight / (rect.height || 1) < 0.1) return false;
    }
    node = node.parentElement;
  }

  return el.offsetParent !== null;
}

// ── 全局状态：表单分组缓存 ──────────────────────
let formGroups = [];

// ════════════════════════════════════════════════
// 展开隐藏区域：点击"添加/编辑/展开"按钮，扫出隐藏字段
// ════════════════════════════════════════════════
const EXPAND_CONFIG = {
  textPatterns: [/^(继续)?(添加|增加|新增|编辑|修改|展开)/],
  classPatterns: [/add|plus|expand|btn-add|btn-plus|el-icon-circle-plus|icon-tianjia/],
  clickDelay: 300,
  maxClicks: 12,
};

async function expandHiddenSections() {
  const clickedSet = new Set();

  // 收集候选按钮
  const allCandidates = document.querySelectorAll(
    'button, a, span[role="button"], div[role="button"], i[class*="add"], i[class*="plus"]'
  );

  const hits = [];
  allCandidates.forEach(el => {
    if (el.offsetParent === null) return; // 不可见
    const text = (el.textContent || '').trim();
    const cls = el.className?.toString?.() || el.getAttribute('class') || '';

    const textMatch = EXPAND_CONFIG.textPatterns.some(p => p.test(text));
    const classMatch = EXPAND_CONFIG.classPatterns.some(p => p.test(cls));

    if (textMatch || classMatch) {
      // 关键过滤：如果是"添加"类按钮，检查上层容器是否已有可见字段
      // 已有字段说明区域已展开，"添加"=新增一行→不点；无字段说明是折叠态→点
      if (/^(继续)?(添加|增加|新增)/.test(text)) {
        if (sectionHasVisibleFields(el)) return; // 已展开，跳过
      }

      const hash = text.slice(0, 20) + '|' + cls.slice(0, 30);
      if (!clickedSet.has(hash)) {
        hits.push(el);
        clickedSet.add(hash);
      }
    }
  });

  // 限制数量，优先点文本匹配的
  const textHits = hits.filter(el => EXPAND_CONFIG.textPatterns.some(p => p.test((el.textContent || '').trim())));
  const classHits = hits.filter(el => !textHits.includes(el));
  const ordered = [...textHits, ...classHits].slice(0, EXPAND_CONFIG.maxClicks);

  if (ordered.length === 0) return;

  for (const el of ordered) {
    try {
      el.click();
      // 触发框架事件
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(EXPAND_CONFIG.clickDelay);
    } catch (_) { /* 点击失败的按钮跳过 */ }
  }
  LOG.info('expand', `clicked=${clickedSet.size} candidates=${hits.length}`);
}

// ── 检查按钮所在区域是否已有可见的表单字段 ────────
function sectionHasVisibleFields(el) {
  // 向上找容器（fieldset/panel/card/block，最多4层）
  let container = el.parentElement;
  for (let i = 0; i < 4 && container; i++) {
    const inputs = container.querySelectorAll('input:not([type="hidden"]), textarea, select');
    for (const input of inputs) {
      if (input.offsetParent !== null && input !== el) return true;
    }
    // 找到明显容器就停
    if (container.matches('fieldset, [class*="card"], [class*="panel"], [class*="block"], [class*="section"], form')) break;
    container = container.parentElement;
  }
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ════════════════════════════════════════════════
// 表单分组扫描：按容器分组字段
// ════════════════════════════════════════════════
function findFormGroups() {
  const groups = [];
  const assignedEls = new Set();

  // 收集所有表单相关元素
  const allInputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
    'textarea, select, [contenteditable="true"]'
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

  // 未归入任何 <form> 的字段，按各类容器分组
  const containers = document.querySelectorAll(
    // 语义化容器
    'section, fieldset, ' +
    // 通用容器
    '[class*="card"], [class*="panel"], [class*="block"], ' +
    '[class*="section"], [class*="Section"], [class*="module"], ' +
    '[class*="inner"], [class*="wrapper"], [class*="container"], ' +
    // 表单布局
    '[class*="form"], [class*="Form"], ' +
    '[class*="standard-form"], [class*="formStyle"], ' +
    '[class*="form-part"], [class*="form-group"], [class*="form-row"], ' +
    '[class*="field-group"], [class*="fieldset"], ' +
    '[class*="FormSection"], [class*="InfoSection"], ' +
    // 步骤/分页/标签
    '[class*="step"], [class*="wizard-step"], ' +
    '[class*="tab-panel"], [class*="tab-content"], [class*="pane"], ' +
    // Element UI / Plus
    '.el-form-item, .el-row, .el-col, ' +
    // Ant Design
    '.ant-form-item, .ant-row, .ant-col, ' +
    // 行/列/项目布局
    '[class*="row"], [class*="col-"], [class*="grid"], ' +
    '[class*="item"], [class*="Item"], ' +
    '[class*="info-row"], [class*="info-item"], ' +
    '[class*="list-item"], [class*="field-item"], ' +
    // 表格布局
    'tr, tbody, ' +
    // 定义列表
    'dl, ' +
    // MokaHR / 招聘系统专用
    '[class*="apply-block"], [class*="apply-fields"], [class*="apply-field"], ' +
    '[class*="block-title"], [class*="blockTitle"], [class*="BlockTitle"], ' +
    '[class*="basic-block"], [class*="basic-info"], ' +
    '[class*="resume"], [class*="question"]'
  );
  containers.forEach(container => {
    // 跳过已在 form 内的容器
    if (container.closest('form')) return;
    // 跳过太小的容器（只有一个文字节点的不算）
    const fields = collectFieldsIn(container, assignedEls);
    if (fields.length >= CONFIG.minFieldCount) {
      const title = findContainerTitle(container);
      groups.push({ container, title, fields });
    }
  });

  // 剩余未归组的字段 → 按最近标题分组
  if (allInputs.length > 0) {
    const rest = [];
    const seen = new Set();
    allInputs.forEach((el, i) => {
      if (assignedEls.has(el)) return;
      if (!isVisible(el) && !el.isContentEditable && el.type !== 'hidden') return;
      el._rawIndex = i;
      rest.push(el);
    });

    if (rest.length >= CONFIG.minFieldCount) {
      // 尝试按最近h标题分组
      const headingGroups = groupByNearestHeading(rest);
      if (headingGroups.length > 0) {
        headingGroups.forEach(hg => {
          const fields = [];
          const fieldSeen = new Set();
          hg.els.forEach(el => {
            const field = buildField(el, el._rawIndex);
            const key = `${field.label}|${field.name}`;
            if (fieldSeen.has(key)) return;
            fieldSeen.add(key);
            fields.push(field);
          });
          if (fields.length >= CONFIG.minFieldCount) {
            groups.push({ container: hg.container || document.body, title: hg.title, fields });
          }
        });
      } else {
        // 最后兜底：全部归一组
        const restFields = [];
        const restSeen = new Set();
        rest.forEach(el => {
          const field = buildField(el, el._rawIndex);
          const key = `${field.label}|${field.name}`;
          if (restSeen.has(key)) return;
          restSeen.add(key);
          restFields.push(field);
        });
        if (restFields.length >= CONFIG.minFieldCount) {
          groups.push({ container: document.body, title: '表单区域', fields: restFields });
        }
      }
    }
  }

  // 扫描iframe内的表单
  const iframeFields = scanIframeFields();
  if (iframeFields.length >= CONFIG.minFieldCount) {
    groups.push({ container: document, title: '表单区域', fields: iframeFields });
  }

  LOG.debug('scan', `groups=${groups.length} fields=${groups.reduce((s,g) => s+g.fields.length, 0)}`, groups.map(g => g.title || '∞'));
  return groups;
}

// ── 按最近标题分组（兜底策略）───────
function groupByNearestHeading(els) {
  const groups = [];
  const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,strong,b');
  if (headings.length === 0) return [];

  headings.forEach(h => {
    const title = h.textContent.trim().slice(0, 40);
    if (!title) return;
    // 找这个标题后面（DOM顺序）的字段
    const container = h.closest('section, fieldset, [class*="card"], [class*="panel"], [class*="block"], [class*="section"], form') || h.parentElement;
    const containerEls = [];
    els.forEach(el => {
      if (container.contains(el)) containerEls.push(el);
    });
    if (containerEls.length >= CONFIG.minFieldCount) {
      groups.push({ title, els: containerEls, container });
    }
  });

  return groups;
}

// ── 搜索输入框过滤 ─────────────────────────────
function isSearchInput(el, label, placeholder) {
  const text = [(label || ''), (placeholder || ''), (el.title || '')].join(' ');
  return /搜索|查找|search|find/i.test(text) ||
    /search|filter/i.test((el.className?.toString?.() || '')) ||
    (el.name && /search|keyword|query|key/i.test(el.name)) ||
    (el.id && /search|keyword|query/i.test(el.id));
}

// ── 字段已填判断（对标求职方舟 isDomFilled）───
function isFieldFilled(el) {
  if (el.tagName === 'SELECT') {
    const val = el.value;
    const text = el.options[el.selectedIndex]?.textContent || '';
    return val !== '' && !/请选择|请选择|不限|无|—/i.test(text);
  }
  if (el.isContentEditable) {
    const t = el.textContent.trim();
    return t.length > 0 && !/请输入|请填写|请输/i.test(t);
  }
  if (el.type === 'checkbox' || el.type === 'radio') {
    return el.checked;
  }
  const v = el.value.trim();
  return v.length > 0
    && !/请输入|请填写|请输|无/i.test(v)
    && v !== '0'
    && v !== '0.0'
    && !/^男$/i.test(v);
}

// ── 同位置去重 ─────────────────────────────────
function dedupeSamePosition(fields) {
  // 非element模式（scanBlockFields产生的元信息对象）直接返回
  if (fields.length === 0 || !fields[0].element) return fields;
  const tolerance = 2;
  const result = [];
  for (const f of fields) {
    const rect = f.element.getBoundingClientRect();
    const dup = result.find(r => {
      const rr = r.element.getBoundingClientRect();
      return Math.abs(rect.left - rr.left) <= tolerance &&
             Math.abs(rect.top - rr.top) <= tolerance;
    });
    if (dup) {
      if (f.label.length > dup.label.length) {
        result[result.indexOf(dup)] = f;
      }
    } else {
      result.push(f);
    }
  }
  return result;
}

// ── Iframe穿透扫描 ─────────────────────────────
function scanIframeFields() {
  const allFields = [];
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;
      const fields = collectFieldsIn(doc, new Set());
      fields.forEach(f => {
        f._iframeDoc = doc;
        f._iframeIndex = allFields.length;
      });
      allFields.push(...fields);
    } catch (e) {}
  });
  return allFields;
}

// ── 收集容器内的表单字段 ────────────────────────
function collectFieldsIn(container, assignedSet) {
  const fields = [];
  const seen = new Set();
  // 普通表单元素
  const inputs = container.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
    'textarea, select'
  );

  inputs.forEach((el, i) => {
    if (assignedSet && assignedSet.has(el)) return;
    el._fieldIndex = i;
    // 跳过不可见元素（但有特殊class的除外-如Element UI的隐藏元素）
    if (!isVisible(el) && el.type !== 'hidden') return;

    // 跳转搜索输入框
    if (isSearchInput(el, findLabel(el), el.getAttribute('placeholder') || '')) return;

    const field = buildField(el, el._fieldIndex);
    const key = `${field.label}|${field.name}`;
    if (seen.has(key)) return;
    seen.add(key);

    if (assignedSet) assignedSet.add(el);
    fields.push(field);
  });

  // contentEditable 富文本字段
  const editables = container.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
  editables.forEach((el, i) => {
    if (assignedSet && assignedSet.has(el)) return;
    if (!isVisible(el)) return;
    const field = buildField(el, inputs.length + i);
    const key = field.label || `ce_${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (assignedSet) assignedSet.add(el);
    fields.push(field);
  });

  // 同位置去重
  return dedupeSamePosition(fields);
}

// ── 构造单个字段对象 ────────────────────────────
function buildField(el, index) {
  const label = findLabel(el);
  const placeholder = el.getAttribute('placeholder') || '';
  const name = el.getAttribute('name') || el.id || '';
  let type = el.tagName === 'SELECT' ? 'select' : (el.type || 'text');

  // 检测contentEditable富文本
  if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
    type = 'contenteditable';
  }
  // 检测日期类型字段
  else if (isDateField(el, label, placeholder)) {
    type = 'date';
  }

  let options = null;
  let cascaderGroup = null;
  if (el.tagName === 'SELECT') {
    options = Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
  }
  // 检测级联选择器分组
  if (type === 'select' && isCascaderCandidate(el, label)) {
    cascaderGroup = findCascaderGroup(el, index);
    if (cascaderGroup) type = 'cascader';
  }

  return {
    id: `field_${index}`,
    label, type, placeholder, name, options, cascaderGroup,
    element: el,
  };
}

// ── 查找容器的标题 ──────────────────────────────
function findContainerTitle(container) {
  // legend（fieldset专用）
  const legend = container.querySelector('legend');
  if (legend) return legend.textContent.trim().slice(0, 40);

  // h1-h6 或 class 含 title/header/caption 的元素
  const titleEl = container.querySelector(
    'h1,h2,h3,h4,h5,h6,[class*="title"],[class*="header"],[class*="caption"],' +
    '[class*="heading"],strong,b'
  );
  if (titleEl) {
    return titleEl.textContent.trim().slice(0, 40);
  }

  // data-title / aria-label
  if (container.dataset?.title) return container.dataset.title;
  if (container.getAttribute('aria-label')) return container.getAttribute('aria-label');

  // 兜底：第一个有意义的纯文本子节点
  for (const child of container.childNodes) {
    if (child.nodeType === 3) { // 文本节点
      const t = child.textContent.trim();
      if (t.length >= 2 && t.length <= 40 && !/^[\s\n\r]*$/.test(t)) return t;
    }
    if (child.nodeType === 1) { // 元素节点
      const t = child.textContent.trim();
      if (t.length >= 2 && t.length <= 40 && child.tagName !== 'DIV' && child.children.length === 0) return t;
    }
  }

  return null;
}

// ── 查找元素关联的label文本 ────────────────────
function findLabel(el) {
  // contentEditable: 用id或name
  if (el.isContentEditable) {
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, [contenteditable]').forEach(n => n.remove());
      const clean = clone.textContent.trim();
      if (clean) return clean;
    }
    let p = el.parentElement;
    for (let i = 0; i < 5 && p; i++) {
      const h = p.querySelector('h3,h4,h5,h6,strong,[class*="title"],[class*="label"],[class*="name"]');
      if (h) return h.textContent.trim().slice(0, 30);
      p = p.parentElement;
    }
    return el.getAttribute('aria-label') || el.getAttribute('data-label') || el.getAttribute('name') || '';
  }

  // 方法1：id关联的<label>
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent.trim();
  }

  // 方法2：父级<label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
    const clean = clone.textContent.trim();
    if (clean) return clean;
  }

  // 方法3：aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref) return ref.textContent.trim().slice(0, 30);
  }

  // 方法4：表格中的th对应
  const td = el.closest('td');
  if (td) {
    const tr = td.closest('tr');
    if (tr) {
      const tds = Array.from(tr.querySelectorAll('td, th'));
      const idx = tds.indexOf(td);
      const table = tr.closest('table');
      if (table && idx >= 0) {
        const thead = table.querySelector('thead, tr:first-child');
        if (thead) {
          const headerCells = thead.querySelectorAll('th, td');
          if (headerCells[idx]) return headerCells[idx].textContent.trim().slice(0, 30);
        }
      }
      if (idx > 0) {
        const prev = tds[idx - 1];
        const text = prev.textContent.trim();
        if (text.length >= 1 && text.length <= 30) return text;
      }
    }
  }

  // 方法5：MokaHR / 招聘系统专用：往上找 apply-field 里的 title
  let mokahrTitle = el.closest('[class*="apply-field"]')?.querySelector(':scope > [class*="title"], :scope > [class*="filed-title"]');
  if (mokahrTitle) {
    const t = mokahrTitle.textContent.trim();
    if (t.length >= 1 && t.length <= 30) return t;
  }

  // 方法6：往上找包含文本的相邻/父元素
  let current = el.parentElement;
  for (let i = 0; i < 5 && current; i++) {
    const prev = current.previousElementSibling;
    // 跳过明显不是标签的元素（display-value、图标容器等）
    if (prev && !/display-value|dropdown|icon|addon|shadow/i.test(prev.className || '') && prev.textContent.trim().length < 30) {
      return prev.textContent.trim();
    }
    const textNodes = Array.from(current.childNodes).filter(
      n => n.nodeType === 3 && n.textContent.trim()
    );
    if (textNodes.length > 0) {
      return textNodes[0].textContent.trim().slice(0, 30);
    }
    const siblingLabel = current.querySelector(':scope > label, :scope > span[class*="label"], :scope > div[class*="label"]');
    if (siblingLabel) {
      const t = siblingLabel.textContent.trim();
      if (t.length <= 30) return t;
    }
    current = current.parentElement;
  }

  // 方法7：placeholder兜底
  const ph = el.getAttribute('placeholder');
  if (ph && ph.length <= 30) return ph;

  // 方法8：name/id属性
  if (el.name) return el.name;
  if (el.id) return el.id;

  return '';
}

// ════════════════════════════════════════════════
// 自动填充（支持单组或全部）
// ════════════════════════════════════════════════
async function autoFillForm(groupIndex) {
  LOG.time('fill', '总耗时');
  // 先展开所有隐藏的条目区域
  await expandHiddenSections();

  // 全部填写时检测是否为多步表单 → 走 stepper
  if (groupIndex === undefined) {
    const result = detectMultistepMode();
    LOG.info('fill', `detect: reason=${result.reason} save_btns=${result.saveCount} isMultistep=${result.isMultistep}`);
    if (result.isMultistep) {
      LOG.info('fill', `→ stepper`);
      return runStepper();
    }
  }

  const groups = formGroups.length > 0 ? formGroups : findFormGroups();
  if (groups.length === 0) {
    showToast('未检测到表单区域', 'warning');
    LOG.warn('fill', 'no groups found');
    return;
  }

  LOG.info('fill', `groups=${groups.length} fields=${groups.reduce((s,g)=>s+g.fields.length,0)}`, groups.map(g => ({title:g.title||'∞',n:g.fields.length})));
  // 诊断：列出所有扫描到的字段标签
  const allLabels = [];
  groups.forEach((g, gi) => {
    g.fields.forEach(f => allLabels.push(`[${g.title || 'G'+gi}] ${f.label}(${f.type})`));
  });
  LOG.info('scan', `all ${allLabels.length} fields:`, allLabels);

  const isSingle = (groupIndex !== undefined);
  const targetGroups = isSingle ? [groups[groupIndex]] : groups;
  const allGroups = groups;
  const totalLabel = isSingle
    ? (targetGroups[0].title || `区域${groupIndex + 1}`)
    : `全部 ${groups.length} 个区域`;

  showToast(`正在匹配 ${totalLabel}...`, 'info');

  try {
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

    // 诊断：完整AI入参
    LOG.info('ai', `sending ${allFields.length} fields to AI`, allFields.map(f => `${f.id}=${f.label}`));

    if (!chrome?.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage not available - extension context lost');
    }

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
      LOG.error('ai', response.error, response.debug?.slice(0, 200));
      showToast(response.error, 'error');
      return;
    }

    const mapping = response.data;
    const aiKeys = Object.keys(mapping);
    let totalFilled = 0;
    let totalSkipped = 0;
    let totalNoEffect = 0;
    let totalNoMatch = 0;
    LOG.info('fill', `AI matches=${aiKeys.length} keys`, aiKeys);

    const prefix = isSingle ? `g${groupIndex}_` : '';
    const fillGroups = isSingle ? targetGroups : groups;

    const groupResults = [];
    fillGroups.forEach((group, gi) => {
      const gPrefix = isSingle ? prefix : `g${gi}_`;
      const resolved = [];
      for (const field of group.fields) {
        const mappedKey = `${gPrefix}${field.id}`;
        const value = mapping[mappedKey];
        if (value === undefined || value === null || value === '') {
          resolved.push({ label: field.label, key: mappedKey, status: 'no_match' });
          totalNoMatch++;
          continue;
        }
        if (isFieldFilled(field.element)) {
          resolved.push({ label: field.label, key: mappedKey, status: 'already_filled' });
          totalSkipped++;
          continue;
        }

        const el = field.element;
        const beforeVal = el.isContentEditable ? el.textContent?.trim()?.slice(0, 20) : (el.value || '').slice(0, 20);
        const filled = fillField(field, value);
        const afterVal = el.isContentEditable ? el.textContent?.trim()?.slice(0, 20) : (el.value || '').slice(0, 20);
        const stuck = afterVal && afterVal !== beforeVal && afterVal !== '';

        if (filled && stuck) {
          resolved.push({ label: field.label, key: mappedKey, status: 'filled', value: String(value).slice(0, 30) });
          totalFilled++;
        } else if (filled && !stuck) {
          resolved.push({ label: field.label, key: mappedKey, status: 'no_effect', before: beforeVal, after: afterVal });
          totalNoEffect++;
        } else {
          resolved.push({ label: field.label, key: mappedKey, status: 'fill_failed' });
        }
      }

      // 逐字段摘要
      const fieldLog = resolved.map(r => {
        const icon = { filled: '✓', already_filled: '⚡', no_match: '✗', no_effect: '⚠', fill_failed: '✗' }[r.status] || '?';
        let detail = '';
        if (r.status === 'filled') detail = `→"${r.value}"`;
        if (r.status === 'no_effect') detail = ` "${r.before}"→"${r.after}"`;
        return `${icon}${r.label}`;
      }).join(' ');
      LOG.info('fill', `G${gi} ${group.title || '∞'}: ${fieldLog}`);
      groupResults.push({ group: gi, title: group.title, fields: resolved });
    });

    LOG.timeEnd('fill', '总耗时');
    LOG.info('fill', `summary: filled=${totalFilled} skipped=${totalSkipped} no_effect=${totalNoEffect} no_match=${totalNoMatch}`);
    if (totalFilled > 0) {
      showToast(`已自动填写 ${totalFilled} 个字段`, 'success');
    } else {
      showToast('未能匹配到可填写的字段', 'warning');
    }
  } catch (err) {
    LOG.error('fill', err.message, err);
    showToast('填表失败: ' + err.message, 'error');
  }
}

// ── 填入单个字段 ───────────────────────────────
function fillField(field, value) {
  const el = field.element;
  if (!el) return false;

  // 已填字段跳过
  if (isFieldFilled(el)) return false;

  try {
    LOG.debug('fill', `${field.label || field.name}=${String(value).slice(0, 40)}`);
    if (field.type === 'select') {
      return fillSelect(el, value);
    } else if (field.type === 'checkbox' || field.type === 'radio') {
      return fillCheckable(el, value, field.type);
    } else if (field.type === 'date') {
      return fillDatePicker(el, value, field);
    } else if (field.type === 'cascader') {
      return fillCascader(el, value, field);
    } else if (field.type === 'contenteditable') {
      return fillContentEditable(el, value);
    } else {
      return fillInput(el, value);
    }
  } catch (e) {
    return false;
  }
}

// ── 填入input/textarea（参照求职方舟策略：直接赋 .value → input事件 → change事件 → 等300ms）────
function fillInput(el, value) {
  const strVal = String(value);
  const tag = el.tagName;
  const beforeVal = (el.value || '').slice(0, 30);

  // 方舟做法：直接 el.value = xxx，不用原生setter hack
  el.value = strVal;
  const afterSet = (el.value || '').slice(0, 30);

  // 销毁 _valueTracker 阻止 React 回写
  if (el._valueTracker) {
    try { el._valueTracker.setValue(null); } catch (_) {}
    delete el._valueTracker;
  }

  // 只发 input + change 事件（方舟策略，不发 focus/blur）
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const afterInput = (el.value || '').slice(0, 30);

  el.dispatchEvent(new Event('change', { bubbles: true }));
  const afterChange = (el.value || '').slice(0, 30);

  // 查找fiber并尝试触发React onChange（方舟没有这一步，但作为兜底保留）
  triggerReactOnChange(el, strVal);

  const afterAll = (el.value || '').slice(0, 30);

  LOG.info('fill', `${tag} set="${afterSet}"→in="${afterInput}"→ch="${afterChange}"→final="${afterAll}" val="${strVal.slice(0,15)}"`);

  highlightElement(el);
  return afterAll === strVal || afterAll.length > 0;
}

// ── React fiber劫持：绕过受控组件，直接触发onChange ──
function triggerReactOnChange(el, value) {
  try {
    // 找到React挂在DOM上的fiber key
    const fiberKey = Object.keys(el).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    if (!fiberKey) return;

    let fiber = el[fiberKey];
    // 沿fiber树向上查找有onChange/onInput的组件（最多15层）
    for (let i = 0; i < 15 && fiber; i++) {
      const props = fiber.memoizedProps || {};

      // 优先：直接调 _set_（如MokaHR自定义表单组件）
      if (typeof props._set_ === 'function') {
        props._set_(String(value));
        return;
      }

      if (props.onChange || props.onInput) {
        // 构造类React合成事件对象
        const fakeEvent = {
          target: el,
          currentTarget: el,
          type: 'change',
          nativeEvent: new Event('change', { bubbles: true }),
          preventDefault: () => {},
          stopPropagation: () => {},
          persist: () => {},
        };
        if (props.onChange) props.onChange(fakeEvent);
        if (props.onInput) props.onInput(fakeEvent);
        return;
      }
      fiber = fiber.return;
    }
  } catch (_) { /* fiber劫持失败不影响主流程 */ }
}

// ── 填入select下拉 ─────────────────────────────
function fillSelect(el, value) {
  // 1) 原生 select：直接用 options 匹配
  if (el.options && el.options.length > 0) {
    return fillNativeSelect(el, value);
  }

  // 2) 动态渲染（Element UI / Ant Design / 自研组件）：异步提取弹窗选项
  if (el.tagName === 'INPUT' || el.options?.length === 0) {
    // 标记为异步，先返回 true 让调度继续，实际填入在弹窗检测后执行
    fillModalSelectAsync(el, value);
    return true; // 乐观返回，弹窗填入异步完成
  }

  return false;
}

// ── 原生select选项匹配 ─────────────────────────
function fillNativeSelect(el, value) {
  const options = Array.from(el.options);
  const str = String(value).toLowerCase();

  let match = options.find(o => o.textContent.trim() === value);
  if (!match) match = options.find(o => o.textContent.toLowerCase().includes(str));
  if (!match) match = options.find(o => str.includes(o.textContent.toLowerCase().trim()));
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

// ── 动态下拉弹窗检测与填入（异步）─────────────────
async function fillModalSelectAsync(el, value) {
  try {
    // 点击打开弹窗
    el.click();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.focus();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // 等待弹窗出现并稳定
    const modal = await waitForModalDropdown(3000);
    if (!modal) return;

    // 提取选项
    const items = extractModalItems(modal);
    if (items.length === 0) return;

    // 匹配目标选项
    const matched = matchModalItem(items, value);
    if (!matched) return;

    // 点击选项
    matched.el.click();
    matched.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    matched.el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    matched.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    highlightElement(el);

    // 等待弹窗关闭
    await sleep(200);
  } catch (_) { /* 弹窗检测失败，静默降级 */ }
}

// ── 等待下拉弹窗出现并稳定 ───────────────────────
function waitForModalDropdown(timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const quickCheck = setInterval(() => {
      const modal = findOpenDropdown();
      if (modal) {
        clearInterval(quickCheck);
        // 再等一小段等渲染稳定
        setTimeout(() => resolve(modal), 150);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(quickCheck);
        resolve(null);
      }
    }, 50);
  });
}

// ── 查找当前打开的下拉弹窗 ───────────────────────
function findOpenDropdown() {
  const selectors = [
    '.el-select-dropdown:not(.is-hidden)',
    '.el-popper:not([style*="display: none"])',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
    '[class*="dropdown"]:not([style*="display: none"])',
    '[class*="select-dropdown"]:not([style*="display: none"])',
    '[role="listbox"]',
    '.van-popup--visible',
    '[class*="picker"]:not([style*="display: none"]) [class*="option"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null && el.textContent.trim().length > 0) {
      return el;
    }
  }

  // 兜底：找 body 直接子元素中最新出现的、可滚动选项列表
  const bodyChildren = Array.from(document.body.children);
  for (const child of bodyChildren.reverse()) {
    if (child.offsetParent === null) continue;
    const items = child.querySelectorAll('li, [role="option"], .option-item');
    if (items.length >= 2) return child;
  }

  return null;
}

// ── 从弹窗中提取可选项 ──────────────────────────
function extractModalItems(modal) {
  const itemEls = modal.querySelectorAll(
    'li, [role="option"], .el-select-dropdown__item, .ant-select-item, ' +
    '.option-item, .van-cell, [class*="option"]'
  );
  return Array.from(itemEls)
    .map(el => ({ el, text: el.textContent.trim() }))
    .filter(item => item.text.length > 0 && item.text.length < 80);
}

// ── 匹配选项 ────────────────────────────────────
function matchModalItem(items, value) {
  const str = String(value).toLowerCase();

  // 精确匹配
  let match = items.find(i => i.text === value);
  // 包含匹配
  if (!match) match = items.find(i => i.text.toLowerCase().includes(str));
  // 反向包含
  if (!match) match = items.find(i => str.includes(i.text.toLowerCase()));

  return match || null;
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

// ── 日期字段检测 ────────────────────────────────
function isDateField(el, label, placeholder) {
  const text = (label + ' ' + placeholder).toLowerCase();
  // 匹配日期/时间关键词
  const datePatterns = [
    '日期', '时间', '出生', '毕业', '入学', '入职', '工作',
    '年', '月', '日', 'date', 'time', 'year', 'month', 'day',
  ];
  if (datePatterns.some(p => text.includes(p))) return true;

  // 原生日期输入
  if (el.type === 'date' || el.type === 'month' || el.type === 'datetime-local') return true;

  // placeholder是 "年" "月" 且宽度窄（日期分段输入）
  const ph = (placeholder || '').trim();
  if (['年', '月', '日'].includes(ph) && el.offsetWidth < 100) return true;

  return false;
}

// ── 日期选择器填入 ─────────────────────────────
async function fillDatePicker(el, value, field) {
  const labelLower = (field.label || '').toLowerCase();
  const parsed = parseDateValue(value, labelLower);
  if (!parsed) return false;

  highlightElement(el);

  // 原生date input：直接设置
  if (el.type === 'date' || el.type === 'datetime-local') {
    el.value = parsed.format();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // 原生month input
  if (el.type === 'month') {
    el.value = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // 分段式日期输入（年/月/日各为独立input）
  if (['年', '月', '日'].includes((el.getAttribute('placeholder') || '').trim())) {
    return await fillSegmentedDate(el, parsed);
  }

  // 自定义日期选择器：点击→扫描弹窗→逐级选择
  return await fillCustomDatePicker(el, parsed);
}

// ── 解析日期值 ─────────────────────────────────
function parseDateValue(value, label) {
  const year = parseInt(value);
  // "2020-06-15" 格式
  const isoMatch = String(value).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return { year: +isoMatch[1], month: +isoMatch[2], day: +isoMatch[3], valid: true, format() { return `${this.year}-${String(this.month).padStart(2,'0')}-${String(this.day).padStart(2,'0')}`; } };
  }
  // "2020年6月" 格式
  const cnMatch = String(value).match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (cnMatch) {
    return { year: +cnMatch[1], month: +cnMatch[2], day: 1, valid: true, format() { return `${this.year}-${String(this.month).padStart(2,'0')}-${String(this.day).padStart(2,'0')}`; } };
  }
  // 纯年份（毕业年份等）
  if (!isNaN(year) && year >= 1980 && year <= 2100) {
    // 判断：如果label里有"毕业"或"年份"，填1月；否则设15号
    const day = label.includes('毕业') || label.includes('年份') ? 1 : 15;
    return { year, month: 1, day, valid: true, format() { return `${this.year}-${String(this.month).padStart(2,'0')}-${String(this.day).padStart(2,'0')}`; } };
  }
  return null;
}

// ── 分段式日期（年/月/日各为独立input）─────
async function fillSegmentedDate(el, parsed) {
  // 在这组日期input中找到对应的年/月/日位置
  const container = el.closest('[class*="date"], [class*="picker"], [class*="group"], label') || el.parentElement;
  const inputs = container.querySelectorAll('input:not([type="hidden"])');
  const placeholders = Array.from(inputs).map(inp => (inp.getAttribute('placeholder') || '').trim());

  const yearIdx = placeholders.findIndex(p => p === '年');
  const monthIdx = placeholders.findIndex(p => p === '月');
  const dayIdx = placeholders.findIndex(p => p === '日');

  if (yearIdx !== -1 && inputs[yearIdx]) {
    fillInput(inputs[yearIdx], String(parsed.year));
  }
  if (monthIdx !== -1 && inputs[monthIdx]) {
    fillInput(inputs[monthIdx], String(parsed.month));
  }
  if (dayIdx !== -1 && inputs[dayIdx] && parsed.day > 1) {
    fillInput(inputs[dayIdx], String(parsed.day));
  }
  return yearIdx !== -1 || monthIdx !== -1;
}

// ── 自定义日期选择器 ──────────────────────────
async function fillCustomDatePicker(el, parsed) {
  // 1) 点击打开日期弹窗
  el.click();
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await sleep(300);

  // 2) 找弹窗
  const modal = findDateModal();
  if (!modal) return false;

  // 3) 选择年份
  await selectDatePart(modal, 'year', parsed.year, parsed);
  // 弹窗可能刷新，重新找
  const modal2 = findDateModal() || modal;
  // 4) 选择月份
  await selectDatePart(modal2, 'month', parsed.month, parsed);
  // 5) 如果有日，选择日
  if (parsed.day > 1) {
    const modal3 = findDateModal() || modal2;
    await selectDatePart(modal3, 'day', parsed.day, parsed);
  }

  // 6) 如果弹窗还在，点外面关闭
  await sleep(200);
  const stillOpen = modal.isConnected && modal.offsetParent !== null;
  if (stillOpen) {
    document.body.click(); // 点外部关闭
  }

  return true;
}

// ── 找到日期弹窗 ─────────────────────────────
function findDateModal() {
  const selectors = [
    '.el-picker-panel', '.el-date-picker', '.el-month-picker',
    '.ant-picker-dropdown', '.ant-calendar-picker',
    '[class*="date-picker"]', '[class*="datepicker"]',
    '[class*="calendar"]', '[class*="picker-panel"]',
    '[role="dialog"]', '[role="listbox"]',
    '.dropdown-menu'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  // 兜底：body下最新出现的可见浮层
  const bodyChildren = Array.from(document.body.children);
  for (let i = bodyChildren.length - 1; i >= 0; i--) {
    const c = bodyChildren[i];
    if (c.offsetParent !== null && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' && !c.closest('header, nav')) {
      const text = c.textContent || '';
      if (/(\d{4})/.test(text) && text.length < 500) return c;
    }
  }
  return null;
}

// ── 在弹窗中选择年/月/日 ─────────────────
async function selectDatePart(modal, part, target, parsed) {
  // Element UI 风格
  const pickerSelectors = [
    '.el-year-table td', '.el-month-table td', '.el-date-table td',
    '.ant-picker-cell', '[class*="year"]', '[class*="month"]', '[class*="day"]',
  ];

  for (const sel of pickerSelectors) {
    const cells = Array.from(modal.querySelectorAll(sel));
    for (const cell of cells) {
      const text = cell.textContent.trim();
      const num = parseInt(text);

      if (part === 'year' && text === String(target)) {
        cell.click(); await sleep(150); return true;
      }
      if (part === 'month') {
        // 检查是否显示的是月份（纯数字1-12或中文数字）
        if ((num >= 1 && num <= 12 && num === target) || text.includes(String(target) + '月')) {
          cell.click(); await sleep(150); return true;
        }
      }
      if (part === 'day' && num === target) {
        cell.click(); await sleep(150); return true;
      }
    }
  }

  // select下拉式年份
  if (part === 'year' || part === 'month') {
    const selects = modal.querySelectorAll('select');
    for (const sel of selects) {
      const opts = Array.from(sel.options);
      for (const o of opts) {
        const n = parseInt(o.textContent);
        if ((part === 'year' && n === target) || (part === 'month' && n === target)) {
          sel.value = o.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(150);
          return true;
        }
      }
    }
  }

  return false;
}

// ── 级联选择器检测 ─────────────────────────────
function isCascaderCandidate(el, label) {
  const text = (label || '').trim();
  const cascaderKeywords = ['省', '市', '区', '县', '街道', '乡镇',
    '省份', '城市', '地区', '区域', '所在地', '归属',
    '职位类别', '岗位类别', '职能类别', '行业类别', '部门',
  ];
  return cascaderKeywords.some(k => text.includes(k));
}

// ── 查找级联分组（相邻的select）──────────────
function findCascaderGroup(el, index) {
  const container = el.closest('[class*="group"], [class*="row"], [class*="inline"], label') || el.parentElement;
  const siblings = Array.from(container.querySelectorAll('select'));
  if (siblings.length < 2) return null;

  // 找到el在siblings中的位置
  const pos = siblings.indexOf(el);
  const level = pos === 0 ? 0 : pos; // 0开始

  return {
    level,
    total: siblings.length,
    siblings: siblings.map((s, i) => index + i - pos), // 调整index使其连续
  };
}

// ── 级联选择器填入 ────────────────────────────
async function fillCascader(el, value, field) {
  const group = field.cascaderGroup;
  if (!group) return false;

  // 拆分value（可能是"广东省深圳市南山区"）
  const parts = splitCascaderValue(String(value));

  // 找到容器内所有关联的select
  const container = el.closest('[class*="group"], [class*="row"], [class*="inline"], label') || el.parentElement;
  const selects = Array.from(container.querySelectorAll('select'));

  let anyFilled = false;
  // 逐级填入（每级填完后下一级选项会更新）
  for (let i = 0; i < Math.min(parts.length, selects.length); i++) {
    const part = parts[i].trim();
    if (!part) continue;
    if (i >= 1) await sleep(300); // 等下级选项加载

    const sel = selects[i];
    if (fillSelect(sel, part)) {
      anyFilled = true;
    } else if (sel.options.length > 0) {
      // 模糊匹配
      const opts = Array.from(sel.options);
      const matched = opts.find(o => o.textContent.includes(part));
      if (matched) {
        sel.value = matched.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        anyFilled = true;
      }
    }
  }

  return anyFilled;
}

// ── 拆分级联值 ──────────────────────────────
function splitCascaderValue(value) {
  const s = String(value).trim();
  // "广东省/深圳市/南山区"
  if (s.includes('/')) return s.split('/');
  // "广东 深圳 南山"
  if (s.includes(' ')) return s.split(/\s+/);
  // 按省市区级拆
  const parts = [];
  const m = s.match(/(.+省|.+市|.+区|.+县)/g);
  if (m && m.length >= 2) return m;
  // 按词拆（每2-3字为单位）
  const chunks = [];
  let i = 0;
  while (i < s.length) {
    const chunk = s.slice(i, i + 3);
    chunks.push(chunk);
    i += chunk.length;
    if (i < s.length && s[i] === '市' && i < s.length - 1) i++;
  }
  return chunks.length >= 2 ? chunks : [s];
}

// ── 富文本(contentEditable)填入 ─────────────────
function fillContentEditable(el, value) {
  el.focus();
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

  // 清空后填入
  el.innerHTML = '';
  el.textContent = String(value);

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

  highlightElement(el);
  return true;
}

// ════════════════════════════════════════════════
// 多步表单调度器（方案B：预扫汇总 → 一次AI → 逐块填入）
// ════════════════════════════════════════════════

// ── 判断是否多步表单（参照求职方舟 predictFillMode）────────
function detectMultistepMode() {
  const visibleBtns = [];
  document.querySelectorAll('button, a[role="button"], [class*="btn"]').forEach(el => {
    if (!isVisible(el)) return;
    const text = el.textContent.trim();
    if (text.length <= 6) visibleBtns.push(text);
  });

  // 策略1：保存/取消类按钮 >= 3 → 多步
  const saveRe = /^(保存?|确[认認定]|提交?|下一?步|完成|继[续續])/;
  const cancelRe = /(取消|关闭|返回)/;
  const saveCancel = visibleBtns.filter(t => saveRe.test(t) || cancelRe.test(t));

  // 策略2："编辑/修改"按钮 >= 2 → 逐条编辑模式
  const editRe = /^(编辑|修改)$/;
  const editBtns = visibleBtns.filter(t => editRe.test(t));

  // 策略3：步骤导航条存在
  const stepNav = document.querySelector('[class*="step"], [class*="stepper"], [class*="wizard"], [class*="progress"]');

  // 策略4：apply-block 容器 >= 3（MokaHR等招聘系统）
  const applyBlocks = document.querySelectorAll('[class*="apply-block"]');
  const hasApplyBlocks = applyBlocks.length >= 3;

  const isMultistep = saveCancel.length >= 3 || editBtns.length >= 2 || !!stepNav || hasApplyBlocks;
  const reason = saveCancel.length >= 3 ? `save_btns(${saveCancel.length})`
    : editBtns.length >= 2 ? `edit_btns(${editBtns.length})`
    : !!stepNav ? 'step_nav'
    : hasApplyBlocks ? `apply_blocks(${applyBlocks.length})`
    : 'none';

  return { isMultistep, saveCount: saveCancel.length, reason, applyBlockCount: applyBlocks.length };
}

// ── 预扫：遍历所有带标题的区域，只收集字段元信息（不填值）────
function preScanAllBlocks() {
  const blocks = [];
  const seen = new Set();

  // 1. 优先找步骤导航中的标题（如 MokaHR 的步骤条）
  const stepNavs = document.querySelectorAll(
    '[class*="step"][class*="bar"], [class*="step"][class*="nav"], [class*="stepper"], ' +
    '[class*="wizard"], [class*="progress"][class*="step"], [class*="steps"], ' +
    '[class*="ant-steps"], [class*="el-steps"]'
  );
  const stepTitles = [];
  stepNavs.forEach(nav => {
    nav.querySelectorAll('[class*="step"],[class*="item"],[class*="tab"]').forEach(item => {
      const t = item.textContent.trim();
      if (t && t.length >= 2) stepTitles.push(t);
    });
  });

  // 2. 找所有带标题的容器
  const headings = document.querySelectorAll('h3, h4, h5, [class*="block-title"], [class*="blockTitle"], [class*="section-title"], [class*="step-title"]');
  headings.forEach(h => {
    const text = h.textContent.trim().slice(0, 40);
    if (!text) return;

    // 过滤字段标签：短文本（<=4字）且附近有input/select → 是字段标签，不是区块标题
    if (text.length <= 4) {
      const parent = h.parentElement;
      if (parent) {
        const nearbyFormEl = parent.querySelector('input, select, textarea, [contenteditable="true"]');
        if (nearbyFormEl) return; // 字段标签，跳过
      }
    }

    let container = h.closest('fieldset, [class*="card"], [class*="panel"], [class*="block"], [class*="apply-block"], [class*="section"], [class*="module"], [class*="step"], form');
    if (!container) container = h.parentElement;
    if (seen.has(container)) return;
    seen.add(container);

    const fields = scanBlockFields(container);
    if (fields.length > 0) {
      // 优先用步骤导航标题匹配
      let title = text;
      if (stepTitles.length > 0) {
        const matched = stepTitles.find(t => text.includes(t) || t.includes(text));
        if (matched) title = matched;
      }
      blocks.push({ title, fields, container });
    }
  });

  // 3. 兜底：直接找 apply-block 容器
  if (blocks.length === 0) {
    const applyBlocks = document.querySelectorAll('[class*="apply-block"]');
    applyBlocks.forEach(block => {
      if (seen.has(block)) return;
      const fields = scanBlockFields(block);
      if (fields.length >= 2) {
        seen.add(block);
        const titleEl = block.querySelector('[class*="blockTitle"], [class*="block-title"], h3, h4, h5');
        let title = titleEl ? titleEl.textContent.trim().slice(0, 40) : '表单区域';
        if (stepTitles.length > 0) {
          const matched = stepTitles.find(t => title.includes(t) || t.includes(title));
          if (matched) title = matched;
        }
        blocks.push({ title, fields, container: block });
      }
    });
  }

  // 4. 兜底：无标题时按 fieldset/panel 分组
  if (blocks.length === 0) {
    const panels = document.querySelectorAll('fieldset, [class*="panel"], [class*="card"], [class*="block"]');
    panels.forEach(p => {
      if (seen.has(p)) return;
      const fields = scanBlockFields(p);
      if (fields.length >= 2) {
        seen.add(p);
        const titleEl = p.querySelector('h3, h4, h5, [class*="title"], [class*="header"]');
        let title = titleEl ? titleEl.textContent.trim().slice(0, 40) : '表单区域';
        if (stepTitles.length > 0) {
          const matched = stepTitles.find(t => title.includes(t) || t.includes(title));
          if (matched) title = matched;
        }
        blocks.push({ title, fields, container: p });
      }
    });
  }

  return blocks;
}

// ── 扫描容器内字段元信息 ──────────────────────
function scanBlockFields(container) {
  const fields = [];
  const fieldSeen = new Set();
  let idx = 0;
  container.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]'
  ).forEach((el, i) => {
    if (!isVisible(el) && !el.isContentEditable && el.type !== 'hidden') return;
    if (isSearchInput(el, findLabel(el), el.getAttribute('placeholder') || '')) return;
    const label = findLabel(el);
    const name = el.getAttribute('name') || el.id || '';
    const key = `${label}|${name}`;
    if (fieldSeen.has(key)) return;
    fieldSeen.add(key);

    const type = el.tagName === 'SELECT' ? 'select' : (el.type || 'text');
    let options = null;
    if (el.tagName === 'SELECT' && el.options.length > 0) {
      options = Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
    }

    // 标记元素以便后续查找
    el.setAttribute('data-sml-fix', idx);

    fields.push({ label, type, placeholder: el.getAttribute('placeholder') || '', name, options, fieldIndex: idx, _el: el });
    idx++;
  });
  return dedupeSamePosition(fields);
}

// ── 方案B主流程 ────────────────────────────────
async function runStepper() {
  LOG.time('stepper', '总耗时');
  showToast('检测到多步表单，正在预扫...', 'info');
  const blocks = preScanAllBlocks();
  LOG.info('stepper', `blocks=${blocks.length} fields=${blocks.reduce((s,b)=>s+b.fields.length,0)}`, blocks.map(b => ({title:b.title,n:b.fields.length})));
  if (blocks.length === 0) {
    showToast('未能识别表单区域', 'warning');
    return;
  }

  // 一次性汇总所有区域的字段发送给AI
  showToast(`正在匹配 ${blocks.length} 个区域...`, 'info');
  const allFields = [];
  blocks.forEach((block, bi) => {
    block.fields.forEach(f => {
      allFields.push({
        id: `b${bi}_f${f.fieldIndex}`,
        label: `[${block.title}] ${f.label}`,
        type: f.type,
        placeholder: f.placeholder,
        name: f.name,
        options: f.options,
      });
    });
  });

  // 诊断：完整AI入参
  LOG.info('ai', `stepper sending ${allFields.length} fields to AI`, allFields.map(f => `${f.id}=${f.label}`));

  if (!chrome?.runtime?.sendMessage) {
    throw new Error('chrome.runtime.sendMessage not available - extension context lost');
  }

  const response = await chrome.runtime.sendMessage({
    type: 'auto_fill',
    formFields: allFields,
    groupCount: blocks.length,
    targetPrefix: null,
  });

  if (!response.success) {
    showToast(response.error, 'error');
    return;
  }

  const mapping = response.data;
  let totalFilled = 0;
  let totalSkipped = 0;
  const aiKeys = Object.keys(mapping);
  LOG.info('stepper', `AI mapping: ${aiKeys.length} keys`, aiKeys);
  LOG.debug('stepper', 'mapping_raw', JSON.stringify(mapping));

  // 逐块填入（直接使用预扫时保存的元素引用，避免重新查询DOM导致对齐错乱）
  const blockResults = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];

    const resolved = [];
    for (const f of block.fields) {
      const key = `b${bi}_f${f.fieldIndex}`;
      const val = mapping[key];
      const entry = { i: f.fieldIndex, label: f.label, type: f.type, key };

      if (val === undefined || val === null || val === '') {
        entry.status = 'no_match';
        resolved.push(entry);
        continue;
      }

      // 尝试获取元素引用：优先用保存的 _el，其次按 data-sml-fix 查找
      let el = f._el;
      if (!el || !document.contains(el)) {
        el = block.container.querySelector(`[data-sml-fix="${f.fieldIndex}"]`);
      }
      if (!el) {
        entry.status = 'el_gone';
        resolved.push(entry);
        continue;
      }

      if (isFieldFilled(el)) {
        entry.status = 'already_filled';
        entry.existing_value = el.isContentEditable ? el.textContent?.trim()?.slice(0, 30) : (el.value || '').slice(0, 30);
        totalSkipped++;
      } else {
        const fieldObj = buildField(el, f.fieldIndex);
        fieldObj.label = f.label;
        const beforeVal = el.isContentEditable ? el.textContent?.trim()?.slice(0, 20) : (el.value || '').slice(0, 20);
        const filled = fillField(fieldObj, val);

        // 写入验证：检查值是否实际生效
        const afterVal = el.isContentEditable ? el.textContent?.trim()?.slice(0, 20) : (el.value || '').slice(0, 20);
        const stuck = afterVal && afterVal !== beforeVal && afterVal !== '';

        if (filled && stuck) {
          entry.status = 'filled';
          entry.value = String(val).slice(0, 40);
          totalFilled++;
        } else if (filled && !stuck) {
          entry.status = 'fill_no_effect';
          entry.reason = `before="${beforeVal}" after="${afterVal}"`;
        } else {
          entry.status = 'fill_failed';
          entry.reason = `before="${beforeVal}"`;
        }
      }
      resolved.push(entry);
    }

    // 逐字段摘要日志
    const stats = { filled: 0, skipped: 0, no_match: 0, no_effect: 0, failed: 0, gone: 0 };
    const fieldLog = resolved.map(r => {
      stats[r.status] = (stats[r.status] || 0) + 1;
      const icon = { filled: '✓', already_filled: '⚡', no_match: '✗', fill_no_effect: '⚠', fill_failed: '✗', el_gone: '∅' }[r.status] || '?';
      let detail = '';
      if (r.status === 'filled') detail = `→"${r.value}"`;
      if (r.status === 'fill_no_effect') detail = ` ${r.reason}`;
      if (r.status === 'already_filled') detail = `("${r.existing_value}")`;
      return `${icon}${r.label || '(空)'}${detail}`;
    }).join(' | ');
    LOG.info('stepper', `B${bi} ${block.title}: ${fieldLog}`, { stats });

    blockResults.push({
      block: bi, title: block.title,
      preScan: block.fields.length,
      fields: resolved,
    });

    showToast(`[${bi + 1}/${blocks.length}] ${block.title}`, 'info');

    // 点保存/下一步（最后一块不点）
    if (bi < blocks.length - 1) {
      const saveBtn = findBlockSaveButton(block.container);
      if (saveBtn) {
        saveBtn.click();
        saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(500);
      }
    }
  }

  LOG.info('stepper', `filled=${totalFilled} skipped=${totalSkipped}`, { blocks: blockResults });
  LOG.timeEnd('stepper', '总耗时');
  showToast(
    totalFilled > 0 ? `已自动填写 ${totalFilled} 个字段` : '未能匹配到可填写的字段',
    totalFilled > 0 ? 'success' : 'warning'
  );
}

// ── 查找容器关联的保存/下一步按钮 ──────────────
function findBlockSaveButton(container) {
  const saveRe = /^(保存?|确[认認定]|提交?|下一?步|继[续續])/;
  let parent = container;
  for (let i = 0; i < 4 && parent; i++) {
    const btns = parent.querySelectorAll('button, a[role="button"]');
    for (const btn of btns) {
      const text = (btn.textContent || '').trim();
      if (text.length <= 6 && saveRe.test(text)) return btn;
    }
    parent = parent.parentElement;
  }
  return null;
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
  const groups = formGroups.length > 0 ? formGroups : findFormGroups();
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
  _scanning = true;
  const groups = findFormGroups();
  formGroups = groups;

  if (groups.length > 0) {
    createGroupButtons();
    createFloatingButton();
    updateFloatingButtonLabel();
  } else {
    removeAllButtons();
    removeFloatingButton();
  }
  _scanning = false;
}

// ════════════════════════════════════════════════
// 页面监听：持续追踪表单变化（对标方舟 observeDomChanges）
// ════════════════════════════════════════════════
let scanDebounceTimer = null;
let _scanning = false;   // 防重入：按钮注入过程不响应自身DOM变化
let _lastLightCheck = 0; // 轻量检查节流

const FORM_TAGS = ['INPUT', 'SELECT', 'TEXTAREA', 'FORM'];

function hasFormMutation(records) {
  return records.some(rec => {
    // 新增节点含表单元素
    for (const node of rec.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (FORM_TAGS.includes(node.tagName)) return true;
      if (node.querySelector) {
        const sel = FORM_TAGS.join(',') + ',[contenteditable="true"]';
        if (node.querySelector(sel)) return true;
      }
    }
    // 被移除的节点含表单元素
    for (const node of rec.removedNodes) {
      if (node.nodeType !== 1) continue;
      if (FORM_TAGS.includes(node.tagName)) return true;
      if (node.querySelector) {
        const sel = FORM_TAGS.join(',') + ',[contenteditable="true"]';
        if (node.querySelector(sel)) return true;
      }
    }
    return false;
  });
}

function fullRescan() {
  _scanning = true;
  const groups = findFormGroups();
  formGroups = groups;
  if (groups.length > 0) {
    removeAllButtons();
    removeFloatingButton();
    createGroupButtons();
    createFloatingButton();
    updateFloatingButtonLabel();
  } else {
    removeAllButtons();
    removeFloatingButton();
  }
  _scanning = false;
}

function debouncedRescan() {
  clearTimeout(scanDebounceTimer);
  scanDebounceTimer = setTimeout(fullRescan, CONFIG.scanDebounce);
}

// 监听DOM变化：有表单变更 → 重建扫描；无表单变更 → 仅刷新按钮显隐
const observer = new MutationObserver(records => {
  if (_scanning) return;  // 防自身按钮注入触发无限循环
  if (hasFormMutation(records)) {
    LOG.debug('observer', `mutation rescan`, { addedNodes: records.reduce((s,r)=>s + [...r.addedNodes].filter(n=>n.nodeType===1&&n.querySelectorAll).reduce((t,n) => t + 1 + n.querySelectorAll('input,select,textarea,[contenteditable=true]').length, 0), 0) });
    _lastLightCheck = 0;  // 释放节流，允许新一轮显隐检查
    debouncedRescan();
  } else {
    // 非表单DOM变化（SPA动画/渲染等）→ 节流：5秒内最多检查一次按钮显隐
    const now = Date.now();
    if (now - _lastLightCheck < 5000) return;
    _lastLightCheck = now;
    clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(checkAndUpdateButton, CONFIG.scanDebounce);
  }
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
