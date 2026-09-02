const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3456;
const HOST = '127.0.0.1'; // Strictly loopback only — no external LAN access

let token = null;
try {
  const authModule = require('../../ollama-pro-app/server/auth.cjs');
  token = authModule.getOrCreateToken();
  app.use(authModule.requireAuth(token));
} catch (err) {
  console.warn('[Dashboard] Auth module load notice:', err.message);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, '..');
const SCREENSHOT_DIR = path.join(DATA_DIR, 'bizhawk_screenshot.png');

// Load HEPHAESTUS Engine
let hephaestus = null;
try {
  const hephModule = require('../../ollama-pro-app/server/hephaestus.cjs');
  hephaestus = hephModule.globalHephaestus;
} catch (err) {
  console.warn('[Dashboard] Warning: Could not load hephaestus.cjs directly:', err.message);
}

// ----------------------------------------------------
// ALOY RUNTIME ENDPOINTS
// ----------------------------------------------------
app.get('/api/status', (req, res) => {
  try {
    let progress = {};
    let learnings = [];
    const progPath = path.join(DATA_DIR, 'aloy_smb2_master_progress.json');
    const learnPath = path.join(DATA_DIR, 'aloy_learnings.txt');

    if (fs.existsSync(progPath)) {
      progress = JSON.parse(fs.readFileSync(progPath, 'utf8'));
    }
    if (fs.existsSync(learnPath)) {
      learnings = fs.readFileSync(learnPath, 'utf8').trim().split('\n').slice(-10);
    }
    res.json({ progress, learnings });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/api/screenshot', (req, res) => {
  if (fs.existsSync(SCREENSHOT_DIR)) {
    res.sendFile(SCREENSHOT_DIR);
  } else {
    res.status(404).send('No screenshot');
  }
});

app.get('/api/hazard', (req, res) => {
  try {
    const hazardPath = path.join(DATA_DIR, 'hazard_memory_db.json');
    if (fs.existsSync(hazardPath)) {
      const hazard = JSON.parse(fs.readFileSync(hazardPath, 'utf8'));
      return res.json(hazard);
    }
    res.json({});
  } catch {
    res.json({});
  }
});

app.get('/api/vision', async (req, res) => {
  try {
    const visionPath = path.join(DATA_DIR, 'vision', 'vision-tools.cjs');
    if (fs.existsSync(visionPath)) {
      const { captureAndDescribe } = require(visionPath);
      const mockScreenshot = async () => console.log('[Vision] Taking screenshot...');
      const result = await captureAndDescribe(mockScreenshot);
      return res.json(result.analysis);
    }
    res.json({ note: 'Vision tool not configured or running in simulated mode', detected: [] });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ----------------------------------------------------
// HEPHAESTUS (HEPH) CAULDRON ENDPOINTS
// ----------------------------------------------------
app.get('/api/hephaestus/tasks', (req, res) => {
  if (!hephaestus) return res.json([]);
  const { status, category } = req.query;
  res.json(hephaestus.listTasks({ status, category }));
});

app.get('/api/hephaestus/tasks/:id', (req, res) => {
  if (!hephaestus) return res.status(503).json({ error: 'Hephaestus engine not initialized' });
  const task = hephaestus.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.post('/api/hephaestus/tasks', (req, res) => {
  if (!hephaestus) return res.status(503).json({ error: 'Hephaestus engine not initialized' });
  const { title, description, category, targetFiles, requirements, autoDeploy, requestedBy } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const task = hephaestus.createTask({
    title,
    description,
    category: category || 'feature',
    targetFiles: targetFiles || [],
    requirements: requirements || [],
    autoDeploy: Boolean(autoDeploy),
    requestedBy: requestedBy || 'operator'
  });
  res.status(201).json(task);
});

app.post('/api/hephaestus/tasks/:id/stage', (req, res) => {
  if (!hephaestus) return res.status(503).json({ error: 'Hephaestus engine not initialized' });
  const { filePath, proposedContent } = req.body;
  try {
    const change = hephaestus.stageFileModification(req.params.id, filePath, proposedContent);
    res.json({ success: true, change, task: hephaestus.getTask(req.params.id) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hephaestus/tasks/:id/verify', async (req, res) => {
  if (!hephaestus) return res.status(503).json({ error: 'Hephaestus engine not initialized' });
  const { testCmd } = req.body;
  try {
    const task = await hephaestus.runVerification(req.params.id, testCmd);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hephaestus/tasks/:id/approve', async (req, res) => {
  if (!hephaestus) return res.status(503).json({ error: 'Hephaestus engine not initialized' });
  try {
    const result = await hephaestus.approveAndDeploy(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hephaestus/tasks/:id/reject', (req, res) => {
  if (!hephaestus) return res.status(503).json({ error: 'Hephaestus engine not initialized' });
  const { reason } = req.body;
  try {
    const task = hephaestus.rejectTask(req.params.id, reason);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hephaestus/tasks/:id/rollback', async (req, res) => {
  if (!hephaestus) return res.status(503).json({ error: 'Hephaestus engine not initialized' });
  try {
    const result = await hephaestus.rollbackDeployment(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/hephaestus/training-stats', (_req, res) => {
  try {
    const { getTrainingStats } = require('../../ollama-pro-app/server/hephReviewer.cjs');
    res.json(getTrainingStats());
  } catch (err) {
    res.json({ totalSamples: 0, positiveCount: 0, correctionCount: 0, error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Aloy & Hephaestus Unified Command Hub running securely at http://${HOST}:${PORT} (Loopback Only)`);
});