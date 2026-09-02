import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Flame, Disc3, Sparkles } from 'lucide-react-native';

interface ActiveTickerProps {
  stagedTasks: any[];
  activeAthena: any[];
  activeProjects: any[];
  onPressStaged: () => void;
  onPressAthena: () => void;
  /** True once at least one fetch has succeeded. Distinguishes "nothing
   *  is happening" from "nothing loaded", which look identical otherwise. */
  dataLoaded?: boolean;
}

export const ActiveTicker: React.FC<ActiveTickerProps> = ({
  stagedTasks,
  activeAthena,
  activeProjects,
  onPressStaged,
  onPressAthena,
  dataLoaded = false,
}) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.activeTickerScroll}
      contentContainerStyle={styles.activeTickerContainer}
    >
      {stagedTasks.length > 0 && (
        <TouchableOpacity
          style={[styles.activeTickerPill, styles.activeTickerPillAmber]}
          onPress={onPressStaged}
          activeOpacity={0.7}
        >
          <Flame size={13} color="#f59e0b" />
          <Text style={styles.activeTickerTextAmber}>
            ⚠️ {stagedTasks.length} Work Order{stagedTasks.length > 1 ? 's' : ''} Staged
          </Text>
        </TouchableOpacity>
      )}
      {activeAthena.length > 0 && (
        <TouchableOpacity
          style={[styles.activeTickerPill, styles.activeTickerPillBlue]}
          onPress={onPressAthena}
          activeOpacity={0.7}
        >
          <ActivityIndicator size={11} color="#38bdf8" style={{ marginRight: 4 }} />
          <Text style={styles.activeTickerTextBlue}>
            🦉 Athena: {activeAthena[0].progress}%
          </Text>
        </TouchableOpacity>
      )}
      {activeProjects.map((p) => (
        <View key={p.name} style={[styles.activeTickerPill, styles.activeTickerPillCyan]}>
          <Disc3 size={13} color="#00f2fe" />
          <Text style={styles.activeTickerTextCyan}>
            💿 {p.name}: {p.summary?.progressPct ?? 0}%
          </Text>
        </View>
      ))}
      {/* Three empty arrays is also exactly what a total outage looks like:
          every fetch failing produces the same [] as everything being healthy.
          `dataLoaded` lets the caller distinguish them, so a dead server no
          longer renders a green "All Systems Nominal". */}
      {stagedTasks.length === 0 && activeAthena.length === 0 && activeProjects.length === 0 && (
        <View style={[styles.activeTickerPill, dataLoaded ? styles.activeTickerPillNominal : styles.activeTickerPill]}>
          <Sparkles size={12} color={dataLoaded ? '#34d399' : '#94a3b8'} />
          <Text style={dataLoaded ? styles.activeTickerTextNominal : styles.activeTickerTextCyan}>
            {dataLoaded ? 'All Systems Nominal' : 'No data'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  activeTickerScroll: {
    marginBottom: 16,
  },
  activeTickerContainer: {
    gap: 8,
    paddingRight: 8,
  },
  activeTickerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  activeTickerPillAmber: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  activeTickerTextAmber: {
    color: '#fbbf24',
    fontSize: 11.5,
    fontWeight: '700',
    marginLeft: 5,
  },
  activeTickerPillBlue: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderColor: 'rgba(56, 189, 248, 0.45)',
  },
  activeTickerTextBlue: {
    color: '#38bdf8',
    fontSize: 11.5,
    fontWeight: '700',
    marginLeft: 3,
  },
  activeTickerPillCyan: {
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
    borderColor: 'rgba(0, 242, 254, 0.45)',
  },
  activeTickerTextCyan: {
    color: '#00f2fe',
    fontSize: 11.5,
    fontWeight: '700',
    marginLeft: 5,
  },
  activeTickerPillNominal: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderColor: 'rgba(52, 211, 153, 0.25)',
  },
  activeTickerTextNominal: {
    color: '#34d399',
    fontSize: 11.5,
    fontWeight: '600',
    marginLeft: 5,
  },
});
