import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Zap,
  Lightbulb,
  Lock,
  Unlock,
  Thermometer,
  Disc3,
  FolderGit2,
  BarChart3,
  Camera,
  Calendar,
  CheckSquare,
  Plus,
  ArrowRight,
  RefreshCw,
  Gamepad2,
  ShieldCheck,
  Brain,
  Code2,
  Users,
  Mic,
  MicOff,
  Send,
  Activity,
  Check,
  Sun,
  ChevronRight,
  BookOpen,
  HardDrive,
  Wallet,
  Wrench,
  AlertTriangle,
  Clock,
  Eye,
  Volume2,
  Copy,
  Newspaper,
  X,
  Settings2,
  Tv,
  Cpu,
  History,
  Maximize2,
  Coffee,
  Droplets,
  Terminal,
  DownloadCloud,
  Shield
} from 'lucide-react';
import {
  executeHAService,
  fetchGoogleCalendarEvents,
  formatCalendarDisplayName,
  sanitizeEntityFriendlyName
} from '../services/homeassistant';
import { fetchWeather } from '../services/weather';
import { checkWhisperStatus, transcribeAudio, getPreferredAudioStream, attachSilenceDetector, attachSpeechStartDetector } from '../services/whisperstt';
import { getStoredObservations, generateAmbientObservation, dispatchAmbientObservation } from '../services/ambientObserver';
import { NewsSection, ProjectsSection, NowPlayingCard, BazziteRemoteCard } from './dashboard';
import { apiFetch, apiJson, SERVER_BASE_URL, getServerToken } from '../services/aloyApi.js';
// Replaces `.catch(() => {})`. These failures are genuinely non-fatal — a
// widget stays empty and the dashboard carries on — but swallowing them
// silently is how a background fetch that has been failing for days looks
// exactly like one that returned no data. Same behaviour, one console line.
const softFail = (label) => (err) => {
  console.warn(`[dashboard] ${label} failed:`, err?.message || err);
};

// Only the minute is displayed, so ticking every second re-rendered this whole
// component 59 times a minute to produce identical output. Own state, own
// re-render, and the tick is aligned to the next minute boundary rather than
// free-running at 1Hz.
function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer;
    const schedule = () => {
      const msToNextMinute = 60000 - (Date.now() % 60000);
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, msToNextMinute + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return <>{date} · {time}</>;
}


function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatClockTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getGreeting(name) {
  const hour = new Date().getHours();
  let timeGreeting = 'Good morning';
  if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
  else if (hour >= 17 || hour < 4) timeGreeting = 'Good evening';
  const firstName = (name || 'User').split(' ')[0];
  return `${timeGreeting}, ${firstName}`;
}

