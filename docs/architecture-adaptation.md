# 双木林网申助手 — 核心模块适配方案

> 基于对求职方舟AI（v1.x）源码的逆向分析，梳理可移植模块及框架适配方案。
> 本文档面向开发者，描述"做什么 + 怎么改 + 改哪里"，不含实现细节。

***

## 目录

1. [现状架构速览](#1-现状架构速览)
2. [模块一：添加按钮自动点击](#2-模块一添加按钮自动点击)
3. [模块二：下拉弹窗检测与选项提取](#3-模块二下拉弹窗检测与选项提取)
4. [模块三：Shadow DOM UI 隔离](#4-模块三shadow-dom-ui-隔离)
5. [模块四：日期选择器自动化](#5-模块四日期选择器自动化)
6. [模块五：多步表单逐块填写](#6-模块五多步表单逐块填写)
7. [模块六：事件模拟增强](#7-模块六事件模拟增强)
8. [模块七：平台适配器注册表](#8-模块七平台适配器注册表)
9. [改造优先级与路线图](#9-改造优先级与路线图)

***

## 1. 现状架构速览

```
manifest.json
├── background.js          # Service Worker：简历 CRUD + AI API 调用
├── popup/
│   ├── popup.html         # 弹窗 UI（简历管理 / API 配置）
│   ├── popup.js           # 弹窗逻辑
│   └── popup.css
└── content/
    ├── content.css
    └── content.js         # 注入脚本：表单扫描 → AI 匹配 → 自动填入
```

### content.js 核心流程

```
页面加载 / DOM变化(MutationObserver, 500ms防抖)
  → findFormGroups()           扫描表单字段，按容器分组
    → collectFieldsIn()        收集容器内 input/select/textarea
    → buildField()             构造字段对象 {id, label, type, options, element}
  → checkAndUpdateButton()     决定是否显示填写按钮
    → createGroupButtons()     每个表单区域注入按钮
    → createFloatingButton()   右下角悬浮按钮

用户点击按钮
  → autoFillForm(groupIndex)
    → 收集所有分组字段 → 构造 prompt
    → chrome.runtime.sendMessage({type:'auto_fill', formFields, ...})
    → background.js: callAI() → extractJSON()
    → 按分组前缀分配 mapping → fillField()
      → fillInput()   原生 setter + input/change 事件
      → fillSelect()  option 文本匹配
      → fillCheckable()  label 包含匹配
    → highlightElement()  绿色边框高亮
```

### 当前架构的优势

- **零依赖**：纯 vanilla JS，无打包工具、无框架
- **单文件注入**：content.js 一个文件搞定所有逻辑
- **通信简单**：content ↔ background 只有 1 种消息类型（`auto_fill`）
- **防抖扫描**：MutationObserver + 500ms debounce，避免过度计算

### 当前架构的瓶颈

| 瓶颈        | 表现                        | 根因                                           |
| --------- | ------------------------- | -------------------------------------------- |
| 隐藏区域未展开   | 折叠的 panel/block 字段漏扫      | `findFormGroups` 只处理可见 DOM                   |
| 下拉弹窗无法匹配  | select 选项在点击后才动态渲染        | option 列表为空，AI 不知道该选什么                       |
| 日期选择器无法填入 | 日期以弹窗/模态形式操作              | `fillInput` 只设 value，不操作弹窗                   |
| 多步表单无法跨页  | 填写完一个区域要保存后才有下一个          | 没有"当前区域填完→自动下一步"流程                           |
| CSS 污染    | 注入的按钮/Toast 被页面样式覆盖       | 直接挂载到 `document.body`                        |
| 事件模拟不完整   | 部分 React/Element UI 组件不响应 | 只派发 `input` + `change`，缺少 focus/blur/down/up |

***

## 2. 模块一：添加按钮自动点击

### 问题

招聘网站大量使用"添加"按钮来展开隐藏表单区域（如教育经历、工作经历、项目经验），当前 `findFormGroups` 只能扫描页面上已存在的可见 DOM，导致大量字段漏扫。

### 求职方舟的做法

```
fixBlockAddButton()
  1. 扫描页面所有 button/a/span（带 click 事件的元素）
  2. 正则匹配文本：^(继续)?(添加|增加|新增)
  3. 正则匹配 class：add|plus|add-btn|btn-add
  4. 依次点击每个候选按钮
  5. MutationObserver 捕获新出现的 DOM
  6. 标记已点击的按钮（防止重复点击）
```

### 适配方案

**改动位置**：`content.js` 的 `findFormGroups()` 调用之前

**新增文件**：无需，直接在 `content.js` 中新增一个函数

**伪代码流程**：

```
findFormGroups()
  → expandHiddenSections()        ← 🆕 新步骤
    1. querySelectorAll("button, a, span[role='button'], div[role='button']")
    2. 过滤：文本匹配 /类名匹配
    3. 去重（已点过的跳过）
    4. 依次 click()，每次等待 300ms
    5. 记录已展开区域
  → 继续原有扫描流程
```

**配置常量**：

```js
const EXPAND_CONFIG = {
  buttonPatterns: [/^(继续)?(添加|增加|新增|编辑|修改|展开)/],
  classPatterns: [/add|plus|expand|btn-add|btn-plus|el-icon-circle-plus/],
  clickDelay: 300,          // 每次点击后等待
  maxClicks: 10,            // 最多点击10个按钮（防止无限循环）
  expandedSet: new Set(),   // 已点击按钮 set（内容哈希去重）
};
```

**改动量**：约 60 行，一个函数

**性能影响**：最多增加 10 × 300ms = 3s 扫描延迟（仅在首次检测到表单时触发）

***

## 3. 模块二：下拉弹窗检测与选项提取

### 问题

现代 UI 框架（Element UI、Ant Design、公司自研组件）的 select 下拉框，`<option>` 子元素在首次打开前不存在。当前 `buildField` 读取 `el.options` 时拿到空数组，AI 无法做出有效选择。

### 求职方舟的做法

```
点击 input/select → 下拉弹窗出现
  → _checkModalItemsStable(弹窗根节点)
    1. MutationObserver 监听弹窗子节点变化
    2. 等待 loading/spinner 元素消失（检测 class 含 loading/spin/skeleton）
    3. 连续 2 次（间隔 200ms）检测到子节点列表不变 → 判定稳定
  → getModalItems(弹窗根节点)
    1. querySelectorAll("li, [role='option'], .option-item, .el-select-dropdown__item")
    2. 提取 textContent，过滤空值
  → 发送选项列表给后端，AI 决策选哪个
  → 程序化点击对应选项
```

### 适配方案

**改动位置**：`content.js`，在 `fillField()` 的 select 分支中新增逻辑

**改造** **`fillSelect`** **函数**：

```
fillSelect(el, value)
  → 如果 el.options.length > 0（原生 select）
      → 走现有逻辑（文本匹配）
  → 否则（动态渲染的 select，即 Element UI / Ant Design）
      → await openModalDropdown(el)              ← 🆕
      → await waitForModalStable()               ← 🆕
      → items = extractModalItems()              ← 🆕
      → 将 items 加入字段信息，重新请求 AI 匹配    ← 🆕 或本地模糊匹配
      → clickModalItem(targetIndex)              ← 🆕
      → await waitForModalClosed()               ← 🆕
```

**新增函数**：

| 函数                                 | 职责                      |  行数  |
| ---------------------------------- | ----------------------- | :--: |
| `openModalDropdown(el)`            | 触发点击 + focus 打开下拉       | \~10 |
| `waitForModalStable(timeout=3000)` | MutationObserver 等待弹窗稳定 | \~30 |
| `extractModalItems(modalRoot)`     | 提取所有可选项文本               | \~15 |
| `clickModalItem(text)`             | 在弹窗中点击匹配的选项             | \~15 |
| `waitForModalClosed(timeout=2000)` | 轮询检查弹窗是否消失              | \~20 |

**改动量**：约 100 行，5 个函数

**与现有流程的集成点**：`fillField()` → `fillSelect()` 的分支判断

**容错**：弹窗检测失败时，回退到直接设置 `el.value` 的方式

***

## 4. 模块三：Shadow DOM UI 隔离

### 问题

注入到页面的 Toast、按钮、选择器弹窗会被目标网站的 CSS 污染（字体、颜色、布局错乱），同时插件样式也可能意外影响网站。

### 求职方舟的做法

```js
const container = document.createElement('div');
container.id = 'ark-ai';
const shadow = container.attachShadow({ mode: 'open' });
document.body.appendChild(container);
// 所有 UI 组件（悬浮按钮、简历窗口、评分弹窗）渲染在 shadow 内
// 通过 <link> 标签在 shadow 内加载自己的 CSS
```

### 适配方案

**改动位置**：`content.js` 中所有 DOM 创建函数

**核心改造**：

```
ShadowHost = attachShadow({mode:'open'}) → 所有 UI 组件挂载到此

原有：
  document.body.appendChild(toast)          → ShadowHost.appendChild(toast)
  document.body.appendChild(btn)            → ShadowHost.appendChild(btn)
  document.body.appendChild(overlay)        → ShadowHost.appendChild(overlay)

新增：
  ShadowHost 内加载 content.css
```

**具体变更**：

| 原函数                      | 变更                                     |
| ------------------------ | -------------------------------------- |
| `showToast()`            | 挂载到 ShadowHost                         |
| `createFloatingButton()` | 挂载到 ShadowHost                         |
| `createGroupButtons()`   | 挂载目标保持不变（按钮需要挂在表单容器内），但样式用 `:host` 作用域 |
| `showGroupSelector()`    | overlay 挂载到 ShadowHost                 |

**注意**：`createGroupButtons()` 的按钮是注入到表单 `container` 内部的（不在 ShadowDOM 里），需要特殊处理。方案：按钮自身通过 `all: initial` 样式重置 + 内联样式隔离。

**改动量**：约 30 行（ShadowHost 初始化 + 挂载点切换）

***

## 5. 模块四：日期选择器自动化

### 问题

日期字段在招聘网站普遍使用日期选择器弹窗，直接设置 `input.value` 往往无效或格式不匹配。

### 求职方舟的做法

```
_checkDomIsDateModal(弹窗节点)
  检测规则：
  - 包含 12 个月份文本（1月-12月 / Jan-Dec）
  - 包含 2020-2029 年份文本
  - 包含 28-31 个日期数字

_chooseDateModal(弹窗节点, 目标日期)
  1. 识别弹窗模式：Y-M 联动 / M-Y 联动 / 单面板
  2. 按年份 → 月份 → 日期的顺序点击
  3. 年份选择：点击年份触发年份面板 → 点击目标年份（如果超出当前页则点左右箭头翻页）
  4. 月份选择：点击目标月份
  5. 日期选择：< 15 号从前半部分找，≥ 15 号从后半部分找
  6. 如果是范围选择器，开始日期和结束日期分别点击
```

### 适配方案

**改动位置**：`content.js`，在 `fillInput()` 的日期处理分支

**改造** **`fillInput`** **函数**：

```
fillInput(el, value)
  → 如果 el.type === 'date' || el.type === 'month' || label 包含"日期/时间"
      → 先尝试直接设置 value（HTML5 date input）
      → 如果 value 没变（说明是自定义日期选择器）
          → await openDatePicker(el)               ← 🆕
          → dateModal = await detectDateModal()    ← 🆕
          → 如果检测成功
              → await chooseDate(dateModal, value) ← 🆕
              → return true
          → 否则 fallback 到直接设置 value
  → 否则走原有逻辑
```

**新增函数**：

| 函数                                  | 职责                                    |
| ----------------------------------- | ------------------------------------- |
| `detectDateModal()`                 | 点击 input 后，MutationObserver 检测弹出的日期面板 |
| `isDatePickerPanel(el)`             | 判断一个 DOM 节点是否是日期选择面板                  |
| `chooseDateInPanel(panel, dateStr)` | 在面板中选择指定日期                            |

**改动量**：约 150 行

**复杂度**：高。不同组件库的日期选择器 DOM 结构差异大，需要覆盖：

- Element UI DatePicker
- Ant Design DatePicker
- 原生 `<input type="date">`
- jQuery UI Datepicker
- 公司自研组件

建议分阶段：先支持 Element UI（覆盖最多），再逐步扩展。

***

## 6. 模块五：多步表单逐块填写

### 问题

网申系统常把简历拆成多步（基本信息 → 教育经历 → 工作经历 → 项目经验 → ……），每步填完要点"保存"或"下一步"才能进入下一个 block。当前插件把整个页面当一个大表单处理，无法处理跨步骤的字段。

### 求职方舟的做法

```
predictFillMode()
  判断逻辑：
  - "保存" 按钮 ≥ 5 个 → multistep 模式
  - "编辑/修改" 按钮 ≥ 2 个 → multistep 模式
  - 否则 → normal 模式（当前插件的处理方式）

multistep 流程：
  1. findAllBlocks()
     - 按 heading(h3/h4) + form/fieldset/card 分组
     - 每个 block 包含：标题 + 字段列表 + 操作按钮池
  2. 逐块迭代：
     findCurrentBlockDom()
       → 定位当前 block 的 DOM
       → 如果有"编辑"按钮 → 先点编辑打开弹窗
       → 如果 block 字段全部已填满 → 跳过
     fillCurrentBlock(fields, mapping)
       → 逐个填入字段
       → 检查是否需要展开子区域（调用模块一的添加按钮逻辑）
     submitBlock()
       → 点击"保存"按钮
       → waitForBlockUpdate()
         - 检测 DOM 是否重绘（旧 block 节点被移除）
         - 检测是否有新的 block 出现
         - 检测 loading 状态消失
  3. 全部 block 处理完 → done
```

### 适配方案

**改动位置**：`content.js`，在 `autoFillForm()` 中新增分支

**架构影响**：这是改动最大的模块，需要在当前扫描 → 填写 的线性流程上叠加一个"多步骤状态机"。

**新增状态机**：

```
States:
  SCANNING      → 扫描页面，判定模式
  FILLING       → 逐块填写当前 block
  WAITING_SAVE  → 等待保存完成 / 弹窗关闭
  ADVANCING     → 等待下一 block 出现
  DONE          → 所有 block 处理完毕

Transitions:
  SCANNING → FILLING       （检测到多步表单）
  SCANNING → DONE          （单步表单，走原有流程）
  FILLING  → WAITING_SAVE  （当前 block 填写完毕）
  WAITING_SAVE → ADVANCING （保存成功/弹窗关闭）
  WAITING_SAVE → FILLING   （保存后 block 仍在，继续填剩余字段）
  ADVANCING → FILLING      （下一 block 出现）
  ADVANCING → DONE         （无更多 block / 超时）
```

**新增文件**：建议新增 `content/stepper.js`（约 200 行），因为状态机逻辑独立且较复杂，不宜直接塞进 content.js。

**改动量**：content.js 中约 30 行（模式检测 + 路由），stepper.js 约 200 行

***

## 7. 模块六：事件模拟增强

### 问题

当前 `fillInput` 只派发 `input` + `change` 事件，部分 React 组件（特别是受控组件 + 自定义校验）需要更完整的事件序列才能正确响应。

### 求职方舟的做法

```js
// 完整的事件序列（clickDom）
function clickDom(el) {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.focus();
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

// SVG 遮挡处理
// 如果点击目标被 SVG 元素遮挡：
//   → 从 el 向上遍历，找到第一个非 SVG、有 click 事件的祖先元素
//   → 对该祖先执行事件序列
```

### 适配方案

**改动位置**：`content.js` 的 `fillInput()` 函数

**改造**：

```
fillInput(el, value)
  → 原生 setter 设置值（保持不变）
  → 事件序列升级：
      el.focus()                                    ← 🆕
      el.dispatchEvent(new FocusEvent('focus'))      ← 🆕
      el.dispatchEvent(new Event('input', ...))      ← 保留
      el.dispatchEvent(new Event('change', ...))     ← 保留
      el.dispatchEvent(new FocusEvent('blur'))        ← 🆕
```

**改动量**：约 10 行

**无副作用**：只是多派发了几个事件，兼容所有现有逻辑。

***

## 8. 模块七：平台适配器注册表

### 问题

不同招聘网站的 DOM 结构差异巨大（智联/51job/国聘/应届生网），通用选择器无法准确识别所有字段。

### 求职方舟的做法

```js
const PLATFORM_ADAPTERS = {
  'zhaopin.com': {
    blockSelector: '.resume-block, .standard-form',
    buttonSelector: 'button:contains("保存"), .btn-save',
    fieldExtractor: (container) => { /* 智联专用提取逻辑 */ },
    ...
  },
  '51job.com': { ... },
  'iguopin.com': { ... },
};
```

### 适配方案

**新增文件**：`content/adapters.js`

**注册表结构**：

```js
const ADAPTERS = {
  // key 为 hostname 匹配模式
  'zhaopin.com': {
    name: '智联招聘',
    // 覆盖默认选择器
    formSelectors: ['.resume-block', '.standard-form'],
    addButtonSelectors: ['.btn-add', 'a:contains("添加")'],
    saveButtonSelectors: ['button:contains("保存")'],
    // 自定义字段收集
    customFieldCollector: (container) => { ... },
    // 自定义填入
    customFiller: (el, value) => { ... },
  },
  // ...
};
```

**集成点**：`findFormGroups()` / `expandHiddenSections()` 读取当前 hostname → 查找匹配的 adapter → 合并配置。

**改动量**：adapters.js 约 100 行（框架 + 首批 3-4 个平台），content.js 约 20 行（adapter 查找 + 合并）

***

## 9. 改造优先级与路线图

```
                    高价值
                      │
      模块一 ─────────┤         模块五
    (添加按钮)        │       (多步表单)
                      │
        模块六  模块二│
     (事件模拟)(下拉弹窗)
                      │
   ──────────────────┼───────────────────
                      │
      模块三          │          模块四
   (Shadow DOM)      │       (日期选择器)
                      │
      模块七          │
   (平台适配)         │
                      │
                    低价值
                    
      低复杂度 ←──────────────────→ 高复杂度
```

### Phase 1：快速见效（1-2 天）

|  顺序 | 模块                 |  价值 | 改动量 | 说明                       |
| :-: | ------------------ | :-: | :-: | ------------------------ |
|  1  | **模块六·事件模拟增强**     |  中  | 10行 | 一行的改动，立竿见影改善 React 组件兼容性 |
|  2  | **模块一·添加按钮点击**     |  高  | 60行 | 解决最常见痛点——字段漏扫            |
|  3  | **模块三·Shadow DOM** |  中  | 30行 | CSS 污染问题一劳永逸             |

**Phase 1 总改动量**：约 100 行，不影响现有逻辑。

### Phase 2：核心能力（3-5 天）

|  顺序 | 模块            |  价值 |  改动量 | 说明                        |
| :-: | ------------- | :-: | :--: | ------------------------- |
|  4  | **模块二·下拉弹窗**  |  高  | 100行 | 动态渲染的 select，AI 匹配准确率大幅提升 |
|  5  | **模块七·平台适配器** |  中  | 120行 | 首批适配智联/51job/国聘           |

**Phase 2 总改动量**：约 220 行。

### Phase 3：深度能力（5-7 天）

|  顺序 | 模块            |  价值 |  改动量 | 说明                   |
| :-: | ------------- | :-: | :--: | -------------------- |
|  6  | **模块五·多步表单**  |  高  | 230行 | 需新增 stepper.js + 状态机 |
|  7  | **模块四·日期选择器** |  中  | 150行 | 需覆盖多种组件库             |

**Phase 3 总改动量**：约 380 行。

***

## 10. 用户体验变化

> 每个模块上线后，用户实际能感知到的变化。

### Phase 1 上线后

#### 模块六：事件模拟增强

| 场景              | 改造前                         | 改造后                        |
| --------------- | --------------------------- | -------------------------- |
| Element UI 表单填入 | 值写进去了，但"下一步"按钮仍置灰（框架没感知到变化） | 焦点离开后 React/Vue 组件正常解除校验锁定 |
| 带实时校验的输入框       | 填入后红色校验提示不消失                | blur 事件触发校验通过，红框消失         |
| 受控组件回显          | 填入值后组件内部 state 没更新，点保存提交了空值 | 完整事件序列触发 state 同步          |

**一句话**：之前"填了像没填"的问题大幅减少。

#### 模块一：添加按钮自动点击

| 场景               | 改造前               | 改造后                             |
| ---------------- | ----------------- | ------------------------------- |
| 教育经历（折叠态）        | 一个字段都扫不到          | 自动展开 → 扫出学校/专业/学历/时间 4 个字段 → 填入 |
| 工作经历（有多段）        | 只看到"添加工作经历"按钮，无字段 | 点击添加 → 展开空白表单 → 填入              |
| 项目经验、证书、语言能力     | 全部漏扫，需手动填         | 自动展开后填入                         |
| 弹窗式表单（点击"编辑"才出现） | 完全无法处理            | 自动点编辑 → 弹窗出现 → 填入 → 保存          |

**一句话**：以前只能填页面上"看得见"的 40% 字段，现在能填 80%+。

#### 模块三：Shadow DOM UI 隔离

| 场景            | 改造前                   | 改造后                 |
| ------------- | --------------------- | ------------------- |
| 部分网站（如字体强制覆盖） | Toast 字体变成宋体、按钮变成蓝色方块 | 插件 UI 在任何网站上都保持一致外观 |
| 网站暗色模式        | 插件按钮看不清               | 插件 UI 独立于网站主题       |
| 网站 CSS 污染插件   | 按钮被隐藏、位置错乱            | 完全隔离，不受影响           |

**一句话**：插件 UI 在任何网站上都长一个样。

### Phase 2 上线后

#### 模块二：下拉弹窗检测

| 场景                   | 改造前                         | 改造后                                                |
| -------------------- | --------------------------- | -------------------------------------------------- |
| 学历选择（Element UI）     | options 为空 → AI 随便猜 → 填错或不填 | 自动打开下拉 → 提取\["博士","硕士","本科","大专"...] → AI 精确选中"本科" |
| 城市/省份联动选择            | 省份选对了，城市 100% 选错            | 先打开省份下拉选省份 → 等待城市下拉刷新 → 再选城市                       |
| 行业/职能分类              | 几百个选项，AI 盲猜命中率 ≈ 0          | 提取完整选项列表 → AI 精确匹配 → 命中率 90%+                      |
| 公司自研下拉（无 option 子元素） | 完全无法处理                      | 自动展开 → 提取选项 → 填入                                   |

**一句话**：下拉选择从"基本靠猜"变成"精确匹配"。

#### 模块七：平台适配

| 场景    | 改造前                  | 改造后                    |
| ----- | -------------------- | ---------------------- |
| 智联招聘  | 字段识别率 \~50%，容器分组混乱   | 专用选择器 → 识别率 \~90%，分组正确 |
| 51job | 一个简历页拆成 8 个区域，按钮位置不对 | 专用适配 → 每个区域标题正确，按钮位置准确 |
| 国聘    | 表单字段命名不规范，label 找不到  | 专用提取逻辑 → 字段名正确识别       |
| 应届生网  | 完全未知                 | 专用适配后正常工作              |

**一句话**：主流平台从"勉强能用"变成"开箱即用"。

### Phase 3 上线后

#### 模块五：多步表单逐块填写

| 场景           | 改造前       | 改造后                              |
| ------------ | --------- | -------------------------------- |
| 网申分 5 步      | 只能填第一步    | 自动逐块填入 → 自动保存 → 自动进入下一步 → 5 步全填完 |
| 每步 8-15 个字段  | 手动填 10 分钟 | 30 秒自动完成                         |
| 某 block 已经填过 | 不区分，重复填入  | 自动检测已填 → 跳过 → 只填空白 block         |
| 最后一步提交       | 不敢点，怕填错   | 用户检查后手动点提交（保留最终控制权）              |

**一句话**：从"帮你填第一页"升级为"帮你填整个流程"。

#### 模块四：日期选择器自动化

| 场景            | 改造前                  | 改造后                 |
| ------------- | -------------------- | ------------------- |
| 出生日期          | 直接设 value → 组件不认 → 空 | 自动打开日期弹窗 → 逐级选年/月/日 |
| 入学/毕业时间       | 同上                   | 同上                  |
| 实习起止时间（范围选择器） | 同上，且需选两次             | 自动选开始日期 → 再选结束日期    |
| 证书获得日期        | 同上                   | 同上                  |

**一句话**：日期字段从"100% 要手动补"变成"自动填好"。

***

### 总体体验对比

| 指标             |  改造前（当前版本） |  Phase 1  |      Phase 2      | Phase 3（完整版） |
| -------------- | :--------: | :-------: | :---------------: | :----------: |
| **单页表单字段覆盖率**  |    \~40%   |   \~70%   |       \~85%       |     \~90%    |
| **多步表单支持**     |    仅第一步    |    第一步    |        第一步        |   **全部步骤**   |
| **下拉选择准确率**    |  \~30%（盲猜） |   \~30%   |     **\~90%**     |     \~90%    |
| **日期字段成功率**    |    \~10%   |   \~10%   |       \~10%       |   **\~85%**  |
| **平台兼容性**      |   通用（凑合用）  |     通用    | **3-4 个主流平台专项优化** |     持续扩展     |
| **UI 一致性**     | 被网站 CSS 污染 | **全网站一致** |       全网站一致       |     全网站一致    |
| **平均填完一个网申耗时** | 手动补 60% 字段 |  手动补 30%  |      手动补 15%      |  **手动补 10%** |

***

### 全部模块完成后文件结构

```
ai-resume-autofill/
├── manifest.json
├── background.js              # Service Worker（基本不变）
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── content/
    ├── content.css
    ├── content.js             # 主控流程 + UI 组件 + 原有逻辑
    ├── stepper.js             # 🆕 多步表单状态机（Phase 3）
    ├── adapters.js            # 🆕 平台适配器注册表（Phase 2）
    ├── modal-detector.js      # 🆕 下拉弹窗检测（Phase 2）
    └── date-picker.js         # 🆕 日期选择器自动化（Phase 3）
```

**核心原则**：

- 所有新增模块通过函数引入，不改变 content.js 的入口流程
- 每个模块独立、可禁用、有 fallback
- 失败不阻塞主流程，始终降级到原有行为
- 保持零依赖、单文件注入的轻量特征

