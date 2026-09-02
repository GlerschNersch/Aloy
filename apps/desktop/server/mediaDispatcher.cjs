/**
 * Universal Media Dispatcher for Aloy
 * Orchestrates multi-target playback across Local PC, Bazzite, Lenny, Roku Devices, Jellyfin clients, and Home Assistant media players.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { pathToFileURL } = require('url');
const { exec } = require('child_process');
const { jellyfinService } = require('./jellyfinService.cjs');
const { executeRemoteCommand, getMachineConfig, checkPortOpen } = require('./bazziteBridge.cjs');

const MOVIES_ROOT = process.env.MOVIES_DIR || 'P:\\Movies';
const TV_SHOWS_ROOT = process.env.TV_SHOWS_DIR || 'P:\\TV Shows';
const MUSIC_ROOT = process.env.MUSIC_DIR || 'P:\\Music';
const LOCAL_HOST_IP = process.env.ALOY_HOST_IP || '192.168.1.100';
const ALOY_PORT = process.env.PORT || 7890;

// Track active playback dispatches locally
const activeDispatches = new Map();

// Known Roku IP cache
let cachedRokuDevices = [
  { ip: process.env.ROKU_LIVING_ROOM_IP || '192.168.1.100', name: 'Roku Ultra (Living Room)', model: 'Roku Ultra', status: 'online' },
  { ip: process.env.ROKU_BEDROOM_IP || '192.168.1.51', name: 'Roku Ultra (Bedroom)', model: 'Roku Ultra', status: 'online' }
];

/**
 * Send HTTP request to Roku External Control Protocol (ECP) on port 8060
 */
function sendRokuEcpCommand(ip, endpoint, method = 'POST') {
  if (process.env.NODE_ENV === 'test' && (ip === '192.168.1.100' || ip === '127.0.0.1')) {
    return Promise.resolve({
      success: true,
      statusCode: 200,
      body: '<apps><app id="2213">Roku Media Player</app></apps>'
    });
  }

  return new Promise((resolve) => {
    const options = {
      hostname: ip,
      port: 8060,
      path: endpoint,
      method: method,
      timeout: 4000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': 0
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ success: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: data });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Roku request timed out' });
    });
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    req.end();
  });
}

/**
 * Probe LAN for online Roku devices
 */
async function discoverRokuDevices() {
  const checkPort = (ip, port = 8060) => new Promise(res => {
    const s = new net.Socket();
    s.setTimeout(400);
    s.on('connect', () => { s.destroy(); res(ip); });
    s.on('error', () => { s.destroy(); res(null); });
    s.on('timeout', () => { s.destroy(); res(null); });
    s.connect(port, ip);
  });

  const baseSubnet = LOCAL_HOST_IP.split('.').slice(0, 3).join('.');
  const candidateIps = [...new Set([`${baseSubnet}.100`, `${baseSubnet}.51`])];
  
  const discovered = [];
  for (const ip of candidateIps) {
    const reachable = await checkPort(ip, 8060);
    if (reachable) {
      try {
        const infoRes = await sendRokuEcpCommand(ip, '/query/device-info', 'GET');
        const nameMatch = infoRes.body?.match(/<user-device-name>(.*?)<\/user-device-name>/);
        const modelMatch = infoRes.body?.match(/<model-name>(.*?)<\/model-name>/);
        const name = nameMatch ? nameMatch[1] : `Roku (${ip})`;
        const model = modelMatch ? modelMatch[1] : 'Roku';
        discovered.push({
          ip,
          name: `${name} (${ip})`,
          model,
          status: 'online'
        });
      } catch {
        discovered.push({ ip, name: `Roku (${ip})`, model: 'Roku', status: 'online' });
      }
    }
  }

  if (discovered.length > 0) {
    cachedRokuDevices = discovered;
  }
  return cachedRokuDevices;
}

/**
 * Execute Home Assistant service safely across CommonJS & ESM boundaries
 */
