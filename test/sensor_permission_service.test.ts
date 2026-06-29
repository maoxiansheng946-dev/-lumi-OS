import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSensorEnabled,
  requestMicrophoneStream,
  setSensorEnabled,
} from '@/services/sensorPermissionService';

class TestCustomEvent<T = unknown> {
  type: string;
  detail?: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    this.type = type;
    this.detail = init?.detail;
  }
}

function installBrowserGlobals(getUserMedia = vi.fn()) {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
  };

  vi.stubGlobal('CustomEvent', TestCustomEvent);
  vi.stubGlobal('window', {
    localStorage,
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia },
    permissions: {
      query: vi.fn().mockResolvedValue({ state: 'granted' }),
    },
  });

  return { getUserMedia, localStorage };
}

function createFakeStream() {
  const track = {
    readyState: 'live',
    stop: vi.fn(() => { track.readyState = 'ended'; }),
    addEventListener: vi.fn(),
  };
  return {
    track,
    stream: {
      getTracks: vi.fn(() => [track]),
    },
  };
}

describe('sensor permission access toggles', () => {
  beforeEach(() => {
    installBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('blocks microphone capture when the Lumi mic switch is disabled', async () => {
    const getUserMedia = vi.fn();
    installBrowserGlobals(getUserMedia);

    setSensorEnabled('microphone', false);

    await expect(requestMicrophoneStream(true)).rejects.toThrow('Microphone is disabled in Lumi settings.');
    expect(isSensorEnabled('microphone')).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('stops active microphone streams when the Lumi mic switch is turned off', async () => {
    const fake = createFakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(fake.stream);
    installBrowserGlobals(getUserMedia);

    setSensorEnabled('microphone', true);
    await requestMicrophoneStream(true);
    setSensorEnabled('microphone', false);

    expect(fake.track.stop).toHaveBeenCalledTimes(1);
  });
});
