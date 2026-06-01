// Generate LumiOS product PDF — uses Edge headless print-to-PDF with Chinese support
import { execSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 0; }
  body { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif; margin: 0; padding: 0; color: #1a1a1f; }
  .page { width: 210mm; min-height: 297mm; box-sizing: border-box; padding: 28mm 24mm 20mm; position: relative; page-break-after: always; }
  .header-line { position: absolute; top: 20mm; left: 24mm; right: 24mm; height: 2px; background: #2563eb; }
  .footer { position: absolute; bottom: 14mm; left: 24mm; right: 24mm; font-size: 8px; color: #9ca3af; border-top: 0.5px solid #d1d5db; padding-top: 4px; display: flex; justify-content: space-between; }

  h1 { font-size: 26px; font-weight: 900; margin: 0 0 4px; }
  .h1-line { width: 60px; height: 3px; background: #2563eb; margin-bottom: 22px; }
  h2 { font-size: 15px; font-weight: 800; color: #2563eb; margin: 26px 0 10px; }
  .tagline { font-size: 14px; color: #2563eb; font-style: italic; margin: 0 0 4px; }

  p { font-size: 10.5px; line-height: 1.7; color: #4b5563; margin: 0 0 10px; }

  table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 10px; }
  th { background: #eff3fb; padding: 8px 10px; text-align: left; font-weight: 700; font-size: 10px; color: #1e293b; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; color: #4b5563; }
  tr:nth-child(even) td { background: #fafbfd; }

  .bullet { margin: 6px 0 14px; padding: 0; list-style: none; }
  .bullet li { font-size: 10.5px; line-height: 1.7; color: #4b5563; padding-left: 14px; position: relative; margin-bottom: 6px; }
  .bullet li::before { content: "•"; position: absolute; left: 0; color: #2563eb; font-weight: bold; }

  .cover { display: flex; flex-direction: column; justify-content: center; }
  .cover h1 { font-size: 48px; }
  .cover .sub { font-size: 20px; color: #2563eb; margin-bottom: 8px; }
  .cover .line { width: 100px; height: 3px; background: #2563eb; margin-bottom: 28px; }

  .note { font-size: 9.5px; color: #9ca3af; margin: 8px 0; }

  .highlight-box { background: #f8fafd; border-left: 3px solid #2563eb; padding: 10px 14px; margin: 12px 0; border-radius: 0 8px 8px 0; }
  .highlight-box p { margin: 0; }

  .usage-grid { display: flex; gap: 14px; flex-wrap: wrap; margin: 10px 0 14px; }
  .usage-card { flex: 1; min-width: 44%; background: #f8fafd; border-radius: 10px; padding: 14px; box-sizing: border-box; }
  .usage-card .icon { font-size: 20px; margin-bottom: 6px; }
  .usage-card .title { font-size: 11px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
  .usage-card .desc { font-size: 9.5px; color: #6b7280; line-height: 1.6; }
</style>
</head>
<body>

<!-- Page 1: Cover -->
<div class="page cover">
  <div class="header-line"></div>
  <div style="margin-top: 40mm;">
    <h1>LumiOS</h1>
    <div class="sub">个人版 · 部署与服务方案</div>
    <div class="line"></div>
    <p class="tagline">不是聊天机器人，不是 SaaS 订阅。</p>
    <p class="tagline">本地运行，记住你，持续演化。</p>
  </div>
  <div style="margin-top: 24mm;">
    <p>浙江灵序科技有限公司</p>
    <p>2026年6月 · v2.8 · lumiai.asia</p>
  </div>
  <div class="footer"><span>LumiOS v2.8</span><span>p.1</span></div>
</div>

<!-- Page 2: Positioning + Features -->
<div class="page">
  <div class="header-line"></div>
  <h1>产品定位</h1>
  <div class="h1-line"></div>

  <h2>LumiOS 是什么</h2>
  <p>LumiOS 是一个本地运行的、会记住你、会跟着你进化的私有 AI 人格。不是聊天机器人，不是 SaaS 订阅。它属于你——连同你的数据、你的记忆、你的 AI 人格一起。</p>

  <h2>与 ChatGPT / Kimi 的区别</h2>
  <table>
    <tr><th></th><th>ChatGPT / Kimi</th><th>LumiOS</th></tr>
    <tr><td style="font-weight:700;">数据归属</td><td>平台</td><td>你</td></tr>
    <tr><td style="font-weight:700;">运行位置</td><td>云端</td><td>你的电脑</td></tr>
    <tr><td style="font-weight:700;">记忆</td><td>上下文窗口</td><td>永久，三级分层</td></tr>
    <tr><td style="font-weight:700;">人格</td><td>通用，无个性</td><td>从对话中孵化，持续演化</td></tr>
    <tr><td style="font-weight:700;">断网可用</td><td>不可用</td><td>可用</td></tr>
    <tr><td style="font-weight:700;">语音交互</td><td>基础</td><td>全双工，自由打断</td></tr>
    <tr><td style="font-weight:700;">付费方式</td><td>月租</td><td>一次部署，终身拥有</td></tr>
  </table>
  <p>LumiOS 解决的不是"怎么对话"，而是"AI 为什么不是我的"。</p>

  <h2>核心功能</h2>
  <table>
    <tr><th>功能</th><th>说明</th></tr>
    <tr><td>AI 人格孵化</td><td>从对话中提取习惯、偏好、价值观。用得越久越像你</td></tr>
    <tr><td>三级记忆</td><td>情节记忆 → 语义记忆 → 程序记忆。自动衰减，自动提升</td></tr>
    <tr><td>全双工语音</td><td>"Hey Lumi" 唤醒，随时打断，25 种音色，可克隆自己的声音</td></tr>
    <tr><td>混合推理</td><td>本地 7B 小模型 + 云端大模型，自动切换，感受不到</td></tr>
    <tr><td>MCP 技能生态</td><td>27+ 内置工具，社区持续贡献，GitHub 一键导入</td></tr>
    <tr><td>7 天人格演化</td><td>Lumi 自己写成长日记，性格语气思维逐渐向你靠拢</td></tr>
  </table>

  <div class="footer"><span>LumiOS v2.8</span><span>p.2</span></div>
</div>

<!-- Page 3: Feature Usage + Personas -->
<div class="page">
  <div class="header-line"></div>
  <h1>使用场景</h1>
  <div class="h1-line"></div>

  <div class="usage-grid">
    <div class="usage-card">
      <div class="icon">💬</div>
      <div class="title">语音对话</div>
      <div class="desc">喊一声"Hey Lumi"，说完一句话它马上回应。打断它、追问它、让它重复——跟真人聊天一样。飞机上没网也能聊。</div>
    </div>
    <div class="usage-card">
      <div class="icon">📁</div>
      <div class="title">桌面自动化</div>
      <div class="desc">"帮我把桌面上所有 PDF 合并成一个文件"——Lumi 直接操作你的电脑，打开文件、处理、保存。不用你动手。</div>
    </div>
    <div class="usage-card">
      <div class="icon">📄</div>
      <div class="title">文档处理</div>
      <div class="desc">扔一份合同进去，说"帮我审一下违约条款有没有坑"。上传 PDF/Word/Excel，Lumi 阅读、分析、总结、翻译。</div>
    </div>
    <div class="usage-card">
      <div class="icon">🔍</div>
      <div class="title">知识管理</div>
      <div class="desc">Ctrl+K 打开 Spotlight，搜你写过的任何东西。Lumi 记住你三个月前说过的话、五个月前存的文档。</div>
    </div>
    <div class="usage-card">
      <div class="icon">🧠</div>
      <div class="title">人格成长</div>
      <div class="desc">用了一周后，Lumi 知道你喜欢简洁的回答。用了三个月后，它知道你的工作习惯、项目进度、和谁在合作。</div>
    </div>
    <div class="usage-card">
      <div class="icon">🛠️</div>
      <div class="title">MCP 技能</div>
      <div class="desc">查天气、生成二维码、发邮件、跑代码、翻译——这些 Lumi 都有内置工具。社区还在持续贡献新技能。</div>
    </div>
  </div>

  <h2>适合谁</h2>

  <div class="usage-grid">
    <div class="usage-card">
      <div class="icon">🎨</div>
      <div class="title">技术创作者</div>
      <div class="desc">独立开发者、设计师、视频创作者。每天跟工具打交道，内容生产是刚需，隐私是底线。Lumi 能接管重复劳动——审代码、改文案、出脚本、理素材——让你只做创作本身。</div>
    </div>
    <div class="usage-card">
      <div class="icon">⚖️</div>
      <div class="title">知识工作者</div>
      <div class="desc">律师、咨询师、研究者、医生。文档处理量大，知识管理是核心能力。合同审阅、文献总结、案例检索——这些 Lumi 都能做，而且数据不出你的电脑，客户隐私有保障。</div>
    </div>
    <div class="usage-card">
      <div class="icon">🚀</div>
      <div class="title">创业者 / 一人公司</div>
      <div class="desc">一个人需要 AI 替代半个团队。写方案、回邮件、做报表、理客户——Lumi 帮你扛起运营、行政、助理三份工作，你专注做决策和增长。</div>
    </div>
    <div class="usage-card">
      <div class="icon">🔐</div>
      <div class="title">AI 深度用户</div>
      <div class="desc">受够了云端 API 的隐私风险和订阅费。想要一个完全私有、真正懂自己的 AI。Lumi 给你永久记忆、人格演化、离线可用——这是任何 SaaS 都给不了的。</div>
    </div>
  </div>

  <div class="footer"><span>LumiOS v2.8</span><span>p.3</span></div>
</div>

<!-- Page 4: Hardware -->
<div class="page">
  <div class="header-line"></div>
  <h1>硬件方案</h1>
  <div class="h1-line"></div>

  <p>16GB 显存是推荐起点。低于此值只能跑 Q4 量化小模型，上下文长度受限。以下为已验证配置，均为整机预算（含 CPU、内存、存储）：</p>

  <h2>NVIDIA 方案</h2>
  <table>
    <tr><th>档位</th><th>推荐配置</th><th>本地模型</th><th>参考预算</th></tr>
    <tr><td>基础版</td><td>RTX 4060 Ti 16GB / 5070 12GB</td><td>Qwen2.5-7B / 14B (Q4)</td><td>¥8,000–12,000</td></tr>
    <tr><td colspan="4" style="font-size:8.5px; color:#6b7280; padding-top:2px;">入门选择。7B 模型日常对话流畅，14B 需 Q4 量化。适合轻度使用、预算有限的用户。</td></tr>
    <tr><td>标准版</td><td>RTX 4080 16GB / 4070 Ti Super 16GB</td><td>Qwen2.5-14B</td><td>¥15,000–22,000</td></tr>
    <tr><td colspan="4" style="font-size:8.5px; color:#6b7280; padding-top:2px;">推荐主力。14B 满血运行，推理质量明显提升。适合每天重度使用、需要长上下文对话的用户。</td></tr>
    <tr><td>高配版</td><td>RTX 4090 24GB</td><td>Qwen2.5-32B (Q4)</td><td>¥28,000–40,000</td></tr>
    <tr><td colspan="4" style="font-size:8.5px; color:#6b7280; padding-top:2px;">专业级。32B 参数带来质的飞跃——复杂推理、深度分析、长文档理解都远超小模型。适合知识工作者和专业创作者。</td></tr>
    <tr><td>顶配版</td><td>RTX 6000 Ada 48GB / 双卡</td><td>Qwen2.5-32B (Q8) / 72B</td><td>¥55,000 起</td></tr>
    <tr><td colspan="4" style="font-size:8.5px; color:#6b7280; padding-top:2px;">无妥协选择。Q8 量化精度无损，72B 模型接近云端旗舰体验。双卡方案可同时跑推理和训练。适合极致追求者。</td></tr>
  </table>

  <h2>Mac 方案</h2>
  <table>
    <tr><th>档位</th><th>推荐配置</th><th>本地模型</th><th>参考预算</th></tr>
    <tr><td>基础版</td><td>Mac mini M4 16GB</td><td>Qwen2.5-7B</td><td>¥4,799</td></tr>
    <tr><td>标准版</td><td>Mac Studio M2 Max 32GB</td><td>Qwen2.5-14B</td><td>¥16,499</td></tr>
    <tr><td>高配版</td><td>Mac Studio M2 Ultra 64GB</td><td>Qwen2.5-32B</td><td>¥38,999</td></tr>
  </table>
  <p>Mac 使用统一内存架构，无需独立显卡。16GB 统一内存可流畅运行 7B 模型。32B 模型需 Ultra 64GB 及以上。</p>

  <div class="highlight-box">
    <p>已有设备可直接使用。如需新购硬件，我们提供配置建议和采购渠道，不加价。</p>
  </div>

  <div class="footer"><span>LumiOS v2.8</span><span>p.4</span></div>
</div>

<!-- Page 5: Services -->
<div class="page">
  <div class="header-line"></div>
  <h1>服务与定价</h1>
  <div class="h1-line"></div>

  <h2>部署 & 维护</h2>
  <table>
    <tr><th>服务</th><th>内容</th><th>价格</th></tr>
    <tr><td>标准部署（远程）</td><td>安装 + 本地模型配置 + 语音全链路调试 + API 配置 + 1.5h 培训</td><td>¥8,000</td></tr>
    <tr><td>标准部署（上门）</td><td>同上 + 现场调试 + 环境优化</td><td>¥12,000</td></tr>
    <tr><td>标准维护</td><td>版本更新 + 远程故障排查 + 模型升级 + 每季度健康检查</td><td>¥6,000/年</td></tr>
    <tr><td>尊享维护</td><td>标准维护 + 每年 2 次上门 + 新功能优先体验 + 4h 紧急响应</td><td>¥18,000/年</td></tr>
  </table>
  <p class="note">年度维护三年起签，合同期内所有版本免费升级。售后微信直接联系。标准维护每季度健康检查，尊享维护 4h 紧急到场。</p>

  <h2>支付 & 合规</h2>
  <ul class="bullet">
    <li>先付后装，收定金锁定排期，定金不退。支持对公转账 / 个人转账</li>
    <li>合同合规：禁止二次开发、禁止违法使用。数据归属用户，我们不承担数据丢失责任</li>
  </ul>

  <h2>定制开发</h2>
  <p>客户要的功能 = Lumi 产品路线图。不接私单，不做独立分支。需求评估通过后直接开发进主仓库——付费客户推动 Lumi 进化，所有用户受益。定制需求单独报价，按工时评估，有明确交付周期。</p>

  <h2>价值</h2>
  <table>
    <tr><td>ChatGPT Plus</td><td>¥1,700/年 × 3 年 = ¥5,100。数据全在 OpenAI，你只有使用权</td></tr>
    <tr><td>LumiOS</td><td>部署 ¥8,000（一次性）+ 维护 ¥6,000/年（三年起签）。你拥有它，它记得你</td></tr>
    <tr><td>你的数据</td><td>永远在你自己的电脑上，断网也能用</td></tr>
  </table>

  <div class="footer"><span>LumiOS v2.8</span><span>p.5</span></div>
</div>

</body>
</html>`;

// Write HTML to tmp, use Edge to print PDF
const tmpDir = tmpdir();
const htmlPath = path.join(tmpDir, 'lumios_product.html');
const pdfPath = path.join(__dirname, '..', 'LumiOS_个人版_部署服务方案.pdf');

writeFileSync(htmlPath, html, 'utf-8');
console.log(`HTML written: ${htmlPath}`);

const cmd = `powershell -Command "Start-Process -FilePath 'msedge' -ArgumentList '--headless=new','--disable-gpu','--no-pdf-header-footer','--print-to-pdf=${pdfPath}','${htmlPath}' -Wait -WindowStyle Hidden"`;
console.log('Printing PDF via Edge...');
execSync(cmd, { stdio: 'inherit', timeout: 30000 });

rmSync(htmlPath);
console.log(`Generated: ${pdfPath}`);
