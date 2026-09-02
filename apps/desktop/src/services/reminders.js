// Lightweight local reminders/tasks — mirrors the finance tracker's pattern
// (pure data/formatting helpers; state itself lives in App.jsx).

export function createReminder(text, dueAt) {
  return {
    id: `rem-${Date.now()}`,
    text,
    dueAt: dueAt || null, // ISO string, or null for an undated task
    completed: false,
    notified: false,
    createdAt: new Date().toISOString()
  };
}

export function getPendingReminders(reminders) {
  return reminders
    .filter(r => !r.completed)
    .sort((a, b) => {
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt) - new Date(b.dueAt);
    });
}

// Reminders whose due time has passed and haven't been notified about yet —
// checked on a timer in App.jsx to drive desktop notifications.
export function getNewlyDueReminders(reminders) {
  const now = Date.now();
  return reminders.filter(r => !r.completed && !r.notified && r.dueAt && new Date(r.dueAt).getTime() <= now);
}

export function formatRemindersContext(reminders) {
  const pending = getPendingReminders(reminders);
  if (pending.length === 0) return null;

  let ctx = `[PENDING REMINDERS/TASKS (${pending.length})]:\n`;
  pending.forEach(r => {
    const due = r.dueAt ? ` (due ${new Date(r.dueAt).toLocaleString()})` : '';
    ctx += `- [${r.id}] ${r.text}${due}\n`;
  });
  return ctx;
}
