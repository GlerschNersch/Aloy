// Folder Access & File Indexing Service

export async function selectLocalFolder() {
  if (window.electronAPI?.selectFolder) {
    return await window.electronAPI.selectFolder();
  }
  return null;
}

export async function indexLocalFolder(folderPath, ragEngine, onProgress) {
  if (!window.electronAPI?.scanFolder) {
    throw new Error('Local folder access is only available in Desktop App mode.');
  }

  const scanResult = await window.electronAPI.scanFolder(folderPath);
  if (!scanResult.success) {
    throw new Error(scanResult.error || 'Failed to scan directory.');
  }

  const supportedExts = ['.txt', '.md', '.js', '.json', '.py', '.html', '.css', '.csv', '.ts', '.jsx', '.tsx', '.log'];
  const textFiles = scanResult.files.filter(f => supportedExts.includes(f.ext));

  let indexedCount = 0;
  for (const file of textFiles) {
    const readResult = await window.electronAPI.readFile(file.path);
    if (readResult.success && readResult.content) {
      await ragEngine.addDocument(file.name, readResult.content);
      indexedCount++;
      if (onProgress) {
        onProgress(indexedCount, textFiles.length, file.name);
      }
    }
  }

  return {
    totalScanned: scanResult.files.length,
    totalIndexed: indexedCount
  };
}
