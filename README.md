# 🪵 双木林网申助手

> AI 简历自动填表利器 — 一次粘贴，全网通填

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square&logo=googlechrome" alt="Manifest V3">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License MIT">
  <img src="https://img.shields.io/badge/platform-Chrome%20%7C%20Edge-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/AI-DeepSeek%20%7C%20OpenAI%20%7C%20Claude-orange?style=flat-square" alt="AI">
</p>

---

## 📖 这是什么？

**双木林网申助手** 是一款 Chrome 浏览器扩展，专为求职网申场景设计。它将你的简历粘贴一次后，在任何招聘网站的表单上都能 **一键智能填入**，省去重复填写的痛苦。

> 投 50 家公司 = 手动填 50 次表单？不，你只需要点一下。

### 它能做什么

- 🔍 **智能表单检测** — 覆盖 `<form>`、`<section>`、卡片、弹窗、iframe 等各类容器，自动识别页面所有表单区域
- 🧠 **AI 语义匹配** — 将简历原文与表单字段智能配对，一次 API 调用完成全部匹配
- 📋 **多步表单支持** — 自动识别分步表单，预扫所有区块，逐块填入，不串数据
- 🎯 **精准填入** — 覆盖 input / textarea / select / radio / checkbox / contentEditable / 日期选择器 / 级联选择器，适配 React / Vue 框架
- 🔓 **自动展区** — 智能识别并点击"添加""展开"按钮，扫出折叠区域的隐藏字段
- 📊 **写入验证** — 填入后比对前后值，确保数据真正生效
- 🔒 **隐私优先** — 简历数据仅存本地 `chrome.storage.local`，不上传开发者服务器
- 🎨 **冰蓝极简 UI** — 清爽的视觉设计，操作流畅不打扰

---

## 🚀 快速开始

### 安装

1. 下载本仓库代码（Clone 或 Download ZIP）
2. 打开 Chrome，地址栏输入 `chrome://extensions/` 并回车
3. 打开右上角 **开发者模式** 开关
4. 点击 **加载已解压的扩展程序**
5. 选择本项目的 `ai-resume-autofill` 文件夹
6. 扩展图标出现在浏览器工具栏，安装完成 ✅

> 同样支持 Edge 浏览器：访问 `edge://extensions/` 操作一致

### 配置

1. 点击工具栏中的扩展图标，切换到 **设置** 页
2. 选择 API 格式（Anthropic / OpenAI）
3. 填入你的 API 地址和密钥：

| API 格式 | Base URL 示例 | Model 示例 |
|---------|-------------|-----------|
| Anthropic | `https://api.deepseek.com/anthropic` | `deepseek-v4-pro` |
| OpenAI | `https://api.openai.com` | `gpt-4o` |
| OpenAI | `https://dashscope.aliyuncs.com/compatible-mode` | `qwen-plus` |
| OpenAI | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-pro-32k` |

4. 点击 **测试连接** 确认配置正确

### 使用

1. 在 **简历** 页面粘贴简历原文并保存
2. 打开任意招聘网站（如 Boss 直聘、智联、前程无忧、公司官网网申）
3. 表单区域顶部自动出现 `Auto-fill` 按钮，右下角出现悬浮按钮
4. 点击按钮 → AI 匹配 → 字段自动填入 ✨

---

## 🧩 技术架构

```
ai-resume-autofill/
├── manifest.json           # 扩展配置（Manifest V3）
├── background.js           # Service Worker — API 调用 & 简历管理
├── content/
│   ├── content.js          # 网页注入脚本 — 表单检测 & 自动填充
│   └── content.css         # 注入样式
├── popup/
│   ├── popup.html          # 弹窗页面
│   ├── popup.css           # 弹窗样式（冰蓝极简）
│   └── popup.js            # 弹窗逻辑
├── icons/                  # 图标 & 打赏二维码
└── privacy-policy.html     # 隐私政策
```

### 核心能力

| 场景 | 策略 |
|------|------|
| 单页表单 | 扫描→分组→AI匹配→逐组填入 |
| 多步表单 | 预扫所有区块→一次AI调用→逐块填入 |
| 折叠区域 | 智能识别"添加/展开"按钮并自动点击 |
| iframe 表单 | 递归穿透扫描 |
| React 受控组件 | 原生 setter + 事件派发 + fiber 劫持兜底 |
| 自定义下拉 | 弹出下拉→匹配选项→点击选中 |
| 日期选择器 | 原生 date / 年月分段式 / 自定义弹窗 |
| 级联选择器 | 逐级展开并点选 |
| contentEditable | 直接写入 textContent |

### 调试

在目标页面 URL 后添加 `?__log=4` 参数可开启详细日志（级别 0=静默 1=错误 2=警告 3=信息 4=调试），在浏览器控制台查看 `[时间戳][模块] ` 格式的结构化输出。

---

## ⚙️ API 兼容性

扩展同时兼容 **Anthropic** 和 **OpenAI** 两种 API 格式，覆盖主流 AI 服务商：

| 服务商 | API 格式 | 参考 Model |
|-------|---------|-----------|
| DeepSeek | Anthropic / OpenAI | `deepseek-v4-pro` / `deepseek-chat` |
| OpenAI | OpenAI | `gpt-4o`, `gpt-4o-mini` |
| Claude | Anthropic | `claude-3-5-sonnet-20241022` |
| 通义千问 | OpenAI | `qwen-plus`, `qwen-max` |
| 豆包 | OpenAI | `doubao-pro-32k` |
| Moonshot | OpenAI | `moonshot-v1-8k` |

> 💡 支持智能端点拼接：即使 Base URL 只填域名，扩展会自动补全 `/v1/chat/completions` 或 `/messages`

---

## 🔒 隐私说明

- **简历数据**：仅存储在浏览器本地 `chrome.storage.local` 中，不传输至任何中间服务器
- **API 通信**：表单匹配时，表单字段信息与简历内容通过 HTTPS 直连用户自行配置的 AI 服务商
- **无追踪**：不包含任何分析统计、广告 SDK 或第三方埋点
- **可清除**：随时可通过弹窗界面删除已保存的简历和 API 密钥

完整隐私政策：[privacy-policy.html](./privacy-policy.html)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

- 🐛 发现问题？[提交 Issue](../../issues)
- 💡 有改进建议？[发起讨论](../../discussions)
- 🔧 想贡献代码？Fork → 修改 → Pull Request

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/L3n3L/ai-resume-autofill.git
cd ai-resume-autofill

# 在 Chrome 中加载
# chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择本项目文件夹

# 修改代码后，点击扩展卡片的刷新按钮即可热更新
```

---

## 📄 许可证

本项目采用 [MIT License](./LICENSE) 开源。

> ⚠️ 禁止未经授权的商业化二次分发。详情见 LICENSE 文件。

---

## ☕ 支持开发者

如果这个项目帮到了你，欢迎请作者喝杯咖啡~

<p align="center">
  <img src="./icons/wx.jpg" width="180" alt="微信打赏">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./icons/zfb.jpg" width="180" alt="支付宝打赏">
</p>

---

## 📬 联系方式

- **作者**：双木林
- **邮箱**：[1321727938@qq.com](mailto:1321727938@qq.com)
- **项目主页**：[GitHub](https://github.com/L3n3L/ai-resume-autofill)

---

<p align="center">
  <sub>Made with ❤️ by 双木林</sub>
</p>
