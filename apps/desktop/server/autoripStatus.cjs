// Shared by both aloyServer.cjs (mobile/API get_autorip_status tool) and
// electron.cjs (desktop autorip:status IPC handler) — previously each had
// its own copy of this function with the encoder settings HARDCODED as a
// literal string. That was a real, if currently-accurate, staleness trap:
// AutoRipManager_Portable has no persisted settings/state file to read live
// (its settings live in an in-memory Python dict), so the only way to avoid
// silently drifting from reality is to re-parse the actual current app.py
// source on every call instead of trusting a string written once. Falls
// back to the last-known values (labeled as such) if the source file's
// format ever changes enough that these regexes stop matching.
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_PY_PATH = process.env.AUTORIP_APP_PATH || path.join(os.homedir(), 'AutoRipManager_Portable', 'app.py');
const HISTORY_PATH = process.env.AUTORIP_HISTORY_PATH || path.join(os.homedir(), 'AutoRipManager_Portable', 'history.json');

const FALLBACK_SETTINGS = {
  h264Quality: '20', h264Preset: 'fast',
  h265Quality: '22', h265Preset: 'fast',
  minLengthSec: '600', moviesFloorSec: '1800'
};

function parseLiveSettings() {
  try {
    const src = fs.readFileSync(APP_PY_PATH, 'utf-8');
    const h264 = src.match(/nvenc_h264["'],\s*"--quality",\s*"(\d+)",\s*"--encoder-preset",\s*"(\w+)"/);
    const h265 = src.match(/nvenc_h265["'],\s*"--quality",\s*"(\d+)",\s*"--encoder-preset",\s*"(\w+)"/);
    const minLen = src.match(/"min_length_sec":\s*(\d+)/);
    const floor = src.match(/min_length_sec"\]\s*,\s*(\d+)\)/);
    if (!h264 || !h265 || !minLen || !floor) return null; // format changed, don't trust a partial parse
    return {
      h264Quality: h264[1], h264Preset: h264[2],
      h265Quality: h265[1], h265Preset: h265[2],
      minLengthSec: minLen[1], moviesFloorSec: floor[1],
      live: true
    };
  } catch {
    return null;
  }
}

function getAutoRipStatusText() {
  let history = [];
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    }
  } catch {}

  const s = parseLiveSettings() || FALLBACK_SETTINGS;
  const staleness = s.live ? '' : ' (fallback values — could not re-read app.py just now, may not reflect any recent changes)';

  let text = `[AUTORIPMANAGER PIPELINE STATUS]\nSettings & Rules${staleness}:\n` +
    `- NVENC H.264 Quality: ${s.h264Quality} (preset: ${s.h264Preset})\n` +
    `- NVENC H.265 Quality: ${s.h265Quality} (preset: ${s.h265Preset})\n` +
    `- Min Track Duration: ${s.minLengthSec}s (${Math.round(s.minLengthSec / 60)} min), Movies floor: ${s.moviesFloorSec}s (${Math.round(s.moviesFloorSec / 60)} min)\n\n`;

  if (history && history.length > 0) {
    text += `Recent Completed Discs (${history.length} total recorded):\n`;
    history.slice(0, 5).forEach((h, i) => {
      text += `${i + 1}. [${h.timestamp}] ${h.disc_label} (${h.media_type}) — ${h.episodes_saved} file(s) saved to ${h.destination} (${h.duration_min} min)\n`;
    });
  } else {
    text += `No recent disc history recorded yet.\n`;
  }
  return text;
}

module.exports = { getAutoRipStatusText };
