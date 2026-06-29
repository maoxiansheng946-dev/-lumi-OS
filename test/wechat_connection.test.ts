import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeChatClawBotAdapter } from '../server/messaging/wechat-clawbot';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('WeChat ClawBot connection stability', () => {
  it('deduplicates concurrent polling starts and aborts an active long-poll on stop', async () => {
    let getConfigCalls = 0;
    let getUpdatesCalls = 0;
    let aborted = false;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/ilink/bot/getconfig')) {
        getConfigCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { text: async () => '{}' } as Response;
      }
      if (url.includes('/ilink/bot/getupdates')) {
        getUpdatesCalls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
      }
      return { json: async () => ({ ok: true }) } as Response;
    }) as any;

    const adapter = new WeChatClawBotAdapter({
      botToken: 'token',
      botId: 'bot@im.bot',
      baseUrl: 'https://example.test',
      enabled: true,
    });

    await Promise.all([
      adapter.startPolling(async () => null),
      adapter.startPolling(async () => null),
    ]);

    expect(adapter.isPolling()).toBe(true);
    expect(getConfigCalls).toBe(1);

    await vi.waitFor(() => expect(getUpdatesCalls).toBe(1));
    adapter.stopPolling();

    expect(adapter.isPolling()).toBe(false);
    await vi.waitFor(() => expect(aborted).toBe(true));
  });
});