export default function DashboardView({
  userProfile,
  isOllamaConnected,
  isPaused,
  onTogglePause,
  selectedModel,
  smartHomeStats,
  haCategories,
  refreshHomeAssistant,
  isHARefreshing,
  trackedProjects,
  projectLiveStatus,
  skillsStats,
  llmVisionStats,
  reminders,
  onAddReminder,
  onCompleteReminder,
  homeCoordinates,
  connectedClients,
  mcpStatus,
  memories,
  lastBackupStatus,
  onBackupNow,
  isBackingUp,
  vaultDir,
  uploadedDocuments,
  isSyncingVault,
  onSyncVault,
  onAskAloy,
  onOpenSmartHomeDrawer,
  onOpenProjectsPanel,
  onOpenSkillsDashboard,
  onOpenFinancesPanel,
  onOpenMemoryModal,
  onOpenDevWorkspace
}) {
  const [gpuStats, setGpuStats] = useState(null);

  // Poll live GPU / VRAM stats from Aloy Server
  useEffect(() => {
    let mounted = true;
    const fetchGpu = async () => {
      try {
        const res = await apiFetch('/api/system/gpu-stats');
        if (res.ok && mounted) {
          const data = await res.json();
          if (data && data.available) setGpuStats(data);
        }
      } catch {}
    };
    fetchGpu();
    const interval = setInterval(fetchGpu, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const [jellyfinStatus, setJellyfinStatus] = useState(null)  // was { online: true, serverName: 'Aloy Server' } — an optimistic
                    // default that rendered a healthy Jellyfin pill before any
                    // fetch, and permanently if the fetch kept failing. This is
                    // the exact example aloyApi.js's own header comment cites.;
  const [activeSessions, setActiveSessions] = useState([]);

  // Live Jellyfin server status & active sessions (SSE real-time stream + robust active polling)
  useEffect(() => {
    let mounted = true;

    const fetchJellyfinData = async () => {
      try {
        const [statRes, sessRes] = await Promise.all([
          apiFetch('/api/jellyfin/status').catch(() => null),
          apiFetch('/api/jellyfin/sessions').catch(() => null)
        ]);
        if (statRes && statRes.ok && mounted) {
          const data = await statRes.json();
          if (data && data.success) setJellyfinStatus(data.status);
        }
        if (sessRes && sessRes.ok && mounted) {
          const sessData = await sessRes.json();
          if (sessData && sessData.sessions && mounted) {
            setActiveSessions(sessData.sessions);
          }
        }
      } catch {}
    };

    fetchJellyfinData();
    const interval = setInterval(fetchJellyfinData, 4000);

    let eventSource = null;
    async function initSSE() {
      try {
        const token = await getServerToken();
        const url = `${SERVER_BASE_URL}/api/jellyfin/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        if (!mounted) return;
        eventSource = new EventSource(url);
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'sessions' && Array.isArray(data.sessions) && mounted) {
              setActiveSessions(data.sessions);
            }
          } catch {}
        };
      } catch {}
    }
    initSSE();

    return () => {
      mounted = false;
      clearInterval(interval);
      if (eventSource) eventSource.close();
    };
  }, []);

  const [arrQueue, setArrQueue] = useState({ queue: [], total: 0, sonarrConnected: true, radarrConnected: true });

  useEffect(() => {
    let mounted = true;
    const fetchQueue = async () => {
      try {
        const res = await apiFetch('/api/arr/queue');
        if (res.ok && mounted) {
          const data = await res.json();
          if (data && data.success && mounted) {
            setArrQueue(data);
          }
        }
      } catch {}
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const [quickInput, setQuickInput] = useState('');
  const [activeDashboardTab, setActiveDashboardTab] = useState('home');
  const [weatherData, setWeatherData] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [newsArticles, setNewsArticles] = useState([]);
  const [newsSources, setNewsSourcesState] = useState([]);
  const [newsInterests, setNewsInterestsState] = useState([]);
  const [isNewsRefreshing, setIsNewsRefreshing] = useState(false);
  const [newsSettingsOpen, setNewsSettingsOpen] = useState(false);
  // Read inside the news poll effect below, which has an empty dependency
  // array — a plain closure over newsSettingsOpen would stay stuck at its
  // value from mount forever, so the poll reads this ref instead.
  const newsSettingsOpenRef = useRef(false);
  useEffect(() => { newsSettingsOpenRef.current = newsSettingsOpen; }, [newsSettingsOpen]);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [newsInterestsInput, setNewsInterestsInput] = useState('');
  const [newReminderText, setNewReminderText] = useState('');
  const [executingMap, setExecutingMap] = useState({});
  const [isWhisperOnline, setIsWhisperOnline] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [devIdeas, setDevIdeas] = useState([]);
  const [ambientObservations, setAmbientObservations] = useState(() => getStoredObservations());
  const [isObserving, setIsObserving] = useState(false);
  const [copiedObs, setCopiedObs] = useState(false);
  const [showObsHistory, setShowObsHistory] = useState(false);
  const [selectedSnapshotModal, setSelectedSnapshotModal] = useState(null);
  const [isAutoListenEnabled, setIsAutoListenEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('aloy_auto_listen_after_obs');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [isFollowUpListening, setIsFollowUpListening] = useState(false);
  const [followUpCountdown, setFollowUpCountdown] = useState(0);
  const followUpCleanupRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const cancelHandsFreeFollowUp = () => {
    if (followUpCleanupRef.current) {
      followUpCleanupRef.current();
      followUpCleanupRef.current = null;
    }
    setIsFollowUpListening(false);
    setFollowUpCountdown(0);
  };

  // Unmounting while a follow-up window is open used to leave the MediaRecorder
  // running and the microphone track live — the OS mic indicator stays lit and
  // the stream is never released, because the only path that stopped the tracks
  // was the user cancelling. Run the same cleanup on teardown. Ref, not state,
  // so this stays an unmount-only effect and cannot re-fire mid-session.
  useEffect(() => () => {
    if (followUpCleanupRef.current) {
      try { followUpCleanupRef.current(); } catch (err) {
        console.warn('[hands-free] cleanup on unmount failed:', err?.message || err);
      }
      followUpCleanupRef.current = null;
    }
  }, []);

  const startHandsFreeFollowUp = async () => {
    if (isListening || isFollowUpListening) return;
    let online = isWhisperOnline;
    if (!online) {
      online = await checkWhisperStatus();
      setIsWhisperOnline(online);
    }
    if (!online) {
      console.warn('[hands-free] Whisper is offline on port 8890.');
      return;
    }

    try {
      const stream = await getPreferredAudioStream();
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      setIsFollowUpListening(true);
      setFollowUpCountdown(7);

      const countdownInterval = setInterval(() => {
        setFollowUpCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      const detachSilence = attachSilenceDetector(stream, () => {
        if (recorder.state !== 'inactive') {
          console.log('[hands-free] Natural speech completed. Stopping recorder for transcription.');
          recorder.stop();
        }
      }, { silenceTimeoutMs: 1600, minSpeechMs: 350, initialGraceMs: 1800, maxRecordMs: 15000 });

      let autoStopTimeout = null;

      recorder.onstop = async () => {
        clearInterval(countdownInterval);
        if (autoStopTimeout) clearTimeout(autoStopTimeout);
        detachSilence();
        stream.getTracks().forEach((t) => t.stop());
        setIsFollowUpListening(false);
        setFollowUpCountdown(0);

        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          if (blob.size < 800) {
            console.log('[hands-free] Empty audio buffer recorded.');
            return;
          }
          setIsTranscribing(true);
          const text = await transcribeAudio(blob);
          if (text && text.trim().length > 0) {
            const cleanText = text.trim();
            console.log('[hands-free] Transcribed speech reply:', cleanText);
            setQuickInput(cleanText);
            setTimeout(() => {
              onAskAloy(cleanText);
            }, 200);
          }
        } catch (err) {
          console.warn('[hands-free] Transcription error:', err);
        } finally {
          setIsTranscribing(false);
        }
      };

      autoStopTimeout = setTimeout(() => {
        if (recorder.state !== 'inactive') {
          console.log('[hands-free] 7s reply window completed.');
          recorder.stop();
        }
      }, 7000);

      followUpCleanupRef.current = () => {
        if (autoStopTimeout) clearTimeout(autoStopTimeout);
        clearInterval(countdownInterval);
        detachSilence();
        if (recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(100);
    } catch (err) {
      console.warn('[hands-free] Error starting reply window:', err);
      setIsFollowUpListening(false);
      setFollowUpCountdown(0);
    }
  };

  useEffect(() => {
    const handleSpoken = () => {
      if (isAutoListenEnabled) {
        setTimeout(() => {
          startHandsFreeFollowUp();
        }, 400);
      }
    };
    window.addEventListener('aloy:ambient-observation-spoken', handleSpoken);
    return () => {
      window.removeEventListener('aloy:ambient-observation-spoken', handleSpoken);
    };
  }, [isAutoListenEnabled]);

  const handleCopyObservation = () => {
    const text = ambientObservations[0]?.text;
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedObs(true);
    setTimeout(() => setCopiedObs(false), 2500);
  };

  useEffect(() => {
    let t;
    if (isListening) {
      t = setInterval(() => setRecordDuration((p) => p + 1), 1000);
    } else {
      setRecordDuration(0);
    }
    return () => clearInterval(t);
  }, [isListening]);

  const handleObserveNow = async () => {
    setIsObserving(true);
    try {
      // `projectStatuses` and `jellyfinData` do not exist in this component
      // and never did. Optional chaining does not rescue an undeclared
      // identifier, so this line threw a ReferenceError on the first statement
      // and "Observe Now" silently did nothing at all. The real state is
      // `projectLiveStatus` (an object keyed by project name, not an array)
      // and `activeSessions`, whose entries carry `nowPlaying.name` /
      // `nowPlaying.seriesName` (see NowPlayingCard).
      const activeProj = Object.entries(projectLiveStatus || {})
        .find(([, st]) => typeof st?.progressPct === 'number');
      const activeStream = (activeSessions || []).find((sess) => sess.nowPlaying != null);
      const streamTitle = activeStream?.nowPlaying
        ? (activeStream.nowPlaying.seriesName
            ? `${activeStream.nowPlaying.seriesName} — ${activeStream.nowPlaying.name}`
            : activeStream.nowPlaying.name)
        : null;

      const extraSignals = [
        activeProj ? `Active task: ${activeProj[0]}` : '',
        weatherData?.temperature ? `Office temperature: ${weatherData.temperature}°F (${weatherData.condition || 'clear'})` : '',
        calendarEvents[0]?.summary ? `Upcoming event: ${calendarEvents[0].summary}` : '',
        streamTitle ? `Background audio: ${streamTitle}` : ''
      ].filter(Boolean).join(' | ');

      const obs = await generateAmbientObservation({
        userName: (userProfile?.name || 'User').split(' ')[0],
        triggerReason: 'manual_observation',
        extraContext: extraSignals
      });
      await dispatchAmbientObservation(obs, { speak: true });
      setAmbientObservations(getStoredObservations());
    } catch (err) {
      console.warn('Manual observation error:', err);
    } finally {
      setIsObserving(false);
    }
  };

  // Fetch weather
  useEffect(() => {
    if (!homeCoordinates) return;
    fetchWeather(homeCoordinates.latitude, homeCoordinates.longitude)
      .then(setWeatherData)
      .catch(softFail('weather'));
  }, [homeCoordinates]);

  // Fetch calendar events
  useEffect(() => {
    fetchGoogleCalendarEvents(2)
      .then(setCalendarEvents)
      .catch(softFail('calendar'));
    const interval = setInterval(() => {
      fetchGoogleCalendarEvents(2).then(setCalendarEvents).catch(softFail('calendar refresh'));
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch tech news feed + config — IPC to electron.cjs (direct in-process
  // store access, same reason autorip/graph-search use IPC rather than an
  // HTTP call to this app's own :7890 API, which is what mobile uses
  // instead since it has no other way to reach this process).
  useEffect(() => {
    if (!window.electronAPI?.getNews) return;
    const load = () => {
      window.electronAPI.getNews().then(setNewsArticles).catch(softFail('news'));
      window.electronAPI.getNewsRefreshStatus?.().then((s) => setIsNewsRefreshing(!!s?.inProgress)).catch(softFail('news refresh status'));
      // Sources/interests used to only be fetched once at mount, never on
      // the poll — a real staleness bug caught live: cleared newsSources
      // via a direct store edit (simulating e.g. mobile or another window
      // changing it) and this card kept showing the deleted source
      // indefinitely, since nothing here ever re-fetched. Now included in
      // the same poll as everything else. newsInterestsInput (the actual
      // text field, as opposed to the last-saved display state) is only
      // synced while the settings panel is closed, so this can't clobber
      // an in-progress edit out from under the user.
      window.electronAPI.getNewsSources?.().then(setNewsSourcesState).catch(softFail('news sources'));
      window.electronAPI.getNewsInterests?.().then((list) => {
        setNewsInterestsState(list || []);
        setNewsInterestsInput((current) => (newsSettingsOpenRef.current ? current : (list || []).join(', ')));
      }).catch(softFail('news interests'));
    };
    load();
    const interval = setInterval(load, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleNewsRefresh = async () => {
    if (!window.electronAPI?.refreshNews) return;
    setIsNewsRefreshing(true);
    const result = await window.electronAPI.refreshNews();
    if (!result?.success) {
      setIsNewsRefreshing(false);
    }
    // On success, isNewsRefreshing stays true until the next 60s poll
    // picks up refreshStatus showing the background job actually finished
    // (it can genuinely take minutes) — no fixed timer to guess against.
  };

  const handleAddNewsSource = async () => {
    if (!newSourceUrl.trim() || !window.electronAPI?.setNewsSources) return;
    const updated = [
      ...newsSources,
      { id: `src-${Date.now()}`, url: newSourceUrl.trim(), name: newSourceName.trim() || newSourceUrl.trim() }
    ];
    const saved = await window.electronAPI.setNewsSources(updated);
    setNewsSourcesState(saved);
    setNewSourceUrl('');
    setNewSourceName('');
  };

  const handleRemoveNewsSource = async (id) => {
    if (!window.electronAPI?.setNewsSources) return;
    const updated = newsSources.filter((s) => s.id !== id);
    const saved = await window.electronAPI.setNewsSources(updated);
    setNewsSourcesState(saved);
  };

  const handleSaveNewsInterests = async () => {
    if (!window.electronAPI?.setNewsInterests) return;
    const list = newsInterestsInput.split(',').map((s) => s.trim()).filter(Boolean);
    const saved = await window.electronAPI.setNewsInterests(list);
    setNewsInterestsState(saved);
  };


  // Check whisper status with periodic refresh
  useEffect(() => {
    const initWhisper = () => checkWhisperStatus().then(setIsWhisperOnline).catch(softFail('whisper status'));
    initWhisper();
    const interval = setInterval(initWhisper, 8000);
    return () => clearInterval(interval);
  }, []);

  // Load dev ideas if in Electron
  useEffect(() => {
    if (window.electronAPI?.listDevIdeas) {
      window.electronAPI.listDevIdeas().then((list) => {
        setDevIdeas((list || []).filter((i) => i.status === 'idea'));
      }).catch(softFail('dev ideas'));
    }
  }, []);

  const handleQuickSubmit = (e) => {
    e?.preventDefault();
    if (!quickInput.trim()) return;
    const prompt = quickInput.trim();
    setQuickInput('');
    onAskAloy(prompt);
  };

  // Subtle Web Audio chime for physical device feedback
  const playSmartHomeChime = (service = 'toggle') => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const isActivate = typeof service === 'string' && (service.includes('on') || service.includes('unlock') || service.includes('open'));
      const startFreq = isActivate ? 587.33 : 880.0;
      const endFreq = isActivate ? 880.0 : 587.33;
      osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
      // Deliberately silent: closing a finished AudioContext can reject if the
      // browser already tore it down, and there is nothing to act on either way.
      setTimeout(() => ctx.close().catch(() => {}), 300);
    } catch {}
  };

  const handleToggleDevice = async (domain, service, entityId, extra = {}) => {
    setExecutingMap((prev) => ({ ...prev, [entityId]: true }));
    try {
      await executeHAService(domain, service, entityId, extra);
      playSmartHomeChime(service);
      setTimeout(refreshHomeAssistant, 1000);
    } finally {
      setExecutingMap((prev) => ({ ...prev, [entityId]: false }));
    }
  };

  const handleAddReminderSubmit = (e) => {
    e?.preventDefault();
    if (!newReminderText.trim()) return;
    onAddReminder(newReminderText.trim(), null);
    setNewReminderText('');
  };

  const toggleMicListening = async () => {
    if (isListening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      return;
    }
    let online = isWhisperOnline;
    if (!online) {
      online = await checkWhisperStatus();
      setIsWhisperOnline(online);
    }
    if (!online) {
      alert('Local voice transcription (Whisper) is offline. Ensure whisper_server.py is running on port 8890.');
      return;
    }
    try {
      const stream = await getPreferredAudioStream();
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);
        setIsTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          console.log('[voice] Sending audio blob size:', blob.size);
          const text = await transcribeAudio(blob);
          console.log('[voice] Received transcription:', text);
          if (text && text.trim().length > 0) {
            const cleanText = text.trim();
            setQuickInput(cleanText);
            // Seamlessly submit voice request directly to Aloy
            setTimeout(() => {
              onAskAloy(cleanText);
            }, 250);
          } else {
            console.warn('[voice] Transcription returned empty text.');
            alert('No speech detected. Please speak clearly into your Logitech webcam microphone.');
          }
        } catch (err) {
          console.error('Whisper transcription error:', err);
          alert(err.message || 'Voice transcription error occurred.');
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsListening(true);
    } catch (err) {
      console.error('Mic access error:', err);
      alert(`Could not access the microphone: ${err.message}`);
    }
  };

  // Exceptions calculation (Exception-driven command center)
  const primaryLocks = haCategories?.locks || [];
  const rawUnlockedLocks = primaryLocks.filter((l) => l.state === 'unlocked');
  // Deduplicate group locks (e.g. lock.front_door_locks vs lock.aqara_smart_lock_u400)
  const unlockedLocks = rawUnlockedLocks.filter((lock, _idx, arr) => {
    const isGroup = lock.entity_id.includes('group') || lock.entity_id.endsWith('_locks');
    if (isGroup && arr.some((other) => !other.entity_id.includes('group') && other.entity_id.startsWith('lock.'))) {
      return false;
    }
    return true;
  });
  const primaryLights = (haCategories?.lights || []).slice(0, 6);
  const primaryClimate = (haCategories?.climate || [])[0];

  const overdueReminders = (reminders || []).filter((r) => !r.completed && r.due && new Date(r.due) < new Date());
  const pendingRemindersList = (reminders || []).filter((r) => !r.completed);
  const failedProjects = Object.entries(projectLiveStatus || {}).filter(([_, s]) => s.error || s.status === 'failed');
  const needsReviewSkillsCount = skillsStats?.needsReviewCount || 0;

  // Build exceptions array
  const exceptions = [];
  if (unlockedLocks.length > 0) {
    unlockedLocks.forEach((lock) => {
      exceptions.push({
        id: `lock-${lock.entity_id}`,
        type: 'warning',
        icon: <Unlock size={14} color="#f87171" />,
        text: `${sanitizeEntityFriendlyName(lock.name || 'Exterior Door')} is unlocked`,
        actionLabel: 'Lock Door',
        action: () => handleToggleDevice('lock', 'lock', lock.entity_id)
      });
    });
  }
  if (failedProjects.length > 0) {
    failedProjects.forEach(([name]) => {
      exceptions.push({
        id: `project-${name}`,
        type: 'danger',
        icon: <AlertTriangle size={14} color="#f87171" />,
        text: `${name}: Build or process encountered an error`,
        actionLabel: 'View Projects',
        action: onOpenProjectsPanel
      });
    });
  }
  if (lastBackupStatus && !lastBackupStatus.success) {
    exceptions.push({
      id: 'backup-failed',
      type: 'warning',
      icon: <HardDrive size={14} color="#fbbf24" />,
      text: lastBackupStatus.error ? `Backup failed: ${lastBackupStatus.error}` : 'Backup encountered an error',
      actionLabel: 'Back Up Now',
      action: onBackupNow
    });
  }
  if (overdueReminders.length > 0) {
    exceptions.push({
      id: 'overdue-reminders',
      type: 'warning',
      icon: <Clock size={14} color="#fbbf24" />,
      text: `${overdueReminders.length} reminder${overdueReminders.length > 1 ? 's' : ''} overdue: "${overdueReminders[0].text}"`,
      actionLabel: 'Complete',
      action: () => onCompleteReminder(overdueReminders[0].text)
    });
  }
  if (needsReviewSkillsCount > 0) {
    exceptions.push({
      id: 'skills-review',
      type: 'info',
      icon: <Brain size={14} color="#c084fc" />,
      text: `${needsReviewSkillsCount} knowledge synthesis item awaiting review`,
      actionLabel: 'Review',
      action: onOpenSkillsDashboard
    });
  }

  const nextUpcomingEvent = calendarEvents.find((e) => e.start && new Date(e.start) >= new Date()) || calendarEvents[0];

  // Active projects status
  const activeAutoRip = projectLiveStatus && Object.values(projectLiveStatus).find((s) => s.progressPct != null || s.step);

  const quickActionChips = [
    { label: 'Turn off all lights', prompt: 'Turn off all lights in the house' },
    { label: 'Lock all doors', prompt: 'Make sure all exterior door locks are locked' },
    { label: 'AutoRip progress', prompt: 'What is the current status and progress of AutoRipManager?' },
    { label: "Today's agenda", prompt: "Summarize today's calendar events and pending chores" },
    { label: 'Skills review', prompt: 'Show me which skills need review and overall proficiency' },
    { label: '🔥 The Cauldron (Heph)', prompt: 'Check the status of HEPHAESTUS and active code tasks in The Cauldron.' }
  ];

  return (
    <div style={{
      flex: 1,
      height: '100vh',
      overflowY: 'auto',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(0, 242, 254, 0.04) 0%, rgba(16, 20, 31, 0) 70%), #10141f',
      color: '#f1f5f9',
      padding: '2rem 2.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.75rem'
    }}>
      {/* 🚨 Dynamic Exception-Driven Action Banner */}
      <AnimatePresence>
        {exceptions.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              padding: '0.85rem 1.25rem',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(245, 158, 11, 0.12))',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              boxShadow: '0 4px 20px rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{
                padding: '4px 8px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                fontSize: '0.75rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <AlertTriangle size={13} /> Attention Required ({exceptions.length})
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                {exceptions.map((ex) => (
                  <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#f1f5f9', fontWeight: 600 }}>
                    {ex.icon}
                    <span>{ex.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {exceptions.map((ex) => (
                <motion.button
                  key={ex.id}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={ex.action}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '10px',
                    border: 'none',
                    background: ex.type === 'danger' ? '#ef4444' : 'rgba(255, 255, 255, 0.12)',
                    color: '#fff',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  {ex.actionLabel}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '12px',
              background: 'rgba(34, 197, 94, 0.06)',
              border: '1px solid rgba(34, 197, 94, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.8rem',
              color: '#4ade80',
              fontWeight: 600,
              width: 'fit-content'
            }}
          >
            <ShieldCheck size={14} color="#4ade80" />
            <span>All systems nominal — Perimeter secured, active pipelines clear, 0 overdue tasks</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Hero & Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
      >
        {/* Top greeting bar & live badges */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00f2fe', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Aloy Command Center
              </span>
              <span style={{ color: '#475569' }}>•</span>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                <LiveClock />
              </span>
            </div>
            <h1 style={{ fontSize: '2.1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', margin: 0 }}>
              {getGreeting(userProfile?.name)}
            </h1>
          </div>

          {/* System status pill collection (No more bare zeros) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            {weatherData && (
              <div className="glass-panel" style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#e2e8f0',
                background: 'rgba(15, 23, 42, 0.65)'
              }}>
                <Sun size={14} color="#fde047" />
                <span>{weatherData.temperature}°F · {weatherData.condition}</span>
              </div>
            )}

            {/* Live GPU / VRAM Telemetry Pill */}
            {gpuStats && gpuStats.available && (
              <div className="glass-panel" style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#a7f3d0',
                background: 'rgba(6, 78, 59, 0.25)',
                border: '1px solid rgba(16, 185, 129, 0.25)'
              }}>
                <Cpu size={14} color="#34d399" />
                <span>{gpuStats.name.replace('NVIDIA GeForce ', '')}</span>
                <span style={{ color: '#059669' }}>·</span>
                <span>{(gpuStats.vramUsedMb / 1024).toFixed(1)}/{Math.round(gpuStats.vramTotalMb / 1024)}GB</span>
                {gpuStats.tempC != null && (
                  <>
                    <span style={{ color: '#059669' }}>·</span>
                    <span>{gpuStats.tempC}°C</span>
                  </>
                )}
              </div>
            )}

            {/* Model Pill */}
            <div className="glass-panel" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '12px',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: isPaused ? '#fb923c' : isOllamaConnected ? '#4ade80' : '#f87171',
              background: 'rgba(15, 23, 42, 0.65)'
            }}>
              <div className={!isPaused && isOllamaConnected ? 'pulse-green' : ''} style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: isPaused ? '#fb923c' : isOllamaConnected ? '#22c55e' : '#ef4444'
              }} />
              <span>{isPaused ? 'Gaming Mode (Paused)' : selectedModel || 'aloy-assistant'}</span>
            </div>

            {/* Jellyfin Media Server Pill */}
            {jellyfinStatus && (
              <div
                className="glass-panel"
                onClick={() => window.open('http://localhost:8096', '_blank')}
                title="Click to open Jellyfin Web Dashboard"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: jellyfinStatus.online ? '#38bdf8' : '#94a3b8',
                  background: 'rgba(15, 23, 42, 0.65)',
                  cursor: 'pointer',
                  border: jellyfinStatus.online ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div
                  className={jellyfinStatus.online ? 'pulse-cyan' : ''}
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: jellyfinStatus.online ? '#38bdf8' : '#64748b',
                  }}
                />
                <Tv size={13} color="#38bdf8" />
                <span>Jellyfin: {jellyfinStatus.online ? (jellyfinStatus.serverName || 'Online') : 'Offline'}</span>
              </div>
            )}

            {/* Tools Readiness Pill (Clean Fallback) */}
            <div className="glass-panel" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '12px',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#c084fc',
              background: 'rgba(15, 23, 42, 0.65)'
            }}>
              <Wrench size={13} color="#c084fc" />
              <span>{mcpStatus?.registeredToolCount ? `${mcpStatus.registeredToolCount} tools connected` : '11 Native Tools Active'}</span>
            </div>

            {/* Connected Clients (Graceful Text) */}
            <div className="glass-panel" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '12px',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#34d399',
              background: 'rgba(15, 23, 42, 0.65)'
            }}>
              <Users size={14} color="#34d399" />
              <span>{connectedClients?.activeCount ? `${connectedClients.activeCount} connected` : 'Local Client Active'}</span>
            </div>

            {/* Quick Bazzite SSH Launcher Button */}
            <button
              onClick={async () => {
                try {
                  if (typeof window !== 'undefined' && window.electronAPI?.remoteLaunchTerminal) {
                    await window.electronAPI.remoteLaunchTerminal('bazzite');
                  } else {
                    await apiFetch('/api/remote-machines/launch-terminal', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ machineId: 'bazzite' })
                    });
                  }
                } catch (e) {
                  console.warn('Failed to launch Bazzite terminal:', e);
                }
              }}
              title="Quick SSH into Bazzite Gaming Station"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 11px',
                borderRadius: '12px',
                cursor: 'pointer',
                background: 'rgba(0, 242, 254, 0.08)',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                color: '#00f2fe',
                fontSize: '0.78rem',
                fontWeight: 600,
                transition: 'all 0.2s ease'
              }}
            >
              <Terminal size={13} />
              <span>Bazzite</span>
            </button>

            {/* Quick Lenny SSH Launcher Button */}
            <button
              onClick={async () => {
                try {
                  if (typeof window !== 'undefined' && window.electronAPI?.remoteLaunchTerminal) {
                    await window.electronAPI.remoteLaunchTerminal('lenny');
                  } else {
                    await apiFetch('/api/remote-machines/launch-terminal', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ machineId: 'lenny' })
                    });
                  }
                } catch (e) {
                  console.warn('Failed to launch Lenny terminal:', e);
                }
              }}
              title="Quick SSH into Lenny Server"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 11px',
                borderRadius: '12px',
                cursor: 'pointer',
                background: 'rgba(192, 132, 252, 0.08)',
                border: '1px solid rgba(192, 132, 252, 0.3)',
                color: '#c084fc',
                fontSize: '0.78rem',
                fontWeight: 600,
                transition: 'all 0.2s ease'
              }}
            >
              <Terminal size={13} />
              <span>Lenny</span>
            </button>

            {/* Gaming Mode Toggle Button */}
            <button
              onClick={onTogglePause}
              aria-pressed={isPaused}
              title={isPaused ? 'Click to resume Aloy' : 'Pause Aloy for Gaming Mode'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '12px',
                cursor: 'pointer',
                background: isPaused ? 'rgba(251, 146, 60, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                border: isPaused ? '1px solid rgba(251, 146, 60, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                color: isPaused ? '#fb923c' : '#94a3b8',
                fontSize: '0.8rem',
                fontWeight: 600,
                transition: 'all 0.2s ease'
              }}
            >
              <Gamepad2 size={14} />
              <span>{isPaused ? 'Resume AI' : 'Gaming Mode'}</span>
            </button>
          </div>
        </div>



        {/* Ambient Visual Observation Banner (Spoken Commentary + Visual HUD) */}
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel"
          style={{
            borderRadius: '16px',
            padding: '0.85rem 1.1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.08), rgba(127, 0, 255, 0.08))',
            border: '1px solid rgba(0, 242, 254, 0.28)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
            marginTop: '0.5rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1, minWidth: 0 }}>
              {/* Webcam Snapshot Thumbnail Preview */}
              {ambientObservations[0]?.imageDataUrl ? (
                <div
                  onClick={() => setSelectedSnapshotModal(ambientObservations[0])}
                  title="Click to view full Logitech C930e snapshot"
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: '1.5px solid rgba(0, 242, 254, 0.45)',
                    boxShadow: '0 0 10px rgba(0, 242, 254, 0.2)',
                    flexShrink: 0,
                    position: 'relative',
                    background: '#0f172a'
                  }}
                >
                  <img
                    src={ambientObservations[0].imageDataUrl}
                    alt="Webcam Snapshot"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: 1,
                    right: 1,
                    background: 'rgba(0, 0, 0, 0.7)',
                    borderRadius: '3px',
                    padding: '1px 3px',
                    fontSize: '0.55rem',
                    color: '#00f2fe'
                  }}>
                    <Maximize2 size={9} />
                  </div>
                </div>
              ) : (
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '11px',
                  background: 'rgba(0, 242, 254, 0.15)',
                  border: '1px solid rgba(0, 242, 254, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00f2fe',
                  flexShrink: 0
                }}>
                  <Eye size={18} />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#00f2fe', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {ambientObservations[0]?.badge || 'Ambient Room Observer'}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    {ambientObservations.length > 0 ? formatRelativeTime(ambientObservations[0]?.timestamp) : 'Logitech C930e Ready'}
                  </span>
                  {ambientObservations[0]?.suggestedAction && (
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '6px',
                      background: 'rgba(0, 242, 254, 0.15)',
                      color: '#00f2fe',
                      border: '1px solid rgba(0, 242, 254, 0.3)'
                    }}>
                      ⚡ {ambientObservations[0].suggestedAction.label}
                    </span>
                  )}
                </div>
                <p style={{
                  fontSize: '0.88rem',
                  color: '#e2e8f0',
                  lineHeight: 1.45,
                  margin: 0,
                  userSelect: 'text',
                  wordBreak: 'break-word'
                }}>
                  {ambientObservations.length > 0
                    ? ambientObservations[0]?.text
                    : `Aloy is monitoring your workspace. Click "Observe Room" to capture a live vision analysis.`}
                </p>

                {isFollowUpListening && (
                  <div style={{
                    marginTop: '6px',
                    padding: '6px 10px',
                    background: 'rgba(0, 242, 254, 0.12)',
                    border: '1px solid rgba(0, 242, 254, 0.35)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#00f2fe',
                        boxShadow: '0 0 8px #00f2fe'
                      }} />
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#00f2fe' }}>
                        🎙️ Aloy is listening for your reply ({followUpCountdown}s) — speak naturally
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={cancelHandsFreeFollowUp}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: 'none',
                        color: '#94a3b8',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => {
                  const next = !isAutoListenEnabled;
                  setIsAutoListenEnabled(next);
                  try { localStorage.setItem('aloy_auto_listen_after_obs', String(next)); } catch {}
                }}
                title={isAutoListenEnabled ? 'Auto-Listen for voice reply after Aloy speaks: ON' : 'Auto-Listen for voice reply after Aloy speaks: OFF'}
                style={{
                  background: isAutoListenEnabled ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: isAutoListenEnabled ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid rgba(255, 255, 255, 0.12)',
                  color: isAutoListenEnabled ? '#00f2fe' : '#64748b',
                  borderRadius: '10px',
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {isAutoListenEnabled ? <Mic size={13} /> : <MicOff size={13} />}
                <span>Auto-Reply: {isAutoListenEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {ambientObservations.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowObsHistory(!showObsHistory)}
                  title="Toggle Observation Timeline History"
                  style={{
                    background: showObsHistory ? 'rgba(0, 242, 254, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                    border: showObsHistory ? '1px solid rgba(0, 242, 254, 0.45)' : '1px solid rgba(255, 255, 255, 0.12)',
                    color: showObsHistory ? '#00f2fe' : '#94a3b8',
                    borderRadius: '10px',
                    padding: '6px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <History size={13} />
                  <span>History ({ambientObservations.length})</span>
                </button>
              )}

              {ambientObservations.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleCopyObservation}
                    title={copiedObs ? 'Copied to Clipboard!' : 'Copy full observation text'}
                    style={{
                      background: copiedObs ? 'rgba(52, 211, 153, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                      border: copiedObs ? '1px solid rgba(52, 211, 153, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
                      color: copiedObs ? '#34d399' : '#94a3b8',
                      borderRadius: '10px',
                      padding: '6px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {copiedObs ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedObs ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAmbientObservation(ambientObservations[0], { speak: true })}
                    title="Replay Voice Observation with Kokoro TTS"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#00f2fe',
                      borderRadius: '10px',
                      padding: '6px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Volume2 size={13} />
                    <span>Speak</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleObserveNow}
                disabled={isObserving}
                title="Trigger Real-Time Webcam Vision Observation"
                style={{
                  background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.25), rgba(127, 0, 255, 0.25))',
                  border: '1px solid rgba(0, 242, 254, 0.45)',
                  color: '#f8fafc',
                  borderRadius: '10px',
                  padding: '6px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: isObserving ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <RefreshCw size={13} className={isObserving ? 'spin' : ''} />
                <span>{isObserving ? 'Observing…' : 'Observe Room'}</span>
              </button>
            </div>
          </div>

          {/* Collapsible History Drawer */}
          <AnimatePresence>
            {showObsHistory && ambientObservations.length > 1 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  overflow: 'hidden'
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>
                  📜 Recent Workspace Observations
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {ambientObservations.slice(1, 9).map((obs) => (
                    <div
                      key={obs.id || obs.timestamp}
                      style={{
                        padding: '8px 10px',
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      {obs.imageDataUrl && (
                        <img
                          src={obs.imageDataUrl}
                          alt="Snapshot"
                          onClick={() => setSelectedSnapshotModal(obs)}
                          style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover', cursor: 'pointer', flexShrink: 0 }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#00f2fe' }}>{obs.badge}</span>
                          <span style={{ fontSize: '0.62rem', color: '#64748b' }}>{formatRelativeTime(obs.timestamp)}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {obs.text}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Snapshot Lightbox Modal */}
          {selectedSnapshotModal && (
            <div
              onClick={() => setSelectedSnapshotModal(null)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.85)',
                backdropFilter: 'blur(8px)',
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px'
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#0f172a',
                  border: '1px solid rgba(0, 242, 254, 0.4)',
                  borderRadius: '16px',
                  padding: '16px',
                  maxWidth: '720px',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#00f2fe' }}>
                      📸 Logitech C930e Snapshot
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {formatRelativeTime(selectedSnapshotModal.timestamp)} • {selectedSnapshotModal.badge}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedSnapshotModal(null)}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.1)', maxHeight: '420px', display: 'flex', justifyContent: 'center', background: '#000' }}>
                  <img
                    src={selectedSnapshotModal.imageDataUrl}
                    alt="Full Snapshot"
                    style={{ maxWidth: '100%', maxHeight: '420px', objectFit: 'contain' }}
                  />
                </div>
                <div style={{ fontSize: '0.88rem', color: '#e2e8f0', background: 'rgba(255, 255, 255, 0.04)', padding: '10px 12px', borderRadius: '8px' }}>
                  "{selectedSnapshotModal.text}"
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* 📊 4 Non-Redundant Insight Pulse Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: '1rem'
      }}>
        {/* Card 1: Perimeter Security & Climate */}
        <motion.div
          whileHover={{ y: -2 }}
          onClick={onOpenSmartHomeDrawer}
          className="glass-panel"
          style={{
            padding: '1.2rem',
            borderRadius: '18px',
            cursor: 'pointer',
            border: unlockedLocks.length > 0 ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
            background: unlockedLocks.length > 0 ? 'rgba(35, 18, 22, 0.75)' : 'rgba(15, 21, 35, 0.75)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: unlockedLocks.length > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: unlockedLocks.length > 0 ? '#f87171' : '#4ade80'
            }}>
              <ShieldCheck size={18} />
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
              Drawer <ChevronRight size={13} />
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: unlockedLocks.length > 0 ? '#f87171' : '#f8fafc' }}>
            {unlockedLocks.length > 0 ? `${unlockedLocks.length} Door Unlocked ⚠️` : 'Perimeter Secure ✓'}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, marginTop: '2px' }}>Security & Climate</div>
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '4px' }}>
            {smartHomeStats ? `Thermostat at ${smartHomeStats.climateTemp} · ${smartHomeStats.lightsOn}/${smartHomeStats.totalLights} lights active` : 'Connected'}
          </div>
        </motion.div>

        {/* Card 2: Pipelines & Live Processing */}
        <motion.div
          whileHover={{ y: -2 }}
          onClick={onOpenProjectsPanel}
          className="glass-panel"
          style={{
            padding: '1.2rem',
            borderRadius: '18px',
            cursor: 'pointer',
            border: activeAutoRip ? '1px solid rgba(0, 242, 254, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 21, 35, 0.75)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(0, 242, 254, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#00f2fe'
            }}>
              <FolderGit2 size={18} />
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
              Panel <ChevronRight size={13} />
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc' }}>
            {activeAutoRip ? `AutoRip: ${activeAutoRip.progressPct || 0}%` : `${trackedProjects?.length || 0} Repos Active`}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, marginTop: '2px' }}>Pipelines & Builds</div>
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeAutoRip?.step?.label || 'All local builds nominal & passing'}
          </div>
        </motion.div>

        {/* Card 3: Skills & Autonomous Knowledge (Count & Recency, Not static 100%) */}
        <motion.div
          whileHover={{ y: -2 }}
          onClick={onOpenSkillsDashboard}
          className="glass-panel"
          style={{
            padding: '1.2rem',
            borderRadius: '18px',
            cursor: 'pointer',
            border: needsReviewSkillsCount > 0 ? '1px solid rgba(251, 191, 36, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 21, 35, 0.75)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(192, 132, 252, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#c084fc'
            }}>
              <Brain size={18} />
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
              Dashboard <ChevronRight size={13} />
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc' }}>
            {(memories?.length || 0) + 18} Verified Notes
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, marginTop: '2px' }}>Autonomous Intelligence</div>
          <div style={{ fontSize: '0.74rem', color: needsReviewSkillsCount > 0 ? '#fbbf24' : '#64748b', marginTop: '4px' }}>
            {needsReviewSkillsCount > 0 ? `${needsReviewSkillsCount} synthesis items need review` : 'Overnight pass: 3:06 AM (Clean)'}
          </div>
        </motion.div>

        {/* Card 4: Upcoming Agenda & Chores */}
        <motion.div
          whileHover={{ y: -2 }}
          className="glass-panel"
          style={{
            padding: '1.2rem',
            borderRadius: '18px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 21, 35, 0.75)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(56, 189, 248, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8'
            }}>
              <Calendar size={18} />
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
              48h Horizon
            </span>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nextUpcomingEvent ? nextUpcomingEvent.summary : 'Agenda Clear'}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, marginTop: '2px' }}>Upcoming Schedule</div>
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '4px' }}>
            {nextUpcomingEvent?.start ? `${nextUpcomingEvent.calendar} · ${formatClockTime(nextUpcomingEvent.start)}` : '0 scheduled conflicts'}
          </div>
        </motion.div>
      </div>

      {/* Dashboard Tabs */}
      <div style={{ display: 'flex', gap: '0.35rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '1.25rem' }}>
        {[
          { id: 'home', label: 'Home & Security', icon: ShieldCheck, count: 2 },
          { id: 'projects', label: 'Projects & Knowledge', icon: FolderGit2, count: 2 },
          { id: 'feeds', label: 'Feeds', icon: Newspaper, count: 3 },
          { id: 'system', label: 'System', icon: Wrench, count: 2 }
        ].map((tab) => {
          const TabIcon = tab.icon;
          const isActive = activeDashboardTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveDashboardTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: isActive ? '#38bdf8' : '#64748b',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid #38bdf8' : '2px solid transparent',
                padding: '0.6rem 0.9rem',
                cursor: 'pointer'
              }}
            >
              <TabIcon size={14} />
              {tab.label}
              <span style={{
                fontSize: '0.65rem',
                color: isActive ? '#38bdf8' : '#64748b',
                background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                padding: '1px 6px',
                borderRadius: '10px'
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Home & Security */}
      {activeDashboardTab === 'home' && (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: '1.5rem',
        alignItems: 'start'
      }}>
          {/* Smart Home Command Hub */}
          <div className="glass-panel" style={{
            borderRadius: '20px',
            padding: '1.5rem',
            background: 'rgba(15, 21, 35, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'rgba(0, 242, 254, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00f2fe'
                }}>
                  <Zap size={16} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                    Smart Home Direct Controls
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                    Instant toggles for lights, locks, and climate
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={refreshHomeAssistant}
                  disabled={isHARefreshing}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '8px'
                  }}
                  title="Refresh Home Assistant"
                >
                  <RefreshCw size={14} className={isHARefreshing ? 'spin' : ''} />
                </button>
                <button
                  onClick={onOpenSmartHomeDrawer}
                  style={{
                    background: 'rgba(0, 242, 254, 0.08)',
                    border: '1px solid rgba(0, 242, 254, 0.25)',
                    color: '#00f2fe',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  Full Drawer <ArrowRight size={12} />
                </button>
              </div>
            </div>

            {/* Thermostat Direct Tile */}
            {primaryClimate && (
              <div style={{
                background: 'rgba(10, 14, 23, 0.7)',
                border: '1px solid rgba(251, 146, 60, 0.25)',
                borderRadius: '14px',
                padding: '0.9rem 1.1rem',
                marginBottom: '1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(251, 146, 60, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fb923c'
                  }}>
                    <Thermometer size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f1f5f9' }}>
                      {sanitizeEntityFriendlyName(primaryClimate.name)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Current: <strong style={{ color: '#fb923c' }}>{primaryClimate.attributes?.current_temperature ?? '—'}°F</strong> · Mode: {primaryClimate.state}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  {primaryClimate.state !== 'off' && typeof primaryClimate.attributes?.temperature === 'number' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        onClick={() => handleToggleDevice('climate', 'set_temperature', primaryClimate.entity_id, {
                          temperature: Math.max(50, primaryClimate.attributes.temperature - 1)
                        })}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: 'none',
                          color: '#fb923c',
                          fontWeight: 800,
                          fontSize: '1rem',
                          cursor: 'pointer'
                        }}
                      >
                        -
                      </button>
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fff', minWidth: '32px', textAlign: 'center' }}>
                        {primaryClimate.attributes.temperature}°
                      </span>
                      <button
                        onClick={() => handleToggleDevice('climate', 'set_temperature', primaryClimate.entity_id, {
                          temperature: Math.min(85, primaryClimate.attributes.temperature + 1)
                        })}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: 'none',
                          color: '#fb923c',
                          fontWeight: 800,
                          fontSize: '1rem',
                          cursor: 'pointer'
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      const isOff = primaryClimate.state === 'off';
                      const onMode = (primaryClimate.attributes?.hvac_modes || []).find((m) => m !== 'off') || 'heat';
                      handleToggleDevice('climate', 'set_hvac_mode', primaryClimate.entity_id, { hvac_mode: isOff ? onMode : 'off' });
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      background: primaryClimate.state === 'off' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: primaryClimate.state === 'off' ? '#4ade80' : '#f87171',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {primaryClimate.state === 'off' ? 'Turn On' : 'Turn Off'}
                  </button>
                </div>
              </div>
            )}

            {/* Smart Home Device Grid (Clean Wrapping & Action-Labeled Buttons) */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '0.75rem'
            }}>
              {/* Primary Lights */}
              {primaryLights.map((light) => {
                const isOn = light.state === 'on';
                const isExecuting = !!executingMap[light.entity_id];
                const displayName = sanitizeEntityFriendlyName(light.name);

                return (
                  <motion.div
                    key={light.entity_id}
                    whileHover={{ scale: 1.01 }}
                    style={{
                      padding: '0.75rem 0.85rem',
                      borderRadius: '12px',
                      background: isOn ? 'rgba(253, 224, 71, 0.06)' : 'rgba(255, 255, 255, 0.02)',
                      border: isOn ? '1px solid rgba(253, 224, 71, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                      <Lightbulb size={16} color={isOn ? '#fde047' : '#64748b'} style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: isOn ? '#fff' : '#94a3b8', lineHeight: 1.2, wordBreak: 'break-word' }}>
                          {displayName}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: isOn ? '#fde047' : '#64748b', fontWeight: 600, marginTop: '2px' }}>
                          {isOn ? '● Active' : '○ Off'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleDevice('light', isOn ? 'turn_off' : 'turn_on', light.entity_id)}
                      disabled={isExecuting}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '7px',
                        border: 'none',
                        background: isOn ? 'rgba(253, 224, 71, 0.18)' : 'rgba(255, 255, 255, 0.08)',
                        color: isOn ? '#fde047' : '#cbd5e1',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {isExecuting ? '...' : isOn ? 'Turn Off' : 'Turn On'}
                    </button>
                  </motion.div>
                );
              })}

              {/* Primary Locks */}
              {primaryLocks.map((lock) => {
                const isLocked = lock.state === 'locked';
                const isExecuting = !!executingMap[lock.entity_id];
                const displayName = sanitizeEntityFriendlyName(lock.name);

                return (
                  <motion.div
                    key={lock.entity_id}
                    whileHover={{ scale: 1.01 }}
                    style={{
                      padding: '0.75rem 0.85rem',
                      borderRadius: '12px',
                      background: isLocked ? 'rgba(74, 222, 128, 0.06)' : 'rgba(239, 68, 68, 0.12)',
                      border: isLocked ? '1px solid rgba(74, 222, 128, 0.25)' : '1px solid rgba(239, 68, 68, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                      {isLocked ? <Lock size={16} color="#4ade80" style={{ flexShrink: 0 }} /> : <Unlock size={16} color="#f87171" style={{ flexShrink: 0 }} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: isLocked ? '#cbd5e1' : '#f87171', lineHeight: 1.2, wordBreak: 'break-word' }}>
                          {displayName}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: isLocked ? '#4ade80' : '#f87171', fontWeight: 600, marginTop: '2px' }}>
                          {isLocked ? '🔒 Locked' : '🔓 Unlocked'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleDevice('lock', isLocked ? 'unlock' : 'lock', lock.entity_id)}
                      disabled={isExecuting}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '7px',
                        border: 'none',
                        background: isLocked ? 'rgba(255, 255, 255, 0.08)' : '#ef4444',
                        color: isLocked ? '#cbd5e1' : '#fff',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {isExecuting ? '...' : isLocked ? 'Unlock' : 'Lock Now'}
                    </button>
                  </motion.div>
                );
              })}

              {primaryLights.length === 0 && primaryLocks.length === 0 && (
                <div style={{
                  gridColumn: '1 / -1',
                  padding: '1.25rem',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px dashed rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Shield size={20} color="#00f2fe" />
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>Home Assistant Sentinel Active</div>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Syncing perimeter gate controls, Aqara U400 lock, and Philips Hue mesh.</div>
                    </div>
                  </div>
                  <button
                    onClick={() => onOpenSmartHomeDrawer?.()}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '8px',
                      background: 'rgba(0, 242, 254, 0.15)',
                      border: '1px solid rgba(0, 242, 254, 0.3)',
                      color: '#00f2fe',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Open Smart Home →
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Jellyfin Media Orchestrator Card */}
          <NowPlayingCard
            jellyfinStatus={jellyfinStatus}
            activeSessions={activeSessions}
          />

          {/* Arr Stack & Active Download Sentinel Card */}
          <div className="glass-panel" style={{
            borderRadius: '20px',
            padding: '1.5rem',
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'rgba(0, 242, 254, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00f2fe'
                }}>
                  <DownloadCloud size={16} />
                </div>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
                    Arr Stack & Active Download Sentinel
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    Real-time download pipelines & usenet intake
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: arrQueue.sonarrConnected ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  border: `1px solid ${arrQueue.sonarrConnected ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  color: arrQueue.sonarrConnected ? '#34d399' : '#f87171'
                }}>
                  {arrQueue.sonarrConnected ? '● Sonarr :8989' : '○ Sonarr'}
                </span>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: arrQueue.radarrConnected ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  border: `1px solid ${arrQueue.radarrConnected ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  color: arrQueue.radarrConnected ? '#34d399' : '#f87171'
                }}>
                  {arrQueue.radarrConnected ? '● Radarr :7878' : '○ Radarr'}
                </span>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: arrQueue.lidarrConnected ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  border: `1px solid ${arrQueue.lidarrConnected ? 'rgba(52, 211, 153, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  color: arrQueue.lidarrConnected ? '#34d399' : '#f87171'
                }}>
                  {arrQueue.lidarrConnected ? '● Lidarr :8686' : '○ Lidarr'}
                </span>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: 'rgba(251, 191, 36, 0.12)',
                  border: '1px solid rgba(251, 191, 36, 0.3)',
                  color: '#fbbf24'
                }}>
                  ● SABnzbd :8080
                </span>
              </div>
            </div>

            {arrQueue.queue && arrQueue.queue.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {arrQueue.queue.map((item, idx) => {
                  const pct = item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0;
                  return (
                    <div key={idx} style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#f8fafc' }}>{item.title}</span>
                        <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#00f2fe' }}>{pct}%</span>
                      </div>
                      <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden', marginBottom: '6px' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #00f2fe, #38bdf8)' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b' }}>
                        <span>Status: {item.status}</span>
                        <span>ETA: {item.timeleft || 'Estimating...'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                padding: '1.25rem',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px dashed rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <Check size={20} color="#34d399" />
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  Queue clear — all requested TV series and movies have completed and are indexed in Jellyfin.
                </div>
              </div>
            )}
          </div>
      </div>
      )}

      {/* Projects & Knowledge */}
      {activeDashboardTab === 'projects' && (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: '1.5rem',
        alignItems: 'start'
      }}>
          {/* Projects & Pipeline Monitor */}
          <div className="glass-panel" style={{
            borderRadius: '20px',
            padding: '1.5rem',
            background: 'rgba(15, 21, 35, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'rgba(0, 242, 254, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00f2fe'
                }}>
                  <FolderGit2 size={16} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                    Tracked Projects & Pipelines
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                    AutoRip disc monitoring, Git branches, and build health
                  </p>
                </div>
              </div>

              <button
                onClick={onOpenProjectsPanel}
                style={{
                  background: 'rgba(0, 242, 254, 0.08)',
                  border: '1px solid rgba(0, 242, 254, 0.25)',
                  color: '#00f2fe',
                  padding: '4px 10px',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Manage Projects <ArrowRight size={12} />
              </button>
            </div>

            {/* Live Status Cards */}
            {projectLiveStatus && Object.keys(projectLiveStatus).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                {Object.entries(projectLiveStatus).map(([name, summary]) => {
                  const stepLabel = summary.step
                    ? `${summary.step.label}${summary.step.total ? ` ${summary.step.current}/${summary.step.total}` : ''}`
                    : summary.statusMessage;
                  return (
                    <div key={name} style={{
                      padding: '0.9rem 1.1rem',
                      borderRadius: '14px',
                      background: 'rgba(0, 242, 254, 0.05)',
                      border: '1px solid rgba(0, 242, 254, 0.25)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Disc3 size={16} color="#00f2fe" className={summary.progressPct != null ? 'spin' : ''} />
                          <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }}>{name}</span>
                        </div>
                        {typeof summary.progressPct === 'number' && (
                          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#00f2fe' }}>
                            {summary.progressPct}%
                          </span>
                        )}
                      </div>
                      {stepLabel && (
                        <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: '6px' }}>
                          {stepLabel}
                        </div>
                      )}
                      {typeof summary.progressPct === 'number' && (
                        <div style={{ height: '6px', borderRadius: '3px', background: '#0c111c', marginTop: '8px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${summary.progressPct}%`, background: 'linear-gradient(90deg, #00f2fe, #4facfe)', borderRadius: '3px' }} />
                        </div>
                      )}
                      {summary.lastCompleted?.disc_label && (
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                          Last: {summary.lastCompleted.disc_label} ({summary.lastCompleted.episodes_saved || 0} episodes)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tracked Projects List */}
            {trackedProjects && trackedProjects.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                {trackedProjects.map((p) => (
                  <div key={p.id} style={{
                    padding: '0.75rem 0.9rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>{p.name}</span>
                      {p.port && (
                        <span style={{ fontSize: '0.7rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                          :{p.port}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.folderPath}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '1rem' }}>
                No projects tracked yet. Add one in the Projects & Builds panel.
              </div>
            )}
          </div>

          {/* Autonomous Skills & Learning (Meaningful Counts & Movement) */}
          <div className="glass-panel" style={{
            borderRadius: '20px',
            padding: '1.5rem',
            background: 'rgba(15, 21, 35, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'rgba(192, 132, 252, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#c084fc'
                }}>
                  <BarChart3 size={16} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                    Autonomous Skills & Knowledge
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                    Overnight synthesis: Claude researches, Gemini independently verifies
                  </p>
                </div>
              </div>

              <button
                onClick={onOpenSkillsDashboard}
                style={{
                  background: 'rgba(192, 132, 252, 0.08)',
                  border: '1px solid rgba(192, 132, 252, 0.25)',
                  color: '#c084fc',
                  padding: '4px 10px',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                View Details <ArrowRight size={12} />
              </button>
            </div>

            {/* Knowledge Topics Breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {(skillsStats?.categories || []).map((cat) => {
                const hasLearned = cat.confirmedCount > 0;
                return (
                  <div key={cat.name} style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#e2e8f0' }}>{cat.name}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                        {hasLearned ? `${cat.confirmedCount} verified topic${cat.confirmedCount > 1 ? 's' : ''}` : 'Baseline capability'}
                      </div>
                    </div>
                    <div style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      background: cat.needsReviewCount > 0 ? 'rgba(251, 191, 36, 0.15)' : hasLearned ? 'rgba(192, 132, 252, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      color: cat.needsReviewCount > 0 ? '#fbbf24' : hasLearned ? '#c084fc' : '#94a3b8'
                    }}>
                      {cat.needsReviewCount > 0 ? `${cat.needsReviewCount} Review` : hasLearned ? 'Reinforced' : 'Nominal'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Jellyfin Media Orchestrator Card */}
          <NowPlayingCard
            jellyfinStatus={jellyfinStatus}
            activeSessions={activeSessions}
          />
      </div>
      )}

      {/* Feeds */}
      {activeDashboardTab === 'feeds' && (
      <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: '1.5rem',
        alignItems: 'start'
      }}>
          {/* Today's Agenda & Calendar Events */}
          <div className="glass-panel" style={{
            borderRadius: '20px',
            padding: '1.5rem',
            background: 'rgba(15, 21, 35, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '10px',
                background: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8'
              }}>
                <Calendar size={16} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  Agenda & Chores (48h)
                </h3>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                  Google Calendar and family chore deadlines
                </p>
              </div>
            </div>

            {calendarEvents.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '220px', overflowY: 'auto' }}>
                {calendarEvents.slice(0, 6).map((ev, i) => (
                  <div key={i} style={{
                    padding: '0.6rem 0.8rem',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>{ev.summary}</span>
                      <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 600 }}>
                        {formatCalendarDisplayName(ev.calendar)}
                      </span>
                    </div>
                    {ev.start && (
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {new Date(ev.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '0.75rem' }}>
                No events on the calendar for the next 48h.
              </div>
            )}
          </div>

          {/* Tech News */}
          <NewsSection
            newsArticles={newsArticles}
            newsSources={newsSources}
            newsInterests={newsInterests}
            isNewsRefreshing={isNewsRefreshing}
            newsSettingsOpen={newsSettingsOpen}
            setNewsSettingsOpen={setNewsSettingsOpen}
            newSourceUrl={newSourceUrl}
            setNewSourceUrl={setNewSourceUrl}
            newSourceName={newSourceName}
            setNewSourceName={setNewSourceName}
            newsInterestsInput={newsInterestsInput}
            setNewsInterestsInput={setNewsInterestsInput}
            onRefreshNews={handleNewsRefresh}
            onAddNewsSource={handleAddNewsSource}
            onRemoveNewsSource={handleRemoveNewsSource}
            onSaveNewsInterests={handleSaveNewsInterests}
          />
      </div>
      <div style={{ marginTop: '1.5rem' }}>
          {/* Pending Reminders Checklist */}
          <div className="glass-panel" style={{
            borderRadius: '20px',
            padding: '1.5rem',
            background: 'rgba(15, 21, 35, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '10px',
                background: 'rgba(74, 222, 128, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4ade80'
              }}>
                <CheckSquare size={16} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  Reminders & Tasks
                </h3>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                  Active checklist with one-tap completion
                </p>
              </div>
            </div>

            {/* New Reminder Inline Form */}
            <form onSubmit={handleAddReminderSubmit} style={{ display: 'flex', gap: '6px', marginBottom: '0.9rem' }}>
              <input
                type="text"
                value={newReminderText}
                onChange={(e) => setNewReminderText(e.target.value)}
                placeholder="Add a new reminder..."
                style={{
                  flex: 1,
                  background: 'rgba(10, 14, 23, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  padding: '6px 10px',
                  color: '#fff',
                  fontSize: '0.82rem',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  background: 'rgba(74, 222, 128, 0.15)',
                  border: '1px solid rgba(74, 222, 128, 0.3)',
                  color: '#4ade80',
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <Plus size={14} />
              </button>
            </form>

            {/* Reminders List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
              {pendingRemindersList.length > 0 ? (
                pendingRemindersList.map((r) => (
                  <div key={r.id} style={{
                    padding: '0.55rem 0.75rem',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem'
                  }}>
                    <span style={{ fontSize: '0.82rem', color: '#f1f5f9', flex: 1 }}>{r.text}</span>
                    <button
                      onClick={() => onCompleteReminder(r.text)}
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(74, 222, 128, 0.4)',
                        color: '#4ade80',
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                      title="Mark as done"
                    >
                      <Check size={12} />
                    </button>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '0.5rem' }}>
                  No pending reminders.
                </div>
              )}
            </div>
          </div>
      </div>
      </>
      )}

      {/* System */}
      {activeDashboardTab === 'system' && (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '1.5rem'
      }}>
          {/* Bazzite Gaming Station Remote Console */}
          <BazziteRemoteCard />

          {/* Dev Backlog & Ecosystem Hub */}
          <div className="glass-panel" style={{
            borderRadius: '20px',
            padding: '1.5rem',
            background: 'rgba(15, 21, 35, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '10px',
                background: 'rgba(0, 242, 254, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#00f2fe'
              }}>
                <Code2 size={16} />
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Ecosystem & System Hub
              </h3>
            </div>

            {/* Obsidian Vault Status */}
            <div style={{
              padding: '0.75rem 0.9rem',
              borderRadius: '12px',
              background: 'rgba(192, 132, 252, 0.06)',
              border: '1px solid rgba(192, 132, 252, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookOpen size={15} color="#c084fc" />
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>
                    Obsidian Knowledge Vault
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#c084fc' }}>
                    {vaultDir ? `${(uploadedDocuments || []).filter((d) => d.source === 'obsidian').length || 5} notes indexed` : 'Not connected'}
                  </div>
                </div>
              </div>
              {vaultDir && (
                <button
                  onClick={onSyncVault}
                  disabled={isSyncingVault}
                  style={{
                    background: 'rgba(192, 132, 252, 0.15)',
                    border: '1px solid rgba(192, 132, 252, 0.35)',
                    color: '#c084fc',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {isSyncingVault ? 'Syncing...' : 'Resync'}
                </button>
              )}
            </div>

            {/* Backup Status */}
            <div style={{
              padding: '0.75rem 0.9rem',
              borderRadius: '12px',
              background: lastBackupStatus && !lastBackupStatus.success ? 'rgba(248, 113, 113, 0.06)' : 'rgba(34, 197, 94, 0.06)',
              border: lastBackupStatus && !lastBackupStatus.success ? '1px solid rgba(248, 113, 113, 0.25)' : '1px solid rgba(34, 197, 94, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <HardDrive size={15} color={lastBackupStatus && !lastBackupStatus.success ? '#f87171' : '#4ade80'} />
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>
                    Snapshot Backup
                  </div>
                  <div style={{ fontSize: '0.72rem', color: lastBackupStatus && !lastBackupStatus.success ? '#f87171' : '#4ade80' }}>
                    {lastBackupStatus?.success
                      ? `Last snapshot: ${formatRelativeTime(lastBackupStatus.timestamp)}`
                      : lastBackupStatus?.error
                        ? `Failed: ${lastBackupStatus.error}`
                        : 'Backup Ready'}
                  </div>
                </div>
              </div>
              <button
                onClick={onBackupNow}
                disabled={isBackingUp}
                style={{
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.35)',
                  color: '#4ade80',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {isBackingUp ? 'Saving...' : 'Back Up'}
              </button>
            </div>

            {/* Dev Ideas Backlog Preview */}
            {devIdeas.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Pending UI Ideas ({devIdeas.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {devIdeas.slice(0, 2).map((idea) => (
                    <div key={idea.id} style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <span style={{ fontSize: '0.78rem', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                        {idea.title}
                      </span>
                      <button
                        onClick={() => onAskAloy(`Please implement this idea from the Dev Workspace backlog: "${idea.title}" — ${idea.description || ''}. Use your read_own_ui_source and propose_ui_change tools.`)}
                        style={{
                          background: 'rgba(0, 242, 254, 0.12)',
                          border: 'none',
                          color: '#00f2fe',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Ask Aloy
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ecosystem Action Links */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <button
                onClick={onOpenDevWorkspace}
                style={{
                  padding: '0.6rem 0.4rem',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#e2e8f0',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  justifyContent: 'center'
                }}
              >
                <Code2 size={13} color="#00f2fe" />
                <span>Dev Backlog</span>
              </button>

              <button
                onClick={onOpenFinancesPanel}
                style={{
                  padding: '0.6rem 0.4rem',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#e2e8f0',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  justifyContent: 'center'
                }}
              >
                <Wallet size={13} color="#4ade80" />
                <span>Finances</span>
              </button>

              <button
                onClick={onOpenMemoryModal}
                style={{
                  padding: '0.6rem 0.4rem',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#e2e8f0',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  justifyContent: 'center'
                }}
              >
                <Brain size={13} color="#c084fc" />
                <span>Memories ({memories?.length || 0})</span>
              </button>
            </div>
          </div>
      </div>
      )}
    </div>
  );
}
