import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { calculateWorkoutStreak, filterWorkoutCalendarEvents } from '../services/workouts';
import { fetchGoogleCalendarEvents } from '../services/homeassistant';
import { renderMarkdown } from '../services/markdown';
import {
  Cpu,
  BookOpen,
  Shield,
  Briefcase,
  Flame,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Zap,
  HardDrive,
  Sparkles,
  ArrowRight,
  Send,
  Trash2,
  FileText,
  Activity,
  Layers,
  Database,
  Lightbulb,
  Lock,
  Thermometer,
  ExternalLink,
  Plus,
  Tv,
  Wallet,
  Calendar,
  Check,
  Search,
  BarChart3,
  Eye,
  FileCheck,
  BrainCircuit,
  User,
  Save,
  HardDriveDownload,
  LockOpen,
  RotateCcw,
  Landmark,
  Users,
  Target,
  ScrollText,
  Clock
} from 'lucide-react';
import DevWorkspace from './DevWorkspace.jsx';
import AthenaWorkspace from './AthenaWorkspace.jsx';
import SmartHomeDrawer from './SmartHomeDrawer.jsx';
import { PageHeader, TabBar, PulseGrid, EmptyState } from './common';
import { apiFetch } from '../services/aloyApi.js';


export default function SubAgentsHub({
  initialAgent = 'apollo',
  initialSubTab = null,
  onClose,
  haCategories: propHaCategories,
  onExecuteHAService,
  smartHomeProps = {},
  remindersProps = {},
  profileProps = {}
}) {
  const [activeAgent, setActiveAgent] = useState(initialAgent);
  const [loading, setLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);

  useEffect(() => {
    if (initialAgent) {
      setActiveAgent(initialAgent);
    }
  }, [initialAgent]);

  useEffect(() => {
    if (initialSubTab) {
      if (initialAgent === 'apollo') setApolloTab(initialSubTab);
    }
  }, [initialAgent, initialSubTab]);

  // Sub-tab states
  const [apolloTab, setApolloTab] = useState(initialSubTab || 'memories'); // 'memories' | 'skills' | 'vault' | 'ingest'
  const [hermesTab, setHermesTab] = useState('brief'); // 'brief' | 'reminders' | 'budget'

  // Apollo State
  const [memoriesList, setMemoriesList] = useState([]);
  const [memorySearch, setMemorySearch] = useState('');
  const [selectedFactCategory, setSelectedFactCategory] = useState('All');
  const [newMemoryFact, setNewMemoryFact] = useState('');
  const [apolloStats, setApolloStats] = useState({ memoriesCount: 0, lastVaultSync: null });
  const [skillsData, setSkillsData] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docCategory, setDocCategory] = useState('Technical Note');

  // Apollo User Profile & Security Lock State
  const [profileName, setProfileName] = useState(profileProps?.userProfile?.name ?? '—');
  const [profileStyle, setProfileStyle] = useState(profileProps?.userProfile?.style || 'Concise, direct, highly technical, clean code, dark UI aesthetics.');
  const [profileInstructions, setProfileInstructions] = useState(profileProps?.userProfile?.instructions || 'Always address requests directly with production-ready code and optimal architecture.');
  const [profileCheckIns, setProfileCheckIns] = useState(profileProps?.userProfile?.checkInsEnabled ?? true);
  const [lockCurrentPin, setLockCurrentPin] = useState('');
  const [lockNewPin, setLockNewPin] = useState('');
  const [lockConfirmPin, setLockConfirmPin] = useState('');
  const [lockBusy, setLockBusy] = useState(false);

  // Minerva State
  const [healthReport, setHealthReport] = useState(null);
  const [alertMessage, setAlertMessage] = useState('');
  const [haCategories, setHaCategories] = useState(propHaCategories || { lights: [], locks: [], climate: [] });

  useEffect(() => {
    if (propHaCategories && (propHaCategories.lights?.length || propHaCategories.locks?.length || propHaCategories.climate?.length)) {
      setHaCategories(propHaCategories);
    }
  }, [propHaCategories]);

  // Hermes State
  const [dailyBrief, setDailyBrief] = useState(null);
  const [budgetHealth, setBudgetHealth] = useState(null);
  const [portfolioSnapshot, setPortfolioSnapshot] = useState(null);
  const [shareInputs, setShareInputs] = useState({});
  const [savingShares, setSavingShares] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [newReminderText, setNewReminderText] = useState('');
  const [workouts, setWorkouts] = useState([]);
  const [calendarWorkouts, setCalendarWorkouts] = useState([]);
  const [expandedCalendarWorkouts, setExpandedCalendarWorkouts] = useState(() => new Set());
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseSets, setNewExerciseSets] = useState('');
  const [newExerciseReps, setNewExerciseReps] = useState('');
  const [newExerciseWeight, setNewExerciseWeight] = useState('');
  const [jobListings, setJobListings] = useState([]);
  const [jobRadarConfig, setJobRadarConfig] = useState(null);
  const [jobFilterQuery, setJobFilterQuery] = useState('ALL');
  const [jobFilterStatus, setJobFilterStatus] = useState('ALL');
  const [jobSearchText, setJobSearchText] = useState('');
  const [isScanningJobs, setIsScanningJobs] = useState(false);

  // Pantheon Council / Conclave State
  const [conclaveData, setConclaveData] = useState(null);
  const [conclaveHistory, setConclaveHistory] = useState([]);
  const [isConvening, setIsConvening] = useState(false);
  const [conclaveTab, setConclaveTab] = useState('telemetry'); // 'telemetry' | 'minutes' | 'directives' | 'dossier' | 'history'
  const [transcriptSelectedDate, setTranscriptSelectedDate] = useState('ALL'); // 'ALL' | 'YYYY-MM-DD'
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState('');

  // Date Helpers for Deliberation Transcripts
  const getSessionDateKey = (dateVal) => {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatTranscriptDateLabel = (dateKey) => {
    if (!dateKey) return 'Unknown Date';
    const parts = dateKey.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return dateKey;
    const target = new Date(parts[0], parts[1] - 1, parts[2]);

    const now = new Date();
    const todayKey = getSessionDateKey(now);

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayKey = getSessionDateKey(yesterday);

    const dateFormatted = target.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    if (dateKey === todayKey) return `Today (${dateFormatted})`;
    if (dateKey === yesterdayKey) return `Yesterday (${dateFormatted})`;
    return dateFormatted;
  };

  const allConclaveSessions = useMemo(() => {
    const map = new Map();
    if (conclaveData && conclaveData.id) {
      map.set(conclaveData.id, conclaveData);
    }
    (conclaveHistory || []).forEach(sess => {
      if (sess && sess.id && !map.has(sess.id)) {
        map.set(sess.id, sess);
      }
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.convenedAt || 0) - new Date(a.convenedAt || 0));
  }, [conclaveData, conclaveHistory]);

  const groupedSessionsByDate = useMemo(() => {
    const groups = {};
    allConclaveSessions.forEach(session => {
      const dKey = getSessionDateKey(session.convenedAt) || 'Other';
      if (!groups[dKey]) {
        groups[dKey] = [];
      }
      groups[dKey].push(session);
    });
    return groups;
  }, [allConclaveSessions]);

  const availableDateKeys = useMemo(() => {
    return Object.keys(groupedSessionsByDate).sort((a, b) => b.localeCompare(a));
  }, [groupedSessionsByDate]);

  const todayKey = getSessionDateKey(new Date());
  const yesterdayObj = new Date();
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterdayKey = getSessionDateKey(yesterdayObj);

  const displayedDateGroups = useMemo(() => {
    const q = transcriptSearchQuery.trim().toLowerCase();
    const targetDates = transcriptSelectedDate === 'ALL'
      ? availableDateKeys
      : availableDateKeys.filter(k => k === transcriptSelectedDate);

    const result = [];

    for (const dateKey of targetDates) {
      const sessionsForDate = groupedSessionsByDate[dateKey] || [];
      const filteredSessions = [];

      for (const sess of sessionsForDate) {
        let matchingThreads = (sess.threads || []).map(thread => {
          if (!q) return thread;
          const topicMatches = (thread.topic || '').toLowerCase().includes(q);
          const domainMatches = (thread.domain || '').toLowerCase().includes(q);
          const matchingMessages = (thread.messages || []).filter(m => {
            return (m.speaker || '').toLowerCase().includes(q) ||
                   (m.role || '').toLowerCase().includes(q) ||
                   (m.statement || '').toLowerCase().includes(q) ||
                   (m.directiveRef || '').toLowerCase().includes(q);
          });

          if (topicMatches || domainMatches) {
            return thread;
          } else if (matchingMessages.length > 0) {
            return { ...thread, messages: matchingMessages };
          }
          return null;
        }).filter(Boolean);

        let matchingMinutes = (sess.minutes || []).filter(m => {
          if (!q) return true;
          return (m.speaker || '').toLowerCase().includes(q) ||
                 (m.statement || '').toLowerCase().includes(q) ||
                 (m.topic || '').toLowerCase().includes(q) ||
                 (m.role || '').toLowerCase().includes(q);
        });

        if (!q || matchingThreads.length > 0 || matchingMinutes.length > 0) {
          filteredSessions.push({
            ...sess,
            threads: matchingThreads,
            minutes: matchingMinutes
          });
        }
      }

      if (filteredSessions.length > 0) {
        result.push({
          dateKey,
          label: formatTranscriptDateLabel(dateKey),
          sessions: filteredSessions
        });
      }
    }

    return result;
  }, [availableDateKeys, groupedSessionsByDate, transcriptSelectedDate, transcriptSearchQuery]);

  const totalDeliberationCount = useMemo(() => {
    return allConclaveSessions.reduce((acc, s) => {
      const threadMsgCount = (s.threads || []).reduce((tAcc, t) => tAcc + (t.messages?.length || 0), 0);
      const minCount = s.minutes?.length || 0;
      return acc + Math.max(threadMsgCount, minCount);
    }, 0);
  }, [allConclaveSessions]);

  useEffect(() => {
    if (initialAgent) {
      if (initialAgent === 'cauldron') setActiveAgent('hephaestus');
      else if (initialAgent === 'conclave' || initialAgent === 'council') setActiveAgent('conclave');
      else if (initialAgent === 'memory') {
        setActiveAgent('apollo');
        setApolloTab('memories');
      } else {
        setActiveAgent(initialAgent);
      }
    }
  }, [initialAgent]);

  useEffect(() => {
    loadAgentData(activeAgent);
  }, [activeAgent]);

  const showFeedback = (msg, type = 'success') => {
    setActionFeedback({ msg, type });
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const loadAgentData = async (agent) => {
    try {
      if (agent === 'apollo') {
        if (window.electronAPI?.storeGet) {
          const d = await window.electronAPI.storeGet();
          const mems = d?.memories || [];
          setMemoriesList(mems);
          setApolloStats({ memoriesCount: mems.length, lastVaultSync: d?.lastVaultSyncAt || 'Never' });
        }
        if (window.electronAPI?.getSkillsDashboard) {
          const s = await window.electronAPI.getSkillsDashboard();
          setSkillsData(s);
        } else {
          try {
            const res = await apiFetch(`/api/skills-dashboard`);
            if (res.ok) setSkillsData(await res.json());
          } catch {}
        }
      } else if (agent === 'minerva') {
        if (window.electronAPI?.minervaHealthScan) {
          const rep = await window.electronAPI.minervaHealthScan();
          setHealthReport(rep);
        } else {
          const res = await apiFetch(`/api/minerva/health`);
          if (res.ok) setHealthReport(await res.json());
        }
        // Load HA state if available
        if (window.electronAPI?.getHAStates) {
          const raw = await window.electronAPI.getHAStates();
          if (raw) categorizeHA(raw);
        }
      } else if (agent === 'hermes') {
        if (window.electronAPI?.storeGet) {
          const d = await window.electronAPI.storeGet();
          setReminders(d?.reminders || []);
          setWorkouts(d?.workouts || []);
        }
        // Scheduled workouts from Google Calendar (via Home Assistant),
        // keyword-matched — a separate, ahead-of-time view alongside the
        // logged history below, not folded into the streak (a calendar
        // block is planned, not done).
        fetchGoogleCalendarEvents(14)
          .then((events) => setCalendarWorkouts(filterWorkoutCalendarEvents(events)))
          .catch(() => setCalendarWorkouts([]));
        if (window.electronAPI?.hermesBudgetHealth) {
          setBudgetHealth(await window.electronAPI.hermesBudgetHealth());
        }
        if (window.electronAPI?.getPortfolioSnapshot) {
          setPortfolioSnapshot(await window.electronAPI.getPortfolioSnapshot());
        }
        if (window.electronAPI?.hermesDailyBrief) {
          window.electronAPI.hermesDailyBrief({ userName: 'User' }).then((b) => {
            if (b) setDailyBrief(b);
          }).catch(() => {});
        }
        loadJobRadar();
      } else if (agent === 'conclave') {
        if (window.electronAPI?.conclaveLatest) {
          const l = await window.electronAPI.conclaveLatest();
          if (l) setConclaveData(l);
          if (window.electronAPI?.conclaveHistory) {
            const h = await window.electronAPI.conclaveHistory();
            if (h) setConclaveHistory(h);
          }
        } else {
          try {
            const res = await apiFetch(`/api/conclave/latest`);
            if (res.ok) {
              const data = await res.json();
              setConclaveData(data.conclave);
            }
            const hRes = await apiFetch(`/api/conclave/history`);
            if (hRes.ok) {
              const hData = await hRes.json();
              setConclaveHistory(hData.history || []);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[SubAgentsHub] Error loading agent data:', err.message);
    }
  };

  const handleConveneConclave = async () => {
    setIsConvening(true);
    try {
      let res;
      if (window.electronAPI?.conveneConclave) {
        res = await window.electronAPI.conveneConclave({ manualTrigger: true });
      } else {
        const r = await apiFetch(`/api/conclave/convene`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manualTrigger: true })
        });
        const json = await r.json();
        res = json.conclave;
      }
      setConclaveData(res);
      showFeedback(`Weekly Strategic Conclave completed! ${res?.directives?.length || 0} directives dispatched.`);
      if (window.electronAPI?.conclaveHistory) {
        const h = await window.electronAPI.conclaveHistory();
        if (h) setConclaveHistory(h);
      } else {
        try {
          const hRes = await apiFetch(`/api/conclave/history`);
          if (hRes.ok) {
            const hData = await hRes.json();
            setConclaveHistory(hData.history || []);
          }
        } catch {}
      }
    } catch (err) {
      showFeedback(`Failed to convene conclave: ${err.message}`, 'error');
    } finally {
      setIsConvening(false);
    }
  };

  const categorizeHA = (entities) => {
    const lights = [];
    const locks = [];
    const climate = [];
    (Array.isArray(entities) ? entities : []).forEach((e) => {
      if (e.entity_id.startsWith('light.')) lights.push(e);
      else if (e.entity_id.startsWith('lock.')) locks.push(e);
      else if (e.entity_id.startsWith('climate.')) climate.push(e);
    });
    setHaCategories({ lights, locks, climate });
  };

  // Apollo Actions
  const handleGardenMemories = async () => {
    setLoading(true);
    try {
      let res;
      if (window.electronAPI?.apolloGardenMemories) {
        res = await window.electronAPI.apolloGardenMemories();
      } else {
        const r = await apiFetch(`/api/apollo/garden-memories`, { method: 'POST' });
        res = await r.json();
      }
      showFeedback(`Apollo cleaned memories: ${res.finalCount} unique facts retained (pruned ${res.prunedCount} duplicates).`);
      setMemoriesList(res.memories || []);
      setApolloStats(prev => ({ ...prev, memoriesCount: res.finalCount }));
    } catch (err) {
      showFeedback(`Gardening failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncVault = async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.apolloSyncVault) {
        await window.electronAPI.apolloSyncVault();
      } else {
        await apiFetch(`/api/apollo/sync-vault`, { method: 'POST' });
      }
      showFeedback('Obsidian Vault successfully synchronized with Aloy Brain!');
    } catch (err) {
      showFeedback(`Vault sync failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMemory = async (e) => {
    e.preventDefault();
    if (!newMemoryFact.trim()) return;
    try {
      const updated = [newMemoryFact.trim(), ...memoriesList];
      setMemoriesList(updated);
      if (window.electronAPI?.storeSave) {
        await window.electronAPI.storeSave('memories', updated);
      }
      setNewMemoryFact('');
      showFeedback('Memory fact added to Apollo Knowledge Bank.');
    } catch (err) {
      showFeedback(`Failed to save memory: ${err.message}`, 'error');
    }
  };

  const handleDeleteMemory = async (idx) => {
    try {
      const updated = memoriesList.filter((_, i) => i !== idx);
      setMemoriesList(updated);
      if (window.electronAPI?.storeSave) {
        await window.electronAPI.storeSave('memories', updated);
      }
      showFeedback('Memory fact removed.');
    } catch (err) {
      showFeedback(`Failed to delete memory: ${err.message}`, 'error');
    }
  };

  const handleRunAutoTeaching = async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.runNightlyAutoTeaching) {
        const res = await window.electronAPI.runNightlyAutoTeaching();
        showFeedback(`Auto-teaching completed: ${res?.newlyLearnedCount || 0} facts confirmed into memory`);
      } else {
        const res = await apiFetch(`/api/skills/auto-teach`, { method: 'POST' });
        if (res.ok) showFeedback('Auto-teaching pass completed successfully');
      }
      if (window.electronAPI?.getSkillsDashboard) {
        setSkillsData(await window.electronAPI.getSkillsDashboard());
      }
    } catch (err) {
      showFeedback(`Auto-teaching error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleIngestDocument = async (e) => {
    e.preventDefault();
    if (!docTitle.trim() || !docContent.trim()) return;
    setLoading(true);
    try {
      let task;
      if (window.electronAPI?.apolloCreateTask) {
        task = await window.electronAPI.apolloCreateTask({
          title: docTitle,
          rawContent: docContent,
          category: docCategory
        });
      } else {
        const r = await apiFetch(`/api/apollo/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: docTitle, rawContent: docContent, category: docCategory })
        });
        task = await r.json();
      }
      showFeedback(`Apollo ingested "${docTitle}". Entities indexed to Knowledge Bank.`);
      setDocTitle('');
      setDocContent('');
      loadAgentData('apollo');
    } catch (err) {
      showFeedback(`Ingestion failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      const updated = {
        name: profileName,
        style: profileStyle,
        instructions: profileInstructions,
        checkInsEnabled: profileCheckIns
      };
      if (profileProps?.onSaveProfile) {
        profileProps.onSaveProfile(updated);
      } else if (window.electronAPI?.storeSave) {
        await window.electronAPI.storeSave('userProfile', updated);
      }
      showFeedback('User profile and Aloy persona instructions saved.');
    } catch (err) {
      showFeedback(`Failed to save profile: ${err.message}`, 'error');
    }
  };

  const handleSaveLockPin = async (e) => {
    e.preventDefault();
    if (lockNewPin.length < 4) {
      showFeedback('PIN must be at least 4 digits.', 'error');
      return;
    }
    if (lockNewPin !== lockConfirmPin) {
      showFeedback('PINs do not match.', 'error');
      return;
    }
    setLockBusy(true);
    try {
      const res = profileProps?.isLockConfigured
        ? await window.electronAPI?.changeLockPin(lockCurrentPin, lockNewPin)
        : await window.electronAPI?.setupLockPin(lockNewPin);
      if (res?.success) {
        profileProps?.onLockConfiguredChange?.(true);
        showFeedback(profileProps?.isLockConfigured ? 'PIN changed.' : 'App lock enabled.');
        setLockCurrentPin('');
        setLockNewPin('');
        setLockConfirmPin('');
      } else {
        showFeedback(res?.error || 'Failed to save PIN.', 'error');
      }
    } catch (err) {
      showFeedback(`Error: ${err.message}`, 'error');
    } finally {
      setLockBusy(false);
    }
  };

  const handleRemoveLockPin = async () => {
    if (!window.confirm('Remove app lock? Anyone with access to this computer can open Aloy.')) return;
    setLockBusy(true);
    try {
      const res = await window.electronAPI?.removeLockPin(lockCurrentPin);
      if (res?.success) {
        profileProps?.onLockConfiguredChange?.(false);
        setLockCurrentPin('');
        showFeedback('App lock removed.');
      } else {
        showFeedback(res?.error || 'Incorrect current PIN.', 'error');
      }
    } catch (err) {
      showFeedback(`Error: ${err.message}`, 'error');
    } finally {
      setLockBusy(false);
    }
  };

  // Minerva Actions
  const handleRunHealthScan = async () => {
    setLoading(true);
    try {
      let rep;
      if (window.electronAPI?.minervaHealthScan) {
        rep = await window.electronAPI.minervaHealthScan();
      } else {
        const r = await apiFetch(`/api/minerva/health`);
        rep = await r.json();
      }
      setHealthReport(rep);
      showFeedback(`Scan complete: Status is ${rep.status.toUpperCase()} (${rep.offlineCount || 0} offline)`);
    } catch (err) {
      showFeedback(`Scan failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRestartService = async (serviceName) => {
    setLoading(true);
    try {
      if (window.electronAPI?.restartSidecar) {
        await window.electronAPI.restartSidecar(serviceName);
      } else {
        await apiFetch(`/api/minerva/restart-service`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service: serviceName })
        });
      }
      showFeedback(`Restart triggered for ${serviceName}`);
      setTimeout(handleRunHealthScan, 2000);
    } catch (err) {
      showFeedback(`Failed to restart ${serviceName}: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelfHeal = async (serviceName = null) => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/minerva/self-heal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName, force: true })
      });
      const result = await r.json();
      showFeedback(result.actionsTaken?.join('; ') || 'Self-healing triggered!');
      setTimeout(handleRunHealthScan, 1500);
    } catch (err) {
      showFeedback(`Self-healing failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendAlert = async (e) => {
    e.preventDefault();
    if (!alertMessage.trim()) return;
    setLoading(true);
    try {
      let res;
      if (window.electronAPI?.minervaDispatchAlert) {
        res = await window.electronAPI.minervaDispatchAlert({ title: 'Minerva Manual Alert', message: alertMessage, severity: 'warning' });
      } else {
        const r = await apiFetch(`/api/minerva/alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Minerva Manual Alert', message: alertMessage, severity: 'warning' })
        });
        res = await r.json();
      }
      showFeedback(res.forwarded ? 'Alert dispatched to webhook!' : 'Alert recorded in audit log.');
      setAlertMessage('');
    } catch (err) {
      showFeedback(`Alert dispatch failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLight = async (entityId, currentState) => {
    const service = currentState === 'on' ? 'turn_off' : 'turn_on';
    try {
      if (onExecuteHAService) {
        await onExecuteHAService('light', service, entityId);
      } else if (window.electronAPI?.callHAService) {
        await window.electronAPI.callHAService('light', service, { entity_id: entityId });
      }
      showFeedback(`Light ${service === 'turn_on' ? 'turned on' : 'turned off'}`);
      loadAgentData('minerva');
    } catch (err) {
      showFeedback(`HA Command failed: ${err.message}`, 'error');
    }
  };

  // Hermes Actions
  useEffect(() => {
    if (activeAgent === 'minerva' && !healthReport) {
      handleRunHealthScan();
    }
  }, [activeAgent]);

  const handleGenerateBrief = async () => {
    setLoading(true);
    try {
      let brief;
      if (window.electronAPI?.hermesDailyBrief) {
        brief = await window.electronAPI.hermesDailyBrief({ userName: 'User' });
      } else {
        const r = await apiFetch(`/api/hermes/daily-brief?userName=User`);
        brief = await r.json();
      }
      setDailyBrief(brief);
      showFeedback('Morning Operations Briefing synthesized!');
    } catch (err) {
      showFeedback(`Briefing failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMorningDigest = async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/hermes/morning-digest?userName=User`);
      const digest = await r.json();
      setDailyBrief({
        ...digest,
        sections: {
          ...digest.metrics,
          overview: digest.summaryMarkdown
        }
      });
      showFeedback('Morning Intelligence Digest generated!');
    } catch (err) {
      showFeedback(`Digest failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddReminder = async (e) => {
    e.preventDefault();
    if (!newReminderText.trim()) return;
    try {
      const updated = [...reminders, { id: `rem-${Date.now()}`, text: newReminderText.trim(), completed: false, createdAt: new Date().toISOString() }];
      setReminders(updated);
      if (window.electronAPI?.storeSave) {
        await window.electronAPI.storeSave('reminders', updated);
      }
      setNewReminderText('');
      showFeedback('Reminder saved to Hermes operations ledger.');
    } catch (err) {
      showFeedback(`Failed to add reminder: ${err.message}`, 'error');
    }
  };

  const handleSaveShares = async (symbol) => {
    const raw = shareInputs[symbol];
    if (raw === undefined) return;
    try {
      setSavingShares(symbol);
      await window.electronAPI?.setPortfolioShares?.(symbol, raw === '' ? null : Number(raw));
      setPortfolioSnapshot(await window.electronAPI?.getPortfolioSnapshot?.());
      setShareInputs((prev) => {
        const next = { ...prev };
        delete next[symbol];
        return next;
      });
      showFeedback(`Updated ${symbol} share count.`);
    } catch (err) {
      showFeedback(`Failed to update ${symbol} shares: ${err.message}`, 'error');
    } finally {
      setSavingShares(null);
    }
  };

  const handleToggleReminder = async (id) => {
    try {
      const updated = reminders.map(r => r.id === id ? { ...r, completed: !r.completed } : r);
      setReminders(updated);
      if (window.electronAPI?.storeSave) {
        await window.electronAPI.storeSave('reminders', updated);
      }
    } catch (err) {
      console.warn('Failed to toggle reminder:', err.message);
    }
  };

  const handleAddWorkout = async (e) => {
    e.preventDefault();
    if (!newExerciseName.trim()) return;
    try {
      const entry = {
        id: `workout-${Date.now()}`,
        date: new Date().toISOString(),
        exercises: [{
          name: newExerciseName.trim(),
          sets: newExerciseSets ? Number(newExerciseSets) : null,
          reps: newExerciseReps ? Number(newExerciseReps) : null,
          weight: newExerciseWeight ? Number(newExerciseWeight) : null
        }],
        notes: ''
      };
      const updated = [...workouts, entry];
      setWorkouts(updated);
      if (window.electronAPI?.storeSave) {
        await window.electronAPI.storeSave('workouts', updated);
      }
      setNewExerciseName('');
      setNewExerciseSets('');
      setNewExerciseReps('');
      setNewExerciseWeight('');
      showFeedback('Workout logged.');
    } catch (err) {
      showFeedback(`Failed to log workout: ${err.message}`, 'error');
    }
  };

  const handleDeleteWorkout = async (id) => {
    try {
      const updated = workouts.filter(w => w.id !== id);
      setWorkouts(updated);
      if (window.electronAPI?.storeSave) {
        await window.electronAPI.storeSave('workouts', updated);
      }
    } catch (err) {
      console.warn('Failed to delete workout:', err.message);
    }
  };

  const loadJobRadar = async () => {
    try {
      if (window.electronAPI?.jobsGetListings) {
        const res = await window.electronAPI.jobsGetListings({});
        if (res?.listings) setJobListings(res.listings);
        if (res?.queries) setJobRadarConfig(prev => ({ ...(prev || {}), queries: res.queries }));
      } else {
        const r = await apiFetch(`/api/jobs/listings`);
        const res = await r.json();
        if (res?.listings) setJobListings(res.listings);
      }
      if (window.electronAPI?.jobsGetConfig) {
        const cfg = await window.electronAPI.jobsGetConfig();
        if (cfg) setJobRadarConfig(cfg);
      }
    } catch (err) {
      console.warn('Failed to load Job Radar:', err);
    }
  };

  const handleScanLinkedInJobs = async () => {
    setIsScanningJobs(true);
    try {
      let res;
      if (window.electronAPI?.jobsScan) {
        res = await window.electronAPI.jobsScan({});
      } else {
        const r = await apiFetch(`/api/jobs/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        res = await r.json();
      }
      showFeedback(`LinkedIn scan complete: ${res?.newJobsCount ?? 0} new postings detected!`);
      await loadJobRadar();
    } catch (err) {
      showFeedback(`LinkedIn scan failed: ${err.message}`, 'error');
    } finally {
      setIsScanningJobs(false);
    }
  };

  const handleUpdateJobStatus = async (id, status) => {
    try {
      if (window.electronAPI?.jobsUpdateStatus) {
        await window.electronAPI.jobsUpdateStatus(id, status);
      } else {
        await apiFetch(`/api/jobs/${id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
      }
      setJobListings(prev => prev.map(j => (j.id === id || j.jobId === id) ? { ...j, status } : j));
      showFeedback(`Job listing updated to "${status}".`);
    } catch (err) {
      showFeedback(`Failed to update job status: ${err.message}`, 'error');
    }
  };

  const AGENTS = [
    { id: 'conclave', name: 'Pantheon Council', role: 'Weekly Strategic Conclave & Self-Evolution', icon: Landmark, color: '#a855f7', tag: 'COUNCIL' },
    { id: 'hephaestus', name: 'Hephaestus', role: 'Code Forge & Monitored Projects', icon: Flame, color: '#f59e0b', tag: 'HEPH' },
    { id: 'athena', name: 'Athena', role: 'Deep Intelligence Scout', icon: Sparkles, color: '#38bdf8', tag: 'SCOUT' },
    { id: 'apollo', name: 'Apollo', role: 'Memory, Skills & User Profile Gardener', icon: BookOpen, color: '#f59e0b', tag: 'VAULT' },
    { id: 'minerva', name: 'Minerva', role: 'Sentinel & System Reliability', icon: Shield, color: '#10b981', tag: 'SENTINEL' },
    { id: 'hermes', name: 'Hermes', role: 'Operations & Daily Briefings', icon: Briefcase, color: '#8b5cf6', tag: 'BRIEF' }
  ];

  const currentAgentMeta = AGENTS.find(a => a.id === activeAgent) || AGENTS[2];
  const CurrentAgentIcon = currentAgentMeta.icon;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#090d16',
      color: '#f8fafc',
      overflow: 'hidden'
    }}>
      {/* Top Standardized PageHeader */}
      <PageHeader
        icon={CurrentAgentIcon}
        title={currentAgentMeta.name.toUpperCase()}
        subtitle={currentAgentMeta.role}
        accentColor={currentAgentMeta.color}
        statusBadge={currentAgentMeta.tag}
        onClose={onClose}
        actions={
          activeAgent === 'conclave' ? [
            {
              label: isConvening ? 'Council Deliberating...' : 'Convene Council',
              icon: RefreshCw,
              onClick: handleConveneConclave,
              loading: isConvening,
              variant: 'primary'
            }
          ] : activeAgent === 'apollo' ? [
            {
              label: 'Garden Facts',
              icon: RefreshCw,
              onClick: handleGardenMemories,
              loading: loading,
              variant: 'secondary'
            }
          ] : activeAgent === 'minerva' ? [
            {
              label: loading ? 'Scanning...' : 'Run Health Scan',
              icon: RefreshCw,
              onClick: handleRunHealthScan,
              loading: loading,
              variant: 'primary'
            },
            {
              label: 'Self-Heal Stack',
              icon: RotateCcw,
              onClick: () => handleSelfHeal(),
              loading: loading,
              variant: 'secondary'
            }
          ] : activeAgent === 'hermes' ? [
            {
              label: loading ? 'Synthesizing...' : 'Synthesize Briefing',
              icon: Sparkles,
              onClick: handleGenerateBrief,
              loading: loading,
              variant: 'primary'
            },
            {
              label: 'Morning Intelligence',
              icon: Activity,
              onClick: handleGenerateMorningDigest,
              loading: loading,
              variant: 'secondary'
            }
          ] : []
        }
      />

      {/* Action feedback banner */}
      <AnimatePresence>
        {actionFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              margin: '0.5rem 1.5rem 0',
              padding: '0.5rem 0.9rem',
              borderRadius: '8px',
              background: actionFeedback.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              border: `1px solid ${actionFeedback.type === 'error' ? '#ef4444' : '#10b981'}`,
              color: actionFeedback.type === 'error' ? '#fca5a5' : '#86efac',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            {actionFeedback.type === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            {actionFeedback.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Viewport */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
        {/* ========================================================= */}
        {/* 0. PANTHEON STRATEGIC COUNCIL (CONCLAVE) VIEW             */}
        {/* ========================================================= */}
        {activeAgent === 'conclave' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1150px', margin: '0 auto' }}>
            {/* Conclave KPI Pulse Grid */}
            <PulseGrid
              metrics={[
                { label: 'Strategic Directives', value: conclaveData?.directives?.length || 0, subtext: 'Active mandates', color: '#a855f7', icon: Target },
                { label: 'Archived Conclaves', value: conclaveHistory.length, subtext: 'Total sessions', color: '#38bdf8', icon: Calendar },
                { label: 'Sub-Agent Reports', value: conclaveData?.reports ? Object.keys(conclaveData.reports).length : 5, subtext: 'Telemetry debriefs', color: '#10b981', icon: Shield },
                { label: 'Council ISO Week', value: conclaveData ? `W${conclaveData.isoWeek}` : 'W35', subtext: conclaveData ? `${conclaveData.year} Deliberation` : 'Standing By', color: '#f59e0b', icon: Clock }
              ]}
            />

            {/* Standardized TabBar */}
            <TabBar
              tabs={[
                { id: 'telemetry', label: 'Sub-Agent Debriefs', icon: BarChart3 },
                { id: 'minutes', label: 'Deliberation Transcripts', count: totalDeliberationCount, icon: ScrollText },
                { id: 'directives', label: 'Strategic Directives', count: conclaveData?.directives?.length || 0, icon: Target },
                { id: 'dossier', label: 'Executive Dossier', icon: FileText },
                { id: 'history', label: 'History Archive', count: conclaveHistory.length, icon: Calendar }
              ]}
              activeTab={conclaveTab}
              onSelectTab={setConclaveTab}
              accentColor="#a855f7"
            />

            {/* TAB 1: Sub-Agent Telemetry & Debriefs */}
            {conclaveTab === 'telemetry' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
                {/* 1. Minerva Card */}
                <div
                  onClick={() => setActiveAgent('minerva')}
                  style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.25)', cursor: 'pointer', transition: 'all 0.15s ease' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#10b981'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.25)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Shield size={16} color="#10b981" />
                      <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.9rem' }}>Minerva (Sentinel)</span>
                    </div>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>
                      {conclaveData?.reports?.minerva?.status || 'HEALTHY'}
                    </span>
                  </div>
                  <div style={{ margin: '0.6rem 0', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                    {conclaveData?.reports?.minerva?.summary || 'All background sidecars and Home Assistant endpoints operating nominally.'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#10b981', fontWeight: 700 }}>
                    <span>Health Score: {conclaveData?.reports?.minerva?.healthScore ?? 100}%</span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Open Sentinel →</span>
                  </div>
                </div>

                {/* 2. Apollo Card */}
                <div
                  onClick={() => setActiveAgent('apollo')}
                  style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.25)', cursor: 'pointer', transition: 'all 0.15s ease' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#f59e0b'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.25)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <BookOpen size={16} color="#f59e0b" />
                      <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.9rem' }}>Apollo (Vault)</span>
                    </div>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
                      {conclaveData?.reports?.apollo?.status || 'STRONG'}
                    </span>
                  </div>
                  <div style={{ margin: '0.6rem 0', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                    {conclaveData?.reports?.apollo?.summary || 'Vault contains persistent facts. Skill proficiency stable across primary domains.'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700 }}>
                    <span>Proficiency: {conclaveData?.reports?.apollo?.overallProficiency ?? 100}% | Facts: {conclaveData?.reports?.apollo?.factsCount ?? memoriesList.length}</span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Open Vault →</span>
                  </div>
                </div>

                {/* 3. Hephaestus Card */}
                <div
                  onClick={() => setActiveAgent('hephaestus')}
                  style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.25)', cursor: 'pointer', transition: 'all 0.15s ease' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#f59e0b'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.25)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Flame size={16} color="#f59e0b" />
                      <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.9rem' }}>Hephaestus (Forge)</span>
                    </div>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
                      {conclaveData?.reports?.hephaestus?.status || 'READY'}
                    </span>
                  </div>
                  <div style={{ margin: '0.6rem 0', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                    {conclaveData?.reports?.hephaestus?.summary || 'Forge sandbox idle and ready for work orders.'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700 }}>
                    <span>Active Work Orders: {conclaveData?.reports?.hephaestus?.activeOrders ?? 0} | Deployed: {conclaveData?.reports?.hephaestus?.deployedPatches ?? 0}</span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Open Forge →</span>
                  </div>
                </div>

                {/* 4. Athena Card */}
                <div
                  onClick={() => setActiveAgent('athena')}
                  style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.25)', cursor: 'pointer', transition: 'all 0.15s ease' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#38bdf8'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.25)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Sparkles size={16} color="#38bdf8" />
                      <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.9rem' }}>Athena (Scout)</span>
                    </div>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>
                      {conclaveData?.reports?.athena?.status || 'SCOUTING'}
                    </span>
                  </div>
                  <div style={{ margin: '0.6rem 0', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                    {conclaveData?.reports?.athena?.summary || 'Research scout standing by for emerging model & tooling investigation.'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#38bdf8', fontWeight: 700 }}>
                    <span>Completed Dossiers: {conclaveData?.reports?.athena?.completedDossiers ?? 0}</span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Open Scout →</span>
                  </div>
                </div>

                {/* 5. Hermes Card */}
                <div
                  onClick={() => setActiveAgent('hermes')}
                  style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.25)', cursor: 'pointer', transition: 'all 0.15s ease' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#8b5cf6'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Briefcase size={16} color="#8b5cf6" />
                      <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.9rem' }}>Hermes (Operations)</span>
                    </div>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: 'rgba(139, 92, 246, 0.2)', color: '#8b5cf6' }}>
                      {conclaveData?.reports?.hermes?.status || 'NOMINAL'}
                    </span>
                  </div>
                  <div style={{ margin: '0.6rem 0', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                    {conclaveData?.reports?.hermes?.summary || 'Operations and daily pulse active.'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#8b5cf6', fontWeight: 700 }}>
                    <span>Pending Reminders: {conclaveData?.reports?.hermes?.pendingReminders ?? (reminders ? reminders.length : 0)}</span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Open Operations →</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Deliberation Transcripts & Threaded Minutes Organized by Date */}
            {conclaveTab === 'minutes' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Date Navigation & Search Controls Toolbar */}
                <div style={{
                  padding: '1.1rem 1.25rem',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Calendar size={18} color="#c084fc" />
                      <div>
                        <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#f8fafc' }}>
                          Deliberation Transcripts by Date
                        </span>
                        <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                          Select any date or browse all historical council sessions organized chronologically.
                        </div>
                      </div>
                    </div>

                    {/* Search statements/speakers */}
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', minWidth: '260px', flex: 1, maxWidth: '400px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        padding: '0.35rem 0.65rem',
                        width: '100%'
                      }}>
                        <Search size={14} color="#94a3b8" />
                        <input
                          type="text"
                          placeholder="Search statements, topics, speakers..."
                          value={transcriptSearchQuery}
                          onChange={(e) => setTranscriptSearchQuery(e.target.value)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#fff',
                            fontSize: '0.8rem',
                            outline: 'none',
                            width: '100%'
                          }}
                        />
                        {transcriptSearchQuery && (
                          <button
                            onClick={() => setTranscriptSearchQuery('')}
                            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.75rem', padding: '0 2px' }}
                            title="Clear search"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Date Quick Filter Pills & Calendar Date Picker */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Date:
                    </span>

                    {/* All Dates Pill */}
                    <button
                      onClick={() => setTranscriptSelectedDate('ALL')}
                      style={{
                        padding: '0.3rem 0.65rem',
                        borderRadius: '6px',
                        background: transcriptSelectedDate === 'ALL' ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                        border: transcriptSelectedDate === 'ALL' ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                        color: transcriptSelectedDate === 'ALL' ? '#f3e8ff' : '#cbd5e1',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>All Dates</span>
                      <span style={{
                        fontSize: '0.62rem',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: transcriptSelectedDate === 'ALL' ? '#a855f7' : 'rgba(255, 255, 255, 0.1)',
                        color: '#ffffff'
                      }}>
                        {availableDateKeys.length}
                      </span>
                    </button>

                    {/* Today Pill */}
                    {availableDateKeys.includes(todayKey) && (
                      <button
                        onClick={() => setTranscriptSelectedDate(todayKey)}
                        style={{
                          padding: '0.3rem 0.65rem',
                          borderRadius: '6px',
                          background: transcriptSelectedDate === todayKey ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                          border: transcriptSelectedDate === todayKey ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                          color: transcriptSelectedDate === todayKey ? '#f3e8ff' : '#cbd5e1',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem'
                        }}
                      >
                        <span>Today</span>
                        <span style={{ fontSize: '0.62rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399' }}>
                          {groupedSessionsByDate[todayKey]?.length || 0}
                        </span>
                      </button>
                    )}

                    {/* Yesterday Pill */}
                    {availableDateKeys.includes(yesterdayKey) && (
                      <button
                        onClick={() => setTranscriptSelectedDate(yesterdayKey)}
                        style={{
                          padding: '0.3rem 0.65rem',
                          borderRadius: '6px',
                          background: transcriptSelectedDate === yesterdayKey ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                          border: transcriptSelectedDate === yesterdayKey ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                          color: transcriptSelectedDate === yesterdayKey ? '#f3e8ff' : '#cbd5e1',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem'
                        }}
                      >
                        <span>Yesterday</span>
                        <span style={{ fontSize: '0.62rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>
                          {groupedSessionsByDate[yesterdayKey]?.length || 0}
                        </span>
                      </button>
                    )}

                    {/* Other Recorded Dates Pills */}
                    {availableDateKeys
                      .filter(k => k !== todayKey && k !== yesterdayKey)
                      .slice(0, 4)
                      .map(dKey => (
                        <button
                          key={dKey}
                          onClick={() => setTranscriptSelectedDate(dKey)}
                          style={{
                            padding: '0.3rem 0.65rem',
                            borderRadius: '6px',
                            background: transcriptSelectedDate === dKey ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                            border: transcriptSelectedDate === dKey ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                            color: transcriptSelectedDate === dKey ? '#f3e8ff' : '#cbd5e1',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          {formatTranscriptDateLabel(dKey)}
                        </button>
                      ))}

                    {/* Custom Calendar Date Input */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' }}>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Pick Date:</span>
                      <input
                        type="date"
                        value={transcriptSelectedDate === 'ALL' ? '' : transcriptSelectedDate}
                        onChange={(e) => setTranscriptSelectedDate(e.target.value || 'ALL')}
                        style={{
                          background: 'rgba(0, 0, 0, 0.4)',
                          border: '1px solid rgba(168, 85, 247, 0.4)',
                          borderRadius: '6px',
                          color: '#f8fafc',
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.76rem',
                          cursor: 'pointer',
                          outline: 'none'
                        }}
                      />
                      {(transcriptSelectedDate !== 'ALL' || transcriptSearchQuery) && (
                        <button
                          onClick={() => {
                            setTranscriptSelectedDate('ALL');
                            setTranscriptSearchQuery('');
                          }}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#94a3b8',
                            borderRadius: '6px',
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.72rem',
                            cursor: 'pointer'
                          }}
                          title="Reset filter to all dates"
                        >
                          Reset Filter
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Summary Bar */}
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.5rem' }}>
                    <span>
                      {transcriptSelectedDate === 'ALL'
                        ? `Showing all deliberation transcripts organized across ${displayedDateGroups.length} date${displayedDateGroups.length === 1 ? '' : 's'}`
                        : `Showing deliberation transcripts for ${formatTranscriptDateLabel(transcriptSelectedDate)}`}
                      {transcriptSearchQuery ? ` (Filtered by query "${transcriptSearchQuery}")` : ''}
                    </span>
                    <span style={{ color: '#c084fc', fontWeight: 700 }}>
                      {displayedDateGroups.reduce((acc, g) => acc + g.sessions.reduce((sAcc, s) => sAcc + (s.threads?.length || 1), 0), 0)} thread(s) displayed
                    </span>
                  </div>
                </div>

                {/* Transcripts Grouped by Date */}
                {displayedDateGroups.length > 0 ? (
                  displayedDateGroups.map((dateGroup) => (
                    <div
                      key={dateGroup.dateKey}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.85rem',
                        background: 'rgba(255, 255, 255, 0.015)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '16px',
                        padding: '1.25rem'
                      }}
                    >
                      {/* Date Header */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                        paddingBottom: '0.75rem',
                        flexWrap: 'wrap',
                        gap: '0.5rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div style={{
                            padding: '6px',
                            borderRadius: '8px',
                            background: 'rgba(168, 85, 247, 0.2)',
                            color: '#c084fc'
                          }}>
                            <Calendar size={18} />
                          </div>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc' }}>
                              {dateGroup.label}
                            </h3>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                              {dateGroup.sessions.length} session{dateGroup.sessions.length > 1 ? 's' : ''} recorded · {dateGroup.sessions.reduce((acc, s) => acc + (s.threads?.length || 1), 0)} deliberation thread{dateGroup.sessions.reduce((acc, s) => acc + (s.threads?.length || 1), 0) === 1 ? '' : 's'}
                            </div>
                          </div>
                        </div>

                        {transcriptSelectedDate === 'ALL' && (
                          <button
                            onClick={() => setTranscriptSelectedDate(dateGroup.dateKey)}
                            style={{
                              background: 'rgba(168, 85, 247, 0.15)',
                              border: '1px solid rgba(168, 85, 247, 0.3)',
                              color: '#d8b4fe',
                              padding: '0.3rem 0.65rem',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Focus on this date
                          </button>
                        )}
                      </div>

                      {/* Sessions within this Date */}
                      {dateGroup.sessions.map((sess, sIdx) => {
                        const isCurrentActive = conclaveData?.id === sess.id;
                        return (
                          <div key={sess.id || sIdx} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: sIdx > 0 ? '0.5rem' : '0' }}>
                            {/* Session Sub-Header */}
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.5rem 0.85rem',
                              background: 'rgba(0, 0, 0, 0.25)',
                              borderRadius: '8px',
                              border: isCurrentActive ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(255, 255, 255, 0.04)',
                              flexWrap: 'wrap',
                              gap: '0.5rem'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.76rem' }}>
                                <span style={{ fontWeight: 800, color: '#e2e8f0' }}>
                                  🏛️ Conclave (Week {sess.isoWeek}, {sess.year})
                                </span>
                                <span style={{ color: '#94a3b8' }}>•</span>
                                <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                                  🕒 {new Date(sess.convenedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span style={{ color: '#94a3b8' }}>•</span>
                                <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>
                                  ID: <code style={{ color: '#c084fc' }}>{sess.id}</code>
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {isCurrentActive ? (
                                  <span style={{
                                    fontSize: '0.65rem',
                                    fontWeight: 800,
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: 'rgba(16, 185, 129, 0.2)',
                                    color: '#34d399',
                                    border: '1px solid rgba(16, 185, 129, 0.4)'
                                  }}>
                                    ✓ Active Hub Session
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setConclaveData(sess);
                                      showFeedback(`Switched active council session to Week ${sess.isoWeek}, ${sess.year}.`);
                                    }}
                                    style={{
                                      background: 'rgba(255, 255, 255, 0.05)',
                                      border: '1px solid rgba(255, 255, 255, 0.1)',
                                      color: '#cbd5e1',
                                      padding: '0.2rem 0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.7rem',
                                      fontWeight: 600,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Load as Active Session
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Thread Cards in this Session */}
                            {sess.threads && sess.threads.length > 0 ? (
                              sess.threads.map((thread, tIdx) => (
                                <div
                                  key={thread.id || tIdx}
                                  style={{
                                    borderRadius: '12px',
                                    background: 'rgba(255, 255, 255, 0.025)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    overflow: 'hidden'
                                  }}
                                >
                                  {/* Thread Header */}
                                  <div
                                    style={{
                                      padding: '0.75rem 1.15rem',
                                      background: 'rgba(255, 255, 255, 0.035)',
                                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      flexWrap: 'wrap',
                                      gap: '0.5rem'
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                      <span style={{ fontSize: '1rem' }}>🧵</span>
                                      <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#f8fafc' }}>
                                        Thread {tIdx + 1}: {thread.topic}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '0.62rem',
                                          fontWeight: 800,
                                          padding: '2px 6px',
                                          borderRadius: '4px',
                                          background: 'rgba(168, 85, 247, 0.2)',
                                          color: '#c084fc',
                                          border: '1px solid rgba(168, 85, 247, 0.35)'
                                        }}
                                      >
                                        {thread.domain}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'monospace', fontWeight: 600 }}>
                                      ⏱️ {thread.timeStr || (thread.timestamp ? new Date(thread.timestamp).toLocaleTimeString() : '')}
                                    </div>
                                  </div>

                                  {/* Thread Messages */}
                                  <div style={{ padding: '0.9rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {thread.messages.map((m, mIdx) => {
                                      const isReply = !!m.inReplyTo;
                                      return (
                                        <div
                                          key={m.id || mIdx}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '0.75rem',
                                            paddingLeft: isReply ? '1.5rem' : '0',
                                            position: 'relative'
                                          }}
                                        >
                                          {isReply && (
                                            <div
                                              style={{
                                                position: 'absolute',
                                                left: '0.5rem',
                                                top: '0.35rem',
                                                fontSize: '0.8rem',
                                                color: '#818cf8'
                                              }}
                                            >
                                              ↳
                                            </div>
                                          )}
                                          <span style={{ fontSize: '1.3rem', marginTop: '1px' }}>{m.avatar}</span>
                                          <div
                                            style={{
                                              flex: 1,
                                              background: isReply ? 'rgba(99, 102, 241, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                                              border: isReply ? '1px solid rgba(99, 102, 241, 0.18)' : '1px solid rgba(255, 255, 255, 0.05)',
                                              borderRadius: '10px',
                                              padding: '0.75rem 1rem'
                                            }}
                                          >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f8fafc' }}>
                                                  {m.speaker}
                                                </span>
                                                {m.role && (
                                                  <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600 }}>
                                                    ({m.role})
                                                  </span>
                                                )}
                                                {isReply && (
                                                  <span style={{ fontSize: '0.62rem', color: '#a5b4fc', fontWeight: 700 }}>
                                                    · in reply
                                                  </span>
                                                )}
                                              </div>
                                              <span style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace', fontWeight: 600 }}>
                                                {m.timeStr || (m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '')}
                                              </span>
                                            </div>
                                            <div style={{ fontSize: '0.84rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                                              "{m.statement}"
                                            </div>
                                            {m.directiveRef && (
                                              <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: 700, border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                                  🎯 Dispatched Directive: {m.directiveRef}
                                                </span>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))
                            ) : (
                              // Flat Minutes Fallback
                              (sess.minutes || []).map((m, mIdx) => (
                                <div
                                  key={m.id || mIdx}
                                  style={{
                                    padding: '0.9rem 1.15rem',
                                    borderRadius: '10px',
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '0.85rem'
                                  }}
                                >
                                  <span style={{ fontSize: '1.4rem' }}>{m.avatar}</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                      <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f8fafc' }}>
                                        {m.speaker} {m.role ? `(${m.role})` : ''}
                                      </span>
                                      {m.timeStr && (
                                        <span style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace' }}>
                                          {m.timeStr}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: '0.84rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                                      "{m.statement}"
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                ) : (
                  // Empty State
                  <div style={{
                    padding: '2.5rem 1.5rem',
                    borderRadius: '14px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px dashed rgba(168, 85, 247, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    gap: '0.85rem'
                  }}>
                    <Calendar size={36} color="#a855f7" />
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                        {transcriptSearchQuery
                          ? `No Transcripts Found Matching "${transcriptSearchQuery}"`
                          : transcriptSelectedDate !== 'ALL'
                            ? `No Deliberation Transcripts for ${formatTranscriptDateLabel(transcriptSelectedDate)}`
                            : 'No Deliberation Transcripts Available'}
                      </h4>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#94a3b8', maxWidth: '460px' }}>
                        {transcriptSearchQuery
                          ? `No statements or topics matched your search "${transcriptSearchQuery}". Try clearing search or selecting a different date.`
                          : transcriptSelectedDate !== 'ALL'
                            ? 'There were no council meetings convened on this date. You can select another date or switch back to viewing all recorded transcripts.'
                            : 'Try clearing your filters or click Convene Council Now to record a fresh strategic deliberation.'}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {transcriptSelectedDate !== 'ALL' && (
                        <button
                          onClick={() => setTranscriptSelectedDate('ALL')}
                          style={{
                            background: 'rgba(168, 85, 247, 0.2)',
                            border: '1px solid #a855f7',
                            color: '#f3e8ff',
                            padding: '0.45rem 0.9rem',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          ← View All Dates ({availableDateKeys.length})
                        </button>
                      )}
                      {transcriptSearchQuery && (
                        <button
                          onClick={() => setTranscriptSearchQuery('')}
                          style={{
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            color: '#e2e8f0',
                            padding: '0.45rem 0.9rem',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          Clear Search
                        </button>
                      )}
                      <button
                        onClick={handleConveneConclave}
                        disabled={isConvening}
                        style={{
                          background: 'linear-gradient(135deg, #a855f7 0%, #38bdf8 100%)',
                          border: 'none',
                          color: '#ffffff',
                          padding: '0.45rem 0.9rem',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 800,
                          cursor: isConvening ? 'not-allowed' : 'pointer'
                        }}
                      >
                        ⚡ Convene Council Now
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Strategic Directives Dispatched */}
            {conclaveTab === 'directives' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {conclaveData?.directives?.map((d, idx) => (
                  <div key={d.id || idx} style={{
                    padding: '1.1rem 1.25rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: d.priority === 'HIGH' ? 'rgba(239, 68, 68, 0.2)' : d.priority === 'MEDIUM' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                          color: d.priority === 'HIGH' ? '#f87171' : d.priority === 'MEDIUM' ? '#fbbf24' : '#38bdf8',
                          border: `1px solid ${d.priority === 'HIGH' ? '#ef4444' : d.priority === 'MEDIUM' ? '#f59e0b' : '#38bdf8'}`
                        }}>
                          {d.priority} PRIORITY
                        </span>
                        <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#f8fafc' }}>
                          {d.title}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 700 }}>
                        Assigned: {d.assignedTo}
                      </span>
                    </div>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#94a3b8', lineHeight: '1.4' }}>
                      {d.description}
                    </p>
                    <div style={{ display: 'flex', gap: '0.8rem', fontSize: '0.7rem', color: '#64748b', marginTop: '0.3rem' }}>
                      <span>Domain: <strong>{d.domain}</strong></span>
                      <span>Status: <strong style={{ color: '#4ade80' }}>{d.status}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TAB 4: Executive Dossier Preview */}
            {conclaveTab === 'dossier' && (
              <div
                className="markdown-body"
                style={{
                  padding: '1.4rem',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  fontSize: '0.86rem',
                  lineHeight: '1.6',
                  color: '#f1f5f9'
                }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(conclaveData?.markdown || 'No executive dossier content available.') }}
              />
            )}

            {/* TAB 5: History Archive */}
            {conclaveTab === 'history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {conclaveHistory.map((h) => (
                  <div
                    key={h.id}
                    onClick={() => setConclaveData(h)}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '10px',
                      background: conclaveData?.id === h.id ? 'rgba(168, 85, 247, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      border: conclaveData?.id === h.id ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc' }}>
                        Week {h.isoWeek}, {h.year} Strategic Conclave
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                        {new Date(h.convenedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} • {h.directives?.length || 0} Directives Dispatched
                      </div>
                    </div>
                    <ArrowRight size={15} color="#94a3b8" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 1. HEPHAESTUS VIEW                                        */}
        {/* ========================================================= */}
        {activeAgent === 'hephaestus' && (
          <div style={{ height: '100%' }}>
            <DevWorkspace isFullPage={true} />
          </div>
        )}

        {/* ========================================================= */}
        {/* 2. ATHENA VIEW                                            */}
        {/* ========================================================= */}
        {activeAgent === 'athena' && (
          <div style={{ height: '100%' }}>
            <AthenaWorkspace isFullPage={true} />
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. APOLLO VIEW (Memory, Facts, Vault, Document Curation) */}
        {/* ========================================================= */}
        {activeAgent === 'apollo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1100px', margin: '0 auto' }}>
            {/* Apollo KPI Pulse Grid */}
            <PulseGrid
              metrics={[
                { label: 'Persistent Facts', value: memoriesList.length, subtext: 'Knowledge base', color: '#f59e0b', icon: Database },
                { label: 'Skill Proficiency', value: skillsData?.overallProficiencyScore != null ? `${skillsData.overallProficiencyScore}%` : '—', subtext: 'Auto-taught skills', color: '#38bdf8', icon: BrainCircuit },
                { label: 'User Identity', value: profileName ?? '—', subtext: 'Learned profile', color: '#a855f7', icon: User },
                { label: 'Obsidian Vault', value: (apolloStats.lastVaultSync && apolloStats.lastVaultSync !== 'Never') ? 'Synced' : 'Never synced', subtext: 'GraphRAG active', color: '#10b981', icon: HardDrive }
              ]}
            />

            {/* Standardized TabBar */}
            <TabBar
              tabs={[
                { id: 'memories', label: 'Persistent Facts', count: memoriesList.length, icon: Database },
                { id: 'skills', label: 'Skills & Learning Matrix', icon: BrainCircuit },
                { id: 'profile', label: 'User Profile & Identity', icon: User },
                { id: 'vault', label: 'Obsidian Vault & GraphRAG', icon: HardDrive },
                { id: 'ingest', label: 'Document Ingestion', icon: FileCheck }
              ]}
              activeTab={apolloTab}
              onSelectTab={setApolloTab}
              accentColor="#f59e0b"
            />

            {/* Sub-tab 1: Memories & Fact Gardening */}
            {apolloTab === 'memories' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flex: 1, maxWidth: '400px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.4rem 0.75rem', alignItems: 'center' }}>
                    <Search size={14} color="#94a3b8" />
                    <input
                      type="text"
                      placeholder="Search long-term facts..."
                      value={memorySearch}
                      onChange={(e) => setMemorySearch(e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.82rem', outline: 'none', width: '100%' }}
                    />
                  </div>
                  <button
                    onClick={handleGardenMemories}
                    disabled={loading}
                    style={{
                      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.2))',
                      border: '1px solid #f59e0b',
                      color: '#fef3c7',
                      padding: '0.5rem 1rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    Garden & Deduplicate Facts
                  </button>
                </div>

                {/* Add new fact */}
                <form onSubmit={handleAddMemory} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Teach Aloy a new fact (e.g. 'User prefers TypeScript over vanilla JS')..."
                    value={newMemoryFact}
                    onChange={(e) => setNewMemoryFact(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.8rem',
                      color: '#fff',
                      fontSize: '0.85rem'
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!newMemoryFact.trim()}
                    style={{
                      background: '#f59e0b',
                      border: 'none',
                      color: '#000',
                      padding: '0.55rem 1rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    <Plus size={14} /> Add Fact
                  </button>
                </form>

                {/* Category Filter Pills */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {['All', 'Smart Home', 'Preferences', 'Media Rip', 'Environment'].map((cat) => {
                    const count = cat === 'All'
                      ? memoriesList.length
                      : memoriesList.filter(f => {
                          const lower = (typeof f === 'string' ? f : '').toLowerCase();
                          if (cat === 'Smart Home') return lower.includes('home assistant') || lower.includes('hass') || lower.includes('light') || lower.includes('lock') || lower.includes('calendar');
                          if (cat === 'Media Rip') return lower.includes('autorip') || lower.includes('nvenc') || lower.includes('h.264') || lower.includes('h.265') || lower.includes('movie') || lower.includes('disc');
                          if (cat === 'Environment') return lower.includes('windows') || lower.includes('vs code') || lower.includes('python') || lower.includes('docker') || lower.includes('subagents') || lower.includes('desktop');
                          if (cat === 'Preferences') return lower.includes('prefer') || lower.includes('privacy') || lower.includes('noise') || lower.includes('solution') || lower.includes('engineered');
                          return true;
                        }).length;

                    const isSelected = selectedFactCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setSelectedFactCategory(cat)}
                        style={{
                          background: isSelected ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          border: isSelected ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.08)',
                          color: isSelected ? '#fef3c7' : '#94a3b8',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Memories List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '500px', overflowY: 'auto' }}>
                  {memoriesList
                    .filter(m => typeof m === 'string' && m.toLowerCase().includes(memorySearch.toLowerCase()))
                    .filter(m => {
                      if (selectedFactCategory === 'All') return true;
                      const lower = m.toLowerCase();
                      if (selectedFactCategory === 'Smart Home') return lower.includes('home assistant') || lower.includes('hass') || lower.includes('light') || lower.includes('lock') || lower.includes('calendar');
                      if (selectedFactCategory === 'Media Rip') return lower.includes('autorip') || lower.includes('nvenc') || lower.includes('h.264') || lower.includes('h.265') || lower.includes('movie') || lower.includes('disc');
                      if (selectedFactCategory === 'Environment') return lower.includes('windows') || lower.includes('vs code') || lower.includes('python') || lower.includes('docker') || lower.includes('subagents') || lower.includes('desktop');
                      if (selectedFactCategory === 'Preferences') return lower.includes('prefer') || lower.includes('privacy') || lower.includes('noise') || lower.includes('solution') || lower.includes('engineered');
                      return true;
                    })
                    .map((fact, idx) => {
                      const lower = fact.toLowerCase();
                      let catLabel = 'General';
                      let catColor = '#94a3b8';
                      let catBg = 'rgba(148, 163, 184, 0.12)';
                      if (lower.includes('home assistant') || lower.includes('hass') || lower.includes('light') || lower.includes('lock') || lower.includes('calendar')) {
                        catLabel = 'Smart Home'; catColor = '#38bdf8'; catBg = 'rgba(56, 189, 248, 0.15)';
                      } else if (lower.includes('autorip') || lower.includes('nvenc') || lower.includes('h.264') || lower.includes('h.265') || lower.includes('movie') || lower.includes('disc')) {
                        catLabel = 'Media Rip'; catColor = '#a855f7'; catBg = 'rgba(168, 85, 247, 0.15)';
                      } else if (lower.includes('windows') || lower.includes('vs code') || lower.includes('python') || lower.includes('docker') || lower.includes('subagents') || lower.includes('desktop')) {
                        catLabel = 'Environment'; catColor = '#10b981'; catBg = 'rgba(16, 185, 129, 0.15)';
                      } else if (lower.includes('prefer') || lower.includes('privacy') || lower.includes('noise') || lower.includes('solution') || lower.includes('engineered')) {
                        catLabel = 'Preferences'; catColor = '#f59e0b'; catBg = 'rgba(245, 158, 11, 0.15)';
                      }

                      return (
                        <div
                          key={idx}
                          style={{
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            borderRadius: '8px',
                            padding: '0.65rem 0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.75rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: '0.6rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: catBg, color: catColor, textTransform: 'uppercase', flexShrink: 0 }}>
                              {catLabel}
                            </span>
                            <span style={{ fontSize: '0.85rem', color: '#f1f5f9', lineHeight: 1.4 }}>{fact}</span>
                          </div>
                          <button
                            onClick={() => handleDeleteMemory(idx)}
                            style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', opacity: 0.7, padding: '4px' }}
                            title="Delete fact"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}

                  {memoriesList.length === 0 && (
                    <div style={{
                      padding: '2.5rem 1.5rem',
                      textAlign: 'center',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: '12px',
                      border: '1px dashed rgba(245, 158, 11, 0.25)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.75rem'
                    }}>
                      <div style={{
                        width: '46px',
                        height: '46px',
                        borderRadius: '12px',
                        background: 'rgba(245, 158, 11, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#f59e0b'
                      }}>
                        <BookOpen size={22} />
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                        Apollo Knowledge Base Ready
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', maxWidth: '440px', lineHeight: 1.5 }}>
                        Persistent facts guide Aloy's behavior across sessions. Use the input box above to teach facts like your preferred coding languages, media formats, or smart home comfort zones.
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
                        {[
                          "User prefers 4K UHD Remux releases",
                          "Primary development environment is Windows 11 & Powershell",
                          "Default smart home temperature target is 71°F"
                        ].map((sample, sIdx) => (
                          <button
                            key={sIdx}
                            type="button"
                            onClick={() => setNewMemoryFact(sample)}
                            style={{
                              background: 'rgba(245, 158, 11, 0.08)',
                              border: '1px solid rgba(245, 158, 11, 0.2)',
                              color: '#fbbf24',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.72rem',
                              cursor: 'pointer'
                            }}
                          >
                            + {sample}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-tab: Skills & Learning Matrix */}
            {apolloTab === 'skills' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header Card */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(127, 0, 255, 0.12))',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '14px',
                  padding: '1.2rem 1.4rem'
                }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <BarChart3 size={14} color="#f59e0b" /> Overall Skill Proficiency
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#ffffff', marginTop: '0.2rem' }}>
                      {skillsData ? `${skillsData.overallProficiencyScore}%` : 'Calculating...'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                      Auto-taught overnight via Claude investigation & Gemini cross-verification.
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <button
                      onClick={handleRunAutoTeaching}
                      disabled={loading}
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        border: 'none',
                        color: '#000',
                        padding: '0.55rem 1rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)'
                      }}
                    >
                      <Sparkles size={14} className={loading ? 'animate-spin' : ''} />
                      {loading ? 'Teaching & Verifying...' : 'Run Auto-Teaching Pass Now'}
                    </button>
                    {skillsData?.skillsLearnedCount > 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#a78bfa' }}>
                        {skillsData.skillsLearnedCount} tool-call pattern{skillsData.skillsLearnedCount === 1 ? '' : 's'} mastered
                      </div>
                    )}
                    {skillsData?.needsReviewCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: '#fbbf24', fontWeight: 700 }}>
                        <Eye size={13} /> {skillsData.needsReviewCount} gap{skillsData.needsReviewCount === 1 ? '' : 's'} need review
                      </div>
                    )}
                  </div>
                </div>

                {/* Document Rewrite Reliability (if available) */}
                {skillsData?.documentProofreading && skillsData.documentProofreading.totalLogged > 0 && (() => {
                  const dp = skillsData.documentProofreading;
                  const streakColor = dp.readyToGraduate ? '#4ade80' : dp.cleanStreak > 0 ? '#38bdf8' : '#94a3b8';
                  return (
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '0.9rem 1.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                        <FileCheck size={16} color={streakColor} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>Document Rewrite Reliability</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {dp.readyToGraduate ? (
                          <span style={{ color: '#4ade80', fontWeight: 700 }}>
                            {dp.cleanStreak} consecutive clean proofreads — Ready to graduate off mandatory checks.
                          </span>
                        ) : (
                          <>
                            <span style={{ color: streakColor, fontWeight: 700 }}>{dp.cleanStreak} clean in a row</span>
                            {' '}(needs {dp.graduationStreak} to graduate) · last {dp.recentSampleSize}: {dp.recentCleanRate}% clean
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Category Breakdown Matrix */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Domain Category Proficiencies
                  </div>
                  {skillsData?.categories ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0.75rem' }}>
                      {skillsData.categories.map((cat) => {
                        const scoreColor = cat.proficiencyScore >= 90 ? '#4ade80' : cat.proficiencyScore >= 70 ? '#38bdf8' : cat.proficiencyScore >= 40 ? '#fbbf24' : '#f87171';
                        return (
                          <div key={cat.name} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '0.85rem 1rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#f1f5f9' }}>{cat.name}</span>
                              <span style={{
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                background: `${scoreColor}20`,
                                border: `1px solid ${scoreColor}40`,
                                color: scoreColor
                              }}>
                                {cat.proficiencyScore}%
                              </span>
                            </div>
                            <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: 'rgba(255,255,255,0.06)', marginBottom: '0.5rem' }}>
                              <div style={{ width: `${cat.proficiencyScore}%`, background: scoreColor, transition: 'width 0.5s ease' }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
                              <span>{cat.confirmedCount > 0 ? <span style={{ color: '#4ade80' }}>{cat.confirmedCount} verified</span> : '0 confirmed'}</span>
                              <span>{cat.gapCount > 0 ? <span style={{ color: '#f87171' }}>{cat.gapCount} gap{cat.gapCount !== 1 ? 's' : ''}</span> : 'no open gaps'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: '#64748b', fontSize: '0.85rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                      Loading Apollo skills matrix...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-tab: User Profile & Identity */}
            {apolloTab === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* 1. User Profile & Preferences Form */}
                <form onSubmit={handleSaveProfile} style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '1.4rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <User size={18} color="#f59e0b" /> User Profile & Aloy Response Persona
                    </h3>
                    <button
                      type="submit"
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        border: 'none',
                        color: '#000',
                        padding: '0.45rem 1rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      <Save size={14} /> Save Profile Changes
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Your Preferred Name</label>
                      <input
                        type="text"
                        value={profileName}
                        onChange={e => setProfileName(e.target.value)}
                        style={{ width: '100%', background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.55rem 0.75rem', color: '#f8fafc', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Preferred Tone / Style</label>
                      <input
                        type="text"
                        value={profileStyle}
                        onChange={e => setProfileStyle(e.target.value)}
                        style={{ width: '100%', background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.55rem 0.75rem', color: '#f8fafc', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Custom System Prompt Instructions</label>
                    <textarea
                      value={profileInstructions}
                      onChange={e => setProfileInstructions(e.target.value)}
                      rows={3}
                      style={{ width: '100%', background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.55rem 0.75rem', color: '#f8fafc', fontSize: '0.82rem', resize: 'vertical' }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <input
                      type="checkbox"
                      id="apolloCheckIns"
                      checked={profileCheckIns}
                      onChange={e => setProfileCheckIns(e.target.checked)}
                      style={{ accentColor: '#f59e0b', width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    <label htmlFor="apolloCheckIns" style={{ fontSize: '0.82rem', color: '#f1f5f9', cursor: 'pointer' }}>
                      Enable proactive daily morning check-ins & briefing pulse (Hermes)
                    </label>
                  </div>
                </form>

                {/* 2. Security PIN & Biometric Protection */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '1.4rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Lock size={18} color="#f59e0b" /> App Lock PIN & Perimeter Gate
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
                    {profileProps?.isLockConfigured ? 'App Lock is currently ENABLED. Changing PIN requires your current PIN.' : 'App Lock is currently DISABLED. Set a 4+ digit PIN to require PIN entry on launch and 2FA actions.'}
                  </p>

                  <form onSubmit={handleSaveLockPin} style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {profileProps?.isLockConfigured && (
                      <input
                        type="password"
                        placeholder="Current PIN"
                        value={lockCurrentPin}
                        onChange={e => setLockCurrentPin(e.target.value)}
                        style={{ background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.45rem 0.7rem', color: '#f8fafc', fontSize: '0.82rem', width: '130px' }}
                      />
                    )}
                    <input
                      type="password"
                      placeholder="New PIN (4+ digits)"
                      value={lockNewPin}
                      onChange={e => setLockNewPin(e.target.value)}
                      style={{ background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.45rem 0.7rem', color: '#f8fafc', fontSize: '0.82rem', width: '150px' }}
                    />
                    <input
                      type="password"
                      placeholder="Confirm New PIN"
                      value={lockConfirmPin}
                      onChange={e => setLockConfirmPin(e.target.value)}
                      style={{ background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.45rem 0.7rem', color: '#f8fafc', fontSize: '0.82rem', width: '150px' }}
                    />
                    <button
                      type="submit"
                      disabled={lockBusy || !lockNewPin}
                      style={{ background: 'rgba(245, 158, 11, 0.2)', border: '1px solid #f59e0b', color: '#fef3c7', padding: '0.45rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}
                    >
                      {profileProps?.isLockConfigured ? 'Update PIN' : 'Enable App Lock'}
                    </button>
                    {profileProps?.isLockConfigured && (
                      <button
                        type="button"
                        onClick={handleRemoveLockPin}
                        disabled={lockBusy || !lockCurrentPin}
                        style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', padding: '0.45rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}
                      >
                        Remove PIN Lock
                      </button>
                    )}
                  </form>
                </div>

                {/* 3. Local Vault Disaster Recovery */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '1.4rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <HardDriveDownload size={18} color="#f59e0b" /> Local Data Backups & Disaster Recovery
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    Location: <code style={{ color: '#fbbf24', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>Documents/Aloy Backups/</code>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={profileProps?.onBackupNow}
                      disabled={profileProps?.isBackingUp}
                      style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', color: '#000', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <HardDriveDownload size={14} /> {profileProps?.isBackingUp ? 'Creating Backup...' : 'Create Full Backup Now'}
                    </button>
                    <button
                      type="button"
                      onClick={profileProps?.onRestoreBackup}
                      style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#f1f5f9', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <RotateCcw size={14} /> Restore from File
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab 3: Vault & GraphRAG */}
            {apolloTab === 'vault' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: '12px', padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase' }}>Obsidian Vault Target</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', marginTop: '0.2rem' }}>
                    Documents/Vault Notes/Aloy Brain/
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                    Auto-generates Personal_Memories.md, Learned_Knowledge.md, and Synthesized_Skills.md.
                  </div>
                  <div style={{ marginTop: '0.85rem' }}>
                    <button
                      onClick={handleSyncVault}
                      disabled={loading}
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        border: 'none',
                        color: '#000',
                        padding: '0.55rem 1.1rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      <Database size={14} /> Sync to Obsidian Vault Now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab 3: Document Ingestion */}
            {apolloTab === 'ingest' && (
              <form onSubmit={handleIngestDocument} style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.8rem', fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={16} color="#f59e0b" /> Direct Document Ingestion & Entity Synthesis
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    placeholder="Document Title (e.g. Distributed Storage Architecture)"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.6rem 0.8rem', color: '#f8fafc', fontSize: '0.85rem' }}
                  />
                  <input
                    type="text"
                    placeholder="Category (e.g. Infrastructure)"
                    value={docCategory}
                    onChange={(e) => setDocCategory(e.target.value)}
                    style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.6rem 0.8rem', color: '#f8fafc', fontSize: '0.85rem' }}
                  />
                </div>
                <textarea
                  placeholder="Paste research text, notes, or paper abstract here..."
                  rows={4}
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  style={{ width: '100%', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.6rem 0.8rem', color: '#f8fafc', fontSize: '0.85rem', resize: 'vertical', marginBottom: '0.75rem', boxSizing: 'border-box' }}
                />
                <button
                  type="submit"
                  disabled={loading || !docTitle.trim() || !docContent.trim()}
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', color: '#000', padding: '0.6rem 1.2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <Zap size={14} /> Dispatch to Apollo
                </button>
              </form>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 4. MINERVA VIEW (Reliability Sentinel & Infrastructure)   */}
        {/* ========================================================= */}
        {activeAgent === 'minerva' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1100px', margin: '0 auto' }}>
            {/* Minerva KPI Pulse Grid */}
            <PulseGrid
              metrics={[
                { label: 'Sentinel Status', value: (!healthReport || healthReport?.status === 'healthy') ? 'NOMINAL' : 'DEGRADED', subtext: `${healthReport?.offlineCount || 0} offline services`, color: (!healthReport || healthReport?.status === 'healthy') ? '#10b981' : '#fbbf24', icon: Shield },
                { label: 'Smart Lighting', value: `${(haCategories?.lights || []).filter(l => l.state === 'on').length} / ${haCategories?.lights?.length ?? '—'} ON`, subtext: 'Home Assistant mesh', color: '#f59e0b', icon: Lightbulb },
                { label: 'Perimeter Locks', value: `${(haCategories?.locks || []).filter(k => k.state === 'unlocked').length} Unlocked`, subtext: 'Smart Lock U400 Gate', color: '#38bdf8', icon: Lock },
                { label: 'Connected Sidecars', value: `${Object.keys(healthReport?.dependencies || {}).length ?? '—'} Monitored`, subtext: 'Local sidecars active', color: '#a855f7', icon: Cpu }
              ]}
            />
            {/* 1. Infrastructure Sentinel Header Card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '12px', padding: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🛡️ Sentinel Watchdog & Health Monitor
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', marginTop: '0.25rem' }}>
                  {(!healthReport || healthReport?.status === 'healthy') ? '🟢 ALL SYSTEMS OPERATIONAL' : '🟡 DEGRADED INFRASTRUCTURE'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                  {healthReport ? `${healthReport.offlineCount || 0} services offline • Last scanned: ${healthReport.timestamp ? new Date(healthReport.timestamp).toLocaleTimeString() : 'Live'}` : 'Live sentinel telemetry active'}
                </div>
              </div>
              <button
                onClick={handleRunHealthScan}
                disabled={loading}
                style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.25))',
                  border: '1px solid #10b981',
                  color: '#a7f3d0',
                  padding: '0.55rem 1.1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem'
                }}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Run Health Scan
              </button>
            </div>

            {/* 2. Sidecar & Security Dependency Matrix */}
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '0.6rem' }}>
                Monitored Infrastructure & Security Gates
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
                {healthReport?.dependencies ? (
                  Object.entries(healthReport.dependencies).map(([depName, depInfo]) => {
                    const isOk = depInfo.status === 'online' || depInfo.status === 'mounted' || depInfo.status === 'valid' || depInfo.status === 'configured';
                    return (
                      <div
                        key={depName}
                        style={{
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: `1px solid ${isOk ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                          borderRadius: '10px',
                          padding: '0.85rem'
                        }}
                      >
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc', textTransform: 'capitalize' }}>
                          {depName.replace(/([A-Z])/g, ' $1')}
                        </div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: isOk ? '#10b981' : '#ef4444', marginTop: '0.2rem' }}>
                          {depInfo.status?.toUpperCase() || 'UNKNOWN'}
                        </div>
                        {depInfo.error && (
                          <div style={{ fontSize: '0.68rem', color: '#fca5a5', marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {depInfo.error}
                          </div>
                        )}
                        {!isOk && (
                          <button
                            onClick={() => handleRestartService(depName)}
                            disabled={loading}
                            style={{
                              marginTop: '0.45rem',
                              width: '100%',
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                              color: '#fca5a5',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '3px 6px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px'
                            }}
                          >
                            <Zap size={11} />
                            Restart Service
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div style={{ gridColumn: '1 / -1', padding: '1rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', fontSize: '0.82rem', textAlign: 'center' }}>
                    Click "Run Health Scan" to query local sidecars and security boundaries.
                  </div>
                )}
              </div>
            </div>

            {/* 3. Smart Home Devices & Perimeter Security */}
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '0.6rem' }}>
                Smart Home Devices & Perimeter Security
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                {/* Smart Lighting */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <Lightbulb size={16} color="#fde047" />
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Smart Lighting</span>
                  </div>
                  {(haCategories?.lights && haCategories.lights.length > 0) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {haCategories.lights.slice(0, 6).map(light => (
                        <div key={light.entity_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>{light.attributes?.friendly_name || light.entity_id}</span>
                          <button
                            onClick={() => handleToggleLight(light.entity_id, light.state)}
                            style={{
                              background: light.state === 'on' ? 'rgba(253, 224, 71, 0.2)' : 'rgba(255,255,255,0.06)',
                              border: `1px solid ${light.state === 'on' ? '#fde047' : 'rgba(255,255,255,0.1)'}`,
                              color: light.state === 'on' ? '#fde047' : '#94a3b8',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            {light.state?.toUpperCase()}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Home Assistant lights synced via HA Gateway.</div>
                  )}
                </div>

                {/* Smart Locks & Perimeter */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <Lock size={16} color="#38bdf8" />
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Smart Locks & 2FA Gate</span>
                  </div>
                  {(haCategories?.locks && haCategories.locks.length > 0) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {haCategories.locks.map(lock => (
                        <div key={lock.entity_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                          <span style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>{lock.attributes?.friendly_name || lock.entity_id}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: lock.state === 'locked' ? '#10b981' : '#fbbf24' }}>
                            {lock.state?.toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Perimeter locks protected by Minerva 2FA Gate.</div>
                  )}
                </div>
              </div>
            </div>

            {/* 4. Connected Sidecars & Visualizers */}
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '0.6rem' }}>
                Connected Sidecar Services
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                <div style={{ background: 'rgba(0, 242, 254, 0.06)', border: '1px solid rgba(0, 242, 254, 0.25)', borderRadius: '10px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f8fafc' }}>Jellyfin Media Server</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Port 8096 (Aloy Server)</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open('http://localhost:8096', '_blank')}
                    style={{ background: 'rgba(0, 242, 254, 0.2)', border: '1px solid #00f2fe', color: '#00f2fe', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <ExternalLink size={12} /> Launch
                  </button>
                </div>

                <div style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '10px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f8fafc' }}>Kokoro Neural TTS</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Port 8888 (Voice Studio)</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open('http://localhost:8888/docs', '_blank')}
                    style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#34d399', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <ExternalLink size={12} /> API Docs
                  </button>
                </div>

                <div style={{ background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '10px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f8fafc' }}>Sonarr TV Monitor</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Port 8989 (Episode Queue)</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open('http://localhost:8989', '_blank')}
                    style={{ background: 'rgba(56, 189, 248, 0.2)', border: '1px solid #38bdf8', color: '#38bdf8', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <ExternalLink size={12} /> Launch
                  </button>
                </div>

                <div style={{ background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: '10px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f8fafc' }}>Radarr Movie Monitor</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Port 7878 (Movie Queue)</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open('http://localhost:7878', '_blank')}
                    style={{ background: 'rgba(245, 158, 11, 0.2)', border: '1px solid #f59e0b', color: '#f59e0b', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <ExternalLink size={12} /> Launch
                  </button>
                </div>

                <div style={{ background: 'rgba(251, 191, 36, 0.06)', border: '1px solid rgba(251, 191, 36, 0.25)', borderRadius: '10px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f8fafc' }}>SABnzbd Usenet</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Port 8080 (Bandwidth Core)</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open('http://localhost:8080', '_blank')}
                    style={{ background: 'rgba(251, 191, 36, 0.2)', border: '1px solid #fbbf24', color: '#fbbf24', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <ExternalLink size={12} /> Launch
                  </button>
                </div>

                <div style={{ background: 'rgba(168, 85, 247, 0.06)', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: '10px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f8fafc' }}>3D Mindwalk Graph</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Port 8765 (Knowledge 3D)</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open('http://localhost:8765', '_blank')}
                    style={{ background: 'rgba(168, 85, 247, 0.2)', border: '1px solid #a855f7', color: '#c084fc', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <ExternalLink size={12} /> Launch
                  </button>
                </div>
              </div>
            </div>

            {/* 4. Security Alert Dispatcher */}
            <form onSubmit={handleSendAlert} style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.1rem' }}>
              <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Shield size={15} color="#10b981" /> Dispatch Sentinel Security Alert
              </h3>
              <input
                type="text"
                placeholder="Alert message to route to Discord / Webhooks..."
                value={alertMessage}
                onChange={(e) => setAlertMessage(e.target.value)}
                style={{ width: '100%', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px', padding: '0.55rem 0.75rem', color: '#f8fafc', fontSize: '0.82rem', marginBottom: '0.6rem', boxSizing: 'border-box' }}
              />
              <button
                type="submit"
                disabled={loading || !alertMessage.trim()}
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#000', padding: '0.5rem 1.1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Send size={13} /> Dispatch Alert
              </button>
            </form>
          </div>
        )}

        {/* ========================================================= */}
        {/* 5. HERMES VIEW (Briefing, Reminders, Finances)           */}
        {/* ========================================================= */}
        {activeAgent === 'hermes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '1100px', margin: '0 auto' }}>
            {/* Hermes KPI Pulse Grid */}
            <PulseGrid
              metrics={[
                { label: 'Morning Pulse', value: dailyBrief ? 'Ready' : 'Pending', subtext: 'Daily operations brief', color: '#8b5cf6', icon: Sparkles },
                { label: 'Job Radar', value: `${jobListings.length} Postings`, subtext: 'LinkedIn active', color: '#38bdf8', icon: Target },
                { label: 'Pending Tasks', value: `${reminders.filter(r => !r.completed).length} Due`, subtext: 'Calendar & tasks', color: '#f59e0b', icon: Calendar },
                { label: 'Fitness Log', value: `${calculateWorkoutStreak(workouts)}d Streak`, subtext: `${workouts.length} total sessions`, color: '#10b981', icon: Activity }
              ]}
            />

            {/* Standardized TabBar */}
            <TabBar
              tabs={[
                { id: 'brief', label: 'Daily Morning Brief', icon: Sparkles },
                { id: 'jobs', label: 'Job Radar', count: jobListings.length, icon: Target },
                { id: 'reminders', label: 'Schedule & Reminders', count: reminders.filter(r => !r.completed).length, icon: Calendar },
                { id: 'budget', label: 'Financial Pulse', icon: Wallet },
                { id: 'fitness', label: 'Fitness Log', count: workouts.length, icon: Activity }
              ]}
              activeTab={hermesTab}
              onSelectTab={(tabId) => {
                setHermesTab(tabId);
                if (tabId === 'jobs') loadJobRadar();
              }}
              accentColor="#8b5cf6"
            />

            {/* Sub-tab 1: Daily Brief */}
            {hermesTab === 'brief' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: '12px', padding: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 700, textTransform: 'uppercase' }}>Operations Commander</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc', marginTop: '0.2rem' }}>
                      Executive Morning Pulse
                    </div>
                  </div>
                  <button
                    onClick={handleGenerateBrief}
                    disabled={loading}
                    style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(109, 40, 217, 0.2))', border: '1px solid #8b5cf6', color: '#c4b5fd', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Zap size={13} />
                    Synthesize Briefing
                  </button>
                </div>

                {dailyBrief && (
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '12px', padding: '1.25rem' }}>
                    <div
                      className="markdown-body"
                      style={{ fontSize: '0.86rem', lineHeight: 1.6, color: '#f1f5f9' }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(dailyBrief.markdown || '') }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Sub-tab: Job Radar (Technical Writer & Content Developer) */}
            {hermesTab === 'jobs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Header Banner */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(56, 189, 248, 0.08) 100%)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: '12px',
                  padding: '1.1rem 1.25rem',
                  flexWrap: 'wrap',
                  gap: '0.85rem'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.2rem' }}>🎯</span>
                      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc' }}>
                        Technical Writing & Content Developer Radar
                      </div>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '0.25rem' }}>
                      Automated 24-hour LinkedIn scanning, deduplication & 1-click apply tracking for Remote/US roles.
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.72rem', background: 'rgba(168, 85, 247, 0.2)', color: '#c084fc', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                        {jobListings.length} Total Postings
                      </span>
                      <span style={{ fontSize: '0.72rem', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                        {jobListings.filter(j => (j.query || '').toLowerCase().includes('technical writer') || (j.title || '').toLowerCase().includes('technical writer')).length} Tech Writer
                      </span>
                      <span style={{ fontSize: '0.72rem', background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                        {jobListings.filter(j => (j.query || '').toLowerCase().includes('content') || (j.title || '').toLowerCase().includes('content')).length} Content Dev
                      </span>
                      <span style={{ fontSize: '0.72rem', background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                        {jobListings.filter(j => j.status === 'saved').length} Saved
                      </span>
                      {jobRadarConfig?.lastScannedAt && (
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', padding: '2px 4px' }}>
                          🕒 Last scanned: {new Date(jobRadarConfig.lastScannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleScanLinkedInJobs}
                    disabled={isScanningJobs}
                    style={{
                      background: isScanningJobs ? 'rgba(168, 85, 247, 0.4)' : 'linear-gradient(135deg, #a855f7, #7c3aed)',
                      border: 'none',
                      color: '#ffffff',
                      padding: '0.6rem 1.1rem',
                      borderRadius: '8px',
                      cursor: isScanningJobs ? 'wait' : 'pointer',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      boxShadow: '0 2px 10px rgba(168, 85, 247, 0.3)'
                    }}
                  >
                    <RefreshCw size={14} />
                    {isScanningJobs ? 'Scanning LinkedIn...' : '⚡ Scan LinkedIn Now'}
                  </button>
                </div>

                {/* Filter & Search Toolbar */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '0.75rem 1rem',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  {/* Category Pills */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, marginRight: '0.2rem' }}>Role:</span>
                    {['ALL', 'Technical Writer', 'Content Developer', 'Documentation Engineer'].map(q => (
                      <button
                        key={q}
                        onClick={() => setJobFilterQuery(q)}
                        style={{
                          background: jobFilterQuery === q ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          border: jobFilterQuery === q ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                          color: jobFilterQuery === q ? '#f3e8ff' : '#94a3b8',
                          padding: '0.28rem 0.65rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '0.75rem'
                        }}
                      >
                        {q === 'ALL' ? 'All Roles' : q}
                      </button>
                    ))}
                  </div>

                  {/* Status Pills */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, marginRight: '0.2rem' }}>Status:</span>
                    {[
                      { id: 'ALL', label: 'All' },
                      { id: 'new', label: 'New' },
                      { id: 'saved', label: '⭐ Saved' },
                      { id: 'applied', label: '💼 Applied' }
                    ].map(s => (
                      <button
                        key={s.id}
                        onClick={() => setJobFilterStatus(s.id)}
                        style={{
                          background: jobFilterStatus === s.id ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          border: jobFilterStatus === s.id ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                          color: jobFilterStatus === s.id ? '#e0f2fe' : '#94a3b8',
                          padding: '0.28rem 0.65rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '0.75rem'
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {/* Search Box */}
                  <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.35)', borderRadius: '6px', padding: '0 0.6rem', border: '1px solid rgba(255, 255, 255, 0.1)', flex: '1 1 200px', maxWidth: '300px' }}>
                    <Search size={14} color="#94a3b8" />
                    <input
                      type="text"
                      placeholder="Search company, title, location..."
                      value={jobSearchText}
                      onChange={(e) => setJobSearchText(e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: '#f8fafc', padding: '0.45rem 0.5rem', fontSize: '0.78rem', outline: 'none', width: '100%' }}
                    />
                    {jobSearchText && (
                      <button onClick={() => setJobSearchText('')} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', padding: '2px' }}>✕</button>
                    )}
                  </div>
                </div>

                {/* Job Listings Feed */}
                {(() => {
                  const filtered = (jobListings || []).filter(j => {
                    if (jobFilterStatus !== 'ALL' && j.status !== jobFilterStatus) return false;
                    if (jobFilterQuery !== 'ALL') {
                      const qMatch = (j.query || '').toLowerCase().includes(jobFilterQuery.toLowerCase()) ||
                                     (j.title || '').toLowerCase().includes(jobFilterQuery.toLowerCase());
                      if (!qMatch) return false;
                    }
                    if (jobSearchText.trim()) {
                      const s = jobSearchText.trim().toLowerCase();
                      const tMatch = (j.title || '').toLowerCase().includes(s);
                      const cMatch = (j.company || '').toLowerCase().includes(s);
                      const lMatch = (j.location || '').toLowerCase().includes(s);
                      if (!tMatch && !cMatch && !lMatch) return false;
                    }
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{
                        padding: '3rem 1.5rem',
                        textAlign: 'center',
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.75rem'
                      }}>
                        <span style={{ fontSize: '2.5rem' }}>🎯</span>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc' }}>
                          {jobSearchText ? `No listings matching "${jobSearchText}"` : 'No Job Postings in Radar'}
                        </div>
                        <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', maxWidth: '420px', lineHeight: 1.5 }}>
                          Click <strong>Scan LinkedIn Now</strong> above to pull today's latest Technical Writer and Content Developer openings directly into Aloy.
                        </p>
                        <button
                          onClick={handleScanLinkedInJobs}
                          disabled={isScanningJobs}
                          style={{
                            marginTop: '0.5rem',
                            background: 'rgba(168, 85, 247, 0.25)',
                            border: '1px solid #a855f7',
                            color: '#f3e8ff',
                            padding: '0.5rem 1.2rem',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: '0.82rem'
                          }}
                        >
                          ⚡ Scan LinkedIn (24h Window)
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.85rem' }}>
                      {filtered.map(job => (
                        <div
                          key={job.id || job.jobId}
                          style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: job.status === 'saved' ? '1px solid rgba(251, 191, 36, 0.4)' : job.status === 'applied' ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '12px',
                            padding: '1.1rem',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '0.8rem',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div>
                            {/* Card Top: Role Tag & Time Badge */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                              <span style={{
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: (job.query || '').toLowerCase().includes('technical writer') ? 'rgba(56, 189, 248, 0.18)' : 'rgba(168, 85, 247, 0.18)',
                                color: (job.query || '').toLowerCase().includes('technical writer') ? '#38bdf8' : '#c084fc'
                              }}>
                                {job.query || 'Technical Writer'}
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                                  🕒 {job.postedTimeStr || 'Recent'}
                                </span>
                                {job.status === 'saved' && (
                                  <span style={{ fontSize: '0.65rem', background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', padding: '1px 5px', borderRadius: '3px', fontWeight: 800 }}>SAVED</span>
                                )}
                                {job.status === 'applied' && (
                                  <span style={{ fontSize: '0.65rem', background: 'rgba(52, 211, 153, 0.2)', color: '#34d399', padding: '1px 5px', borderRadius: '3px', fontWeight: 800 }}>APPLIED</span>
                                )}
                              </div>
                            </div>

                            {/* Job Title */}
                            <h4 style={{ margin: '0 0 0.35rem 0', fontSize: '0.96rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1.35 }}>
                              {job.title}
                            </h4>

                            {/* Company & Location */}
                            <div style={{ fontSize: '0.82rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              {job.companyUrl ? (
                                <a
                                  href={job.companyUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#c4b5fd', fontWeight: 700, textDecoration: 'none' }}
                                >
                                  {job.company}
                                </a>
                              ) : (
                                <strong style={{ color: '#f1f5f9' }}>{job.company}</strong>
                              )}
                              <span style={{ color: '#64748b' }}>•</span>
                              <span style={{ color: '#94a3b8' }}>📍 {job.location}</span>
                            </div>
                          </div>

                          {/* Card Bottom: Actions */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.65rem', marginTop: '0.2rem' }}>
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                background: 'rgba(0, 119, 181, 0.2)',
                                border: '1px solid rgba(0, 119, 181, 0.5)',
                                color: '#38bdf8',
                                padding: '0.35rem 0.75rem',
                                borderRadius: '6px',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                textDecoration: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                            >
                              <span>Apply on LinkedIn</span>
                              <ArrowRight size={13} />
                            </a>

                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button
                                onClick={() => handleUpdateJobStatus(job.id || job.jobId, job.status === 'saved' ? 'new' : 'saved')}
                                title={job.status === 'saved' ? 'Unsave job' : 'Save job to watchlist'}
                                style={{
                                  background: job.status === 'saved' ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                  border: job.status === 'saved' ? '1px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.1)',
                                  color: job.status === 'saved' ? '#fbbf24' : '#94a3b8',
                                  padding: '0.35rem 0.55rem',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  fontWeight: 700
                                }}
                              >
                                {job.status === 'saved' ? '⭐ Saved' : '⭐ Save'}
                              </button>

                              <button
                                onClick={() => handleUpdateJobStatus(job.id || job.jobId, job.status === 'applied' ? 'new' : 'applied')}
                                title={job.status === 'applied' ? 'Mark unapplied' : 'Mark as applied'}
                                style={{
                                  background: job.status === 'applied' ? 'rgba(52, 211, 153, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                  border: job.status === 'applied' ? '1px solid #34d399' : '1px solid rgba(255, 255, 255, 0.1)',
                                  color: job.status === 'applied' ? '#34d399' : '#94a3b8',
                                  padding: '0.35rem 0.55rem',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  fontWeight: 700
                                }}
                              >
                                {job.status === 'applied' ? '✓ Applied' : '💼 Applied'}
                              </button>

                              <button
                                onClick={() => handleUpdateJobStatus(job.id || job.jobId, 'dismissed')}
                                title="Dismiss listing"
                                style={{
                                  background: 'transparent',
                                  border: '1px solid transparent',
                                  color: '#64748b',
                                  padding: '0.35rem 0.45rem',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontSize: '0.75rem'
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Sub-tab 2: Reminders & Schedule */}
            {hermesTab === 'reminders' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <form onSubmit={handleAddReminder} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Add operational reminder (e.g. Review QLoRA weights at 4 PM)..."
                    value={newReminderText}
                    onChange={(e) => setNewReminderText(e.target.value)}
                    style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '0.55rem 0.8rem', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <button
                    type="submit"
                    disabled={!newReminderText.trim()}
                    style={{ background: '#8b5cf6', border: 'none', color: '#fff', padding: '0.55rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {reminders.map(rem => (
                    <div key={rem.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={rem.completed} onChange={() => handleToggleReminder(rem.id)} />
                        <span style={{ fontSize: '0.85rem', color: rem.completed ? '#64748b' : '#f8fafc', textDecoration: rem.completed ? 'line-through' : 'none' }}>
                          {rem.text}
                        </span>
                      </label>
                      <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{new Date(rem.createdAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sub-tab: Fitness — workout log, harvested from norrdev/OpenGym's
                session+exercise data model, not their full program builder. */}
            {hermesTab === 'fitness' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ fontSize: '0.85rem', color: '#c4b5fd', fontWeight: 700 }}>
                  🔥 {calculateWorkoutStreak(workouts)} day streak
                </div>

                {calendarWorkouts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      📅 Upcoming from your calendar
                    </div>
                    {calendarWorkouts
                      .sort((a, b) => new Date(a.start) - new Date(b.start))
                      .map((ev, i) => {
                        const isExpanded = expandedCalendarWorkouts.has(i);
                        const hasDetails = !!ev.description;
                        return (
                          <div key={i} style={{ background: 'rgba(139, 92, 246, 0.06)', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.15)', overflow: 'hidden' }}>
                            <div
                              onClick={() => hasDetails && setExpandedCalendarWorkouts(prev => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i); else next.add(i);
                                return next;
                              })}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 0.8rem', cursor: hasDetails ? 'pointer' : 'default' }}
                            >
                              <span style={{ fontSize: '0.83rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                {hasDetails && (isExpanded ? <ChevronUp size={13} color="#94a3b8" /> : <ChevronDown size={13} color="#94a3b8" />)}
                                {ev.summary}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                                {new Date(ev.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                {' · '}
                                {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            {hasDetails && isExpanded && (
                              <div style={{ padding: '0 0.8rem 0.7rem 0.8rem', fontSize: '0.78rem', color: '#cbd5e1', whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                                {ev.description}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}

                <form onSubmit={handleAddWorkout} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Exercise (e.g. Bench Press)"
                    value={newExerciseName}
                    onChange={(e) => setNewExerciseName(e.target.value)}
                    style={{ flex: '1 1 160px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '0.55rem 0.8rem', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <input
                    type="number"
                    placeholder="Sets"
                    value={newExerciseSets}
                    onChange={(e) => setNewExerciseSets(e.target.value)}
                    style={{ width: '70px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '0.55rem 0.6rem', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <input
                    type="number"
                    placeholder="Reps"
                    value={newExerciseReps}
                    onChange={(e) => setNewExerciseReps(e.target.value)}
                    style={{ width: '70px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '0.55rem 0.6rem', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <input
                    type="number"
                    placeholder="Weight"
                    value={newExerciseWeight}
                    onChange={(e) => setNewExerciseWeight(e.target.value)}
                    style={{ width: '80px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '0.55rem 0.6rem', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <button
                    type="submit"
                    disabled={!newExerciseName.trim()}
                    style={{ background: '#8b5cf6', border: 'none', color: '#fff', padding: '0.55rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <Plus size={14} /> Log
                  </button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[...workouts].sort((a, b) => new Date(b.date) - new Date(a.date)).map(w => (
                    <div key={w.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ fontSize: '0.85rem', color: '#f8fafc' }}>
                        {w.exercises.map(e => `${e.name} ${e.sets ?? '?'}x${e.reps ?? '?'}${e.weight ? ` @ ${e.weight}` : ''}`).join(', ')}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{new Date(w.date).toLocaleDateString()}</span>
                        <button onClick={() => handleDeleteWorkout(w.id)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {workouts.length === 0 && (
                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No workouts logged yet.</div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-tab 3: Budget Health */}
            {hermesTab === 'budget' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: '#8b5cf6' }}>Categorical Budget Spending Pulse</h3>
                {budgetHealth?.categorySpend && Object.keys(budgetHealth.categorySpend).length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    {Object.entries(budgetHealth.categorySpend).map(([cat, amount]) => (
                      <div key={cat} style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{cat}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', marginTop: '0.2rem' }}>${amount.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No categorical expenses recorded this cycle.</div>
                )}

                <h3 style={{ margin: '0.5rem 0 0', fontSize: '0.92rem', fontWeight: 700, color: '#8b5cf6' }}>Stock Portfolio</h3>
                {portfolioSnapshot?.hasData ? (
                  <>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {portfolioSnapshot.gainers} up, {portfolioSnapshot.decliners} down as of {new Date(portfolioSnapshot.checkedAt).toLocaleTimeString()}
                    </div>
                    {portfolioSnapshot.totalValue != null && (
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', margin: '0.25rem 0' }}>
                        ${portfolioSnapshot.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginLeft: '0.5rem' }}>
                          total{portfolioSnapshot.totalValueIsPartial ? ' (partial — some quotes stale/unavailable)' : ''}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                      {portfolioSnapshot.holdings.map((h) => {
                        const up = typeof h.changePercent === 'number' && h.changePercent > 0;
                        const down = typeof h.changePercent === 'number' && h.changePercent < 0;
                        const color = h.ok === false && !h.price ? '#64748b' : (up ? '#4ade80' : down ? '#f87171' : '#f8fafc');
                        const inputValue = shareInputs[h.symbol] !== undefined ? shareInputs[h.symbol] : (h.shares ?? '');
                        return (
                          <div key={h.symbol} style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{h.symbol}{h.stale ? ' (stale)' : ''}</div>
                            {h.ok === false && !h.price ? (
                              <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.2rem' }}>Unavailable</div>
                            ) : (
                              <>
                                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', marginTop: '0.2rem' }}>${h.price}</div>
                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color }}>{up ? '+' : ''}{h.changePercent}%</div>
                                {h.value != null && (
                                  <div style={{ fontSize: '0.8rem', color: '#c4b5fd', marginTop: '0.15rem' }}>
                                    ${h.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} value
                                  </div>
                                )}
                              </>
                            )}
                            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="shares"
                                value={inputValue}
                                onChange={(e) => setShareInputs((prev) => ({ ...prev, [h.symbol]: e.target.value }))}
                                style={{ width: '100%', minWidth: 0, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                              />
                              <button
                                onClick={() => handleSaveShares(h.symbol)}
                                disabled={savingShares === h.symbol || shareInputs[h.symbol] === undefined}
                                style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.3rem 0.5rem', borderRadius: '6px', border: 'none', background: '#8b5cf6', color: '#fff', cursor: shareInputs[h.symbol] === undefined ? 'default' : 'pointer', opacity: shareInputs[h.symbol] === undefined ? 0.5 : 1 }}
                              >
                                {savingShares === h.symbol ? '…' : 'Set'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{portfolioSnapshot?.message || 'Loading portfolio…'}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
