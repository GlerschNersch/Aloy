// Native OS toast notifications (Electron implements the HTML5 Notification
// API as real desktop notifications) — used so reminders/anomaly alerts are
// seen even when Aloy's window isn't focused. No-ops outside Electron/when
// permission isn't granted, rather than throwing.
export function sendDesktopNotification(title, body) {
  if (typeof Notification === 'undefined') return;

  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') new Notification(title, { body });
    });
  }
}
