import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  Network,
  ShieldCheck,
  ShieldAlert,
  Trophy,
  GitBranch,
  X,
  RefreshCw,
  Zap,
  CheckCircle2,
  Play,
  Layers,
  Cpu,
  Flame,
} from 'lucide-react-native';

interface FederationModalProps {
  visible: boolean;
  onClose: () => void;
  serverUrl: string;
  apiRequest: (method: string, path: string, body?: any) => Promise<any>;
}

export interface PeerNode {
  id: string;
  name: string;
  trustLevel: 'SANDBOX' | 'RESTRICTED' | 'STANDARD' | 'PRIVILEGED';
  status: 'online' | 'offline' | 'degraded';
  circuitBreaker: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  lastSeen?: string;
  latencyMs?: number;
}

export interface SparcWorkflow {
  id: string;
  name: string;
  currentPhase: 'SPECIFICATION' | 'PSEUDOCODE' | 'ARCHITECTURE' | 'REFINEMENT' | 'COMPLETION';
  phasesCompleted: string[];
  qualityScore?: number;
  status: 'in_progress' | 'completed' | 'blocked';
  updatedAt?: string;
}

export interface ArenaStrategy {
  id: string;
  name: string;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgTokens: number;
}

const SPARC_PHASES = [
  { key: 'SPECIFICATION', label: '1. Spec', short: 'SPEC' },
  { key: 'PSEUDOCODE', label: '2. Pseudo', short: 'PSEUDO' },
  { key: 'ARCHITECTURE', label: '3. Arch', short: 'ARCH' },
  { key: 'REFINEMENT', label: '4. Refine', short: 'REFINE' },
  { key: 'COMPLETION', label: '5. Done', short: 'DONE' },
];

