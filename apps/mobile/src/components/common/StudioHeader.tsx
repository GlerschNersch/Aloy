import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

interface StudioHeaderProps {
  icon: React.ComponentType<{ size: number; color: string }>;
  title: string;
  subtitle: string;
  accentColor?: string;
  statusBadge?: string;
  actionButton?: {
    label: string;
    icon?: React.ComponentType<{ size: number; color: string }>;
    onPress: () => void;
    loading?: boolean;
    disabled?: boolean;
  };
  secondaryAction?: {
    icon: React.ComponentType<{ size: number; color: string }>;
    onPress: () => void;
  };
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  icon: Icon,
  title,
  subtitle,
  accentColor = '#00f2fe',
  statusBadge,
  actionButton,
  secondaryAction,
}) => {
  const ActionIcon = actionButton?.icon;
  const SecIcon = secondaryAction?.icon;

  return (
    <View style={[styles.headerContainer, { borderColor: `${accentColor}35`, backgroundColor: `${accentColor}10` }]}>
      <View style={styles.leftRow}>
        <View style={[styles.iconCircle, { backgroundColor: `${accentColor}20`, borderColor: `${accentColor}45` }]}>
          <Icon size={18} color={accentColor} />
        </View>
        <View style={styles.titleGroup}>
          <View style={styles.titleRow}>
            <Text style={styles.titleText}>{title}</Text>
            {statusBadge && (
              <View style={[styles.statusBadge, { backgroundColor: `${accentColor}20`, borderColor: `${accentColor}50` }]}>
                <Text style={[styles.statusText, { color: accentColor }]}>{statusBadge}</Text>
              </View>
            )}
          </View>
          <Text style={styles.subtitleText} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.actionGroup}>
        {secondaryAction && SecIcon && (
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: 'rgba(255, 255, 255, 0.12)' }]}
            onPress={secondaryAction.onPress}
            activeOpacity={0.7}
          >
            <SecIcon size={14} color="#94a3b8" />
          </TouchableOpacity>
        )}

        {actionButton && (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: accentColor, borderColor: accentColor },
              (actionButton.disabled || actionButton.loading) && styles.buttonDisabled
            ]}
            onPress={actionButton.onPress}
            disabled={actionButton.disabled || actionButton.loading}
            activeOpacity={0.7}
          >
            {actionButton.loading ? (
              <ActivityIndicator size="small" color="#07090e" style={{ marginRight: 4 }} />
            ) : ActionIcon ? (
              <ActionIcon size={13} color="#07090e" style={{ marginRight: 4 }} />
            ) : null}
            <Text style={styles.buttonText}>{actionButton.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  titleText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#f8fafc',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitleText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  secondaryButton: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#07090e',
    fontSize: 11,
    fontWeight: '800',
  },
});
