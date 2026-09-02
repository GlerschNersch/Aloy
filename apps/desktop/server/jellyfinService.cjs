/**
 * Aloy Jellyfin Media Orchestrator & Lifecycle Management Service
 * Handles multi-device remote control, live WebSocket session monitoring,
 * semantic library search, autonomous auto-start/restart, and health diagnostics.
 */
const http = require('http');
const https = require('https');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const DEFAULT_JELLYFIN_URL = process.env.JELLYFIN_URL || 'http://127.0.0.1:8096';
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || '';
const JELLYFIN_ROOT_DIR = process.env.JELLYFIN_DIR || path.join(os.homedir(), 'Jellyfin');

class JellyfinService extends EventEmitter {
  constructor(baseUrl = DEFAULT_JELLYFIN_URL, apiKey = JELLYFIN_API_KEY, rootDir = JELLYFIN_ROOT_DIR) {
    super();
    this.baseUrl = (baseUrl || DEFAULT_JELLYFIN_URL).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.rootDir = rootDir;
    this.cachedStatus = null;
    this.liveSessions = [];
    this.ws = null;
    this.wsReconnectTimer = null;
    this.isWsRunning = false;
    this.lastWsHeartbeat = null;
  }

  getEffectiveApiKey() {
    if (this.apiKey) return this.apiKey;
    if (process.env.JELLYFIN_API_KEY) return process.env.JELLYFIN_API_KEY;
    try {
      const defaultStore = require('./store.cjs');
      const d = defaultStore.load();
      if (d.jellyfinApiKey) return d.jellyfinApiKey;
    } catch {}

    // Fallback: Read ~/.aloy-server/.env if not present in process.env
    try {
      const envPath = path.join(os.homedir(), '.aloy-server', '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^JELLYFIN_API_KEY\s*=\s*(.+)$/m);
        if (match && match[1]) {
          const key = match[1].trim().replace(/^["']|["']$/g, '');
          if (key) return key;
        }
      }
    } catch {}

    return '';
  }

  setApiKey(key) {
    this.apiKey = key;
    try {
      const defaultStore = require('./store.cjs');
      defaultStore.save({ jellyfinApiKey: key });
    } catch {}
  }

  /**
   * Helper to make HTTP requests to Jellyfin
   */
  async _request(reqPath, method = 'GET', body = null) {
    const url = new URL(`${this.baseUrl}${reqPath}`);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Accept': 'application/json',
      'X-Emby-Client': 'Aloy Assistant',
      'X-Emby-Device-Name': 'Aloy Server',
      'X-Emby-Device-Id': 'aloy-server-core',
      'X-Emby-Client-Version': '1.0.0',
    };

    const token = this.getEffectiveApiKey();
    if (token) {
      headers['X-Emby-Token'] = token;
      headers['Authorization'] = `MediaBrowser Token="${token}"`;
    }

    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
    }

    return new Promise((resolve) => {
      const req = lib.request(
        url,
        {
          method,
          headers,
          timeout: 4000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(data ? JSON.parse(data) : { success: true, statusCode: res.statusCode });
              } catch {
                resolve({ success: true, raw: data });
              }
            } else {
              resolve({
                success: false,
                statusCode: res.statusCode,
                error: `Jellyfin HTTP ${res.statusCode}: ${data || res.statusMessage}`,
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request to Jellyfin timed out' });
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Check Jellyfin public status & server identity
   */
  async getStatus() {
    const info = await this._request('/System/Info/Public');
    if (info && info.ServerName) {
      this.cachedStatus = {
        online: true,
        serverName: info.ServerName,
        version: info.Version,
        localAddress: info.LocalAddress || this.baseUrl,
        id: info.Id,
        url: this.baseUrl,
        wsConnected: !!(this.ws && this.ws.readyState === 1),
      };
      return this.cachedStatus;
    }

    return {
      online: false,
      url: this.baseUrl,
      error: info.error || 'Server not reachable',
      wsConnected: false,
    };
  }

  /**
   * Start Jellyfin in background using the silent VBS script
   */
  async startServer() {
    return new Promise((resolve) => {
      const vbsPath = path.join(this.rootDir, 'start_jellyfin_silent.vbs');
      const exePath = path.join(this.rootDir, 'jellyfin', 'jellyfin.exe');

      if (fs.existsSync(vbsPath)) {
        exec(`wscript.exe "${vbsPath}"`, (err) => {
          if (err) {
            resolve({ success: false, error: `Failed to execute VBS starter: ${err.message}` });
          } else {
            resolve({ success: true, message: 'Jellyfin start command dispatched silently.' });
          }
        });
      } else if (fs.existsSync(exePath)) {
        const child = spawn(
          exePath,
          [
            '--datadir',
            path.join(this.rootDir, 'data'),
            '--cachedir',
            path.join(this.rootDir, 'cache'),
          ],
          {
            detached: true,
            stdio: 'ignore',
            cwd: path.join(this.rootDir, 'jellyfin'),
          }
        );
        child.unref();
        resolve({ success: true, message: 'Jellyfin executable spawned in background.' });
      } else {
        resolve({ success: false, error: `Jellyfin installation directory not found at ${this.rootDir}` });
      }
    });
  }

  /**
   * Restart Jellyfin server cleanly
   */
  async restartServer() {
    return new Promise((resolve) => {
      const restartBat = path.join(this.rootDir, 'restart_jellyfin.bat');
      if (fs.existsSync(restartBat)) {
        exec(`"${restartBat}"`, (err) => {
          if (err) {
            resolve({ success: false, error: `Restart script failed: ${err.message}` });
          } else {
            resolve({ success: true, message: 'Jellyfin restart script completed.' });
          }
        });
      } else {
        // Fallback: taskkill then start
        exec('taskkill /F /IM jellyfin.exe', async () => {
          setTimeout(async () => {
            const startRes = await this.startServer();
            resolve({ success: true, ...startRes });
          }, 1500);
        });
      }
    });
  }

  /**
   * Stop Jellyfin server process
   */
  async stopServer() {
    return new Promise((resolve) => {
      exec('taskkill /F /IM jellyfin.exe', (err, stdout, stderr) => {
        if (err && !stdout.includes('SUCCESS') && !stderr.includes('not found')) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, message: 'Jellyfin process terminated.' });
        }
      });
    });
  }

  /**
   * Comprehensive Diagnostics Engine
   * Inspects process table, port 8096 connectivity, and recent log files for errors.
   */
  async diagnose() {
    const report = {
      timestamp: new Date().toISOString(),
      healthy: false,
      processRunning: false,
      portListening: false,
      version: null,
      serverName: null,
      recentErrors: [],
      summary: '',
      suggestedFix: null,
    };

    // 1. Check HTTP reachability
    const status = await this.getStatus();
    if (status.online) {
      report.healthy = true;
      report.processRunning = true;
      report.portListening = true;
      report.version = status.version;
      report.serverName = status.serverName;
      report.summary = `Jellyfin Server (${status.serverName || 'Aloy Server'} v${status.version}) is healthy and listening on ${this.baseUrl}.`;
      return report;
    }

    // 2. Check process table via tasklist
    await new Promise((resolve) => {
      exec('tasklist /FI "IMAGENAME eq jellyfin.exe" /NH', (err, stdout) => {
        if (!err && stdout && stdout.toLowerCase().includes('jellyfin.exe')) {
          report.processRunning = true;
        }
        resolve();
      });
    });

    // 3. Inspect recent log file for crash causes
    try {
      const logDir = path.join(this.rootDir, 'data', 'log');
      if (fs.existsSync(logDir)) {
        const files = fs
          .readdirSync(logDir)
          .filter((f) => f.startsWith('log_') && f.endsWith('.log'))
          .sort()
          .reverse();

        if (files.length > 0) {
          const latestLog = path.join(logDir, files[0]);
          const content = fs.readFileSync(latestLog, 'utf-8');
          const lines = content.split('\n');

          const errorLines = lines
            .filter((l) => l.includes('[ERR]') || l.includes('[FTL]') || l.includes('Exception') || l.includes('address already in use'))
            .slice(-5)
            .map((l) => l.trim());

          report.recentErrors = errorLines;

          if (content.includes('address already in use') || content.includes('10048')) {
            report.suggestedFix = 'Port 8096 is already bound by another application. Click Restart Server to clear port locks.';
          } else if (content.includes('database is locked')) {
            report.suggestedFix = 'SQLite database was locked. Restarting the server will reset file handles.';
          }
        }
      }
    } catch {}

    // Formulate final diagnostic summary
    if (!report.processRunning) {
      report.summary = 'Jellyfin is not running. The background process is stopped.';
      report.suggestedFix = report.suggestedFix || 'Click "Start Server" to launch Jellyfin in the background.';
    } else if (!report.portListening) {
      report.summary = 'Jellyfin process is running but not responding on port 8096 (starting up or stuck).';
      report.suggestedFix = report.suggestedFix || 'Click "Restart Server" to recycle the server process.';
    }

    return report;
  }

  /**
   * Helper to normalize session objects into a clean structure
   */
  _normalizeSession(s) {
    if (!s) return null;
    const nowPlaying = s.NowPlayingItem
      ? {
          id: s.NowPlayingItem.Id,
          name: s.NowPlayingItem.Name,
          seriesName: s.NowPlayingItem.SeriesName,
          seasonName: s.NowPlayingItem.SeasonName,
          seasonNumber: s.NowPlayingItem.IndexNumberSeason ?? null,
          episodeNumber: s.NowPlayingItem.IndexNumber ?? null,
          episodeTitle: s.NowPlayingItem.EpisodeTitle || s.NowPlayingItem.Name,
          type: s.NowPlayingItem.Type,
          runTimeTicks: s.NowPlayingItem.RunTimeTicks,
          positionTicks: s.PlayState ? s.PlayState.PositionTicks || 0 : 0,
          isPaused: s.PlayState ? !!s.PlayState.IsPaused : false,
          playbackPercent:
            s.NowPlayingItem.RunTimeTicks && s.PlayState && s.PlayState.PositionTicks
              ? Math.min(100, Math.max(0, Math.round((s.PlayState.PositionTicks / s.NowPlayingItem.RunTimeTicks) * 100)))
              : 0,
          artists: Array.isArray(s.NowPlayingItem.Artists)
            ? s.NowPlayingItem.Artists
            : s.NowPlayingItem.ArtistItems
            ? s.NowPlayingItem.ArtistItems.map((a) => a.Name)
            : [],
          album: s.NowPlayingItem.Album || null,
          productionYear: s.NowPlayingItem.ProductionYear || null,
          overview: s.NowPlayingItem.Overview || null,
        }
      : null;

    return {
      id: s.Id,
      userName: s.UserName || 'Guest',
      userId: s.UserId || null,
      client: s.Client || 'Unknown Client',
      deviceName: s.DeviceName || s.Client || 'Unknown Device',
      deviceId: s.DeviceId || null,
      applicationVersion: s.ApplicationVersion || null,
      isActive: s.IsActive !== false,
      lastActivityDate: s.LastActivityDate || null,
      supportsRemoteControl: !!s.SupportsRemoteControl,
      playState: s.PlayState
        ? {
            positionTicks: s.PlayState.PositionTicks || 0,
            isPaused: !!s.PlayState.IsPaused,
            isMuted: !!s.PlayState.IsMuted,
            volumeLevel: s.PlayState.VolumeLevel ?? 100,
            playMethod: s.PlayState.PlayMethod || 'DirectPlay',
            repeatMode: s.PlayState.RepeatMode || 'RepeatNone',
          }
        : null,
      transcodingInfo: s.TranscodingInfo
        ? {
            audioCodec: s.TranscodingInfo.AudioCodec,
            videoCodec: s.TranscodingInfo.VideoCodec,
            container: s.TranscodingInfo.Container,
            isVideoDirect: !!s.TranscodingInfo.IsVideoDirect,
            isAudioDirect: !!s.TranscodingInfo.IsAudioDirect,
            transcodeReasons: s.TranscodingInfo.TranscodeReasons || [],
          }
        : null,
      nowPlaying,
    };
  }

  /**
   * Query all active client sessions across the home
   */
  async getSessions(forceFresh = false) {
    if (!forceFresh && this.isWsRunning && this.liveSessions.length > 0) {
      return this.liveSessions;
    }

    const res = await this._request('/Sessions');
    if (res && Array.isArray(res)) {
      const normalized = res.map((s) => this._normalizeSession(s)).filter(Boolean);
      this.liveSessions = normalized;
      return normalized;
    }

    return this.liveSessions || [];
  }

  /**
   * Start live WebSocket connection to Jellyfin for instant real-time events
   */
  startWebSocket() {
    if (this.isWsRunning && this.ws && this.ws.readyState === 1) {
      return;
    }

    if (typeof globalThis.WebSocket === 'undefined') {
      return;
    }

    this.isWsRunning = true;
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    const apiKey = this.getEffectiveApiKey();
    const wsProtocol = this.baseUrl.startsWith('https') ? 'wss:' : 'ws:';
    const host = this.baseUrl.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}//${host}/socket?api_key=${encodeURIComponent(apiKey)}&deviceId=aloy-server-core`;

    try {
      this.ws = new globalThis.WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.lastWsHeartbeat = Date.now();
        // Subscribe to live session updates and activity logs
        try {
          this.ws.send(JSON.stringify({ MessageType: 'SessionsStart', Data: '0,1500' }));
          this.ws.send(JSON.stringify({ MessageType: 'ActivityLogEntryStart', Data: '0,1500' }));
        } catch {}

        // Trigger immediate session fetch to prime state
        this.getSessions(true).then((sessions) => {
          this.emit('sessions', sessions);
        }).catch(() => {});
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleWsMessage(msg);
        } catch {}
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (this.isWsRunning) {
          this._scheduleWsReconnect();
        }
      };

      this.ws.onerror = () => {
        try {
          if (this.ws) this.ws.close();
        } catch {}
      };
    } catch {
      if (this.isWsRunning) {
        this._scheduleWsReconnect();
      }
    }
  }

