import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  Tv,
  Film,
  Radio,
  Monitor,
  Gamepad2,
  Server,
  Cast,
  Search,
  X,
  Play,
  CheckCircle2,
  Layers,
  Music,
} from 'lucide-react-native';

export interface PlaybackTarget {
  id: string;
  type: string;
  name: string;
  icon?: string;
  status?: string;
  description?: string;
}

export interface MediaItem {
  id: string;
  type: string;
  title: string;
  showTitle?: string;
  year?: number | null;
  fileName: string;
  filePath: string;
  sizeBytes?: number;
  category: string;
}

interface MediaCastModalProps {
  visible: boolean;
  onClose: () => void;
  apiRequest: (method: string, path: string, body?: any) => Promise<any>;
  onOpenMediaStack?: () => void;
}

const ALPHABET = [
  'ALL', '#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

export const MediaCastModal: React.FC<MediaCastModalProps> = ({
  visible,
  onClose,
  apiRequest,
  onOpenMediaStack,
}) => {
  const [targets, setTargets] = useState<PlaybackTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('machine:bazzite');
  const [activeCategory, setActiveCategory] = useState<'all' | 'movies' | 'tv' | 'music'>('movies');
  const [selectedLetter, setSelectedLetter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load targets and library when modal becomes visible
  useEffect(() => {
    if (visible) {
      loadTargets();
      loadLibrary();
    }
  }, [visible, activeCategory]);

  const loadTargets = async () => {
    try {
      const res = await apiRequest('GET', '/api/media/targets');
      if (res?.success && Array.isArray(res.targets)) {
        setTargets(res.targets);
        if (!selectedTargetId && res.targets.length > 0) {
          setSelectedTargetId(res.targets[0].id);
        }
      }
    } catch {}
  };

  const loadLibrary = async () => {
    setLoading(true);
    try {
      const res = await apiRequest(
        'GET',
        `/api/media/library?category=${activeCategory}&limit=1500`
      );
      if (res?.success && Array.isArray(res.results)) {
        setMediaList(res.results);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const filteredMedia = useMemo(() => {
    let list = mediaList;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.showTitle && m.showTitle.toLowerCase().includes(q))
      );
    }

    if (selectedLetter !== 'ALL') {
      if (selectedLetter === '#') {
        list = list.filter((m) => /^[^a-zA-Z]/i.test(m.title));
      } else {
        list = list.filter((m) =>
          m.title.toUpperCase().startsWith(selectedLetter)
        );
      }
    }

    return list;
  }, [mediaList, searchQuery, selectedLetter]);

  const handleDispatch = async (item: MediaItem) => {
    setDispatchingId(item.id);
    try {
      const targetObj = targets.find((t) => t.id === selectedTargetId);
      const targetLabel = targetObj ? targetObj.name : selectedTargetId;

      const res = await apiRequest('POST', '/api/media/dispatch', {
        targetId: selectedTargetId,
        mediaPath: item.filePath,
        mediaTitle: item.title,
      });

      if (res?.success) {
        setToastMessage(`✨ Playing on ${targetLabel}`);
        setTimeout(() => setToastMessage(null), 3500);
      } else {
        Alert.alert('Dispatch Error', res?.error || 'Could not launch media.');
      }
    } catch (err: any) {
      Alert.alert('Dispatch Failed', err.message || 'Network error');
    } finally {
      setDispatchingId(null);
    }
  };

  const getTargetIcon = (t: PlaybackTarget) => {
    if (t.id === 'all') return <Radio size={16} color="#00f2fe" />;
    if (t.id === 'local') return <Monitor size={16} color="#38bdf8" />;
    if (t.id === 'machine:bazzite') return <Gamepad2 size={16} color="#a855f7" />;
    if (t.id === 'machine:lenny') return <Server size={16} color="#10b981" />;
    return <Cast size={16} color="#f59e0b" />;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={styles.iconBadge}>
                <Tv size={20} color="#00f2fe" />
              </View>
              <View>
                <Text style={styles.title}>Media Cast Hub</Text>
                <Text style={styles.subtitle}>Stream movies & TV to any LAN screen</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {onOpenMediaStack && (
                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    onOpenMediaStack();
                  }}
                  style={[
                    styles.closeBtn,
                    {
                      backgroundColor: 'rgba(168, 85, 247, 0.2)',
                      borderWidth: 1,
                      borderColor: 'rgba(168, 85, 247, 0.4)',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 8,
                    },
                  ]}
                >
                  <Layers size={13} color="#c084fc" />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#c084fc' }}>Stack</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <X size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Toast feedback */}
          {toastMessage && (
            <View style={styles.toast}>
              <CheckCircle2 size={16} color="#00f2fe" />
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          )}

          {/* Target Destination Selector */}
          <Text style={styles.sectionLabel}>1. SELECT PLAYBACK DESTINATION</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.targetScroll}
            contentContainerStyle={{ gap: 8 }}
          >
            {targets.map((t) => {
              const isSelected = selectedTargetId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setSelectedTargetId(t.id)}
                  style={[
                    styles.targetChip,
                    isSelected && styles.targetChipSelected,
                  ]}
                  activeOpacity={0.8}
                >
                  {getTargetIcon(t)}
                  <Text
                    style={[
                      styles.targetChipText,
                      isSelected && styles.targetChipTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {t.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Category Switcher & Search Bar */}
          <View style={styles.categoryRow}>
            <TouchableOpacity
              onPress={() => {
                setActiveCategory('movies');
                setSelectedLetter('ALL');
              }}
              style={[
                styles.catBtn,
                activeCategory === 'movies' && styles.catBtnActive,
              ]}
            >
              <Film size={14} color={activeCategory === 'movies' ? '#00f2fe' : '#64748b'} />
              <Text
                style={[
                  styles.catBtnText,
                  activeCategory === 'movies' && styles.catBtnTextActive,
                ]}
              >
                Movies
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setActiveCategory('tv');
                setSelectedLetter('ALL');
              }}
              style={[
                styles.catBtn,
                activeCategory === 'tv' && styles.catBtnActive,
              ]}
            >
              <Tv size={14} color={activeCategory === 'tv' ? '#00f2fe' : '#64748b'} />
              <Text
                style={[
                  styles.catBtnText,
                  activeCategory === 'tv' && styles.catBtnTextActive,
                ]}
              >
                TV Shows
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setActiveCategory('music');
                setSelectedLetter('ALL');
              }}
              style={[
                styles.catBtn,
                activeCategory === 'music' && styles.catBtnActive,
              ]}
            >
              <Music size={14} color={activeCategory === 'music' ? '#00f2fe' : '#64748b'} />
              <Text
                style={[
                  styles.catBtnText,
                  activeCategory === 'music' && styles.catBtnTextActive,
                ]}
              >
                Music
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setActiveCategory('all');
                setSelectedLetter('ALL');
              }}
              style={[
                styles.catBtn,
                activeCategory === 'all' && styles.catBtnActive,
              ]}
            >
              <Layers size={14} color={activeCategory === 'all' ? '#00f2fe' : '#64748b'} />
              <Text
                style={[
                  styles.catBtnText,
                  activeCategory === 'all' && styles.catBtnTextActive,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search Input */}
          <View style={styles.searchBar}>
            <Search size={16} color="#00f2fe" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search titles..."
              placeholderTextColor="#64748b"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={16} color="#64748b" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Alphabet Quick Jump Strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.alphaScroll}
            contentContainerStyle={{ gap: 4 }}
          >
            {ALPHABET.map((letter) => {
              const isSelected = selectedLetter === letter;
              return (
                <TouchableOpacity
                  key={letter}
                  onPress={() => setSelectedLetter(letter)}
                  style={[
                    styles.alphaPill,
                    isSelected && styles.alphaPillSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.alphaText,
                      isSelected && styles.alphaTextSelected,
                    ]}
                  >
                    {letter}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Item Count Indicator */}
          <View style={styles.counterRow}>
            <Text style={styles.counterText}>
              Showing <Text style={{ color: '#00f2fe', fontWeight: '700' }}>{filteredMedia.length}</Text> items
            </Text>
          </View>

          {/* Media Grid / List */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#00f2fe" />
              <Text style={styles.loadingText}>Loading media library...</Text>
            </View>
          ) : filteredMedia.length === 0 ? (
            <View style={styles.centerContainer}>
              <Film size={32} color="#475569" />
              <Text style={styles.emptyText}>No titles match your filter</Text>
            </View>
          ) : (
            <FlatList
              data={filteredMedia}
              keyExtractor={(item) => item.id}
              style={styles.list}
              initialNumToRender={15}
              maxToRenderPerBatch={20}
              windowSize={7}
              renderItem={({ item }) => {
                const isDispatching = dispatchingId === item.id;
                return (
                  <View style={styles.mediaRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.mediaTitle} numberOfLines={1}>
                        {item.showTitle ? `${item.showTitle} - ` : ''}
                        {item.title}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, alignItems: 'center' }}>
                        <Text style={styles.mediaBadge}>{item.category}</Text>
                        {item.year && <Text style={styles.mediaSub}>({item.year})</Text>}
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.castButton}
                      onPress={() => handleDispatch(item)}
                      disabled={isDispatching}
                      activeOpacity={0.7}
                    >
                      {isDispatching ? (
                        <ActivityIndicator size="small" color="#07090e" />
                      ) : (
                        <>
                          <Play size={12} color="#07090e" fill="#07090e" />
                          <Text style={styles.castButtonText}>Cast</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
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
  modalCard: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.25)',
    height: '92%',
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 11,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 242, 254, 0.15)',
    borderColor: 'rgba(0, 242, 254, 0.4)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  toastText: {
    color: '#00f2fe',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  targetScroll: {
    maxHeight: 42,
    marginBottom: 12,
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  targetChipSelected: {
    backgroundColor: 'rgba(0, 242, 254, 0.18)',
    borderColor: '#00f2fe',
  },
  targetChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  targetChipTextSelected: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  catBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  catBtnActive: {
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
    borderColor: 'rgba(0, 242, 254, 0.4)',
  },
  catBtnText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  catBtnTextActive: {
    color: '#00f2fe',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 13,
    padding: 0,
  },
  alphaScroll: {
    maxHeight: 30,
    marginBottom: 8,
  },
  alphaPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  alphaPillSelected: {
    backgroundColor: 'rgba(0, 242, 254, 0.25)',
  },
  alphaText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  alphaTextSelected: {
    color: '#00f2fe',
    fontWeight: '800',
  },
  counterRow: {
    marginBottom: 8,
  },
  counterText: {
    color: '#64748b',
    fontSize: 11,
  },
  list: {
    flex: 1,
  },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
  },
  mediaTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  mediaBadge: {
    color: '#00f2fe',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(0, 242, 254, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  mediaSub: {
    color: '#64748b',
    fontSize: 10,
  },
  castButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#00f2fe',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  castButtonText: {
    color: '#07090e',
    fontSize: 11,
    fontWeight: '800',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 10,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 8,
  },
});
