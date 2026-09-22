import type { NativeApi } from '@synara/contracts';

import type {
  DeviceFrameSource,
  DeviceFrameSourceOptions,
} from '../vendor/synara/apps/web/src/lib/deviceFrameSource.ts';
import { decodeDeviceFrame } from '../vendor/synara/packages/shared/src/deviceFrame.ts';
import type { AgentWindowBridge } from './cedia-adapter';

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
export const CEDIA_AGENT_DEVICE_EVENT_CHANNEL = 'vscode:cediaAgentDevice';
export const CEDIA_AGENT_DEVICE_FRAME_CHANNEL = 'vscode:cediaAgentDeviceFrames';

export interface NativeDeviceBridge extends AgentWindowBridge {
  invoke(channel: string, input?: unknown): Promise<unknown>;
}

type DeviceApi = NativeApi['device'];
type DeviceMethod = Exclude<keyof DeviceApi, 'onEvent'>;
type DeviceMethodInput<K extends DeviceMethod> = Parameters<Extract<DeviceApi[K], (...args: never[]) => unknown>>[0];
type PanelMethod = DeviceMethod | 'subscribeEvents' | 'unsubscribeEvents' | 'subscribeFrames' | 'unsubscribeFrames' | 'requestResync' | 'ackFrame';

interface DevicePanelRequest {
  readonly kind: 'panel';
  readonly surface: 'device';
  readonly method: string;
  readonly input: unknown;
}

interface NativeDeviceFramePayload {
  readonly udid?: unknown;
  readonly sequence?: unknown;
  readonly dataBase64?: unknown;
}

interface NativeDeviceFrameGlobals {
  __cediaNativeDeviceFrameSource?: (
    options: DeviceFrameSourceOptions,
  ) => DeviceFrameSource | null;
}

interface SharedNativeFrameSubscription {
  readonly bridge: NativeDeviceBridge;
  readonly udid: string;
  readonly ready: Promise<void>;
  references: number;
}

const sharedFrameSubscriptions = new WeakMap<NativeDeviceBridge, Map<string, SharedNativeFrameSubscription>>();

function acquireSharedFrameSubscription(
  bridge: NativeDeviceBridge,
  udid: string,
): SharedNativeFrameSubscription {
  let byDevice = sharedFrameSubscriptions.get(bridge);
  if (!byDevice) {
    byDevice = new Map();
    sharedFrameSubscriptions.set(bridge, byDevice);
  }
  const existing = byDevice.get(udid);
  if (existing) {
    existing.references += 1;
    return existing;
  }
  const entry: SharedNativeFrameSubscription = {
    bridge,
    udid,
    references: 1,
    ready: request(bridge, 'subscribeFrames', { udid }).then(() => undefined),
  };
  byDevice.set(udid, entry);
  return entry;
}

function releaseSharedFrameSubscription(entry: SharedNativeFrameSubscription): void {
  const byDevice = sharedFrameSubscriptions.get(entry.bridge);
  if (!byDevice || byDevice.get(entry.udid) !== entry) return;
  entry.references = Math.max(0, entry.references - 1);
  if (entry.references > 0) return;
  byDevice.delete(entry.udid);
  if (byDevice.size === 0) sharedFrameSubscriptions.delete(entry.bridge);
  void request(entry.bridge, 'unsubscribeFrames', { udid: entry.udid }).catch(() => undefined);
}

function request<T>(bridge: NativeDeviceBridge, method: PanelMethod, input: unknown): Promise<T> {
  return bridge.invoke(CEDIA_AGENT_CHANNEL, {
    kind: 'panel',
    surface: 'device',
    method,
    input,
  } satisfies DevicePanelRequest) as Promise<T>;
}

function payloadFromArgs(args: readonly unknown[]): NativeDeviceFramePayload | null {
  const payload = args[0];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  return payload as NativeDeviceFramePayload;
}

