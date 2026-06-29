import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '').split(/\r?\n|[;；]/).map(s => s.trim()).filter(Boolean);
}

const server = new McpServer({ name: 'content-ops', version: '1.0.0' }, { capabilities: { tools: {} } });

server.registerTool('content_topic_pipeline', {
  description: 'Turn raw ideas into a content topic pipeline with angles, formats, hooks, and production notes.',
  inputSchema: {
    rawIdeas: z.string().describe('Ideas, product notes, audience questions, or competitor inspiration'),
    audience: z.string().optional().describe('Target audience'),
    goal: z.string().optional().describe('Content goal such as awareness, conversion, trust, retention'),
    platform: z.string().optional().describe('Platform such as Douyin, Xiaohongshu, TikTok, YouTube, WeChat'),
  },
}, async (args: any) => {
  const ideas = list(args.rawIdeas);
  return ok({
    platform: args.platform || 'TBD',
    audience: args.audience || 'TBD',
    goal: args.goal || 'TBD',
    topics: ideas.slice(0, 12).map((idea, index) => ({
      id: index + 1,
      topic: idea,
      angle: /price|贵|cost|省钱/i.test(idea) ? 'cost/value angle' : /how|怎么|教程|guide/i.test(idea) ? 'how-to angle' : 'story/problem angle',
      suggestedFormat: index % 3 === 0 ? 'short video' : index % 3 === 1 ? 'carousel/post' : 'live/script segment',
      hook: `If you care about ${args.audience || 'this topic'}, here is the key thing most people miss.`,
    })),
    productionNotes: ['Collect proof/materials', 'Check platform policy and claims', 'Prepare cover/title variants', 'Define CTA and comment prompt'],
  });
});

server.registerTool('short_video_script', {
  description: 'Create a short-video script with hook, scene beats, voiceover, caption ideas, and CTA.',
  inputSchema: {
    topic: z.string().describe('Video topic, product, or story'),
    platform: z.string().optional().describe('Target platform'),
    durationSeconds: z.number().optional().describe('Target duration in seconds'),
    style: z.enum(['educational', 'story', 'sales', 'review']).optional().describe('Script style'),
  },
}, async (args: any) => {
  const duration = Math.max(15, Math.min(180, Number(args.durationSeconds || 45)));
  return ok({
    topic: args.topic,
    platform: args.platform || 'short video',
    durationSeconds: duration,
    structure: [
      { second: '0-3', beat: 'Hook', voiceover: `Most people misunderstand ${args.topic}.` },
      { second: '3-15', beat: 'Problem/context', voiceover: 'Show the real situation and why it matters.' },
      { second: `15-${Math.max(25, duration - 10)}`, beat: 'Core value', voiceover: 'Give 2-3 concrete points with proof or demo.' },
      { second: `${Math.max(25, duration - 10)}-${duration}`, beat: 'CTA', voiceover: 'Ask viewers to comment, save, message, or check the next step.' },
    ],
    captions: [`${args.topic}: 3 things to check`, `Before you decide, watch this`, `Save this checklist`],
    shotList: ['Face-to-camera hook', 'Detail close-up or screen recording', 'Before/after or proof', 'CTA end frame'],
  });
});

server.registerTool('account_performance_review', {
  description: 'Review account metrics and produce growth signals, weak links, hypotheses, and next experiments.',
  inputSchema: {
    metricsText: z.string().describe('Account metrics, post data, or campaign performance notes'),
    period: z.string().optional().describe('Review period'),
  },
}, async (args: any) => {
  const rows = list(args.metricsText);
  return ok({
    period: args.period || 'TBD',
    notableRows: rows.slice(0, 20),
    likelyWeakLinks: ['Hook/cover if impressions are low', 'Retention if views drop early', 'CTA/offer if engagement is high but conversion low', 'Topic fit if saves/comments are weak'],
    experimentBacklog: ['Test 3 cover/title variants', 'Repeat top topic with new angle', 'Make one proof-heavy post', 'Turn comments into Q&A content'],
    reviewQuestions: ['Which topic brought saves?', 'Which hook got completion?', 'Which CTA generated messages?', 'Which audience segment responded?'],
  });
});

server.registerTool('comment_insight_report', {
  description: 'Analyze comment or review text into themes, objections, content ideas, and response frames.',
  inputSchema: {
    commentsText: z.string().describe('Comments, reviews, DMs, or community feedback'),
  },
}, async (args: any) => {
  const comments = list(args.commentsText);
  return ok({
    themes: {
      price: comments.filter(c => /price|cost|expensive|贵|价格/i.test(c)).length,
      trust: comments.filter(c => /real|fake|trust|靠谱吗|真假|信任/i.test(c)).length,
      howTo: comments.filter(c => /how|怎么|教程|where|哪里/i.test(c)).length,
      complaint: comments.filter(c => /bad|refund|complaint|差|退|投诉/i.test(c)).length,
    },
    representativeComments: comments.slice(0, 8),
    contentIdeas: ['Answer the most repeated question', 'Make objection-handling post', 'Show proof/process', 'Create comparison/checklist'],
    responseFrame: 'Acknowledge first, answer concretely, avoid arguing, invite evidence/order details if support is needed.',
  });
});

server.registerTool('content_calendar_builder', {
  description: 'Create a weekly or monthly content calendar from themes, cadence, channels, and goals.',
  inputSchema: {
    themes: z.union([z.string(), z.array(z.string())]).describe('Themes or content pillars'),
    cadence: z.string().optional().describe('Posting cadence'),
    channels: z.union([z.string(), z.array(z.string())]).optional().describe('Channels/platforms'),
  },
}, async (args: any) => {
  const themes = list(args.themes);
  const channels = list(args.channels || 'primary channel');
  return ok({
    cadence: args.cadence || '3-5 posts/week',
    contentPillars: themes,
    calendar: themes.slice(0, 7).map((theme, index) => ({
      day: index + 1,
      channel: channels[index % channels.length] || 'primary channel',
      theme,
      format: index % 2 === 0 ? 'short video' : 'post/carousel',
      productionTask: 'Draft hook, gather material, edit, schedule, prepare comment response',
    })),
    operatingChecklist: ['Batch script writing', 'Batch shooting/material capture', 'Daily comment review', 'Weekly metric review'],
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
