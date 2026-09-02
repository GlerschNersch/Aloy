import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size: number; color: string }>;
  badge?: number | string;
}

interface SubTabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  accentColor?: string;
}

export const SubTabBar: React.FC<SubTabBarProps> = ({
  tabs,
  activeTab,
  onSelectTab,
  accentColor = '#00f2fe',
}) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;

        return (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.tabPill,
              {
                borderColor: isActive ? `${accentColor}55` : 'rgba(255, 255, 255, 0.08)',
                backgroundColor: isActive ? `${accentColor}20` : 'rgba(255, 255, 255, 0.03)',
              },
            ]}
            onPress={() => onSelectTab(tab.id)}
            activeOpacity={0.7}
          >
            {Icon && <Icon size={12} color={isActive ? accentColor : '#64748b'} style={{ marginRight: 4 }} />}
            <Text
              style={[
                styles.tabText,
                { color: isActive ? '#f8fafc' : '#94a3b8', fontWeight: isActive ? '800' : '600' },
              ]}
            >
              {tab.label}
            </Text>
            {tab.badge !== undefined && tab.badge !== null && (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: isActive ? `${accentColor}35` : 'rgba(255, 255, 255, 0.08)' },
                ]}
              >
                <Text style={[styles.badgeText, { color: isActive ? accentColor : '#64748b' }]}>
                  {tab.badge}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  contentContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 2,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  tabText: {
    fontSize: 12,
  },
  badge: {
    marginLeft: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
