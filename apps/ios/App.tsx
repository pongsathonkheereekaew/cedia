import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import WebView from "react-native-webview";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Command, Json, Project, Session, TerminalCheckpoint, UiResponseRequest } from "../../packages/protocol/src/index.ts";
import {
  CediaApi,
  CommandLedger,
  clearSnapshotCache,
  createCachedSnapshot,
  DEFAULT_CACHE_TTL_MS,
  isSafeExternalUrl,
  createCommandId,
  createInitialMobileState,
  isCacheFresh,
  parsePairingOffer,
  isGatewayPairingOffer,
  isLegacyRelayPairingOffer,
  pairingTransportLabel,
  readCachedSnapshot,
  readPairingSecrets,
  readStoredPairingOffer,
  reduceMobileState,
  restoreCachedSnapshot,
  revokePairing,
  savePairingSecrets,
  createNativeGatewayTransport,
  createWebGatewayTransport,
  redeemGatewayEnrollment,
  GatewayEnrollmentError,
  activityInboxBody,
  activityInboxFilterChips,
  activityInboxForSession,
  activityInboxItemFromHostCommand,
  activityInboxItemFromPendingUi,
  activityInboxItemKey,
  activityInboxItemsFromUnknownCommands,
  activityInboxTapAction,
  activityInboxTapAnswersRequest,
  activityInboxTitle,
  mergeActivityInbox,
  type ActivityInboxItem,
  type ClientTransport,
  type MobileTaskState,
  type PairingOffer,
  type CediaGatewayPairingOffer,
  type PairingSecretStore,
  type CediaUiRequest,
  type PendingUiRequest,
  type SnapshotCache,
  type TranscriptEntry,
  type LoginProviderOption,
  type ModelOption,
  type UiPresentation,
  type VirtualTerminalIdentity,
  artifactDataUri,
  artifactDisplaySize,
  artifactKind,
  decodeUtf8,
  downloadArtifact,
  readArtifactBytes,
  type ArtifactKind,
  type ArtifactReceipt,
  APPEARANCE_SETTINGS_SOURCE,
  applyAppearanceDraft,
  applyProductPref,
  beginAppearanceDraft,
  connectionBadgeLabel,
  formatRelativeTime,
  hostReachabilityCopy,
  lastSyncLabel,
  pairingPublicKeyFingerprint,
  DEFAULT_PRODUCT_PREFS,
  effectiveReduceMotion,
  formatTaskHeaderWorkspace,
  iosApprovalDisplayStatus,
  iosApprovalReadonly,
  iosApprovalStatusCopy,
  iosReviewSheetFromHost,
  iosReviewSheetModel,
  iosFileEditorModel,
  IOS_COMPOSER_MODEL_UNAVAILABLE,
  IOS_HOST_UPLOAD_COPY,
  iosComposerAllowsCommand,
  iosComposerHonesty,
  modelOptionSelectable,
  shouldFetchNextHostEventPage,
  distanceFromBottom,
  dynamicTypeRoles,
  resolveFontScale,
  jumpToLatestLabel,
  nextUnreadCount,
  scaledSize,
  shouldFollowTranscript,
  type DynamicTypeRoles,
  TOOL_CARD_BODY_CAP_PX,
  toolCardBody,
  toolCardCopyText,
  toolCardDefaultExpanded,
  previewResetOverride,
  resolveAppearancePrefs,
  SETTINGS_APPLY_SCOPE_REASON,
  SETTINGS_SCOPES,
  settingsScopeWritable,
  snapshotKey,
  taskHeaderWorkspace,
  type AppearanceDraft,
  type ProductPrefs,
  type RelayReachabilityState,
  type ResetOverridePreview,
} from "./src/core/index.ts";
import { terminalInputCommand, terminalNegotiateCommand, terminalResizeCommand } from "./src/core/virtual-terminal.ts";
import { commandFailurePlan } from "./src/core/command-recovery.ts";
import { isDiscoverableOwner, ownerRowPresentation, type OwnerEntry } from "./src/core/owners.ts";
import { VirtualTerminalPanel } from "./src/components/VirtualTerminal.tsx";
import { emptyThinkingParams, ompCommandData, parentSessionFromOmpState, THINKING_NOT_ADVERTISED, thinkingFromOmpState, type ThinkingParams } from "../macos/src/thinking-params.ts";
import { taskSnapshotCache } from "./src/storage/cache.ts";
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from "./src/storage/drafts.ts";
import { readStoredProductPrefs, writeStoredProductPrefs } from "./src/storage/prefs.ts";
import { securePairingStore } from "./src/storage/secure.ts";

export interface CediaMobileAppProps {
  /** Inject the host/relay implementation. An absent transport is rendered as unavailable. */
  readonly transport?: ClientTransport;
  readonly secretStore?: PairingSecretStore;
  readonly cache?: SnapshotCache;
}

interface Palette {
  readonly bg: string;
  readonly surface: string;
  readonly elevated: string;
  readonly border: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly white: string;
}

const LIGHT: Palette = {
  bg: "#F6F7FB",
  surface: "#FFFFFF",
  elevated: "#F0F2F7",
  border: "#E3E6EE",
  text: "#172033",
  muted: "#687187",
  accent: "#6D5CF6",
  accentSoft: "#EEECFF",
  success: "#2A9D72",
  warning: "#C78127",
  danger: "#C95061",
  white: "#FFFFFF",
};

