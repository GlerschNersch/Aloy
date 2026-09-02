import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import {
  Tv,
  Film,
  Music,
  Gamepad2,
  ExternalLink,
  RefreshCw,
  Power,
  Layers,
  X,
  CheckCircle2,
  DownloadCloud,
  HardDrive,
} from 'lucide-react-native';

interface MediaStackModalProps {
  visible: boolean;
  onClose: () => void;
  serverUrl: string;
  apiRequest: (method: string, path: string, body?: any) => Promise<any>;
}

interface ArrQueueItem {
  id: string;
  service: string;
  mediaType: string;
  title: string;
  size: number;
  sizeleft: number;
  timeleft?: string | null;
  status: string;
  downloadClient?: string;
  indexer?: string;
}

const SERVICES = [
  {
    id: 'sonarr',
    name: 'Sonarr',
    tag: 'TV Shows',
    port: 8989,
    icon: Tv,
    accent: '#00f2fe',
    description: 'TV Series automation, season monitoring & episode grabber',
  },
  {
    id: 'radarr',
    name: 'Radarr',
    tag: 'Movies',
    port: 7878,
    icon: Film,
    accent: '#f59e0b',
    description: 'Movie collection manager, quality profile matching & tracker',
  },
  {
    id: 'lidarr',
    name: 'Lidarr',
    tag: 'Music',
    port: 8686,
    icon: Music,
    accent: '#ec4899',
    description: 'Artist discography, album scraper & lossless audio collector',
  },
  {
    id: 'retroarr',
    name: 'RetroArr',
    tag: 'Games',
    port: 5002,
    icon: Gamepad2,
    accent: '#c084fc',
    description: 'PC & console game manager, ROM tracker & emulator hub',
  },
];

