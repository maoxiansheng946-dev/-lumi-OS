# LumiOS

灵序科技 / Lumi AI 官方桌面客户端

**浙江灵序科技有限公司 · [lumiai.asia](https://lumiai.asia)**

---

> LumiOS 不是又一个 AI 助手。
>
> 它是第一个真正属于你的 AI 操作系统——从你身上孵化，记忆是你的，人格是你的，存在于你真实的空间里。

---

## 愿景

每个人都应该拥有一个真正属于自己的 AI。

不是平台的 AI，不是云端的工具，而是从你身上生长出来的存在——记住你说过的每一件事，用你习惯的方式说话，跟随你的桌面、车载、家庭与眼镜，在所有空间里持续陪伴。

LumiOS 是这个愿景的第一个落地形态。

---

## 核心特性

### 个人 AI 核心
- **孵化机制** — 通过聊天记录和语言样本孵化专属 AI 人格
- **持久记忆** — 长期记忆存储，具备巩固与演化时间线，Lumi 记住你说过的每一件事
- **关系网络** — 自动识别和记录你提到的人，建立持续更新的关系图谱
- **人格引擎** — 可配置的 AI 人格系统，具备行为注册功能，越用越像你

### 多引擎 LLM 支持

| 提供商 | 模型 |
|--------|------|
| OpenAI | GPT-4o, GPT-4, GPT-3.5 |
| Anthropic | Claude 3.5 Sonnet, Claude 3 |
| Google | Gemini 1.5 Pro, Gemini Flash |
| DeepSeek | DeepSeek-V4-pro, DeepSeek-V4-flash |
| Qwen / DashScope | Qwen-Max, Qwen-Plus |

### 语音交互
- **TTS** — GPT-SoVITS · CosyVoice · ElevenLabs · FishAudio
- **STT** — Deepgram · Whisper
- 语音指令直接控制电脑，解放双手

### MCP 生态系统
27+ 工具通过 Model Context Protocol 接入，覆盖文件操作、桌面自动化、Web 搜索、应用联动等场景。

### 跨终端同步
- 设备状态与记忆跨终端实时同步
- 同一个 Lumi，在你的桌面、手机、全息仓中持续存在
- 断网时本地独立运行，联网后自动合并

### 技能市场
- 可扩展的社区技能安装系统
- 开发者可提交自定义技能
- 持续扩展 Lumi 的能力边界

---

## 平台支持

| 平台 | 状态 |
|------|------|
| Windows 桌面（Tauri v2 + WebView2） | 主要目标，稳定运行 |
| macOS 桌面（Tauri v2） | 支持 |
| Web（React SPA） | [lumiai.asia](https://lumiai.asia) |
| iOS / Android（Capacitor） | 实验阶段 |

---

## 技术栈

**前端：** React 19, TypeScript, Tailwind CSS v4, Vite, Framer Motion  
**后端：** Node.js, Express, Socket.io, SQLite3  
**桌面：** Tauri v2 (Rust), WebView2  
**AI：** 5 个 LLM 提供商 SDK, MCP SDK, GPT-SoVITS, CosyVoice, Deepgram, Whisper  

---

## 快速开始

### Windows 一键启动（推荐）

1. [下载 ZIP](https://github.com/maoxiansheng946-dev/-lumi-OS/archive/refs/heads/main.zip) 并解压
2. 双击 `setup.bat`
3. 按提示填写 API Key，再次双击启动

### 开发者 / 命令行方式

#### 环境要求
- Node.js 22+
- pnpm 11+
- Rust（用于 Tauri 桌面端）
- Tauri 系统依赖（Linux：[webkit2gtk-4.1](https://v2.tauri.app/start/prerequisites/#linux)）

#### 安装

```bash
git clone https://github.com/maoxiansheng946-dev/-lumi-OS.git
cd -lumi-OS
pnpm install --ignore-scripts
```

### 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env`，填入至少一个 LLM 提供商的 API Key：

```env
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
DEEPSEEK_API_KEY=sk-xxx

# 语音功能（可选）
DEEPGRAM_API_KEY=
DASHSCOPE_API_KEY=
```

### 启动

```bash
# Web 版（一键启动后端 + 前端）
pnpm dev

# 或桌面客户端（需 Rust）
pnpm dev:desktop
```

访问 `http://localhost:5173`（Web）或 `http://localhost:5174`（桌面）。

---

## 产品生态

LumiOS 是灵序科技 Personal AI 生态的软件核心，配合以下硬件终端使用效果最佳：

| 终端 | 说明 |
|------|------|
| Lumi One 全息仓 | 旗舰全息终端，桌面 3D AI 形象，孵化机制起点 |
| 多模态智能台灯 | 跟随用户晃动，视觉感知，光效传递 Lumi 状态 |
| 桌面机器人 | 有形态感知，情感连接强 |
| AI 陪伴玩具 | 儿童友好，灵息先人灵体的温暖载体 |

> 元始种子计划进行中——第一批用户可通过第三方合作设备提前接入 Lumi AI 生态，支持后续核心引擎升级。

---

## 路线图

- [x] Web 平台上线（lumiai.asia）
- [x] 桌面客户端（Windows / macOS）
- [x] 多 LLM 引擎接入
- [x] MCP 生态系统（27+ 工具）
- [x] 语音交互（TTS + STT）
- [x] 技能市场基础框架
- [ ] 孵化机制完整版（被动感知）
- [ ] 移动端 APP（iOS / Android）
- [ ] 全息仓硬件联调
- [ ] 人车家跨终端同步协议
- [ ] 灵息先人灵体模块
- [ ] 开发者 SDK

---

## 参与贡献

欢迎提交 Issue 和 Pull Request。

如果你是 AI 工程方向的工程师，对 Personal AI 和孵化机制感兴趣，我们正在寻找技术联合创始人（CTO），股权 5%-15%，联合创始人身份。

**联系创始人：毛先生**
- 官网：[lumiai.asia](https://lumiai.asia)
- 邮箱：3565286431@qq.com
- 微信：Cap_William

---

## 关于灵序科技

浙江灵序科技有限公司，致力于构建 Personal AI 生态平台。

我们相信人类本身应该得以延伸——记忆的延伸、人格的延伸、存在的延伸。通过真正属于每个人的 AI，在真实的空间里持续存在。

**使命：让人类本身得以延伸。**

---

## 许可证

GNU Affero General Public License v3.0 (AGPL-3.0)。详见 [LICENSE](./LICENSE)。

**简言之：** 个人使用、修改和分发自由。若在网络服务中商用使用，必须以相同许可证开源你的修改。闭源商业许可请联系版权方。