  /**
   * Handle incoming WebSocket messages from Jellyfin
   */
  _handleWsMessage(msg) {
    if (!msg || !msg.MessageType) return;
    this.lastWsHeartbeat = Date.now();

    const type = msg.MessageType;

    if (type === 'ForceKeepAlive' || type === 'KeepAlive') {
      if (this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
        } catch {}
      }
      return;
    }

    if (type === 'Sessions' && Array.isArray(msg.Data)) {
      const normalized = msg.Data.map((s) => this._normalizeSession(s)).filter(Boolean);
      this.liveSessions = normalized;
      this.emit('sessions', normalized);
      return;
    }

    if (type === 'PlaybackStart' || type === 'PlaybackProgress' || type === 'PlaybackStopped' || type === 'UserDataChanged') {
      this.emit('playback', msg);
      // Immediately refresh sessions
      this.getSessions(true).then((sessions) => {
        this.emit('sessions', sessions);
      }).catch(() => {});
    }
  }

  /**
   * Schedule WebSocket auto-reconnection
   */
  _scheduleWsReconnect(delay = 5000) {
    if (!this.isWsRunning || this.wsReconnectTimer) return;
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (this.isWsRunning) {
        this.startWebSocket();
      }
    }, delay);
  }

  /**
   * Stop WebSocket listener
   */
  stopWebSocket() {
    this.isWsRunning = false;
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try {
        if (this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ MessageType: 'SessionsStop' }));
        }
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  /**
   * Send playback control commands to a client device
   */
  async sendSessionCommand(sessionId, command, params = {}) {
    if (!sessionId) {
      throw new Error('sessionId is required for Jellyfin session control');
    }

    const validCommands = [
      'Play',
      'Pause',
      'Unpause',
      'PlayPause',
      'Stop',
      'NextTrack',
      'PreviousTrack',
      'SetVolume',
      'Mute',
      'Unmute',
      'Seek',
      'PlayMedia',
    ];

    if (!validCommands.includes(command)) {
      throw new Error(`Unsupported command "${command}". Valid: ${validCommands.join(', ')}`);
    }

    let endpoint = `/Sessions/${sessionId}/Playing/${command}`;
    let method = 'POST';
    let body = null;

    if (command === 'SetVolume') {
      const volume = params.volume != null ? params.volume : 50;
      endpoint = `/Sessions/${sessionId}/Command/SetVolume?volume=${encodeURIComponent(volume)}`;
    } else if (command === 'Seek') {
      const positionTicks = params.positionTicks || 0;
      endpoint = `/Sessions/${sessionId}/Playing/Seek?positionTicks=${positionTicks}`;
    } else if (command === 'PlayMedia') {
      const itemIds = Array.isArray(params.itemIds) ? params.itemIds.join(',') : (params.itemId || '');
      const playCmd = params.playCommand || 'PlayNow';
      const startTicks = params.startPositionTicks || 0;
      endpoint = `/Sessions/${sessionId}/Playing?ItemIds=${encodeURIComponent(itemIds)}&PlayCommand=${encodeURIComponent(playCmd)}&playCommand=${encodeURIComponent(playCmd)}&startPositionTicks=${startTicks}`;
      body = {
        ItemIds: Array.isArray(params.itemIds) ? params.itemIds : [params.itemId],
        PlayCommand: playCmd,
        StartPositionTicks: startTicks,
      };
    }

    const res = await this._request(endpoint, method, body);
    // Refresh sessions after commanding
    setTimeout(() => {
      this.getSessions(true).then((sessions) => {
        this.emit('sessions', sessions);
      }).catch(() => {});
    }, 500);

    return res;
  }

  /**
   * Search media in Jellyfin library
   */
  async searchMedia(searchTerm, limit = 10) {
    const encoded = encodeURIComponent(searchTerm || '');
    const res = await this._request(
      `/Search/Hints?searchTerm=${encoded}&limit=${limit}&includeItemTypes=Movie,Series,Episode,MusicAlbum`
    );

    if (res && Array.isArray(res.SearchHints)) {
      return res.SearchHints.map((item) => ({
        id: item.ItemId,
        name: item.Name,
        type: item.Type,
        year: item.ProductionYear,
        series: item.Series,
        runTimeTicks: item.RunTimeTicks,
        artists: item.Artists,
      }));
    }

    return [];
  }

  /**
   * Trigger library scan (used when AutoRip completes a disc or movie)
   */
  async refreshLibrary() {
    return await this._request('/Library/Refresh', 'POST');
  }

  /**
   * Get all media libraries configured on Jellyfin
   */
  async getLibraries() {
    const res = await this._request('/Library/MediaFolders');
    if (res && Array.isArray(res.Items)) {
      return res.Items.map((item) => ({
        id: item.Id,
        name: item.Name,
        collectionType: item.CollectionType,
        path: item.Path,
      }));
    }
    return [];
  }
}

const defaultJellyfin = new JellyfinService();

module.exports = {
  JellyfinService,
  jellyfinService: defaultJellyfin,
};