function decodeBase64(value: string): Uint8Array | null {
  // H.264 access units are bounded by the native transport queue. Keep an
  // explicit ceiling at the renderer boundary so a corrupt IPC payload cannot
  // allocate an unbounded temporary string/array.
  if (value.length > 64 * 1024 * 1024) return null;
  try {
    const binary = typeof globalThis.atob === 'function'
      ? globalThis.atob(value)
      : Buffer.from(value, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function createNativeDeviceFrameSource(
  bridge: NativeDeviceBridge,
  options: DeviceFrameSourceOptions,
): DeviceFrameSource | null {
  if (!bridge.on) return null;

  const now = options.now ?? (() => Date.now());
  const cooldownMs = options.resyncCooldownMs ?? 1_000;
  let closed = false;
  let subscribed = false;
  let subscribeFailed = false;
  let resyncPending = false;
  let lastResyncAt: number | null = null;

  const reset = (reason: 'closed' | 'error' | 'decode-failed', error?: unknown) => {
    if (closed || subscribeFailed) return;
    options.handlers.onReset(reason, error);
  };

  const invokeControl = (
    method: 'subscribeFrames' | 'unsubscribeFrames' | 'requestResync' | 'ackFrame',
    input: Record<string, unknown> = { udid: options.udid },
  ): void => {
    void request(bridge, method, input).catch((error) => reset('error', error));
  };

  const onFrameEvent = (_event: unknown, ...args: unknown[]) => {
    if (closed) return;
    const payload = payloadFromArgs(args);
    if (!payload || payload.udid !== options.udid || typeof payload.dataBase64 !== 'string') return;
    const outerSequence = typeof payload.sequence === 'number' && Number.isInteger(payload.sequence)
      && payload.sequence >= 0 && payload.sequence <= 0xFFFF_FFFF
      ? payload.sequence
      : undefined;
    const acknowledgeOuterFrame = () => {
      if (outerSequence !== undefined) {
        invokeControl('ackFrame', { udid: options.udid, sequence: outerSequence });
      }
    };
    const bytes = decodeBase64(payload.dataBase64);
    if (!bytes) {
      reset('decode-failed');
      acknowledgeOuterFrame();
      return;
    }
    const decoded = decodeDeviceFrame(bytes);
    if (!decoded.ok) {
      reset('decode-failed');
      acknowledgeOuterFrame();
      return;
    }
    // IPC is a shared channel. The header remains authoritative even if a
    // buggy host accidentally stamps the outer payload with another device.
    if (decoded.frame.header.deviceId !== options.udid) {
      acknowledgeOuterFrame();
      return;
    }
    try {
      options.handlers.onFrame(decoded.frame);
    } finally {
      acknowledgeOuterFrame();
    }
  };

  bridge.on(CEDIA_AGENT_DEVICE_FRAME_CHANNEL, onFrameEvent);
  // The source is single-use. The host rejects this request unless the caller
  // has attached the same device through this renderer's authenticated sender.
  const sharedSubscription = acquireSharedFrameSubscription(bridge, options.udid);
  void sharedSubscription.ready
    .then(() => {
      if (closed) return;
      subscribed = true;
      if (!resyncPending) return;
      resyncPending = false;
      invokeControl('requestResync');
    })
    .catch((error) => {
      reset('error', error);
      subscribeFailed = true;
    });

  return {
    requestResync: () => {
      if (closed || subscribeFailed) return false;
      const at = now();
      if (lastResyncAt !== null && at - lastResyncAt < cooldownMs) return false;
      lastResyncAt = at;
      if (!subscribed) {
        resyncPending = true;
        return false;
      }
      invokeControl('requestResync');
      return true;
    },
    close: () => {
      if (closed) return;
      closed = true;
      resyncPending = false;
      bridge.removeListener?.(CEDIA_AGENT_DEVICE_FRAME_CHANNEL, onFrameEvent);
      releaseSharedFrameSubscription(sharedSubscription);
    },
  };
}

/**
 * Install Cedia's IPC frame source for the vendored Synara web app. The
 * function is intentionally explicit so browser/test entry points retain the
 * upstream WebSocket source when no host bridge is present.
 */
export function installNativeDeviceFrameSource(bridge: NativeDeviceBridge): () => void {
  const globals = globalThis as typeof globalThis & NativeDeviceFrameGlobals;
  const previous = globals.__cediaNativeDeviceFrameSource;
  const factory = (options: DeviceFrameSourceOptions): DeviceFrameSource | null =>
    createNativeDeviceFrameSource(bridge, options);
  globals.__cediaNativeDeviceFrameSource = factory;
  return () => {
    if (globals.__cediaNativeDeviceFrameSource === factory) {
      if (previous) globals.__cediaNativeDeviceFrameSource = previous;
      else delete globals.__cediaNativeDeviceFrameSource;
    }
  };
}

export function createNativeDeviceApi(bridge: NativeDeviceBridge): DeviceApi {
  const api = {
    list: (input: DeviceMethodInput<'list'>) => request(bridge, 'list', input),
    boot: (input: DeviceMethodInput<'boot'>) => request(bridge, 'boot', input),
    shutdown: (input: DeviceMethodInput<'shutdown'>) => request(bridge, 'shutdown', input),
    attach: (input: DeviceMethodInput<'attach'>) => request(bridge, 'attach', input),
    detach: (input: DeviceMethodInput<'detach'>) => request(bridge, 'detach', input),
    getThreadState: (input: DeviceMethodInput<'getThreadState'>) => request(bridge, 'getThreadState', input),
    tap: (input: DeviceMethodInput<'tap'>) => request(bridge, 'tap', input),
    swipe: (input: DeviceMethodInput<'swipe'>) => request(bridge, 'swipe', input),
    typeText: (input: DeviceMethodInput<'typeText'>) => request(bridge, 'typeText', input),
    keyEvent: (input: DeviceMethodInput<'keyEvent'>) => request(bridge, 'keyEvent', input),
    pressButton: (input: DeviceMethodInput<'pressButton'>) => request(bridge, 'pressButton', input),
    installApp: (input: DeviceMethodInput<'installApp'>) => request(bridge, 'installApp', input),
    launchApp: (input: DeviceMethodInput<'launchApp'>) => request(bridge, 'launchApp', input),
    openUrl: (input: DeviceMethodInput<'openUrl'>) => request(bridge, 'openUrl', input),
    screenshot: (input: DeviceMethodInput<'screenshot'>) => request(bridge, 'screenshot', input),
    startRecording: (input: DeviceMethodInput<'startRecording'>) => request(bridge, 'startRecording', input),
    stopRecording: (input: DeviceMethodInput<'stopRecording'>) => request(bridge, 'stopRecording', input),
    describeUi: (input: DeviceMethodInput<'describeUi'>) => request(bridge, 'describeUi', input),
    scrollToElement: (input: DeviceMethodInput<'scrollToElement'>) => request(bridge, 'scrollToElement', input),
    onEvent: (listener: Parameters<DeviceApi['onEvent']>[0]) => {
      if (!bridge.on) return () => undefined;
      const handler = (_event: unknown, ...args: unknown[]) => {
        const payload = args[0];
        if (payload && typeof payload === 'object') listener(payload as Parameters<DeviceApi['onEvent']>[0] extends (event: infer E) => unknown ? E : never);
      };
      bridge.on(CEDIA_AGENT_DEVICE_EVENT_CHANNEL, handler);
      void request(bridge, 'subscribeEvents', {}).catch(() => undefined);
      return () => {
        bridge.removeListener?.(CEDIA_AGENT_DEVICE_EVENT_CHANNEL, handler);
        void request(bridge, 'unsubscribeEvents', {}).catch(() => undefined);
      };
    },
  };
  return api as DeviceApi;
}
