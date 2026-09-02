// Backs up/restores everything the app treats as durable user data (chats,
// profile, memories, personas, tracked projects, finances). Deliberately
// excludes device-local settings (enrolled face vector, TTS voice choice)
// which don't make sense to carry across machines.
const BACKUP_KEYS = [
  'ollama_pro_chats',
  'ollama_pro_user_profile',
  'ollama_pro_user_memories',
  'ollama_pro_custom_personas',
  'ollama_pro_tracked_projects',
  'ollama_pro_transactions',
  'ollama_pro_budgets',
  'ollama_pro_reminders'
];

// Was 'Z:\\Aloy Backups' (a mapped NAS drive) — switched to local storage
// 2026-08-15 after the NAS was confirmed no longer functional. Backup
// folder is still user-editable in Memory & Profile, so anyone who does get
// a working NAS/network path back can point it there again.
export const DEFAULT_BACKUP_DIR = 'Documents\\Aloy Backups';

export function collectBackupData() {
  const data = { _meta: { exportedAt: new Date().toISOString(), version: 1 } };
  BACKUP_KEYS.forEach((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      // Skip a corrupt entry rather than fail the whole backup.
    }
  });
  return data;
}

export function restoreBackupData(data) {
  BACKUP_KEYS.forEach((key) => {
    if (data[key] !== undefined) {
      localStorage.setItem(key, JSON.stringify(data[key]));
    }
  });
}

export async function writeBackupSnapshot(dir) {
  if (!window.electronAPI?.backupWrite) {
    return { success: false, error: 'Backup is only available in the Desktop App.' };
  }
  return window.electronAPI.backupWrite(dir, collectBackupData());
}

export async function restoreFromFile() {
  if (!window.electronAPI?.selectRestoreFile) {
    return { success: false, error: 'Restoring from a file is only available in the Desktop App.' };
  }
  const filePath = await window.electronAPI.selectRestoreFile();
  if (!filePath) return { success: false, cancelled: true };

  const result = await window.electronAPI.backupRead(filePath);
  if (!result.success) return result;

  restoreBackupData(result.data);
  return { success: true };
}
