export type SensorKind = 'microphone' | 'camera';
export type SensorPermissionState = PermissionState | 'unknown' | 'unavailable';
export type DesktopAutomationState = 'available' | 'unavailable' | 'unknown';

export interface SensorPermissionSnapshot {
  microphone: SensorPermissionState;
  camera: SensorPermissionState;
  notifications: SensorPermissionState;
  desktopAutomation?: DesktopAutomationState;
  wakeWordEnabled?: boolean;
  sensorPrimerSeen?: boolean;
  biometricsPrimerSeen?: boolean;
  updatedAt: number;
}

interface SnapshotOptions {
  desktopAutomation?: DesktopAutomationState;
  wakeWordEnabled?: boolean;
  sensorPrimerSeen?: boolean;
  biometricsPrimerSeen?: boolean;
}

export const SENSOR_PERMISSIONS_CHANGED = 'lumi:sensor-permissions-changed';
export const SENSOR_ACCESS_CHANGED = 'lumi:sensor-access-changed';

const SENSOR_ENABLED_KEYS: Record<SensorKind, string> = {
  microphone: 'lumi_mic_enabled',
  camera: 'lumi_camera_enabled',
};

const activeStreams: Record<SensorKind, Set<MediaStream>> = {
  microphone: new Set(),
  camera: new Set(),
};

function hasNavigator() {
  return typeof navigator !== 'undefined';
}

function hasWindow() {
  return typeof window !== 'undefined';
}

function readSensorEnabled(kind: SensorKind) {
  if (!hasWindow()) return true;
  try {
    return window.localStorage.getItem(SENSOR_ENABLED_KEYS[kind]) !== 'false';
  } catch {
    return true;
  }
}

function stopActiveStreams(kind: SensorKind) {
  for (const stream of activeStreams[kind]) {
    stream.getTracks().forEach(track => track.stop());
  }
  activeStreams[kind].clear();
}

function trackActiveStream(kind: SensorKind, stream: MediaStream) {
  activeStreams[kind].add(stream);
  const removeWhenEnded = () => {
    if (stream.getTracks().every(track => track.readyState === 'ended')) {
      activeStreams[kind].delete(stream);
    }
  };
  stream.getTracks().forEach(track => {
    track.addEventListener('ended', removeWhenEnded);
  });
}

export function isSensorEnabled(kind: SensorKind): boolean {
  return readSensorEnabled(kind);
}

export function setSensorEnabled(kind: SensorKind, enabled: boolean) {
  if (hasWindow()) {
    try {
      window.localStorage.setItem(SENSOR_ENABLED_KEYS[kind], String(enabled));
    } catch {}
  }

  if (!enabled) stopActiveStreams(kind);
  broadcastSensorAccessChange({ [kind]: enabled });
}

export function broadcastSensorAccessChange(detail?: Partial<Record<SensorKind, boolean>>) {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(SENSOR_ACCESS_CHANGED, {
    detail: {
      ...detail,
      updatedAt: Date.now(),
    },
  }));
}

function getFallbackPermissionState(name: SensorKind | 'notifications'): SensorPermissionState {
  if (!hasNavigator()) return 'unavailable';
  if ((name === 'microphone' || name === 'camera') && !navigator.mediaDevices?.getUserMedia) return 'unavailable';
  return 'unknown';
}

export async function queryPermission(name: SensorKind | 'notifications'): Promise<SensorPermissionState> {
  if (!hasNavigator()) return 'unavailable';
  if ((name === 'microphone' || name === 'camera') && !navigator.mediaDevices?.getUserMedia) {
    return 'unavailable';
  }

  try {
    if (!navigator.permissions?.query) return getFallbackPermissionState(name);
    const status = await navigator.permissions.query({ name } as PermissionDescriptor);
    return status.state || 'unknown';
  } catch {
    return getFallbackPermissionState(name);
  }
}

export async function getSensorPermissionSnapshot(options: SnapshotOptions = {}): Promise<SensorPermissionSnapshot> {
  const [microphone, camera, notifications] = await Promise.all([
    queryPermission('microphone'),
    queryPermission('camera'),
    queryPermission('notifications'),
  ]);

  return {
    microphone,
    camera,
    notifications,
    desktopAutomation: options.desktopAutomation,
    wakeWordEnabled: options.wakeWordEnabled,
    sensorPrimerSeen: options.sensorPrimerSeen,
    biometricsPrimerSeen: options.biometricsPrimerSeen,
    updatedAt: Date.now(),
  };
}

export function broadcastSensorPermissionChange(detail?: Partial<SensorPermissionSnapshot>) {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(SENSOR_PERMISSIONS_CHANGED, {
    detail: {
      ...detail,
      updatedAt: Date.now(),
    },
  }));
}

export async function requestSensorPermission(kind: SensorKind): Promise<{
  ok: boolean;
  state: SensorPermissionState;
  error?: string;
}> {
  setSensorEnabled(kind, true);

  if (!hasNavigator() || !navigator.mediaDevices?.getUserMedia) {
    const state: SensorPermissionState = 'unavailable';
    broadcastSensorPermissionChange({ [kind]: state } as Partial<SensorPermissionSnapshot>);
    return { ok: false, state, error: 'Media devices are unavailable in this runtime.' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: kind === 'microphone',
      video: kind === 'camera',
    });
    stream.getTracks().forEach(track => track.stop());
    const state = await queryPermission(kind);
    const nextState = state === 'unknown' ? 'granted' : state;
    broadcastSensorPermissionChange({ [kind]: nextState } as Partial<SensorPermissionSnapshot>);
    return { ok: nextState === 'granted', state: nextState };
  } catch (err: any) {
    const state = await queryPermission(kind);
    const nextState = state === 'unknown' ? 'denied' : state;
    broadcastSensorPermissionChange({ [kind]: nextState } as Partial<SensorPermissionSnapshot>);
    return {
      ok: false,
      state: nextState,
      error: err?.message || `Failed to request ${kind} permission.`,
    };
  }
}

export async function requestMicrophoneStream(audio: MediaStreamConstraints['audio'] = true): Promise<MediaStream> {
  if (!isSensorEnabled('microphone')) {
    throw new Error('Microphone is disabled in Lumi settings.');
  }

  if (!hasNavigator() || !navigator.mediaDevices?.getUserMedia) {
    broadcastSensorPermissionChange({ microphone: 'unavailable' });
    throw new Error('Microphone is unavailable in this runtime.');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    trackActiveStream('microphone', stream);
    broadcastSensorPermissionChange({ microphone: 'granted' });
    return stream;
  } catch (err) {
    const state = await queryPermission('microphone');
    broadcastSensorPermissionChange({ microphone: state === 'unknown' ? 'denied' : state });
    throw err;
  }
}

export async function requestCameraStream(video: MediaStreamConstraints['video'] = true): Promise<MediaStream> {
  if (!isSensorEnabled('camera')) {
    throw new Error('Camera is disabled in Lumi settings.');
  }

  if (!hasNavigator() || !navigator.mediaDevices?.getUserMedia) {
    broadcastSensorPermissionChange({ camera: 'unavailable' });
    throw new Error('Camera is unavailable in this runtime.');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    trackActiveStream('camera', stream);
    broadcastSensorPermissionChange({ camera: 'granted' });
    return stream;
  } catch (err) {
    const state = await queryPermission('camera');
    broadcastSensorPermissionChange({ camera: state === 'unknown' ? 'denied' : state });
    throw err;
  }
}
