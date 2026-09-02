import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BookOpen, Sparkles } from 'lucide-react-native';

interface IntelligenceGridProps {
  skillsState: any;
  newsState: any;
  onNavigateSkills: () => void;
  onNavigateNews: () => void;
}

export const IntelligenceGrid: React.FC<IntelligenceGridProps> = ({
  skillsState,
  newsState,
  onNavigateSkills,
  onNavigateNews,
}) => {
  const avgScore =
    skillsState.skills.length > 0
      ? Math.round(
          skillsState.skills.reduce((acc: number, s: any) => acc + (s.score ?? 0), 0) /
            skillsState.skills.length
        )
      : 0;

  const unreadNews = newsState.articles.filter((a: any) => !a.read).length;

  return (
    <View style={{ marginTop: 14 }}>
      <View style={styles.hubSectionHeaderRow}>
        <Text style={styles.hubSectionTitle}>🧠 Intelligence & Feeds</Text>
      </View>
      <View style={styles.bentoGrid}>
        {/* Skills Tile */}
        <TouchableOpacity
          style={styles.bentoTile}
          onPress={onNavigateSkills}
          activeOpacity={0.7}
        >
          <View style={styles.bentoIconRow}>
            <BookOpen size={18} color="#a855f7" />
            <Text style={styles.bentoTileHeader}>Skills</Text>
          </View>
          <Text style={styles.bentoTileValue}>{skillsState.skills.length} Tracked</Text>
          <Text style={styles.bentoTileSub}>
            Avg Mastery: {avgScore > 0 ? `${avgScore}%` : 'Evaluating'}
          </Text>
        </TouchableOpacity>

        {/* Tech News Tile */}
        <TouchableOpacity
          style={styles.bentoTile}
          onPress={onNavigateNews}
          activeOpacity={0.7}
        >
          <View style={styles.bentoIconRow}>
            <Sparkles size={18} color="#38bdf8" />
            <Text style={styles.bentoTileHeader}>Feeds</Text>
          </View>
          <Text style={styles.bentoTileValue}>
            {unreadNews > 0 ? `${unreadNews} New` : 'Caught Up'}
          </Text>
          <Text style={styles.bentoTileSub} numberOfLines={1}>
            {newsState.articles[0]?.title ?? 'No unread feeds'}
          </Text>
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
    marginBottom: 10,
  },
  hubSectionTitle: {
    color: '#f8fafc',
    fontSize: 14.5,
    fontWeight: '700',
  },
  bentoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  bentoTile: {
    width: '48.5%',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 14,
    padding: 12,
  },
  bentoIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  bentoTileHeader: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  bentoTileValue: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  bentoTileSub: {
    color: '#64748b',
    fontSize: 11,
  },
});
