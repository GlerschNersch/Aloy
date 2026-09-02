// Obsidian integration — vaults are just folders of markdown files on disk,
// so this reuses the same generic folder-scan/read Electron IPC already
// built for the Projects panel, plus one purpose-built write endpoint for
// creating new notes (services/tools.js's create_obsidian_note tool).

export async function selectVaultFolder() {
  if (!window.electronAPI?.selectFolder) return null;
  return window.electronAPI.selectFolder();
}

export async function scanVaultNotes(vaultDir) {
  if (!window.electronAPI?.scanFolder) return [];
  const result = await window.electronAPI.scanFolder(vaultDir);
  if (!result.success) return [];
  return result.files.filter(f => f.ext === '.md');
}

export async function readNoteContent(filePath) {
  if (!window.electronAPI?.readFile) return null;
  const result = await window.electronAPI.readFile(filePath);
  return result.success ? result.content : null;
}

export async function createNote(vaultDir, filename, content) {
  if (!window.electronAPI?.createObsidianNote) {
    return { success: false, error: 'Obsidian integration is only available in the Desktop App.' };
  }
  if (!vaultDir) {
    return { success: false, error: 'No Obsidian vault connected yet.' };
  }
  return window.electronAPI.createObsidianNote(vaultDir, filename, content);
}