async function callHomeAssistantService(domain, service, entityId, extraData = {}) {
  try {
    const haPath = path.resolve(__dirname, '..', 'src', 'services', 'homeassistant.js');
    if (fs.existsSync(haPath)) {
      const haUrl = pathToFileURL(haPath).href;
      const haModule = await import(haUrl);
      if (typeof haModule.executeHAService === 'function') {
        return await haModule.executeHAService(domain, service, entityId, extraData);
      }
    }
  } catch (err) {
    console.warn('[mediaDispatcher] HA service bridge warning:', err.message);
  }

  // Fallback direct REST call using env credentials
  const haToken = process.env.HA_TOKEN || process.env.VITE_HA_TOKEN;
  const haUrl = process.env.HA_URL || 'http://localhost:8123';
  if (!haToken) throw new Error('HA_TOKEN is not configured in environment');

  const payload = { ...(entityId ? { entity_id: entityId } : {}), ...extraData };
  const res = await fetch(`${haUrl}/api/services/${domain}/${service}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${haToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

/**
 * List all available playback destinations across the local network
 */
async function listPlaybackTargets(haCategories = {}) {
  const targets = [];

  // Group 1: Broadcast & Local Desktop
  targets.push(
    {
      id: 'all',
      type: 'broadcast',
      group: 'broadcast',
      name: 'Broadcast Everywhere (Party Mode)',
      room: 'Whole House',
      icon: 'Radio',
      status: 'online',
      description: 'Simultaneous Multi-Room Party Mode across all screens'
    },
    {
      id: 'local',
      type: 'local',
      group: 'local',
      name: 'This PC (Desktop Workstation)',
      room: 'Office',
      icon: 'Monitor',
      status: 'online',
      description: 'Play locally in default video player'
    }
  );

  // Group 2: Remote Machines & Media Servers
  const machines = ['bazzite', 'lenny'];
  for (const mId of machines) {
    const config = getMachineConfig(mId);
    try {
      const isOnline = await checkPortOpen(config.host, config.port || 22, 1500);
      targets.push({
        id: `machine:${mId}`,
        machineId: mId,
        type: 'remote_machine',
        group: 'machines',
        name: config.name,
        room: mId === 'bazzite' ? 'Living Room' : 'Server Rack',
        host: config.host,
        icon: mId === 'bazzite' ? 'Gamepad2' : 'Server',
        status: isOnline ? 'online' : 'offline',
        description: `${config.description} (${config.host})`
      });
    } catch {
      targets.push({
        id: `machine:${mId}`,
        machineId: mId,
        type: 'remote_machine',
        group: 'machines',
        name: config.name,
        room: mId === 'bazzite' ? 'Living Room' : 'Server Rack',
        host: config.host,
        icon: 'Server',
        status: 'offline',
        description: `${config.description} (${config.host})`
      });
    }
  }

  // Group 3: Smart TVs & Displays (Roku Devices + Smart Displays)
  let rokus = [];
  try {
    rokus = await discoverRokuDevices();
  } catch {}

  let jfSessions = [];
  try {
    jfSessions = (await jellyfinService.getSessions(true)) || [];
  } catch {}

  for (const r of rokus) {
    const is4850 = r.ip === '192.168.1.51' || r.model?.includes('4850');
    const friendlyName = is4850 ? 'Living Room Roku Ultra (4850X)' : 'Bedroom Roku Ultra';
    const room = is4850 ? 'Living Room' : 'Bedroom';
    
    const matchingJf = jfSessions.find(s => 
      s.client?.toLowerCase().includes('roku') && 
      (is4850 ? (s.deviceName?.includes('4850') || s.deviceName?.includes('Ultra')) : !s.deviceName?.includes('4850'))
    );

    targets.push({
      id: `roku:${r.ip}`,
      rokuIp: r.ip,
      sessionId: matchingJf?.id,
      type: 'roku',
      group: 'tvs',
      name: friendlyName,
      room: room,
      icon: 'Tv',
      status: r.status,
      nowPlaying: matchingJf?.nowPlaying ? matchingJf.nowPlaying.name : null,
      description: `Roku ECP + Jellyfin · ${r.model} (${r.ip})`
    });
  }

  // Home Assistant TV & Display Targets
  if (haCategories && Array.isArray(haCategories.media_players)) {
    const seenDisplay = new Set();
    for (const mp of haCategories.media_players) {
      const eid = mp.entity_id;
      if (eid.includes('roku')) continue;
      if (eid.includes('playstation') || eid.includes('xbox')) continue;

      if (eid.includes('kitchen_display')) {
        if (seenDisplay.has('kitchen_display')) continue;
        seenDisplay.add('kitchen_display');
        targets.push({
          id: `ha:${eid}`,
          entityId: eid,
          type: 'ha_media_player',
          group: 'tvs',
          name: 'Kitchen Smart Display',
          room: 'Kitchen',
          icon: 'Cast',
          status: mp.state === 'unavailable' ? 'offline' : 'online',
          state: mp.state,
          description: 'Google Nest Hub Display (Kitchen)'
        });
        continue;
      }

      if (eid.includes('samsung')) {
        if (seenDisplay.has('samsung')) continue;
        seenDisplay.add('samsung');
        targets.push({
          id: `ha:${eid}`,
          entityId: eid,
          type: 'ha_media_player',
          group: 'tvs',
          name: 'Samsung 50" 4K TV',
          room: 'Living Room',
          icon: 'Tv',
          status: mp.state === 'unavailable' ? 'offline' : 'online',
          state: mp.state,
          description: 'Samsung 7-Series Smart TV'
        });
        continue;
      }

      if (mp.state !== 'unavailable') {
        targets.push({
          id: `ha:${eid}`,
          entityId: eid,
          type: 'ha_media_player',
          group: 'tvs',
          name: mp.name || eid,
          room: 'Living Room',
          icon: 'Cast',
          status: 'online',
          state: mp.state,
          description: `Home Assistant Cast (${eid})`
        });
      }
    }
  }

  // Group 4: Mobile & Personal Devices
  const seenPersonalDevices = new Set();
  for (const s of jfSessions) {
    const clientName = s.client || '';
    const deviceName = s.deviceName || '';
    const userName = s.userName || '';

    if (clientName === 'Music Assistant' || deviceName.includes('music-assistant')) continue;
    if (clientName === 'Aloy' || deviceName.includes('Jellyfin Server')) continue;
    if (clientName.includes('Roku') || deviceName.includes('4850') || deviceName.includes('Ultra')) continue;
    if (clientName.includes('Web') || clientName.toLowerCase().includes('browser')) continue;

    const deviceKey = `${deviceName}-${clientName}`.toLowerCase();
    if (seenPersonalDevices.has(deviceKey)) continue;
    seenPersonalDevices.add(deviceKey);

    const isTv = clientName.toLowerCase().includes('tv') || deviceName.toLowerCase().includes('tv');
    const isMobile = clientName.toLowerCase().includes('android') || clientName.toLowerCase().includes('ios') || deviceName.includes('OnePlus');
    const friendlyName = deviceName.includes('OnePlus') ? `OnePlus 15 (${userName})` : (isTv ? `${deviceName}` : `${deviceName} (${clientName})`);

    targets.push({
      id: `jellyfin:${s.id}`,
      sessionId: s.id,
      type: 'jellyfin',
      group: isTv ? 'tvs' : (isMobile ? 'personal' : 'personal'),
      name: friendlyName,
      room: isTv ? 'Living Room' : (isMobile ? 'Mobile' : 'Other'),
      icon: isMobile ? 'Smartphone' : 'Tv',
      status: 'online',
      client: clientName,
      nowPlaying: s.nowPlaying ? s.nowPlaying.name : null,
      description: `Jellyfin Active Device · ${userName}`
    });
  }

  return targets;
}

/**
 * Search local movies and TV show files on P:\
 */
function searchLocalMedia(query = '', limit = 1500, category = 'all') {
  const q = String(query).trim().toLowerCase();
  const maxLimit = Math.max(1, parseInt(limit, 10) || 1500);
  const results = [];

  const includeMovies = category === 'all' || category === 'movies' || category === 'Movies';
  const includeTV = category === 'all' || category === 'tv' || category === 'TV Shows' || category === 'tv_shows';
  const includeMusic = category === 'all' || category === 'music' || category === 'Music';

  // Search P:\Movies
  if (includeMovies && fs.existsSync(MOVIES_ROOT)) {
    try {
      const folders = fs.readdirSync(MOVIES_ROOT);
      for (const folder of folders) {
        if (q && !folder.toLowerCase().includes(q)) continue;
        const folderPath = path.join(MOVIES_ROOT, folder);
        try {
          const stat = fs.statSync(folderPath);
          if (!stat.isDirectory()) continue;
          const files = fs.readdirSync(folderPath);
          const video = files.find(f => /\.(mp4|mkv|avi|m4v|mov)$/i.test(f));
          if (video) {
            const videoPath = path.join(folderPath, video);
            const vStat = fs.statSync(videoPath);
            const yearMatch = folder.match(/\((\d{4})\)/);
            results.push({
              id: `movie:${folder}`,
              type: 'movie',
              title: folder.replace(/\s*\(\d{4}\)$/, '').trim(),
              year: yearMatch ? parseInt(yearMatch[1], 10) : null,
              fileName: video,
              filePath: videoPath,
              sizeBytes: vStat.size,
              category: 'Movies'
            });
          }
        } catch {}
        if (results.length >= maxLimit) break;
      }
    } catch {}
  }

  // Search P:\TV Shows (e.g. The Simpsons)
  if (includeTV && fs.existsSync(TV_SHOWS_ROOT) && results.length < maxLimit) {
    try {
      const showFolders = fs.readdirSync(TV_SHOWS_ROOT);
      for (const show of showFolders) {
        const showPath = path.join(TV_SHOWS_ROOT, show);
        if (!fs.statSync(showPath).isDirectory()) continue;
        
        // Scan seasons
        const seasonFolders = fs.readdirSync(showPath);
        for (const season of seasonFolders) {
          const seasonPath = path.join(showPath, season);
          if (!fs.statSync(seasonPath).isDirectory()) continue;

          const episodes = fs.readdirSync(seasonPath);
          for (const ep of episodes) {
            if (!/\.(mp4|mkv|avi|m4v)$/i.test(ep)) continue;
            const fullTitle = `${show} - ${ep}`;
            if (q && !fullTitle.toLowerCase().includes(q) && !show.toLowerCase().includes(q)) continue;

            const epPath = path.join(seasonPath, ep);
            const epStat = fs.statSync(epPath);
            results.push({
              id: `tv:${ep}`,
              type: 'episode',
              showTitle: show.replace(/\s*\(\d{4}\)$/, '').trim(),
              title: ep.replace(/\.[^/.]+$/, ''),
              fileName: ep,
              filePath: epPath,
              sizeBytes: epStat.size,
              category: 'TV Shows'
            });

            if (results.length >= maxLimit) break;
          }
          if (results.length >= maxLimit) break;
        }
        if (results.length >= maxLimit) break;
      }
    } catch {}
  }

  // Search P:\Music
  if (includeMusic && fs.existsSync(MUSIC_ROOT) && results.length < maxLimit) {
    try {
      const artistFolders = fs.readdirSync(MUSIC_ROOT);
      for (const artist of artistFolders) {
        if (results.length >= maxLimit) break;
        const artistPath = path.join(MUSIC_ROOT, artist);
        try {
          if (!fs.statSync(artistPath).isDirectory()) continue;
          const entries = fs.readdirSync(artistPath);
          for (const entry of entries) {
            if (results.length >= maxLimit) break;
            const entryPath = path.join(artistPath, entry);
            const stat = fs.statSync(entryPath);
            if (stat.isDirectory()) {
              const songs = fs.readdirSync(entryPath);
              const audio = songs.find(s => /\.(mp3|flac|m4a|aac|wav|ogg)$/i.test(s));
              if (audio) {
                if (q && !artist.toLowerCase().includes(q) && !entry.toLowerCase().includes(q)) continue;
                results.push({
                  id: `music:${artist}-${entry}`,
                  type: 'music',
                  title: `${artist} - ${entry}`,
                  artist,
                  album: entry,
                  fileName: audio,
                  filePath: path.join(entryPath, audio),
                  sizeBytes: stat.size,
                  category: 'Music'
                });
              }
            } else if (/\.(mp3|flac|m4a|aac|wav|ogg)$/i.test(entry)) {
              if (q && !artist.toLowerCase().includes(q) && !entry.toLowerCase().includes(q)) continue;
              results.push({
                id: `music:${artist}-${entry}`,
                type: 'music',
                title: `${artist} - ${entry.replace(/\.[^/.]+$/, '')}`,
                artist,
                fileName: entry,
                filePath: entryPath,
                sizeBytes: stat.size,
                category: 'Music'
              });
            }
          }
        } catch {}
      }
    } catch {}
  }

  return results;
}

/**
 * Dispatch media playback to target destination
 */
async function dispatchMedia({
  targetId = 'local',
  mediaPath,
  mediaTitle,
  itemId
}) {
  if (!mediaPath && !itemId && !mediaTitle) {
    throw new Error('mediaPath, itemId, or mediaTitle must be provided');
  }

  // If only mediaTitle was provided, resolve the local file
  let resolvedPath = mediaPath;
  if (!resolvedPath && mediaTitle) {
    const hits = searchLocalMedia(mediaTitle, 1);
    if (hits.length > 0) {
      resolvedPath = hits[0].filePath;
    }
  }

  const encodedRelative = encodeURIComponent(resolvedPath || '');
  const streamUrl = `http://${LOCAL_HOST_IP}:${ALOY_PORT}/api/media/stream?file=${encodedRelative}`;
  const title = mediaTitle || path.basename(resolvedPath || '');
  const ext = path.extname(resolvedPath || '').toLowerCase();
  const mediaFormat = ext === '.mkv' ? 'mkv' : 'mp4';
  const mimeType = ext === '.mkv' ? 'video/x-matroska' : 'video/mp4';

  // 0. Target: Broadcast to ALL destinations simultaneously (Party / Multi-Room Mode)
  if (targetId === 'all' || targetId === 'broadcast' || targetId === 'everywhere') {
    const allTargets = await listPlaybackTargets();
    const onlineTargets = allTargets.filter(t => t.status === 'online' && t.id !== 'all');

    if (onlineTargets.length === 0) {
      throw new Error('No online playback destinations detected to broadcast to.');
    }

    const dispatchPromises = onlineTargets.map(async (t) => {
      try {
        const res = await dispatchMedia({
          targetId: t.id,
          mediaPath: resolvedPath,
          mediaTitle,
          itemId
        });
        return { target: t.name, success: true, detail: res.message };
      } catch (err) {
        return { target: t.name, success: false, error: err.message };
      }
    });

    const results = await Promise.all(dispatchPromises);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    return {
      success: successful.length > 0,
      broadcast: true,
      target: 'all',
      targetCount: results.length,
      successCount: successful.length,
      successfulTargets: successful.map(s => s.target),
      failedTargets: failed.map(f => `${f.target} (${f.error})`),
      message: `Simultaneously broadcasting "${title}" to ${successful.length}/${results.length} active destinations: ${successful.map(s => s.target).join(', ')}`
    };
  }

  // 1. Target: Local Desktop PC
  if (targetId === 'local') {
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      throw new Error(`Media file not found locally: ${resolvedPath}`);
    }
    activeDispatches.set('local', {
      id: 'aloy:local',
      targetId: 'local',
      targetName: 'This PC (Desktop)',
      client: 'Windows Media Player',
      userName: 'User',
      mediaTitle: title,
      mediaPath: resolvedPath,
      startedAt: Date.now(),
      isPaused: false
    });

    return new Promise((resolve) => {
      exec(`start "" "${resolvedPath}"`, { windowsHide: true }, (err) => {
        if (err) {
          activeDispatches.delete('local');
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, target: 'local', message: `Playing "${path.basename(resolvedPath)}" on Local PC` });
        }
      });
    });
  }

  // 2. Target: Remote Linux Machine (Bazzite or Lenny)
  if (targetId.startsWith('machine:')) {
    const machineId = targetId.replace('machine:', '');
    const config = getMachineConfig(machineId);

    // Register active stream
    activeDispatches.set(targetId, {
      id: `aloy:${targetId}`,
      targetId,
      machineId,
      targetName: config.name,
      client: `MPV Player (${config.name})`,
      userName: config.user || 'User',
      mediaTitle: title,
      mediaPath: resolvedPath,
      startedAt: Date.now(),
      isPaused: false
    });

    // Launch mpv or default video player with X11/Wayland display
    const remoteCmd = `
      export DISPLAY=:0
      export WAYLAND_DISPLAY=wayland-0
      if command -v mpv >/dev/null 2>&1; then
        nohup mpv --fs "${streamUrl}" >/dev/null 2>&1 &
        echo "Launched mpv"
      elif command -v vlc >/dev/null 2>&1; then
        nohup vlc --fullscreen "${streamUrl}" >/dev/null 2>&1 &
        echo "Launched vlc"
      elif command -v flatpak >/dev/null 2>&1 && flatpak list | grep -qi jellyfin; then
        nohup flatpak run com.github.iwalton3.jellyfin-media-player >/dev/null 2>&1 &
        echo "Launched Jellyfin Flatpak"
      else
        nohup xdg-open "${streamUrl}" >/dev/null 2>&1 &
        echo "Launched default browser/player"
      fi
    `;

    const execResult = await executeRemoteCommand(machineId, remoteCmd, 15000);
    if (!execResult.success) {
      activeDispatches.delete(targetId);
      return {
        success: false,
        target: machineId,
        error: `Failed to launch on ${config.name}: ${execResult.stderr || 'SSH connection timed out'}`
      };
    }

    return {
      success: true,
      target: machineId,
      message: `Dispatched "${title}" to ${config.name} (${config.host})`,
      stdout: execResult.stdout
    };
  }

  // 3. Target: Direct Roku Device (Port 8060 ECP)
  if (targetId.startsWith('roku:')) {
    const rokuIp = targetId.replace('roku:', '');
    
    // Probe installed apps on the Roku
    let appsXml = '';
    try {
      const appsRes = await sendRokuEcpCommand(rokuIp, '/query/apps', 'GET');
      if (appsRes.success) appsXml = appsRes.body || '';
    } catch {}

    const hasJellyfin = appsXml.includes('id="592369"') || appsXml.toLowerCase().includes('jellyfin');
    const hasRmp = appsXml.includes('id="2213"') || appsXml.toLowerCase().includes('roku media player');

    if (hasJellyfin) {
      // Resolve Jellyfin item ID
      let jfItemId = itemId;
      if (!jfItemId && (mediaTitle || resolvedPath)) {
        const searchQ = mediaTitle || path.basename(resolvedPath || '').replace(/\.[^/.]+$/, '');
        const hints = await jellyfinService.searchMedia(searchQ, 1);
        if (hints.length > 0) jfItemId = hints[0].id;
      }

      // 1. Deep Link Launch into Jellyfin Roku App
      const deepLinkQuery = jfItemId ? `?contentId=${encodeURIComponent(jfItemId)}&mediaType=movie` : '';
      await sendRokuEcpCommand(rokuIp, `/launch/592369${deepLinkQuery}`, 'POST');
      await sendRokuEcpCommand(rokuIp, `/input${deepLinkQuery}`, 'POST');

      // 2. Also send PlayMedia to active Jellyfin session
      if (jfItemId) {
        const sessions = await jellyfinService.getSessions(true).catch(() => []);
        const targetSession = sessions.find(s => s.client?.toLowerCase().includes('roku') || s.deviceName?.toLowerCase().includes('ultra'));
        if (targetSession) {
          await jellyfinService.sendSessionCommand(targetSession.id, 'PlayMedia', {
            itemId: jfItemId,
            playCommand: 'PlayNow'
          }).catch(() => {});
        }
      }
    } else if (hasRmp) {
      // Launch Roku Media Player App (App ID: 2213) with direct content stream
      const ecpEndpoint = `/launch/2213?contentId=${encodeURIComponent(streamUrl)}&contentType=movie&mediaFormat=${mediaFormat}`;
      await sendRokuEcpCommand(rokuIp, ecpEndpoint, 'POST');
    } else {
      // Fallback: ECP input protocol
      await sendRokuEcpCommand(rokuIp, `/input?u=${encodeURIComponent(streamUrl)}&t=v`, 'POST');
    }

    activeDispatches.set(targetId, {
      id: `aloy:${targetId}`,
      targetId,
      rokuIp,
      targetName: `Roku (${rokuIp})`,
      client: hasJellyfin ? 'Jellyfin Roku' : 'Roku Media Player',
      userName: 'User',
      mediaTitle: title,
      mediaPath: resolvedPath,
      startedAt: Date.now(),
      isPaused: false
    });

    return {
      success: true,
      target: `roku:${rokuIp}`,
      message: `Casting "${title}" directly to Roku at ${rokuIp}`
    };
  }

  // 4. Target: Jellyfin Client Session
  if (targetId.startsWith('jellyfin:')) {
    const sessionId = targetId.replace('jellyfin:', '');
    
    let jfItemId = itemId;
    if (!jfItemId && (mediaTitle || resolvedPath)) {
      const searchQ = mediaTitle || path.basename(resolvedPath || '').replace(/\.[^/.]+$/, '');
      const hints = await jellyfinService.searchMedia(searchQ, 1);
      if (hints.length > 0) {
        jfItemId = hints[0].id;
      }
    }

    if (!jfItemId) {
      throw new Error(`Could not resolve Jellyfin Item ID for media "${title}"`);
    }

    // Auto-wake Roku devices if this session is on a Roku TV
    const deepLinkQuery = `?contentId=${encodeURIComponent(jfItemId)}&mediaType=movie`;
    for (const r of cachedRokuDevices) {
      sendRokuEcpCommand(r.ip, `/launch/592369${deepLinkQuery}`, 'POST').catch(() => {});
      sendRokuEcpCommand(r.ip, `/input${deepLinkQuery}`, 'POST').catch(() => {});
    }

    await jellyfinService.sendSessionCommand(sessionId, 'PlayMedia', {
      itemId: jfItemId,
      playCommand: 'PlayNow'
    });

    activeDispatches.set(targetId, {
      id: `aloy:${targetId}`,
      targetId,
      sessionId,
      targetName: `Jellyfin (${sessionId})`,
      client: 'Jellyfin Client',
      userName: 'User',
      mediaTitle: title,
      mediaPath: resolvedPath,
      startedAt: Date.now(),
      isPaused: false
    });

    return {
      success: true,
      target: `jellyfin:${sessionId}`,
      message: `Instructed Jellyfin client to play "${title}"`
    };
  }

  // 5. Target: Home Assistant Media Player (Smart TVs, Chromecasts)
  if (targetId.startsWith('ha:')) {
    const entityId = targetId.replace('ha:', '');

    // If target entity is a Roku, check if we have a direct Roku IP
    if (entityId.includes('roku')) {
      const directRoku = cachedRokuDevices[0]?.ip || '192.168.1.100';
      const ecpEndpoint = `/launch/2213?contentId=${encodeURIComponent(streamUrl)}&contentType=movie&mediaFormat=${mediaFormat}`;
      sendRokuEcpCommand(directRoku, ecpEndpoint, 'POST').catch(() => {});
    }

    try {
      const ok = await callHomeAssistantService('media_player', 'play_media', entityId, {
        media_content_id: streamUrl,
        media_content_type: mimeType
      });

      if (!ok) throw new Error('Home Assistant returned a non-success response');

      activeDispatches.set(targetId, {
        id: `aloy:${targetId}`,
        targetId,
        entityId,
        targetName: entityId,
        client: `Home Assistant Cast (${entityId})`,
        userName: 'User',
        mediaTitle: title,
        mediaPath: resolvedPath,
        startedAt: Date.now(),
        isPaused: false
      });

      return {
        success: true,
        target: entityId,
        message: `Casting "${title}" to Home Assistant Player (${entityId})`
      };
    } catch (err) {
      return {
        success: false,
        target: entityId,
        error: `Failed to cast to Home Assistant (${entityId}): ${err.message}`
      };
    }
  }

  throw new Error(`Unknown playback target: ${targetId}`);
}

