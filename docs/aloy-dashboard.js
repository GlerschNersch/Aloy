// Simple Aloy Training Dashboard
// Run with: node aloy-dashboard.js

const fs = require('fs');
const path = require('path');

const FILES = {
  progress: path.join(__dirname, 'aloy_smb2_master_progress.json'),
  learnings: path.join(__dirname, 'aloy_learnings.txt'),
  hazard: path.join(__dirname, 'hazard_memory_db.json'),
};

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readLines(file, max = 20) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    return content.trim().split('\n').slice(-max);
  } catch {
    return [];
  }
}

function render() {
  console.clear();
  console.log('=== Aloy SMB2 Training Dashboard ===');
  console.log(new Date().toISOString());
  console.log('');

  // Progress
  const progress = readJSON(FILES.progress);
  if (progress) {
    console.log('CURRENT RUN');
    console.log(`World ${progress.active_world}-${progress.active_stage}`);
    console.log(`Deaths: ${progress.total_deaths}`);
    console.log(`Status: ${progress.status}`);
    console.log(`Frame: ${progress.last_updated_frame}`);
    console.log('');
  }

  // Recent learnings
  const learnings = readLines(FILES.learnings, 8);
  if (learnings.length > 0) {
    console.log('RECENT LEARNINGS');
    learnings.forEach(l => console.log(l));
    console.log('');
  }

  // Hazard memory
  const hazard = readJSON(FILES.hazard);
  if (hazard && Object.keys(hazard).length > 0) {
    console.log('HAZARD MEMORY');
    Object.entries(hazard).slice(0, 5).forEach(([key, val]) => {
      console.log(`${key}: ${val}`);
    });
  }

  console.log('\nPress Ctrl+C to exit. Refreshing every 3s...');
}

setInterval(render, 3000);
render();