export const MediaStackModal: React.FC<MediaStackModalProps> = ({
  visible,
  onClose,
  serverUrl,
  apiRequest,
}) => {
  const [activeTab, setActiveTab] = useState<'services' | 'queue'>('services');
  const [queue, setQueue] = useState<ArrQueueItem[]>([]);
  const [status, setStatus] = useState<{ [key: string]: boolean }>({
    sonarr: true,
    radarr: true,
    lidarr: true,
    retroarr: true,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    };
  }, []);

  const resolveServiceUrl = (port: number): string => {
    try {
      // In React Native or standard URL parser
      const match = serverUrl.match(/^(https?:\/\/)([^:/]+)/);
      if (match) {
        return `${match[1]}${match[2]}:${port}`;
      }
      return `http://localhost:${port}`;
    } catch {
      return `http://localhost:${port}`;
    }
  };

  const fetchQueueAndStatus = async () => {
    try {
      const res = await apiRequest('GET', '/api/arr/queue');
      if (res && res.success) {
        setQueue(Array.isArray(res.queue) ? res.queue : []);
        setStatus({
          sonarr: !!res.sonarrConnected,
          radarr: !!res.radarrConnected,
          lidarr: !!res.lidarrConnected,
          retroarr: res.retroarrConnected !== false,
        });
      }
    } catch {}
  };

  // This component is mounted for the app's whole lifetime — App.tsx renders
  // it unconditionally and only the RN <Modal>'s own `visible` toggles what's
  // on screen — so this effect (and its interval) keeps running whether the
  // sheet is open or not. That matters: without a background poll, closing
  // the sheet freezes `status` at whatever it last saw, and reopening it
  // could show a stale snapshot from minutes (or a service restart) ago
  // instead of the current state. Polls faster while actually visible (6s,
  // for responsiveness) and slower in the background (30s, plenty fresh
  // without hammering the server or battery for a screen nobody's looking at).
  useEffect(() => {
    if (visible) setLoading(true);
    fetchQueueAndStatus().finally(() => { if (visible) setLoading(false); });
    const interval = setInterval(fetchQueueAndStatus, visible ? 6000 : 30000);
    return () => clearInterval(interval);
  }, [visible]);

  const handleLaunchService = async (port: number, name: string) => {
    const url = resolveServiceUrl(port);
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(url);
      }
    } catch (err: any) {
      Alert.alert(`Could not open ${name}`, `${url}\n${err?.message || ''}`);
    }
  };

  const doRestart = async (id: string, name: string) => {
    setRestartingId(id);
    try {
      const endpoint = id === 'all' ? '/api/arr/stack/restart' : `/api/arr/service/${id}/restart`;
      const res = await apiRequest('POST', endpoint);
      if (res && res.success === false) {
        Alert.alert(`Restart failed`, res.error || `Could not restart ${name}.`);
      }
    } catch (err: any) {
      Alert.alert(`Restart failed`, err?.message || `Could not restart ${name}.`);
    } finally {
      // Give the process a moment to bind its port before re-checking.
      restartTimeoutRef.current = setTimeout(() => {
        fetchQueueAndStatus().finally(() => setRestartingId(null));
      }, 3000);
    }
  };

  const handleRestartService = (id: string, name: string, isOnline: boolean) => {
    if (restartingId) return;
    Alert.alert(
      isOnline ? `Restart ${name}?` : `Start ${name}?`,
      isOnline
        ? `This will stop and restart ${name} on your PC.`
        : `${name} appears offline. This will start it on your PC.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: isOnline ? 'Restart' : 'Start', style: 'default', onPress: () => doRestart(id, name) },
      ]
    );
  };

  const onlineCount = Object.values(status).filter(Boolean).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleGroup}>
              <View style={styles.headerIconBox}>
                <Layers size={18} color="#00f2fe" />
              </View>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.headerTitle}>Media Stack Hub</Text>
                  <View style={styles.badgePill}>
                    <Text style={styles.badgeText}>ARR STACK</Text>
                  </View>
                </View>
                <Text style={styles.headerSubtitle}>
                  {onlineCount}/4 Online · Sonarr, Radarr, Lidarr, RetroArr
                </Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {/* Sub Tab Switcher */}
          <View style={styles.tabBarRow}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'services' && styles.tabBtnActive]}
              onPress={() => setActiveTab('services')}
            >
              <HardDrive size={14} color={activeTab === 'services' ? '#00f2fe' : '#64748b'} />
              <Text style={[styles.tabBtnText, activeTab === 'services' && styles.tabBtnTextActive]}>
                Services ({SERVICES.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'queue' && styles.tabBtnActive]}
              onPress={() => setActiveTab('queue')}
            >
              <DownloadCloud size={14} color={activeTab === 'queue' ? '#00f2fe' : '#64748b'} />
              <Text style={[styles.tabBtnText, activeTab === 'queue' && styles.tabBtnTextActive]}>
                Queue ({queue.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="restart-all-btn"
              style={styles.refreshBtn}
              onPress={() =>
                Alert.alert('Restart Media Stack?', 'This restarts every service in the Media Stack on your PC.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Restart All', style: 'default', onPress: () => doRestart('all', 'the Media Stack') },
                ])
              }
              disabled={!!restartingId}
            >
              {restartingId === 'all' ? (
                <ActivityIndicator size="small" color="#00f2fe" />
              ) : (
                <Power size={13} color="#00f2fe" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={() => {
                setLoading(true);
                fetchQueueAndStatus().finally(() => setLoading(false));
              }}
            >
              <RefreshCw size={13} color="#00f2fe" />
            </TouchableOpacity>
          </View>

          {/* Body */}
          {loading && queue.length === 0 ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#00f2fe" />
              <Text style={styles.loadingText}>Checking Media Stack connectivity...</Text>
            </View>
          ) : activeTab === 'services' ? (
            <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
              <View style={styles.servicesGrid}>
                {SERVICES.map((srv) => {
                  const IconComp = srv.icon;
                  const isOnline = status[srv.id] !== false;
                  const serviceUrl = resolveServiceUrl(srv.port);

                  return (
                    <View key={srv.id} style={styles.serviceCard}>
                      <View style={styles.serviceCardHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                          <View style={[styles.serviceIconBox, { backgroundColor: `${srv.accent}20` }]}>
                            <IconComp size={18} color={srv.accent} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.serviceName}>{srv.name}</Text>
                              <View
                                style={[
                                  styles.statusDot,
                                  { backgroundColor: isOnline ? '#22c55e' : '#ef4444' },
                                ]}
                              />
                            </View>
                            <Text style={[styles.serviceTag, { color: srv.accent }]}>
                              Port {srv.port} · {srv.tag}
                            </Text>
                          </View>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <TouchableOpacity
                            testID={`restart-${srv.id}-btn`}
                            style={[
                              styles.restartBtn,
                              { backgroundColor: isOnline ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.16)', borderColor: isOnline ? 'rgba(255,255,255,0.12)' : 'rgba(239,68,68,0.4)' },
                            ]}
                            onPress={() => handleRestartService(srv.id, srv.name, isOnline)}
                            activeOpacity={0.7}
                            disabled={!!restartingId}
                          >
                            {restartingId === srv.id ? (
                              <ActivityIndicator size="small" color={isOnline ? '#94a3b8' : '#ef4444'} />
                            ) : (
                              <Power size={13} color={isOnline ? '#94a3b8' : '#ef4444'} />
                            )}
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.launchBtn, { backgroundColor: `${srv.accent}22`, borderColor: `${srv.accent}55` }]}
                            onPress={() => handleLaunchService(srv.port, srv.name)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.launchBtnText, { color: srv.accent }]}>Open UI</Text>
                            <ExternalLink size={12} color={srv.accent} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <Text style={styles.serviceDesc}>{srv.description}</Text>

                      <View style={styles.serviceFooter}>
                        <Text style={styles.serviceUrlText} numberOfLines={1}>
                          {serviceUrl}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={styles.infoBanner}>
                <Text style={styles.infoBannerText}>
                  💡 Services run locally on your PC stack and are accessible over Tailscale on your mobile device.
                </Text>
              </View>
            </ScrollView>
          ) : (
            <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
              {queue.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <CheckCircle2 size={36} color="#34d399" />
                  <Text style={styles.emptyTitle}>Download Queue Clear</Text>
                  <Text style={styles.emptySubtitle}>
                    All monitored TV shows, movies, albums, and games have finished importing.
                  </Text>
                </View>
              ) : (
                <View style={styles.queueList}>
                  {queue.map((item, idx) => {
                    const progressPct =
                      item.size > 0
                        ? Math.max(0, Math.min(100, Math.round(((item.size - item.sizeleft) / item.size) * 100)))
                        : 0;

                    const serviceColor =
                      item.service === 'sonarr'
                        ? '#00f2fe'
                        : item.service === 'lidarr'
                        ? '#ec4899'
                        : item.service === 'retroarr'
                        ? '#c084fc'
                        : '#f59e0b';

                    return (
                      <View key={item.id || idx} style={styles.queueItemCard}>
                        <View style={styles.queueHeader}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={styles.queueTitle} numberOfLines={1}>
                              {item.title}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                              <View style={[styles.servicePill, { backgroundColor: `${serviceColor}22` }]}>
                                <Text style={[styles.servicePillText, { color: serviceColor }]}>
                                  {item.service.toUpperCase()}
                                </Text>
                              </View>
                              <Text style={styles.queueMetaText}>
                                {item.downloadClient || 'SABnzbd'} · {item.status}
                              </Text>
                            </View>
                          </View>
                          <Text style={[styles.queuePctText, { color: serviceColor }]}>
                            {progressPct}%
                          </Text>
                        </View>

                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${progressPct}%`, backgroundColor: serviceColor },
                            ]}
                          />
                        </View>

                        <View style={styles.queueFooter}>
                          <Text style={styles.queueMetaText}>
                            ETA: {item.timeleft || 'Calculating...'}
                          </Text>
                          <Text style={styles.queueMetaText}>
                            {item.size ? `${Math.round(item.size / 1048576)} MB` : ''}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          )}
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
  modalContent: {
    height: '92%',
    backgroundColor: '#0a0e17',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    display: 'flex',
    flexDirection: 'column',
  },
  headerRow: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#f8fafc',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  badgePill: {
    backgroundColor: 'rgba(0, 242, 254, 0.18)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.3)',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#00f2fe',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  tabBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    borderColor: 'rgba(0, 242, 254, 0.4)',
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tabBtnTextActive: {
    color: '#00f2fe',
    fontWeight: '700',
  },
  refreshBtn: {
    marginLeft: 'auto',
    padding: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 242, 254, 0.1)',
  },
  scrollArea: {
    flex: 1,
    padding: 16,
  },
  servicesGrid: {
    gap: 12,
  },
  serviceCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  serviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  serviceIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  serviceTag: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  serviceDesc: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 16,
    marginBottom: 10,
  },
  serviceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  serviceUrlText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
    flex: 1,
  },
  launchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  restartBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
  },
  launchBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  infoBanner: {
    marginTop: 16,
    marginBottom: 24,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 242, 254, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.18)',
  },
  infoBannerText: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 16,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 30,
  },
  loadingText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 16,
  },
  queueList: {
    gap: 10,
    paddingBottom: 24,
  },
  queueItemCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  queueTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  servicePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  servicePillText: {
    fontSize: 9,
    fontWeight: '800',
  },
  queueMetaText: {
    fontSize: 11,
    color: '#64748b',
  },
  queuePctText: {
    fontSize: 13,
    fontWeight: '800',
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  queueFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
