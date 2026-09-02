import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking , Alert} from 'react-native';
import { Play, Pause, Tv, Film } from 'lucide-react-native';

export interface JellyfinSessionItem {
  id: string;
  userName?: string;
  deviceName?: string;
  client?: string;
  supportsRemoteControl?: boolean;
  playState?: {
    isPaused?: boolean;
    positionTicks?: number;
    volumeLevel?: number;
  };
  nowPlaying?: {
    id?: string;
    name: string;
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    playbackPercent?: number;
    isPaused?: boolean;
    type?: string;
  } | null;
}

interface MediaBentoTileProps {
  jellyfinStatus?: {
    online: boolean;
    serverName?: string;
  } | null;
  activeSessions?: JellyfinSessionItem[];
  activeSession?: JellyfinSessionItem | null;
  serverUrl?: string;
  onTogglePlayPause?: (session: JellyfinSessionItem) => void;
  onOpenCastModal?: () => void;
}

export const MediaBentoTile: React.FC<MediaBentoTileProps> = ({
  jellyfinStatus,
  activeSessions = [],
  activeSession,
  serverUrl,
  onTogglePlayPause,
  onOpenCastModal,
}) => {
  const isOnline = jellyfinStatus?.online ?? false;

  // Combine passed activeSessions or fallback to activeSession
  const streams = (
    activeSessions.length > 0
      ? activeSessions
      : activeSession
      ? [activeSession]
      : []
  ).filter((s) => s.nowPlaying != null);

  const handleTilePress = () => {
    if (onOpenCastModal) {
      onOpenCastModal();
    } else {
      // 127.0.0.1 is the PHONE, not the server, so this fallback opened a dead
      // link whenever serverUrl wasn't a tailnet 100.x address — which is the
      // default LAN IP. Derive the host from serverUrl whatever its
      // form, and say so rather than failing silently if there isn't one.
      const host = serverUrl?.split('://')[1]?.split(':')[0];
      if (!host) {
        Alert.alert('Jellyfin', 'No server address is configured, so Jellyfin cannot be opened.');
        return;
      }
      Linking.openURL(`http://${host}:8096`).catch((err) =>
        Alert.alert('Jellyfin', `Could not open Jellyfin: ${err?.message || 'unknown error'}`));
    }
  };

  return (
    <View style={styles.bentoTile}>
      <TouchableOpacity
        style={styles.bentoIconRow}
        onPress={handleTilePress}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Tv size={16} color="#00f2fe" />
          <Text style={styles.bentoTileHeader}>Media & Cast</Text>
          {streams.length > 1 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{streams.length} Streams</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onOpenCastModal && (
            <Text style={{ color: '#00f2fe', fontSize: 11, fontWeight: '700' }}>Cast Hub →</Text>
          )}
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOnline ? '#34d399' : '#64748b' },
            ]}
          />
        </View>
      </TouchableOpacity>

      {streams.length > 0 ? (
        <View style={{ flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {streams.map((stream) => {
            const np = stream.nowPlaying;
            if (!np) return null;
            const isPaused = stream.playState?.isPaused ?? np.isPaused ?? false;
            const progressPct = np.playbackPercent ?? 0;
            const mediaTitle = np.seriesName
              ? `${np.seriesName} - ${np.name}`
              : np.name || 'Unknown Media';
            const userDev = `${stream.userName ? `${stream.userName} on ` : ''}${stream.deviceName || stream.client || 'Device'}`;

            return (
              <View key={stream.id || mediaTitle} style={styles.streamItem}>
                <View style={styles.streamHeaderRow}>
                  <Text style={styles.mediaTitleText} numberOfLines={1}>
                    {mediaTitle}
                  </Text>
                  <Text style={styles.percentText}>{progressPct}%</Text>
                </View>

                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${progressPct}%`,
                        backgroundColor: isPaused ? '#facc15' : '#00f2fe',
                      },
                    ]}
                  />
                </View>

                <View style={styles.deviceRow}>
                  <Text style={styles.deviceText} numberOfLines={1}>
                    {userDev}
                  </Text>
                  {onTogglePlayPause && (
                    <TouchableOpacity
                      style={[
                        styles.playPauseBtn,
                        isPaused && { backgroundColor: 'rgba(250, 204, 21, 0.15)' },
                      ]}
                      onPress={() => onTogglePlayPause(stream)}
                    >
                      {isPaused ? (
                        <Play size={12} color="#facc15" />
                      ) : (
                        <Pause size={12} color="#00f2fe" />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <TouchableOpacity onPress={handleTilePress} activeOpacity={0.7}>
          <Text style={styles.mediaTitleText} numberOfLines={1}>
            {isOnline ? 'Ready to Cast' : 'Server Offline'}
          </Text>
          <Text style={styles.bentoTileSub}>
            {isOnline ? (jellyfinStatus?.serverName || 'Aloy Media Server') : 'Port 8096 unreachable'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  bentoTile: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.25)',
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  bentoIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  bentoTileHeader: {
    color: '#00f2fe',
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  countBadge: {
    backgroundColor: 'rgba(0, 242, 254, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.4)',
  },
  countBadgeText: {
    color: '#00f2fe',
    fontSize: 9.5,
    fontWeight: '800',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  streamItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  streamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 4,
  },
  mediaTitleText: {
    color: '#f8fafc',
    fontSize: 12.5,
    fontWeight: '700',
    flex: 1,
  },
  percentText: {
    color: '#00f2fe',
    fontSize: 10.5,
    fontWeight: '700',
  },
  track: {
    height: 4,
    backgroundColor: '#1e293b',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deviceText: {
    color: '#64748b',
    fontSize: 10.5,
    flex: 1,
  },
  playPauseBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 242, 254, 0.1)',
  },
  bentoTileSub: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
});
