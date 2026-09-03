import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Network, ShieldCheck, Trophy, GitBranch, ChevronRight, Zap } from 'lucide-react-native';

interface FederationBentoTileProps {
  serverUrl?: string;
  peersCount?: number;
  activeWorkflowsCount?: number;
  topStrategy?: { name: string; elo: number; winRate?: number } | null;
  onOpenFederationModal: () => void;
}

export const FederationBentoTile: React.FC<FederationBentoTileProps> = ({
  serverUrl,
  peersCount = 1,
  activeWorkflowsCount = 0,
  topStrategy,
  onOpenFederationModal,
}) => {
  const strategyName = topStrategy?.name || 'Reasoning-Heavy';
  const eloScore = topStrategy?.elo || 1250;

  return (
    <TouchableOpacity
      style={styles.bentoTile}
      onPress={onOpenFederationModal}
      activeOpacity={0.8}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <View style={styles.iconBox}>
            <Network size={16} color="#00f2fe" />
          </View>
          <Text style={styles.headerTitle}>Federation & Arena</Text>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>MESH ACTIVE</Text>
          </View>
        </View>
        <ChevronRight size={16} color="#64748b" />
      </View>

      <Text style={styles.tagline}>
        Zero-Trust Agent Cluster • SPARC Quality Gates
      </Text>

      {/* Grid of 3 Telemetry Metrics */}
      <View style={styles.metricsRow}>
        {/* Federation Peers */}
        <View style={styles.metricItem}>
          <View style={styles.metricHeader}>
            <ShieldCheck size={13} color="#38bdf8" />
            <Text style={styles.metricLabel}>Peers</Text>
          </View>
          <Text style={styles.metricValue}>{peersCount} Node{peersCount !== 1 ? 's' : ''}</Text>
          <Text style={styles.metricSub}>HMAC-SHA256</Text>
        </View>

        {/* SPARC Gates */}
        <View style={styles.metricItem}>
          <View style={styles.metricHeader}>
            <GitBranch size={13} color="#a855f7" />
            <Text style={styles.metricLabel}>SPARC</Text>
          </View>
          <Text style={styles.metricValue}>
            {activeWorkflowsCount > 0 ? `${activeWorkflowsCount} Active` : 'Gated'}
          </Text>
          <Text style={styles.metricSub}>5-Phase QA</Text>
        </View>

        {/* Agent Arena */}
        <View style={styles.metricItem}>
          <View style={styles.metricHeader}>
            <Trophy size={13} color="#f59e0b" />
            <Text style={styles.metricLabel}>Arena ELO</Text>
          </View>
          <Text style={styles.metricValue}>{eloScore}</Text>
          <Text style={styles.metricSub} numberOfLines={1}>{strategyName.split('-')[0]}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  bentoTile: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.25)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 14.5,
    fontWeight: '700',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#34d399',
  },
  liveText: {
    color: '#34d399',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  tagline: {
    color: '#94a3b8',
    fontSize: 11.5,
    marginBottom: 12,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 1,
  },
  metricSub: {
    color: '#64748b',
    fontSize: 9.5,
    fontWeight: '500',
  },
});