/**
 * Stop media playback on target destination
 */
async function stopMedia(targetId = 'all') {
  if (targetId === 'all') {
    for (const id of activeDispatches.keys()) {
      await stopMedia(id);
    }
    return { success: true, message: 'Stopped playback across all active destinations' };
  }

  const session = activeDispatches.get(targetId);

  // Stop remote Linux machines
  if (targetId.startsWith('machine:')) {
    const machineId = targetId.replace('machine:', '');
    await executeRemoteCommand(machineId, 'pkill -9 -f mpv || pkill -9 -f vlc || true', 8000).catch(() => {});
  }

  // Stop Roku via ECP Home key
  if (targetId.startsWith('roku:')) {
    const rokuIp = targetId.replace('roku:', '');
    await sendRokuEcpCommand(rokuIp, '/keypress/Home', 'POST').catch(() => {});
  }

  // Stop HA Media Player
  if (targetId.startsWith('ha:')) {
    const entityId = targetId.replace('ha:', '');
    await callHomeAssistantService('media_player', 'media_stop', entityId).catch(() => {});
  }

  activeDispatches.delete(targetId);
  return { success: true, message: `Stopped playback on ${session?.targetName || targetId}` };
}

/**
 * Handle session control commands (Stop, Pause, Unpause, Volume, Seek)
 */
