import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface UpcomingAgendaProps {
  calendarEvents: any[];
  formatAgendaDateOnly: (dateStr: string) => string;
}

export const UpcomingAgenda: React.FC<UpcomingAgendaProps> = ({
  calendarEvents,
  formatAgendaDateOnly,
}) => {
  return (
    <View style={{ marginTop: 16 }}>
      <View style={styles.hubSectionHeaderRow}>
        <Text style={styles.hubSectionTitle}>📅 Upcoming Schedule</Text>
      </View>
      <View style={styles.agendaCard}>
        {calendarEvents.length > 0 ? (
          calendarEvents.slice(0, 2).map((ev, i) => (
            <View
              key={i}
              style={[
                styles.agendaRow,
                i === 0 && { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
              ]}
            >
              <View style={styles.flexFill}>
                <Text style={styles.agendaSummary} numberOfLines={1}>
                  {ev.summary}
                </Text>
                <Text style={styles.agendaCalendar} numberOfLines={1}>
                  {ev.calendar}
                </Text>
              </View>
              {ev.start && (
                <Text style={styles.agendaTime}>
                  {ev.start.includes('T')
                    ? new Date(ev.start).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : formatAgendaDateOnly(ev.start)}
                </Text>
              )}
            </View>
          ))
        ) : (
          <Text style={styles.agendaEmpty}>No events on calendar for next 48h.</Text>
        )}
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
  agendaCard: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
  },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    marginTop: 8,
    paddingTop: 8,
  },
  flexFill: {
    flex: 1,
    marginRight: 8,
  },
  agendaSummary: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  agendaCalendar: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  agendaTime: {
    color: '#38bdf8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  agendaEmpty: {
    color: '#64748b',
    fontSize: 12,
  },
});
