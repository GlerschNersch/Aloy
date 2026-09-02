import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Lightbulb, Lock, Unlock, Thermometer, Camera } from 'lucide-react-native';

interface EnvironmentBentoProps {
  haCategories: {
    lights: any[];
    locks: any[];
    climates: any[];
  };
  visionStats: {
    count: number;
    lastEventAt: string | null;
  } | null;
  onNavigateSmartHome: () => void;
  onNavigateVision: () => void;
  onAdjustTemp: (entityId: string, currentTemp: number, delta: number) => void;
  formatRelativeTime: (iso: string) => string;
}

export const EnvironmentBento: React.FC<EnvironmentBentoProps> = ({
  haCategories,
  visionStats,
  onNavigateSmartHome,
  onNavigateVision,
  onAdjustTemp,
  formatRelativeTime,
}) => {
  const onLightsCount = haCategories.lights.filter((l) => l.state === 'on').length;
  const lockedCount = haCategories.locks.filter((l) => l.state === 'locked').length;
  // An empty locks array made `lockedCount === locks.length` true (0 === 0), so
  // with no lock data the tile showed a green padlock and the word "Secure".
  const hasLockData = haCategories.locks.length > 0;
  const allLocked = hasLockData && lockedCount === haCategories.locks.length;
  const primaryClimate = haCategories.climates[0];

  return (
    <View>
      <View style={styles.hubSectionHeaderRow}>
        <Text style={styles.hubSectionTitle}>🏠 Environment & Security</Text>
        <TouchableOpacity onPress={onNavigateSmartHome}>
          <Text style={styles.hubSectionLink}>Full Controls →</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bentoGrid}>
        {/* Lights Tile */}
        <TouchableOpacity
          style={styles.bentoTile}
          onPress={onNavigateSmartHome}
          activeOpacity={0.7}
        >
          <View style={styles.bentoIconRow}>
            <Lightbulb size={18} color="#fde047" />
            <Text style={styles.bentoTileHeader}>Lights</Text>
          </View>
          <Text style={styles.bentoTileValue}>
            {onLightsCount} ON
          </Text>
          <Text style={styles.bentoTileSub}>
            {haCategories.lights.length} configured
          </Text>
        </TouchableOpacity>

        {/* Locks Tile */}
        <TouchableOpacity
          style={styles.bentoTile}
          onPress={onNavigateSmartHome}
          activeOpacity={0.7}
        >
          <View style={styles.bentoIconRow}>
            {allLocked ? (
              <Lock size={18} color="#34d399" />
            ) : (
              <Unlock size={18} color="#f87171" />
            )}
            <Text style={styles.bentoTileHeader}>Perimeter</Text>
          </View>
          <Text
            style={[
              styles.bentoTileValue,
              {
                color:
                  !hasLockData ? '#94a3b8' : (allLocked ? '#34d399' : '#f87171'),
              },
            ]}
          >
            {!hasLockData ? 'No data' : (allLocked ? 'Secure' : `${haCategories.locks.length - lockedCount} Unlocked`)}
          </Text>
          <Text style={styles.bentoTileSub}>
            {haCategories.locks.length} locks monitored
          </Text>
        </TouchableOpacity>

        {/* Climate Tile */}
        <View style={styles.bentoTile}>
          <View style={styles.bentoIconRow}>
            <Thermometer size={18} color="#60a5fa" />
            <Text style={styles.bentoTileHeader}>Climate</Text>
          </View>
          <View style={styles.climateControlRow}>
            <Text style={styles.bentoTileValue}>
              {primaryClimate?.attributes?.current_temperature ?? '--'}°
            </Text>
            {primaryClimate && (
              <View style={styles.climateButtonStack}>
                <TouchableOpacity
                  style={styles.climateMiniBtn}
                  onPress={() =>
                    onAdjustTemp(
                      primaryClimate.entity_id,
                      primaryClimate.attributes?.temperature ||
                        primaryClimate.attributes?.target_temp_high ||
                        72,
                      1
                    )
                  }
                >
                  <Text style={styles.climateMiniBtnText}>+</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.climateMiniBtn}
                  onPress={() =>
                    onAdjustTemp(
                      primaryClimate.entity_id,
                      primaryClimate.attributes?.temperature ||
                        primaryClimate.attributes?.target_temp_low ||
                        72,
                      -1
                    )
                  }
                >
                  <Text style={styles.climateMiniBtnText}>−</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          <Text style={styles.bentoTileSub} numberOfLines={1}>
            {primaryClimate?.attributes?.temperature
              ? `Target: ${primaryClimate.attributes.temperature}°`
              : 'Target: Nominal'}
          </Text>
        </View>

        {/* Vision AI Tile */}
        <TouchableOpacity
          style={styles.bentoTile}
          onPress={onNavigateVision}
          activeOpacity={0.7}
        >
          <View style={styles.bentoIconRow}>
            <Camera size={18} color="#c084fc" />
            <Text style={styles.bentoTileHeader}>Vision AI</Text>
          </View>
          <Text style={styles.bentoTileValue}>
            {visionStats?.count ?? 0} Alerts
          </Text>
          <Text style={styles.bentoTileSub} numberOfLines={1}>
            {visionStats?.lastEventAt
              ? formatRelativeTime(visionStats.lastEventAt)
              : 'No alerts'}
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
  hubSectionLink: {
    color: '#00f2fe',
    fontSize: 12.5,
    fontWeight: '600',
  },
  bentoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  bentoTile: {
    width: '48.7%',
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
  climateControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  climateButtonStack: {
    flexDirection: 'row',
    gap: 4,
  },
  climateMiniBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  climateMiniBtnText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
});
