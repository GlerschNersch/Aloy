import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export interface MetricItem {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ComponentType<{ size: number; color: string }>;
  color?: string;
  onPress?: () => void;
}

interface PulseGridProps {
  metrics: MetricItem[];
}

export const PulseGrid: React.FC<PulseGridProps> = ({ metrics }) => {
  if (!metrics || metrics.length === 0) return null;

  return (
    <View style={styles.grid}>
      {metrics.map((metric, idx) => {
        const Icon = metric.icon;
        const color = metric.color || '#00f2fe';
        const isClickable = Boolean(metric.onPress);

        return (
          <TouchableOpacity
            key={metric.label || idx}
            style={[
              styles.card,
              { borderColor: `${color}28`, backgroundColor: 'rgba(15, 23, 42, 0.95)' },
            ]}
            onPress={metric.onPress}
            disabled={!isClickable}
            activeOpacity={0.7}
          >
            <View style={styles.topRow}>
              <Text style={styles.label}>{metric.label}</Text>
              {Icon && (
                <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}>
                  <Icon size={12} color={color} />
                </View>
              )}
            </View>

            <Text style={styles.value} numberOfLines={1}>
              {metric.value}
            </Text>

            {metric.subtext && (
              <Text style={[styles.subtext, { color }]} numberOfLines={1}>
                {metric.subtext}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    minWidth: '47%',
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  value: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  subtext: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
});
