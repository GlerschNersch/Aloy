import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { Eye, RefreshCw, Maximize2, Sparkles, Zap, Coffee, Droplets, Activity } from 'lucide-react-native';

export interface RoomObservation {
  id?: string;
  text?: string;
  badge?: string;
  timestamp?: string;
  imageDataUrl?: string | null;
  triggerReason?: string;
  suggestedAction?: {
    type?: string;
    label?: string;
    icon?: string;
    entity_id?: string;
  } | null;
}

interface RoomObserverBentoTileProps {
  observation?: RoomObservation | null;
  isObserving?: boolean;
  onObserveNow?: () => void;
  onViewSnapshot?: (imageDataUrl: string, obs: RoomObservation) => void;
  formatRelativeTime?: (timestamp?: string) => string;
}

export const RoomObserverBentoTile: React.FC<RoomObserverBentoTileProps> = ({
  observation,
  isObserving = false,
  onObserveNow,
  onViewSnapshot,
  formatRelativeTime = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ready'),
}) => {
  const badge = observation?.badge || 'Ambient Room Observer';
  const text = observation?.text || 'Aloy is monitoring your workstation via Logitech C930e. Tap "Observe Room" to trigger a vision analysis.';
  const timestamp = observation?.timestamp ? formatRelativeTime(observation.timestamp) : 'Logitech C930e Ready';
  const hasImage = Boolean(observation?.imageDataUrl);

  const getBadgeColor = (b: string) => {
    const lower = b.toLowerCase();
    if (lower.includes('focus')) return '#00f2fe';
    if (lower.includes('arrival') || lower.includes('ready')) return '#34d399';
    if (lower.includes('posture') || lower.includes('hydrate')) return '#38bdf8';
    if (lower.includes('phone') || lower.includes('fatigue')) return '#fb923c';
    return '#c084fc';
  };

  const badgeColor = getBadgeColor(badge);

  return (
    <View style={styles.bentoTile}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <View style={styles.iconCircle}>
            <Eye size={15} color="#00f2fe" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Room Observer</Text>
            <Text style={styles.headerSub}>{timestamp}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.observeButton, isObserving && styles.observeButtonDisabled]}
          onPress={onObserveNow}
          disabled={isObserving}
          activeOpacity={0.7}
        >
          {isObserving ? (
            <ActivityIndicator size="small" color="#00f2fe" style={{ marginRight: 4 }} />
          ) : (
            <RefreshCw size={12} color="#00f2fe" style={{ marginRight: 4 }} />
          )}
          <Text style={styles.observeButtonText}>{isObserving ? 'Scanning...' : 'Observe Room'}</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content & Snapshot Thumbnail */}
      <View style={styles.contentRow}>
        {hasImage && (
          <TouchableOpacity
            style={styles.thumbnailContainer}
            onPress={() => onViewSnapshot && observation?.imageDataUrl && onViewSnapshot(observation.imageDataUrl, observation)}
            activeOpacity={0.8}
          >
            <Image
              source={{ uri: observation!.imageDataUrl! }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
            <View style={styles.zoomBadge}>
              <Maximize2 size={9} color="#00f2fe" />
            </View>
          </TouchableOpacity>
        )}

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={[styles.badgePill, { borderColor: `${badgeColor}55`, backgroundColor: `${badgeColor}18` }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{badge.toUpperCase()}</Text>
          </View>
          <Text style={styles.observationText} numberOfLines={3}>
            {text}
          </Text>
        </View>
      </View>

      {/* Action Assist (if available) */}
      {observation?.suggestedAction && (
        <View style={styles.assistPill}>
          <Sparkles size={11} color="#00f2fe" style={{ marginRight: 5 }} />
          <Text style={styles.assistText}>{observation.suggestedAction.label}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  bentoTile: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.3)',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '800',
  },
  headerSub: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
  },
  observeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  observeButtonDisabled: {
    opacity: 0.6,
  },
  observeButtonText: {
    color: '#00f2fe',
    fontSize: 11,
    fontWeight: '700',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  thumbnailContainer: {
    width: 54,
    height: 54,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 242, 254, 0.45)',
    position: 'relative',
    backgroundColor: '#0f172a',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  zoomBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 3,
    padding: 2,
  },
  badgePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  observationText: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 17,
  },
  assistPill: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 242, 254, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  assistText: {
    color: '#00f2fe',
    fontSize: 11,
    fontWeight: '600',
  },
});