const DARK: Palette = {
  bg: "#10131B",
  surface: "#181D28",
  elevated: "#222938",
  border: "#30384A",
  text: "#F4F6FB",
  muted: "#A3ACC0",
  accent: "#9A8CFF",
  accentSoft: "#2B2752",
  success: "#60D3A5",
  warning: "#E7B36D",
  danger: "#F17C89",
  white: "#FFFFFF",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord(value: unknown): Record<string, Json> {
  return isRecord(value) ? value as Record<string, Json> : {};
}

function frameType(frame: Record<string, unknown>): string {
  const value = frame.type ?? frame.kind ?? frame.event;
  return typeof value === "string" ? value : "event";
}

function statusColor(status: MobileTaskState["connection"], palette: Palette): string {
  if (status === "connected" || status === "running") return palette.success;
  if (status === "connecting" || status === "reconnecting") return palette.warning;
  return palette.muted;
}

function sanitizeText(value: string): string {
  return value.replace(/\u0000/g, "").trim();
}

const SETTINGS_CATEGORIES = [
  {
    label: "Appearance",
    hint: "Local presentation prefs",
    body: "Light and dark follow the system appearance. Density and Reduce Motion stay on this phone. They do not start or stop OMP. The Mac workbench theme follows Code-OSS there.",
    appearance: true,
  },
  {
    label: "Agents/OMP",
    hint: "Projection of the Mac session",
    body: "This iPhone is a projection of the Mac OMP session. OMP is the only execution owner. There is no second OMP and no Agent↔IDE switch on this phone.",
  },
  {
    label: "Models/providers",
    hint: "Listed by OMP on the Mac",
    body: "Models and providers come from the OMP registry on the Mac. Open a task to request that catalog. This phone does not invent availability.",
  },
  {
    label: "Tools/MCP",
    hint: "Advertised by the Mac host",
    body: "MCP and tools appear only when the Mac host advertises them. This phone does not add a tool registry.",
  },
  {
    label: "Skills/rules/hooks/commands",
    hint: "OMP-owned on the Mac",
    body: "Skills, rules, hooks, and slash commands are OMP-owned on the Mac. Automations stay unavailable.",
    unavailable: [{ label: "Automations", reason: "Automations need a host that advertises schedules. This phone does not invent cloud runs." }],
  },
  {
    label: "Workspace/editor",
    hint: "Code-OSS lives on the Mac",
    body: "Code-OSS lives on the Mac. This phone has no iPhone IDE and does not promise a compiler.",
  },
  {
    label: "Browser/artifacts",
    hint: "Browser unsupported until advertised",
    body: "Browser stays unsupported until the Mac advertises a live handle. Artifacts are immutable receipts from the same Mac task.",
  },
  {
    label: "Devices/connections",
    hint: "Pairing and host reachability",
    body: "Pairing, revoke, and host reachability live here. Pair or reconnect the same Mac — this phone does not add a second host.",
    pairing: true,
  },
  {
    label: "Notifications",
    hint: "Contract not enabled",
    body: "System notifications stay off until a Cedia notification contract exists. Voice stays unavailable.",
    unavailable: [{ label: "Voice", reason: "Voice stays unavailable until a microphone contract exists. Cedia does not listen on this phone." }],
  },
  {
    label: "Privacy/security",
    hint: "Secrets stay redacted",
    body: "Secrets stay protected on this phone and stay redacted. Cedia does not export provider tokens.",
    privacy: true,
  },
  {
    label: "About/updates/licenses",
    hint: "Personal workspace, no update claim",
    body: "This phone continues the same Cedia workspace. Updates, notarization, and cloud stay unclaimed.",
    unavailable: [{ label: "Cloud", reason: "This Mac is the only advertised destination. Cloud is not a Cedia runtime." }],
  },
] as const;

function pendingRequestSessionId(item: PendingUiRequest): string | undefined {
  if (!isRecord(item)) return undefined;
  const value = item.sessionId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const ACTIVITY_INBOX_CONCURRENCY = 4;

async function mapLimited<T, R>(items: readonly T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function sessionForInboxItem(item: ActivityInboxItem, sessions: readonly Session[]): Session | undefined {
  const tap = activityInboxTapAction(item);
  if (tap.type !== "open_session") return undefined;
  return sessions.find(session => session.id === tap.sessionId);
}

type MobileInboxView = "tasks" | "activity" | "settings";

function isUiSheetReadonly(
  request: PendingUiRequest,
  current: { sessionId?: string; incarnation?: string; connection?: string },
): boolean {
  return iosApprovalReadonly(request, current, current.connection);
}

function uiSheetAllowAnswer(ui: CediaUiRequest, draft: string, selectedOption: string | undefined): UiResponseRequest["answer"] | undefined {
  if (ui.method === "confirm") return true;
  if (ui.method === "select") return selectedOption && ui.options.includes(selectedOption) ? selectedOption : undefined;
  return draft;
}

function uiSheetDenyAnswer(ui: CediaUiRequest): UiResponseRequest["answer"] {
  return ui.method === "confirm" ? false : { cancelled: true };
}

function uiSheetIdentity(
  request: PendingUiRequest,
  current: { sessionId?: string; incarnation?: string; connection?: string },
): string {
  const ui = request.request;
  const displayStatus = iosApprovalDisplayStatus(request, current);
  const statusCopy = iosApprovalStatusCopy(displayStatus);
  return [
    `Request ${ui.id}`,
    request.tool ? `Tool ${request.tool}` : "",
    request.target ? `Target ${request.target}` : "",
    request.cwd ? `cwd ${request.cwd}` : "",
    request.sessionId ? `Session ${request.sessionId}` : "",
    request.incarnation ? `Incarnation ${request.incarnation}` : "",
    ui.method !== "editor" && ui.timeout != null ? `Timeout ${ui.timeout}ms` : "",
    isUiSheetReadonly(request, current) ? statusCopy || `Status ${displayStatus}` : "",
  ].filter(Boolean).join("\n");
}

function artifactKindLabel(kind: ArtifactKind): string {
  if (kind === "text") return "Text";
  if (kind === "image") return "Image";
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  return "File";
}

function artifactMediaDocument(uri: string, kind: "audio" | "video", title: string): string {
  // The artifact is always a data URI in the media attribute. JavaScript is
  // disabled on the native WebView and no artifact HTML is ever interpolated
  // into this document, so an HTML artifact cannot execute as a preview.
  const tag = kind === "audio" ? "audio" : "video";
  const controls = kind === "audio" ? "controls" : "controls playsinline preload=metadata";
  const safeTitle = title.replace(/[&<>\"']/g, "_");
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>html,body{margin:0;background:#10131b;color:#f4f6fb;display:grid;place-items:center;min-height:100%;font-family:-apple-system,sans-serif}audio,video{max-width:100%;width:100%}</style><${tag} ${controls} src="${uri}"></${tag}>`;
}

export default function App(props: CediaMobileAppProps = {}) {
  return (
    <SafeAreaProvider>
      <CediaRoot {...props} />
    </SafeAreaProvider>
  );
}

const PresentationContext = React.createContext<{
  readonly prefs: ProductPrefs;
  readonly appearancePrefs: ProductPrefs;
  readonly reduceMotion: boolean;
  readonly settingsRevision: number;
  readonly settingsSource: string;
  readonly settingsApplyError?: string;
  readonly settingsResetPreview?: ResetOverridePreview;
  readonly draftAppearance: (patch: Partial<Pick<ProductPrefs, "density" | "reduceMotion" | "highContrast">>) => void;
  readonly applyAppearance: () => void;
  readonly resetAppearance: (key: "density" | "reduceMotion" | "highContrast") => void;
}>({
  prefs: DEFAULT_PRODUCT_PREFS,
  appearancePrefs: DEFAULT_PRODUCT_PREFS,
  reduceMotion: false,
  settingsRevision: 0,
  settingsSource: APPEARANCE_SETTINGS_SOURCE,
  draftAppearance: () => undefined,
  applyAppearance: () => undefined,
  resetAppearance: () => undefined,
});

function liveFontScale(windowScale?: number): number {
  return resolveFontScale(windowScale && windowScale > 0 ? windowScale : PixelRatio.getFontScale());
}

function modalAnimation(reduceMotion: boolean, preferred: "slide" | "fade"): "none" | "slide" | "fade" {
  return reduceMotion ? "none" : preferred;
}

function useModalAnimation(preferred: "slide" | "fade"): "none" | "slide" | "fade" {
  const { reduceMotion } = React.useContext(PresentationContext);
  return modalAnimation(reduceMotion, preferred);
}

function CediaRoot({ transport, secretStore = securePairingStore, cache = taskSnapshotCache }: CediaMobileAppProps) {
  const colorScheme = useColorScheme();
  const palette = colorScheme === "dark" ? DARK : LIGHT;
  const [prefs, setPrefs] = useState(DEFAULT_PRODUCT_PREFS);
  const [appearanceDraft, setAppearanceDraft] = useState<AppearanceDraft | undefined>();
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [settingsApplyError, setSettingsApplyError] = useState<string | undefined>();
  const [settingsResetPreview, setSettingsResetPreview] = useState<ResetOverridePreview | undefined>();
  const [osReduceMotion, setOsReduceMotion] = useState(false);
  const appearancePrefs = resolveAppearancePrefs(prefs, appearanceDraft);
  const reduceMotion = effectiveReduceMotion(osReduceMotion, prefs.reduceMotion);
  const { fontScale: windowFontScale } = useWindowDimensions();
  const fontScale = liveFontScale(windowFontScale);
  const type = useMemo(() => dynamicTypeRoles(fontScale), [fontScale]);
  const styles = useMemo(() => makeStyles(palette, appearancePrefs.density, appearancePrefs.highContrast, type, fontScale), [palette, appearancePrefs.density, appearancePrefs.highContrast, type, fontScale]);
  const [state, dispatch] = useReducer(reduceMobileState, undefined, () => createInitialMobileState());
  const stateRef = useRef(state);
  const ledgerRef = useRef(new CommandLedger());
  const [showPairing, setShowPairing] = useState(!transport);
  const [pairedOffer, setPairedOffer] = useState<PairingOffer | null>(null);
  const [pairedTransport, setPairedTransport] = useState<ClientTransport | undefined>();
  const [selectedView, setSelectedView] = useState<MobileInboxView>("tasks");
  const [activityInbox, setActivityInbox] = useState<readonly ActivityInboxItem[]>([]);
  const activityInboxRef = useRef(activityInbox);
  const activityInboxGenerationRef = useRef(0);
  const [activityInboxError, setActivityInboxError] = useState<string | undefined>();
  const lastSessionIdRef = useRef<string | undefined>(undefined);
  const tasksScrollOffsetRef = useRef(0);
  const draftPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftPersistPausedRef = useRef(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [syncing, setSyncing] = useState(false);
  const [relayState] = useState<RelayReachabilityState | undefined>();
  const [pairingRevoked, setPairingRevoked] = useState(false);
  const [uiSheetOpen, setUiSheetOpen] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showLoginPicker, setShowLoginPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showFileEditor, setShowFileEditor] = useState(false);
  const [thinking, setThinking] = useState<ThinkingParams>(emptyThinkingParams());
  const [parentSession, setParentSession] = useState<string | undefined>();
  const [showThinkingPicker, setShowThinkingPicker] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifactSession, setArtifactSession] = useState<{ readonly id: string; readonly incarnation: string } | null>(null);
  const [artifacts, setArtifacts] = useState<readonly ArtifactReceipt[]>([]);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactViewer, setArtifactViewer] = useState<ArtifactReceipt | null>(null);
  const [showArtifactCapture, setShowArtifactCapture] = useState(false);
  const webTransport = useMemo(() => Platform.OS === "web" ? createWebGatewayTransport() : undefined, []);
  const activeTransport = transport ?? pairedTransport ?? webTransport;
  const api = useMemo(() => activeTransport ? new CediaApi({ transport: activeTransport }) : null, [activeTransport]);
  const insets = useSafeAreaInsets();

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { activityInboxRef.current = activityInbox; }, [activityInbox]);
  useEffect(() => {
    if (state.session?.id) lastSessionIdRef.current = state.session.id;
  }, [state.session?.id]);

  useEffect(() => {
    setUiSheetOpen(Boolean(state.uiRequests[0]?.token));
  }, [state.uiRequests[0]?.token]);

  useEffect(() => {
    let cancelled = false;
    void readStoredProductPrefs().then(stored => {
      if (!cancelled) setPrefs(stored);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof AccessibilityInfo.isReduceMotionEnabled !== "function") return;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!cancelled) setOsReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setOsReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const draftAppearance = useCallback((patch: Partial<Pick<ProductPrefs, "density" | "reduceMotion" | "highContrast">>) => {
    setAppearanceDraft(current => beginAppearanceDraft(
      current?.revision ?? settingsRevision,
      applyProductPref(resolveAppearancePrefs(prefs, current), patch),
    ));
    setSettingsApplyError(undefined);
  }, [prefs, settingsRevision]);

  const applyAppearance = useCallback(() => {
    const draft = appearanceDraft ?? beginAppearanceDraft(settingsRevision, prefs);
    const result = applyAppearanceDraft(settingsRevision, draft);
    if (!result.ok) {
      setAppearanceDraft(draft);
      setSettingsApplyError(result.reason);
      return;
    }
    const next = applyProductPref(prefs, result.values);
    setPrefs(next);
    void writeStoredProductPrefs(next).catch(() => undefined);
    setSettingsRevision(result.revision);
    setAppearanceDraft(undefined);
    setSettingsApplyError(undefined);
    setSettingsResetPreview(undefined);
  }, [appearanceDraft, prefs, settingsRevision]);

  const resetAppearance = useCallback((key: "density" | "reduceMotion" | "highContrast") => {
    const currentValues = resolveAppearancePrefs(prefs, appearanceDraft);
    const inherited = DEFAULT_PRODUCT_PREFS[key];
    setSettingsResetPreview(previewResetOverride(key, currentValues[key], inherited));
    setAppearanceDraft(beginAppearanceDraft(
      appearanceDraft?.revision ?? settingsRevision,
      applyProductPref(currentValues, { [key]: inherited }),
    ));
    setSettingsApplyError(undefined);
  }, [appearanceDraft, prefs, settingsRevision]);

  const presentation = useMemo(() => ({
    prefs,
    appearancePrefs,
    reduceMotion,
    settingsRevision,
    settingsSource: APPEARANCE_SETTINGS_SOURCE,
    settingsApplyError,
    settingsResetPreview,
    draftAppearance,
    applyAppearance,
    resetAppearance,
  }), [
    appearancePrefs,
    applyAppearance,
    draftAppearance,
    prefs,
    reduceMotion,
    resetAppearance,
    settingsApplyError,
    settingsResetPreview,
    settingsRevision,
  ]);

  // Artifact sheets are task-scoped. Switching tasks or incarnations closes
  // every preview so a delayed relay response cannot render under a new task.
  useEffect(() => {
    if (!artifactSession) return;
    const current = state.session;
    if (current?.id === artifactSession.id && current.incarnation === artifactSession.incarnation) return;
    setShowArtifacts(false);
    setShowArtifactCapture(false);
    setArtifactViewer(null);
  }, [artifactSession, state.session?.id, state.session?.incarnation]);

  useEffect(() => {
    setShowReview(false);
    setShowFileEditor(false);
  }, [state.session?.id, state.session?.incarnation]);

  const setConnection = useCallback((status: MobileTaskState["connection"], error?: string) => {
    dispatch({ type: "connection", status, error });
  }, []);

  useEffect(() => {
    if (transport || pairedOffer || Platform.OS === "web") return;
    let cancelled = false;
    void readStoredPairingOffer(secretStore).then(async offer => {
      if (cancelled || !offer) return;
      setPairedOffer(offer);
      setShowPairing(false);
      if (!isGatewayPairingOffer(offer)) return;
      const secrets = await readPairingSecrets(secretStore, offer.serverId);
      if (cancelled || !secrets) return;
      try {
        setPairedTransport(createNativeGatewayTransport({ endpoint: offer.gatewayOrigin, token: secrets.deviceToken }));
      } catch (error) {
        setConnection("offline", error instanceof Error ? error.message : String(error));
      }
    });
    return () => { cancelled = true; };
  }, [pairedOffer, secretStore, transport, setConnection]);

  // Legacy Paseo offers are retained for migration but are never armed. A
  // gateway offer only becomes active after its one-shot enrollment succeeds.
  useEffect(() => {
    if (transport || !pairedOffer || !isGatewayPairingOffer(pairedOffer)) {
      setPairedTransport(undefined);
      return;
    }
    try {
      if (Platform.OS === "web") setPairedTransport(createWebGatewayTransport());
    } catch (error) {
      setConnection("offline", error instanceof Error ? error.message : String(error));
    }
  }, [pairedOffer, transport, setConnection]);

  const refreshProjects = useCallback(async (preferredProjectId?: string) => {
    if (!api) {
      setConnection("offline", "Attach the Cedia host transport to connect to your Mac");
      return;
    }
    setConnection("connecting");
    try {
      const projects = await api.listProjects();
      dispatch({ type: "projects", projects });
      const current = preferredProjectId ?? stateRef.current.project?.id ?? projects[0]?.id;
      if (current) {
        const sessions = await api.listSessions(current);
        dispatch({ type: "sessions", sessions });
      }
      try {
        const listing = await api.listOwners();
        dispatch({ type: "owners", owners: [...listing.owners], truncated: listing.truncated });
      } catch {
        dispatch({ type: "owners", owners: [], truncated: false });
      }
      setConnection("connected");
    } catch (error) {
      setConnection("offline", error instanceof Error ? error.message : String(error));
    }
  }, [api, setConnection]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const refreshActivityInbox = useCallback(async () => {
    if (!api) return;
    const generation = ++activityInboxGenerationRef.current;
    const sessions = stateRef.current.sessions;
    const existing = activityInboxRef.current;
    const uiFailedIds = new Set<string>();
    const commandFailedIds = new Set<string>();
    const failedMessages: string[] = [];
    const fetched: ActivityInboxItem[] = [];
    const results = await mapLimited(sessions, ACTIVITY_INBOX_CONCURRENCY, async session => {
      const items: ActivityInboxItem[] = [];
      let uiError: string | undefined;
      let commandError: string | undefined;
      try {
        const pending = await api.getPendingUi(session.id);
        items.push(...pending.flatMap(item => {
          const row = activityInboxItemFromPendingUi({
            ...item,
            sessionId: item.sessionId ?? session.id,
            ...(item.incarnation ?? session.incarnation ? { incarnation: item.incarnation ?? session.incarnation } : {}),
          }, session.id);
          return row ? [row] : [];
        }));
      } catch (error) {
        uiError = error instanceof Error ? error.message : String(error);
      }
      try {
        const commands = await api.getCommands(session.id);
        items.push(...commands.flatMap(command => {
          const row = activityInboxItemFromHostCommand(command, session.id);
          return row ? [row] : [];
        }));
      } catch (error) {
        commandError = error instanceof Error ? error.message : String(error);
      }
      return { sessionId: session.id, items, uiError, commandError };
    });
    if (generation !== activityInboxGenerationRef.current) return;
    for (const result of results) {
      if (result.uiError) {
        uiFailedIds.add(result.sessionId);
        failedMessages.push(result.uiError);
      }
      if (result.commandError) {
        commandFailedIds.add(result.sessionId);
        failedMessages.push(result.commandError);
      }
      fetched.push(...result.items);
    }
    const unknownSessionId = stateRef.current.session?.id ?? lastSessionIdRef.current;
    const unknownItems = activityInboxItemsFromUnknownCommands(stateRef.current.pendingCommands, unknownSessionId).map(item => {
      if (item.sessionId) return item;
      const prior = existing.find(row => row.kind === "unknown_command" && row.commandId === item.commandId);
      return prior?.sessionId ? { ...item, sessionId: prior.sessionId } : item;
    });
    const failedIds = new Set([...uiFailedIds, ...commandFailedIds]);
    if (sessions.length > 0 && failedIds.size === sessions.length && fetched.length === 0 && unknownItems.length === 0) {
      setActivityInboxError(failedMessages.join(" · "));
      return;
    }
    const retained = existing.filter(item => {
      const sessionId = item.sessionId;
      if (!sessionId) return false;
      return item.kind === "ui_request" ? uiFailedIds.has(sessionId) : commandFailedIds.has(sessionId);
    });
    setActivityInbox(mergeActivityInbox(existing, [...retained, ...fetched, ...unknownItems]));
    setActivityInboxError(failedMessages.length ? failedMessages.join(" · ") : undefined);
  }, [api]);

  useEffect(() => {
    if (selectedView !== "activity") return;
    void refreshActivityInbox();
  }, [refreshActivityInbox, selectedView, state.sessions]);

  const catchUp = useCallback(async (sessionId = stateRef.current.session?.id, options?: { readonly foreground?: boolean }) => {
    const foreground = options?.foreground === true;
    if (foreground) setSyncing(true);
    try {
      if (!api || !sessionId) return;
      const current = stateRef.current;
      const requestedSession = current.session;
      if (!requestedSession || requestedSession.id !== sessionId) return;
      const requestedIncarnation = requestedSession.incarnation;
      const isCurrentSession = () => {
        const live = stateRef.current.session;
        return live?.id === sessionId && live.incarnation === requestedIncarnation;
      };
      if (current.connection === "offline") setConnection("reconnecting");
      try {
        let page = await api.getEvents(sessionId, current.cursor, 200);
        if (!isCurrentSession()) return;
        const eventAction = (nextPage: typeof page) => ({ type: "events" as const, page: nextPage, sessionId, incarnation: requestedIncarnation });
        // Reduce locally: stateRef updates only after paint, so a while(hasMoreEvents)
        // on the ref would skip every extra page on this tick.
        let working = reduceMobileState(current, eventAction(page));
        dispatch(eventAction(page));
        let pages = 1;
        while (shouldFetchNextHostEventPage({ hasMore: page.hasMore, pagesFetched: pages }) && isCurrentSession()) {
          page = await api.getEvents(sessionId, page.cursor, 200);
          if (!isCurrentSession()) return;
          working = reduceMobileState(working, eventAction(page));
          dispatch(eventAction(page));
          pages += 1;
        }
        if (!isCurrentSession()) return;
        const syncedAt = Date.now();
        const snapshot = createCachedSnapshot({ ...working, cacheSavedAt: syncedAt, cacheExpiresAt: syncedAt + DEFAULT_CACHE_TTL_MS }, syncedAt);
        if (snapshot) {
          await cache.set(snapshotKey(sessionId), JSON.stringify(snapshot));
          if (!isCurrentSession()) return;
          dispatch({ type: "cached_meta", savedAt: snapshot.savedAt, expiresAt: snapshot.expiresAt });
        }
        if (!isCurrentSession()) return;
        setConnection(working.session?.status === "running" ? "running" : "connected");
        const pending = await api.getPendingUi(sessionId);
        if (!isCurrentSession()) return;
        // GET /ui is authoritative. It removes historical cedia_ui rows that no
        // longer await an answer while preserving a mounted sheet for same-token
        // requests so an in-progress input is not replaced during polling.
        dispatch({ type: "ui_sync", events: pending.map(item => ({ ...item, sessionId })) });
        try {
          const fresh = await api.getSession(sessionId);
          if (!isCurrentSession()) return;
          const live = stateRef.current.session;
          if (live && live.id === fresh.id && (live.incarnation !== fresh.incarnation || live.status !== fresh.status || live.title !== fresh.title)) {
            dispatch({ type: "session_refresh", session: fresh });
            setConnection(fresh.status === "running" ? "running" : "connected");
          }
        } catch {
          // Events and pending UI already succeeded; a failed metadata read must not mark the phone offline.
        }
      } catch (error) {
        setConnection("offline", error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (foreground) setSyncing(false);
    }
  }, [api, cache, setConnection]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => {
      setAppState(next);
      if (next !== "active") {
        const current = stateRef.current;
        if (current.session?.id && !draftPersistPausedRef.current) void writeStoredDraft(current.session.id, current.draft);
        return;
      }
      void catchUp(stateRef.current.session?.id, { foreground: true });
    });
    return () => subscription.remove();
  }, [catchUp]);

  useEffect(() => {
    const sessionId = state.session?.id;
    if (!sessionId || draftPersistPausedRef.current) return;
    if (draftPersistTimerRef.current) clearTimeout(draftPersistTimerRef.current);
    draftPersistTimerRef.current = setTimeout(() => {
      draftPersistTimerRef.current = null;
      if (draftPersistPausedRef.current) return;
      void writeStoredDraft(sessionId, state.draft);
    }, 400);
    return () => {
      if (draftPersistTimerRef.current) {
        clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
      }
    };
  }, [state.draft, state.session?.id]);

  useEffect(() => {
    if (!api || !state.session || appState !== "active") return;
    const timer = setInterval(() => void catchUp(stateRef.current.session?.id), 3_000);
    return () => clearInterval(timer);
  }, [api, appState, catchUp, state.session?.id]);

  useEffect(() => {
    if (!state.session || state.events.length === 0) return;
    const snapshot = createCachedSnapshot(state);
    if (snapshot) void cache.set(snapshotKey(snapshot.sessionId), JSON.stringify(snapshot));
  }, [cache, state]);

  const persistOutgoingDraft = useCallback((sessionId: string | undefined, draft: string) => {
    if (!sessionId) return;
    void writeStoredDraft(sessionId, draft);
  }, []);

  const selectProject = useCallback(async (project: Project) => {
    const outgoing = stateRef.current;
    persistOutgoingDraft(outgoing.session?.id, outgoing.draft);
    dispatch({ type: "project", project });
    if (!api) return;
    try {
      const sessions = await api.listSessions(project.id);
      dispatch({ type: "sessions", sessions });
    } catch (error) {
      setConnection("offline", error instanceof Error ? error.message : String(error));
    }
  }, [api, persistOutgoingDraft, setConnection]);

  const refreshOmpState = useCallback(async () => {
    const session = stateRef.current.session;
    if (!api || !session) return;
    try {
      const command = await api.sendCommand(session.id, {
        commandId: createCommandId("state"),
        incarnation: session.incarnation,
        command: "get_state",
        payload: {},
      });
      if (command.status !== "completed" && command.status !== "acknowledged") return;
      const data = ompCommandData(command);
      setThinking(thinkingFromOmpState(data));
      setParentSession(parentSessionFromOmpState(data));
    } catch {
      setThinking(emptyThinkingParams());
      setParentSession(undefined);
    }
  }, [api]);

  const selectSession = useCallback(async (session: Session) => {
    const outgoing = stateRef.current;
    if (outgoing.session?.id && outgoing.session.id !== session.id) persistOutgoingDraft(outgoing.session.id, outgoing.draft);
    const pending = outgoing.uiRequests[0];
    if (pending && pendingRequestSessionId(pending) === session.id) setUiSheetOpen(true);
    draftPersistPausedRef.current = true;
    dispatch({ type: "session", session });
    const incomingDraft = await readStoredDraft(session.id);
    if (stateRef.current.session?.id === session.id && incomingDraft) dispatch({ type: "draft", draft: incomingDraft });
    draftPersistPausedRef.current = false;
    const emptyState = stateRef.current;
    const cached = await readCachedSnapshot(cache, session);
    const selected = () => {
      const live = stateRef.current.session;
      return live?.id === session.id && live.incarnation === session.incarnation;
    };
    if (cached) {
      if (!selected()) return;
      dispatch({ type: "events", page: { events: [...cached.snapshot.events], cursor: cached.snapshot.cursor, hasMore: false }, sessionId: session.id, incarnation: session.incarnation });
      dispatch({ type: "cached_meta", savedAt: cached.snapshot.savedAt, expiresAt: cached.snapshot.expiresAt });
    }
    if (!api) return;
    await catchUp(session.id);
    if (!selected()) return;
    try {
      const commands = await api.getCommands(session.id);
      if (!selected()) return;
      for (const command of commands) ledgerRef.current.absorb(command);
      const latest = stateRef.current;
      for (const command of commands) dispatch({ type: "command_result", command });
      if (latest.connection === "offline") setConnection("connected");
    } catch {
      // Event catch-up already reports the user-visible connection problem.
    }
    void refreshOmpState();
    void emptyState;
  }, [api, cache, catchUp, persistOutgoingDraft, refreshOmpState, setConnection]);

  const artifactTargetIsCurrent = useCallback((target: { readonly id: string; readonly incarnation: string }) => {
    const current = stateRef.current.session;
    return current?.id === target.id && current.incarnation === target.incarnation;
  }, []);

  const refreshArtifacts = useCallback(async (target: { readonly id: string; readonly incarnation: string }) => {
    if (!api || !artifactTargetIsCurrent(target)) return;
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      const listed = await api.listArtifacts(target.id);
      if (!artifactTargetIsCurrent(target)) return;
      setArtifacts(listed);
    } catch (error) {
      if (!artifactTargetIsCurrent(target)) return;
      setArtifactError(error instanceof Error ? error.message : String(error));
    } finally {
      if (artifactTargetIsCurrent(target)) setArtifactBusy(false);
    }
  }, [api, artifactTargetIsCurrent]);

  const openArtifacts = useCallback(() => {
    const session = stateRef.current.session;
    if (!api || !session) return;
    const target = { id: session.id, incarnation: session.incarnation } as const;
    setArtifactSession(target);
    setArtifacts([]);
    setArtifactError(null);
    setShowArtifacts(true);
    void refreshArtifacts(target);
  }, [api, refreshArtifacts]);

  const captureArtifact = useCallback(async (path: string, sourcePaths: readonly string[]) => {
    const target = artifactSession;
    if (!api || !target || !artifactTargetIsCurrent(target)) return;
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      const receipt = await api.captureArtifact(target.id, path, sourcePaths);
      if (!artifactTargetIsCurrent(target)) return;
      setArtifacts(previous => [receipt, ...previous.filter(item => item.sha256 !== receipt.sha256)]);
      setShowArtifactCapture(false);
      setArtifactViewer(receipt);
    } catch (error) {
      if (!artifactTargetIsCurrent(target)) return;
      setArtifactError(error instanceof Error ? error.message : String(error));
    } finally {
      if (artifactTargetIsCurrent(target)) setArtifactBusy(false);
    }
  }, [api, artifactSession, artifactTargetIsCurrent]);

  const closeArtifacts = useCallback(() => {
    setShowArtifacts(false);
    setShowArtifactCapture(false);
    setArtifactViewer(null);
  }, []);

  const startSession = useCallback(async () => {
    const session = stateRef.current.session;
    if (!api || !session) return;
    setBusy(true);
    try {
      const started = await api.startSession(session.id);
      dispatch({ type: "session", session: started });
      setConnection("connected");
      await catchUp(started.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (commandFailurePlan(error) === "surface_recovery") {
        // The task needs reconciliation, not a retry. Show its refreshed status and
        // keep the connection usable so the Reconcile card stays actionable.
        try {
          dispatch({ type: "session_refresh", session: await api.getSession(session.id) });
        } catch {
          // The failed start already explains itself; the next read retries the status.
        }
        setConnection("connected");
      } else {
        setConnection("offline", message);
      }
    } finally {
      setBusy(false);
    }
  }, [api, catchUp, setConnection]);

  const refreshOwners = useCallback(async () => {
    if (!api) return;
    try {
      const listing = await api.listOwners();
      dispatch({ type: "owners", owners: [...listing.owners], truncated: listing.truncated });
    } catch {
      dispatch({ type: "owners", owners: [], truncated: false });
    }
  }, [api]);

  const openOwner = useCallback(async (taskId: string) => {
    if (!api) return;
    const known = stateRef.current.sessions.find(item => item.id === taskId);
    if (known) {
      await selectSession(known);
      return;
    }
    setBusy(true);
    try {
      await selectSession(await api.getSession(taskId));
    } catch (error) {
      setConnection("offline", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [api, selectSession, setConnection]);

  const attachOwner = useCallback(async (taskId: string) => {
    if (!api) return;
    setBusy(true);
    try {
      const started = await api.startSession(taskId);
      dispatch({ type: "session_refresh", session: started });
      const current = stateRef.current.project?.id;
      if (current) {
        const sessions = await api.listSessions(current);
        dispatch({ type: "sessions", sessions });
        await selectSession(sessions.find(item => item.id === taskId) ?? started);
      } else {
        await selectSession(started);
      }
      await refreshOwners();
      setConnection("connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (commandFailurePlan(error) === "surface_recovery") {
        try {
          dispatch({ type: "session_refresh", session: await api.getSession(taskId) });
        } catch {
          // The failed attach already explains itself; the next read retries the status.
        }
        setConnection("connected");
      } else {
        setConnection("offline", message);
      }
    } finally {
      setBusy(false);
    }
  }, [api, refreshOwners, selectSession, setConnection]);

  const reconcileSession = useCallback(async () => {
    const session = stateRef.current.session;
    if (!api || !session || session.status !== "recovery_required") return;
    setBusy(true);
    try {
      const reconciled = await api.reconcile(session.id);
      dispatch({ type: "session", session: reconciled });
      setConnection("connected");
      await catchUp(session.id);
    } catch (error) {
      setConnection("offline", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [api, catchUp, setConnection]);

  /**
   * Sessionless catalog reads.
   *
   * The phone lists models and providers the way the agent window and the CLI do, so a
   * paired phone needs no started session. A failed read keeps the last catalogue and
   * reports the host's own message instead of painting an empty list.
   */
  const loadModelCatalog = useCallback(async () => {
    if (!api) {
      setConnection("offline", "Attach the Cedia host transport to connect to your Mac");
      return;
    }
    try {
      const models = await api.listModels();
      dispatch({ type: "models", models });
      setShowModelPicker(true);
    } catch (error) {
      setConnection("offline", error instanceof Error ? error.message : String(error));
    }
  }, [api, setConnection]);

  const loadLoginProviders = useCallback(async () => {
    if (!api) {
      setConnection("offline", "Attach the Cedia host transport to connect to your Mac");
      return;
    }
    try {
      const providers = await api.listLoginProviders();
      dispatch({ type: "login_providers", providers });
      setShowLoginPicker(true);
    } catch (error) {
      setConnection("offline", error instanceof Error ? error.message : String(error));
    }
  }, [api, setConnection]);

  const dispatchCommand = useCallback(async (input: { command: string; payload?: Record<string, Json>; commandId?: string; retryUnknown?: boolean; attempt?: number }): Promise<Command | undefined> => {
    const session = stateRef.current.session;
    if (!api || !session) return undefined;
    const attempt = input.attempt ?? 1;
    let record;
    try {
      if (input.retryUnknown && input.commandId) {
        record = ledgerRef.current.retryUnknown(input.commandId, true);
      } else {
        record = ledgerRef.current.create({ commandId: input.commandId, incarnation: session.incarnation, command: input.command, payload: input.payload });
      }
    } catch (error) {
      Alert.alert("Command unavailable", error instanceof Error ? error.message : String(error));
      return undefined;
    }
    dispatch({ type: "command_created", command: { commandId: record.commandId, incarnation: record.incarnation, command: record.command, payload: record.payload } });
    ledgerRef.current.mark(record.commandId, "sent");
    dispatch({ type: "command_status", commandId: record.commandId, status: "sent" });
    try {
      const command = await api.sendCommand(session.id, ledgerRef.current.request(record.commandId));
      ledgerRef.current.absorb(command);
      dispatch({ type: "command_result", command });
      if (command.status === "outcome_unknown") setConnection("unknown", command.error);
      else if (command.status === "acknowledged" || command.status === "claimed") setConnection("running");
      else await catchUp(session.id);
      if (input.command === "set_thinking_level" && (command.status === "completed" || command.status === "acknowledged")) {
        void refreshOmpState();
      }
      if (input.command === "login" && (command.status === "completed" || command.status === "acknowledged" || command.status === "claimed")) {
        void loadLoginProviders();
      }
      return command;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const plan = commandFailurePlan(error, attempt);
      if (plan === "refresh_and_retry") {
        // The host refuses a stale or still-starting session before claiming the
        // command, so nothing was dispatched. Mark the row honestly, re-read the
        // incarnation the host now holds, and resend once with a fresh command id.
        ledgerRef.current.mark(record.commandId, "not_dispatched", message);
        dispatch({ type: "command_status", commandId: record.commandId, status: "not_dispatched", error: message });
        let fresh: Session | undefined;
        try {
          fresh = await api.getSession(session.id);
        } catch {
          fresh = undefined;
        }
        if (fresh) {
          dispatch({ type: "session_refresh", session: fresh });
          return await dispatchCommand({ command: input.command, payload: input.payload, attempt: attempt + 1 });
        }
        // The refresh failed; fall through to the unknown path with the original error.
      } else if (plan === "surface_recovery") {
        ledgerRef.current.mark(record.commandId, "not_dispatched", message);
        dispatch({ type: "command_status", commandId: record.commandId, status: "not_dispatched", error: message });
        try {
          dispatch({ type: "session_refresh", session: await api.getSession(session.id) });
        } catch {
          // Keep the host's copy; the Reconcile card appears from the next session read.
        }
        setConnection("unknown", message);
        return undefined;
      }
      ledgerRef.current.markUnknown(record.commandId, message);
      dispatch({ type: "command_status", commandId: record.commandId, status: "unknown", error: message });
      setConnection("unknown", "The command outcome is unknown. Retry only from its card.");
      return undefined;
    }
  }, [api, catchUp, loadLoginProviders, refreshOmpState, setConnection]);

  const sendPrompt = useCallback(() => {
    if (syncing) return;
    const current = stateRef.current;
    const controls = iosComposerHonesty(current);
    if (controls.primary === "check_status" || controls.primary === "choose_project") return;
    if (!controls.primaryEnabled || !controls.sendIntent) return;
    const message = sanitizeText(current.draft);
    if (!message) return;
    const sessionId = current.session?.id;
    draftPersistPausedRef.current = true;
    if (draftPersistTimerRef.current) {
      clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = null;
    }
    dispatch({ type: "draft", draft: "" });
    void (async () => {
      const command = await dispatchCommand({
        command: controls.sendIntent === "follow_up" ? "follow_up" : "prompt",
        payload: { message },
      });
      const accepted = command && (command.status === "completed" || command.status === "acknowledged" || command.status === "claimed");
      if (accepted && sessionId) {
        await clearStoredDraft(sessionId);
      } else if (sessionId) {
        if (stateRef.current.session?.id === sessionId && stateRef.current.draft === "") dispatch({ type: "draft", draft: current.draft });
        await writeStoredDraft(sessionId, current.draft);
      }
      draftPersistPausedRef.current = false;
    })();
  }, [dispatchCommand, syncing]);

  const sendTerminalInput = useCallback((identity: VirtualTerminalIdentity, data: string) => {
    if (syncing) return;
    const current = stateRef.current;
    const terminal = current.virtualTerminals.find(item => item.terminalId === identity.terminalId);
    if (!current.session || current.session.id !== identity.sessionId || current.session.incarnation !== identity.incarnation || !terminal || terminal.closed) return;
    try {
      const command = terminalInputCommand(identity.terminalId, data);
      void dispatchCommand(command);
    } catch (error) {
      Alert.alert("Terminal input unavailable", error instanceof Error ? error.message : String(error));
    }
  }, [dispatchCommand, syncing]);

  const sendTerminalResize = useCallback((identity: VirtualTerminalIdentity, cols: number, rows: number) => {
    const current = stateRef.current;
    const terminal = current.virtualTerminals.find(item => item.terminalId === identity.terminalId);
    if (!current.session || current.session.id !== identity.sessionId || current.session.incarnation !== identity.incarnation || !terminal || terminal.closed) return;
    try {
      const command = terminalResizeCommand(identity.terminalId, cols, rows);
      void dispatchCommand(command);
    } catch (error) {
      Alert.alert("Terminal resize unavailable", error instanceof Error ? error.message : String(error));
    }
  }, [dispatchCommand]);

  const sendTerminalNegotiate = useCallback((identity: VirtualTerminalIdentity, cols: number, rows: number) => {
    const current = stateRef.current;
    const terminal = current.virtualTerminals.find(item => item.terminalId === identity.terminalId);
    if (!current.session || current.session.id !== identity.sessionId || current.session.incarnation !== identity.incarnation || !terminal || terminal.closed) return;
    try {
      // Negotiation has no terminalId by design: OMP owns the single virtual
      // terminal for the negotiated session. The identity guard above keeps a
      // stale WebView from negotiating a newer session/incarnation.
      const command = terminalNegotiateCommand(cols, rows);
      void dispatchCommand(command);
    } catch (error) {
      Alert.alert("Terminal recovery unavailable", error instanceof Error ? error.message : String(error));
    }
  }, [dispatchCommand]);

  /**
   * The host's headless screen for one terminal, used when the app's bounded history was
   * trimmed. Failures stay silent on purpose: without a checkpoint the renderer keeps its
   * existing recovery path and asks OMP to redraw.
   */
  const loadTerminalCheckpoint = useCallback(async (identity: VirtualTerminalIdentity): Promise<TerminalCheckpoint | undefined> => {
    const current = stateRef.current;
    if (!api || !current.session || current.session.id !== identity.sessionId || current.session.incarnation !== identity.incarnation) return undefined;
    try {
      const checkpoints = await api.getTerminalCheckpoints(identity.sessionId);
      return checkpoints.find(item => item.terminalId === identity.terminalId);
    } catch {
      return undefined;
    }
  }, [api]);

  const sendUiResponse = useCallback(async (request: PendingUiRequest, answer: UiResponseRequest["answer"]) => {
    if (syncing) return;
    const session = stateRef.current.session;
    if (!api || !session) return;
    const commandId = createCommandId("ui");
    const body: UiResponseRequest = { commandId, incarnation: session.incarnation, token: request.token, answer };
    dispatch({ type: "command_created", command: { commandId, incarnation: session.incarnation, command: "ui_response", payload: jsonRecord({ token: request.token, answer }) } });
    try {
      const command = await api.sendUiResponse(session.id, body);
      dispatch({ type: "ui_resolved", token: request.token });
      if (command) dispatch({ type: "command_result", command });
    } catch (error) {
      dispatch({ type: "command_status", commandId, status: "unknown", error: error instanceof Error ? error.message : String(error) });
      Alert.alert("Response unavailable", "The interaction may still be pending on the Mac. Refresh before answering again.");
    }
  }, [api, syncing]);

  const toggleProjectPinned = useCallback(async (project: Project) => {
    dispatch({ type: "projects", projects: stateRef.current.projects.map(item => item.id === project.id ? { ...item, pinned: !item.pinned } : item) });
    if (api) {
      try { await api.patchProject(project.id, { pinned: !project.pinned }); } catch (error) { setConnection("offline", error instanceof Error ? error.message : String(error)); }
    }
  }, [api, setConnection]);

  const toggleProjectArchived = useCallback(async (project: Project) => {
    dispatch({ type: "projects", projects: stateRef.current.projects.map(item => item.id === project.id ? { ...item, archived: !item.archived } : item) });
    if (api) {
      try { await api.patchProject(project.id, { archived: !project.archived }); } catch (error) { setConnection("offline", error instanceof Error ? error.message : String(error)); }
    }
  }, [api, setConnection]);

  const toggleSessionArchived = useCallback(async (session: Session) => {
    dispatch({ type: "sessions", sessions: stateRef.current.sessions.map(item => item.id === session.id ? { ...item, archived: !item.archived } : item) });
    if (api) {
      try { await api.patchSession(session.id, { archived: !session.archived }); } catch (error) { setConnection("offline", error instanceof Error ? error.message : String(error)); }
    }
  }, [api, setConnection]);

  const toggleSessionPinned = useCallback(async (session: Session) => {
    dispatch({ type: "sessions", sessions: stateRef.current.sessions.map(item => item.id === session.id ? { ...item, pinned: !item.pinned } : item) });
    if (api) {
      try { await api.patchSession(session.id, { pinned: !session.pinned }); } catch (error) { setConnection("offline", error instanceof Error ? error.message : String(error)); }
    }
  }, [api, setConnection]);

  const openLoginUrl = useCallback(async (url: string) => {
    if (!isSafeExternalUrl(url)) {
      Alert.alert("Link blocked", "Cedia only opens http or https login URLs.");
      return;
    }
    try {
      const allowed = await Linking.canOpenURL(url);
      if (!allowed) {
        Alert.alert("Cannot open link", url);
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert("Cannot open link", error instanceof Error ? error.message : String(error));
    }
  }, []);

  const importOffer = useCallback(async (offer: PairingOffer) => {
    try {
      if (isLegacyRelayPairingOffer(offer)) {
        // Migration records are deliberately retained for the owner, but the
        // selected transport cannot be activated from an old Paseo offer.
        if (Platform.OS !== "web") await savePairingSecrets(secretStore, offer);
        setPairedOffer(offer);
        setPairedTransport(undefined);
        setPairingRevoked(false);
        setShowPairing(false);
        Alert.alert("Legacy relay retained", "This Paseo relay pairing is kept for migration but stays inactive. Pair this Mac again through its Tailscale gateway.");
        return;
      }
      const gateway = offer as CediaGatewayPairingOffer;
      const enrollment = await redeemGatewayEnrollment({
        endpoint: gateway.gatewayOrigin,
        code: gateway.enrollmentCode,
        pin: gateway.enrollmentPin,
        name: Platform.OS === "web" ? "Cedia web" : "Cedia iPhone",
        web: Platform.OS === "web",
      });
      if (Platform.OS !== "web") {
        await savePairingSecrets(secretStore, gateway, {
          deviceId: enrollment.deviceId,
          deviceToken: enrollment.deviceToken,
          gatewayCsrf: enrollment.csrf,
        });
      }
      setPairedOffer({ ...gateway, enrollmentCode: undefined, enrollmentPin: undefined });
      if (Platform.OS === "web") setPairedTransport(createWebGatewayTransport());
      else setPairedTransport(createNativeGatewayTransport({ endpoint: gateway.gatewayOrigin, token: enrollment.deviceToken }));
      setPairingRevoked(false);
      setShowPairing(false);
      Alert.alert("Mac paired", `${pairingTransportLabel(gateway)} · ${gateway.gatewayOrigin}. Your controller credential stays protected on this device.`);
    } catch (error) {
      const message = error instanceof GatewayEnrollmentError ? error.message : error instanceof Error ? error.message : String(error);
      Alert.alert("Pairing failed", message);
    }
  }, [secretStore]);

  const revokePairedMac = useCallback(async () => {
    const offer = pairedOffer;
    if (!offer) return;
    try {
      await revokePairing(secretStore, offer.serverId);
      setPairedTransport(undefined);
      setPairedOffer(null);
      setPairingRevoked(true);
      setShowPairing(false);
      setConnection("offline");
    } catch (error) {
      Alert.alert("Revoke unavailable", error instanceof Error ? error.message : String(error));
    }
  }, [pairedOffer, secretStore, setConnection]);

  const activeUi = state.uiRequests[0];
  const selectedProject = state.project ?? state.projects[0] ?? null;
  const projectSessions = state.sessions.filter(session => session.projectId === selectedProject?.id);

  return (
    <PresentationContext.Provider value={presentation}>
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}> 
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>⌁</Text></View>
          <View><Text style={styles.brand}>Cedia</Text><Text style={styles.brandCaption}>your work, in motion</Text></View>
        </View>
        <Pressable onPress={() => setShowPairing(true)} accessibilityRole="button" accessibilityLabel="Open Mac connection">
          <View style={styles.connectionPill}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(state.connection, palette) }]} />
            <Text style={styles.connectionText}>{connectionBadgeLabel(state.connection, { syncing, lastKnownAt: state.cacheSavedAt })}</Text>
          </View>
        </Pressable>
      </View>

      {state.session ? (
        <TaskDetail
          state={state}
          styles={styles}
          palette={palette}
          busy={busy}
          syncing={syncing}
          onBack={() => {
            persistOutgoingDraft(stateRef.current.session?.id, stateRef.current.draft);
            dispatch({ type: "session", session: null });
          }}
          onStart={startSession}
          onReconcile={reconcileSession}
          onSendPrompt={sendPrompt}
          onDraft={draft => dispatch({ type: "draft", draft })}
          onCommand={command => {
            if (!iosComposerAllowsCommand(iosComposerHonesty(stateRef.current), command.command)) return;
            void dispatchCommand(command);
          }}
          onOpenModels={() => { void loadModelCatalog(); }}
          onOpenLogin={() => { void loadLoginProviders(); }}
          onStartLogin={providerId => { void dispatchCommand({ command: "login", payload: { providerId } }); }}
          onOpenLoginUrl={url => { void openLoginUrl(url); }}
          onOpenArtifacts={openArtifacts}
          onOpenFileEditor={() => setShowFileEditor(true)}
          onOpenReview={() => setShowReview(true)}
          hasMoreEvents={state.hasMoreEvents}
          onLoadMore={() => { const sessionId = state.session?.id; if (sessionId) void catchUp(sessionId); }}
          onSelectModel={model => {
            if (!modelOptionSelectable(model)) { Alert.alert("Model unavailable", typeof model.reason === "string" && model.reason.trim() ? model.reason : IOS_COMPOSER_MODEL_UNAVAILABLE); return; }
            if (!model.provider) { Alert.alert("Model unavailable", "OMP did not provide a provider id for this model."); return; }
            setShowModelPicker(false);
            void dispatchCommand({ command: "set_model", payload: { provider: model.provider, modelId: model.id } });
          }}
          models={state.models}
          showModelPicker={showModelPicker}
          setShowModelPicker={setShowModelPicker}
          showLoginPicker={showLoginPicker}
          setShowLoginPicker={setShowLoginPicker}
          thinking={thinking}
          parentSession={parentSession}
          showThinkingPicker={showThinkingPicker}
          setShowThinkingPicker={setShowThinkingPicker}
          onSelectThinking={level => {
            if (!thinking.options.some(item => item.id === level && item.enabled)) {
              Alert.alert("Thinking", thinking.reason || THINKING_NOT_ADVERTISED);
              return;
            }
            setShowThinkingPicker(false);
            void dispatchCommand({ command: "set_thinking_level", payload: { level } });
          }}
          onTerminalInput={sendTerminalInput}
          onTerminalResize={sendTerminalResize}
          onTerminalNegotiate={sendTerminalNegotiate}
          onTerminalCheckpoint={loadTerminalCheckpoint}
        />
      ) : (
        <Dashboard
          state={state}
          styles={styles}
          palette={palette}
          selectedView={selectedView}
          setSelectedView={setSelectedView}
          selectedProject={selectedProject}
          projectSessions={projectSessions}
          owners={state.owners}
          ownersTruncated={state.ownersTruncated}
          onOpenOwner={openOwner}
          onAttachOwner={attachOwner}
          onSelectProject={selectProject}
          onSearch={query => dispatch({ type: "search", query })}
          onShowArchived={() => dispatch({ type: "show_archived", value: !stateRef.current.showArchived })}
          onSelectSession={selectSession}
          onPinSession={toggleSessionPinned}
          onPinProject={toggleProjectPinned}
          onArchiveProject={toggleProjectArchived}
          onArchiveSession={toggleSessionArchived}
          onRefresh={() => {
            void refreshProjects(selectedProject?.id).then(() => {
              if (selectedView === "activity") void refreshActivityInbox();
            });
          }}
          onOpenPairing={() => setShowPairing(true)}
          onRevokePairing={() => void revokePairedMac()}
          onClearCache={() => {
            void clearSnapshotCache(cache).then(() => dispatch({ type: "cache_cleared" }));
          }}
          activityInbox={activityInbox}
          activityInboxError={activityInboxError}
          pairedOffer={pairedOffer}
          pairingRevoked={pairingRevoked}
          relayState={relayState}
          tasksScrollOffsetRef={tasksScrollOffsetRef}
        />
      )}
      {pairedOffer && !transport && !pairedTransport ? <Text style={styles.pairedHint}>Mac paired · connecting securely…</Text> : null}
      {activeUi ? <UiSheet request={activeUi} sessionId={state.session?.id} incarnation={state.session?.incarnation} connection={state.connection} syncing={syncing} styles={styles} palette={palette} visible={uiSheetOpen} onClose={() => setUiSheetOpen(false)} onAnswer={answer => void sendUiResponse(activeUi, answer)} /> : null}
      {state.session ? <ReviewSheet visible={showReview} styles={styles} session={state.session} api={api} onClose={() => setShowReview(false)} /> : null}
      {state.session ? <FileEditorSheet visible={showFileEditor} styles={styles} session={state.session} onClose={() => setShowFileEditor(false)} /> : null}
      {artifactSession ? <ArtifactSheet visible={showArtifacts} styles={styles} palette={palette} session={state.session && state.session.id === artifactSession.id ? state.session : null} artifacts={artifacts} loading={artifactBusy} error={artifactError} onClose={closeArtifacts} onRefresh={() => void refreshArtifacts(artifactSession)} onCapture={() => setShowArtifactCapture(true)} onSelect={receipt => setArtifactViewer(receipt)} /> : null}
      {artifactSession ? <ArtifactCaptureSheet visible={showArtifactCapture} styles={styles} palette={palette} loading={artifactBusy} error={artifactError} onClose={() => setShowArtifactCapture(false)} onSubmit={(path, sourcePaths) => void captureArtifact(path, sourcePaths)} /> : null}
      {artifactSession && artifactViewer ? <ArtifactViewer visible={Boolean(artifactViewer)} styles={styles} palette={palette} api={api} receipt={artifactViewer} target={artifactSession} isCurrent={artifactTargetIsCurrent} onClose={() => setArtifactViewer(null)} /> : null}
      <PairingSheet visible={showPairing} styles={styles} palette={palette} onClose={() => setShowPairing(false)} onImport={offer => void importOffer(offer)} />
    </View>
    </PresentationContext.Provider>
  );
}

function Dashboard(props: {
  state: MobileTaskState;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  selectedView: MobileInboxView;
  setSelectedView: (value: MobileInboxView) => void;
  selectedProject: Project | null;
  projectSessions: readonly Session[];
  owners: readonly OwnerEntry[];
  ownersTruncated: boolean;
  onOpenOwner: (taskId: string) => void;
  onAttachOwner: (taskId: string) => void;
  onSelectProject: (project: Project) => void;
  onSearch: (query: string) => void;
  onShowArchived: () => void;
  onSelectSession: (session: Session) => void;
  onPinSession: (session: Session) => void;
  onPinProject: (project: Project) => void;
  onArchiveProject: (project: Project) => void;
  onArchiveSession: (session: Session) => void;
  onRefresh: () => void;
  onOpenPairing: () => void;
  onRevokePairing: () => void;
  onClearCache: () => void;
  activityInbox: readonly ActivityInboxItem[];
  activityInboxError?: string;
  pairedOffer: PairingOffer | null;
  pairingRevoked: boolean;
  relayState?: RelayReachabilityState;
  tasksScrollOffsetRef: { current: number };
}) {
  const { state, styles, palette } = props;
  const [activityFilter, setActivityFilter] = useState("all");
  const activityChips = activityInboxFilterChips(props.activityInbox, state.sessions);
  const visibleInbox = activityFilter === "all"
    ? props.activityInbox
    : activityInboxForSession(props.activityInbox, activityFilter);
  const activityChipIds = activityChips.map(chip => chip.sessionId).join("\0");
  useEffect(() => {
    if (activityFilter !== "all" && !activityChipIds.split("\0").includes(activityFilter)) {
      setActivityFilter("all");
    }
  }, [activityChipIds, activityFilter]);
  const tasksScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (props.selectedView !== "tasks") return;
    const y = props.tasksScrollOffsetRef.current;
    const frame = requestAnimationFrame(() => {
      tasksScrollRef.current?.scrollTo({ y, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.selectedView, props.tasksScrollOffsetRef]);
  const projects = state.projects.filter(project => state.showArchived || !project.archived).filter(project => {
    const q = state.searchQuery.trim().toLowerCase();
    return !q || `${project.name} ${project.path}`.toLowerCase().includes(q);
  });
  const discoverableOwners = props.owners.filter(isDiscoverableOwner);
  const sessions = props.projectSessions.filter(session => state.showArchived || !session.archived).filter(session => {
    const q = state.searchQuery.trim().toLowerCase();
    return !q || session.title.toLowerCase().includes(q);
  });
  return (
    <View style={styles.dashboardRoot}>
      <ScrollView
        ref={tasksScrollRef}
        style={styles.dashboardScroll}
        contentContainerStyle={styles.dashboard}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={event => {
          if (props.selectedView === "tasks") props.tasksScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>MAC WORKSPACE</Text>
          <Text style={styles.heroTitle}>Keep the thread.</Text>
          <Text style={styles.heroBody}>Continue the same OMP session from the desk or the road.</Text>
        </View>
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput value={state.searchQuery} onChangeText={props.onSearch} placeholder="Search projects and tasks" placeholderTextColor={palette.muted} style={styles.searchInput} accessibilityLabel="Search projects and tasks" />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>{props.selectedView === "activity" ? "Activity" : props.selectedView === "settings" ? "Settings" : "Tasks"}</Text>
          <View style={styles.rowGap}>
            <Pressable onPress={props.onShowArchived} accessibilityRole="button"><Text style={styles.linkText}>{state.showArchived ? "Hide archived" : "Show archived"}</Text></Pressable>
            <Pressable onPress={props.onRefresh} accessibilityRole="button" accessibilityLabel="Refresh workspace"><Text style={styles.refresh}>↻</Text></Pressable>
          </View>
        </View>
        {props.selectedView === "activity" ? (
          <>
            <View style={styles.prefRow}>
              {activityChips.map(chip => (
                <Pressable
                  key={chip.sessionId}
                  onPress={() => setActivityFilter(chip.sessionId)}
                  style={[styles.prefChip, { minHeight: 44 }, activityFilter === chip.sessionId && styles.prefChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activityFilter === chip.sessionId }}
                  accessibilityLabel={chip.sessionId === "all" ? "All activity" : `Activity for ${chip.label}`}
                >
                  <Text style={[styles.prefChipText, activityFilter === chip.sessionId && styles.prefChipTextActive]}>{chip.label}</Text>
                </Pressable>
              ))}
            </View>
            {visibleInbox.length ? (
              <>
                <Text style={styles.sectionTitle}>Needs your input</Text>
                {props.activityInboxError ? <Text style={styles.errorText}>{props.activityInboxError}</Text> : null}
                {visibleInbox.map(item => (
                  <ActivityRequestCard key={activityInboxItemKey(item)} item={item} sessions={state.sessions} styles={styles} onOpenSession={props.onSelectSession} />
                ))}
              </>
            ) : (
              <EmptyState styles={styles} palette={palette} title="No activity" body={props.activityInboxError ? props.activityInboxError : state.connection === "offline" ? hostReachabilityCopy(state.connection, props.relayState) : "Unanswered requests and unknown outcomes from the same Mac session appear here."} onAction={props.onOpenPairing} action="Mac connection" />
            )}
          </>
        ) : props.selectedView === "settings" ? (
          <SettingsPanel styles={styles} palette={palette} connection={state.connection} relayState={props.relayState} cacheSavedAt={state.cacheSavedAt} cacheFresh={isCacheFresh(state)} onOpenPairing={props.onOpenPairing} onRevokePairing={props.onRevokePairing} onClearCache={props.onClearCache} pairedOffer={props.pairedOffer} pairingRevoked={props.pairingRevoked} />
        ) : (
          <>
            {projects.length ? projects.map(project => <ProjectCard key={project.id} project={project} styles={styles} palette={palette} selected={project.id === props.selectedProject?.id} onSelect={() => props.onSelectProject(project)} onPin={() => props.onPinProject(project)} onArchive={() => props.onArchiveProject(project)} />) : state.projects.length ? <EmptyState styles={styles} palette={palette} title="No matching projects" body="No project matches this search." onAction={props.onOpenPairing} action="Connect your Mac" /> : null}
            {props.selectedProject ? (sessions.length ? sessions.map(session => <SessionCard key={session.id} session={session} styles={styles} palette={palette} onSelect={() => props.onSelectSession(session)} onPin={() => props.onPinSession(session)} onArchive={() => props.onArchiveSession(session)} />) : <EmptyState styles={styles} palette={palette} title="No tasks in this project" body="Start a session on your Mac to see it here." onAction={props.onOpenPairing} action="Connect your Mac" />) : null}
            {discoverableOwners.length ? (<><Text style={styles.sectionTitle}>Elsewhere on this Mac</Text>{discoverableOwners.map(entry => <OwnerCard key={entry.taskId} entry={entry} styles={styles} palette={palette} onOpen={() => props.onOpenOwner(entry.taskId)} onAttach={() => props.onAttachOwner(entry.taskId)} />)}{props.ownersTruncated ? <Text style={styles.cardSubtitle}>Older tasks are hidden; the list is capped.</Text> : null}</>) : null}
          </>
        )}
        {!state.projects.length && !props.state.lastError ? <View style={styles.unavailable}><Text style={styles.unavailableTitle}>Waiting for your Mac</Text><Text style={styles.unavailableBody}>Pair your Mac to continue the same workspace from this phone.</Text><Pressable onPress={props.onOpenPairing} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Open connection</Text></Pressable></View> : null}
        {state.lastError ? <Text style={styles.errorText}>{state.lastError}</Text> : null}
      </ScrollView>
      <View style={styles.bottomNav} accessibilityRole="tablist">
        <Pressable onPress={() => props.setSelectedView("tasks")} style={styles.bottomNavItem} accessibilityRole="tab" accessibilityState={{ selected: props.selectedView === "tasks" }} accessibilityLabel="Tasks"><Text style={[styles.bottomNavText, props.selectedView === "tasks" && styles.bottomNavTextActive]}>Tasks</Text></Pressable>
        <Pressable onPress={() => props.setSelectedView("activity")} style={styles.bottomNavItem} accessibilityRole="tab" accessibilityState={{ selected: props.selectedView === "activity" }} accessibilityLabel="Activity"><Text style={[styles.bottomNavText, props.selectedView === "activity" && styles.bottomNavTextActive]}>Activity</Text></Pressable>
        <Pressable onPress={() => props.setSelectedView("settings")} style={styles.bottomNavItem} accessibilityRole="tab" accessibilityState={{ selected: props.selectedView === "settings" }} accessibilityLabel="Settings"><Text style={[styles.bottomNavText, props.selectedView === "settings" && styles.bottomNavTextActive]}>Settings</Text></Pressable>
      </View>
    </View>
  );
}

function ProjectCard(props: { project: Project; styles: ReturnType<typeof makeStyles>; palette: Palette; selected?: boolean; compact?: boolean; onSelect: () => void; onPin: () => void; onArchive: () => void }) {
  const { project, styles, palette } = props;
  return <View style={[styles.card, props.selected && styles.cardSelected, props.compact && styles.cardCompact]}><Pressable onPress={props.onSelect} style={styles.cardMain} accessibilityRole="button" accessibilityLabel={`Open project ${project.name}`}><View style={styles.projectGlyph}><Text style={styles.projectGlyphText}>{project.name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.cardCopy}><Text style={styles.cardTitle} numberOfLines={1}>{project.name}</Text><Text style={styles.cardSubtitle} numberOfLines={1}>{project.path}</Text></View></Pressable><View style={styles.cardActions}><Pressable onPress={props.onPin} accessibilityRole="button" accessibilityLabel={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}><Text style={[styles.actionIcon, project.pinned && { color: palette.accent }]}>{project.pinned ? "★" : "☆"}</Text></Pressable><Pressable onPress={props.onArchive} accessibilityRole="button" accessibilityLabel={project.archived ? `Restore ${project.name}` : `Archive ${project.name}`}><Text style={styles.actionIcon}>{project.archived ? "↩" : "…"}</Text></Pressable></View></View>;
}

function SessionCard(props: { session: Session; styles: ReturnType<typeof makeStyles>; palette: Palette; onSelect: () => void; onPin: () => void; onArchive: () => void }) {
  const { session, styles, palette } = props;
  const running = session.status === "running";
  return <View style={styles.card}><Pressable onPress={props.onSelect} style={styles.cardMain} accessibilityRole="button" accessibilityLabel={`Open task ${session.title}`}><View style={[styles.taskGlyph, { backgroundColor: running ? palette.accentSoft : palette.elevated }]}><Text style={[styles.taskGlyphText, { color: running ? palette.accent : palette.muted }]}>{running ? "•" : "›"}</Text></View><View style={styles.cardCopy}><Text style={styles.cardTitle} numberOfLines={1}>{session.title}</Text><Text style={styles.cardSubtitle}>{running ? "Working now" : session.status === "recovery_required" ? "Needs reconciliation" : `Updated ${formatRelativeTime(session.updatedAt)}`}</Text></View></Pressable><View style={styles.cardActions}><Pressable onPress={props.onPin} accessibilityRole="button" accessibilityLabel={session.pinned ? `Unpin ${session.title}` : `Pin ${session.title}`}><Text style={[styles.actionIcon, session.pinned && { color: palette.accent }]}>{session.pinned ? "★" : "☆"}</Text></Pressable><Pressable onPress={props.onArchive} accessibilityRole="button" accessibilityLabel={session.archived ? "Restore task" : "Archive task"}><Text style={styles.actionIcon}>{session.archived ? "↩" : "…"}</Text></Pressable></View></View>;
}

function OwnerCard(props: { entry: OwnerEntry; styles: ReturnType<typeof makeStyles>; palette: Palette; onOpen: () => void; onAttach: () => void }) {
  const { styles, palette } = props;
  const presentation = ownerRowPresentation(props.entry);
  return <View style={styles.card}><Pressable onPress={props.onOpen} style={styles.cardMain} accessibilityRole="button" accessibilityLabel={`Open task ${props.entry.title}`}><View style={[styles.taskGlyph, { backgroundColor: palette.accentSoft }]}><Text style={[styles.taskGlyphText, { color: palette.accent }]}>◈</Text></View><View style={styles.cardCopy}><Text style={styles.cardTitle} numberOfLines={1}>{props.entry.title}</Text><Text style={styles.cardSubtitle}>{presentation.badge} · {presentation.detail}</Text></View></Pressable>{presentation.canAttach ? <View style={styles.cardActions}><Pressable onPress={props.onAttach} accessibilityRole="button" accessibilityLabel={`Attach ${props.entry.title} here`}><Text style={styles.actionIcon}>⎘</Text></Pressable></View> : null}</View>;
}

function EmptyState(props: { styles: ReturnType<typeof makeStyles>; palette: Palette; title: string; body: string; action: string; onAction: () => void }) {
  return <View style={props.styles.empty}><View style={props.styles.emptyMark}><Text style={props.styles.emptyMarkText}>⌁</Text></View><Text style={props.styles.emptyTitle}>{props.title}</Text><Text style={props.styles.emptyBody}>{props.body}</Text><Pressable onPress={props.onAction} style={props.styles.secondaryButton}><Text style={props.styles.secondaryButtonText}>{props.action}</Text></Pressable></View>;
}

function ActivityRequestCard(props: {
  item: ActivityInboxItem;
  sessions: readonly Session[];
  styles: ReturnType<typeof makeStyles>;
  onOpenSession: (session: Session) => void;
}) {
  const title = activityInboxTitle(props.item);
  const session = sessionForInboxItem(props.item, props.sessions);
  const body = activityInboxBody(props.item, session?.title);
  return (
    <Pressable
      onPress={() => {
        if (activityInboxTapAnswersRequest(props.item)) return;
        const tap = activityInboxTapAction(props.item);
        if (tap.type !== "open_session" || !session || session.id !== tap.sessionId) return;
        props.onOpenSession(session);
      }}
      style={props.styles.unavailable}
      accessibilityRole="button"
      accessibilityState={{ disabled: !session }}
      accessibilityLabel={session ? `Open matching task for ${title}` : `${title}. This request cannot be routed.`}
    >
      <Text style={props.styles.unavailableTitle}>{title}</Text>
      <Text style={props.styles.unavailableBody}>{body}</Text>
    </Pressable>
  );
}

function SettingsPanel(props: {
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  connection: MobileTaskState["connection"];
  relayState?: RelayReachabilityState;
  cacheSavedAt?: number;
  cacheFresh: boolean;
  onOpenPairing: () => void;
  onRevokePairing: () => void;
  onClearCache: () => void;
  pairedOffer: PairingOffer | null;
  pairingRevoked: boolean;
}) {
  const {
    appearancePrefs,
    applyAppearance,
    draftAppearance,
    resetAppearance,
    settingsApplyError,
    settingsResetPreview,
    settingsRevision,
    settingsSource,
  } = React.useContext(PresentationContext);
  const [openLabel, setOpenLabel] = useState<typeof SETTINGS_CATEGORIES[number]["label"] | null>(null);
  return (
    <View style={props.styles.settingsList}>
      {SETTINGS_CATEGORIES.map(category => {
        const open = openLabel === category.label;
        return (
          <View key={category.label} style={[props.styles.card, props.styles.settingsCard, open && props.styles.cardSelected]}>
            <Pressable
              onPress={() => setOpenLabel(open ? null : category.label)}
              style={props.styles.settingsRow}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={category.label}
            >
              <View style={props.styles.cardCopy}>
                <Text style={props.styles.cardTitle}>{category.label}</Text>
                {open ? null : <Text style={props.styles.cardSubtitle} numberOfLines={1}>{category.hint}</Text>}
              </View>
              <Text style={[props.styles.settingsChevron, { color: props.palette.muted }]}>{open ? "⌄" : "›"}</Text>
            </Pressable>
            {open ? (
              <View style={props.styles.settingsDetail}>
                <Text style={props.styles.unavailableBody}>{category.body}</Text>
                {"appearance" in category && category.appearance ? (
                  <>
                    <View style={props.styles.prefRow}>
                      {SETTINGS_SCOPES.map(scope => {
                        const writable = settingsScopeWritable(scope);
                        const label = scope === "global" ? "Global" : scope === "project" ? "Project" : "Session";
                        return (
                          <Pressable
                            key={scope}
                            disabled={!writable}
                            style={[props.styles.prefChip, writable && props.styles.prefChipActive, !writable && props.styles.buttonDisabled]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: writable, disabled: !writable }}
                            accessibilityLabel={label}
                            accessibilityHint={writable ? undefined : SETTINGS_APPLY_SCOPE_REASON}
                          >
                            <Text style={[props.styles.prefChipText, writable && props.styles.prefChipTextActive]}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={props.styles.cardSubtitle}>{`Effective · ${settingsSource} · revision ${String(settingsRevision)}`}</Text>
                    {settingsApplyError ? <Text style={props.styles.errorText}>{settingsApplyError}</Text> : null}
                    {settingsResetPreview ? (
                      <Text style={props.styles.cardSubtitle}>
                        {`Reset preview · ${settingsResetPreview.key} ${String(settingsResetPreview.current)} → ${String(settingsResetPreview.inherited)} removes ${settingsResetPreview.removes}`}
                      </Text>
                    ) : null}
                    <Text style={props.styles.cardSubtitle}>Conversation density is presentation-only. Errors and approvals stay visible.</Text>
                    <View style={props.styles.prefRow}>
                      <Pressable
                        onPress={() => draftAppearance({ density: "comfortable" })}
                        style={[props.styles.prefChip, appearancePrefs.density === "comfortable" && props.styles.prefChipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: appearancePrefs.density === "comfortable" }}
                        accessibilityLabel="Comfortable density"
                      >
                        <Text style={[props.styles.prefChipText, appearancePrefs.density === "comfortable" && props.styles.prefChipTextActive]}>Comfortable</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => draftAppearance({ density: "detailed" })}
                        style={[props.styles.prefChip, appearancePrefs.density === "detailed" && props.styles.prefChipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: appearancePrefs.density === "detailed" }}
                        accessibilityLabel="Detailed density"
                      >
                        <Text style={[props.styles.prefChipText, appearancePrefs.density === "detailed" && props.styles.prefChipTextActive]}>Detailed</Text>
                      </Pressable>
                    </View>
                    <View style={props.styles.prefSwitchRow}>
                      <View style={props.styles.cardCopy}>
                        <Text style={props.styles.cardTitle}>Reduce motion</Text>
                        <Text style={props.styles.cardSubtitle}>OS Reduce Motion stays in effect even if this is off.</Text>
                      </View>
                      <Switch
                        value={appearancePrefs.reduceMotion}
                        onValueChange={value => draftAppearance({ reduceMotion: value })}
                        accessibilityLabel="Reduce motion"
                      />
                    </View>
                    <View style={props.styles.prefSwitchRow}>
                      <View style={props.styles.cardCopy}>
                        <Text style={props.styles.cardTitle}>High contrast</Text>
                        <Text style={props.styles.cardSubtitle}>Stronger borders. This is presentation-only and does not start OMP.</Text>
                      </View>
                      <Switch
                        value={appearancePrefs.highContrast}
                        onValueChange={value => draftAppearance({ highContrast: value })}
                        accessibilityLabel="High contrast"
                      />
                    </View>
                    <View style={props.styles.prefRow}>
                      <Pressable onPress={applyAppearance} style={props.styles.primaryButton} accessibilityRole="button" accessibilityLabel="Apply">
                        <Text style={props.styles.primaryButtonText}>Apply</Text>
                      </Pressable>
                      <Pressable onPress={() => resetAppearance("density")} style={props.styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Reset density">
                        <Text style={props.styles.secondaryButtonText}>Reset density</Text>
                      </Pressable>
                      <Pressable onPress={() => resetAppearance("reduceMotion")} style={props.styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Reset reduceMotion">
                        <Text style={props.styles.secondaryButtonText}>Reset reduceMotion</Text>
                      </Pressable>
                      <Pressable onPress={() => resetAppearance("highContrast")} style={props.styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Reset highContrast">
                        <Text style={props.styles.secondaryButtonText}>Reset highContrast</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
                {"unavailable" in category && category.unavailable ? category.unavailable.map(item => (
                  <View key={item.label} style={props.styles.unavailableRow} accessibilityRole="text" accessibilityLabel={`${item.label} unavailable`}>
                    <Text style={props.styles.unavailableTitle}>{item.label}</Text>
                    <Text style={props.styles.unavailableBody}>Unavailable · {item.reason}</Text>
                  </View>
                )) : null}
                {"privacy" in category && category.privacy ? (
                  <>
                    <Text style={props.styles.cardTitle}>{lastSyncLabel({ cacheSavedAt: props.cacheSavedAt, fresh: props.cacheFresh })}</Text>
                    <Text style={props.styles.cardSubtitle}>Clears transcript snapshots on this phone. Pairing secrets stay.</Text>
                    <Pressable onPress={props.onClearCache} style={props.styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Clear cache">
                      <Text style={props.styles.secondaryButtonText}>Clear cache</Text>
                    </Pressable>
                  </>
                ) : null}
                {"pairing" in category && category.pairing ? (
                  <>
                    <Text style={props.styles.cardSubtitle}>{hostReachabilityCopy(props.connection, props.relayState)}</Text>
                    {props.pairedOffer ? (
                      <>
                        <Text style={props.styles.cardTitle}>{props.pairedOffer.serverId}</Text>
                        <Text style={props.styles.cardSubtitle}>{pairingTransportLabel(props.pairedOffer)}</Text>
                        <Text style={props.styles.cardSubtitle}>{isGatewayPairingOffer(props.pairedOffer) ? props.pairedOffer.gatewayOrigin : props.pairedOffer.relayEndpoint}</Text>
                        <Text style={props.styles.cardSubtitle}>{isLegacyRelayPairingOffer(props.pairedOffer) ? "Legacy relay records stay inert. Pair again through the Mac's Tailscale gateway to connect." : "Revoke deletes pairing secrets stored on this device. The Mac is not told — there is no host revoke receipt."}</Text>
                        <Pressable onPress={props.onRevokePairing} style={props.styles.denyButton} accessibilityRole="button" accessibilityLabel="Revoke pairing">
                          <Text style={props.styles.denyButtonText}>Revoke</Text>
                        </Pressable>
                      </>
                    ) : props.pairingRevoked ? (
                      <>
                        <Text style={props.styles.cardSubtitle}>Pairing secrets were deleted on this phone. Pair again to continue the same Mac workspace.</Text>
                        <Pressable onPress={props.onOpenPairing} style={props.styles.primaryButton} accessibilityRole="button" accessibilityLabel="Pair again">
                          <Text style={props.styles.primaryButtonText}>Pair again</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable onPress={props.onOpenPairing} style={props.styles.primaryButton} accessibilityRole="button" accessibilityLabel="Connect your Mac">
                        <Text style={props.styles.primaryButtonText}>Connect your Mac</Text>
                      </Pressable>
                    )}
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function TaskDetail(props: {
  state: MobileTaskState;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  busy: boolean;
  syncing: boolean;
  models: readonly ModelOption[];
  showModelPicker: boolean;
  setShowModelPicker: (value: boolean) => void;
  showLoginPicker: boolean;
  setShowLoginPicker: (value: boolean) => void;
  thinking: ThinkingParams;
  parentSession?: string;
  showThinkingPicker: boolean;
  setShowThinkingPicker: (value: boolean) => void;
  onSelectThinking: (level: string) => void;
  onBack: () => void;
  onStart: () => void;
  onReconcile: () => void;
  onSendPrompt: () => void;
  onDraft: (value: string) => void;
  onCommand: (input: { command: string; payload?: Record<string, Json> }) => void;
  onOpenModels: () => void;
  onOpenLogin: () => void;
  onStartLogin: (providerId: string) => void;
  onOpenLoginUrl: (url: string) => void;
  onOpenArtifacts: () => void;
  onOpenFileEditor: () => void;
  onOpenReview: () => void;
  hasMoreEvents: boolean;
  onLoadMore: () => void;
  onSelectModel: (model: ModelOption) => void;
  onTerminalInput: (identity: VirtualTerminalIdentity, data: string) => void;
  onTerminalResize: (identity: VirtualTerminalIdentity, cols: number, rows: number) => void;
  onTerminalNegotiate: (identity: VirtualTerminalIdentity, cols: number, rows: number) => void;
  onTerminalCheckpoint: (identity: VirtualTerminalIdentity) => Promise<TerminalCheckpoint | undefined>;
}) {
  const { state, styles, palette } = props;
  const { prefs } = React.useContext(PresentationContext);
  const session = state.session!;
  const inputRef = useRef<TextInput>(null);
  const transcriptRef = useRef<ScrollView>(null);
  const contentHeightRef = useRef(0);
  const transcriptCountRef = useRef(0);
  const [following, setFollowing] = useState(true);
  const [unread, setUnread] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [toolExpanded, setToolExpanded] = useState<Record<string, boolean>>({});
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const landscape = windowWidth > windowHeight;
  const compactComposer = windowHeight < 500 || landscape;
  const composerCap = Math.max(48, Math.round(windowHeight * 0.4));
  const [composerHeight, setComposerHeight] = useState(48);
  const [expandInput, setExpandInput] = useState(false);
  const expandAnimation = useModalAnimation("slide");
  const hasUnknown = Object.values(state.pendingCommands).some(command => command.status === "unknown");
  const composer = iosComposerHonesty(state);
  const workspace = taskHeaderWorkspace({ project: state.project, advertised: state.project });
  const workspaceLine = props.parentSession
    ? `${formatTaskHeaderWorkspace(workspace)} · parent ${props.parentSession}`
    : formatTaskHeaderWorkspace(workspace);
  const visibleTranscript = state.transcript.filter(entry => entry.kind !== "event" || entry.status === "failed");
  useEffect(() => {
    setFollowing(true);
    setUnread(0);
    setSelecting(false);
    setToolExpanded({});
    contentHeightRef.current = 0;
    transcriptCountRef.current = 0;
  }, [session.id]);
  return <KeyboardAvoidingView style={styles.detailRoot} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={10}>
    <View style={styles.detailHeader}><Pressable onPress={props.onBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to tasks"><Text style={styles.backText}>‹</Text></Pressable><View style={styles.detailTitleWrap}><Text style={styles.detailTitle} numberOfLines={1}>{session.title}</Text><Text style={styles.detailSubtitle} numberOfLines={2}>{workspaceLine}</Text>{session.status === "recovery_required" ? <Text style={styles.detailStatus}>Outcome needs review</Text> : null}</View><View style={styles.detailActions}><Pressable onPress={props.onOpenArtifacts} style={styles.artifactButton} accessibilityRole="button" accessibilityLabel="Open artifacts"><Text style={styles.artifactButtonText}>Files</Text></Pressable><Pressable onPress={props.onOpenFileEditor} style={styles.artifactButton} accessibilityRole="button" accessibilityLabel="Edit file"><Text style={styles.artifactButtonText}>Edit file</Text></Pressable><Pressable onPress={props.onOpenReview} style={styles.artifactButton} accessibilityRole="button" accessibilityLabel="Open review"><Text style={styles.artifactButtonText}>Review</Text></Pressable><Pressable onPress={props.onOpenLogin} style={styles.artifactButton} accessibilityRole="button" accessibilityLabel="OMP login"><Text style={styles.artifactButtonText}>Login</Text></Pressable><Pressable onPress={props.onOpenModels} disabled={!composer.modelEnabled || props.busy || props.syncing} style={[styles.modelButton, (!composer.modelEnabled || props.busy || props.syncing) && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel="Choose model" accessibilityState={{ disabled: !composer.modelEnabled || props.busy || props.syncing }} accessibilityHint={composer.modelReason}><Text style={styles.modelButtonText}>{state.selectedModel ?? "Model"}</Text><Text style={styles.modelChevron}>⌄</Text></Pressable><Pressable onPress={() => props.thinking.advertised ? props.setShowThinkingPicker(true) : Alert.alert("Thinking", props.thinking.reason || THINKING_NOT_ADVERTISED)} style={styles.modelButton} accessibilityRole="button" accessibilityLabel="Thinking level" accessibilityState={{ disabled: !props.thinking.advertised }}><Text style={styles.modelButtonText}>{props.thinking.current ?? "Thinking"}</Text><Text style={styles.modelChevron}>⌄</Text></Pressable></View></View>
    <ScrollView
      ref={transcriptRef}
      style={styles.transcript}
      contentContainerStyle={styles.transcriptContent}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={event => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        setFollowing(shouldFollowTranscript({
          distanceFromBottom: distanceFromBottom({
            contentHeight: contentSize.height,
            viewportHeight: layoutMeasurement.height,
            scrollOffset: contentOffset.y,
          }),
          selecting,
        }));
      }}
      onContentSizeChange={(_width, height) => {
        const grew = height > contentHeightRef.current;
        contentHeightRef.current = height;
        const appended = Math.max(0, visibleTranscript.length - transcriptCountRef.current);
        transcriptCountRef.current = visibleTranscript.length;
        if (following) {
          transcriptRef.current?.scrollToEnd({ animated: false });
          setUnread(0);
          return;
        }
        if (grew && appended > 0) setUnread(previous => nextUnreadCount({ following: false, previousUnread: previous, appended }));
      }}
    >
      {session.status === "recovery_required" ? <View style={styles.sessionStart}><Text style={styles.sessionStartTitle}>Review this session</Text><Text style={styles.sessionStartBody}>The Mac reported an unknown command outcome. Check the Mac first, then reconcile this session before starting it again.</Text><Pressable onPress={props.onReconcile} disabled={props.busy || props.syncing || state.connection === "offline"} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{props.busy ? "Reconciling…" : "Reconcile session"}</Text></Pressable></View> : null}
      {session.status !== "running" && session.status !== "recovery_required" && !state.transcript.length ? <View style={styles.sessionStart}><Text style={styles.sessionStartTitle}>Ready when you are</Text><Text style={styles.sessionStartBody}>This session runs on your Mac. Start it once, then continue from anywhere.</Text><Pressable onPress={props.onStart} disabled={props.busy || props.syncing || state.connection === "offline"} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{props.busy ? "Starting…" : "Start session"}</Text></Pressable></View> : null}
      <VirtualTerminalPanel sessionId={session.id} incarnation={session.incarnation} terminals={state.virtualTerminals} palette={palette} onInput={props.onTerminalInput} onResize={props.onTerminalResize} onNegotiate={props.onTerminalNegotiate} onLoadCheckpoint={props.onTerminalCheckpoint} />
      {visibleTranscript.map(entry => {
        const expanded = Object.prototype.hasOwnProperty.call(toolExpanded, entry.id)
          ? toolExpanded[entry.id] === true
          : toolCardDefaultExpanded(entry.toolStatus);
        return <TranscriptCard key={entry.id} entry={entry} styles={styles} palette={palette} density={prefs.density} expanded={expanded} onToggleExpand={() => setToolExpanded(current => ({ ...current, [entry.id]: !expanded }))} onSelectingChange={setSelecting} />;
      })}
      {hasUnknown ? <View style={styles.warningBanner}><Text style={styles.warningTitle}>Some command outcomes are unknown</Text><Text style={styles.warningBody}>Cedia will not replay them automatically. Inspect this command on the Mac, then Reconcile if the session needs review.</Text>{Object.values(state.pendingCommands).filter(command => command.status === "unknown").map(command => <Pressable key={command.commandId} onPress={() => session.status === "recovery_required" ? props.onReconcile() : Alert.alert("Inspect on Mac", "This command outcome is unknown. Cedia will not replay it automatically. Inspect it on the Mac, then Reconcile if the session needs review.")} style={styles.warningAction}><Text style={styles.warningActionText}>Inspect {command.command}</Text></Pressable>)}</View> : null}
      {props.hasMoreEvents ? <Pressable onPress={props.onLoadMore} style={styles.loadMore} accessibilityRole="button" accessibilityLabel="Load more events"><Text style={styles.loadMoreText}>Load more events</Text></Pressable> : null}
    </ScrollView>
    {!following ? <Pressable onPress={() => { setFollowing(true); setUnread(0); transcriptRef.current?.scrollToEnd({ animated: false }); }} style={styles.jumpToLatest} accessibilityRole="button" accessibilityLabel={jumpToLatestLabel(unread)}><Text style={styles.jumpToLatestText}>{jumpToLatestLabel(unread)}</Text></Pressable> : null}
    <View style={styles.composerBar}>
      <View style={styles.chipRow} accessibilityRole="text" accessibilityLabel={IOS_HOST_UPLOAD_COPY}>
        <Text style={styles.chipText}>{IOS_HOST_UPLOAD_COPY}</Text>
      </View>
      <View style={styles.composerRow}>
        <TextInput
          ref={inputRef}
          value={state.draft}
          onChangeText={props.onDraft}
          style={[styles.composerInput, compactComposer ? { minHeight: 44, maxHeight: 44 } : { minHeight: composerHeight, maxHeight: composerCap }]}
          onContentSizeChange={compactComposer ? undefined : event => setComposerHeight(Math.min(composerCap, Math.max(48, event.nativeEvent.contentSize.height)))}
          multiline={!compactComposer}
          blurOnSubmit={compactComposer}
          returnKeyType={compactComposer ? "done" : "default"}
          placeholder="Ask Cedia to continue…"
          placeholderTextColor={palette.muted}
          accessibilityLabel="Message Cedia"
        />
        <Pressable onPress={props.onSendPrompt} disabled={!composer.primaryEnabled || props.busy || props.syncing} style={[styles.sendButton, (!composer.primaryEnabled || props.busy || props.syncing) && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel={composer.primaryLabel} accessibilityState={{ disabled: !composer.primaryEnabled || props.busy || props.syncing }} accessibilityHint={composer.primaryReason}>
          <Text style={styles.sendText}>{composer.primary === "send" || composer.primary === "queue" ? "↑" : composer.primaryLabel}</Text>
        </Pressable>
      </View>
      <View style={styles.composerActions}>
        {compactComposer ? <Pressable onPress={() => setExpandInput(true)} style={styles.composerAction} accessibilityRole="button" accessibilityLabel="Expand input"><Text style={styles.composerActionText}>Expand input</Text></Pressable> : null}
        <Pressable onPress={() => props.onCommand({ command: "abort", payload: {} })} disabled={!composer.stopEnabled || props.busy || props.syncing} style={[styles.composerAction, (!composer.stopEnabled || props.busy || props.syncing) && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel={composer.stopLabel} accessibilityState={{ disabled: !composer.stopEnabled || props.busy || props.syncing }} accessibilityHint={composer.stopReason}><Text style={styles.composerActionText}>{composer.stopLabel}</Text></Pressable>
        <Pressable onPress={() => props.onCommand({ command: "steer", payload: { message: state.draft.trim() } })} disabled={!composer.steerEnabled || props.busy || props.syncing} style={[styles.composerAction, (!composer.steerEnabled || props.busy || props.syncing) && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel="Steer" accessibilityState={{ disabled: !composer.steerEnabled || props.busy || props.syncing }} accessibilityHint={composer.steerReason}><Text style={styles.composerActionText}>Steer</Text></Pressable>
        <Pressable onPress={() => props.onCommand({ command: "follow_up", payload: { message: state.draft.trim() } })} disabled={!composer.queueEnabled || props.busy || props.syncing} style={[styles.composerAction, (!composer.queueEnabled || props.busy || props.syncing) && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel="Queue" accessibilityState={{ disabled: !composer.queueEnabled || props.busy || props.syncing }} accessibilityHint={composer.queueReason}><Text style={styles.composerActionText}>Queue</Text></Pressable>
        <Pressable onPress={() => props.onCommand({ command: "compact", payload: {} })} disabled={state.connection === "offline" || props.busy || props.syncing} style={styles.composerAction} accessibilityRole="button"><Text style={styles.composerActionText}>Compact</Text></Pressable>
      </View>
      {composer.primaryReason ? <Text style={styles.composerReason} accessibilityRole="text" accessibilityLabel={composer.primaryReason}>{composer.primaryReason}</Text> : null}
      <Modal visible={expandInput} transparent animationType={expandAnimation} onRequestClose={() => setExpandInput(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Expand input</Text>
              <Pressable onPress={() => setExpandInput(false)} accessibilityRole="button" accessibilityLabel="Close expanded input"><Text style={styles.closeText}>×</Text></Pressable>
            </View>
            <TextInput
              value={state.draft}
              onChangeText={props.onDraft}
              style={[styles.composerInput, styles.expandedComposerInput, { maxHeight: composerCap }]}
              multiline
              blurOnSubmit={false}
              returnKeyType="default"
              placeholder="Ask Cedia to continue…"
              placeholderTextColor={palette.muted}
              accessibilityLabel="Message Cedia"
            />
            <View style={styles.uiActions}>
              <Pressable onPress={() => setExpandInput(false)} style={styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Done expanding input"><Text style={styles.secondaryButtonText}>Done</Text></Pressable>
              <Pressable onPress={() => { setExpandInput(false); props.onSendPrompt(); }} disabled={!composer.primaryEnabled || props.busy || props.syncing} style={[styles.primaryButton, (!composer.primaryEnabled || props.busy || props.syncing) && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel={composer.primaryLabel} accessibilityState={{ disabled: !composer.primaryEnabled || props.busy || props.syncing }} accessibilityHint={composer.primaryReason}><Text style={styles.primaryButtonText}>{composer.primaryLabel}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    <ModelPicker visible={props.showModelPicker} models={props.models} selected={state.selectedModel} styles={styles} palette={palette} onClose={() => props.setShowModelPicker(false)} onSelect={props.onSelectModel} onRefresh={props.onOpenModels} />
    <ThinkingPicker visible={props.showThinkingPicker} thinking={props.thinking} styles={styles} onClose={() => props.setShowThinkingPicker(false)} onSelect={props.onSelectThinking} />
    <LoginPicker visible={props.showLoginPicker} providers={state.loginProviders} presentations={state.presentations} styles={styles} palette={palette} onClose={() => props.setShowLoginPicker(false)} onRefresh={props.onOpenLogin} onStartLogin={props.onStartLogin} onOpenUrl={props.onOpenLoginUrl} />
  </KeyboardAvoidingView>;
}

/** React Native's iOS Text emits selection events at runtime; the bundled typings omit the prop. */
type TextSelectionEvent = { readonly nativeEvent: { readonly selection: { readonly start: number; readonly end: number } } };
const SelectionAwareText = Text as unknown as React.ComponentType<React.ComponentProps<typeof Text> & { onSelectionChange?: (event: TextSelectionEvent) => void }>;

function TranscriptCard(props: {
  entry: TranscriptEntry;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  density: ProductPrefs["density"];
  expanded: boolean;
  onToggleExpand: () => void;
  onSelectingChange: (selecting: boolean) => void;
}) {
  const { entry, styles, palette } = props;
  const markSelecting = (start: number, end: number) => props.onSelectingChange(end !== start);
  if (entry.kind === "tool") {
    const bodyText = [entry.args !== undefined ? (typeof entry.args === "object" && entry.args !== null ? JSON.stringify(entry.args, null, 2) : String(entry.args)) : "", entry.output ?? "", entry.text].filter(Boolean).join("\n");
    const body = toolCardBody({ text: bodyText, expanded: props.expanded, density: props.density });
    return <View style={styles.toolCard}><View style={styles.toolHeader}><Pressable onPress={props.onToggleExpand} style={styles.toolHeaderToggle} accessibilityRole="button" accessibilityLabel={`${props.expanded ? "Collapse" : "Expand"} ${entry.toolName ?? "Tool"}`}><View style={styles.toolIcon}><Text style={styles.toolIconText}>✦</Text></View><Text style={styles.toolName}>{entry.toolName ?? "Tool"}</Text><Text style={[styles.toolStatus, { color: entry.toolStatus === "failed" ? palette.danger : entry.toolStatus === "running" ? palette.warning : palette.success }]}>{entry.toolStatus ?? "unknown"}</Text></Pressable><Pressable onPress={() => { void Share.share({ message: toolCardCopyText(entry) }); }} accessibilityRole="button" accessibilityLabel="Copy"><Text style={styles.toolCopy}>Copy</Text></Pressable></View>{body.visible ? <SelectionAwareText style={[styles.toolOutput, props.expanded ? null : { maxHeight: TOOL_CARD_BODY_CAP_PX }]} numberOfLines={body.numberOfLines} selectable onSelectionChange={event => markSelecting(event.nativeEvent.selection.start, event.nativeEvent.selection.end)}>{body.visible}</SelectionAwareText> : null}</View>;
  }
  if (entry.kind === "event") return <View style={styles.eventRow}><Text style={styles.eventDot}>·</Text><Text style={styles.eventText}>{entry.text}</Text></View>;
  return <View style={[styles.messageCard, entry.role === "user" && styles.userMessage]}><Text style={styles.messageRole}>{entry.role === "user" ? "You" : entry.role === "system" ? "Cedia" : "Cedia"}</Text><SelectionAwareText style={styles.messageText} selectable onSelectionChange={event => markSelecting(event.nativeEvent.selection.start, event.nativeEvent.selection.end)}>{entry.text || "…"}</SelectionAwareText>{entry.status === "streaming" ? <ActivityIndicator size="small" color={palette.accent} style={styles.streaming} /> : null}</View>;
}

function FileEditorSheet(props: {
  visible: boolean;
  styles: ReturnType<typeof makeStyles>;
  session: Session | null;
  onClose: () => void;
}) {
  const model = iosFileEditorModel();
  const animationType = useModalAnimation("slide");
  return <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}>
    <View style={props.styles.modalBackdrop}><View style={props.styles.artifactSheet}><View style={props.styles.sheetHandle} /><View style={props.styles.sheetHeader}><View><Text style={props.styles.sheetKicker}>{model.kicker}</Text><Text style={props.styles.sheetTitle}>{model.title}</Text><Text style={props.styles.artifactSession} numberOfLines={1}>{props.session?.title ?? "Current task"}</Text></View><Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close file editor"><Text style={props.styles.closeText}>×</Text></Pressable></View><Text style={props.styles.uiMessage}>{model.ownership}</Text>{model.dirtyConflict ? <Text style={props.styles.warningBody}>{model.conflictCopy}</Text> : null}<ScrollView style={props.styles.artifactList} contentContainerStyle={props.styles.artifactListContent}>{model.empty ? <View style={props.styles.artifactEmpty}><Text style={props.styles.emptyTitle}>{model.emptyTitle}</Text><Text style={props.styles.emptyBody}>{model.emptyBody}</Text></View> : model.binary ? <Text style={props.styles.emptyBody}>{model.actions.find(action => action.id === "download")?.reason}</Text> : <Text selectable style={props.styles.artifactText}>{model.text}</Text>}</ScrollView><View style={props.styles.reviewActions}>{model.actions.map(action => <Pressable key={action.id} disabled={!action.enabled} style={[props.styles.reviewActionButton, !action.enabled && props.styles.buttonDisabled]} accessibilityRole="button" accessibilityState={{ disabled: !action.enabled }} accessibilityLabel={action.label} accessibilityHint={action.reason}><Text style={props.styles.reviewActionText}>{action.label}</Text></Pressable>)}</View>{model.actions.map(action => <Text key={`${action.id}-reason`} style={props.styles.reviewActionReason}>{action.label}: {action.reason}</Text>)}</View></View>
  </Modal>;
}

function ReviewSheet(props: {
  visible: boolean;
  styles: ReturnType<typeof makeStyles>;
  session: Session | null;
  api: CediaApi | null;
  onClose: () => void;
}) {
  const [model, setModel] = useState(iosReviewSheetModel());
  const sessionId = props.session?.id;
  useEffect(() => {
    if (!props.visible || !sessionId || !props.api) {
      setModel(iosReviewSheetModel());
      return;
    }
    let cancelled = false;
    const requested = sessionId;
    setModel(iosReviewSheetModel());
    void props.api.getReview(requested).then(payload => {
      if (cancelled || requested !== sessionId) return;
      setModel(iosReviewSheetFromHost(payload));
    }).catch(() => {
      if (cancelled || requested !== sessionId) return;
      setModel(iosReviewSheetModel());
    });
    return () => {
      cancelled = true;
    };
  }, [props.visible, sessionId, props.api]);
  const animationType = useModalAnimation("slide");
  return <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}>
    <View style={props.styles.modalBackdrop}><View style={props.styles.artifactSheet}><View style={props.styles.sheetHandle} /><View style={props.styles.sheetHeader}><View><Text style={props.styles.sheetKicker}>{model.kicker}</Text><Text style={props.styles.sheetTitle}>{model.title}</Text><Text style={props.styles.artifactSession} numberOfLines={1}>{props.session?.title ?? "Current task"}</Text></View><Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close review"><Text style={props.styles.closeText}>×</Text></Pressable></View><Text style={props.styles.uiMessage}>{model.ownership}</Text><ScrollView style={props.styles.artifactList} contentContainerStyle={props.styles.artifactListContent}>{model.files.length ? model.files.map(row => <View key={row.path} style={props.styles.artifactRow} accessibilityRole="text" accessibilityLabel={`${row.statusLabel} ${row.path}`}><View style={props.styles.artifactGlyph}><Text style={props.styles.artifactGlyphText}>{row.statusLabel.slice(0, 1)}</Text></View><View style={props.styles.artifactCopy}><Text style={props.styles.artifactTitle} numberOfLines={1}>{row.path}</Text><Text style={props.styles.artifactMeta} numberOfLines={1}>{row.statusLabel}{row.binaryHint ? " · binary" : ""}{row.staged ? " · staged on Mac" : ""}</Text></View></View>) : <View style={props.styles.artifactEmpty}><Text style={props.styles.emptyTitle}>{model.emptyTitle}</Text><Text style={props.styles.emptyBody}>{model.emptyBody}</Text></View>}<Text style={props.styles.artifactMeta}>{model.diffNote}</Text>{model.hunks.map((hunk, index) => <View key={`${hunk.path}:${hunk.header}:${index}`} accessibilityRole="text" accessibilityLabel={`${hunk.path} ${hunk.header}`}><Text style={props.styles.artifactTitle}>{hunk.path}</Text><Text style={props.styles.artifactMeta}>{hunk.header}</Text>{hunk.lines.map((line, lineIndex) => <Text key={`${hunk.path}:${lineIndex}`} style={props.styles.artifactText}>{`${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.text}`}</Text>)}</View>)}</ScrollView><View style={props.styles.reviewActions}>{model.actions.map(action => <Pressable key={action.id} disabled style={[props.styles.reviewActionButton, props.styles.buttonDisabled]} accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={action.label} accessibilityHint={action.reason}><Text style={props.styles.reviewActionText}>{action.label}</Text></Pressable>)}</View>{model.actions.map(action => <Text key={`${action.id}-reason`} style={props.styles.reviewActionReason}>{action.label}: {action.reason}</Text>)}</View></View>
  </Modal>;
}

function ArtifactSheet(props: {
  visible: boolean;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  session: Session | null;
  artifacts: readonly ArtifactReceipt[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onCapture: () => void;
  onSelect: (receipt: ArtifactReceipt) => void;
}) {
  const animationType = useModalAnimation("slide");
  return <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}>
    <View style={props.styles.modalBackdrop}><View style={props.styles.artifactSheet}><View style={props.styles.sheetHandle} /><View style={props.styles.sheetHeader}><View><Text style={props.styles.sheetKicker}>IMMUTABLE OUTPUTS</Text><Text style={props.styles.sheetTitle}>Artifacts</Text><Text style={props.styles.artifactSession} numberOfLines={1}>{props.session?.title ?? "Current task"}</Text></View><Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close artifacts"><Text style={props.styles.closeText}>×</Text></Pressable></View><Text style={props.styles.uiMessage}>Captured copies stay tied to this task. Cedia never uploads a workspace file until you choose Capture.</Text>{props.loading ? <View style={props.styles.artifactLoading}><ActivityIndicator color={props.palette.accent} /><Text style={props.styles.artifactMeta}>Loading artifacts…</Text></View> : null}{props.error ? <Text style={props.styles.errorText}>{props.error}</Text> : null}<ScrollView style={props.styles.artifactList} contentContainerStyle={props.styles.artifactListContent}>{props.artifacts.length ? props.artifacts.map(receipt => <Pressable key={receipt.sha256} onPress={() => props.onSelect(receipt)} style={props.styles.artifactRow} accessibilityRole="button" accessibilityLabel={`Preview artifact ${receipt.name}`}><View style={props.styles.artifactGlyph}><Text style={props.styles.artifactGlyphText}>{artifactKindLabel(artifactKind(receipt)).slice(0, 1)}</Text></View><View style={props.styles.artifactCopy}><Text style={props.styles.artifactTitle} numberOfLines={1}>{receipt.name}</Text><Text style={props.styles.artifactMeta} numberOfLines={1}>{artifactKindLabel(artifactKind(receipt))} · {artifactDisplaySize(receipt.size)}</Text><Text style={props.styles.artifactSource} numberOfLines={1}>{receipt.sourcePath}</Text></View><Text style={props.styles.artifactChevron}>›</Text></Pressable>) : <View style={props.styles.artifactEmpty}><Text style={props.styles.emptyTitle}>No captured artifacts</Text><Text style={props.styles.emptyBody}>Capture a file from the Mac when you want to keep an immutable copy here.</Text></View>}</ScrollView><View style={props.styles.artifactActions}><Pressable onPress={props.onRefresh} style={props.styles.secondaryButton} accessibilityRole="button"><Text style={props.styles.secondaryButtonText}>Refresh</Text></Pressable><Pressable onPress={props.onCapture} style={props.styles.primaryButton} accessibilityRole="button"><Text style={props.styles.primaryButtonText}>Capture file</Text></Pressable></View></View></View>
  </Modal>;
}

function ArtifactCaptureSheet(props: {
  visible: boolean;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (path: string, sourcePaths: readonly string[]) => void;
}) {
  const [path, setPath] = useState("");
  const [sourcePaths, setSourcePaths] = useState("");
  useEffect(() => {
    if (!props.visible) {
      setPath("");
      setSourcePaths("");
    }
  }, [props.visible]);
  const submit = () => {
    const artifactPath = path.trim();
    if (!artifactPath) return;
    const sources = sourcePaths.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
    props.onSubmit(artifactPath, sources);
  };
  const animationType = useModalAnimation("fade");
  return <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}><View style={props.styles.modalBackdrop}><View style={props.styles.uiSheet}><View style={props.styles.sheetHeader}><View><Text style={props.styles.sheetKicker}>EXPLICIT CAPTURE</Text><Text style={props.styles.sheetTitle}>Capture a file</Text></View><Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close capture"><Text style={props.styles.closeText}>×</Text></Pressable></View><Text style={props.styles.uiMessage}>Enter a path relative to the task workspace. Cedia copies the bytes on your Mac and records their source hashes.</Text><TextInput value={path} onChangeText={setPath} style={props.styles.artifactInput} placeholder="dist/demo.mp4" placeholderTextColor={props.palette.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Artifact path" /><TextInput value={sourcePaths} onChangeText={setSourcePaths} style={[props.styles.artifactInput, props.styles.artifactSourcesInput]} placeholder="Optional source paths, one per line" placeholderTextColor={props.palette.muted} autoCapitalize="none" autoCorrect={false} multiline accessibilityLabel="Artifact source paths" />{props.error ? <Text style={props.styles.errorText}>{props.error}</Text> : null}<View style={props.styles.uiActions}><Pressable onPress={props.onClose} style={props.styles.secondaryButton}><Text style={props.styles.secondaryButtonText}>Cancel</Text></Pressable><Pressable onPress={submit} disabled={!path.trim() || props.loading} style={[props.styles.primaryButton, (!path.trim() || props.loading) && props.styles.buttonDisabled]}><Text style={props.styles.primaryButtonText}>{props.loading ? "Capturing…" : "Capture copy"}</Text></Pressable></View></View></View></Modal>;
}

function ArtifactViewer(props: {
  visible: boolean;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  api: CediaApi | null;
  receipt: ArtifactReceipt;
  target: { readonly id: string; readonly incarnation: string };
  isCurrent: (target: { readonly id: string; readonly incarnation: string }) => boolean;
  onClose: () => void;
}) {
  const kind = artifactKind(props.receipt);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.visible) return;
    const controller = new AbortController();
    let active = true;
    setBytes(null);
    setError(null);
    if (!props.api || !props.isCurrent(props.target)) {
      setError("This task is no longer selected");
      return () => controller.abort();
    }
    setLoading(true);
    void readArtifactBytes(props.api, props.receipt, { maxBytes: kind === "text" ? 2 * 1024 * 1024 : undefined, signal: controller.signal }).then(value => {
      if (!active || controller.signal.aborted || !props.isCurrent(props.target)) return;
      setBytes(value);
    }).catch(cause => {
      if (!active || controller.signal.aborted || !props.isCurrent(props.target)) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (active && !controller.signal.aborted && props.isCurrent(props.target)) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [kind, props.api, props.isCurrent, props.receipt, props.target, props.visible]);

  const download = useCallback(async () => {
    if (!bytes) return;
    try {
      await downloadArtifact(props.receipt, bytes, Platform.OS === "web" ? "web" : "native");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [bytes, props.receipt]);

  const uri = bytes ? artifactDataUri(props.receipt, bytes) : "";
  let preview: React.ReactNode = null;
  if (loading) preview = <View style={props.styles.artifactLoading}><ActivityIndicator color={props.palette.accent} /><Text style={props.styles.artifactMeta}>Verifying immutable bytes…</Text></View>;
  else if (error) preview = <Text style={props.styles.errorText}>{error}</Text>;
  else if (bytes && kind === "text") preview = <ScrollView style={props.styles.artifactPreview} contentContainerStyle={props.styles.artifactPreviewContent}><Text selectable style={props.styles.artifactText}>{decodeUtf8(bytes)}</Text></ScrollView>;
  else if (bytes && kind === "image") preview = Platform.OS === "web" ? React.createElement("img", { src: uri, alt: props.receipt.name, style: { maxWidth: "100%", maxHeight: 360, objectFit: "contain" } }) : <Image source={{ uri }} style={props.styles.artifactImage} resizeMode="contain" accessibilityLabel={props.receipt.name} />;
  else if (bytes && (kind === "audio" || kind === "video")) preview = Platform.OS === "web" ? React.createElement(kind, { src: uri, controls: true, playsInline: true, style: { width: "100%", maxHeight: 360 } }) : <WebView source={{ html: artifactMediaDocument(uri, kind, props.receipt.name) }} javaScriptEnabled={false} domStorageEnabled={false} originWhitelist={["*"]} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction style={props.styles.artifactMedia} />;
  else if (bytes) preview = <View style={props.styles.artifactEmpty}><Text style={props.styles.emptyTitle}>Preview unavailable</Text><Text style={props.styles.emptyBody}>This binary file is verified and ready for an explicit download.</Text></View>;

  const animationType = useModalAnimation("slide");
  return <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}><View style={props.styles.modalBackdrop}><View style={props.styles.artifactViewer}><View style={props.styles.sheetHeader}><View style={props.styles.artifactCopy}><Text style={props.styles.sheetKicker}>{artifactKindLabel(kind).toUpperCase()} ARTIFACT</Text><Text style={props.styles.sheetTitle} numberOfLines={1}>{props.receipt.name}</Text><Text style={props.styles.artifactMeta}>{artifactDisplaySize(props.receipt.size)} · {props.receipt.sha256.slice(0, 12)}…</Text></View><Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close artifact preview"><Text style={props.styles.closeText}>×</Text></Pressable></View>{preview}<View style={props.styles.artifactActions}><Pressable onPress={props.onClose} style={props.styles.secondaryButton}><Text style={props.styles.secondaryButtonText}>Close</Text></Pressable><Pressable onPress={() => void download()} disabled={!bytes || loading} style={[props.styles.primaryButton, (!bytes || loading) && props.styles.buttonDisabled]} accessibilityRole="button"><Text style={props.styles.primaryButtonText}>{Platform.OS === "web" ? "Download" : "Share / save"}</Text></Pressable></View></View></View></Modal>;
}

function ThinkingPicker(props: {
  visible: boolean;
  thinking: ThinkingParams;
  styles: ReturnType<typeof makeStyles>;
  onClose: () => void;
  onSelect: (level: string) => void;
}) {
  const animationType = useModalAnimation("slide");
  return (
    <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}>
      <View style={props.styles.modalBackdrop}>
        <View style={props.styles.sheet}>
          <View style={props.styles.sheetHandle} />
          <View style={props.styles.sheetHeader}>
            <Text style={props.styles.sheetTitle}>Thinking level</Text>
            <Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close thinking picker">
              <Text style={props.styles.closeText}>×</Text>
            </Pressable>
          </View>
          {props.thinking.advertised && props.thinking.options.length ? props.thinking.options.map(item => (
            <Pressable
              key={item.id}
              onPress={() => item.enabled ? props.onSelect(item.id) : undefined}
              disabled={!item.enabled}
              style={props.styles.modelRow}
              accessibilityRole="button"
              accessibilityState={{ selected: item.id === props.thinking.current, disabled: !item.enabled }}
            >
              <View style={props.styles.modelCopy}>
                <Text style={props.styles.modelLabel}>{item.label}</Text>
              </View>
              <Text style={props.styles.modelCheck}>{item.id === props.thinking.current ? "✓" : ""}</Text>
            </Pressable>
          )) : (
            <View style={props.styles.emptySheet}>
              <Text style={props.styles.emptyBody}>{props.thinking.reason || THINKING_NOT_ADVERTISED}</Text>
            </View>
          )}
          <Text style={props.styles.sheetFootnote}>Levels come from OMP get_state. Cedia does not invent Fast or High.</Text>
        </View>
      </View>
    </Modal>
  );
}

function ModelPicker(props: { visible: boolean; models: readonly ModelOption[]; selected?: string; styles: ReturnType<typeof makeStyles>; palette: Palette; onClose: () => void; onSelect: (model: ModelOption) => void; onRefresh: () => void }) {
  const animationType = useModalAnimation("slide");
  return <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}><View style={props.styles.modalBackdrop}><View style={props.styles.sheet}><View style={props.styles.sheetHandle} /><View style={props.styles.sheetHeader}><Text style={props.styles.sheetTitle}>Choose a model</Text><Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close model picker"><Text style={props.styles.closeText}>×</Text></Pressable></View>{props.models.length ? props.models.map(model => <Pressable key={`${model.provider ?? ""}:${model.id}`} onPress={() => modelOptionSelectable(model) ? props.onSelect(model) : undefined} disabled={!modelOptionSelectable(model)} style={[props.styles.modelRow, !modelOptionSelectable(model) && props.styles.buttonDisabled]} accessibilityRole="button" accessibilityState={{ selected: model.id === props.selected, disabled: !modelOptionSelectable(model) }} accessibilityHint={modelOptionSelectable(model) ? undefined : (typeof model.reason === "string" && model.reason.trim() ? model.reason : IOS_COMPOSER_MODEL_UNAVAILABLE)}><View style={props.styles.modelCopy}><Text style={props.styles.modelLabel}>{model.label}</Text><Text style={props.styles.modelMeta}>{modelOptionSelectable(model) ? (model.provider ?? "Provider not advertised") : (typeof model.reason === "string" && model.reason.trim() ? model.reason : IOS_COMPOSER_MODEL_UNAVAILABLE)}</Text></View><Text style={props.styles.modelCheck}>{model.id === props.selected ? "✓" : ""}</Text></Pressable>) : <View style={props.styles.emptySheet}><Text style={props.styles.emptyBody}>Ask OMP for its available model catalog.</Text><Pressable onPress={props.onRefresh} style={props.styles.primaryButton}><Text style={props.styles.primaryButtonText}>Refresh models</Text></Pressable></View>}<Text style={props.styles.sheetFootnote}>Models and availability come from OMP on the Mac.</Text></View></View></Modal>;
}

function LoginPicker(props: {
  visible: boolean;
  providers: readonly LoginProviderOption[];
  presentations: readonly UiPresentation[];
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  onClose: () => void;
  onRefresh: () => void;
  onStartLogin: (providerId: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  const urls = props.presentations.filter(item => item.method === "open_url" && item.url);
  const animationType = useModalAnimation("slide");
  return <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={props.onClose}><View style={props.styles.modalBackdrop}><View style={props.styles.sheet}><View style={props.styles.sheetHandle} /><View style={props.styles.sheetHeader}><View><Text style={props.styles.sheetKicker}>OMP ACCOUNT</Text><Text style={props.styles.sheetTitle}>Provider login</Text></View><Pressable onPress={props.onClose} accessibilityRole="button" accessibilityLabel="Close login"><Text style={props.styles.closeText}>×</Text></Pressable></View><Text style={props.styles.uiMessage}>Cedia lists OMP providers from the Mac. It does not open a browser until you ask.</Text>{props.providers.length ? props.providers.map(provider => <View key={provider.id} style={props.styles.loginRow}><View style={props.styles.modelCopy}><Text style={props.styles.modelLabel}>{provider.name}</Text><Text style={props.styles.modelMeta}>{provider.authenticated ? "Signed in" : provider.available === false ? "Unavailable" : "Not signed in"}</Text></View><Pressable onPress={() => props.onStartLogin(provider.id)} disabled={provider.available === false} style={[props.styles.secondaryButton, provider.available === false && props.styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel={`${provider.authenticated ? "Re-login" : "Log in"} ${provider.name}`}><Text style={props.styles.secondaryButtonText}>{provider.authenticated ? "Re-login" : "Log in"}</Text></Pressable></View>) : <View style={props.styles.emptySheet}><Text style={props.styles.emptyBody}>Refresh to list OMP login providers.</Text><Pressable onPress={props.onRefresh} style={props.styles.primaryButton}><Text style={props.styles.primaryButtonText}>Refresh providers</Text></Pressable></View>}{urls.length ? <View style={props.styles.loginLinks}>{urls.map(item => <Pressable key={item.id} onPress={() => props.onOpenUrl(item.url!)} style={props.styles.optionRow} accessibilityRole="button" accessibilityLabel="Open login URL"><Text style={props.styles.optionLabel}>{item.title ?? "Open login page"}</Text>{item.instructions ? <Text style={props.styles.optionDescription}>{item.instructions}</Text> : <Text style={props.styles.optionDescription} numberOfLines={2}>{item.url}</Text>}</Pressable>)}</View> : null}<Text style={props.styles.sheetFootnote}>OAuth stays on OMP. This phone only starts login and opens the URL you choose.</Text></View></View></Modal>;
}

function UiSheet(props: { request: PendingUiRequest; sessionId?: string; incarnation?: string; connection?: string; syncing?: boolean; visible: boolean; styles: ReturnType<typeof makeStyles>; palette: Palette; onClose: () => void; onAnswer: (answer: UiResponseRequest["answer"]) => void }) {
  const { request } = props;
  const ui = request.request;
  const requestToken = request.token;
  const current = { sessionId: props.sessionId, incarnation: props.incarnation, connection: props.connection };
  const [value, setValue] = useState(ui.method === "editor" ? ui.prefill ?? "" : "");
  const [selectedOption, setSelectedOption] = useState<string | undefined>();
  useEffect(() => {
    setValue(request.request.method === "editor" ? request.request.prefill ?? "" : "");
    setSelectedOption(undefined);
  }, [requestToken]);
  const submit = (answer: UiResponseRequest["answer"]) => props.onAnswer(answer);
  const closePresentation = () => props.onClose();
  const readonly = isUiSheetReadonly(request, current);
  const displayStatus = iosApprovalDisplayStatus(request, current);
  const statusCopy = iosApprovalStatusCopy(displayStatus);
  const identity = uiSheetIdentity(request, current);
  const allowAnswer = readonly ? undefined : uiSheetAllowAnswer(ui, value, selectedOption);
  let body: React.ReactNode;
  if (readonly) {
    body = <Text style={props.styles.uiMessage}>{statusCopy || `This request is ${displayStatus}. Fields stay readable. Cedia will not resubmit it.`}</Text>;
  } else if (ui.method === "confirm") {
    body = <Text style={props.styles.uiMessage}>{ui.message}</Text>;
  } else if (ui.method === "select") {
    body = ui.options.map((option, index) => (
      <Pressable
        key={`${option}:${index}`}
        onPress={() => setSelectedOption(option)}
        style={[props.styles.optionRow, selectedOption === option && props.styles.optionRowSelected]}
        accessibilityRole="button"
        accessibilityState={{ selected: selectedOption === option }}
        accessibilityLabel={option}
      >
        <Text style={props.styles.optionLabel}>{option}</Text>
        {ui.optionDetails?.[index]?.description ? <Text style={props.styles.optionDescription}>{ui.optionDetails[index]!.description}</Text> : null}
      </Pressable>
    ));
  } else {
    const editor = ui.method === "editor";
    body = <TextInput value={value} onChangeText={setValue} multiline={editor} style={[props.styles.uiInput, editor && props.styles.editorInput]} placeholder={ui.method === "input" ? ui.placeholder : "Write a response"} placeholderTextColor={props.palette.muted} autoFocus accessibilityLabel={ui.title} />;
  }
  const animationType = useModalAnimation("fade");
  return (
    <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={closePresentation}>
      <View style={props.styles.modalBackdrop}>
        <Pressable style={props.styles.uiSheetDismiss} onPress={closePresentation} accessibilityRole="button" accessibilityLabel="Dismiss request" />
        <View style={props.styles.approvalSheet}>
          <View style={props.styles.uiSheetBody}>
            <View style={props.styles.sheetHeader}>
              <View>
                <Text style={props.styles.sheetKicker}>OMP INTERACTION</Text>
                <Text style={props.styles.sheetTitle}>{ui.title}</Text>
              </View>
              <Pressable onPress={closePresentation} accessibilityRole="button" accessibilityLabel="Dismiss request">
                <Text style={props.styles.closeText}>×</Text>
              </Pressable>
            </View>
            <Text style={props.styles.uiMessage}>{identity}</Text>
            <ScrollView style={props.styles.uiSheetScroll} keyboardShouldPersistTaps="handled">{body}</ScrollView>
          </View>
          {readonly ? null : (
            <View style={props.styles.uiSheetFooter}>
              <Pressable onPress={() => submit(uiSheetDenyAnswer(ui))} disabled={props.syncing} style={[props.styles.denyButton, props.syncing && props.styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel="Deny" accessibilityState={{ disabled: Boolean(props.syncing) }}>
                <Text style={props.styles.denyButtonText}>Deny</Text>
              </Pressable>
              <Pressable onPress={() => { if (allowAnswer !== undefined && !props.syncing) submit(allowAnswer); }} disabled={allowAnswer === undefined || props.syncing} style={[props.styles.primaryButton, props.styles.allowButton, (allowAnswer === undefined || props.syncing) && props.styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel="Allow" accessibilityState={{ disabled: allowAnswer === undefined || Boolean(props.syncing) }}>
                <Text style={props.styles.primaryButtonText}>Allow</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function PairingSheet(props: { visible: boolean; styles: ReturnType<typeof makeStyles>; palette: Palette; onClose: () => void; onImport: (offer: PairingOffer) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [reviewOffer, setReviewOffer] = useState<PairingOffer | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const parse = useCallback((raw: string) => {
    try {
      const offer = parsePairingOffer(raw);
      setError(null);
      setReviewOffer(offer);
      setScan(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  const scanResult = useCallback((result: BarcodeScanningResult) => { if (result.data) parse(result.data); }, [parse]);
  const close = () => {
    setReviewOffer(null);
    setScan(false);
    setError(null);
    props.onClose();
  };
  const importReviewed = () => {
    if (!reviewOffer) return;
    props.onImport(reviewOffer);
    setReviewOffer(null);
    setText("");
    setScan(false);
  };
  const animationType = useModalAnimation("slide");
  const fingerprint = reviewOffer && isLegacyRelayPairingOffer(reviewOffer) ? pairingPublicKeyFingerprint(reviewOffer.daemonPublicKeyB64) : "";
  return (
    <Modal visible={props.visible} transparent animationType={animationType} onRequestClose={close}>
      <View style={props.styles.modalBackdrop}>
        <View style={props.styles.sheet}>
          <View style={props.styles.sheetHandle} />
          <View style={props.styles.sheetHeader}>
            <View>
              <Text style={props.styles.sheetKicker}>{reviewOffer ? "REVIEW THIS MAC" : "PRIVATE CONNECTION"}</Text>
              <Text style={props.styles.sheetTitle}>{reviewOffer ? "Review" : "Pair your Mac"}</Text>
            </View>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close connection">
              <Text style={props.styles.closeText}>×</Text>
            </Pressable>
          </View>
          {reviewOffer ? (
            <>
              <Text style={props.styles.uiMessage}>Confirm this is the Mac you scanned. Import uses the selected private transport and keeps controller credentials on this device only.</Text>
              <Text style={props.styles.cardTitle}>{reviewOffer.serverId}</Text>
              <Text style={props.styles.cardSubtitle}>{pairingTransportLabel(reviewOffer)}</Text>
              {isLegacyRelayPairingOffer(reviewOffer) ? <Text style={props.styles.cardSubtitle}>Fingerprint {fingerprint}</Text> : <Text style={props.styles.cardSubtitle}>{reviewOffer.deviceName}</Text>}
              <Text style={props.styles.cardSubtitle}>{isGatewayPairingOffer(reviewOffer) ? reviewOffer.gatewayOrigin : reviewOffer.relayEndpoint}</Text>
              {error ? <Text style={props.styles.errorText}>{error}</Text> : null}
              <View style={props.styles.uiActions}>
                <Pressable onPress={() => setReviewOffer(null)} style={props.styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={props.styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={importReviewed} style={props.styles.primaryButton} accessibilityRole="button" accessibilityLabel="Import this Mac">
                  <Text style={props.styles.primaryButtonText}>Import this Mac</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={props.styles.uiMessage}>Scan the private QR from Cedia on your Mac, or paste its offer here. Legacy Paseo offers remain inert; the selected path is the Tailscale gateway.</Text>
              {scan ? (
                <View style={props.styles.cameraBox}>
                  {permission?.granted ? (
                    <CameraView style={StyleSheet.absoluteFill} facing="back" onBarcodeScanned={scanResult} />
                  ) : (
                    <View style={props.styles.cameraPermission}>
                      <Text style={props.styles.emptyBody}>Camera permission is needed to scan a pairing QR.</Text>
                      <Pressable onPress={() => void requestPermission()} style={props.styles.secondaryButton}>
                        <Text style={props.styles.secondaryButtonText}>Allow camera</Text>
                      </Pressable>
                    </View>
                  )}
                  <View style={props.styles.scanFrame} pointerEvents="none">
                    <View style={props.styles.scanCornerTopLeft} />
                    <View style={props.styles.scanCornerTopRight} />
                    <View style={props.styles.scanCornerBottomLeft} />
                    <View style={props.styles.scanCornerBottomRight} />
                  </View>
                </View>
              ) : (
                <>
                  <TextInput value={text} onChangeText={setText} multiline style={props.styles.pairingInput} placeholder="Paste private JSON or https://…/#offer=…" placeholderTextColor={props.palette.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Pairing offer" />
                  {error ? <Text style={props.styles.errorText}>{error}</Text> : null}
                  <View style={props.styles.uiActions}>
                    <Pressable onPress={() => setScan(true)} style={props.styles.secondaryButton}>
                      <Text style={props.styles.secondaryButtonText}>Scan QR</Text>
                    </Pressable>
                    <Pressable onPress={() => parse(text)} disabled={!text.trim()} style={[props.styles.primaryButton, !text.trim() && props.styles.buttonDisabled]}>
                      <Text style={props.styles.primaryButtonText}>Review offer</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </>
          )}
          <Text style={props.styles.sheetFootnote}>This connection keeps your Cedia workspace with the same Mac.</Text>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(
  palette: Palette,
  density: ProductPrefs["density"] = "comfortable",
  highContrast = false,
  type: DynamicTypeRoles = dynamicTypeRoles(1),
  scale = 1,
) {
  const detailed = density === "detailed";
  const border = highContrast ? palette.text : palette.border;
  const contrastPalette = highContrast ? { ...palette, border } : palette;
  palette = contrastPalette;
  const taskHeading = type.taskHeading;
  const section = type.section;
  const body = type.body;
  const control = type.control;
  const caption = type.caption;
  const taskHeadingLine = scaledSize(30, scale);
  const sectionLine = scaledSize(25, scale);
  const bodyLine = scaledSize(26, scale);
  const controlLine = scaledSize(24, scale);
  const captionLine = scaledSize(19, scale);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.bg },
    header: { height: 76, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    brandMark: { width: 34, height: 34, borderRadius: 12, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
    brandMarkText: { color: palette.white, fontSize: 24, lineHeight: 26, fontWeight: "700" },
    brand: { color: palette.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
    brandCaption: { color: palette.muted, fontSize: 11, marginTop: 1 },
    connectionPill: { minHeight: 34, paddingHorizontal: 11, borderRadius: 17, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 6 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    connectionText: { color: palette.muted, fontSize: caption, fontWeight: "700" },
    dashboardRoot: { flex: 1 },
    dashboardScroll: { flex: 1 },
    dashboard: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
    bottomNav: { flexDirection: "row", borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 8, paddingTop: 4, minHeight: 52 },
    bottomNavItem: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingVertical: 10 },
    bottomNavText: { color: palette.muted, fontSize: control, fontWeight: "700" },
    bottomNavTextActive: { color: palette.text },
    hero: { paddingTop: 17, paddingBottom: 4 },
    eyebrow: { color: palette.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
    heroTitle: { color: palette.text, fontSize: taskHeading, lineHeight: taskHeadingLine, fontWeight: "800", letterSpacing: -1, marginTop: 6 },
    heroBody: { color: palette.muted, fontSize: body, lineHeight: bodyLine, marginTop: 4, maxWidth: 330 },
    searchWrap: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", paddingHorizontal: 13 },
    searchIcon: { fontSize: 23, color: palette.muted, marginRight: 8, marginTop: -2 },
    searchInput: { flex: 1, color: palette.text, fontSize: control, paddingVertical: 0 },
    segmented: { flexDirection: "row", backgroundColor: palette.elevated, padding: 3, borderRadius: 12 },
    segment: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
    segmentActive: { backgroundColor: palette.surface },
    segmentText: { color: palette.muted, fontSize: control, fontWeight: "700" },
    segmentTextActive: { color: palette.text },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
    rowGap: { flexDirection: "row", alignItems: "center", gap: 12 },
    sectionTitle: { color: palette.text, fontSize: section, fontWeight: "800" },
    linkText: { color: palette.accent, fontSize: control, fontWeight: "700" },
    refresh: { color: palette.accent, fontSize: 22 },
    card: { minHeight: 76, borderRadius: 17, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
    cardSelected: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
    cardCompact: { minHeight: 68 },
    cardMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
    cardCopy: { flex: 1, gap: 4 },
    cardTitle: { color: palette.text, fontSize: body, fontWeight: "700" },
    cardSubtitle: { color: palette.muted, fontSize: caption },
    cardActions: { flexDirection: "row", alignItems: "center", gap: 10 },
    projectGlyph: { width: 42, height: 42, borderRadius: 13, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center" },
    projectGlyphText: { color: palette.accent, fontSize: 17, fontWeight: "800" },
    taskGlyph: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    taskGlyphText: { fontSize: 26, fontWeight: "700", marginTop: -3 },
    actionIcon: { color: palette.muted, fontSize: 22, minWidth: 20, textAlign: "center" },
    empty: { alignItems: "center", paddingVertical: 38, paddingHorizontal: 30, gap: 8 },
    emptyMark: { width: 50, height: 50, borderRadius: 18, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 3 },
    emptyMarkText: { color: palette.accent, fontSize: 30 },
    emptyTitle: { color: palette.text, fontSize: section, fontWeight: "800" },
    emptyBody: { color: palette.muted, fontSize: caption, lineHeight: captionLine, textAlign: "center" },
    unavailable: { borderRadius: 17, backgroundColor: palette.elevated, padding: 16, gap: 6, marginTop: 4 },
    unavailableTitle: { color: palette.text, fontSize: section, fontWeight: "800" },
    unavailableBody: { color: palette.muted, fontSize: body, lineHeight: bodyLine, marginBottom: 6 },
    settingsList: { gap: 8 },
    settingsCard: { flexDirection: "column", alignItems: "stretch", minHeight: 0, padding: 0, gap: 0 },
    settingsRow: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
    settingsDetail: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
    settingsChevron: { fontSize: 22, lineHeight: 22 },
    prefRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    prefChip: { minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 12, justifyContent: "center" },
    prefChipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
    prefChipText: { color: palette.muted, fontSize: control, fontWeight: "700" },
    prefChipTextActive: { color: palette.text },
    prefSwitchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 },
    unavailableRow: { borderRadius: 12, backgroundColor: palette.elevated, padding: 12, gap: 4 },
    errorText: { color: palette.danger, fontSize: caption, lineHeight: captionLine },
    primaryButton: { alignSelf: "flex-start", borderRadius: 12, backgroundColor: palette.accent, paddingHorizontal: 15, paddingVertical: 11, minHeight: 42, justifyContent: "center" },
    primaryButtonText: { color: palette.white, fontSize: control, fontWeight: "800", textAlign: "center" },
    secondaryButton: { alignSelf: "flex-start", borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 15, paddingVertical: 10, minHeight: 42, justifyContent: "center" },
    secondaryButtonText: { color: palette.text, fontSize: control, fontWeight: "700", textAlign: "center" },
    buttonDisabled: { opacity: 0.42 },
    pairedHint: { color: palette.muted, fontSize: caption, textAlign: "center", paddingHorizontal: 20, paddingBottom: 8 },
    detailRoot: { flex: 1 },
    detailHeader: { minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.border, gap: 8 },
    backButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.elevated },
    backText: { color: palette.text, fontSize: 29, lineHeight: 28, marginTop: -3 },
    detailTitleWrap: { flex: 1, gap: 2 },
    detailTitle: { color: palette.text, fontSize: taskHeading, fontWeight: "800" },
    detailSubtitle: { color: palette.muted, fontSize: caption },
    detailStatus: { color: palette.warning, fontSize: caption, fontWeight: "700" },
    detailActions: { flexDirection: "row", alignItems: "center", gap: 6 },
    artifactButton: { minHeight: 35, borderRadius: 11, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
    artifactButtonText: { color: palette.text, fontSize: control, fontWeight: "700" },
    modelButton: { maxWidth: 116, minHeight: 35, borderRadius: 11, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
    modelButtonText: { color: palette.text, fontSize: control, fontWeight: "700", flexShrink: 1 },
    modelChevron: { color: palette.muted, fontSize: 16 },
    transcript: { flex: 1 },
    transcriptContent: { padding: 16, gap: 10, paddingBottom: 24 },
    sessionStart: { borderRadius: 18, backgroundColor: palette.accentSoft, padding: 18, gap: 7, marginTop: 10, marginBottom: 4 },
    sessionStartTitle: { color: palette.text, fontSize: section, fontWeight: "800" },
    sessionStartBody: { color: palette.muted, fontSize: body, lineHeight: bodyLine, marginBottom: 4 },
    messageCard: { borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, padding: 14, gap: 6 },
    userMessage: { backgroundColor: palette.accentSoft, borderColor: "transparent" },
    messageRole: { color: palette.accent, fontSize: caption, fontWeight: "800", letterSpacing: 0.6 },
    messageText: { color: palette.text, fontSize: detailed ? caption : body, lineHeight: detailed ? captionLine : bodyLine },
    streaming: { alignSelf: "flex-start", marginTop: 3 },
    toolCard: { borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated, padding: 13, gap: 9 },
    toolHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    toolHeaderToggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
    toolCopy: { color: palette.accent, fontSize: control, fontWeight: "800" },
    toolIcon: { width: 25, height: 25, borderRadius: 8, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center" },
    toolIconText: { color: palette.accent, fontSize: 13 },
    toolName: { color: palette.text, fontSize: control, fontWeight: "800", flex: 1 },
    toolStatus: { fontSize: caption, fontWeight: "800" },
    toolArgs: { color: palette.muted, fontSize: caption, lineHeight: captionLine, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
    toolOutput: { color: palette.text, fontSize: body, lineHeight: bodyLine },
    eventRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4 },
    eventDot: { color: palette.accent, fontSize: 24, lineHeight: 18 },
    eventText: { color: palette.muted, fontSize: caption, flex: 1 },
    warningBanner: { borderRadius: 15, borderWidth: 1, borderColor: palette.warning, backgroundColor: palette.elevated, padding: 13, gap: 6 },
    warningTitle: { color: palette.warning, fontSize: section, fontWeight: "800" },
    warningBody: { color: palette.muted, fontSize: body, lineHeight: bodyLine },
    warningAction: { alignSelf: "flex-start", paddingVertical: 5 },
    warningActionText: { color: palette.accent, fontSize: control, fontWeight: "800" },
    composerBar: { borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.bg, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 },
    chipRow: { borderRadius: 10, backgroundColor: palette.elevated, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
    chipText: { color: palette.muted, fontSize: caption, lineHeight: captionLine },
    composerRow: { borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: "row", alignItems: "flex-end", padding: 5 },
    composerInput: { flex: 1, color: palette.text, fontSize: control, lineHeight: controlLine, paddingHorizontal: 9, paddingVertical: 8, maxHeight: 132 },
    expandedComposerInput: { minHeight: 120, textAlignVertical: "top" },
    sendButton: { width: 44, height: 44, minHeight: 44, borderRadius: 12, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
    sendText: { color: palette.white, fontSize: 23, fontWeight: "700", marginTop: -2 },
    composerActions: { flexDirection: "row", flexWrap: "wrap", gap: 15, paddingHorizontal: 4, paddingTop: 7 },
    composerAction: { paddingVertical: 3, minHeight: 44, justifyContent: "center" },
    composerActionText: { color: palette.muted, fontSize: control, fontWeight: "700" },
    composerReason: { color: palette.muted, fontSize: caption, lineHeight: captionLine, paddingHorizontal: 4, paddingTop: 6 },
    jumpToLatest: { alignSelf: "center", minHeight: 44, borderRadius: 12, backgroundColor: palette.accentSoft, paddingHorizontal: 14, justifyContent: "center", marginTop: 8, marginBottom: 4 },
    jumpToLatestText: { color: palette.accent, fontSize: control, fontWeight: "800" },
    loadMore: { alignSelf: "center", minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, justifyContent: "center" },
    loadMoreText: { color: palette.accent, fontSize: control, fontWeight: "800" },
    modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(8,10,18,0.48)" },
    sheet: { maxHeight: "88%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.surface, padding: 20, paddingBottom: 32, gap: 13 },
    uiSheetDismiss: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
    uiSheet: { maxHeight: "86%", borderRadius: 22, backgroundColor: palette.surface, padding: 20, margin: 20, gap: 13 },
    approvalSheet: { maxHeight: "86%", borderRadius: 22, backgroundColor: palette.surface, margin: 20, overflow: "hidden", zIndex: 1 },
    uiSheetBody: { padding: 20, paddingBottom: 12, gap: 13 },
    uiSheetScroll: { maxHeight: 280 },
    uiSheetFooter: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 9, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface },
    denyButton: { alignSelf: "flex-start", borderRadius: 12, borderWidth: 1, borderColor: palette.danger, backgroundColor: palette.surface, paddingHorizontal: 15, paddingVertical: 10, minHeight: 44, justifyContent: "center" },
    denyButtonText: { color: palette.danger, fontSize: control, fontWeight: "800", textAlign: "center" },
    allowButton: { minHeight: 44 },
    sheetHandle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 3 },
    sheetHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
    sheetKicker: { color: palette.accent, fontSize: caption, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
    sheetTitle: { color: palette.text, fontSize: taskHeading, fontWeight: "800", letterSpacing: -0.4 },
    closeText: { color: palette.muted, fontSize: 29, lineHeight: 27, paddingHorizontal: 4 },
    modelRow: { minHeight: 56, borderRadius: 13, backgroundColor: palette.elevated, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    loginRow: { minHeight: 56, borderRadius: 13, backgroundColor: palette.elevated, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    loginLinks: { gap: 8, marginTop: 8 },
    modelCopy: { flex: 1, gap: 3 },
    modelLabel: { color: palette.text, fontSize: control, fontWeight: "700" },
    modelMeta: { color: palette.muted, fontSize: caption },
    modelCheck: { color: palette.accent, fontSize: 19, fontWeight: "800" },
    emptySheet: { alignItems: "center", gap: 12, paddingVertical: 20 },
    sheetFootnote: { color: palette.muted, fontSize: caption, lineHeight: captionLine, textAlign: "center" },
    uiMessage: { color: palette.text, fontSize: body, lineHeight: bodyLine },
    uiActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9, marginTop: 3 },
    uiInput: { minHeight: 49, maxHeight: 160, borderRadius: 13, borderWidth: 1, borderColor: palette.border, color: palette.text, backgroundColor: palette.elevated, fontSize: control, paddingHorizontal: 13, paddingVertical: 11 },
    editorInput: { minHeight: 130, textAlignVertical: "top" },
    optionRow: { borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: 13, gap: 3 },
    optionRowSelected: { backgroundColor: palette.accentSoft },
    optionLabel: { color: palette.text, fontSize: control, fontWeight: "700" },
    optionDescription: { color: palette.muted, fontSize: caption, lineHeight: captionLine },
    pairingInput: { minHeight: 130, maxHeight: 220, borderRadius: 14, borderWidth: 1, borderColor: palette.border, color: palette.text, backgroundColor: palette.elevated, fontSize: body, lineHeight: bodyLine, paddingHorizontal: 13, paddingVertical: 11, textAlignVertical: "top" },
    artifactSheet: { maxHeight: "88%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.surface, padding: 20, paddingBottom: 28, gap: 12 },
    artifactViewer: { maxHeight: "92%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.surface, padding: 20, paddingBottom: 28, gap: 12 },
    artifactSession: { color: palette.muted, fontSize: caption, marginTop: 4, maxWidth: 250 },
    artifactList: { minHeight: 80, maxHeight: 410 },
    artifactListContent: { gap: 8, paddingVertical: 2 },
    artifactRow: { minHeight: 68, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated, flexDirection: "row", alignItems: "center", padding: 10, gap: 10 },
    artifactGlyph: { width: 38, height: 38, borderRadius: 12, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center" },
    artifactGlyphText: { color: palette.accent, fontSize: 15, fontWeight: "800" },
    artifactCopy: { flex: 1, gap: 3 },
    artifactTitle: { color: palette.text, fontSize: section, fontWeight: "800" },
    artifactMeta: { color: palette.muted, fontSize: caption },
    artifactSource: { color: palette.muted, fontSize: caption },
    artifactChevron: { color: palette.muted, fontSize: 25, lineHeight: 25 },
    artifactEmpty: { alignItems: "center", justifyContent: "center", paddingHorizontal: 25, paddingVertical: 25, gap: 6 },
    artifactLoading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, minHeight: 48 },
    artifactActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9, marginTop: 3 },
    reviewActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 3 },
    reviewActionButton: { minHeight: 44, minWidth: 88, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: 15, justifyContent: "center", alignItems: "center" },
    reviewActionText: { color: palette.muted, fontSize: control, fontWeight: "700", textAlign: "center" },
    reviewActionReason: { color: palette.muted, fontSize: caption, lineHeight: captionLine },
    artifactInput: { minHeight: 49, borderRadius: 13, borderWidth: 1, borderColor: palette.border, color: palette.text, backgroundColor: palette.elevated, fontSize: control, paddingHorizontal: 13, paddingVertical: 11 },
    artifactSourcesInput: { minHeight: 82, textAlignVertical: "top" },
    artifactPreview: { maxHeight: 460, borderRadius: 14, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border },
    artifactPreviewContent: { padding: 13 },
    artifactText: { color: palette.text, fontSize: caption, lineHeight: captionLine, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
    artifactImage: { width: "100%", height: 360, backgroundColor: palette.elevated, borderRadius: 14 },
    artifactMedia: { width: "100%", height: 185, borderRadius: 14, backgroundColor: "#10131B" },
    cameraBox: { height: 300, borderRadius: 18, overflow: "hidden", backgroundColor: palette.elevated, position: "relative" },
    cameraPermission: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    scanFrame: { position: "absolute", width: 220, height: 220, left: "50%", top: "50%", marginLeft: -110, marginTop: -110 },
    scanCornerTopLeft: { position: "absolute", left: 0, top: 0, width: 30, height: 30, borderLeftWidth: 3, borderTopWidth: 3, borderColor: palette.accent, borderTopLeftRadius: 9 },
    scanCornerTopRight: { position: "absolute", right: 0, top: 0, width: 30, height: 30, borderRightWidth: 3, borderTopWidth: 3, borderColor: palette.accent, borderTopRightRadius: 9 },
    scanCornerBottomLeft: { position: "absolute", left: 0, bottom: 0, width: 30, height: 30, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: palette.accent, borderBottomLeftRadius: 9 },
    scanCornerBottomRight: { position: "absolute", right: 0, bottom: 0, width: 30, height: 30, borderRightWidth: 3, borderBottomWidth: 3, borderColor: palette.accent, borderBottomRightRadius: 9 },
  });
}