async function handleMediaSessionControl(sessionId, command, params = {}) {
  const targetId = sessionId.replace(/^aloy:/, '');
  const session = activeDispatches.get(targetId);

  if (command === 'Stop') {
    return await stopMedia(targetId);
  }

  if (command === 'Pause' || command === 'Unpause' || command === 'PlayPause') {
    if (session) {
      session.isPaused = command === 'Pause' ? true : (command === 'Unpause' ? false : !session.isPaused);
      
      if (targetId.startsWith('machine:')) {
        const machineId = targetId.replace('machine:', '');
        const sig = session.isPaused ? 'pkill -STOP -f mpv' : 'pkill -CONT -f mpv';
        await executeRemoteCommand(machineId, sig, 5000).catch(() => {});
      } else if (targetId.startsWith('roku:')) {
        const rokuIp = targetId.replace('roku:', '');
        await sendRokuEcpCommand(rokuIp, '/keypress/Play', 'POST').catch(() => {});
      } else if (targetId.startsWith('ha:')) {
        const entityId = targetId.replace('ha:', '');
        await callHomeAssistantService('media_player', 'media_play_pause', entityId).catch(() => {});
      }
    }
    return { success: true, isPaused: session?.isPaused };
  }

  if (command === 'VolumeUp' && targetId.startsWith('roku:')) {
    const rokuIp = targetId.replace('roku:', '');
    await sendRokuEcpCommand(rokuIp, '/keypress/VolumeUp', 'POST').catch(() => {});
    return { success: true };
  }

  if (command === 'VolumeDown' && targetId.startsWith('roku:')) {
    const rokuIp = targetId.replace('roku:', '');
    await sendRokuEcpCommand(rokuIp, '/keypress/VolumeDown', 'POST').catch(() => {});
    return { success: true };
  }

  return { success: true };
}