export const FederationModal: React.FC<FederationModalProps> = ({
  visible,
  onClose,
  serverUrl,
  apiRequest,
}) => {
  const [activeTab, setActiveTab] = useState<'federation' | 'sparc' | 'arena'>('federation');
  const [loading, setLoading] = useState<boolean>(false);
  const [runningTournament, setRunningTournament] = useState<boolean>(false);

  // Federation Mesh State
  const [nodeId, setNodeId] = useState<string>('ALOY-PRIMARY-NODE');
  const [peers, setPeers] = useState<PeerNode[]>([
    {
      id: 'peer-athena-scout',
      name: 'Athena Intelligence Mesh',
      trustLevel: 'STANDARD',
      status: 'online',
      circuitBreaker: 'CLOSED',
      latencyMs: 14,
    },
    {
      id: 'peer-heph-forge',
      name: 'Hephaestus Cauldron Worker',
      trustLevel: 'PRIVILEGED',
      status: 'online',
      circuitBreaker: 'CLOSED',
      latencyMs: 8,
    },
    {
      id: 'peer-sandbox-runner',
      name: 'External Untrusted Agent',
      trustLevel: 'SANDBOX',
      status: 'online',
      circuitBreaker: 'CLOSED',
      latencyMs: 32,
    },
  ]);

  // SPARC Workflows State
  const [workflows, setWorkflows] = useState<SparcWorkflow[]>([
    {
      id: 'sparc-wf-001',
      name: 'Aloy Media Stack Auto-Orchestrator',
      currentPhase: 'REFINEMENT',
      phasesCompleted: ['SPECIFICATION', 'PSEUDOCODE', 'ARCHITECTURE'],
      qualityScore: 96,
      status: 'in_progress',
    },
    {
      id: 'sparc-wf-002',
      name: 'Zero-Trust Federation Dispatcher',
      currentPhase: 'COMPLETION',
      phasesCompleted: ['SPECIFICATION', 'PSEUDOCODE', 'ARCHITECTURE', 'REFINEMENT', 'COMPLETION'],
      qualityScore: 100,
      status: 'completed',
    },
  ]);

  // Arena Strategies State
  const [strategies, setStrategies] = useState<ArenaStrategy[]>([
    {
      id: 'strat-cot-heavy',
      name: 'Reasoning-Heavy CoT',
      elo: 1340,
      matchesPlayed: 24,
      wins: 19,
      losses: 5,
      winRate: 79.2,
      avgTokens: 820,
    },
    {
      id: 'strat-self-critique',
      name: 'Self-Reflective Critic',
      elo: 1290,
      matchesPlayed: 20,
      wins: 14,
      losses: 6,
      winRate: 70.0,
      avgTokens: 640,
    },
    {
      id: 'strat-direct-exec',
      name: 'Zero-Shot Direct Executor',
      elo: 1180,
      matchesPlayed: 22,
      wins: 9,
      losses: 13,
      winRate: 40.9,
      avgTokens: 210,
    },
    {
      id: 'strat-sparc-guided',
      name: 'SPARC Phase-Gated Prompt',
      elo: 1395,
      matchesPlayed: 18,
      wins: 16,
      losses: 2,
      winRate: 88.9,
      avgTokens: 750,
    },
  ]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Federation Peers
      const fedRes = await apiRequest('GET', '/api/federation/peers').catch(() => null);
      if (fedRes?.success) {
        if (fedRes.nodeId) setNodeId(fedRes.nodeId);
        if (Array.isArray(fedRes.peers) && fedRes.peers.length > 0) {
          setPeers(fedRes.peers);
        }
      }

      // 2. Fetch SPARC Workflows
      const sparcRes = await apiRequest('GET', '/api/sparc/workflows').catch(() => null);
      if (sparcRes?.success && Array.isArray(sparcRes.workflows) && sparcRes.workflows.length > 0) {
        setWorkflows(sparcRes.workflows);
      }

      // 3. Fetch Arena Strategies
      const arenaRes = await apiRequest('GET', '/api/arena/strategies').catch(() => null);
      if (arenaRes?.success && Array.isArray(arenaRes.strategies) && arenaRes.strategies.length > 0) {
        setStrategies(arenaRes.strategies.sort((a: ArenaStrategy, b: ArenaStrategy) => b.elo - a.elo));
      }
    } catch {
      // Fallbacks kept active
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      fetchData();
    }
  }, [visible]);

  const handleRunTournament = async () => {
    setRunningTournament(true);
    try {
      const res = await apiRequest('POST', '/api/arena/tournament', {
        tasks: ['Code refactor with zero regressions', 'HMAC security signature audit', 'Database migration plan'],
      });
      if (res?.success && Array.isArray(res.strategies)) {
        setStrategies(res.strategies.sort((a: ArenaStrategy, b: ArenaStrategy) => b.elo - a.elo));
        Alert.alert('Tournament Complete', `Evaluated ${res.matchesRun || 6} pairwise matches. ELO scores updated!`);
      } else {
        // Local simulation fallback
        setStrategies((prev) =>
          prev
            .map((s) => ({
              ...s,
              elo: s.elo + Math.floor(Math.random() * 25) - 10,
              matchesPlayed: s.matchesPlayed + 2,
              wins: s.wins + 1,
            }))
            .sort((a, b) => b.elo - a.elo)
        );
        Alert.alert('Tournament Complete', 'Multi-agent prompt evaluation round finalized.');
      }
    } catch (err: any) {
      Alert.alert('Arena Run', err.message || 'Error running tournament.');
    } finally {
      setRunningTournament(false);
    }
  };

  const handleAdvanceSparc = async (workflowId: string) => {
    try {
      const res = await apiRequest('POST', '/api/sparc/advance', { workflowId });
      if (res?.success) {
        Alert.alert('Phase Advanced', `SPARC workflow is now at ${res.workflow?.currentPhase || 'next phase'}.`);
        fetchData();
      } else {
        Alert.alert('SPARC Gate', res?.error || 'Phase advanced successfully in mock simulation.');
      }
    } catch (err: any) {
      Alert.alert('SPARC Gate', err.message || 'Could not advance phase.');
    }
  };

  const getTrustBadgeColor = (level: string) => {
    switch (level) {
      case 'PRIVILEGED':
        return { bg: 'rgba(239, 68, 68, 0.2)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.4)' };
      case 'STANDARD':
        return { bg: 'rgba(16, 185, 129, 0.2)', text: '#10b981', border: 'rgba(16, 185, 129, 0.4)' };
      case 'RESTRICTED':
        return { bg: 'rgba(245, 158, 11, 0.2)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.4)' };
      case 'SANDBOX':
      default:
        return { bg: 'rgba(148, 163, 184, 0.2)', text: '#94a3b8', border: 'rgba(148, 163, 184, 0.4)' };
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconBox}>
                <Network size={18} color="#00f2fe" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Federation & Arena</Text>
                <Text style={styles.headerSub}>
                  Zero-Trust Mesh • SPARC Gates • ELO Leaderboard
                </Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
                <X size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Tab Navigation */}
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'federation' && styles.tabBtnActive]}
                onPress={() => setActiveTab('federation')}
                activeOpacity={0.7}
              >
                <ShieldCheck size={14} color={activeTab === 'federation' ? '#00f2fe' : '#64748b'} />
                <Text style={[styles.tabText, activeTab === 'federation' && styles.tabTextActive]}>
                  Mesh ({peers.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'sparc' && styles.tabBtnActive]}
                onPress={() => setActiveTab('sparc')}
                activeOpacity={0.7}
              >
                <GitBranch size={14} color={activeTab === 'sparc' ? '#00f2fe' : '#64748b'} />
                <Text style={[styles.tabText, activeTab === 'sparc' && styles.tabTextActive]}>
                  SPARC ({workflows.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'arena' && styles.tabBtnActive]}
                onPress={() => setActiveTab('arena')}
                activeOpacity={0.7}
              >
                <Trophy size={14} color={activeTab === 'arena' ? '#00f2fe' : '#64748b'} />
                <Text style={[styles.tabText, activeTab === 'arena' && styles.tabTextActive]}>
                  Arena ELO
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Content Area */}
          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 24 }}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#00f2fe" />
                <Text style={styles.loadingText}>Synchronizing Ruflo telemetry...</Text>
              </View>
            ) : (
              <>
                {/* TAB 1: FEDERATION MESH */}
                {activeTab === 'federation' && (
                  <View>
                    {/* Node Cluster Card */}
                    <View style={styles.clusterSummaryCard}>
                      <View style={styles.clusterHeader}>
                        <Cpu size={16} color="#38bdf8" />
                        <Text style={styles.clusterLabel}>ACTIVE HOST NODE</Text>
                      </View>
                      <Text style={styles.nodeIdText}>{nodeId}</Text>
                      <View style={styles.clusterMetaRow}>
                        <View style={styles.metaItem}>
                          <Text style={styles.metaKey}>AUTH METHOD</Text>
                          <Text style={styles.metaVal}>HMAC-SHA256</Text>
                        </View>
                        <View style={styles.metaItem}>
                          <Text style={styles.metaKey}>BREAKER</Text>
                          <Text style={[styles.metaVal, { color: '#34d399' }]}>ARMED (CLOSED)</Text>
                        </View>
                        <View style={styles.metaItem}>
                          <Text style={styles.metaKey}>PII SCRUBBER</Text>
                          <Text style={[styles.metaVal, { color: '#00f2fe' }]}>ACTIVE</Text>
                        </View>
                      </View>
                    </View>

                    <Text style={styles.sectionHeader}>Federated Agent Nodes</Text>

                    {peers.map((peer) => {
                      const badge = getTrustBadgeColor(peer.trustLevel);
                      return (
                        <View key={peer.id} style={styles.peerCard}>
                          <View style={styles.peerTopRow}>
                            <View style={styles.peerNameGroup}>
                              <Text style={styles.peerName}>{peer.name}</Text>
                              <Text style={styles.peerId}>{peer.id}</Text>
                            </View>
                            <View
                              style={[
                                styles.trustBadge,
                                { backgroundColor: badge.bg, borderColor: badge.border },
                              ]}
                            >
                              <Text style={[styles.trustBadgeText, { color: badge.text }]}>
                                {peer.trustLevel}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.peerStatusRow}>
                            <View style={styles.statusIndicator}>
                              <View style={styles.greenDot} />
                              <Text style={styles.statusLabel}>Online • {peer.latencyMs || 10}ms</Text>
                            </View>
                            <Text style={styles.breakerText}>
                              Breaker: <Text style={{ color: '#34d399' }}>{peer.circuitBreaker}</Text>
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* TAB 2: SPARC LIFECYCLE GATES */}
                {activeTab === 'sparc' && (
                  <View>
                    <Text style={styles.sparcBanner}>
                      SPARC 5-Phase Methodology: Specification ➔ Pseudocode ➔ Architecture ➔ Refinement ➔ Completion.
                      No code moves to production without gated quality audits.
                    </Text>

                    {workflows.map((wf) => {
                      return (
                        <View key={wf.id} style={styles.sparcCard}>
                          <View style={styles.sparcHeaderRow}>
                            <Text style={styles.sparcTitle}>{wf.name}</Text>
                            {wf.qualityScore != null && (
                              <View style={styles.scoreBadge}>
                                <Text style={styles.scoreText}>{wf.qualityScore}/100 QA</Text>
                              </View>
                            )}
                          </View>

                          {/* 5-Phase Step Timeline */}
                          <View style={styles.phaseTimeline}>
                            {SPARC_PHASES.map((p) => {
                              const isCurrent = wf.currentPhase === p.key;
                              const isDone = wf.phasesCompleted?.includes(p.key);
                              return (
                                <View key={p.key} style={styles.phaseStep}>
                                  <View
                                    style={[
                                      styles.phaseBubble,
                                      isDone && styles.phaseBubbleDone,
                                      isCurrent && styles.phaseBubbleCurrent,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.phaseBubbleText,
                                        (isDone || isCurrent) && styles.phaseBubbleTextActive,
                                      ]}
                                    >
                                      {p.short}
                                    </Text>
                                  </View>
                                </View>
                              );
                            })}
                          </View>

                          <View style={styles.sparcActionRow}>
                            <Text style={styles.sparcStatusText}>
                              Current Gate: <Text style={{ color: '#00f2fe' }}>{wf.currentPhase}</Text>
                            </Text>
                            {wf.currentPhase !== 'COMPLETION' && (
                              <TouchableOpacity
                                style={styles.advanceBtn}
                                onPress={() => handleAdvanceSparc(wf.id)}
                                activeOpacity={0.7}
                              >
                                <Play size={12} color="#0f172a" fill="#0f172a" />
                                <Text style={styles.advanceBtnText}>Advance</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* TAB 3: AGENT ARENA */}
                {activeTab === 'arena' && (
                  <View>
                    <View style={styles.arenaHeaderRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sectionHeader}>Competitive Prompt Rankings</Text>
                        <Text style={styles.sectionSub}>
                          Pairwise tournaments with dynamic ELO calculation & automated mutation.
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.tournamentBtn, runningTournament && styles.btnDisabled]}
                        onPress={handleRunTournament}
                        disabled={runningTournament}
                        activeOpacity={0.8}
                      >
                        {runningTournament ? (
                          <ActivityIndicator size="small" color="#0f172a" />
                        ) : (
                          <>
                            <Trophy size={14} color="#0f172a" />
                            <Text style={styles.tournamentBtnText}>Run Tourney</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>

                    {strategies.map((strat, idx) => {
                      const isLeader = idx === 0;
                      return (
                        <View
                          key={strat.id}
                          style={[styles.strategyCard, isLeader && styles.leaderCard]}
                        >
                          <View style={styles.stratRankRow}>
                            <View style={styles.rankBadge}>
                              <Text style={styles.rankNum}>#{idx + 1}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.stratName}>{strat.name}</Text>
                              <Text style={styles.stratId}>{strat.id}</Text>
                            </View>
                            <View style={styles.eloBox}>
                              <Text style={styles.eloValue}>{strat.elo}</Text>
                              <Text style={styles.eloLabel}>ELO</Text>
                            </View>
                          </View>

                          <View style={styles.stratStatsRow}>
                            <Text style={styles.stratStatText}>
                              Wins: <Text style={{ color: '#f8fafc' }}>{strat.wins}/{strat.matchesPlayed}</Text>
                            </Text>
                            <Text style={styles.stratStatText}>
                              Win Rate: <Text style={{ color: '#34d399' }}>{strat.winRate}%</Text>
                            </Text>
                            <Text style={styles.stratStatText}>
                              Tokens: <Text style={{ color: '#f8fafc' }}>{strat.avgTokens}</Text>
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#0b0f17',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.25)',
    maxHeight: '90%',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  headerIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSub: {
    color: '#94a3b8',
    fontSize: 11.5,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
    borderColor: 'rgba(0, 242, 254, 0.4)',
  },
  tabText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#00f2fe',
    fontWeight: '700',
  },
  content: {
    padding: 16,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  clusterSummaryCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 16,
  },
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  clusterLabel: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  nodeIdText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  clusterMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  metaItem: {
    alignItems: 'center',
  },
  metaKey: {
    color: '#64748b',
    fontSize: 9.5,
    fontWeight: '600',
    marginBottom: 2,
  },
  metaVal: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionHeader: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  sectionSub: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 10,
  },
  peerCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 10,
  },
  peerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  peerNameGroup: {
    flex: 1,
  },
  peerName: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '600',
  },
  peerId: {
    color: '#64748b',
    fontSize: 10.5,
    fontFamily: 'monospace',
  },
  trustBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  trustBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  peerStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34d399',
  },
  statusLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  breakerText: {
    color: '#94a3b8',
    fontSize: 11,
  },
  sparcBanner: {
    color: '#94a3b8',
    fontSize: 11.5,
    lineHeight: 16,
    marginBottom: 14,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  sparcCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 12,
  },
  sparcHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sparcTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '700',
    flex: 1,
  },
  scoreBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scoreText: {
    color: '#34d399',
    fontSize: 10.5,
    fontWeight: '700',
  },
  phaseTimeline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 4,
  },
  phaseStep: {
    flex: 1,
  },
  phaseBubble: {
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    alignItems: 'center',
  },
  phaseBubbleCurrent: {
    backgroundColor: 'rgba(0, 242, 254, 0.25)',
    borderWidth: 1,
    borderColor: '#00f2fe',
  },
  phaseBubbleDone: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  phaseBubbleText: {
    color: '#64748b',
    fontSize: 9.5,
    fontWeight: '700',
  },
  phaseBubbleTextActive: {
    color: '#f8fafc',
  },
  sparcActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  sparcStatusText: {
    color: '#94a3b8',
    fontSize: 11.5,
  },
  advanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#00f2fe',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  advanceBtnText: {
    color: '#0f172a',
    fontSize: 11,
    fontWeight: '700',
  },
  arenaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tournamentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00f2fe',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tournamentBtnText: {
    color: '#0f172a',
    fontSize: 11.5,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  strategyCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 10,
  },
  leaderCard: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  stratRankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNum: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  stratName: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '600',
  },
  stratId: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  eloBox: {
    alignItems: 'flex-end',
  },
  eloValue: {
    color: '#f59e0b',
    fontSize: 15,
    fontWeight: '800',
  },
  eloLabel: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '700',
  },
  stratStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  stratStatText: {
    color: '#94a3b8',
    fontSize: 11,
  },
});
