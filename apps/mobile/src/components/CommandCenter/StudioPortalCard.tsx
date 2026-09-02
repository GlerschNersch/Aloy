import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Flame, BookOpen, Shield, Briefcase, Sparkles, ChevronRight } from 'lucide-react-native';

interface StudioPortalCardProps {
  hephTasks: any[];
  hephStats: any;
  athenaTasks: any[];
  serverUrl: string;
  onNavigateCauldron: () => void;
  onNavigateAthena: () => void;
  onNavigateApollo: () => void;
  onNavigateMinerva: () => void;
  onNavigateHermes: () => void;
  onOpenCreateTaskModal: () => void;
  onOpenCreateAthenaModal: () => void;
}

export const StudioPortalCard: React.FC<StudioPortalCardProps> = ({
  hephTasks,
  hephStats,
  athenaTasks,
  serverUrl,
  onNavigateCauldron,
  onNavigateAthena,
  onNavigateApollo,
  onNavigateMinerva,
  onNavigateHermes,
  onOpenCreateTaskModal,
  onOpenCreateAthenaModal,
}) => {
  const stagedTask = hephTasks.find((t) => t.status === 'staged_for_review');
  const activeHeph = hephTasks.filter((t) => t.status !== 'deployed').length;
  const activeAthena = athenaTasks.filter(
    (t) => t.status === 'researching' || t.status === 'synthesizing' || t.status === 'queued'
  ).length;

  return (
    <View style={{ marginTop: 16 }}>
      <View style={styles.hubSectionHeaderRow}>
        <Text style={styles.hubSectionTitle}>🏛️ Autonomous Sub-Agents</Text>
      </View>

      {/* Review Alert if any staged task */}
      {stagedTask && (
        <TouchableOpacity
          style={styles.alertBanner}
          onPress={onNavigateCauldron}
          activeOpacity={0.8}
        >
          <Flame size={16} color="#fbbf24" />
          <View style={{ flex: 1 }}>
            <Text style={styles.alertBannerTitle}>Review Ready: "{stagedTask.title}"</Text>
            <Text style={styles.alertBannerSub}>{stagedTask.aiReview?.score != null ? `Score: ${stagedTask.aiReview.score}/100` : 'Not yet reviewed'} • Tap to inspect diff</Text>
          </View>
          <ChevronRight size={16} color="#fbbf24" />
        </TouchableOpacity>
      )}

      {/* Clean 2-column Grid for all 5 Subagents */}
      <View style={styles.pantheonGrid}>
        {/* 1. Hephaestus */}
        <TouchableOpacity
          style={[styles.pantheonCard, { borderColor: 'rgba(245, 158, 11, 0.3)', backgroundColor: 'rgba(245, 158, 11, 0.06)' }]}
          onPress={onNavigateCauldron}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderRow}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
              <Flame size={16} color="#f59e0b" />
            </View>
            <Text style={[styles.tagBadge, { color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>HEPH</Text>
          </View>
          <Text style={styles.cardTitle}>Hephaestus</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {activeHeph > 0 ? `${activeHeph} active order${activeHeph !== 1 ? 's' : ''}` : 'The Cauldron & Forge'}
          </Text>
        </TouchableOpacity>

        {/* 2. Athena */}
        <TouchableOpacity
          style={[styles.pantheonCard, { borderColor: 'rgba(56, 189, 248, 0.3)', backgroundColor: 'rgba(56, 189, 248, 0.06)' }]}
          onPress={onNavigateAthena}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderRow}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(56, 189, 248, 0.2)' }]}>
              <Sparkles size={16} color="#38bdf8" />
            </View>
            <Text style={[styles.tagBadge, { color: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.2)' }]}>SCOUT</Text>
          </View>
          <Text style={styles.cardTitle}>Athena</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {activeAthena > 0 ? `${activeAthena} active dossier${activeAthena !== 1 ? 's' : ''}` : 'Deep Intelligence'}
          </Text>
        </TouchableOpacity>

        {/* 3. Apollo */}
        <TouchableOpacity
          style={[styles.pantheonCard, { borderColor: 'rgba(251, 191, 36, 0.3)', backgroundColor: 'rgba(251, 191, 36, 0.06)' }]}
          onPress={onNavigateApollo}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderRow}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(251, 191, 36, 0.2)' }]}>
              <BookOpen size={16} color="#fbbf24" />
            </View>
            <Text style={[styles.tagBadge, { color: '#fbbf24', backgroundColor: 'rgba(251, 191, 36, 0.2)' }]}>VAULT</Text>
          </View>
          <Text style={styles.cardTitle}>Apollo</Text>
          <Text style={styles.cardSub} numberOfLines={1}>Knowledge & Memory</Text>
        </TouchableOpacity>

        {/* 4. Minerva */}
        <TouchableOpacity
          style={[styles.pantheonCard, { borderColor: 'rgba(16, 185, 129, 0.3)', backgroundColor: 'rgba(16, 185, 129, 0.06)' }]}
          onPress={onNavigateMinerva}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderRow}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
              <Shield size={16} color="#10b981" />
            </View>
            <Text style={[styles.tagBadge, { color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>SENTINEL</Text>
          </View>
          <Text style={styles.cardTitle}>Minerva</Text>
          <Text style={styles.cardSub} numberOfLines={1}>Reliability & Guard</Text>
        </TouchableOpacity>

        {/* 5. Hermes (Full width spanning 5th card) */}
        <TouchableOpacity
          style={[styles.pantheonCard, styles.pantheonCardFull, { borderColor: 'rgba(139, 92, 246, 0.3)', backgroundColor: 'rgba(139, 92, 246, 0.06)' }]}
          onPress={onNavigateHermes}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                <Briefcase size={16} color="#8b5cf6" />
              </View>
              <Text style={styles.cardTitle}>Hermes</Text>
            </View>
            <Text style={[styles.tagBadge, { color: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>BRIEF & OPS</Text>
          </View>
          <Text style={styles.cardSub} numberOfLines={1}>Daily Pulse, Morning Briefs, Job Radar & Fitness</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  hubSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  hubSectionTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  alertBannerTitle: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
  },
  alertBannerSub: {
    color: '#94a3b8',
    fontSize: 10.5,
    marginTop: 1,
  },
  pantheonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pantheonCard: {
    width: '48.7%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  pantheonCardFull: {
    width: '100%',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagBadge: {
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  cardSub: {
    color: '#94a3b8',
    fontSize: 10.5,
    marginTop: 2,
  },
});
