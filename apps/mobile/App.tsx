/**
 * Aloy Mobile — a thin client to the Aloy backend server (server/aloyServer.cjs)
 * running on the PC, reached over Tailscale. No on-device model — same brain,
 * same tools, same data as the desktop app's backend. Chat threads are owned
 * by the server (server/store.cjs) — this app never caches message history
 * locally, only the id of the currently-open thread.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView, Switch,
  KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet, Alert, Modal, Animated,
  PermissionsAndroid, AppState, Image, Linking, NativeModules, Keyboard
} from 'react-native';
// Core RN's own SafeAreaView has unreliable Android support (effectively a
// no-op on many devices) — react-native-safe-area-context queries the real
// per-device inset natively on both platforms and is the maintained fix.
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Menu, Settings as SettingsIcon, Disc3, Lightbulb, Lock, Unlock, LayoutDashboard, Mic, MicOff, Zap, Camera, Users, Thermometer, Image as ImageIcon, X, ArrowLeft, RefreshCw, Flame, RotateCcw, CheckCircle2, Plus, Code, Trash2, BookOpen, ChevronRight, Sparkles, Calendar, MessageSquare, Shield, ShieldCheck, Briefcase, Cpu, Landmark, Search, Brain, Layers, Globe, Tv, Square, Pencil } from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
import Tts from 'react-native-tts';
import notifee, { AndroidImportance, TriggerType } from '@notifee/react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  ActiveTicker,
  EnvironmentBento,
  UpcomingAgenda,
  StudioPortalCard,
  IntelligenceGrid,
  MediaBentoTile,
  MediaCastModal,
  MediaStackModal,
  RoomObserverBentoTile,
} from './src/components/CommandCenter';
import type { RoomObservation } from './src/components/CommandCenter/RoomObserverBentoTile';
import {
  StudioHeader,
  SubTabBar,
  PulseGrid,
  EmptyState,
} from './src/components/common';

const DEFAULT_SERVER_URL = process.env.ALOY_SERVER_URL || 'http://127.0.0.1:7890';
// SECURITY: this used to be a live 64-hex bearer token committed in source.
// It shipped inside the APK, was auto-persisted to AsyncStorage on first
// launch, and was pre-filled into the Settings field — so anyone with the
// installed app had full access to every /api route on the server. Rotate the
// old value on the server; this now defaults to empty and the user pastes
// their token in Settings once.
const DEFAULT_AUTH_TOKEN = process.env.ALOY_MOBILE_TOKEN || '';
const DRAWER_WIDTH = 300;
const PROJECT_STATUS_POLL_MS = 20000;
const SMART_HOME_POLL_MS = 30000;
const REMINDER_NOTIFY_POLL_MS = 60000;
// Skills dashboard data only changes once/day via the server's nightly
// auto-teaching run (see server/skillsDashboard.cjs) — mirrors the desktop
// sidebar's own 10-min poll interval rather than anything tighter.
const SKILLS_POLL_MS = 10 * 60 * 1000;
// Matches desktop DashboardView's own calendar refresh cadence.
const CALENDAR_POLL_MS = 5 * 60 * 1000;
// News data only changes when the scheduled scrape (every 4h server-side)
// or a manual refresh runs — matches the skills-poll rationale, no need
// for anything tighter.
const NEWS_POLL_MS = 5 * 60 * 1000;

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
// Same local faster-whisper server desktop's whisperstt.js uses — a
// separate process from the Aloy backend, same host, fixed port.
const WHISPER_PORT = 8890;

type ChatMessage = { role: 'user' | 'assistant'; content: string; answeredViaClaude?: boolean; image?: string };

// Data URLs (used for on-screen display) carry a "data:image/jpeg;base64,"
// prefix that Ollama's API rejects — it wants the raw base64 payload only,
// same convention the desktop app's own stripImage() follows.
const stripImage = (dataUrl: string | undefined | null): string | null => {
  if (!dataUrl) return null;
  const parts = dataUrl.split(',');
  return parts.length > 1 ? parts[1] : dataUrl;
};
type Thread = { id: string; title: string; createdAt: string };
type HAEntity = { entity_id: string; state: string; name: string; attributes?: any };
type Reminder = { id: string; text: string; dueAt: string | null; completed: boolean };
type SkillsCategory = { name: string; proficiencyScore: number; proficiencyLabel: string; confirmedCount: number; gapCount: number; needsReviewCount: number };
type SkillsDashboard = { overallProficiencyScore: number; needsReviewCount: number; categories: SkillsCategory[] };
type ProjectStatus = {
  name: string;
  folderPath?: string;
  summary: {
    statusMessage: string | null;
    progressPct: number | null;
    step: { current: number; total: number; label: string } | null;
    lastCompleted: { disc_label?: string; episodes_saved?: number } | null;
  };
};
type CalendarEvent = { calendar: string; summary: string; start: string };
type NewsArticle = { id: string; title: string; url: string; sourceName: string; relevanceReason: string; scrapedAt: string };
type VisionEvent = { start: string; description: string };
type VisionEventsDetail = { hours: number; totalCount: number; routineCount: number; notable: VisionEvent[] };
type HephTask = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  branch: string;
  targetFiles: string[];
  stagedChanges: Array<{
    filePath: string;
    relativePath?: string;
    patch: string;
    additions: number;
    deletions: number;
    diffChunks?: Array<{ type: 'add' | 'del' | 'context'; content: string }>;
  }>;
  aiReview?: {
    provider: string;
    model: string;
    verdict: string;
    score: number;
    summary: string;
    critique: string;
    securityIssues?: string[];
  };
  createdAt: string;
  deployedAt?: string;
  rollbackSnapshotId?: string;
};
type HephTrainingStats = {
  totalSamples: number;
  positiveCount: number;
  correctionCount: number;
};
type AthenaTask = {
  id: string;
  query: string;
  depth: 'quick' | 'standard' | 'deep_dive';
  focusAreas: string[];
  status: 'queued' | 'researching' | 'synthesizing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  statusMessage: string;
  reportMarkdown: string | null;
  provider: string | null;
  sources: Array<{ title: string; snippet: string; url: string }>;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
};
type DashboardSection = 'hub' | 'conclave' | 'cauldron' | 'athena' | 'apollo' | 'minerva' | 'hermes' | 'smarthome' | 'skills' | 'news' | 'projects';

// Mirrors the desktop app's renderMessageContent: reasoning-capable models'
// <think>...</think> block is pulled out of the message so it can be shown
// in a collapsible drawer instead of as part of the main reply text.
function parseMessageContent(content: string) {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (!thinkMatch) return { reasoning: null as string | null, mainContent: content };
  return {
    reasoning: thinkMatch[1].trim(),
    mainContent: content.replace(/<think>[\s\S]*?<\/think>/, '').trim()
  };
}

// Formats a date-only "YYYY-MM-DD" (all-day calendar event) string for
// display WITHOUT going through new Date("YYYY-MM-DD") — that constructor
// parses the string as UTC midnight, which then renders as the PREVIOUS
// day once toLocaleDateString formats it back in a negative-UTC-offset
// timezone (e.g. Pacific) — a real bug caught live: an event dated Aug 15
// displayed as "Aug 14" on the phone. Parsing the Y/M/D components
// directly into the local-time Date constructor sidesteps the UTC
// round-trip entirely.
function formatAgendaDateOnly(dateOnlyStr: string) {
  // Handles BOTH shapes. The Fitness tab passes a full timed ISO string
  // ("2026-08-29T10:00:00-07:00"), where the naive split yields
  // ["2026","08","29T10:00:00","07:00"] -> Number("29T10:00:00") is NaN ->
  // "Invalid Date" on every workout card. Timed strings are safe to hand to
  // the Date constructor directly; only date-ONLY strings need the manual
  // component parse that avoids the UTC round-trip described above.
  if (!dateOnlyStr) return '';
  if (dateOnlyStr.includes('T')) {
    const dt = new Date(dateOnlyStr);
    return Number.isNaN(dt.getTime())
      ? ''
      : dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  const [y, m, d] = dateOnlyStr.split('-').map(Number);
  if ([y, m, d].some((v) => !Number.isFinite(v))) return '';
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Same cleanup desktop's ChatArea.jsx speakText() applies before handing
// text to a TTS engine — strip code blocks and markdown punctuation so it
// doesn't get read aloud literally.
function cleanForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, 'Code block omitted.')
    .replace(/\[ACTION:[\s\S]*?\]/g, '')
    .replace(/\[COMMAND:[\s\S]*?\]/g, '')
    .replace(/[*_#`~]/g, '');
}

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [authToken, setAuthToken] = useState('');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [urlInput, setUrlInput] = useState(DEFAULT_SERVER_URL);
  const [tokenInput, setTokenInput] = useState('');

  const [threads, setThreads] = useState<Thread[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [threadsVisible, setThreadsVisible] = useState(false);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  // Slides the drawer in whenever it becomes visible. Spring rather than a
  // timed ease so it settles with a slight overshoot, matching the desktop
  // app's framer-motion drawers/modals (all `type: 'spring'`) instead of
  // reading as a flatter, more mechanical slide. restSpeedThreshold/
  // restDisplacementThreshold are loosened from RN's very tight defaults
  // (0.001) — otherwise the spring keeps making imperceptible residual
  // oscillations for a second or two after it visually looks settled, and
  // since closeDrawer's onRest callback (below) is what removes the dark
  // backdrop, that invisible tail read as the backdrop "getting stuck" dark.
  const SPRING_CONFIG = { useNativeDriver: true, damping: 20, stiffness: 200, mass: 0.9, restSpeedThreshold: 5, restDisplacementThreshold: 5 };
  useEffect(() => {
    if (threadsVisible) {
      drawerAnim.setValue(-DRAWER_WIDTH);
      Animated.spring(drawerAnim, { toValue: 0, ...SPRING_CONFIG }).start();
    }
  }, [threadsVisible]);

  // Slides out, then unmounts — so closing always animates instead of
  // vanishing instantly regardless of what triggered it (backdrop tap,
  // Close button, or picking/creating a thread).
  const closeDrawer = () => {
    Animated.spring(drawerAnim, { toValue: -DRAWER_WIDTH, ...SPRING_CONFIG }).start(() => {
      setThreadsVisible(false);
    });
  };

  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [isNewsRefreshing, setIsNewsRefreshing] = useState(false);
  const [haCategories, setHaCategories] = useState<{ lights: HAEntity[]; locks: HAEntity[]; climate: HAEntity[] }>({ lights: [], locks: [], climate: [] });
  const [escalationStats, setEscalationStats] = useState<{ count: number; lastAt: string | null } | null>(null);
  // Accepts optional overrides for the same reason refreshProjectStatuses/
  // refreshSmartHome below already do: called once from the app-startup
  // effect (see the big useEffect further down) BEFORE the serverUrl/
  // authToken state has actually committed from AsyncStorage, so relying on
  // the closed-over serverUrl/authToken there would silently hit
  // DEFAULT_SERVER_URL (the phone's own loopback, nothing listening) with an
  // empty token — a real bug found 2026-08-11 while debugging why the new
  // Skills widget never loaded: it inherited this same stale-closure issue,
  // just more visible since its poll interval is 10 minutes (vs. these
  // three's 30-45s), so it never got a chance to self-correct in testing.
  const refreshEscalationStats = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setEscalationStats(await apiRequest('GET', '/api/escalations/stats', undefined, urlOverride, tokenOverride));
    } catch {
      // Non-critical — leave the widget hidden/stale rather than surface an error.
    }
  };

  // "Last vision event" drawer widget for the 5 local-Ollama camera
  // automations (front door doorbell, driveway Amazon-driver detection,
  // game room gaming detection, backyard/behind-garage person descriptions).
  const [visionStats, setVisionStats] = useState<{ count: number; lastEventAt: string | null; lastNotable: { description: string } | null } | null>(null);
  const refreshVisionStats = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setVisionStats(await apiRequest('GET', '/api/llm-vision/stats', undefined, urlOverride, tokenOverride));
    } catch {
      // Non-critical — leave the widget hidden/stale rather than surface an error.
    }
  };

  // Vision Events screen — the full browsable list behind the glance widget
  // above. Fetched on open, not polled (same reasoning as the Dashboard
  // modal): only worth the request when actually looking at it. New
  // GET /api/llm-vision/events server route (server/aloyServer.cjs) returns
  // the routine-filtered event list; the stats route only has a one-line
  // summary, not enough to render a real list.
  const [visionEventsVisible, setVisionEventsVisible] = useState(false);
  const [visionEventsData, setVisionEventsData] = useState<VisionEventsDetail | null>(null);
  const openVisionEvents = async () => {
    setVisionEventsVisible(true);
    try {
      setVisionEventsData(await apiRequest('GET', '/api/llm-vision/events?hours=24'));
    } catch (err: any) {
      Alert.alert('Connection error', err.message || 'Could not reach the Aloy server.');
    }
  };

  // "How many clients are connected" drawer widget — same data/endpoint the
  // desktop sidebar reads (see server/clientTracker.cjs): every device
  // shares one bearer token, so "connected" means "made an authenticated
  // request in the last activeWindowMinutes," not a real persistent session.
  const [connectedClients, setConnectedClients] = useState<{ activeCount: number; activeWindowMinutes: number; clients: { ip: string; isLocal: boolean; secondsAgo: number }[] } | null>(null);
  const refreshConnectedClients = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setConnectedClients(await apiRequest('GET', '/api/clients', undefined, urlOverride, tokenOverride));
    } catch {
      // Non-critical — leave the widget hidden/stale rather than surface an error.
    }
  };

  const [jellyfinStatus, setJellyfinStatus] = useState<{ online: boolean; serverName?: string }>({ online: true, serverName: 'Aloy Server' });
  const [jellyfinSessions, setJellyfinSessions] = useState<any[]>([]);
  const [mediaCastVisible, setMediaCastVisible] = useState(false);
  const [mediaStackVisible, setMediaStackVisible] = useState(false);
  const refreshJellyfin = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const [statusRes, sessRes] = await Promise.all([
        apiRequest('GET', '/api/jellyfin/status', undefined, urlOverride, tokenOverride).catch(() => null),
        apiRequest('GET', '/api/jellyfin/sessions', undefined, urlOverride, tokenOverride).catch(() => null)
      ]);
      if (statusRes?.success && statusRes.status) {
        setJellyfinStatus(statusRes.status);
      }
      if (sessRes?.success && Array.isArray(sessRes.sessions)) {
        setJellyfinSessions(sessRes.sessions);
      }
    } catch {
      // Non-critical
    }
  };

  const handleToggleJellyfinPlayback = async (session: any) => {
    try {
      const isPaused = session.playState?.isPaused ?? session.nowPlaying?.isPaused ?? false;
      const cmd = isPaused ? 'Unpause' : 'Pause';
      await apiRequest('POST', '/api/jellyfin/control', {
        sessionId: session.id,
        command: cmd,
        params: {}
      });
      setTimeout(() => refreshJellyfin(), 400);
    } catch (err: any) {
      Alert.alert('Playback Error', err.message || 'Could not send command to Jellyfin.');
    }
  };

  // Skills dashboard — same GET /api/skills-dashboard endpoint and data
  // shape the desktop app's SkillsDashboard.jsx and sidebar widget use.
  // Kept fresh via a slow poll (data only changes once/day) and reused
  // directly by both the drawer glance widget and the Dashboard modal's
  // Skills tab below — no separate fetch-on-tab-open needed.
  const [skillsOverview, setSkillsOverview] = useState<SkillsDashboard | null>(null);
  const refreshSkillsOverview = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setSkillsOverview(await apiRequest('GET', '/api/skills-dashboard', undefined, urlOverride, tokenOverride));
    } catch {
      // Non-critical — leave the widget hidden/stale rather than surface an error.
    }
  };

  // Dashboard (Reminders / Profile) — fetched on open rather than polled
  // continuously, unlike Smart Home/project status: none of this is
  // time-critical enough to justify a background timer and extra battery/
  // network use. Finance dropped 2026-08-11 — not actually used.
  const [dashboardVisible, setDashboardVisible] = useState(false);
  const [dashboardSection, setDashboardSection] = useState<DashboardSection>('hub');

  // HEPHAESTUS (Heph) state & actions
  const [hephTasks, setHephTasks] = useState<HephTask[]>([]);
  const [hephStats, setHephStats] = useState<HephTrainingStats | null>(null);
  // Declared but never set and never read, so the Forge, Athena and Pantheon
  // screens showed no loading indicator at all — they just looked empty while
  // their fetches ran. Kept and wired to the refresh handler rather than
  // deleted, since an empty screen and a loading screen must not look alike.
  const [isHephLoading, setIsHephLoading] = useState(false);
  const [createTaskModalVisible, setCreateTaskModalVisible] = useState(false);
  const [newHephTitle, setNewHephTitle] = useState('');
  const [newHephDesc, setNewHephDesc] = useState('');
  const [newHephCategory, setNewHephCategory] = useState<'feature' | 'bugfix' | 'refactor'>('feature');
  const [expandedDiffs, setExpandedDiffs] = useState<{ [id: string]: boolean }>({});
  const [hephViewFilter, setHephViewFilter] = useState<'active' | 'deployed'>('active');

  const refreshHephTasks = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setIsHephLoading(true);
      const [tasks, stats] = await Promise.all([
        apiRequest('GET', '/api/hephaestus/tasks', undefined, urlOverride, tokenOverride).catch(() => []),
        apiRequest('GET', '/api/hephaestus/training-stats', undefined, urlOverride, tokenOverride).catch(() => null)
      ]);
      setHephTasks(tasks || []);
      setHephStats(stats);
    } catch {
      // Non-critical
    } finally {
      setIsHephLoading(false);
    }
  };

  const handleApproveHephTask = async (taskId: string) => {
    try {
      const res = await apiRequest('POST', `/api/hephaestus/tasks/${taskId}/approve`);
      if (res?.success) {
        Alert.alert('Deployed!', 'Code changes deployed with rollback snapshot.');
        refreshHephTasks();
      } else {
        Alert.alert('Deployment Failed', res?.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not deploy task');
    }
  };

  const handleRejectHephTask = async (taskId: string) => {
    try {
      await apiRequest('POST', `/api/hephaestus/tasks/${taskId}/reject`);
      refreshHephTasks();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not reject task');
    }
  };

  const handleDeleteHephTask = async (taskId: string) => {
    try {
      await apiRequest('DELETE', `/api/hephaestus/tasks/${taskId}`);
      refreshHephTasks();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not delete task');
    }
  };

  const handleRollbackHephTask = async (taskId: string) => {
    try {
      const res = await apiRequest('POST', `/api/hephaestus/tasks/${taskId}/rollback`);
      if (res?.success) {
        Alert.alert('Rollback Succeeded', 'Files restored to pre-deployment snapshot.');
        refreshHephTasks();
      } else {
        Alert.alert('Rollback Failed', res?.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not rollback task');
    }
  };

  const handleCreateHephTask = async () => {
    if (!newHephTitle.trim()) return;
    try {
      await apiRequest('POST', '/api/hephaestus/tasks', {
        title: newHephTitle.trim(),
        description: newHephDesc.trim(),
        category: newHephCategory,
        requestedBy: 'mobile_user'
      });
      setNewHephTitle('');
      setNewHephDesc('');
      setCreateTaskModalVisible(false);
      refreshHephTasks();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not create task');
    }
  };

  // ATHENA Research Scout state & actions
  const [athenaTasks, setAthenaTasks] = useState<AthenaTask[]>([]);
  // Declared but never set and never read, so the Forge, Athena and Pantheon
  // screens showed no loading indicator at all — they just looked empty while
  // their fetches ran. Kept and wired to the refresh handler rather than
  // deleted, since an empty screen and a loading screen must not look alike.
  const [isAthenaLoading, setIsAthenaLoading] = useState(false);
  const [createAthenaModalVisible, setCreateAthenaModalVisible] = useState(false);
  const [newAthenaQuery, setNewAthenaQuery] = useState('');
  const [newAthenaDepth, setNewAthenaDepth] = useState<'quick' | 'standard' | 'deep_dive'>('standard');
  const [newAthenaFocus, setNewAthenaFocus] = useState('');
  const [athenaStatusFilter, setAthenaStatusFilter] = useState('all');
  const [expandedAthenaDossiers, setExpandedAthenaDossiers] = useState<{ [id: string]: boolean }>({});

  const refreshAthenaTasks = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setIsAthenaLoading(true);
      const tasks = await apiRequest('GET', '/api/athena/tasks', undefined, urlOverride, tokenOverride).catch(() => []);
      setAthenaTasks(tasks || []);
    } catch {
      // Non-critical
    } finally {
      setIsAthenaLoading(false);
    }
  };

  const handleCreateAthenaTask = async () => {
    if (!newAthenaQuery.trim()) return;
    try {
      const focusAreas = newAthenaFocus.split(',').map((s) => s.trim()).filter(Boolean);
      await apiRequest('POST', '/api/athena/tasks', {
        query: newAthenaQuery.trim(),
        depth: newAthenaDepth,
        focusAreas,
        requestedBy: 'mobile_user'
      });
      setNewAthenaQuery('');
      setNewAthenaFocus('');
      setCreateAthenaModalVisible(false);
      refreshAthenaTasks();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not dispatch research mission');
    }
  };

  const handleDeleteAthenaTask = async (taskId: string) => {
    try {
      await apiRequest('DELETE', `/api/athena/tasks/${taskId}`);
      refreshAthenaTasks();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not delete dossier');
    }
  };

  // HEPHAESTUS Mobile Sub-tab State
  const [hephMobileTab, setHephMobileTab] = useState<'tasks' | 'projects'>('tasks');

  // APOLLO Vault, Skills & Memory Gardener State
  const [apolloMemories, setApolloMemories] = useState<string[]>([]);
  const [apolloLoading, setApolloLoading] = useState(false);
  const [apolloMobileTab, setApolloMobileTab] = useState<'memories' | 'skills' | 'profile' | 'vault'>('memories');
  const [userName, setUserName] = useState('');
  const [userStyle, setUserStyle] = useState('');

  const refreshUserProfile = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const p = await apiRequest('GET', '/api/profile', undefined, urlOverride, tokenOverride).catch(() => null);
      if (p) {
        if (p.name) setUserName(p.name);
        if (p.style) setUserStyle(p.style);
      }
    } catch {}
  };

  const saveUserProfile = async () => {
    try {
      await apiRequest('PUT', '/api/profile', { name: userName, style: userStyle });
      Alert.alert('Profile Saved', 'User profile updated successfully.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save profile');
    }
  };

  const refreshApollo = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const d = await apiRequest('GET', '/api/store', undefined, urlOverride, tokenOverride).catch(() => null);
      if (d?.memories) setApolloMemories(d.memories);
      refreshSkillsOverview(urlOverride, tokenOverride);
      refreshUserProfile(urlOverride, tokenOverride);
    } catch {}
  };

  const handleApolloGarden = async () => {
    try {
      setApolloLoading(true);
      const res = await apiRequest('POST', '/api/apollo/garden-memories', undefined, undefined, undefined, 120000);
      Alert.alert('Apollo Gardening Complete', `${res?.finalCount ?? 0} unique facts retained (pruned ${res?.prunedCount ?? 0} duplicates).`);
      if (res?.memories) setApolloMemories(res.memories);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Gardening failed');
    } finally {
      setApolloLoading(false);
    }
  };

  const handleApolloAutoTeach = async () => {
    try {
      setApolloLoading(true);
      const res = await apiRequest('POST', '/api/skills/auto-teach', undefined, undefined, undefined, 300000);
      Alert.alert('Auto-Teaching Complete', `${res?.newlyLearnedCount ?? 0} facts confirmed into memory.`);
      refreshSkillsOverview();
      refreshApollo();
    } catch (err: any) {
      Alert.alert('Auto-Teaching Error', err.message || 'Auto-teaching failed');
    } finally {
      setApolloLoading(false);
    }
  };
  const handleApolloSyncVault = async () => {
    try {
      setApolloLoading(true);
      await apiRequest('POST', '/api/apollo/sync-vault');
      Alert.alert('Vault Synchronized', 'Apollo has synced all memories and skills to your Obsidian Vault.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Vault sync failed');
    } finally {
      setApolloLoading(false);
    }
  };

  // MINERVA Sentinel State
  const [minervaHealth, setMinervaHealth] = useState<any>(null);
  const [minervaLoading, setMinervaLoading] = useState(false);
  const refreshMinervaHealth = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setMinervaLoading(true);
      const rep = await apiRequest('GET', '/api/minerva/health', undefined, urlOverride, tokenOverride).catch(() => null);
      setMinervaHealth(rep);
    } catch {} finally {
      setMinervaLoading(false);
    }
  };

  // ROOM OBSERVER State & Remote Triggers
  const [roomObservation, setRoomObservation] = useState<RoomObservation | null>(null);
  const [isRoomObserving, setIsRoomObserving] = useState(false);
  const [snapshotModalData, setSnapshotModalData] = useState<{ url: string; obs: RoomObservation } | null>(null);

  const refreshRoomObservation = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const res = await apiRequest('GET', '/api/observer/latest', undefined, urlOverride, tokenOverride).catch(() => null);
      if (res?.observation) {
        setRoomObservation(res.observation);
      }
    } catch {}
  };

  const handleObserveRoomFromMobile = async () => {
    setIsRoomObserving(true);
    try {
      // Trigger live room observation on Aloy server / workstation
      // NOTE: this posts { message } while resolvePendingCall below posts
      // { apiMessages, pendingCalls, approvals, ... }. The server's
      // /api/chat/resolve reads the latter shape, so this call does nothing.
      // Left as-is rather than guessed at — it needs a decision about which
      // endpoint "observe the room" should actually hit.
      await apiRequest('POST', '/api/chat/resolve', {
        message: 'Aloy, observe the room and workstation through your Logitech webcam now.'
      }, undefined, undefined, 180000).catch((err) =>
        console.warn('[room-observe] resolve failed:', err?.message || err));
      await refreshRoomObservation();
    } catch (err: any) {
      Alert.alert('Observation Error', err.message || 'Could not observe room');
    } finally {
      setIsRoomObserving(false);
    }
  };

  // HERMES Operations State
  const [hermesMobileTab, setHermesMobileTab] = useState<'brief' | 'jobs' | 'fitness' | 'portfolio'>('brief');
  const [expandedWorkoutId, setExpandedWorkoutId] = useState<string | null>(null);
  const [hermesBrief, setHermesBrief] = useState<any>(null);
  const [hermesBudget, setHermesBudget] = useState<any>(null);
  const [hermesLoading, setHermesLoading] = useState(false);
  const [jobListings, setJobListings] = useState<any[]>([]);
  const [isScanningJobs, setIsScanningJobs] = useState(false);
  const [hermesPortfolio, setHermesPortfolio] = useState<any>(null);
  const [shareInputs, setShareInputs] = useState<{ [symbol: string]: string }>({});
  const [savingShareSymbol, setSavingShareSymbol] = useState<string | null>(null);

  const WORKOUT_KEYWORDS = [
    'gym', 'workout', 'work out', 'run', 'running', 'yoga', 'cardio', 'cycling',
    'spin class', 'swim', 'lift', 'lifting', 'leg day', 'push day', 'pull day',
    'arm day', 'crossfit', 'pilates', 'hiit', 'bootcamp', 'training session',
    'personal training', 'exercise'
  ];
  const NON_WORKOUT_KEYWORDS = ['meal', 'snack'];
  const isWorkoutEvent = (summary?: string) => {
    if (!summary) return false;
    const lower = summary.toLowerCase();
    if (NON_WORKOUT_KEYWORDS.some((kw) => lower.includes(kw))) return false;
    return WORKOUT_KEYWORDS.some((kw) => lower.includes(kw));
  };

  const refreshHermes = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setHermesLoading(true);
      const [brief, budget, jobs, portfolio] = await Promise.all([
        apiRequest('GET', '/api/hermes/daily-brief?userName=User', undefined, urlOverride, tokenOverride).catch(() => null),
        apiRequest('GET', '/api/hermes/budget-health', undefined, urlOverride, tokenOverride).catch(() => null),
        apiRequest('GET', '/api/jobs/listings', undefined, urlOverride, tokenOverride).catch(() => null),
        apiRequest('GET', '/api/hermes/portfolio', undefined, urlOverride, tokenOverride).catch(() => null)
      ]);
      setHermesBrief(brief);
      setHermesBudget(budget);
      if (jobs?.listings) setJobListings(jobs.listings);
      setHermesPortfolio(portfolio);
    } catch {} finally {
      setHermesLoading(false);
    }
  };

  const handleSaveShares = async (symbol: string) => {
    const raw = shareInputs[symbol];
    if (raw === undefined) return;
    try {
      setSavingShareSymbol(symbol);
      await apiRequest('POST', '/api/hermes/portfolio/shares', { symbol, shares: raw === '' ? null : Number(raw) });
      const updated = await apiRequest('GET', '/api/hermes/portfolio');
      setHermesPortfolio(updated);
      setShareInputs((prev) => {
        const next = { ...prev };
        delete next[symbol];
        return next;
      });
    } catch (err: any) {
      Alert.alert('Error', err.message || `Failed to update ${symbol} shares`);
    } finally {
      setSavingShareSymbol(null);
    }
  };

  const handleScanJobsMobile = async () => {
    try {
      setIsScanningJobs(true);
      const res = await apiRequest('POST', '/api/jobs/scan', {}, undefined, undefined, 180000);
      Alert.alert('Job Radar Scan Complete', `${res?.newJobsCount ?? 0} new Technical Writer & Content Dev postings detected!`);
      const jobs = await apiRequest('GET', '/api/jobs/listings').catch(() => null);
      if (jobs?.listings) setJobListings(jobs.listings);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Job scan failed');
    } finally {
      setIsScanningJobs(false);
    }
  };

  const handleUpdateJobStatusMobile = async (id: string, status: string) => {
    try {
      await apiRequest('POST', `/api/jobs/${id}/status`, { status });
      setJobListings(prev => prev.map(j => (j.id === id || j.jobId === id) ? { ...j, status } : j));
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update job status');
    }
  };

  // PANTHEON STRATEGIC COUNCIL (Conclave) State & Actions
  const [conclaveData, setConclaveData] = useState<any>(null);
  const [conclaveHistory, setConclaveHistory] = useState<any[]>([]);
  // Declared but never set and never read, so the Forge, Athena and Pantheon
  // screens showed no loading indicator at all — they just looked empty while
  // their fetches ran. Kept and wired to the refresh handler rather than
  // deleted, since an empty screen and a loading screen must not look alike.
  const [isConclaveLoading, setIsConclaveLoading] = useState(false);
  const [isConveningConclave, setIsConveningConclave] = useState(false);
  const [conclaveMobileTab, setConclaveMobileTab] = useState<'minutes' | 'telemetry' | 'directives' | 'dossier' | 'history'>('minutes');
  const [conclaveDateFilter, setConclaveDateFilter] = useState<'ALL' | string>('ALL');
  const [conclaveSearchQuery, setConclaveSearchQuery] = useState('');

  const refreshConclave = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setIsConclaveLoading(true);
      const [latestRes, historyRes] = await Promise.all([
        apiRequest('GET', '/api/conclave/latest', undefined, urlOverride, tokenOverride).catch(() => null),
        apiRequest('GET', '/api/conclave/history', undefined, urlOverride, tokenOverride).catch(() => null)
      ]);
      if (latestRes?.conclave) setConclaveData(latestRes.conclave);
      if (historyRes?.history) setConclaveHistory(historyRes.history);
    } catch {} finally {
      setIsConclaveLoading(false);
    }
  };

  const handleConveneConclaveMobile = async () => {
    try {
      setIsConveningConclave(true);
      const res = await apiRequest('POST', '/api/conclave/convene', { manualTrigger: true }, undefined, undefined, 300000);
      if (res?.conclave) {
        setConclaveData(res.conclave);
        Alert.alert('Council Deliberation Complete', `Weekly Strategic Conclave completed with ${res.conclave.directives?.length || 0} directives dispatched.`);
        refreshConclave();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to convene council');
    } finally {
      setIsConveningConclave(false);
    }
  };

  const getMobileSessionDateKey = (dateVal: any) => {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatMobileDateLabel = (dateKey: string) => {
    if (!dateKey) return 'Unknown Date';
    const parts = dateKey.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return dateKey;
    const target = new Date(parts[0], parts[1] - 1, parts[2]);

    const now = new Date();
    const todayKey = getMobileSessionDateKey(now);

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayKey = getMobileSessionDateKey(yesterday);

    const dateFormatted = target.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    if (dateKey === todayKey) return `Today (${dateFormatted})`;
    if (dateKey === yesterdayKey) return `Yesterday (${dateFormatted})`;
    return dateFormatted;
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [expandedReasoning, setExpandedReasoning] = useState<{ [index: number]: boolean }>({});
  // Which user message (by index) is currently being edited, if any — lifted
  // up here rather than local to a FlatList row, since renderItem is a plain
  // closure, not its own component, and can't hold hooks of its own.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<any>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const listRef = useRef<FlatList>(null);
  const chatInputRef = useRef<TextInput>(null);
  const pendingWidgetActionRef = useRef<string | null>(null);
  const audioRecorderRef = useRef(new AudioRecorderPlayer()).current;

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setKeyboardVisible(true);
        setTimeout(() => {
          listRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    (async () => {
      const savedUrl = await AsyncStorage.getItem('aloy_server_url');
      const savedToken = await AsyncStorage.getItem('aloy_auth_token');
      const savedAutoSpeak = await AsyncStorage.getItem('aloy_auto_speak');
      if (savedAutoSpeak) setAutoSpeak(savedAutoSpeak === 'true');
      let url = savedUrl || DEFAULT_SERVER_URL;
      if (url.includes('127.0.0.1') || url.includes('localhost')) {
        url = DEFAULT_SERVER_URL;
        await AsyncStorage.setItem('aloy_server_url', url);
      }
      const token = savedToken || DEFAULT_AUTH_TOKEN;
      if (!savedToken) {
        await AsyncStorage.setItem('aloy_auth_token', token);
      }
      setUrlInput(url);
      setTokenInput(token);
      setServerUrl(url);
      setAuthToken(token);
      await initThreads(url, token);
      refreshEscalationStats(url, token);
      refreshVisionStats(url, token);
      refreshConnectedClients(url, token);
      refreshSkillsOverview(url, token);
      refreshHephTasks(url, token);
      refreshSmartHome(url, token);
      refreshProjectStatuses(url, token);
      refreshJellyfin(url, token);
      refreshRoomObservation(url, token);
    })();
  }, []);

  // timeoutMs is not optional in spirit: an unbounded fetch is what wedged
  // Athena for two days on the desktop side, and this client runs over
  // cellular where a connection can hang open indefinitely. Callers that are
  // legitimately slow (chat completions) should raise this explicitly rather
  // than the default being "wait forever".
  // One honest reachability signal. Every status pill in this app used to be
  // derived from Boolean(authToken) — i.e. "is a string saved on this phone" —
  // or from a bare literal, so the UI reported ONLINE with the server
  // unplugged. This records whether the last API call actually succeeded.
  const [serverReachable, setServerReachable] = useState(false);

  // The recorder was never stopped on unmount, so unmounting or backgrounding
  // mid-recording left the microphone live with the OS indicator lit.
  useEffect(() => () => {
    try {
      audioRecorderRef.current?.stopRecorder?.();
      audioRecorderRef.current?.removeRecordBackListener?.();
    } catch { /* already stopped */ }
    try { Tts.stop(); } catch { /* engine may not be initialised */ }
  }, []);

  // `externalSignal`: lets a caller cancel the request on demand (the chat
  // Stop button) without disturbing the timeout behavior above. Composed
  // with the internal timeout controller, not swapped in for it — mirrors
  // the desktop app's fetchWithTimeout.js, which solved this exact problem
  // for its own barge-in/stop-generation signal.
  const apiRequest = async (method: string, path: string, body?: any, urlOverride?: string, tokenOverride?: string, timeoutMs = 30000, externalSignal?: AbortSignal) => {
    const base = urlOverride ?? serverUrl;
    const tok = tokenOverride ?? authToken;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let signal = controller?.signal;
    if (externalSignal && controller) {
      signal = typeof (AbortSignal as any).any === 'function'
        ? (AbortSignal as any).any([externalSignal, controller.signal])
        : externalSignal;
    }
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        ...(signal ? { signal } : {}),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // `await`, not a bare return: without it the finally block clears the
      // abort timer the moment res.json() is CALLED, not when it resolves — so
      // a server that sends headers and then stalls mid-body hangs forever,
      // which is the exact cellular failure this timeout exists to prevent.
      setServerReachable(true);
      return await res.json();
    } catch (err) {
      // A network/abort failure means unreachable; an HTTP error means the
      // server answered, so it is reachable but unhappy. Only the former
      // should turn the pills off. A user-initiated cancel (Stop button) is
      // neither — the server was never at fault — so it's excluded here too.
      if (externalSignal?.aborted) throw err;
      if (err instanceof TypeError || (err as any)?.name === 'AbortError') setServerReachable(false);
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  // Loads the thread list, then opens the last-active thread (if it still
  // exists), the most recent one, or creates a fresh one if none exist yet.
  const initThreads = async (url: string, token: string) => {
    try {
      const list = await apiRequest('GET', '/api/chats', undefined, url, token);
      setThreads(list);
      const savedChatId = await AsyncStorage.getItem('aloy_active_chat_id');
      if (savedChatId && list.some((c: Thread) => c.id === savedChatId)) {
        await openThread(savedChatId, url, token);
      } else if (list.length > 0) {
        await openThread(list[0].id, url, token);
      } else {
        await createNewThread(url, token);
      }
    } catch (err: any) {
      Alert.alert('Connection error', err.message || 'Could not reach the Aloy server.');
    }
  };

  const refreshThreadTitles = async () => {
    try {
      setThreads(await apiRequest('GET', '/api/chats'));
    } catch {
      // Non-critical — the list just won't show an updated title yet.
    }
  };

  // Live tracked-project status (e.g. AutoRipManager) for the sidebar
  // widget — mirrors the desktop app's background poller, hitting the
  // server's dedicated /api/projects/status route instead of chat.
  const refreshProjectStatuses = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      setProjectStatuses(await apiRequest('GET', '/api/projects/status', undefined, urlOverride, tokenOverride));
    } catch {
      // Non-critical — widget just won't update this cycle.
    }
  };

  useEffect(() => {
    if (!authToken) return;
    refreshProjectStatuses();
    const interval = setInterval(() => refreshProjectStatuses(), PROJECT_STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  // Upcoming Agenda widget — mirrors refreshProjectStatuses above, hitting
  // the server's dedicated /api/calendar/events route (same
  // fetchGoogleCalendarEvents the desktop app's Agenda card and system-
  // prompt injection already use, added 2026-08-15 specifically for mobile).
  // The route returns events grouped by calendar in each calendar's own
  // chronological order, not merged across calendars — sorted here so a
  // chore-calendar entry doesn't get buried behind primary calendar
  // event regardless of which is actually next, and past-today timed events
  // are dropped so the list only ever shows what's actually still upcoming.
  const refreshCalendarEvents = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const events: CalendarEvent[] = await apiRequest('GET', '/api/calendar/events?days=2', undefined, urlOverride, tokenOverride);
      const now = Date.now();
      const sorted = events
        .filter((ev) => {
          if (!ev.start) return true;
          // Date-only (all-day) entries have no time component — keep those
          // for today even if "now" is later in the day.
          if (!ev.start.includes('T')) return true;
          return new Date(ev.start).getTime() >= now;
        })
        .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      setCalendarEvents(sorted);
    } catch {
      // Non-critical — widget just won't update this cycle.
    }
  };

  useEffect(() => {
    if (!authToken) return;
    refreshCalendarEvents();
    const interval = setInterval(() => refreshCalendarEvents(), CALENDAR_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  // Tech News tab — source/interest management stays desktop-only for now
  // (editing a URL list on a phone keyboard is painful); mobile just reads
  // the same cached feed. See server/newsScraper.cjs for how it's built.
  const refreshNewsArticles = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const articles: NewsArticle[] = await apiRequest('GET', '/api/news', undefined, urlOverride, tokenOverride);
      setNewsArticles(articles);
      const status = await apiRequest('GET', '/api/news/refresh/status', undefined, urlOverride, tokenOverride);
      setIsNewsRefreshing(!!status?.inProgress);
    } catch {
      // Non-critical — widget just won't update this cycle.
    }
  };

  useEffect(() => {
    if (!authToken) return;
    refreshNewsArticles();
    const interval = setInterval(() => refreshNewsArticles(), NEWS_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  useEffect(() => {
    if (!authToken) return;
    refreshRoomObservation();
    const interval = setInterval(() => refreshRoomObservation(), 15000);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  const handleNewsRefresh = async () => {
    setIsNewsRefreshing(true);
    try {
      const result = await apiRequest('POST', '/api/news/refresh', undefined, undefined, undefined, 120000);
      if (!result?.success) setIsNewsRefreshing(false);
      // On success, isNewsRefreshing stays true until the next poll tick
      // sees refreshStatus report the background job actually finished —
      // same reasoning as the desktop card, it can genuinely take minutes.
    } catch {
      setIsNewsRefreshing(false);
    }
  };

  // Live Smart Home lights/locks/climate for the drawer widget — mirrors
  // refreshProjectStatuses above, hitting the server's dedicated
  // /api/smarthome route. climate added 2026-08-12 — the server was always
  // sending the full haCategories (climate included), this was just
  // discarding it client-side.
  const refreshSmartHome = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const data = await apiRequest('GET', '/api/smarthome', undefined, urlOverride, tokenOverride);
      setHaCategories({
        lights: data.categories?.lights || [],
        locks: data.categories?.locks || [],
        climate: data.categories?.climate || []
      });
    } catch {
      // Non-critical — widget just won't update this cycle.
    }
  };

  useEffect(() => {
    if (!authToken) return;
    refreshSmartHome();
    const interval = setInterval(() => refreshSmartHome(), SMART_HOME_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  useEffect(() => {
    if (!authToken) return;
    const interval = setInterval(() => refreshVisionStats(), SMART_HOME_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  useEffect(() => {
    if (!authToken) return;
    const interval = setInterval(() => refreshConnectedClients(), SMART_HOME_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  useEffect(() => {
    if (!authToken) return;
    const interval = setInterval(() => refreshSkillsOverview(), SKILLS_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  useEffect(() => {
    if (!authToken) return;
    refreshJellyfin();
    // 4s meant ~43,000 requests a day, two per tick, whether or not the media
    // tile was even on screen. 20s is still well inside "feels live" for a
    // now-playing card and is a fifth of the radio time.
    const interval = setInterval(() => refreshJellyfin(), 20000);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  // Refetch every glance widget whenever the app returns to the foreground.
  useEffect(() => {
    if (!authToken) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshProjectStatuses();
        refreshSmartHome();
        refreshEscalationStats();
        refreshVisionStats();
        refreshConnectedClients();
        refreshSkillsOverview();
        refreshJellyfin();
      }
    });
    return () => subscription.remove();
  }, [authToken, serverUrl]);

  // Local push notifications for due reminders — mirrors desktop's own
  // dueCheckInterval (App.jsx) as a fallback for reminders already overdue
  // by the time the app polls. Future-dueAt reminders now ALSO get a real
  // OS-scheduled notifee trigger notification (see syncReminderTriggers
  // below) — Android's WorkManager fires these even if the app process is
  // fully killed, unlike the setInterval poll here which needs the app
  // alive. Not exact-timing (WorkManager can defer under battery
  // optimization/Doze by some minutes) — upgrading to AlarmManager-exact
  // scheduling would need the SCHEDULE_EXACT_ALARM manifest permission and
  // a user-facing "Alarms & reminders" grant, skipped here to avoid a new
  // AndroidManifest/permission surface for what's still a real improvement
  // over pure foreground polling. Anomaly-alert notifications (the other
  // half of desktop's notification set) are a separate deferred follow-up —
  // that detection runs entirely client-side on desktop's own local
  // finance/lock-history data, with no server endpoint exposing it yet.
  const notifiedReminderIdsRef = useRef<Set<string>>(new Set());
  const lastNotifiedVisionEventRef = useRef<string | null>(null);
  const scheduledReminderTriggerIdsRef = useRef<Set<string>>(new Set());
  const lastKnownHephTaskStatusesRef = useRef<{ [id: string]: string }>({});
  const hephInitialLoadDoneRef = useRef(false);

  // Reconciles OS-scheduled trigger notifications against the current
  // reminder list: schedules one for every incomplete, future-dueAt
  // reminder not already scheduled, and cancels any whose reminder has
  // since been completed/removed so a finished reminder can't still fire
  // later from a stale schedule. Already-overdue reminders are left to the
  // immediate-fire poll below (notifee trigger timestamps must be in the
  // future).
  const syncReminderTriggers = async (list: Reminder[]) => {
    const now = Date.now();
    const activeIds = new Set<string>();
    for (const r of list) {
      if (r.completed || !r.dueAt) continue;
      const dueMs = new Date(r.dueAt).getTime();
      if (dueMs <= now) continue;
      activeIds.add(r.id);
      if (scheduledReminderTriggerIdsRef.current.has(r.id)) continue;
      try {
        await notifee.createTriggerNotification(
          {
            id: `reminder-trigger-${r.id}`,
            title: 'Aloy — Reminder',
            body: r.text,
            android: { channelId: 'reminders', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } }
          },
          { type: TriggerType.TIMESTAMP, timestamp: dueMs }
        );
        scheduledReminderTriggerIdsRef.current.add(r.id);
      } catch {
        // Non-critical — the immediate-fire poll below still catches it once due.
      }
    }
    for (const id of Array.from(scheduledReminderTriggerIdsRef.current)) {
      if (!activeIds.has(id)) {
        try { await notifee.cancelTriggerNotification(`reminder-trigger-${id}`); } catch {}
        scheduledReminderTriggerIdsRef.current.delete(id);
      }
    }
  };

  useEffect(() => {
    notifee.requestPermission();
    notifee.createChannel({ id: 'reminders', name: 'Reminders', importance: AndroidImportance.HIGH });
    notifee.createChannel({ id: 'vision_alerts', name: 'Vision Alerts', importance: AndroidImportance.HIGH });
    notifee.createChannel({ id: 'heph_alerts', name: 'Hephaestus Engineering Alerts', importance: AndroidImportance.HIGH });
  }, []);

  useEffect(() => {
    if (!authToken) return;
    const checkHephAlerts = async () => {
      try {
        const list: HephTask[] = await apiRequest('GET', '/api/hephaestus/tasks');
        if (!Array.isArray(list)) return;

        if (!hephInitialLoadDoneRef.current) {
          for (const t of list) {
            lastKnownHephTaskStatusesRef.current[t.id] = t.status;
          }
          hephInitialLoadDoneRef.current = true;
          return;
        }

        for (const t of list) {
          const prevStatus = lastKnownHephTaskStatusesRef.current[t.id];
          if (!prevStatus) {
            lastKnownHephTaskStatusesRef.current[t.id] = t.status;
            if (t.status === 'staged_for_review') {
              await notifee.displayNotification({
                title: '🔥 Aloy Cauldron — Review Ready',
                // Was `|| 90` — an invented quality score in a notification about code
                // waiting to be deployed. `||` also rewrote a genuine 0 (a failed
                // review) to 90, i.e. the worst case displayed as a good one.
                body: t.aiReview?.score != null
                  ? `"${t.title}" staged with score ${t.aiReview.score}/100. Tap to review.`
                  : `"${t.title}" staged, not yet reviewed. Tap to review.`,
                android: { channelId: 'heph_alerts', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } }
              });
            }
          } else if (prevStatus !== t.status) {
            lastKnownHephTaskStatusesRef.current[t.id] = t.status;
            if (t.status === 'staged_for_review') {
              await notifee.displayNotification({
                title: '🔥 Aloy Cauldron — Review Ready',
                // Was `|| 90` — an invented quality score in a notification about code
                // waiting to be deployed. `||` also rewrote a genuine 0 (a failed
                // review) to 90, i.e. the worst case displayed as a good one.
                body: t.aiReview?.score != null
                  ? `"${t.title}" staged with score ${t.aiReview.score}/100. Tap to review.`
                  : `"${t.title}" staged, not yet reviewed. Tap to review.`,
                android: { channelId: 'heph_alerts', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } }
              });
            } else if (t.status === 'deployed') {
              await notifee.displayNotification({
                title: '🚀 Aloy — Feature Deployed',
                body: `"${t.title}" was deployed successfully to the live codebase.`,
                android: { channelId: 'heph_alerts', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } }
              });
            }
          }
        }
      } catch {
        // Non-critical
      }
    };
    checkHephAlerts();
    const interval = setInterval(checkHephAlerts, 10000);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  useEffect(() => {
    if (!authToken) return;
    const checkVisionEvents = async () => {
      try {
        const stats = await apiRequest('GET', '/api/llm-vision/stats');
        if (stats?.lastNotable?.description && stats.lastEventAt && stats.lastEventAt !== lastNotifiedVisionEventRef.current) {
          if (lastNotifiedVisionEventRef.current !== null) {
            await notifee.displayNotification({
              title: 'Aloy — Camera Event',
              body: stats.lastNotable.description,
              android: { channelId: 'vision_alerts', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } }
            });
          }
          lastNotifiedVisionEventRef.current = stats.lastEventAt;
        }
      } catch {
        // Non-critical
      }
    };
    checkVisionEvents();
    const interval = setInterval(checkVisionEvents, REMINDER_NOTIFY_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  useEffect(() => {
    if (!authToken) return;
    const checkDueReminders = async () => {
      try {
        const list: Reminder[] = await apiRequest('GET', '/api/reminders');
        await syncReminderTriggers(list);
        const now = Date.now();
        const due = list.filter((r) =>
          !r.completed && r.dueAt && new Date(r.dueAt).getTime() <= now && !notifiedReminderIdsRef.current.has(r.id)
        );
        for (const r of due) {
          notifiedReminderIdsRef.current.add(r.id);
          await notifee.displayNotification({
            title: 'Aloy — Reminder',
            body: r.text,
            android: { channelId: 'reminders', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } }
          });
        }
      } catch {
        // Non-critical — next poll tries again.
      }
    };
    checkDueReminders();
    const interval = setInterval(checkDueReminders, REMINDER_NOTIFY_POLL_MS);
    return () => clearInterval(interval);
  }, [authToken, serverUrl]);

  const toggleDevice = async (domain: string, service: string, entityId: string, extra?: { temperature?: number; hvac_mode?: string }) => {
    try {
      await apiRequest('POST', '/api/smarthome/execute', { domain, service, entity_id: entityId, ...extra });
      // The server's own haCategories cache only updates ~1s after a
      // successful execute (see aloyServer.cjs's setTimeout(refreshHA, 1000))
      // — refetching sooner than that would just re-show the stale state.
      setTimeout(refreshSmartHome, 1200);
    } catch (err: any) {
      Alert.alert('Connection error', err.message || 'Could not reach the Aloy server.');
    }
  };

  const openThread = async (id: string, urlOverride?: string, tokenOverride?: string) => {
    try {
      const chat = await apiRequest('GET', `/api/chats/${id}`, undefined, urlOverride, tokenOverride);
      setChatId(id);
      setMessages(
        (chat.messages || [])
          .filter((m: any) => m.role === 'user' || m.role === 'assistant')
          .map((m: any) => ({ role: m.role, content: m.content, ...(m.image ? { image: m.image } : {}) }))
      );
      setExpandedReasoning({});
      await AsyncStorage.setItem('aloy_active_chat_id', id);
    } catch (err: any) {
      Alert.alert('Connection error', err.message || 'Could not reach the Aloy server.');
    }
  };

  const createNewThread = async (urlOverride?: string, tokenOverride?: string) => {
    try {
      const chat = await apiRequest('POST', '/api/chats', {}, urlOverride, tokenOverride);
      setThreads((prev) => [{ id: chat.id, title: chat.title, createdAt: chat.createdAt }, ...prev]);
      setChatId(chat.id);
      setMessages([]);
      setExpandedReasoning({});
      await AsyncStorage.setItem('aloy_active_chat_id', chat.id);
    } catch (err: any) {
      Alert.alert('Connection error', err.message || 'Could not reach the Aloy server.');
    }
  };

  const deleteThread = async (id: string) => {
    try {
      await apiRequest('DELETE', `/api/chats/${id}`);
      const remaining = threads.filter((t) => t.id !== id);
      setThreads(remaining);
      if (id === chatId) {
        if (remaining.length > 0) await openThread(remaining[0].id);
        else await createNewThread();
      }
    } catch (err: any) {
      Alert.alert('Connection error', err.message || 'Could not reach the Aloy server.');
    }
  };

  const saveSettings = async () => {
    // Normalise before storing. A pasted token carries a trailing newline more
    // often than not, and a URL with a trailing slash produced `...:7890//api/
    // chats`. Both failed with a generic error and — because almost every
    // caller swallows failures — showed up as an app that simply had no data.
    const url = urlInput.trim().replace(/\/+$/, '');
    const token = tokenInput.trim();
    setServerUrl(url);
    setAuthToken(token);
    await AsyncStorage.setItem('aloy_server_url', url);
    await AsyncStorage.setItem('aloy_auth_token', token);
    setSettingsVisible(false);
    if (threads.length === 0 && !chatId) await initThreads(url, token);
  };

  // Applies immediately (a Switch, not part of the URL/Token "Save" flow).
  const toggleAutoSpeak = async (value: boolean) => {
    setAutoSpeak(value);
    await AsyncStorage.setItem('aloy_auto_speak', String(value));
  };

  // Same local faster-whisper server desktop's whisperstt.js posts to —
  // just a different port on the same host as the Aloy backend.
  const whisperUrl = () => serverUrl.replace(/:\d+$/, `:${WHISPER_PORT}`);

  // Tap to start, tap again to stop — mirrors desktop's push-to-talk mic
  // button rather than auto-sending, so the transcription can be reviewed/
  // edited before it's sent.
  const toggleMicListening = async () => {
    if (isRecording) {
      const path = await audioRecorderRef.stopRecorder();
      audioRecorderRef.removeRecordBackListener();
      setIsRecording(false);
      setIsTranscribing(true);
      try {
        const formData = new FormData();
        formData.append('audio', {
          uri: path.startsWith('file://') ? path : `file://${path}`,
          type: 'audio/mp4',
          name: 'recording.m4a'
        } as any);
        // whisper_server.py runs actual CUDA inference here (unlike its
        // /health endpoint, which does no GPU work) — if Ollama is also
        // using the GPU at the same time, transcription can hang under that
        // contention even though the server is otherwise healthy. Without a
        // timeout this leaves isTranscribing stuck true forever with no
        // alert at all — confirmed as a real desktop bug 2026-08-03, fixed
        // the same way here for consistency.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        let res;
        try {
          res = await fetch(`${whisperUrl()}/transcribe`, { method: 'POST', body: formData, headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal });
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw new Error('Whisper transcription timed out after 45s — it may be GPU-contended with Ollama, or the server needs a restart.');
          }
          throw err;
        } finally {
          clearTimeout(timeout);
        }
        if (!res.ok) throw new Error(`Whisper HTTP status ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.text) setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
      } catch (err: any) {
        Alert.alert('Transcription error', err.message || 'Could not reach the local Whisper server.');
      } finally {
        setIsTranscribing(false);
      }
      return;
    }

    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Microphone permission needed', 'Aloy needs microphone access for voice input.');
        return;
      }
    }
    try {
      await audioRecorderRef.startRecorder();
      setIsRecording(true);
    } catch (err: any) {
      Alert.alert('Microphone error', err.message || 'Could not start recording.');
    }
  };

  const pickImage = async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.6 });
      if (result.didCancel) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        if (result.errorMessage) Alert.alert('Photo error', result.errorMessage);
        return;
      }
      setAttachedImage(`data:${asset.type || 'image/jpeg'};base64,${asset.base64}`);
    } catch (err: any) {
      Alert.alert('Photo error', err.message || 'Could not open photo library.');
    }
  };

  // `overrideText` exists because the notification deep link below calls this
  // with a canned prompt. It used to pass that string to a zero-parameter
  // function, so the argument was silently dropped and the Walk-Up Morning
  // Briefing sent nothing at all. Callers wired to UI events must invoke this
  // as `() => sendMessage()` — a bare `onPress={sendMessage}` would hand React's
  // event object in as the override.
  // In-flight send: lets the Stop button cancel a request, and drives the
  // "what's happening" status text polled from the server (see
  // GET /api/chat/status/:turnId in aloyServer.cjs) so a long tool chain
  // reads as "Checking calendar…" instead of a bare spinner for up to 180s.
  const sendAbortRef = useRef<AbortController | null>(null);
  const [sendStatusText, setSendStatusText] = useState<string | null>(null);
  const sendStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStatusPolling = () => {
    if (sendStatusPollRef.current) {
      clearInterval(sendStatusPollRef.current);
      sendStatusPollRef.current = null;
    }
    setSendStatusText(null);
  };

  const startStatusPolling = (turnId: string) => {
    stopStatusPolling();
    sendStatusPollRef.current = setInterval(async () => {
      try {
        const res = await apiRequest('GET', `/api/chat/status/${turnId}`);
        if (res?.text) setSendStatusText(res.text);
      } catch {
        // Non-critical — the spinner alone still says "working" if this fails.
      }
    }, 800);
  };

  useEffect(() => () => stopStatusPolling(), []);

  // Cancels the in-flight send, if any. Not a failure — the server was never
  // at fault — so unlike a real connection error this adds nothing to the
  // transcript; the user's message stays, ready to edit or resend.
  const stopSending = () => {
    sendAbortRef.current?.abort();
  };

  // `baseMessages` lets a caller supply the history to send on top of,
  // rather than this closure's own `messages` — needed for edit-and-resend,
  // which truncates history and sends new text in the same logical action.
  // Reading `messages` there instead would race React's async setState: the
  // truncation wouldn't have landed yet, so the edited turn would still
  // carry everything after the edited message.
  const sendMessage = async (overrideText?: string, baseMessages?: ChatMessage[]) => {
    const text = (overrideText ?? input).trim();
    if ((!text && !attachedImage) || isSending || !chatId) return;
    if (!overrideText) setInput('');
    const image = attachedImage;
    setAttachedImage(null);
    const nextMessages = [...(baseMessages ?? messages), { role: 'user' as const, content: text, ...(image ? { image } : {}) }];
    setMessages(nextMessages);
    setIsSending(true);

    // Vision-capable local models are the exception, not the default (e.g.
    // qwen3:14b has no vision support) — mirrors the desktop app's own
    // forced-model behavior whenever an image is anywhere in the turn.
    const hasImage = nextMessages.some((m) => m.image);
    const apiMessages = nextMessages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.image ? { image: m.image, images: [stripImage(m.image)] } : {})
    }));

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    sendAbortRef.current = controller;
    startStatusPolling(turnId);

    try {
      // apiRequest defaults to 30s, which is fine for a status poll and far too
      // short for a local Ollama completion — especially the forced vision path.
      // Chats were aborting mid-generation and surfacing as "Connection error".
      const result = await apiRequest('POST', '/api/chat', {
        messages: apiMessages,
        chatId,
        turnId,
        ...(hasImage ? { model: 'gemma4:12b' } : {})
      }, undefined, undefined, 180000, controller.signal);
      await handleChatResult(nextMessages, result);
      refreshThreadTitles();
    } catch (err: any) {
      if (controller.signal.aborted) {
        setIsSending(false);
      } else {
        // Inline, in the transcript — not a blocking native alert. Matches
        // how every other failure in this send path (an unrecognised server
        // response, in handleChatResult below) already reports itself.
        setMessages([...nextMessages, {
          role: 'assistant',
          content: `⚠️ Couldn't reach the Aloy server: ${err.message || 'connection error'}`
        }]);
        setIsSending(false);
      }
    } finally {
      sendAbortRef.current = null;
      stopStatusPolling();
    }
  };

  // Regenerate: drop the assistant message at `index` and everything after
  // it, then replay the same prior turn — no new user text, so this talks
  // to /api/chat directly rather than going through sendMessage (whose whole
  // job is turning fresh input into a new user message).
  const regenerateFrom = async (index: number) => {
    if (isSending || !chatId) return;
    const truncated = messages.slice(0, index);
    const lastUser = [...truncated].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages(truncated);
    setIsSending(true);

    const hasImage = truncated.some((m) => m.image);
    const apiMessages = truncated.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.image ? { image: m.image, images: [stripImage(m.image)] } : {})
    }));

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    sendAbortRef.current = controller;
    startStatusPolling(turnId);

    try {
      const result = await apiRequest('POST', '/api/chat', {
        messages: apiMessages,
        chatId,
        turnId,
        ...(hasImage ? { model: 'gemma4:12b' } : {})
      }, undefined, undefined, 180000, controller.signal);
      await handleChatResult(truncated, result);
      refreshThreadTitles();
    } catch (err: any) {
      if (controller.signal.aborted) {
        setIsSending(false);
      } else {
        setMessages([...truncated, {
          role: 'assistant',
          content: `⚠️ Couldn't reach the Aloy server: ${err.message || 'connection error'}`
        }]);
        setIsSending(false);
      }
    } finally {
      sendAbortRef.current = null;
      stopStatusPolling();
    }
  };

  // Edit & resend: drop the user message at `index` and everything after
  // it, then hand the edited text to sendMessage exactly as if the user had
  // just typed it — the truncated history is passed explicitly rather than
  // relying on `messages` (see sendMessage's baseMessages note above).
  const editAndResend = (index: number, newText: string) => {
    if (isSending || !newText.trim()) return;
    sendMessage(newText.trim(), messages.slice(0, index));
  };

  // Collapses the server's full apiMessages (which include tool_calls/tool
  // entries for the model's own context) down to just user/assistant text
  // turns for display, appending only the newly produced assistant reply.
  const handleChatResult = async (baseMessages: ChatMessage[], result: any) => {
    // Only 'complete' and 'pending_confirmation' were handled, so any other
    // shape (an {type:'error'}, or a future server change) left isSending true
    // forever: permanent spinner, Send button disabled, no message, app restart
    // required. Anything unrecognised now clears the flag and says so.
    if (result?.type !== 'complete' && result?.type !== 'pending_confirmation') {
      setIsSending(false);
      setMessages([...baseMessages, {
        role: 'assistant',
        content: `The server returned an unexpected response${result?.error ? `: ${result.error}` : ''}. Nothing was sent.`
      }]);
      return;
    }
    if (result.type === 'complete') {
      setMessages([...baseMessages, { role: 'assistant', content: result.text, answeredViaClaude: !!result.answeredViaClaude }]);
      if (result.answeredViaClaude) refreshEscalationStats();
      setIsSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      if (autoSpeak && result.text) {
        const { mainContent } = parseMessageContent(result.text);
        Tts.stop();
        Tts.speak(cleanForSpeech(mainContent));
      }
      // Confidence-checking + Claude escalation happens server-side in the
      // background (server/aloyServer.cjs's maybeEscalateInBackground), well
      // after this response already returned — there's no push channel here,
      // so pick up a possible correction with one delayed re-fetch of the
      // thread rather than polling continuously. 15s covers the observed
      // worst case for the confidence check itself (harder questions can run
      // long chains of hidden local reasoning before it even decides whether
      // to escalate, before the Claude call on top of that).
      if (chatId) {
        // Capture the thread this reply belongs to. setMessages below writes to
        // whatever thread is CURRENTLY displayed, so switching threads inside
        // the 15s window appended thread A's revised Claude answer into thread
        // B's transcript. The timer is also tracked so it can be cancelled on
        // unmount instead of firing into a dead component.
        const revisionChatId = chatId;
        claudeRevisionTimerRef.current = setTimeout(async () => {
          try {
            const chat = await apiRequest('GET', `/api/chats/${revisionChatId}`);
            const serverCount = chat?.messages?.length || 0;
            const last = chat?.messages?.[serverCount - 1];
            // Only apply it if that thread is still the one on screen.
            if (last?.answeredViaClaude && chatIdRef.current === revisionChatId) {
              setMessages((prev) => {
                // Dedupe in case this thread already picked up the same
                // follow-up (e.g. the user reopened the app before the
                // timeout fired) or the user has since sent another message.
                if (prev.some((m) => m.answeredViaClaude && m.content.endsWith(last.content))) return prev;
                const formattedContent = last.content.startsWith('_') ? last.content : `_Checked with Claude — revised answer:_\n\n${last.content}`;
                return [...prev, { role: 'assistant', content: formattedContent, answeredViaClaude: true }];
              });
              setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
              refreshEscalationStats();
            }
          } catch {
            // Non-critical — the local answer already shown stands as-is.
          }
        }, 15000);
      }
    } else if (result.type === 'pending_confirmation') {
      setPendingConfirmation({ ...result, baseMessages });
      setIsSending(false);
    }
  };

  const resolvePendingCall = async (callId: string, approved: boolean) => {
    if (!pendingConfirmation) return;
    setIsSending(true);
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    sendAbortRef.current = controller;
    startStatusPolling(turnId);
    try {
      const result = await apiRequest('POST', '/api/chat/resolve', {
        apiMessages: pendingConfirmation.apiMessages,
        pendingCalls: pendingConfirmation.pendingCalls,
        approvals: { [callId]: approved },
        chatId,
        turnId,
        cleanMessages: pendingConfirmation.baseMessages
      }, undefined, undefined, 180000, controller.signal);
      const base = pendingConfirmation.baseMessages;
      setPendingConfirmation(null);
      await handleChatResult(base, result);
      refreshThreadTitles();
    } catch (err: any) {
      setPendingConfirmation(null);
      if (controller.signal.aborted) {
        setIsSending(false);
      } else {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `⚠️ Couldn't reach the Aloy server: ${err.message || 'connection error'}`
        }]);
        setIsSending(false);
      }
    } finally {
      sendAbortRef.current = null;
      stopStatusPolling();
    }
  };

  // Guards the one-shot consumption of the launch URL (see the deep-link effect).
  const initialUrlHandledRef = useRef(false);
  // Lets the delayed Claude-revision refetch check which thread is on screen
  // now, rather than trusting the chatId captured when it was scheduled.
  const chatIdRef = useRef<string | null>(null);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  const claudeRevisionTimerRef = useRef<any>(null);
  useEffect(() => () => { if (claudeRevisionTimerRef.current) clearTimeout(claudeRevisionTimerRef.current); }, []);

  const pendingDeepLinkRef = useRef<string | null>(null);

  const routeDeepLink = (url: string | null) => {
    if (!url) return;
    const cleanUrl = url.toLowerCase();
    if (cleanUrl.includes('voice')) {
      setDashboardVisible(false);
      if (!isRecording) toggleMicListening();
    } else if (cleanUrl.includes('briefing')) {
      setDashboardVisible(false);
      sendMessage("Good morning! Please give me my Walk-Up Morning Briefing with today's calendar schedule and home status.");
    } else if (cleanUrl.includes('lights') || cleanUrl.includes('smarthome')) {
      setDashboardSection('minerva');
      setDashboardVisible(true);
      refreshMinervaHealth();
      refreshSmartHome();
    } else if (cleanUrl.includes('agenda')) {
      setDashboardSection('hub');
      setDashboardVisible(true);
      refreshCalendarEvents();
    } else if (cleanUrl.includes('portfolio') || cleanUrl.includes('jobs') || cleanUrl.includes('hermes')) {
      setDashboardSection('hermes');
      setDashboardVisible(true);
      refreshHermes();
    } else if (cleanUrl.includes('chat') || cleanUrl.includes('ask') || cleanUrl.includes('open')) {
      setDashboardVisible(false);
      setTimeout(() => chatInputRef.current?.focus(), 300);
    }
  };

  // Handle Home Screen Widget Deep Links & Synchronization
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      if (!authToken || !chatId) {
        pendingDeepLinkRef.current = url;
      } else {
        routeDeepLink(url);
      }
    };

    // getInitialURL() keeps returning the launch URL for the life of the
    // process, and this effect's deps are [chatId, authToken, isRecording] — so
    // it re-ran and re-routed that same URL on every thread switch, token
    // change and mic toggle. Launching from the Briefing widget and then
    // opening another conversation re-sent the whole morning briefing.
    // Consume it exactly once.
    if (!initialUrlHandledRef.current) {
      initialUrlHandledRef.current = true;
      Linking.getInitialURL().then((url) => { if (url) handleUrl(url); });
    }
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [chatId, authToken, isRecording]);

  // Execute queued deep link once authToken and chatId are ready
  useEffect(() => {
    if (authToken && chatId && pendingDeepLinkRef.current) {
      const url = pendingDeepLinkRef.current;
      pendingDeepLinkRef.current = null;
      setTimeout(() => routeDeepLink(url), 200);
    }
  }, [authToken, chatId]);

  // Sync state with Android Home Screen Widget
  useEffect(() => {
    if (NativeModules.WidgetBridge?.updateWidgetData) {
      const activeLights = (haCategories.lights || []).filter(l => l.state === 'on').length;
      const unlockedCount = (haCategories.locks || []).filter(l => l.state === 'unlocked').length;
      const firstEvent = calendarEvents[0]?.summary || 'Morning Pulse & Schedule';
      const portfolioText = hermesPortfolio?.hasData
        ? (hermesPortfolio.totalValue != null
            ? `$${hermesPortfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n${hermesPortfolio.gainers} up, ${hermesPortfolio.decliners} down`
            : `${hermesPortfolio.gainers} up, ${hermesPortfolio.decliners} down\nNo shares set`)
        : 'Not configured';
      const jobsText = jobListings.length > 0 ? `${jobListings.length} openings\nTap to browse` : 'No new postings';
      NativeModules.WidgetBridge.updateWidgetData({
        statusText: serverReachable ? 'FOCUS ONLINE' : 'FOCUS STANDBY',
        statusPill: serverReachable ? '● ONLINE' : '● OFFLINE',
        agendaText: firstEvent,
        // Was a hardcoded '🔒 All Secured' while haCategories.locks was fetched
        // and never read — the widget claimed the house was locked no matter
        // what. A security surface that reassures unconditionally is worse than
        // no surface. haCategories is already in this effect's dep array.
        homeText: `${unlockedCount === 0 ? '🔒 All Secured' : `🔓 ${unlockedCount} Unlocked`}\n💡 ${activeLights} Light${activeLights !== 1 ? 's' : ''} Active`,
        portfolioText,
        jobsText
      });
    }
  }, [haCategories, calendarEvents, authToken, hermesPortfolio, jobListings]);

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flexFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => {
              Keyboard.dismiss();
              setThreadsVisible(true);
            }}
            accessibilityLabel="Open navigation menu"
          >
            <Menu size={22} color="#00f2fe" />
          </TouchableOpacity>

          <View style={{ flex: 1, alignItems: 'center', marginHorizontal: 8 }}>
            <Text style={styles.title} numberOfLines={1}>
              {!dashboardVisible
                ? 'Aloy Chat'
                : dashboardSection === 'hub'
                ? 'Command Center'
                : dashboardSection === 'conclave'
                ? '🏛️ Pantheon'
                : (dashboardSection === 'cauldron' || dashboardSection === 'hephaestus' || dashboardSection === 'forge')
                ? '🔥 The Forge'
                : dashboardSection === 'athena'
                ? '🦉 Athena Scout'
                : dashboardSection === 'apollo'
                ? '📚 Apollo Vault'
                : dashboardSection === 'minerva'
                ? '🛡️ Minerva'
                : dashboardSection === 'hermes'
                ? '💼 Hermes Ops'
                : dashboardSection === 'smarthome'
                ? '🏠 Smart Home'
                : dashboardSection === 'skills'
                ? '🧠 Skills'
                : dashboardSection === 'projects'
                ? '📁 Projects'
                : dashboardSection === 'news'
                ? '📰 Tech News'
                : 'Command Center'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {dashboardVisible && dashboardSection === 'conclave' ? (
              <TouchableOpacity
                style={[
                  styles.hephSmallBtn,
                  {
                    backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    borderColor: '#a855f7'
                  }
                ]}
                onPress={handleConveneConclaveMobile}
                disabled={isConveningConclave}
              >
                <RefreshCw size={13} color="#c084fc" />
                <Text style={{ color: '#c084fc', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>
                  {isConveningConclave ? 'Deliberating...' : 'Convene'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => {
                  Keyboard.dismiss();
                  if (dashboardVisible) {
                    setDashboardVisible(false);
                  } else {
                    setDashboardSection('hub');
                    setDashboardVisible(true);
                    refreshHephTasks();
                    refreshAthenaTasks();
                    refreshApollo();
                    refreshMinervaHealth();
                    refreshHermes();
                    refreshSmartHome();
                    refreshCalendarEvents();
                    refreshProjectStatuses();
                  }
                }}
                accessibilityLabel="Toggle Dashboard/Chat"
              >
                {dashboardVisible ? (
                  <MessageSquare size={20} color="#94a3b8" />
                ) : (
                  <LayoutDashboard size={20} color="#00f2fe" />
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.iconButton} onPress={() => setSettingsVisible(true)} accessibilityLabel="Open settings">
              <SettingsIcon size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>

        {dashboardVisible ? (
          <View style={styles.flexFill}>
            <ScrollView style={[styles.flexFill, styles.dashboardPageContent]}>
              {/* 🌟 1. COMMAND CENTER HUB */}
              {dashboardSection === 'hub' && (
                <View style={{ paddingBottom: 24, paddingTop: 10 }}>
                  {(() => {
                    const stagedTasks = hephTasks.filter((t) => t.status === 'staged_for_review');
                    const activeAthena = athenaTasks.filter((t) => t.status === 'researching' || t.status === 'synthesizing');
                    const activeProjects = projectStatuses.filter((p) => typeof p.summary?.progressPct === 'number');

                    return (
                      <>
                        <ActiveTicker
                dataLoaded={serverReachable}
                          stagedTasks={stagedTasks}
                          activeAthena={activeAthena}
                          activeProjects={activeProjects}
                          onPressStaged={() => setDashboardSection('cauldron')}
                          onPressAthena={() => setDashboardSection('athena')}
                        />

                        <EnvironmentBento
                          haCategories={{
                            lights: haCategories.lights,
                            locks: haCategories.locks,
                            climates: haCategories.climate,
                          }}
                          visionStats={visionStats}
                          onNavigateSmartHome={() => {
                            setDashboardSection('minerva');
                            refreshMinervaHealth();
                            refreshSmartHome();
                          }}
                          onNavigateVision={() => openVisionEvents()}
                          onAdjustTemp={(entityId, currentTemp, delta) => {
                            toggleDevice('climate', 'set_temperature', entityId, { temperature: currentTemp + delta });
                          }}
                          formatRelativeTime={formatRelativeTime}
                        />

                        {/* 🎬 Jellyfin Media Orchestrator Tile */}
                        <MediaBentoTile
                          serverUrl={serverUrl}
                          jellyfinStatus={jellyfinStatus}
                          activeSessions={jellyfinSessions}
                          onTogglePlayPause={handleToggleJellyfinPlayback}
                          onOpenCastModal={() => setMediaCastVisible(true)}
                        />

                        {/* 👁️ Ambient Room Observer Tile */}
                        <RoomObserverBentoTile
                          observation={roomObservation}
                          isObserving={isRoomObserving}
                          onObserveNow={handleObserveRoomFromMobile}
                          onViewSnapshot={(url, obs) => setSnapshotModalData({ url, obs })}
                          formatRelativeTime={formatRelativeTime}
                        />

                        <UpcomingAgenda
                          calendarEvents={calendarEvents}
                          formatAgendaDateOnly={formatAgendaDateOnly}
                        />

                        <StudioPortalCard
                          hephTasks={hephTasks}
                          hephStats={hephStats}
                          athenaTasks={athenaTasks}
                          serverUrl={serverUrl}
                          onNavigateCauldron={() => { setDashboardSection('cauldron'); refreshHephTasks(); }}
                          onNavigateAthena={() => { setDashboardSection('athena'); refreshAthenaTasks(); }}
                          onNavigateApollo={() => { setDashboardSection('apollo'); refreshApollo(); }}
                          onNavigateMinerva={() => { setDashboardSection('minerva'); refreshMinervaHealth(); }}
                          onNavigateHermes={() => { setDashboardSection('hermes'); refreshHermes(); }}
                          onOpenCreateTaskModal={() => setCreateTaskModalVisible(true)}
                          onOpenCreateAthenaModal={() => setCreateAthenaModalVisible(true)}
                        />
                      </>
                    );
                  })()}


                  {/* 📊 Tracked Projects (if any) */}
                  {projectStatuses.length > 0 && (
                    <View style={{ marginTop: 16 }}>
                      <View style={styles.hubSectionHeaderRow}>
                        <Text style={styles.hubSectionTitle}>📊 Background Jobs</Text>
                      </View>
                      {projectStatuses.map((proj) => {
                        const { summary } = proj;
                        const stepLabel = summary.step
                          ? `${summary.step.label}${summary.step.total ? ` ${summary.step.current}/${summary.step.total}` : ''}`
                          : summary.statusMessage;
                        return (
                          <View key={proj.name} style={styles.projectWidget}>
                            <View style={styles.projectWidgetHeader}>
                              <Disc3 size={14} color="#00f2fe" />
                              <Text style={styles.projectName} numberOfLines={1}>{proj.name}</Text>
                              {typeof summary.progressPct === 'number' && (
                                <Text style={styles.projectPct}>{summary.progressPct}%</Text>
                              )}
                            </View>
                            {!!stepLabel && (
                              <Text style={styles.projectStatusText} numberOfLines={1}>{stepLabel}</Text>
                            )}
                            {typeof summary.progressPct === 'number' && (
                              <View style={styles.projectProgressTrack}>
                                <View style={[styles.projectProgressFill, { width: `${Math.max(0, Math.min(100, summary.progressPct))}%` }]} />
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* 📈 Intelligence & Insights Grid */}
                  <View style={[styles.hubSectionHeaderRow, { marginTop: 18 }]}>
                    <Text style={styles.hubSectionTitle}>📈 Intelligence & Analytics</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {/* Skills Card */}
                    <TouchableOpacity
                      style={[styles.bentoTile, { flex: 1 }]}
                      onPress={() => setDashboardSection('skills')}
                      activeOpacity={0.7}
                    >
                      <View style={styles.bentoIconRow}>
                        <Sparkles size={16} color="#c084fc" />
                        <Text style={styles.bentoTileHeader}>Skills</Text>
                      </View>
                      <Text style={[styles.bentoTileValue, { color: '#c084fc' }]}>
                        {skillsOverview?.overallProficiencyScore ?? 0}%
                      </Text>
                      <Text style={styles.bentoTileSub}>
                        {skillsOverview?.needsReviewCount ?? 0} need review
                      </Text>
                    </TouchableOpacity>

                    {/* News Card */}
                    <TouchableOpacity
                      style={[styles.bentoTile, { flex: 1 }]}
                      onPress={() => setDashboardSection('news')}
                      activeOpacity={0.7}
                    >
                      <View style={styles.bentoIconRow}>
                        <RefreshCw size={16} color="#38bdf8" />
                        <Text style={styles.bentoTileHeader}>Tech News</Text>
                      </View>
                      <Text style={styles.bentoTileValue} numberOfLines={1}>
                        {newsArticles.length} Articles
                      </Text>
                      <Text style={styles.bentoTileSub} numberOfLines={1}>
                        {newsArticles[0]?.sourceName || 'Cached feed'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* 🏠 2. FULL SMART HOME SUB-VIEW */}
              {dashboardSection === 'smarthome' && (
                <View style={{ paddingVertical: 12 }}>
                  {(haCategories.lights.length > 0 || haCategories.locks.length > 0 || haCategories.climate.length > 0) ? (
                    <>
                      <View style={[styles.projectWidget, styles.projectWidgetHeader, { marginBottom: 14 }]}>
                        <Lightbulb size={14} color="#fde047" />
                        <Text style={styles.smartHomeSummaryText}>
                          {haCategories.lights.filter((l) => l.state === 'on').length} ON
                        </Text>
                        <Lock size={14} color="#4ade80" style={{ marginLeft: 10 }} />
                        <Text style={styles.smartHomeSummaryText}>
                          {haCategories.locks.filter((l) => l.state === 'unlocked').length} Unlocked
                        </Text>
                        {haCategories.climate.length > 0 && (
                          <>
                            <Thermometer size={14} color="#fb923c" style={{ marginLeft: 10 }} />
                            <Text style={styles.smartHomeSummaryText}>
                              {haCategories.climate[0].attributes?.current_temperature ?? '—'}°
                            </Text>
                          </>
                        )}
                      </View>
                      {haCategories.lights.map((light) => {
                        const isOn = light.state === 'on';
                        return (
                          <View key={light.entity_id} style={styles.smartHomeRow}>
                            <Text style={styles.smartHomeName} numberOfLines={1}>{light.name}</Text>
                            <TouchableOpacity
                              style={[isOn ? styles.denyButton : styles.confirmButton, { flex: 0, paddingVertical: 6 }]}
                              onPress={() => toggleDevice('light', isOn ? 'turn_off' : 'turn_on', light.entity_id)}
                            >
                              <Text style={styles.modalButtonText}>{isOn ? 'Turn OFF' : 'Turn ON'}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      {haCategories.locks.map((lock) => {
                        const isLocked = lock.state === 'locked';
                        return (
                          <View key={lock.entity_id} style={styles.smartHomeRow}>
                            {isLocked ? <Lock size={13} color="#4ade80" /> : <Unlock size={13} color="#f87171" />}
                            <Text style={styles.smartHomeName} numberOfLines={1}>{lock.name}</Text>
                            <TouchableOpacity
                              style={[isLocked ? styles.denyButton : styles.confirmButton, { flex: 0, paddingVertical: 6 }]}
                              onPress={() => toggleDevice('lock', isLocked ? 'unlock' : 'lock', lock.entity_id)}
                            >
                              <Text style={styles.modalButtonText}>{isLocked ? 'Unlock' : 'Lock'}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      {haCategories.climate.map((clim) => {
                        const isOff = clim.state === 'off';
                        const step = clim.attributes?.target_temp_step || 1;
                        const target = clim.attributes?.temperature;
                        const minTemp = clim.attributes?.min_temp ?? 40;
                        const maxTemp = clim.attributes?.max_temp ?? 95;
                        const onMode = (clim.attributes?.hvac_modes || []).find((m: string) => m !== 'off') || 'heat';
                        const adjustTemp = (delta: number) => {
                          if (typeof target !== 'number') return;
                          const next = Math.min(maxTemp, Math.max(minTemp, target + delta));
                          toggleDevice('climate', 'set_temperature', clim.entity_id, { temperature: next });
                        };
                        return (
                          <View key={clim.entity_id} style={styles.smartHomeRow}>
                            <Thermometer size={13} color={isOff ? '#64748b' : '#fb923c'} />
                            <Text style={styles.smartHomeName} numberOfLines={1}>
                              {clim.name}{typeof clim.attributes?.current_temperature === 'number' ? ` (${clim.attributes.current_temperature}°)` : ''}
                            </Text>
                            {!isOff && typeof target === 'number' && (
                              <>
                                <TouchableOpacity style={styles.climateStepButton} onPress={() => adjustTemp(-step)}>
                                  <Text style={styles.climateStepText}>−</Text>
                                </TouchableOpacity>
                                <Text style={styles.climateTargetText}>{target}°</Text>
                                <TouchableOpacity style={styles.climateStepButton} onPress={() => adjustTemp(step)}>
                                  <Text style={styles.climateStepText}>+</Text>
                                </TouchableOpacity>
                              </>
                            )}
                            <TouchableOpacity
                              style={[isOff ? styles.confirmButton : styles.denyButton, { flex: 0, paddingVertical: 6 }]}
                              onPress={() => toggleDevice('climate', 'set_hvac_mode', clim.entity_id, { hvac_mode: isOff ? onMode : 'off' })}
                            >
                              <Text style={styles.modalButtonText}>{isOff ? 'Turn On' : 'Turn Off'}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </>
                  ) : (
                    <Text style={styles.modalLabel}>No smart home devices found.</Text>
                  )}
                </View>
              )}

              {/* 📰 3. FULL TECH NEWS SUB-VIEW */}
              {dashboardSection === 'news' && (
                <View style={{ paddingVertical: 12 }}>
                  <TouchableOpacity
                    style={[styles.confirmButton, { marginBottom: 14, flex: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}
                    onPress={handleNewsRefresh}
                    disabled={isNewsRefreshing}
                  >
                    <RefreshCw size={14} color="#07090e" />
                    <Text style={styles.modalButtonText}>{isNewsRefreshing ? 'Refreshing...' : 'Refresh Feed'}</Text>
                  </TouchableOpacity>
                  {newsArticles.length > 0 ? (
                    newsArticles.map((a) => (
                      <View key={a.id} style={styles.agendaRow}>
                        <View style={styles.flexFill}>
                          <Text style={styles.agendaSummary}>{a.title}</Text>
                          <Text style={styles.agendaCalendar} numberOfLines={2}>
                            {a.sourceName}{a.relevanceReason ? ` — ${a.relevanceReason}` : ''}
                          </Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.modalLabel}>
                      No articles yet. Tap Refresh Feed above to fetch the latest curated tech news.
                    </Text>
                  )}
                </View>
              )}

              {/* 🧠 4. FULL SKILLS SUB-VIEW */}
              {dashboardSection === 'skills' && (
                !skillsOverview ? (
                  <Text style={[styles.modalLabel, { marginTop: 20 }]}>Loading skills dashboard...</Text>
                ) : (
                  <View style={{ paddingVertical: 12 }}>
                    <View style={styles.skillsOverallRow}>
                      <Text style={styles.skillsOverallScore}>{skillsOverview.overallProficiencyScore}%</Text>
                      <Text style={styles.modalLabel}>
                        Overall proficiency{skillsOverview.needsReviewCount > 0 ? ` — ${skillsOverview.needsReviewCount} item${skillsOverview.needsReviewCount !== 1 ? 's' : ''} awaiting review` : ''}
                      </Text>
                    </View>
                    {skillsOverview.categories.map((cat) => {
                      const total = cat.confirmedCount + cat.gapCount;
                      const confirmedPct = total > 0 ? (cat.confirmedCount / total) * 100 : 100;
                      const gapPct = total > 0 ? (cat.gapCount / total) * 100 : 0;
                      return (
                        <View key={cat.name} style={styles.skillsCategoryRow}>
                          <View style={styles.skillsCategoryHeader}>
                            <Text style={styles.smartHomeName} numberOfLines={1}>{cat.name}</Text>
                            <Text style={styles.skillsCategoryScore}>{cat.proficiencyScore}%</Text>
                          </View>
                          <View style={styles.skillsBarTrack}>
                            <View style={[styles.skillsBarConfirmed, { width: `${confirmedPct}%` }]} />
                            <View style={[styles.skillsBarGap, { width: `${gapPct}%` }]} />
                          </View>
                          <Text style={styles.skillsCategoryMeta}>
                            {cat.confirmedCount} confirmed, {cat.gapCount} open gap{cat.gapCount !== 1 ? 's' : ''}{cat.needsReviewCount > 0 ? `, ${cat.needsReviewCount} need review` : ''}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )
              )}

              {/* 📁 FULL PROJECTS & BUILDS SUB-VIEW */}
              {dashboardSection === 'projects' && (
                <View style={{ paddingVertical: 12 }}>
                  <Text style={{ color: '#00f2fe', fontSize: 16, fontWeight: '800', marginBottom: 4 }}>
                    📁 Tracked Projects & Builds
                  </Text>
                  <Text style={{ color: '#94a3b8', fontSize: 12, marginBottom: 14 }}>
                    Live builds, AutoRip disc pipelines, and background process monitor.
                  </Text>
                  {projectStatuses.length > 0 ? (
                    projectStatuses.map((proj) => {
                      const { summary } = proj;
                      const stepLabel = summary.step
                        ? `${summary.step.label}${summary.step.total ? ` (${summary.step.current}/${summary.step.total})` : ''}`
                        : summary.statusMessage;
                      return (
                        <View key={proj.name} style={[styles.hephTaskCard, { borderColor: 'rgba(0, 242, 254, 0.3)', marginBottom: 10 }]}>
                          <View style={styles.projectWidgetHeader}>
                            <Disc3 size={16} color="#00f2fe" />
                            <Text style={[styles.projectName, { fontSize: 14 }]}>{proj.name}</Text>
                            {typeof summary.progressPct === 'number' && (
                              <Text style={[styles.projectPct, { fontSize: 13 }]}>{summary.progressPct}%</Text>
                            )}
                          </View>
                          {!!stepLabel && (
                            <Text style={[styles.projectStatusText, { marginTop: 6 }]}>{stepLabel}</Text>
                          )}
                          {typeof summary.progressPct === 'number' && (
                            <View style={[styles.projectProgressTrack, { height: 6, marginTop: 8 }]}>
                              <View style={[styles.projectProgressFill, { height: 6, width: `${Math.max(0, Math.min(100, summary.progressPct))}%` }]} />
                            </View>
                          )}
                          {summary.lastCompleted && (
                            <Text style={styles.projectLastCompleted}>
                              Last completed: {summary.lastCompleted.disc_label || `${summary.lastCompleted.episodes_saved || 0} items`}
                            </Text>
                          )}
                        </View>
                      );
                    })
                  ) : (
                    <View style={styles.hephEmptyCard}>
                      <Disc3 size={28} color="#64748b" />
                      <Text style={[styles.modalLabel, { textAlign: 'center', marginTop: 8 }]}>
                        No background project jobs running.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* 🔥 5. FULL CAULDRON STUDIO SUB-VIEW */}
              {(dashboardSection === 'cauldron' || dashboardSection === 'hephaestus' || dashboardSection === 'forge') && (
                <View style={{ paddingVertical: 12 }}>
                  {/* Unified Studio Header */}
                  <StudioHeader
                    icon={Flame}
                    title="THE FORGE"
                    subtitle="Autonomous Code Agent & QLoRA Flywheel"
                    accentColor="#f59e0b"
                    statusBadge={serverReachable ? "ONLINE" : "NO DATA"}
                    actionButton={{
                      label: 'New Task',
                      icon: Plus,
                      onPress: () => setCreateTaskModalVisible(true),
                    }}
                    secondaryAction={{
                      icon: RefreshCw,
                      onPress: () => refreshHephTasks(),
                    }}
                  />

                  {/* Unified Pulse Grid */}
                  <PulseGrid
                    metrics={[
                      {
                        label: 'Active Orders',
                        value: hephTasks.filter((t) => t.status !== 'deployed' && t.status !== 'expired' && t.status !== 'failed' && t.status !== 'rejected').length,
                        subtext: 'Pending review',
                        color: '#f59e0b'
                      },
                      {
                        label: 'Deployed Patches',
                        value: hephTasks.filter((t) => t.status === 'deployed').length,
                        subtext: 'Live in prod',
                        color: '#22c55e'
                      },
                      {
                        label: 'QLoRA Flywheel',
                        value: hephStats?.totalSamples || 0,
                        subtext: `${hephStats?.positiveCount || 0} verified`,
                        color: '#c084fc'
                      },
                      {
                        label: 'Builds & Repos',
                        value: projectStatuses.length,
                        subtext: 'Monitored',
                        color: '#38bdf8'
                      }
                    ]}
                  />

                  {/* Unified Sub-Tab Bar */}
                  <SubTabBar
                    tabs={[
                      { id: 'tasks', label: 'Work Orders', badge: hephTasks.length },
                      { id: 'projects', label: 'Projects & Builds', badge: projectStatuses.length }
                    ]}
                    activeTab={hephMobileTab}
                    onSelectTab={(t) => {
                      setHephMobileTab(t);
                      if (t === 'projects') refreshProjectStatuses();
                    }}
                    accentColor="#f59e0b"
                  />

                  {/* TAB 1: AI Tasks */}
                  {hephMobileTab === 'tasks' && (
                    <View>
                      {/* Sub-Segment Filter Tabs */}
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                        <TouchableOpacity
                          style={[styles.hephSubTab, hephViewFilter === 'active' && styles.hephSubTabActive]}
                          onPress={() => setHephViewFilter('active')}
                        >
                          <Text style={[styles.hephSubTabText, hephViewFilter === 'active' && styles.hephSubTabTextActive]}>
                            Active Work Orders ({hephTasks.filter((t) => t.status !== 'deployed' && t.status !== 'expired' && t.status !== 'failed' && t.status !== 'rejected').length})
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.hephSubTab, hephViewFilter === 'deployed' && styles.hephSubTabActive]}
                          onPress={() => setHephViewFilter('deployed')}
                        >
                          <Text style={[styles.hephSubTabText, hephViewFilter === 'deployed' && styles.hephSubTabTextActive]}>
                            🚀 Deployed ({hephTasks.filter((t) => t.status === 'deployed').length})
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Tasks List */}
                      {hephTasks.filter((t) => (hephViewFilter === 'active' ? (t.status !== 'deployed' && t.status !== 'expired' && t.status !== 'failed' && t.status !== 'rejected') : t.status === 'deployed')).length === 0 ? (
                        <View style={styles.hephEmptyCard}>
                          <Flame size={28} color="#64748b" />
                          <Text style={[styles.modalLabel, { textAlign: 'center', marginTop: 8 }]}>
                            {hephViewFilter === 'active'
                              ? 'All work orders completed & deployed! 🎉 Tap "+ New Task" to dispatch another.'
                              : 'No deployed features recorded yet.'}
                          </Text>
                        </View>
                      ) : (
                        hephTasks
                          .filter((t) => (hephViewFilter === 'active' ? (t.status !== 'deployed' && t.status !== 'expired' && t.status !== 'failed' && t.status !== 'rejected') : t.status === 'deployed'))
                          .map((t, idx) => {
                            const isDiffExpanded = !!expandedDiffs[t.id];
                            const isDeployed = t.status === 'deployed';
                            const isStaged = t.status === 'staged_for_review';
                            return (
                              <View key={t.id} style={styles.hephTaskCard}>
                                {/* Task Header */}
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <View style={{ flex: 1, marginRight: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                      {isDeployed && (
                                        <View style={styles.hephRefTag}>
                                          <Text style={styles.hephRefText}>#HEPH-DEP-{String(idx + 1).padStart(3, '0')}</Text>
                                        </View>
                                      )}
                                      <Text style={styles.hephTaskBranch}>{t.category.toUpperCase()}</Text>
                                    </View>
                                    <Text style={styles.hephTaskTitle}>{t.title}</Text>
                                    <Text style={[styles.hephTaskBranch, { fontSize: 10, color: '#64748b', marginTop: 2 }]}>
                                      ID: {t.id} {t.rollbackSnapshotId ? `• Snap: ${t.rollbackSnapshotId}` : ''}
                                    </Text>
                                  </View>
                                  <View style={[
                                    styles.hephStatusPill,
                                    isDeployed ? styles.hephStatusDeployed : isStaged ? styles.hephStatusReview : styles.hephStatusQueued
                                  ]}>
                                    <Text style={[
                                      styles.hephStatusText,
                                      isDeployed ? { color: '#4ade80' } : isStaged ? { color: '#fbbf24' } : { color: '#94a3b8' }
                                    ]}>
                                      {t.status.replace(/_/g, ' ').toUpperCase()}
                                    </Text>
                                  </View>
                                </View>

                                {t.description ? (
                                  <Text style={styles.hephTaskDesc}>{t.description}</Text>
                                ) : null}

                              {/* AI Code Review Box */}
                              {t.aiReview && (
                                <View style={styles.hephReviewCard}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                                    <Text style={styles.hephReviewProvider}>
                                      AI Judge ({t.aiReview.provider?.toUpperCase()}): {t.aiReview.verdict}
                                    </Text>
                                    <View style={styles.hephScoreBadge}>
                                      <Text style={styles.hephReviewScore}>{t.aiReview.score}/100</Text>
                                    </View>
                                  </View>
                                  <Text style={styles.hephReviewSummary}>{t.aiReview.summary}</Text>
                                  {t.aiReview.critique ? (
                                    <Text style={styles.hephReviewCritique}>"{t.aiReview.critique}"</Text>
                                  ) : null}
                                </View>
                              )}

                              {/* Staged Diffs Toggle */}
                              {t.stagedChanges && t.stagedChanges.length > 0 && (
                                <View style={{ marginTop: 8 }}>
                                  <TouchableOpacity
                                    style={styles.hephDiffToggle}
                                    onPress={() => setExpandedDiffs(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                                  >
                                    <Code size={13} color="#00f2fe" />
                                    <Text style={styles.hephDiffToggleText}>
                                      {isDiffExpanded ? 'Hide' : 'View'} Staged Diff ({t.stagedChanges.length} file{t.stagedChanges.length !== 1 ? 's' : ''})
                                    </Text>
                                  </TouchableOpacity>

                                  {isDiffExpanded && (
                                    <ScrollView style={styles.hephDiffBox} nestedScrollEnabled={true}>
                                      {t.stagedChanges.map((file, fIdx) => (
                                        <View key={fIdx} style={{ marginBottom: 12 }}>
                                          <Text style={styles.hephDiffFileHeader}>📄 {file.filePath}</Text>
                                          {file.diffChunks && file.diffChunks.map((chunk: any, cIdx: number) => (
                                            <Text
                                              key={cIdx}
                                              style={[
                                                styles.hephDiffLine,
                                                chunk.type === 'add' ? styles.hephDiffAdd : chunk.type === 'del' ? styles.hephDiffDel : styles.hephDiffContext
                                              ]}
                                            >
                                              {chunk.type === 'add' ? '+' : chunk.type === 'del' ? '-' : ' '} {chunk.content}
                                            </Text>
                                          ))}
                                        </View>
                                      ))}
                                    </ScrollView>
                                  )}
                                </View>
                              )}

                              {/* Action Footer */}
                              <View style={styles.hephActionFooter}>
                                {isDeployed ? (
                                  <>
                                    <TouchableOpacity
                                      style={[styles.hephActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}
                                      onPress={() => handleDeleteHephTask(t.id)}
                                    >
                                      <Trash2 size={12} color="#f87171" />
                                      <Text style={{ color: '#f87171', fontSize: 11, fontWeight: '700', marginLeft: 4 }}>Dismiss</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.hephActionBtn, { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.4)' }]}
                                      onPress={() => handleRollbackHephTask(t.id)}
                                    >
                                      <RotateCcw size={12} color="#f59e0b" />
                                      <Text style={{ color: '#f59e0b', fontSize: 11, fontWeight: '700', marginLeft: 4 }}>Rollback</Text>
                                    </TouchableOpacity>
                                  </>
                                ) : (
                                  <>
                                    <TouchableOpacity
                                      style={[styles.hephActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.4)' }]}
                                      onPress={() => handleRejectHephTask(t.id)}
                                    >
                                      <X size={13} color="#f87171" />
                                      <Text style={{ color: '#f87171', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Reject</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.hephActionBtn, { backgroundColor: '#16a34a', borderColor: '#22c55e', flex: 1.5 }]}
                                      onPress={() => handleApproveHephTask(t.id)}
                                    >
                                      <CheckCircle2 size={13} color="#fff" />
                                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Approve & Deploy</Text>
                                    </TouchableOpacity>
                                  </>
                                )}
                              </View>
                            </View>
                          );
                        })
                    )}
                    </View>
                  )}

                  {/* TAB 2: Monitored Projects & Builds */}
                  {hephMobileTab === 'projects' && (
                    <View>
                      <View style={[styles.hephTaskCard, { borderColor: 'rgba(56, 189, 248, 0.35)', padding: 14, marginBottom: 12 }]}>
                        <Text style={{ color: '#38bdf8', fontSize: 15, fontWeight: '800' }}>📁 Monitored Code Repos & Builds</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 4 }}>
                          Real-time progress indicators, local dev servers & build pipelines.
                        </Text>
                      </View>

                      {projectStatuses.length === 0 ? (
                        <View style={styles.hephEmptyCard}>
                          <Disc3 size={28} color="#64748b" />
                          <Text style={[styles.modalLabel, { textAlign: 'center', marginTop: 8 }]}>
                            No monitored projects found. Add projects via Desktop Hephaestus or server configs.
                          </Text>
                        </View>
                      ) : (
                        projectStatuses.map((proj, pIdx) => (
                          <View key={proj.name || pIdx} style={[styles.hephTaskCard, { padding: 12, marginBottom: 8 }]}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={{ color: '#f8fafc', fontSize: 14, fontWeight: '700' }}>{proj.name}</Text>
                              <View style={[styles.hephStatusPill, { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.4)' }]}>
                                <Text style={[styles.hephStatusText, { color: '#38bdf8', fontSize: 10, fontWeight: '800' }]}>
                                  {proj.summary?.progressPct != null ? `${proj.summary.progressPct}%` : 'TRACKED'}
                                </Text>
                              </View>
                            </View>
                            {proj.folderPath ? (
                              <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }} numberOfLines={1}>
                                {proj.folderPath}
                              </Text>
                            ) : null}
                            {proj.summary?.statusMessage ? (
                              <Text style={{ color: '#a78bfa', fontSize: 11.5, marginTop: 4 }}>
                                ⚡ {proj.summary.statusMessage}
                              </Text>
                            ) : null}
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* 🦉 6. FULL ATHENA STUDIO SUB-VIEW */}
              {dashboardSection === 'athena' && (
                <View style={{ paddingVertical: 12 }}>
                  {/* Unified Studio Header */}
                  <StudioHeader
                    icon={BookOpen}
                    title="ATHENA SCOUT"
                    subtitle="Autonomous Deep Research & Technical Dossiers"
                    accentColor="#38bdf8"
                    statusBadge={serverReachable ? "SCOUT READY" : "NO DATA"}
                    actionButton={{
                      label: 'New Mission',
                      icon: Plus,
                      onPress: () => setCreateAthenaModalVisible(true),
                    }}
                    secondaryAction={{
                      icon: RefreshCw,
                      onPress: () => refreshAthenaTasks(),
                    }}
                  />

                  {/* Unified Pulse Grid */}
                  <PulseGrid
                    metrics={[
                      {
                        label: 'Total Dossiers',
                        value: athenaTasks.length,
                        subtext: `${athenaTasks.filter(t => t.status === 'completed').length} completed`,
                        color: '#38bdf8'
                      },
                      {
                        label: 'Active Missions',
                        value: athenaTasks.filter(t => t.status === 'researching' || t.status === 'synthesizing').length,
                        subtext: 'In-flight',
                        color: '#f59e0b'
                      },
                      {
                        label: 'Synthesis Depth',
                        value: 'Deep',
                        subtext: 'Multi-source',
                        color: '#a855f7'
                      },
                      {
                        label: 'Verification',
                        value: 'Dual-LLM',
                        subtext: 'Gemini + Claude',
                        color: '#22c55e'
                      }
                    ]}
                  />

                  {/* Status Filter Bar */}
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {[
                        { id: 'all', label: 'All', count: athenaTasks.length },
                        { id: 'completed', label: 'Done', count: athenaTasks.filter(t => t.status === 'completed').length, color: '#4ade80' },
                        { id: 'researching', label: 'Scouting', count: athenaTasks.filter(t => t.status === 'researching').length, color: '#38bdf8' },
                        { id: 'synthesizing', label: 'Synthesis', count: athenaTasks.filter(t => t.status === 'synthesizing').length, color: '#c084fc' },
                        { id: 'queued', label: 'Queued', count: athenaTasks.filter(t => t.status === 'queued').length, color: '#fbbf24' },
                        { id: 'failed', label: 'Failed', count: athenaTasks.filter(t => t.status === 'failed').length, color: '#f87171' },
                        { id: 'cancelled', label: 'Cancelled', count: athenaTasks.filter(t => t.status === 'cancelled').length, color: '#94a3b8' }
                      ].filter(f => f.id === 'all' || f.count > 0).map(f => {
                        const isActive = athenaStatusFilter === f.id;
                        return (
                          <TouchableOpacity
                            key={f.id}
                            style={[
                              styles.hephSubTab,
                              isActive && { backgroundColor: f.color ? `${f.color}25` : 'rgba(56, 189, 248, 0.25)', borderColor: f.color || '#38bdf8' }
                            ]}
                            onPress={() => setAthenaStatusFilter(prev => prev === f.id ? 'all' : f.id)}
                          >
                            <Text style={[styles.hephSubTabText, isActive && { color: f.color || '#38bdf8', fontWeight: '800' }]}>
                              {f.label} ({f.count})
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Tasks List */}
                  {athenaTasks.filter(t => athenaStatusFilter === 'all' || (t.status || '').toLowerCase() === athenaStatusFilter.toLowerCase()).length === 0 ? (
                    <View style={[styles.hephEmptyCard, { borderColor: 'rgba(56, 189, 248, 0.2)', paddingVertical: 32 }]}>
                      <BookOpen size={32} color="#38bdf8" />
                      <Text style={{ color: '#f8fafc', fontSize: 14, fontWeight: '700', marginTop: 10 }}>
                        {athenaStatusFilter !== 'all' ? `No missions with status "${athenaStatusFilter}"` : 'No Research Missions Yet'}
                      </Text>
                      <Text style={[styles.modalLabel, { textAlign: 'center', marginTop: 4, maxWidth: 280, fontSize: 12, lineHeight: 18 }]}>
                        {athenaStatusFilter !== 'all'
                          ? 'Try selecting "All" or a different status tag to view missions.'
                          : 'Tap "+ New Mission" above to send Athena on an autonomous deep research scout.'}
                      </Text>
                      {athenaStatusFilter !== 'all' && (
                        <TouchableOpacity
                          style={[styles.hephSmallBtn, { marginTop: 12, borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}
                          onPress={() => setAthenaStatusFilter('all')}
                        >
                          <Text style={{ color: '#38bdf8', fontSize: 12, fontWeight: '700' }}>Show All Missions ({athenaTasks.length})</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    athenaTasks
                      .filter(t => athenaStatusFilter === 'all' || (t.status || '').toLowerCase() === athenaStatusFilter.toLowerCase())
                      .map((t) => {
                      const isExpanded = !!expandedAthenaDossiers[t.id];
                      const isDone = t.status === 'completed';
                      const isFail = t.status === 'failed';
                      const depthLabel = t.depth === 'deep_dive' ? '🧠 DEEP DIVE' : t.depth === 'quick' ? '⚡ QUICK BRIEF' : '🔍 STANDARD REPORT';
                      const depthColor = t.depth === 'deep_dive' ? '#c084fc' : t.depth === 'quick' ? '#38bdf8' : '#818cf8';

                      return (
                        <View key={t.id} style={[styles.hephTaskCard, { borderColor: isDone ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255, 255, 255, 0.1)', padding: 14, marginBottom: 12 }]}>
                          {/* Header */}
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, marginRight: 10 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                                <View style={[styles.hephRefTag, { backgroundColor: 'rgba(56, 189, 248, 0.12)', borderColor: 'rgba(56, 189, 248, 0.3)' }]}>
                                  <Text style={[styles.hephRefText, { color: '#38bdf8', fontSize: 10 }]}>#{t.id.slice(0, 16)}</Text>
                                </View>
                                <Text style={[styles.hephTaskBranch, { color: depthColor, fontSize: 10, fontWeight: '800' }]}>
                                  {depthLabel}
                                </Text>
                              </View>
                              <Text style={[styles.hephTaskTitle, { fontSize: 14, lineHeight: 19, fontWeight: '700', color: '#f8fafc' }]}>
                                {t.query}
                              </Text>
                              <Text style={{ fontSize: 10.5, color: '#64748b', marginTop: 4 }}>
                                {new Date(t.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                {t.provider ? ` • 🧠 ${t.provider}` : ''}
                              </Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => setAthenaStatusFilter(t.status)}
                              style={[
                                styles.hephStatusPill,
                                isDone ? { backgroundColor: 'rgba(34, 197, 94, 0.15)', borderColor: 'rgba(34, 197, 94, 0.4)' }
                                  : isFail ? { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' }
                                  : { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.4)' },
                                { paddingHorizontal: 8, paddingVertical: 4 }
                              ]}
                            >
                              <Text style={[
                                styles.hephStatusText,
                                isDone ? { color: '#4ade80' } : isFail ? { color: '#f87171' } : { color: '#38bdf8' },
                                { fontSize: 10, fontWeight: '800' }
                              ]}>
                                {t.status.toUpperCase()}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {/* Progress HUD if in-flight */}
                          {!isDone && !isFail && (
                            <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: 'rgba(56, 189, 248, 0.08)', borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.2)' }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <Text style={{ color: '#38bdf8', fontSize: 11, fontWeight: '700', flex: 1, marginRight: 6 }}>
                                  🔄 {t.statusMessage}
                                </Text>
                                <Text style={{ color: '#f8fafc', fontSize: 11, fontWeight: '800' }}>
                                  {t.progress}%
                                </Text>
                              </View>
                              <View style={[styles.projectProgressTrack, { height: 6, borderRadius: 3 }]}>
                                <View style={[styles.projectProgressFill, { width: `${t.progress}%`, backgroundColor: '#38bdf8', height: 6, borderRadius: 3 }]} />
                              </View>
                            </View>
                          )}

                          {/* Expandable Markdown Report */}
                          {isDone && t.reportMarkdown && (
                            <View style={{ marginTop: 10 }}>
                              <TouchableOpacity
                                style={[
                                  styles.hephDiffToggle,
                                  {
                                    borderColor: 'rgba(56, 189, 248, 0.35)',
                                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                                    paddingVertical: 9,
                                    paddingHorizontal: 12,
                                    borderRadius: 10
                                  }
                                ]}
                                onPress={() => setExpandedAthenaDossiers(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                              >
                                <BookOpen size={14} color="#38bdf8" />
                                <Text style={[styles.hephDiffToggleText, { color: '#38bdf8', fontWeight: '700', fontSize: 12 }]}>
                                  {isExpanded ? 'Collapse Dossier ▲' : 'Read Full Research Dossier ▼'}
                                </Text>
                              </TouchableOpacity>

                              {isExpanded && (
                                <View style={[styles.hephDiffContainer, { backgroundColor: '#050811', borderColor: 'rgba(56, 189, 248, 0.25)', borderRadius: 10, padding: 12, marginTop: 8 }]}>
                                  <ScrollView style={{ maxHeight: 500 }} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                                    <Markdown
                                      style={{
                                        body: { color: '#cbd5e1', fontSize: 12.5, lineHeight: 19 },
                                        heading1: { color: '#38bdf8', fontSize: 16, fontWeight: '800', marginTop: 10, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(56, 189, 248, 0.2)', paddingBottom: 4 },
                                        heading2: { color: '#f8fafc', fontSize: 14, fontWeight: '700', marginTop: 10, marginBottom: 4 },
                                        heading3: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 3 },
                                        blockquote: { backgroundColor: 'rgba(56, 189, 248, 0.08)', borderLeftWidth: 3, borderLeftColor: '#38bdf8', paddingHorizontal: 10, paddingVertical: 6, marginVertical: 6, borderRadius: 4 },
                                        bullet_list: { marginVertical: 4 },
                                        ordered_list: { marginVertical: 4 },
                                        list_item: { marginVertical: 2, color: '#cbd5e1' },
                                        table: { borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, marginVertical: 8 },
                                        th: { backgroundColor: '#0f172a', padding: 6, color: '#38bdf8', fontWeight: 'bold', fontSize: 11 },
                                        tr: { borderBottomWidth: 1, borderBottomColor: '#1e293b' },
                                        td: { padding: 6, color: '#cbd5e1', fontSize: 11 },
                                        code_inline: { backgroundColor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 11.5 }
                                      }}
                                    >
                                      {t.reportMarkdown}
                                    </Markdown>
                                  </ScrollView>
                                </View>
                              )}
                            </View>
                          )}

                          {/* Action Footer */}
                          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.04)' }}>
                            <TouchableOpacity
                              style={[styles.hephActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.3)', paddingHorizontal: 12, paddingVertical: 6 }]}
                              onPress={() => handleDeleteAthenaTask(t.id)}
                            >
                              <Trash2 size={12} color="#f87171" />
                              <Text style={{ color: '#f87171', fontSize: 11, fontWeight: '700', marginLeft: 4 }}>Dismiss</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* APOLLO VIEW (Knowledge, Skills & Memory Gardener) */}
              {dashboardSection === 'apollo' && (
                <View style={{ paddingVertical: 12 }}>
                  {/* Unified Studio Header */}
                  <StudioHeader
                    icon={Brain}
                    title="APOLLO VAULT"
                    subtitle="Long-Term Memory & Skills Gardener"
                    accentColor="#fbbf24"
                    statusBadge={serverReachable ? "GARDENER ACTIVE" : "NO DATA"}
                    actionButton={{
                      label: 'Garden',
                      icon: RefreshCw,
                      onPress: handleApolloGarden,
                      loading: apolloLoading,
                    }}
                  />

                  {/* Unified Pulse Grid */}
                  <PulseGrid
                    metrics={[
                      {
                        label: 'Memory Facts',
                        value: apolloMemories.length,
                        subtext: 'Core memories',
                        color: '#fbbf24'
                      },
                      {
                        label: 'Proficiency',
                        value: skillsOverview?.overallProficiencyScore != null ? `${skillsOverview.overallProficiencyScore}%` : '—',
                        subtext: 'Synthetic evaluation',
                        color: '#4ade80'
                      },
                      {
                        label: 'Learned Skills',
                        // `skillsLearnedCount` is not a field on SkillsDashboard, so this was
                        // always undefined and the tile always read exactly 14 — a
                        // hardcoded number wearing a data expression.
                        value: skillsOverview?.confirmedCount ?? '—',
                        subtext: 'Tool patterns',
                        color: '#38bdf8'
                      },
                      {
                        label: 'Sync Status',
                        value: 'Live',
                        subtext: 'Obsidian linked',
                        color: '#c084fc'
                      }
                    ]}
                  />

                  {/* Unified Sub-Tab Bar */}
                  <SubTabBar
                    tabs={[
                      { id: 'memories', label: 'Facts', badge: apolloMemories.length },
                      { id: 'skills', label: 'Skills Matrix', badge: skillsOverview?.overallProficiencyScore != null ? `${skillsOverview.overallProficiencyScore}%` : undefined },
                      { id: 'profile', label: 'Profile' },
                      { id: 'vault', label: 'Vault' }
                    ]}
                    activeTab={apolloMobileTab}
                    onSelectTab={(t) => {
                      setApolloMobileTab(t);
                      if (t === 'skills') refreshSkillsOverview();
                    }}
                    accentColor="#fbbf24"
                  />

                  {/* 1. Memories Tab */}
                  {apolloMobileTab === 'memories' && (
                    <View>
                      <View style={[styles.hephTaskCard, { borderColor: 'rgba(245, 158, 11, 0.35)', padding: 14, marginBottom: 12 }]}>
                        <Text style={{ color: '#fbbf24', fontSize: 15, fontWeight: '800' }}>🧠 Persistent Fact Bank</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 4 }}>
                          {apolloMemories.length} facts in Persistent Memory Bank. Auto-syncs to Obsidian vault.
                        </Text>
                        <TouchableOpacity
                          style={[styles.hephPrimaryBtn, { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#f59e0b', marginTop: 10 }]}
                          onPress={handleApolloGarden}
                          disabled={apolloLoading}
                        >
                          <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '700' }}>
                            {apolloLoading ? 'Gardening...' : '🌿 Garden & Deduplicate Facts'}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 2 }}>
                        Recent Stored Facts
                      </Text>
                      {apolloMemories.slice(0, 10).map((mem, i) => (
                        <View key={i} style={[styles.hephTaskCard, { padding: 10, marginBottom: 6 }]}>
                          <Text style={{ color: '#f1f5f9', fontSize: 12 }}>• {mem}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* 2. Skills Matrix Tab */}
                  {apolloMobileTab === 'skills' && (
                    <View>
                      <View style={[styles.hephTaskCard, { borderColor: 'rgba(245, 158, 11, 0.35)', padding: 14, marginBottom: 12 }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View>
                            <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>Overall Proficiency</Text>
                            <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: '900', marginTop: 2 }}>
                              {skillsOverview?.overallProficiencyScore != null ? `${skillsOverview.overallProficiencyScore}%` : 'Calculating...'}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.hephPrimaryBtn, { backgroundColor: '#f59e0b', borderColor: '#f59e0b', paddingHorizontal: 12, paddingVertical: 6 }]}
                            onPress={handleApolloAutoTeach}
                            disabled={apolloLoading}
                          >
                            <Text style={{ color: '#000000', fontSize: 11.5, fontWeight: '800' }}>
                              {apolloLoading ? 'Teaching...' : '⚡ Auto-Teach'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
                          Auto-taught overnight via Claude investigation & Gemini cross-verification.
                        </Text>
                      </View>

                      <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 2 }}>
                        Domain Categories
                      </Text>
                      {skillsOverview?.categories?.map((cat) => {
                        const scoreColor = cat.proficiencyScore >= 90 ? '#4ade80' : cat.proficiencyScore >= 70 ? '#38bdf8' : cat.proficiencyScore >= 40 ? '#fbbf24' : '#f87171';
                        return (
                          <View key={cat.name} style={[styles.hephTaskCard, { padding: 10, marginBottom: 6 }]}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <Text style={{ color: '#f1f5f9', fontSize: 12.5, fontWeight: '700' }}>{cat.name}</Text>
                              <Text style={{ color: scoreColor, fontSize: 11.5, fontWeight: '800' }}>{cat.proficiencyScore}%</Text>
                            </View>
                            <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginVertical: 4 }}>
                              <View style={{ height: '100%', width: `${cat.proficiencyScore}%`, backgroundColor: scoreColor }} />
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                              <Text style={{ color: '#4ade80', fontSize: 10.5 }}>{cat.confirmedCount} verified</Text>
                              <Text style={{ color: cat.gapCount > 0 ? '#f87171' : '#64748b', fontSize: 10.5 }}>{cat.gapCount} gaps</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* 3. User Profile Tab */}
                  {apolloMobileTab === 'profile' && (
                    <View>
                      <View style={[styles.hephTaskCard, { borderColor: 'rgba(245, 158, 11, 0.35)', padding: 14, marginBottom: 12 }]}>
                        <Text style={{ color: '#fbbf24', fontSize: 15, fontWeight: '800' }}>👤 User Profile & Identity</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 4 }}>
                          Personalize your user name and Aloy's response tone.
                        </Text>
                        <View style={{ marginTop: 10 }}>
                          <Text style={[styles.modalLabel, { color: '#94a3b8', fontSize: 11 }]}>User Name</Text>
                          <TextInput
                            style={[styles.modalInput, { fontSize: 13, paddingVertical: 6, marginTop: 4 }]}
                            value={userName}
                            onChangeText={setUserName}
                            placeholder="Aloy User"
                            placeholderTextColor="#64748b"
                          />
                        </View>
                        <View style={{ marginTop: 8 }}>
                          <Text style={[styles.modalLabel, { color: '#94a3b8', fontSize: 11 }]}>Response Tone / Persona</Text>
                          <TextInput
                            style={[styles.modalInput, { fontSize: 13, paddingVertical: 6, marginTop: 4 }]}
                            value={userStyle}
                            onChangeText={setUserStyle}
                            placeholder="Concise, direct, highly technical..."
                            placeholderTextColor="#64748b"
                          />
                        </View>
                        <TouchableOpacity
                          style={[styles.hephPrimaryBtn, { backgroundColor: '#f59e0b', borderColor: '#f59e0b', marginTop: 12 }]}
                          onPress={saveUserProfile}
                        >
                          <Text style={{ color: '#000000', fontSize: 12, fontWeight: '800' }}>💾 Save Profile</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* 4. Vault Tab */}
                  {apolloMobileTab === 'vault' && (
                    <View>
                      <View style={[styles.hephTaskCard, { borderColor: 'rgba(245, 158, 11, 0.35)', padding: 14, marginBottom: 12 }]}>
                        <Text style={{ color: '#fbbf24', fontSize: 15, fontWeight: '800' }}>🗄️ Obsidian Vault Target</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 4 }}>
                          Documents/Vault Notes/Aloy Brain/
                        </Text>
                        <Text style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                          Auto-generates Personal_Memories.md, Learned_Knowledge.md, and Synthesized_Skills.md.
                        </Text>
                        <TouchableOpacity
                          style={[styles.hephActionBtn, { borderColor: '#f59e0b', marginTop: 10 }]}
                          onPress={handleApolloSyncVault}
                          disabled={apolloLoading}
                        >
                          <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '700' }}>
                            {apolloLoading ? 'Syncing...' : '🗄️ Sync to Obsidian Vault Now'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* MINERVA VIEW (Smart Home & Reliability Guard) */}
              {dashboardSection === 'minerva' && (
                <View style={{ paddingVertical: 12 }}>
                  {/* Unified Studio Header */}
                  <StudioHeader
                    icon={ShieldCheck}
                    title="MINERVA SENTINEL"
                    subtitle="Smart Home, Media & Reliability Watchdog"
                    accentColor="#10b981"
                    statusBadge={minervaHealth?.status?.toUpperCase() ?? 'NO DATA'}
                    actionButton={{
                      label: 'Run Audit',
                      icon: RefreshCw,
                      onPress: () => {
                        refreshMinervaHealth();
                        refreshSmartHome();
                        refreshJellyfin();
                      },
                      loading: minervaLoading,
                    }}
                  />

                  {/* Unified Pulse Grid */}
                  <PulseGrid
                    metrics={[
                      {
                        label: 'Perimeter',
                        // `unlocked === 0` was true for an EMPTY array too, so with no
                        // lock data — first load, or a failed fetch — the phone told
                        // you the house was LOCKED in green. No data is not "secure".
                        value: haCategories.locks.length === 0
                          ? 'NO DATA'
                          : (haCategories.locks.filter(l => l.state !== 'locked').length === 0
                              ? 'LOCKED'
                              : `${haCategories.locks.filter(l => l.state !== 'locked').length} OPEN`),
                        subtext: haCategories.locks.length === 0 ? 'No lock data' : 'Perimeter status',
                        color: haCategories.locks.length === 0
                          ? '#94a3b8'
                          : (haCategories.locks.filter(l => l.state !== 'locked').length === 0 ? '#22c55e' : '#f87171')
                      },
                      {
                        label: 'Lights On',
                        value: haCategories.lights.filter(l => l.state === 'on').length,
                        subtext: `${haCategories.lights.length} configured`,
                        color: '#fbbf24'
                      },
                      {
                        label: 'Climate',
                        value: haCategories.climate[0]?.attributes?.current_temperature != null
                          ? `${haCategories.climate[0].attributes.current_temperature}°`
                          : '—',
                        subtext: haCategories.climate[0]?.attributes?.temperature != null
                          ? `Target: ${haCategories.climate[0].attributes.temperature}°`
                          : 'No thermostat data',
                        color: '#38bdf8'
                      },
                      {
                        label: 'Sidecars',
                        // `|| 11` turned a real onlineCount of 0 — everything down —
                        // into "11/11 · Dependencies ok".
                        value: minervaHealth?.totalCount != null
                          ? `${minervaHealth.onlineCount ?? 0}/${minervaHealth.totalCount}`
                          : '—',
                        subtext: minervaHealth?.totalCount != null ? 'Dependencies' : 'No health data',
                        color: minervaHealth?.totalCount != null && minervaHealth.onlineCount === minervaHealth.totalCount
                          ? '#22c55e' : '#94a3b8'
                      }
                    ]}
                  />

                  {/* Jellyfin Whole-Home Media Orchestrator */}
                  <View style={{ marginBottom: 14 }}>
                    <MediaBentoTile
                      serverUrl={serverUrl}
                      jellyfinStatus={jellyfinStatus}
                      activeSessions={jellyfinSessions}
                      onTogglePlayPause={handleToggleJellyfinPlayback}
                      onOpenCastModal={() => setMediaCastVisible(true)}
                    />
                  </View>

                  {/* Smart Home Devices */}
                  {(haCategories.lights.length > 0 || haCategories.locks.length > 0 || haCategories.climate.length > 0) && (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={{ color: '#f8fafc', fontSize: 14, fontWeight: '700', marginBottom: 8 }}>
                        🏠 Smart Home Devices
                      </Text>
                      {haCategories.lights.map((light) => {
                        const isOn = light.state === 'on';
                        return (
                          <View key={light.entity_id} style={styles.smartHomeRow}>
                            <Lightbulb size={14} color={isOn ? '#fde047' : '#64748b'} style={{ marginRight: 6 }} />
                            <Text style={styles.smartHomeName} numberOfLines={1}>{light.name}</Text>
                            <TouchableOpacity
                              style={[isOn ? styles.denyButton : styles.confirmButton, { flex: 0, paddingVertical: 6 }]}
                              onPress={() => toggleDevice('light', isOn ? 'turn_off' : 'turn_on', light.entity_id)}
                            >
                              <Text style={styles.modalButtonText}>{isOn ? 'Turn OFF' : 'Turn ON'}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      {haCategories.locks.map((lock) => {
                        const isLocked = lock.state === 'locked';
                        return (
                          <View key={lock.entity_id} style={styles.smartHomeRow}>
                            {isLocked ? <Lock size={13} color="#4ade80" /> : <Unlock size={13} color="#f87171" />}
                            <Text style={[styles.smartHomeName, { marginLeft: 6 }]} numberOfLines={1}>{lock.name}</Text>
                            <TouchableOpacity
                              style={[isLocked ? styles.denyButton : styles.confirmButton, { flex: 0, paddingVertical: 6 }]}
                              onPress={() => toggleDevice('lock', isLocked ? 'unlock' : 'lock', lock.entity_id)}
                            >
                              <Text style={styles.modalButtonText}>{isLocked ? 'Unlock' : 'Lock'}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      {haCategories.climate.map((clim) => {
                        const isOff = clim.state === 'off';
                        const step = clim.attributes?.target_temp_step || 1;
                        const target = clim.attributes?.temperature;
                        const minTemp = clim.attributes?.min_temp ?? 40;
                        const maxTemp = clim.attributes?.max_temp ?? 95;
                        const onMode = (clim.attributes?.hvac_modes || []).find((m: string) => m !== 'off') || 'heat';
                        const adjustTemp = (delta: number) => {
                          if (typeof target !== 'number') return;
                          const next = Math.min(maxTemp, Math.max(minTemp, target + delta));
                          toggleDevice('climate', 'set_temperature', clim.entity_id, { temperature: next });
                        };
                        return (
                          <View key={clim.entity_id} style={styles.smartHomeRow}>
                            <Thermometer size={13} color={isOff ? '#64748b' : '#fb923c'} />
                            <Text style={[styles.smartHomeName, { marginLeft: 6 }]} numberOfLines={1}>
                              {clim.name}{typeof clim.attributes?.current_temperature === 'number' ? ` (${clim.attributes.current_temperature}°)` : ''}
                            </Text>
                            {!isOff && typeof target === 'number' && (
                              <>
                                <TouchableOpacity style={styles.climateStepButton} onPress={() => adjustTemp(-step)}>
                                  <Text style={styles.climateStepText}>−</Text>
                                </TouchableOpacity>
                                <Text style={styles.climateTargetText}>{target}°</Text>
                                <TouchableOpacity style={styles.climateStepButton} onPress={() => adjustTemp(step)}>
                                  <Text style={styles.climateStepText}>+</Text>
                                </TouchableOpacity>
                              </>
                            )}
                            <TouchableOpacity
                              style={[isOff ? styles.confirmButton : styles.denyButton, { flex: 0, paddingVertical: 6 }]}
                              onPress={() => toggleDevice('climate', 'set_hvac_mode', clim.entity_id, { hvac_mode: isOff ? onMode : 'off' })}
                            >
                              <Text style={styles.modalButtonText}>{isOff ? 'Turn On' : 'Turn Off'}</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Monitored Infrastructure */}
                  <Text style={{ color: '#f8fafc', fontSize: 14, fontWeight: '700', marginBottom: 8 }}>
                    🛡️ Monitored Sidecars & Security Gates
                  </Text>
                  {minervaHealth?.dependencies && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      {Object.entries(minervaHealth.dependencies).map(([k, v]: [string, any]) => {
                        const statusStr = (v?.status || '').toLowerCase();
                        const isOk = ['online', 'mounted', 'valid', 'available', 'configured', 'connected', 'ok', 'active'].includes(statusStr);
                        const isDegraded = ['degraded', 'warning', 'unknown'].includes(statusStr);
                        const statusColor = isOk ? '#34d399' : isDegraded ? '#fbbf24' : '#f87171';
                        const label = k === 'anthropicApiKey' ? 'Anthropic API Key'
                          : k === 'geminiApiKey' ? 'Gemini API Key'
                          : k === 'claudeModel' ? 'Claude Model'
                          : k === 'geminiModel' ? 'Gemini Model'
                          : k === 'mediaDriveP' ? 'Media Drive P:'
                          : k === 'homeAssistant' ? 'Home Assistant'
                          : k.charAt(0).toUpperCase() + k.slice(1);

                        return (
                          <View key={k} style={[styles.bentoTile, { width: '48%', padding: 10 }]}>
                            <Text style={{ color: '#94a3b8', fontSize: 11 }}>{label}</Text>
                            <Text style={{ color: statusColor, fontWeight: '800', fontSize: 13, marginTop: 2 }}>
                              {v?.status?.toUpperCase() || 'UNKNOWN'}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* HERMES VIEW */}
              {dashboardSection === 'hermes' && (
                <View style={{ paddingVertical: 12 }}>
                  {/* Unified Studio Header */}
                  <StudioHeader
                    icon={Briefcase}
                    title="HERMES OPS"
                    subtitle="Daily Briefings, Workouts & Financial Pulse"
                    accentColor="#8b5cf6"
                    statusBadge={serverReachable ? "OPERATIONAL" : "NO DATA"}
                    actionButton={{
                      label: 'New Brief',
                      icon: RefreshCw,
                      onPress: () => refreshHermes(),
                      loading: hermesLoading,
                    }}
                  />

                  {/* Unified Pulse Grid */}
                  <PulseGrid
                    metrics={[
                      {
                        label: 'Brief Status',
                        value: hermesBrief ? 'READY' : 'PENDING',
                        subtext: 'Morning brief',
                        color: '#8b5cf6'
                      },
                      {
                        label: 'Workouts',
                        value: calendarEvents.filter(e => isWorkoutEvent(e.summary)).length,
                        subtext: 'Upcoming routines',
                        color: '#f59e0b'
                      },
                      {
                        label: 'Portfolio',
                        value: hermesPortfolio?.holdings?.length || 0,
                        subtext: 'Tracked symbols',
                        color: '#38bdf8'
                      },
                      {
                        label: 'Job Radar',
                        value: jobListings.length,
                        subtext: 'Matches found',
                        color: '#22c55e'
                      }
                    ]}
                  />

                  {/* Unified Sub-Tab Bar */}
                  <SubTabBar
                    tabs={[
                      { id: 'brief', label: 'Briefing' },
                      { id: 'fitness', label: '🏋️ Fitness', badge: calendarEvents.filter(e => isWorkoutEvent(e.summary)).length },
                      { id: 'jobs', label: 'Job Radar', badge: jobListings.length },
                      { id: 'portfolio', label: 'Portfolio', badge: hermesPortfolio?.holdings?.length || 0 }
                    ]}
                    activeTab={hermesMobileTab}
                    onSelectTab={setHermesMobileTab}
                    accentColor="#8b5cf6"
                  />

                  {/* 1. Briefing Tab */}
                  {hermesMobileTab === 'brief' && (
                    <View>
                      <View style={[styles.hephTaskCard, { borderColor: 'rgba(139, 92, 246, 0.35)', padding: 14, marginBottom: 12 }]}>
                        <Text style={{ color: '#c084fc', fontSize: 16, fontWeight: '800' }}>💼 Hermes Operations & Logistics</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                          Daily executive morning briefs & operational analysis.
                        </Text>
                        <TouchableOpacity
                          style={[styles.hephPrimaryBtn, { backgroundColor: 'rgba(139, 92, 246, 0.2)', borderColor: '#8b5cf6', marginTop: 12 }]}
                          onPress={() => refreshHermes()}
                          disabled={hermesLoading}
                        >
                          <Text style={{ color: '#c084fc', fontSize: 12, fontWeight: '700' }}>
                            {hermesLoading ? 'Compiling...' : '⚡ Generate Morning Brief'}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {hermesBrief && (
                        <View style={[styles.hephTaskCard, { padding: 12, marginBottom: 12 }]}>
                          <Markdown
                            style={{
                              body: { color: '#f8fafc', fontSize: 12.5, lineHeight: 19 },
                              heading1: { color: '#c084fc', fontSize: 16, fontWeight: '800', marginTop: 10, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(192, 132, 252, 0.2)', paddingBottom: 4 },
                              heading2: { color: '#f8fafc', fontSize: 14, fontWeight: '700', marginTop: 10, marginBottom: 4 },
                              heading3: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 3 },
                              blockquote: { backgroundColor: 'rgba(139, 92, 246, 0.1)', borderLeftWidth: 3, borderLeftColor: '#a855f7', paddingHorizontal: 10, paddingVertical: 6, marginVertical: 6, borderRadius: 4 },
                              bullet_list: { marginVertical: 4 },
                              ordered_list: { marginVertical: 4 },
                              list_item: { marginVertical: 2, color: '#cbd5e1' },
                              table: { borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, marginVertical: 8 },
                              th: { backgroundColor: '#0f172a', padding: 6, color: '#c084fc', fontWeight: 'bold', fontSize: 11 },
                              tr: { borderBottomWidth: 1, borderBottomColor: '#1e293b' },
                              td: { padding: 6, color: '#cbd5e1', fontSize: 11 },
                              link: { color: '#a855f7', textDecorationLine: 'underline' },
                              code_inline: { backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#c084fc', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 11.5 }
                            }}
                          >
                            {hermesBrief.markdown}
                          </Markdown>
                        </View>
                      )}
                    </View>
                  )}

                  {/* 2. Fitness & Workouts Tab */}
                  {hermesMobileTab === 'fitness' && (
                    <View style={[styles.hephTaskCard, { borderColor: 'rgba(139, 92, 246, 0.35)', padding: 14, marginBottom: 12, backgroundColor: 'rgba(139, 92, 246, 0.08)' }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <View>
                          <Text style={{ color: '#f8fafc', fontSize: 15, fontWeight: '800' }}>🏋️ Upcoming Fitness & Workouts</Text>
                          <Text style={{ color: '#94a3b8', fontSize: 11 }}>From Google Calendar schedule & routine</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.hephSmallBtn, { backgroundColor: 'rgba(139, 92, 246, 0.2)', borderColor: '#8b5cf6' }]}
                          onPress={() => refreshCalendarEvents()}
                        >
                          <RefreshCw size={12} color="#c084fc" />
                        </TouchableOpacity>
                      </View>

                      {calendarEvents.filter(e => isWorkoutEvent(e.summary)).length > 0 ? (
                        <View style={{ gap: 8 }}>
                          {calendarEvents.filter(e => isWorkoutEvent(e.summary)).map((ev, idx) => {
                            const isExpanded = expandedWorkoutId === (ev.id || `${idx}`);
                            return (
                              <TouchableOpacity
                                key={ev.id || idx}
                                style={[styles.bentoTile, { padding: 12, gap: 6 }]}
                                onPress={() => setExpandedWorkoutId(isExpanded ? null : (ev.id || `${idx}`))}
                                activeOpacity={0.8}
                              >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                                    <Text style={[styles.drawerTagText, { color: '#c084fc', fontSize: 10 }]}>CALENDAR WORKOUT</Text>
                                  </View>
                                  <Text style={{ color: '#94a3b8', fontSize: 10.5 }}>{ev.start ? formatAgendaDateOnly(ev.start) : 'Upcoming'}</Text>
                                </View>
                                <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '700' }}>{ev.summary}</Text>
                                {ev.description ? (
                                  <View style={{ marginTop: 4 }}>
                                    <Text style={{ color: '#cbd5e1', fontSize: 11, lineHeight: 17 }} numberOfLines={isExpanded ? undefined : 2}>
                                      {ev.description}
                                    </Text>
                                    <Text style={{ color: '#c084fc', fontSize: 10.5, fontWeight: '700', marginTop: 4 }}>
                                      {isExpanded ? '▲ Collapse details' : '▼ Tap to view exercise breakdown'}
                                    </Text>
                                  </View>
                                ) : null}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={{ color: '#94a3b8', fontSize: 11 }}>
                          No upcoming workout sessions detected on your calendar for the next 2 days.
                        </Text>
                      )}
                    </View>
                  )}

                  {/* 3. Stock Portfolio Section */}
                  {hermesMobileTab === 'portfolio' && (
                    <View style={[styles.hephTaskCard, { borderColor: 'rgba(139, 92, 246, 0.25)', padding: 14, marginBottom: 12 }]}>
                      <Text style={{ color: '#f8fafc', fontSize: 15, fontWeight: '800' }}>Stock Portfolio</Text>
                      {hermesPortfolio?.hasData ? (
                        <>
                          <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                            {hermesPortfolio.gainers} up, {hermesPortfolio.decliners} down as of {new Date(hermesPortfolio.checkedAt).toLocaleTimeString()}
                          </Text>
                          {hermesPortfolio.totalValue != null && (
                            <Text style={{ color: '#f8fafc', fontSize: 20, fontWeight: '800', marginTop: 6 }}>
                              ${hermesPortfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              <Text style={{ fontSize: 11, fontWeight: '600', color: '#94a3b8' }}>
                                {' '}total{hermesPortfolio.totalValueIsPartial ? ' (partial)' : ''}
                              </Text>
                            </Text>
                          )}
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                            {hermesPortfolio.holdings.map((h: any) => {
                              const up = typeof h.changePercent === 'number' && h.changePercent > 0;
                              const down = typeof h.changePercent === 'number' && h.changePercent < 0;
                              const color = h.ok === false && !h.price ? '#64748b' : up ? '#34d399' : down ? '#f87171' : '#f8fafc';
                              const inputValue = shareInputs[h.symbol] !== undefined ? shareInputs[h.symbol] : (h.shares != null ? String(h.shares) : '');
                              return (
                                <View key={h.symbol} style={[styles.bentoTile, { width: '48%', padding: 10 }]}>
                                  <Text style={{ color: '#94a3b8', fontSize: 11 }}>{h.symbol}{h.stale ? ' (stale)' : ''}</Text>
                                  {h.ok === false && !h.price ? (
                                    <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Unavailable</Text>
                                  ) : (
                                    <>
                                      <Text style={{ color: '#f8fafc', fontSize: 16, fontWeight: '800', marginTop: 2 }}>${h.price}</Text>
                                      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{up ? '+' : ''}{h.changePercent}%</Text>
                                      {h.value != null && (
                                        <Text style={{ color: '#c4b5fd', fontSize: 11, marginTop: 2 }}>
                                          ${h.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} value
                                        </Text>
                                      )}
                                    </>
                                  )}
                                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
                                    <TextInput
                                      value={inputValue}
                                      onChangeText={(t) => setShareInputs((prev) => ({ ...prev, [h.symbol]: t }))}
                                      placeholder="shares"
                                      placeholderTextColor="#64748b"
                                      keyboardType="decimal-pad"
                                      style={{ flex: 1, minWidth: 0, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 6, color: '#f8fafc', fontSize: 11, paddingHorizontal: 6, paddingVertical: 4 }}
                                    />
                                    <TouchableOpacity
                                      onPress={() => handleSaveShares(h.symbol)}
                                      disabled={savingShareSymbol === h.symbol || shareInputs[h.symbol] === undefined}
                                      style={{ backgroundColor: '#8b5cf6', borderRadius: 6, paddingHorizontal: 8, justifyContent: 'center', opacity: shareInputs[h.symbol] === undefined ? 0.5 : 1 }}
                                    >
                                      <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '700' }}>
                                        {savingShareSymbol === h.symbol ? '…' : 'Set'}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        </>
                      ) : (
                        <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
                          No stock holdings configured or live market data unavailable.
                        </Text>
                      )}
                    </View>
                  )}

                  {/* 4. Job Radar Section */}
                  {hermesMobileTab === 'jobs' && (
                    <View style={[styles.hephTaskCard, { borderColor: 'rgba(168, 85, 247, 0.35)', padding: 14, marginBottom: 12, backgroundColor: 'rgba(168, 85, 247, 0.08)' }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View>
                          <Text style={{ color: '#f8fafc', fontSize: 15, fontWeight: '800' }}>🎯 Job Radar</Text>
                          <Text style={{ color: '#94a3b8', fontSize: 11 }}>Technical Writer & Content Dev Openings ({jobListings.length})</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.hephSmallBtn, { backgroundColor: isScanningJobs ? 'rgba(168, 85, 247, 0.4)' : '#a855f7', borderColor: '#c084fc' }]}
                          onPress={handleScanJobsMobile}
                          disabled={isScanningJobs}
                        >
                          <RefreshCw size={12} color="#ffffff" />
                          <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '800', marginLeft: 4 }}>
                            {isScanningJobs ? 'Scanning...' : 'Scan'}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {jobListings && jobListings.length > 0 ? (
                        <View style={{ gap: 8, marginTop: 10 }}>
                          {jobListings.slice(0, 8).map((job: any, idx: number) => (
                            <View key={job.id || idx} style={[styles.bentoTile, { padding: 10, gap: 4 }]}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <View style={[styles.drawerTagBadge, { backgroundColor: (job.query || '').toLowerCase().includes('technical writer') ? 'rgba(56, 189, 248, 0.2)' : 'rgba(168, 85, 247, 0.2)' }]}>
                                  <Text style={[styles.drawerTagText, { color: (job.query || '').toLowerCase().includes('technical writer') ? '#38bdf8' : '#c084fc', fontSize: 9.5 }]}>
                                    {job.query || 'Technical Writer'}
                                  </Text>
                                </View>
                                <Text style={{ color: '#94a3b8', fontSize: 10 }}>🕒 {job.postedTimeStr || 'Today'}</Text>
                              </View>
                              <Text style={{ color: '#f8fafc', fontSize: 12.5, fontWeight: '700' }}>{job.title}</Text>
                              <Text style={{ color: '#cbd5e1', fontSize: 11 }}>🏢 {job.company} • 📍 {job.location}</Text>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 6 }}>
                                <TouchableOpacity
                                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                                  onPress={() => job.url && Linking.openURL(job.url)}
                                >
                                  <Text style={{ color: '#38bdf8', fontSize: 11, fontWeight: '700' }}>Apply on LinkedIn ↗</Text>
                                </TouchableOpacity>
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                  <TouchableOpacity
                                    onPress={() => handleUpdateJobStatusMobile(job.id || job.jobId, job.status === 'saved' ? 'new' : 'saved')}
                                  >
                                    <Text style={{ color: job.status === 'saved' ? '#fbbf24' : '#94a3b8', fontSize: 11, fontWeight: '700' }}>
                                      {job.status === 'saved' ? '⭐ Saved' : '☆ Save'}
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => handleUpdateJobStatusMobile(job.id || job.jobId, job.status === 'applied' ? 'new' : 'applied')}
                                  >
                                    <Text style={{ color: job.status === 'applied' ? '#34d399' : '#94a3b8', fontSize: 11, fontWeight: '700' }}>
                                      {job.status === 'applied' ? '✓ Applied' : '💼 Apply'}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 8 }}>
                          Tap Scan to pull today's new Technical Writer and Content Developer postings.
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* PANTHEON STRATEGIC COUNCIL (CONCLAVE) VIEW */}
              {dashboardSection === 'conclave' && (() => {
                // Aggregate all sessions
                const sessionMap = new Map();
                if (conclaveData && conclaveData.id) sessionMap.set(conclaveData.id, conclaveData);
                (conclaveHistory || []).forEach(s => {
                  if (s && s.id && !sessionMap.has(s.id)) sessionMap.set(s.id, s);
                });
                const allSessions = Array.from(sessionMap.values()).sort((a, b) => new Date(b.convenedAt || 0).getTime() - new Date(a.convenedAt || 0).getTime());

                // Group by date
                const dateGroups: { [key: string]: any[] } = {};
                allSessions.forEach(sess => {
                  const dKey = getMobileSessionDateKey(sess.convenedAt) || 'Other';
                  if (!dateGroups[dKey]) dateGroups[dKey] = [];
                  dateGroups[dKey].push(sess);
                });
                const availDates = Object.keys(dateGroups).sort((a, b) => b.localeCompare(a));
                const todayK = getMobileSessionDateKey(new Date());
                const yestDate = new Date();
                yestDate.setDate(yestDate.getDate() - 1);
                const yestK = getMobileSessionDateKey(yestDate);

                const q = conclaveSearchQuery.trim().toLowerCase();
                const targetDates = conclaveDateFilter === 'ALL'
                  ? availDates
                  : availDates.filter(k => k === conclaveDateFilter);

                const displayedGroups = targetDates.map(dKey => {
                  const sessions = (dateGroups[dKey] || []).map(sess => {
                    const filteredThreads = (sess.threads || []).map((t: any) => {
                      if (!q) return t;
                      const matchTopic = (t.topic || '').toLowerCase().includes(q);
                      const matchDomain = (t.domain || '').toLowerCase().includes(q);
                      const matchMsg = (t.messages || []).filter((m: any) =>
                        (m.speaker || '').toLowerCase().includes(q) ||
                        (m.statement || '').toLowerCase().includes(q)
                      );
                      if (matchTopic || matchDomain) return t;
                      if (matchMsg.length > 0) return { ...t, messages: matchMsg };
                      return null;
                    }).filter(Boolean);

                    const filteredMinutes = (sess.minutes || []).filter((m: any) => {
                      if (!q) return true;
                      return (m.speaker || '').toLowerCase().includes(q) || (m.statement || '').toLowerCase().includes(q);
                    });

                    if (!q || filteredThreads.length > 0 || filteredMinutes.length > 0) {
                      return { ...sess, threads: filteredThreads, minutes: filteredMinutes };
                    }
                    return null;
                  }).filter(Boolean);

                  return sessions.length > 0 ? { dateKey: dKey, label: formatMobileDateLabel(dKey), sessions } : null;
                }).filter(Boolean);

                return (
                  <View style={{ paddingVertical: 12 }}>
                    {/* Unified Studio Header */}
                    <StudioHeader
                      icon={Landmark}
                      title="PANTHEON COUNCIL"
                      subtitle="Weekly Strategic Deliberation & Self-Evolution"
                      accentColor="#c084fc"
                      statusBadge={serverReachable ? "COUNCIL READY" : "NO DATA"}
                      actionButton={{
                        label: isConveningConclave ? 'Deliberating...' : 'Convene',
                        icon: RefreshCw,
                        onPress: handleConveneConclaveMobile,
                        loading: isConveningConclave,
                      }}
                    />

                    {/* Unified Pulse Grid */}
                    <PulseGrid
                      metrics={[
                        {
                          label: 'Conclaves',
                          value: allSessions.length,
                          subtext: 'Archived sessions',
                          color: '#c084fc'
                        },
                        {
                          label: 'Directives',
                          value: conclaveData?.directives?.length || 0,
                          subtext: 'Active mandates',
                          color: '#f59e0b'
                        },
                        {
                          label: 'Agent Debriefs',
                          value: conclaveData?.reports ? Object.keys(conclaveData.reports).length : 5,
                          subtext: 'Reporting agents',
                          color: '#38bdf8'
                        },
                        {
                          label: 'Current Session',
                          // 'W35' was hardcoded and has been wrong since early September.
                          value: conclaveData ? `W${conclaveData.isoWeek}` : '—',
                          subtext: `${conclaveData ? new Date(conclaveData.convenedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ready'}`,
                          color: '#22c55e'
                        }
                      ]}
                    />

                    {/* Unified Sub-Tab Bar */}
                    <SubTabBar
                      tabs={[
                        { id: 'minutes', label: '🗣️ Transcripts', badge: allSessions.reduce((acc, s) => acc + (s.threads?.length || 1), 0) },
                        { id: 'telemetry', label: '📊 Debriefs' },
                        { id: 'directives', label: '🎯 Directives', badge: conclaveData?.directives?.length || 0 },
                        { id: 'dossier', label: '📜 Dossier' },
                        { id: 'history', label: '🕒 History', badge: allSessions.length }
                      ]}
                      activeTab={conclaveMobileTab}
                      onSelectTab={(t) => setConclaveMobileTab(t as any)}
                      accentColor="#c084fc"
                    />

                    {/* TAB 1: Transcripts Organized by Date */}
                    {conclaveMobileTab === 'minutes' && (
                      <View style={{ gap: 10 }}>
                        {/* Date Pills & Search Bar */}
                        <View style={[styles.hephTaskCard, { width: '100%', padding: 12, borderColor: 'rgba(168, 85, 247, 0.35)', marginBottom: 6 }]}>
                          <Text style={{ color: '#c084fc', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8 }}>
                            📅 Filter Deliberations by Date
                          </Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <TouchableOpacity
                                style={[
                                  styles.hephTabBtn,
                                  conclaveDateFilter === 'ALL' && { backgroundColor: 'rgba(168, 85, 247, 0.3)', borderColor: '#c084fc' }
                                ]}
                                onPress={() => setConclaveDateFilter('ALL')}
                              >
                                <Text style={[styles.hephTabText, conclaveDateFilter === 'ALL' && { color: '#f3e8ff', fontWeight: '800' }]}>
                                  All Dates ({availDates.length})
                                </Text>
                              </TouchableOpacity>

                              {availDates.includes(todayK) && (
                                <TouchableOpacity
                                  style={[
                                    styles.hephTabBtn,
                                    conclaveDateFilter === todayK && { backgroundColor: 'rgba(168, 85, 247, 0.3)', borderColor: '#c084fc' }
                                  ]}
                                  onPress={() => setConclaveDateFilter(todayK)}
                                >
                                  <Text style={[styles.hephTabText, conclaveDateFilter === todayK && { color: '#f3e8ff', fontWeight: '800' }]}>
                                    Today
                                  </Text>
                                </TouchableOpacity>
                              )}

                              {availDates.includes(yestK) && (
                                <TouchableOpacity
                                  style={[
                                    styles.hephTabBtn,
                                    conclaveDateFilter === yestK && { backgroundColor: 'rgba(168, 85, 247, 0.3)', borderColor: '#c084fc' }
                                  ]}
                                  onPress={() => setConclaveDateFilter(yestK)}
                                >
                                  <Text style={[styles.hephTabText, conclaveDateFilter === yestK && { color: '#f3e8ff', fontWeight: '800' }]}>
                                    Yesterday
                                  </Text>
                                </TouchableOpacity>
                              )}

                              {availDates
                                .filter(k => k !== todayK && k !== yestK)
                                .slice(0, 4)
                                .map(dKey => (
                                  <TouchableOpacity
                                    key={dKey}
                                    style={[
                                      styles.hephTabBtn,
                                      conclaveDateFilter === dKey && { backgroundColor: 'rgba(168, 85, 247, 0.3)', borderColor: '#c084fc' }
                                    ]}
                                    onPress={() => setConclaveDateFilter(dKey)}
                                  >
                                    <Text style={[styles.hephTabText, conclaveDateFilter === dKey && { color: '#f3e8ff', fontWeight: '800' }]}>
                                      {formatMobileDateLabel(dKey)}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                            </View>
                          </ScrollView>

                          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 8, paddingHorizontal: 10, height: 38, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                            <Search size={14} color="#94a3b8" />
                            <TextInput
                              style={{ flex: 1, color: '#f8fafc', fontSize: 12, paddingHorizontal: 8 }}
                              placeholder="Search statements, topics, speakers..."
                              placeholderTextColor="#64748b"
                              value={conclaveSearchQuery}
                              onChangeText={setConclaveSearchQuery}
                            />
                            {conclaveSearchQuery ? (
                              <TouchableOpacity onPress={() => setConclaveSearchQuery('')}>
                                <Text style={{ color: '#94a3b8', fontSize: 12, paddingHorizontal: 4 }}>✕</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>

                        {/* Date Groups Rendering */}
                        {displayedGroups && displayedGroups.length > 0 ? (
                          displayedGroups.map((group: any) => (
                            <View key={group.dateKey} style={[styles.hephTaskCard, { width: '100%', padding: 14, gap: 12, borderColor: 'rgba(168, 85, 247, 0.25)', marginBottom: 10 }]}>
                              {/* Date Header */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', paddingBottom: 8 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <Calendar size={15} color="#c084fc" />
                                  <Text style={{ color: '#f8fafc', fontSize: 13.5, fontWeight: '800' }}>{group.label}</Text>
                                </View>
                                <Text style={{ color: '#94a3b8', fontSize: 11 }}>
                                  {group.sessions.length} session{group.sessions.length > 1 ? 's' : ''}
                                </Text>
                              </View>

                              {/* Sessions in Date Group */}
                              {group.sessions.map((sess: any, sIdx: number) => (
                                <View key={sess.id || sIdx} style={{ gap: 10 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 8 }}>
                                    <Text style={{ color: '#cbd5e1', fontSize: 11.5, fontWeight: '700' }}>
                                      🕒 {new Date(sess.convenedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Week {sess.isoWeek}
                                    </Text>
                                    {conclaveData?.id === sess.id ? (
                                      <Text style={{ color: '#34d399', fontSize: 10.5, fontWeight: '800' }}>✓ Active</Text>
                                    ) : (
                                      <TouchableOpacity onPress={() => setConclaveData(sess)}>
                                        <Text style={{ color: '#c084fc', fontSize: 11, fontWeight: '700' }}>Load Session</Text>
                                      </TouchableOpacity>
                                    )}
                                  </View>

                                  {/* Threads */}
                                  {(sess.threads || []).map((thread: any, tIdx: number) => (
                                    <View key={thread.id || tIdx} style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 12, paddingVertical: 8 }}>
                                        <Text style={{ color: '#f8fafc', fontSize: 12.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                                          🧵 {thread.topic}
                                        </Text>
                                        <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(168, 85, 247, 0.2)' }]}>
                                          <Text style={[styles.drawerTagText, { color: '#c084fc', fontSize: 9.5 }]}>{thread.domain}</Text>
                                        </View>
                                      </View>

                                      <View style={{ padding: 10, gap: 8 }}>
                                        {(thread.messages || []).map((m: any, mIdx: number) => (
                                          <View key={m.id || mIdx} style={{ flexDirection: 'row', gap: 8, paddingLeft: m.inReplyTo ? 14 : 0 }}>
                                            <Text style={{ fontSize: 16 }}>{m.avatar}</Text>
                                            <View style={{ flex: 1, backgroundColor: m.inReplyTo ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 8 }}>
                                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Text style={{ color: '#f8fafc', fontSize: 11.5, fontWeight: '700' }}>{m.speaker} <Text style={{ color: '#94a3b8', fontSize: 10 }}>({m.role})</Text></Text>
                                                <Text style={{ color: '#64748b', fontSize: 10 }}>{m.timeStr || ''}</Text>
                                              </View>
                                              <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4, lineHeight: 18 }}>"{m.statement}"</Text>
                                              {m.directiveRef && (
                                                <Text style={{ color: '#34d399', fontSize: 10, fontWeight: '700', marginTop: 4 }}>🎯 Directive: {m.directiveRef}</Text>
                                              )}
                                            </View>
                                          </View>
                                        ))}
                                      </View>
                                    </View>
                                  ))}
                                </View>
                              ))}
                            </View>
                          ))
                        ) : (
                          <View style={[styles.hephTaskCard, { width: '100%', padding: 28, alignItems: 'center', borderColor: 'rgba(168, 85, 247, 0.25)' }]}>
                            <Calendar size={28} color="#a855f7" />
                            <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '700', marginTop: 8 }}>
                              {conclaveSearchQuery ? `No matches for "${conclaveSearchQuery}"` : 'No transcripts found'}
                            </Text>
                            <TouchableOpacity
                              style={[styles.hephSmallBtn, { backgroundColor: 'rgba(168, 85, 247, 0.2)', borderColor: '#a855f7', marginTop: 10 }]}
                              onPress={() => { setConclaveDateFilter('ALL'); setConclaveSearchQuery(''); }}
                            >
                              <Text style={{ color: '#f3e8ff', fontSize: 11, fontWeight: '700' }}>View All Dates</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    {/* TAB 2: Telemetry Debriefs */}
                    {conclaveMobileTab === 'telemetry' && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {conclaveData?.reports ? (
                          Object.entries(conclaveData.reports).map(([agent, rep]: [string, any]) => (
                            <View key={agent} style={[styles.hephTaskCard, { width: '48.5%', padding: 12, marginBottom: 8, borderColor: 'rgba(168, 85, 247, 0.25)' }]}>
                              <Text style={{ color: '#f8fafc', fontSize: 12.5, fontWeight: '800' }}>{rep.agent || agent}</Text>
                              <Text style={{ color: rep.status === 'HEALTHY' || rep.status === 'STRONG' || rep.status === 'READY' ? '#34d399' : '#fbbf24', fontSize: 10.5, fontWeight: '700', marginTop: 2 }}>
                                {rep.status}
                              </Text>
                              <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, lineHeight: 16 }}>{rep.summary}</Text>
                            </View>
                          ))
                        ) : (
                          <Text style={{ color: '#94a3b8', fontSize: 12 }}>No telemetry reports recorded.</Text>
                        )}
                      </View>
                    )}

                    {/* TAB 3: Directives */}
                    {conclaveMobileTab === 'directives' && (
                      <View style={{ gap: 8 }}>
                        {(conclaveData?.directives || []).map((d: any, idx: number) => (
                          <View key={d.id || idx} style={[styles.hephTaskCard, { width: '100%', padding: 12, gap: 4, borderColor: 'rgba(168, 85, 247, 0.25)', marginBottom: 8 }]}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={{ color: d.priority === 'HIGH' ? '#f87171' : '#fbbf24', fontSize: 10, fontWeight: '800' }}>
                                [{d.priority}] {d.domain}
                              </Text>
                              <Text style={{ color: '#c084fc', fontSize: 11, fontWeight: '700' }}>{d.assignedTo}</Text>
                            </View>
                            <Text style={{ color: '#f8fafc', fontSize: 13, fontWeight: '700' }}>{d.title}</Text>
                            <Text style={{ color: '#94a3b8', fontSize: 11.5, lineHeight: 17 }}>{d.description}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* TAB 4: Dossier */}
                    {conclaveMobileTab === 'dossier' && (
                      <View style={[styles.hephTaskCard, { width: '100%', padding: 14, borderColor: 'rgba(168, 85, 247, 0.25)' }]}>
                        <Markdown
                          style={{
                            body: { color: '#cbd5e1', fontSize: 12.5, lineHeight: 19 },
                            heading1: { color: '#a855f7', fontSize: 16, fontWeight: '800', marginTop: 10, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(168, 85, 247, 0.2)', paddingBottom: 4 },
                            heading2: { color: '#f8fafc', fontSize: 14, fontWeight: '700', marginTop: 10, marginBottom: 4 },
                            heading3: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 3 },
                            blockquote: { backgroundColor: 'rgba(168, 85, 247, 0.1)', borderLeftWidth: 3, borderLeftColor: '#a855f7', paddingHorizontal: 10, paddingVertical: 6, marginVertical: 6, borderRadius: 4 },
                            bullet_list: { marginVertical: 4 },
                            ordered_list: { marginVertical: 4 },
                            list_item: { marginVertical: 2, color: '#cbd5e1' },
                            table: { borderWidth: 1, borderColor: '#1e293b', borderRadius: 6, marginVertical: 8 },
                            th: { backgroundColor: '#0f172a', padding: 6, color: '#a855f7', fontWeight: 'bold', fontSize: 11 },
                            tr: { borderBottomWidth: 1, borderBottomColor: '#1e293b' },
                            td: { padding: 6, color: '#cbd5e1', fontSize: 11 },
                            code_inline: { backgroundColor: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 11.5 }
                          }}
                        >
                          {conclaveData?.markdown || 'No executive dossier content available.'}
                        </Markdown>
                      </View>
                    )}

                    {/* TAB 5: History */}
                    {conclaveMobileTab === 'history' && (
                      <View style={{ gap: 8 }}>
                        {allSessions.map((sess: any) => (
                          <TouchableOpacity
                            key={sess.id}
                            style={[styles.bentoTile, { padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, conclaveData?.id === sess.id && { borderColor: '#a855f7' }]}
                            onPress={() => { setConclaveData(sess); setConclaveMobileTab('minutes'); }}
                          >
                            <View>
                              <Text style={{ color: '#f8fafc', fontSize: 12, fontWeight: '700' }}>Week {sess.isoWeek}, {sess.year} Conclave</Text>
                              <Text style={{ color: '#94a3b8', fontSize: 10.5, marginTop: 2 }}>
                                {formatMobileDateLabel(getMobileSessionDateKey(sess.convenedAt))} • {sess.directives?.length || 0} Directives
                              </Text>
                            </View>
                            <ChevronRight size={14} color="#94a3b8" />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })()}
            </ScrollView>
          </View>
        ) : (
        <>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={[styles.messageList, { flexGrow: 1, justifyContent: messages.length === 0 ? 'center' : 'flex-start' }]}
          style={styles.flexFill}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            const { reasoning, mainContent } = parseMessageContent(item.content);
            const isOpen = !!expandedReasoning[index];
            return (
              <View>
                {reasoning && (
                  <View style={styles.reasoningContainer}>
                    <TouchableOpacity
                      onPress={() => setExpandedReasoning((prev) => ({ ...prev, [index]: !prev[index] }))}
                    >
                      <Text style={styles.reasoningToggleText}>
                        {isOpen ? '▾' : '▸'} Reasoning Process
                      </Text>
                    </TouchableOpacity>
                    {isOpen && <Text style={styles.reasoningText}>{reasoning}</Text>}
                  </View>
                )}
                {item.role === 'user' && editingIndex === index ? (
                  <View style={[styles.bubble, styles.userBubble, { gap: 8 }]}>
                    <TextInput
                      autoFocus
                      multiline
                      value={editDraft}
                      onChangeText={setEditDraft}
                      style={styles.editInput}
                    />
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                      <TouchableOpacity onPress={() => setEditingIndex(null)} style={styles.editCancelBtn}>
                        <Text style={styles.editCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={!editDraft.trim()}
                        onPress={() => { editAndResend(index, editDraft); setEditingIndex(null); }}
                        style={[styles.editSaveBtn, { opacity: editDraft.trim() ? 1 : 0.5 }]}
                      >
                        <Text style={styles.editSaveText}>Save &amp; Resend</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (!!mainContent || item.image) && (
                  <View>
                    <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                      {item.image && (
                        <Image source={{ uri: item.image }} style={styles.messageImage} resizeMode="cover" />
                      )}
                      {!!mainContent && <Markdown style={markdownStyles}>{mainContent}</Markdown>}
                      {item.answeredViaClaude && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                          <Zap size={11} color="#c084fc" />
                          <Text style={{ fontSize: 11, fontWeight: '600', color: '#c084fc' }}>Answered via Claude</Text>
                        </View>
                      )}
                    </View>

                    {item.role === 'user' ? (
                      <TouchableOpacity
                        disabled={isSending}
                        onPress={() => { setEditDraft(item.content); setEditingIndex(index); }}
                        style={[styles.msgActionBtn, { alignSelf: 'flex-end' }]}
                        accessibilityLabel="Edit message"
                      >
                        <Pencil size={11} color="#7dd3fc" />
                        <Text style={[styles.msgActionText, { color: '#7dd3fc' }]}>Edit</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        disabled={isSending}
                        onPress={() => regenerateFrom(index)}
                        style={[styles.msgActionBtn, { alignSelf: 'flex-start' }]}
                        accessibilityLabel="Regenerate response"
                      >
                        <RotateCcw size={11} color="#64748b" />
                        <Text style={[styles.msgActionText, { color: '#64748b' }]}>Regenerate</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />

        {isSending && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, alignSelf: 'center' }}>
            <ActivityIndicator color="#00f2fe" />
            {/* Polled from the server (see startStatusPolling) — turns a
                bare spinner into "Checking calendar…" during a tool-heavy
                turn instead of leaving the screen dark for up to 180s. */}
            <Text style={{ color: '#94a3b8', fontSize: 12.5 }}>{sendStatusText || 'Thinking…'}</Text>
          </View>
        )}

        {attachedImage && (
          <View style={styles.attachedImageRow}>
            <Image source={{ uri: attachedImage }} style={styles.attachedImageThumb} resizeMode="cover" />
            <TouchableOpacity
              style={styles.attachedImageRemove}
              onPress={() => setAttachedImage(null)}
              accessibilityLabel="Remove attached photo"
            >
              <X size={14} color="#e2e8f0" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputRow}>
          <TouchableOpacity
            style={styles.micButton}
            onPress={pickImage}
            accessibilityLabel="Attach a photo"
          >
            <ImageIcon size={18} color={attachedImage ? '#00f2fe' : '#94a3b8'} />
          </TouchableOpacity>
          <TextInput
            ref={chatInputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Aloy..."
            placeholderTextColor="#64748b"
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={styles.micButton}
            onPress={toggleMicListening}
            disabled={isTranscribing}
            accessibilityLabel={isRecording ? 'Stop voice input' : 'Start voice input'}
          >
            {isTranscribing
              ? <ActivityIndicator size="small" color="#00f2fe" />
              : isRecording
                ? <MicOff size={18} color="#f87171" />
                : <Mic size={18} color="#00f2fe" />}
          </TouchableOpacity>
          {isSending ? (
            <TouchableOpacity
              style={[styles.sendButton, styles.stopButton]}
              onPress={stopSending}
              accessibilityLabel="Stop generating"
            >
              <Square size={16} color="#f87171" fill="#f87171" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => sendMessage()}
              disabled={isSending}
              accessibilityLabel="Send message"
            >
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          )}
        </View>
        </>
        )}

        {/* 📱 Mobile Bottom Navigation Bar - Collapses when keyboard is active to keep prompt input fully visible */}
        {!isKeyboardVisible && (
        <View style={styles.bottomTabBar}>
          <TouchableOpacity
            style={[styles.bottomTabItem, dashboardVisible && dashboardSection === 'hub' && styles.bottomTabItemActive]}
            onPress={() => { setDashboardVisible(true); setDashboardSection('hub'); }}
          >
            <LayoutDashboard size={18} color={dashboardVisible && dashboardSection === 'hub' ? '#00f2fe' : '#64748b'} />
            <Text style={[styles.bottomTabText, dashboardVisible && dashboardSection === 'hub' && styles.bottomTabTextActive]}>
              Home
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomTabItem, !dashboardVisible && styles.bottomTabItemActive]}
            onPress={() => { setDashboardVisible(false); }}
          >
            <MessageSquare size={18} color={!dashboardVisible ? '#00f2fe' : '#64748b'} />
            <Text style={[styles.bottomTabText, !dashboardVisible && styles.bottomTabTextActive]}>
              Chat
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomTabItem, dashboardVisible && dashboardSection === 'hermes' && styles.bottomTabItemActive]}
            onPress={() => { setDashboardVisible(true); setDashboardSection('hermes'); refreshHermes(); }}
          >
            <Briefcase size={18} color={dashboardVisible && dashboardSection === 'hermes' ? '#c084fc' : '#64748b'} />
            <Text style={[styles.bottomTabText, dashboardVisible && dashboardSection === 'hermes' && { color: '#c084fc', fontWeight: '800' }]}>
              Hermes
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomTabItem, dashboardVisible && dashboardSection === 'conclave' && styles.bottomTabItemActive]}
            onPress={() => { setDashboardVisible(true); setDashboardSection('conclave'); refreshConclave(); }}
          >
            <Landmark size={18} color={dashboardVisible && dashboardSection === 'conclave' ? '#c084fc' : '#64748b'} />
            <Text style={[styles.bottomTabText, dashboardVisible && dashboardSection === 'conclave' && { color: '#c084fc', fontWeight: '800' }]}>
              Pantheon
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomTabItem, dashboardVisible && (dashboardSection === 'hephaestus' || dashboardSection === 'cauldron' || dashboardSection === 'forge') && styles.bottomTabItemActive]}
            onPress={() => { setDashboardVisible(true); setDashboardSection('cauldron'); refreshHephTasks(); refreshProjectStatuses(); }}
          >
            <Flame size={18} color={dashboardVisible && (dashboardSection === 'hephaestus' || dashboardSection === 'cauldron' || dashboardSection === 'forge') ? '#f59e0b' : '#64748b'} />
            <Text style={[styles.bottomTabText, dashboardVisible && (dashboardSection === 'hephaestus' || dashboardSection === 'cauldron' || dashboardSection === 'forge') && { color: '#f59e0b', fontWeight: '800' }]}>
              Forge
            </Text>
          </TouchableOpacity>
        </View>
        )}
      </KeyboardAvoidingView>

      {/* Tool confirmation dialog — mirrors the desktop app's confirm gate */}
      <Modal visible={!!pendingConfirmation} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Action</Text>
            {pendingConfirmation?.pendingCalls.map((call: any) => (
              <View key={call.id} style={{ marginBottom: 12 }}>
                <Text style={styles.modalLabel}>{call.confirmLabel}</Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity style={styles.denyButton} onPress={() => resolvePendingCall(call.id, false)}>
                    <Text style={styles.modalButtonText}>Deny</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.confirmButton} onPress={() => resolvePendingCall(call.id, true)}>
                    <Text style={styles.modalButtonText}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* 📱 Full Desktop-Parity Sidebar Drawer */}
      {threadsVisible && (
        <View style={styles.drawerOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeDrawer}
          />
          <Animated.View style={[styles.drawerPanel, { transform: [{ translateX: drawerAnim }] }]}>
            <View style={styles.drawerHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.drawerLogoBadge}>
                  <Cpu size={18} color="#00f2fe" />
                </View>
                <View>
                  <Text style={styles.drawerBrandTitle}>Aloy</Text>
                  <Text style={styles.drawerBrandSub}>FOCUS v2.0.0</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.drawerOnlinePill}>
                  <View style={styles.drawerOnlineDot} />
                  {/* Was the literal string "Online" beside a green dot, so the
                      drawer claimed a healthy connection with the server
                      unplugged. */}
                  <Text style={styles.drawerOnlineText}>{serverReachable ? 'Online' : 'Offline'}</Text>
                </View>
                <TouchableOpacity onPress={closeDrawer} style={{ padding: 4 }}>
                  <X size={20} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={styles.flexFill} showsVerticalScrollIndicator={false}>
              {/* Main Nav Items: Dashboard & Chat Area */}
              <View style={styles.drawerNavGroup}>
                <TouchableOpacity
                  style={[
                    styles.drawerPrimaryNavBtn,
                    dashboardVisible && dashboardSection === 'hub' && styles.drawerPrimaryNavBtnActive
                  ]}
                  onPress={() => {
                    closeDrawer();
                    setDashboardSection('hub');
                    setDashboardVisible(true);
                  }}
                >
                  <LayoutDashboard size={16} color={dashboardVisible && dashboardSection === 'hub' ? '#00f2fe' : '#94a3b8'} />
                  <Text style={[
                    styles.drawerPrimaryNavText,
                    dashboardVisible && dashboardSection === 'hub' && styles.drawerPrimaryNavTextActive
                  ]}>
                    Dashboard
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.drawerPrimaryNavBtn,
                    !dashboardVisible && styles.drawerPrimaryNavBtnActive
                  ]}
                  onPress={() => {
                    closeDrawer();
                    setDashboardVisible(false);
                  }}
                >
                  <MessageSquare size={16} color={!dashboardVisible ? '#00f2fe' : '#94a3b8'} />
                  <Text style={[
                    styles.drawerPrimaryNavText,
                    !dashboardVisible && styles.drawerPrimaryNavTextActive
                  ]}>
                    Chat Area
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.drawerNewChatBtn}
                  onPress={() => {
                    closeDrawer();
                    createNewThread();
                    setDashboardVisible(false);
                  }}
                >
                  <Plus size={15} color="#000000" />
                  <Text style={styles.drawerNewChatText}>New Conversation</Text>
                </TouchableOpacity>
              </View>

              {/* Autonomous Sub-Agents Section */}
              <View style={[styles.drawerSectionHeader, { marginTop: 14 }]}>
                <Text style={styles.drawerSectionTitle}>STRATEGIC COUNCIL & AGENTS</Text>
              </View>

              {/* 0. PANTHEON STRATEGIC COUNCIL */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(168, 85, 247, 0.35)',
                    backgroundColor: dashboardVisible && dashboardSection === 'conclave' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(168, 85, 247, 0.05)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setDashboardSection('conclave');
                  setDashboardVisible(true);
                  refreshConclave();
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(168, 85, 247, 0.2)' }]}>
                  <Landmark size={15} color="#c084fc" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Pantheon Council</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(168, 85, 247, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#c084fc' }]}>COUNCIL</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Weekly Strategic Deliberation</Text>
                </View>
              </TouchableOpacity>

              {/* 1. HEPHAESTUS */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(245, 158, 11, 0.3)',
                    backgroundColor: dashboardVisible && dashboardSection === 'cauldron' ? 'rgba(245, 158, 11, 0.18)' : 'rgba(245, 158, 11, 0.05)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setDashboardSection('cauldron');
                  setDashboardVisible(true);
                  refreshHephTasks();
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                  <Flame size={15} color="#f59e0b" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Hephaestus</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(245, 158, 11, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#f59e0b' }]}>HEPH</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Code Forge & Monitored Projects</Text>
                </View>
              </TouchableOpacity>

              {/* 2. ATHENA */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(56, 189, 248, 0.3)',
                    backgroundColor: dashboardVisible && dashboardSection === 'athena' ? 'rgba(56, 189, 248, 0.18)' : 'rgba(56, 189, 248, 0.05)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setDashboardSection('athena');
                  setDashboardVisible(true);
                  refreshAthenaTasks();
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.2)' }]}>
                  <Sparkles size={15} color="#38bdf8" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Athena</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(56, 189, 248, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#38bdf8' }]}>SCOUT</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Deep Research & Dossiers</Text>
                </View>
              </TouchableOpacity>

              {/* 3. APOLLO */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(251, 191, 36, 0.3)',
                    backgroundColor: dashboardVisible && dashboardSection === 'apollo' ? 'rgba(251, 191, 36, 0.18)' : 'rgba(251, 191, 36, 0.05)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setDashboardSection('apollo');
                  setDashboardVisible(true);
                  refreshApollo();
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(251, 191, 36, 0.2)' }]}>
                  <BookOpen size={15} color="#fbbf24" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Apollo</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(251, 191, 36, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#fbbf24' }]}>VAULT</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Knowledge, Skills & Memory Gardener</Text>
                </View>
              </TouchableOpacity>

              {/* 4. MINERVA */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(16, 185, 129, 0.3)',
                    backgroundColor: dashboardVisible && dashboardSection === 'minerva' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.05)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setDashboardSection('minerva');
                  setDashboardVisible(true);
                  refreshMinervaHealth();
                  refreshSmartHome();
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                  <Shield size={15} color="#10b981" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Minerva</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(16, 185, 129, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#10b981' }]}>SENTINEL</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Smart Home & Reliability Guard</Text>
                </View>
              </TouchableOpacity>

              {/* 5. HERMES */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(139, 92, 246, 0.3)',
                    backgroundColor: dashboardVisible && dashboardSection === 'hermes' ? 'rgba(139, 92, 246, 0.18)' : 'rgba(139, 92, 246, 0.05)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setDashboardSection('hermes');
                  setDashboardVisible(true);
                  refreshHermes();
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                  <Briefcase size={15} color="#8b5cf6" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Hermes</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(139, 92, 246, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#8b5cf6' }]}>BRIEF</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Operations & Daily Pulse</Text>
                </View>
              </TouchableOpacity>

              {/* MEDIA & INFRASTRUCTURE SECTION */}
              <View style={[styles.drawerSectionHeader, { marginTop: 16 }]}>
                <Text style={styles.drawerSectionTitle}>MEDIA & INFRASTRUCTURE</Text>
              </View>

              {/* MEDIA CAST */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(0, 242, 254, 0.3)',
                    backgroundColor: 'rgba(0, 242, 254, 0.06)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setMediaCastVisible(true);
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(0, 242, 254, 0.2)' }]}>
                  <Tv size={15} color="#00f2fe" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Media Cast</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(0, 242, 254, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#00f2fe' }]}>CAST</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Stream to Bazzite, Roku & TVs</Text>
                </View>
              </TouchableOpacity>

              {/* MEDIA STACK (*ARR HUB) */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(168, 85, 247, 0.35)',
                    backgroundColor: 'rgba(168, 85, 247, 0.08)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  setMediaStackVisible(true);
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(168, 85, 247, 0.25)' }]}>
                  <Layers size={15} color="#c084fc" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Media Stack</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(168, 85, 247, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#c084fc' }]}>ARR</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Sonarr, Radarr, Lidarr, RetroArr</Text>
                </View>
              </TouchableOpacity>

              {/* ROUTE INTEL */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(0, 242, 254, 0.3)',
                    backgroundColor: 'rgba(0, 242, 254, 0.06)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  Linking.openURL(`${serverUrl}/api/network/telemetry`).catch(() => {
                    Alert.alert('Route Intel', 'Network telemetry is active.');
                  });
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(0, 242, 254, 0.2)' }]}>
                  <Globe size={15} color="#00f2fe" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Route Intel</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(0, 242, 254, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#00f2fe' }]}>NET</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>BGP, IXP & Mesh Telemetry</Text>
                </View>
              </TouchableOpacity>

              {/* 📖 Developer Documentation Link */}
              <TouchableOpacity
                style={[
                  styles.drawerSubagentCard,
                  {
                    borderColor: 'rgba(56, 189, 248, 0.3)',
                    backgroundColor: 'rgba(56, 189, 248, 0.06)'
                  }
                ]}
                onPress={() => {
                  closeDrawer();
                  Linking.openURL(`${serverUrl}/docs/`).catch((err) => {
                    Alert.alert('Could not open docs', err.message);
                  });
                }}
              >
                <View style={[styles.drawerSubagentIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.2)' }]}>
                  <BookOpen size={15} color="#38bdf8" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.drawerSubagentName}>Developer Docs</Text>
                    <View style={[styles.drawerTagBadge, { backgroundColor: 'rgba(56, 189, 248, 0.25)' }]}>
                      <Text style={[styles.drawerTagText, { color: '#38bdf8' }]}>DOCS ↗</Text>
                    </View>
                  </View>
                  <Text style={styles.drawerSubagentSub} numberOfLines={1}>Architecture, APIs & Guides</Text>
                </View>
              </TouchableOpacity>

              {/* Recent Chats Section */}
              <View style={[styles.drawerSectionHeader, { marginTop: 16 }]}>
                <Text style={styles.drawerSectionTitle}>RECENT CONVERSATIONS</Text>
              </View>

              {threads.length === 0 ? (
                <Text style={[styles.modalLabel, { fontSize: 12, paddingHorizontal: 4 }]}>No conversations yet.</Text>
              ) : (
                threads.map((item) => (
                  <View key={item.id} style={styles.threadRow}>
                    <TouchableOpacity
                      style={styles.flexFill}
                      onPress={() => {
                        openThread(item.id);
                        setDashboardVisible(false);
                        closeDrawer();
                      }}
                    >
                      <Text
                        style={[
                          styles.threadTitle,
                          item.id === chatId && !dashboardVisible && styles.threadTitleActive
                        ]}
                        numberOfLines={1}
                      >
                        {item.title || 'Untitled Chat'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteThread(item.id)} style={{ padding: 6 }}>
                      <Text style={{ color: '#ef4444', fontSize: 16 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>

            {/* Drawer Footer */}
            <View style={styles.drawerFooter}>
              <TouchableOpacity
                style={styles.drawerSettingsBtn}
                onPress={() => {
                  closeDrawer();
                  setSettingsVisible(true);
                }}
              >
                <SettingsIcon size={16} color="#94a3b8" />
                <Text style={styles.drawerSettingsText}>Aloy Server Settings</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      )}

      {/* Create Task Modal */}
      <Modal visible={createTaskModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>🔥 New Work Order</Text>
              <TouchableOpacity onPress={() => setCreateTaskModalVisible(false)}>
                <X size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>Task Title</Text>
            <TextInput
              style={styles.settingsInput}
              placeholder="e.g. Add level completion sound"
              placeholderTextColor="#64748b"
              value={newHephTitle}
              onChangeText={setNewHephTitle}
            />
            <Text style={styles.modalLabel}>Category</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
              {(['feature', 'bugfix', 'refactor'] as const).map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.hephCatChip,
                    newHephCategory === cat && styles.hephCatChipActive
                  ]}
                  onPress={() => setNewHephCategory(cat)}
                >
                  <Text style={[
                    styles.hephCatText,
                    newHephCategory === cat && styles.hephCatTextActive
                  ]}>
                    {cat.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.modalLabel}>Requirements / Description</Text>
            <TextInput
              style={[styles.settingsInput, styles.settingsInputMultiline]}
              placeholder="Detail what HEPHAESTUS should modify..."
              placeholderTextColor="#64748b"
              multiline
              value={newHephDesc}
              onChangeText={setNewHephDesc}
            />
            <TouchableOpacity
              style={[styles.confirmButton, { backgroundColor: '#f59e0b', marginTop: 8 }]}
              onPress={handleCreateHephTask}
              disabled={!newHephTitle.trim()}
            >
              <Text style={[styles.modalButtonText, { color: '#07090e' }]}>Dispatch to Cauldron</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create Athena Mission Modal */}
      <Modal visible={createAthenaModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[styles.modalTitle, { color: '#38bdf8' }]}>🦉 New Research Mission</Text>
              <TouchableOpacity onPress={() => setCreateAthenaModalVisible(false)}>
                <X size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>Topic / Question to Investigate</Text>
            <TextInput
              style={[styles.settingsInput, { minHeight: 56, textAlignVertical: 'top' }]}
              placeholder="e.g. Compare top LFP vs NMC home battery backups"
              placeholderTextColor="#64748b"
              multiline
              value={newAthenaQuery}
              onChangeText={setNewAthenaQuery}
            />
            <Text style={styles.modalLabel}>Research Depth</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
              {(['quick', 'standard', 'deep_dive'] as const).map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.hephCatChip,
                    { borderColor: newAthenaDepth === d ? '#38bdf8' : 'rgba(255,255,255,0.08)' },
                    newAthenaDepth === d && { backgroundColor: 'rgba(56, 189, 248, 0.2)' }
                  ]}
                  onPress={() => setNewAthenaDepth(d)}
                >
                  <Text style={[
                    styles.hephCatText,
                    newAthenaDepth === d && { color: '#38bdf8', fontWeight: '800' }
                  ]}>
                    {d === 'quick' ? '⚡ QUICK' : d === 'standard' ? '🔍 STANDARD' : '🧠 DEEP DIVE'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.modalLabel}>Focus Areas (Optional, comma-separated)</Text>
            <TextInput
              style={styles.settingsInput}
              placeholder="e.g. Cost per kWh, safety, degradation"
              placeholderTextColor="#64748b"
              value={newAthenaFocus}
              onChangeText={setNewAthenaFocus}
            />
            <TouchableOpacity
              style={[styles.confirmButton, { backgroundColor: '#38bdf8', marginTop: 8 }]}
              onPress={handleCreateAthenaTask}
              disabled={!newAthenaQuery.trim()}
            >
              <Text style={[styles.modalButtonText, { color: '#07090e' }]}>Launch Research Mission</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Settings */}
      <Modal visible={settingsVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Aloy Server Settings</Text>
            <Text style={styles.modalLabel}>Server URL (Tailscale)</Text>
            <TextInput style={styles.settingsInput} value={urlInput} onChangeText={setUrlInput} autoCapitalize="none" />
            <Text style={styles.modalLabel}>Auth Token</Text>
            <TextInput style={styles.settingsInput} value={tokenInput} onChangeText={setTokenInput} autoCapitalize="none" secureTextEntry />
            <View style={styles.autoSpeakRow}>
              <Text style={styles.modalLabel}>Auto-Speak Replies</Text>
              <Switch value={autoSpeak} onValueChange={toggleAutoSpeak} />
            </View>
            <TouchableOpacity style={styles.confirmButton} onPress={saveSettings}>
              <Text style={styles.modalButtonText}>Save</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButton, { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderWidth: 1, borderColor: '#38bdf8', marginTop: 10 }]}
              onPress={() => {
                Linking.openURL(`${serverUrl}/docs/`).catch((err) => {
                  Alert.alert('Could not open docs', err.message);
                });
              }}
            >
              <Text style={[styles.modalButtonText, { color: '#38bdf8' }]}>📖 View Developer Docs</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 12 }}>
              <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '700' }}>Aloy Mobile v2.0.0 (Build 200)</Text>
              <Text style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>Unified Ecosystem Architecture</Text>
            </View>
          </View>
        </View>
      </Modal>


      {/* Vision Events — real browsable list behind the "Vision: N events"
          drawer widget, since that widget only ever showed a one-line
          summary with no way to see what actually happened without typing a
          chat question. Routine checks (bare "NO", mostly from the noisy
          Game Room automation) are filtered server-side, same rule as the
          chat tool's own context formatting — only notable events render. */}
      <Modal visible={visionEventsVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Vision Events (24h)</Text>
            {!visionEventsData ? (
              <Text style={styles.modalLabel}>Loading...</Text>
            ) : (
              <>
                {visionEventsData.routineCount > 0 && (
                  <Text style={[styles.modalLabel, { marginBottom: 12 }]}>
                    Plus {visionEventsData.routineCount} routine check{visionEventsData.routineCount !== 1 ? 's' : ''} that found nothing worth reporting.
                  </Text>
                )}
                <ScrollView style={{ maxHeight: 420 }}>
                  {visionEventsData.notable.length === 0 ? (
                    <Text style={styles.modalLabel}>No notable camera activity in the last 24h.</Text>
                  ) : (
                    visionEventsData.notable.map((e, i) => (
                      <View key={`${e.start}-${i}`} style={styles.visionEventRow}>
                        <Text style={styles.visionEventTime}>{formatRelativeTime(e.start)} · {new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                        <Text style={styles.visionEventDescription}>{e.description}</Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              </>
            )}
            <TouchableOpacity
              style={styles.dashboardCloseButton}
              onPress={() => { setVisionEventsVisible(false); setVisionEventsData(null); }}
            >
              <Text style={styles.dashboardCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Room Observer Snapshot Lightbox Modal */}
      <Modal visible={!!snapshotModalData} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { padding: 14, backgroundColor: '#0f172a', borderColor: 'rgba(0, 242, 254, 0.4)', borderWidth: 1 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <View>
                <Text style={[styles.modalTitle, { color: '#00f2fe', fontSize: 16, marginBottom: 2 }]}>📸 Logitech C930e Snapshot</Text>
                <Text style={{ color: '#64748b', fontSize: 11 }}>
                  {snapshotModalData?.obs?.badge || 'Observation'} • {snapshotModalData?.obs?.timestamp ? formatRelativeTime(snapshotModalData.obs.timestamp) : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSnapshotModalData(null)}>
                <X size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            {snapshotModalData?.url ? (
              <View style={{ borderRadius: 10, overflow: 'hidden', backgroundColor: '#000', marginBottom: 10, height: 260, justifyContent: 'center', alignItems: 'center' }}>
                <Image
                  source={{ uri: snapshotModalData.url }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            <Text style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 18, backgroundColor: 'rgba(255, 255, 255, 0.04)', padding: 10, borderRadius: 8 }}>
              "{snapshotModalData?.obs?.text || ''}"
            </Text>
          </View>
        </View>
      </Modal>

      {/* 🎬 Media Cast Hub Modal */}
      <MediaCastModal
        visible={mediaCastVisible}
        onClose={() => setMediaCastVisible(false)}
        apiRequest={apiRequest}
        onOpenMediaStack={() => setMediaStackVisible(true)}
      />

      {/* 📦 Media Stack Hub (*Arr Stack & Downloads) */}
      <MediaStackModal
        visible={mediaStackVisible}
        onClose={() => setMediaStackVisible(false)}
        serverUrl={serverUrl}
        apiRequest={apiRequest}
      />
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

// Mirrors the desktop app's markdown look (src/services/markdown.js's
// dark/cyan theme) so mobile renders **bold**, headers, bullets, and code
// blocks instead of showing the raw markdown characters as plain text.
const markdownStyles = StyleSheet.create({
  body: { color: '#f1f5f9', fontSize: 15 },
  heading1: { color: '#f1f5f9', fontSize: 20, fontWeight: '800', marginTop: 6, marginBottom: 4 },
  heading2: { color: '#f1f5f9', fontSize: 18, fontWeight: '800', marginTop: 6, marginBottom: 4 },
  heading3: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  strong: { fontWeight: '700', color: '#f8fafc' },
  em: { fontStyle: 'italic' },
  paragraph: { marginTop: 0, marginBottom: 6 },
  bullet_list: { marginBottom: 4 },
  ordered_list: { marginBottom: 4 },
  list_item: { flexDirection: 'row', marginBottom: 2 },
  code_inline: {
    backgroundColor: '#0c111c', color: '#00f2fe', paddingHorizontal: 4,
    borderRadius: 4, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace'
  },
  fence: {
    backgroundColor: '#0c111c', color: '#e2e8f0', padding: 10, borderRadius: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 13
  },
  code_block: {
    backgroundColor: '#0c111c', color: '#e2e8f0', padding: 10, borderRadius: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 13
  },
  blockquote: {
    borderLeftWidth: 3, borderLeftColor: '#00f2fe', paddingLeft: 8,
    backgroundColor: 'rgba(0,242,254,0.05)', opacity: 0.9
  },
  hr: { backgroundColor: '#1e2638', height: 1, marginVertical: 8 },
  link: { color: '#00f2fe' }
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#10141f' },
  flexFill: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e2638' },
  title: { color: '#00f2fe', fontSize: 20, fontWeight: '800' },
  iconButton: { padding: 10, borderRadius: 10 },
  iconBadgeDot: {
    position: 'absolute', top: 8, right: 8, width: 8, height: 8,
    borderRadius: 4, backgroundColor: '#00f2fe', borderWidth: 1, borderColor: '#10141f'
  },
  messageList: { padding: 16, gap: 8 },
  bubble: { padding: 12, borderRadius: 12, marginBottom: 8, maxWidth: '85%' },
  userBubble: { backgroundColor: '#1e2638', alignSelf: 'flex-end' },
  assistantBubble: { backgroundColor: 'rgba(0,242,254,0.1)', alignSelf: 'flex-start' },
  editInput: {
    minHeight: 60,
    color: '#f8fafc',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,242,254,0.4)',
    textAlignVertical: 'top',
  },
  editCancelBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  editCancelText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  editSaveBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: '#00f2fe' },
  editSaveText: { color: '#07090e', fontSize: 12, fontWeight: '700' },
  msgActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10, paddingHorizontal: 2 },
  msgActionText: { fontSize: 11, fontWeight: '600' },
  bubbleText: { color: '#f1f5f9', fontSize: 15 },
  messageImage: { width: '100%', height: 180, borderRadius: 8, marginBottom: 8 },
  attachedImageRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  attachedImageThumb: { width: 56, height: 56, borderRadius: 8 },
  attachedImageRemove: { position: 'absolute', top: 2, left: 44, backgroundColor: '#0f172acc', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: '#1e2638', backgroundColor: '#10141f' },
  input: { flex: 1, backgroundColor: '#171d2c', color: '#f1f5f9', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  micButton: { width: 42, height: 42, backgroundColor: '#171d2c', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  sendButton: { backgroundColor: '#00f2fe', borderRadius: 10, paddingHorizontal: 18, height: 42, justifyContent: 'center' },
  sendButtonText: { color: '#07090e', fontWeight: '700' },
  stopButton: { backgroundColor: '#2a1616', borderWidth: 1, borderColor: 'rgba(248,113,113,0.5)', paddingHorizontal: 14, alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#171d2c', borderRadius: 16, padding: 20 },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  modalLabel: { color: '#cbd5e1', fontSize: 14, marginBottom: 6 },
  autoSpeakRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalButtonRow: { flexDirection: 'row', gap: 10 },
  confirmButton: { backgroundColor: '#00f2fe', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', flex: 1 },
  denyButton: { backgroundColor: '#ef4444', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', flex: 1 },
  modalButtonText: { color: '#07090e', fontWeight: '700' },
  settingsInput: { backgroundColor: '#0c111c', color: '#f1f5f9', borderRadius: 8, padding: 10, marginBottom: 14 },
  threadRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e2638' },
  threadTitle: { color: '#cbd5e1', fontSize: 15 },
  threadTitleActive: { color: '#00f2fe', fontWeight: '700' },
  reasoningContainer: {
    alignSelf: 'flex-start', maxWidth: '85%', marginBottom: 6,
    backgroundColor: 'rgba(192,132,252,0.08)', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.25)'
  },
  reasoningToggleText: { color: '#c084fc', fontSize: 13, fontWeight: '700' },
  reasoningText: { color: '#94a3b8', fontSize: 13, marginTop: 8, lineHeight: 18 },
  drawerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50
  },
  drawerPanel: {
    width: DRAWER_WIDTH, height: '100%', backgroundColor: '#131825',
    padding: 16, paddingTop: Platform.OS === 'ios' ? 50 : 36,
    borderRightWidth: 1, borderRightColor: 'rgba(255, 255, 255, 0.08)'
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)'
  },
  drawerLogoBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.4)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  drawerBrandTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '800' },
  drawerBrandSub: { color: '#64748b', fontSize: 10, fontWeight: '600' },
  drawerOnlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)'
  },
  drawerOnlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  drawerOnlineText: { color: '#4ade80', fontSize: 10, fontWeight: '700' },
  drawerNavGroup: { marginBottom: 10, gap: 5 },
  drawerPrimaryNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  drawerPrimaryNavBtnActive: {
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
    borderColor: 'rgba(0, 242, 254, 0.4)'
  },
  drawerPrimaryNavText: { color: '#94a3b8', fontSize: 13, fontWeight: '700' },
  drawerPrimaryNavTextActive: { color: '#00f2fe', fontWeight: '800' },
  drawerNewChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#00f2fe',
    marginTop: 2
  },
  drawerNewChatText: { color: '#07090e', fontSize: 12.5, fontWeight: '800' },
  drawerSectionHeader: { marginTop: 10, marginBottom: 5, paddingHorizontal: 2 },
  drawerSectionTitle: { color: '#64748b', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  drawerWorkspaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 3
  },
  drawerWorkspaceRowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },
  drawerWorkspaceLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  drawerWorkspaceSub: { color: '#64748b', fontSize: 10, marginTop: 1 },
  drawerSubagentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 7,
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 5
  },
  drawerSubagentIconBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center'
  },
  drawerSubagentName: { color: '#f8fafc', fontSize: 12, fontWeight: '700' },
  drawerSubagentSub: { color: '#94a3b8', fontSize: 10, marginTop: 1 },
  drawerTagBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  drawerTagText: { fontSize: 8.5, fontWeight: '800' },
  drawerFooter: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 6
  },
  drawerSettingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)'
  },
  drawerSettingsText: { color: '#94a3b8', fontSize: 11.5, fontWeight: '600' },
  projectWidget: {
    backgroundColor: 'rgba(0,242,254,0.08)', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: 'rgba(0,242,254,0.2)', marginBottom: 8
  },
  projectWidgetHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectName: { color: '#f1f5f9', fontSize: 13, fontWeight: '700', flex: 1 },
  projectPct: { color: '#00f2fe', fontSize: 12, fontWeight: '700' },
  projectStatusText: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  projectProgressTrack: { height: 4, borderRadius: 2, backgroundColor: '#0c111c', marginTop: 6, overflow: 'hidden' },
  projectProgressFill: { height: 4, borderRadius: 2, backgroundColor: '#00f2fe' },
  projectLastCompleted: { color: '#64748b', fontSize: 11, marginTop: 6 },
  agendaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 6, marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)'
  },
  agendaSummary: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  agendaCalendar: { color: '#64748b', fontSize: 10.5, marginTop: 1 },
  agendaTime: { color: '#38bdf8', fontSize: 11, fontWeight: '600', marginLeft: 8 },
  smartHomeSummaryText: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
  smartHomeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e2638'
  },
  smartHomeName: { color: '#cbd5e1', fontSize: 13, flex: 1 },
  climateStepButton: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#0c111c', alignItems: 'center', justifyContent: 'center' },
  climateStepText: { color: '#fb923c', fontSize: 16, fontWeight: '700' },
  climateTargetText: { color: '#f1f5f9', fontSize: 13, fontWeight: '700', marginHorizontal: 6, minWidth: 28, textAlign: 'center' },
  reminderDone: { textDecorationLine: 'line-through', color: '#64748b' },
  settingsInputMultiline: { height: 70, textAlignVertical: 'top' },
  dashboardTabScroll: { flexGrow: 0, marginBottom: 14, marginTop: 14, paddingHorizontal: 16 },
  dashboardPageContent: { paddingHorizontal: 16 },
  dashboardTabButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#0c111c', marginRight: 6 },
  dashboardTabButtonActive: { backgroundColor: 'rgba(0,242,254,0.15)' },
  dashboardTabText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  dashboardTabTextActive: { color: '#00f2fe' },
  dashboardCloseButton: { marginTop: 14, alignSelf: 'center' },
  dashboardCloseText: { color: '#64748b', fontSize: 13 },
  skillsOverallRow: { alignItems: 'center', marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1e2638' },
  skillsOverallScore: { color: '#00f2fe', fontSize: 32, fontWeight: '800' },
  skillsCategoryRow: { marginBottom: 14 },
  skillsCategoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  skillsCategoryScore: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
  skillsBarTrack: { flexDirection: 'row', height: 8, borderRadius: 4, backgroundColor: '#0c111c', overflow: 'hidden' },
  skillsBarConfirmed: { backgroundColor: '#4ade80' },
  skillsBarGap: { backgroundColor: '#f87171' },
  skillsCategoryMeta: { color: '#64748b', fontSize: 11, marginTop: 4 },
  visionEventRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e2638' },
  visionEventTime: { color: '#38bdf8', fontSize: 11, fontWeight: '700', marginBottom: 3 },
  visionEventDescription: { color: '#e2e8f0', fontSize: 14, lineHeight: 19 },
  hephSmallBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.04)' },
  hephEmptyCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  hephTaskCard: { backgroundColor: 'rgba(15, 23, 42, 0.9)', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.25)' },
  hephTaskTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '700' },
  hephTaskBranch: { color: '#64748b', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
  hephTaskDesc: { color: '#cbd5e1', fontSize: 12.5, lineHeight: 17, marginTop: 6 },
  hephStatusPill: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4 },
  hephStatusDeployed: { backgroundColor: 'rgba(34, 197, 94, 0.15)' },
  hephStatusReview: { backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  hephStatusQueued: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  hephStatusText: { fontSize: 9.5, fontWeight: '800' },
  hephReviewCard: { backgroundColor: 'rgba(168, 85, 247, 0.08)', borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.25)' },
  hephReviewProvider: { color: '#c084fc', fontSize: 11.5, fontWeight: '700' },
  hephScoreBadge: { backgroundColor: 'rgba(168, 85, 247, 0.2)', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.4)' },
  hephReviewScore: { color: '#c084fc', fontSize: 11, fontWeight: '800' },
  hephReviewSummary: { color: '#e2e8f0', fontSize: 12, marginTop: 2 },
  hephReviewCritique: { color: '#94a3b8', fontSize: 11.5, fontStyle: 'italic', marginTop: 3 },
  hephDiffToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  hephDiffToggleText: { color: '#00f2fe', fontSize: 11.5, fontWeight: '700' },
  hephDiffContainer: { backgroundColor: '#07090e', borderRadius: 8, padding: 8, marginTop: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  hephDiffBox: { backgroundColor: '#07090e', borderRadius: 8, padding: 8, marginTop: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', maxHeight: 240 },
  hephDiffFileHeader: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  hephDiffLine: { fontSize: 10.5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 14 },
  hephDiffAdd: { color: '#4ade80', backgroundColor: 'rgba(34, 197, 94, 0.1)' },
  hephDiffDel: { color: '#f87171', backgroundColor: 'rgba(239, 68, 68, 0.1)' },
  hephDiffContext: { color: '#64748b' },
  hephDiffNormal: { color: '#64748b' },
  hephActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'flex-end' },
  hephActionFooter: { flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'flex-end' },
  hephPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  hephActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  modalInput: { backgroundColor: '#0c111c', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 8, color: '#f8fafc', paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  hephTabBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(255, 255, 255, 0.04)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.08)' },
  hephTabBtnText: { color: '#94a3b8', fontSize: 11.5, fontWeight: '700' },
  hephCatChip: { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center', backgroundColor: '#0c111c', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  hephCatChipActive: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: '#f59e0b' },
  hephCatText: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  hephCatTextActive: { color: '#f59e0b' },
  drawerCauldronWidget: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)', marginTop: 16, marginBottom: 8 },
  hephSubTab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(255, 255, 255, 0.04)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.08)' },
  hephSubTabActive: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: '#f59e0b' },
  hephSubTabText: { color: '#94a3b8', fontSize: 11.5, fontWeight: '700' },
  hephSubTabTextActive: { color: '#f59e0b' },
  hephRefTag: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, backgroundColor: 'rgba(34, 197, 94, 0.12)', borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.3)' },
  hephRefText: { color: '#4ade80', fontSize: 9.5, fontWeight: '800' },
  // Command Center Hub Styles
  hubSectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 4 },
  hubSectionTitle: { color: '#f1f5f9', fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2 },
  hubSectionLink: { color: '#00f2fe', fontSize: 12, fontWeight: '700' },
  activeTickerScroll: { flexGrow: 0, marginBottom: 12 },
  activeTickerPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, gap: 6 },
  activeTickerPillAmber: { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.4)' },
  activeTickerTextAmber: { color: '#fbbf24', fontSize: 11.5, fontWeight: '700' },
  activeTickerPillBlue: { backgroundColor: 'rgba(56, 189, 248, 0.12)', borderColor: 'rgba(56, 189, 248, 0.4)' },
  activeTickerTextBlue: { color: '#38bdf8', fontSize: 11.5, fontWeight: '700' },
  activeTickerPillCyan: { backgroundColor: 'rgba(0, 242, 254, 0.12)', borderColor: 'rgba(0, 242, 254, 0.4)' },
  activeTickerTextCyan: { color: '#00f2fe', fontSize: 11.5, fontWeight: '700' },
  activeTickerPillNominal: { backgroundColor: 'rgba(52, 211, 153, 0.08)', borderColor: 'rgba(52, 211, 153, 0.3)' },
  activeTickerTextNominal: { color: '#34d399', fontSize: 11.5, fontWeight: '700' },
  bentoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  bentoTile: { width: '48.7%', backgroundColor: 'rgba(15, 23, 42, 0.85)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.07)' },
  bentoIconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  bentoTileHeader: { color: '#94a3b8', fontSize: 11.5, fontWeight: '700' },
  bentoTileValue: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  bentoTileSub: { color: '#64748b', fontSize: 10.5, marginTop: 2 },
  climateStepButtonSmall: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#0c111c', alignItems: 'center', justifyContent: 'center' },
  climateStepTextSmall: { color: '#fb923c', fontSize: 14, fontWeight: '800' },
  agendaCard: { backgroundColor: 'rgba(15, 23, 42, 0.85)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.07)' },
  studioPortalCardAmber: { backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)' },
  studioPortalCardBlue: { backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)' },
  studioPortalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  studioPortalTitleAmber: { color: '#f59e0b', fontSize: 15, fontWeight: '800' },
  studioPortalTitleBlue: { color: '#38bdf8', fontSize: 15, fontWeight: '800' },
  studioPortalSub: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  studioAlertBadgeAmber: { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderRadius: 8, padding: 8, marginVertical: 8, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)' },
  studioAlertBadgeBlue: { backgroundColor: 'rgba(56, 189, 248, 0.12)', borderRadius: 8, padding: 8, marginVertical: 8, borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)' },
  studioActionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  studioPrimaryBtnAmber: { flex: 1, backgroundColor: 'rgba(245, 158, 11, 0.18)', borderWidth: 1, borderColor: '#f59e0b', borderRadius: 8, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  studioPrimaryBtnTextAmber: { color: '#f59e0b', fontSize: 12, fontWeight: '700' },
  studioSecondaryBtnAmber: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.04)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.4)', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  studioPrimaryBtnBlue: { flex: 1, backgroundColor: 'rgba(56, 189, 248, 0.18)', borderWidth: 1, borderColor: '#38bdf8', borderRadius: 8, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  studioPrimaryBtnTextBlue: { color: '#38bdf8', fontSize: 12, fontWeight: '700' },
  studioSecondaryBtnBlue: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.04)', borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.4)', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: '#0a0d14',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'space-around',
    alignItems: 'center'
  },
  bottomTabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    minWidth: 54
  },
  bottomTabItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  },
  bottomTabText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2
  },
  bottomTabTextActive: {
    color: '#00f2fe',
    fontWeight: '800'
  }
});