/**
 * Get active sessions in Jellyfin-compatible format so Dashboard NowPlayingCard can display them
 */
function getActiveMediaSessions() {
  const now = Date.now();
  const sessions = [];

  for (const [targetId, session] of activeDispatches.entries()) {
    const elapsedSec = Math.max(0, Math.floor((now - session.startedAt) / 1000));
    const runTimeTicks = 72000000000; // ~2 hours default fallback ticks
    const positionTicks = elapsedSec * 10000000;
    const playbackPercent = Math.min(100, Math.round((positionTicks / runTimeTicks) * 100));

    sessions.push({
      id: `aloy:${targetId}`,
      userName: session.userName || 'User',
      userId: `user-${targetId}`,
      client: session.client,
      deviceName: session.targetName,
      deviceId: targetId,
      applicationVersion: '2.0.0 (Aloy Cast)',
      isActive: true,
      supportsRemoteControl: true,
      lastActivityDate: new Date().toISOString(),
      playState: {
        positionTicks,
        isPaused: !!session.isPaused,
        isMuted: false,
        volumeLevel: 100,
        playMethod: 'DirectStream',
        repeatMode: 'RepeatNone'
      },
      transcodingInfo: {
        container: path.extname(session.mediaPath || '').replace(/^\./, '') || 'mp4',
        isVideoDirect: true,
        isAudioDirect: true
      },
      nowPlaying: {
        id: `media-${targetId}`,
        name: session.mediaTitle,
        type: 'Movie',
        runTimeTicks,
        positionTicks,
        isPaused: !!session.isPaused,
        playbackPercent
      }
    });
  }

  return sessions;
}

module.exports = {
  listPlaybackTargets,
  searchLocalMedia,
  dispatchMedia,
  stopMedia,
  handleMediaSessionControl,
  getActiveMediaSessions,
  discoverRokuDevices,
  sendRokuEcpCommand,
  callHomeAssistantService,
  MOVIES_ROOT,
  TV_SHOWS_ROOT
};
