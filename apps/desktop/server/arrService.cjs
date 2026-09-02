/**
 * Aloy Radarr & Sonarr Orchestration Service (*Arr Ecosystem)
 * Manages media acquisition, download queue monitoring, title lookup,
 * calendar tracking, webhook ingestion, and service lifecycle for
 * Radarr (Movies), Sonarr (TV), Prowlarr (Indexers), and SABnzbd (Usenet).
 */

const http = require('http');
const https = require('https');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const DEFAULT_RADARR_URL = process.env.RADARR_URL || 'http://127.0.0.1:7878';
const DEFAULT_SONARR_URL = process.env.SONARR_URL || 'http://127.0.0.1:8989';
const DEFAULT_LIDARR_URL = process.env.LIDARR_URL || 'http://127.0.0.1:8686';
const DEFAULT_PROWLARR_URL = process.env.PROWLARR_URL || 'http://127.0.0.1:9696';
const DEFAULT_SABNZBD_URL = process.env.SABNZBD_URL || 'http://127.0.0.1:8080';
const DEFAULT_RETROARR_URL = process.env.RETROARR_URL || 'http://127.0.0.1:5002';

const MEDIA_STACK_DIR = process.env.MEDIA_STACK_DIR || path.join(os.homedir(), 'MediaStack');
const SABNZBD_EXE = process.env.SABNZBD_EXE || 'C:\\Program Files\\SABnzbd\\SABnzbd.exe';

class ArrService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.radarrUrl = (options.radarrUrl || DEFAULT_RADARR_URL).replace(/\/+$/, '');
    this.sonarrUrl = (options.sonarrUrl || DEFAULT_SONARR_URL).replace(/\/+$/, '');
    this.lidarrUrl = (options.lidarrUrl || DEFAULT_LIDARR_URL).replace(/\/+$/, '');
    this.prowlarrUrl = (options.prowlarrUrl || DEFAULT_PROWLARR_URL).replace(/\/+$/, '');
    this.sabnzbdUrl = (options.sabnzbdUrl || DEFAULT_SABNZBD_URL).replace(/\/+$/, '');
    this.retroarrUrl = (options.retroarrUrl || DEFAULT_RETROARR_URL).replace(/\/+$/, '');

    this.radarrApiKey = options.radarrApiKey || process.env.RADARR_API_KEY || '';
    this.sonarrApiKey = options.sonarrApiKey || process.env.SONARR_API_KEY || '';
    this.lidarrApiKey = options.lidarrApiKey || process.env.LIDARR_API_KEY || '';
    this.prowlarrApiKey = options.prowlarrApiKey || process.env.PROWLARR_API_KEY || '';
    this.sabnzbdApiKey = options.sabnzbdApiKey || process.env.SABNZBD_API_KEY || '';
  }

  /**
   * Resolve API key for a given service
   */
  _getApiKey(service = 'radarr') {
    const s = service.toLowerCase();
    if (s === 'radarr') return this.radarrApiKey || process.env.RADARR_API_KEY || '';
    if (s === 'sonarr') return this.sonarrApiKey || process.env.SONARR_API_KEY || '';
    if (s === 'lidarr') return this.lidarrApiKey || process.env.LIDARR_API_KEY || '';
    if (s === 'prowlarr') return this.prowlarrApiKey || process.env.PROWLARR_API_KEY || '';
    if (s === 'sabnzbd') return this.sabnzbdApiKey || process.env.SABNZBD_API_KEY || '';
    return '';
  }

  _getBaseUrl(service = 'radarr') {
    const s = service.toLowerCase();
    if (s === 'radarr') return this.radarrUrl;
    if (s === 'sonarr') return this.sonarrUrl;
    if (s === 'lidarr') return this.lidarrUrl;
    if (s === 'prowlarr') return this.prowlarrUrl;
    if (s === 'sabnzbd') return this.sabnzbdUrl;
    if (s === 'retroarr') return this.retroarrUrl;
    return this.radarrUrl;
  }

  /**
   * Generic HTTP request to Radarr, Sonarr, Lidarr, or Prowlarr API
   */
  async _request(service, endpoint, method = 'GET', body = null) {
    const baseUrl = this._getBaseUrl(service);
    const apiKey = this._getApiKey(service);
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const sLower = service.toLowerCase();
    const apiPrefix = (sLower === 'prowlarr' || sLower === 'lidarr') ? '/api/v1' : '/api/v3';
    const url = new URL(`${baseUrl}${apiPrefix}${normalizedEndpoint}`);

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Accept': 'application/json',
      'X-Api-Key': apiKey,
      'User-Agent': 'Aloy-Media-Orchestrator/1.0',
    };

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
                resolve({ success: true, data: data ? JSON.parse(data) : null, statusCode: res.statusCode });
              } catch {
                resolve({ success: true, raw: data, statusCode: res.statusCode });
              }
            } else {
              resolve({
                success: false,
                statusCode: res.statusCode,
                error: `${service} HTTP ${res.statusCode}: ${data || res.statusMessage}`,
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({ success: false, error: `${service} connection error: ${err.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: `${service} request timed out` });
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Canonical roster of every native process in the Media Stack, keyed by the
   * lowercase name used throughout this service and its HTTP routes. Single
   * source of truth for startStack/stopStack AND the per-service
   * start/stop/restart methods below — previously startStack/stopStack each
   * had their own hardcoded app list, and RetroArr was missing from both
   * (silently unmanaged by either), which is exactly the kind of drift this
   * consolidation exists to prevent.
   */
  get _serviceDefs() {
    return {
      prowlarr: {
        displayName: 'Prowlarr',
        exe: path.join(MEDIA_STACK_DIR, 'Prowlarr', 'Prowlarr.Console.exe'),
        args: ['--data=C:\\ProgramData\\Prowlarr', '--nobrowser'],
        cwd: path.join(MEDIA_STACK_DIR, 'Prowlarr'),
        imageNames: ['Prowlarr.Console.exe', 'Prowlarr.exe'],
      },
      radarr: {
        displayName: 'Radarr',
        exe: path.join(MEDIA_STACK_DIR, 'Radarr', 'Radarr.Console.exe'),
        args: ['--data=C:\\ProgramData\\Radarr', '--nobrowser'],
        cwd: path.join(MEDIA_STACK_DIR, 'Radarr'),
        imageNames: ['Radarr.Console.exe', 'Radarr.exe'],
      },
      sonarr: {
        displayName: 'Sonarr',
        exe: path.join(MEDIA_STACK_DIR, 'Sonarr', 'Sonarr.Console.exe'),
        args: ['--data=C:\\ProgramData\\Sonarr', '--nobrowser'],
        cwd: path.join(MEDIA_STACK_DIR, 'Sonarr'),
        imageNames: ['Sonarr.Console.exe', 'Sonarr.exe'],
      },
      lidarr: {
        displayName: 'Lidarr',
        exe: path.join(MEDIA_STACK_DIR, 'Lidarr', 'Lidarr.Console.exe'),
        args: ['--data=C:\\ProgramData\\Lidarr', '--nobrowser'],
        cwd: path.join(MEDIA_STACK_DIR, 'Lidarr'),
        imageNames: ['Lidarr.Console.exe', 'Lidarr.exe'],
      },
      sabnzbd: {
        displayName: 'SABnzbd',
        exe: SABNZBD_EXE,
        args: ['-b', '0'],
        cwd: path.dirname(SABNZBD_EXE),
        imageNames: ['SABnzbd.exe'],
      },
      retroarr: {
        displayName: 'RetroArr',
        exe: path.join(MEDIA_STACK_DIR, 'RetroArr', 'RetroArr.Host.exe'),
        args: [],
        cwd: path.join(MEDIA_STACK_DIR, 'RetroArr'),
        imageNames: ['RetroArr.Host.exe'],
      },
    };
  }

  /**
   * Start a single named service (see _serviceDefs for valid names). Safe to
   * call when it's already running or when its executable is missing — both
   * come back as a normal {success:false, error} rather than throwing.
   */
  async startService(name) {
    const key = (name || '').toLowerCase();
    const def = this._serviceDefs[key];
    if (!def) {
      return { success: false, error: `Unknown service "${name}". Valid: ${Object.keys(this._serviceDefs).join(', ')}` };
    }
    if (!fs.existsSync(def.exe)) {
      return { success: false, error: `${def.displayName} executable not found at ${def.exe}` };
    }
    try {
      const child = spawn(def.exe, def.args, {
        detached: true,
        stdio: 'ignore',
        cwd: def.cwd,
      });
      child.unref();
      return { success: true, message: `${def.displayName} start command dispatched.` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop a single named service. taskkill against a process that isn't
   * running exits non-zero ("not found") — that's not a failure from the
   * caller's point of view (the desired end state, "not running", already
   * holds), so this always resolves success:true rather than surfacing it.
   */
  async stopService(name) {
    const key = (name || '').toLowerCase();
    const def = this._serviceDefs[key];
    if (!def) {
      return { success: false, error: `Unknown service "${name}". Valid: ${Object.keys(this._serviceDefs).join(', ')}` };
    }
    const imageArgs = def.imageNames.map((n) => `/IM ${n}`).join(' ');
    return new Promise((resolve) => {
      exec(`taskkill /F ${imageArgs}`, (_err, stdout) => {
        resolve({ success: true, message: stdout || `Stop signal dispatched for ${def.displayName}.` });
      });
    });
  }

  /**
   * Stop then start a single named service. The delay gives Windows a moment
   * to release the port/file handles before the new process binds them —
   * mirrors jellyfinService.restartServer's fallback timing.
   */
  async restartService(name) {
    const stopRes = await this.stopService(name);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const startRes = await this.startService(name);
    return { success: startRes.success, stop: stopRes, start: startRes };
  }

  /**
   * Start all Media Stack services in the background
   */
  async startStack() {
    const results = {};
    for (const [key, def] of Object.entries(this._serviceDefs)) {
      results[def.displayName] = await this.startService(key);
    }
    return results;
  }

  /**
   * Stop all Media Stack background processes
   */
  async stopStack() {
    const allImages = Object.values(this._serviceDefs).flatMap((d) => d.imageNames);
    const imageArgs = allImages.map((n) => `/IM ${n}`).join(' ');
    return new Promise((resolve) => {
      exec(`taskkill /F ${imageArgs}`, (_err, stdout) => {
        resolve({ success: true, message: stdout || 'Stop signals dispatched.' });
      });
    });
  }

  /**
   * Stop then start the entire stack.
   */
  async restartStack() {
    const stopRes = await this.stopStack();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const startRes = await this.startStack();
    return { success: true, stop: stopRes, start: startRes };
  }

  /**
   * Bare reachability check — resolves true on ANY response (even a non-2xx
   * or an auth challenge), false only on connection failure/timeout. Used for
   * SABnzbd/RetroArr, which don't share Radarr/Sonarr/Lidarr/Prowlarr's
   * /system/status API shape, so "is it even listening" is the honest signal
   * available here.
   */
  async _pingUrl(url) {
    return new Promise((resolve) => {
      let target;
      try {
        target = new URL(url);
      } catch {
        resolve(false);
        return;
      }
      const lib = target.protocol === 'https:' ? https : http;
      const req = lib.request(target, { method: 'GET', timeout: 3000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  /**
   * Check status & version of all stack instances
   */
  async getStatus() {
    const [radarrRes, sonarrRes, lidarrRes, prowlarrRes, sabnzbdOnline, retroarrOnline] = await Promise.all([
      this._request('radarr', '/system/status').catch((err) => ({ success: false, error: err.message })),
      this._request('sonarr', '/system/status').catch((err) => ({ success: false, error: err.message })),
      this._request('lidarr', '/system/status').catch((err) => ({ success: false, error: err.message })),
      this._request('prowlarr', '/system/status').catch((err) => ({ success: false, error: err.message })),
      this._pingUrl(this.sabnzbdUrl + '/'),
      this._pingUrl(this.retroarrUrl + '/'),
    ]);

    return {
      radarr: {
        online: !!(radarrRes && radarrRes.success && radarrRes.data?.version),
        version: radarrRes.data?.version || null,
        url: this.radarrUrl,
        appName: radarrRes.data?.appName || 'Radarr',
        error: radarrRes.error || null,
      },
      sonarr: {
        online: !!(sonarrRes && sonarrRes.success && sonarrRes.data?.version),
        version: sonarrRes.data?.version || null,
        url: this.sonarrUrl,
        appName: sonarrRes.data?.appName || 'Sonarr',
        error: sonarrRes.error || null,
      },
      lidarr: {
        online: !!(lidarrRes && lidarrRes.success && lidarrRes.data?.version),
        version: lidarrRes.data?.version || null,
        url: this.lidarrUrl,
        appName: lidarrRes.data?.appName || 'Lidarr',
        error: lidarrRes.error || null,
      },
      prowlarr: {
        online: !!(prowlarrRes && prowlarrRes.success && prowlarrRes.data?.version),
        version: prowlarrRes.data?.version || null,
        url: this.prowlarrUrl,
        appName: prowlarrRes.data?.appName || 'Prowlarr',
        error: prowlarrRes.error || null,
      },
      sabnzbd: {
        online: !!sabnzbdOnline,
        version: null,
        url: this.sabnzbdUrl,
        appName: 'SABnzbd',
        error: sabnzbdOnline ? null : 'SABnzbd connection error: not reachable',
      },
      retroarr: {
        online: !!retroarrOnline,
        version: null,
        url: this.retroarrUrl,
        appName: 'RetroArr',
        error: retroarrOnline ? null : 'RetroArr connection error: not reachable',
      },
    };
  }

  /**
   * Get active download queues from Radarr, Sonarr, and Lidarr
   */
  async getQueue() {
    const [radarrRes, sonarrRes, lidarrRes, retroarrRes] = await Promise.all([
      this._request('radarr', '/queue?includeUnknownMovieItems=true').catch(() => ({ success: false })),
      this._request('sonarr', '/queue?includeUnknownSeriesItems=true').catch(() => ({ success: false })),
      this._request('lidarr', '/queue?includeUnknownArtistItems=true').catch(() => ({ success: false })),
      this._request('retroarr', '/downloadclient/queue').catch(() => ({ success: false })),
    ]);

    const queue = [];

    // Parse Radarr queue
    if (radarrRes.success && Array.isArray(radarrRes.data?.records)) {
      for (const item of radarrRes.data.records) {
        queue.push({
          id: `radarr-${item.id}`,
          service: 'radarr',
          mediaType: 'movie',
          title: item.movie?.title || item.title || 'Unknown Movie',
          year: item.movie?.year || null,
          size: item.size || 0,
          sizeleft: item.sizeleft || 0,
          timeleft: item.timeleft || null,
          estimatedCompletionTime: item.estimatedCompletionTime || null,
          status: item.status || 'downloading',
          trackedDownloadState: item.trackedDownloadState || item.status,
          protocol: item.protocol || 'unknown',
          downloadClient: item.downloadClient || 'Unknown Client',
          indexer: item.indexer || null,
          errorMessage: item.errorMessage || null,
        });
      }
    }

    // Parse Sonarr queue
    if (sonarrRes.success && Array.isArray(sonarrRes.data?.records)) {
      for (const item of sonarrRes.data.records) {
        const episode = item.episode ? `S${String(item.episode.seasonNumber).padStart(2, '0')}E${String(item.episode.episodeNumber).padStart(2, '0')}` : '';
        const title = item.series?.title
          ? `${item.series.title}${episode ? ` - ${episode}` : ''}`
          : item.title || 'Unknown Series';

        queue.push({
          id: `sonarr-${item.id}`,
          service: 'sonarr',
          mediaType: 'series',
          title,
          seriesTitle: item.series?.title || null,
          episodeInfo: episode || null,
          size: item.size || 0,
          sizeleft: item.sizeleft || 0,
          timeleft: item.timeleft || null,
          estimatedCompletionTime: item.estimatedCompletionTime || null,
          status: item.status || 'downloading',
          trackedDownloadState: item.trackedDownloadState || item.status,
          protocol: item.protocol || 'unknown',
          downloadClient: item.downloadClient || 'Unknown Client',
          indexer: item.indexer || null,
          errorMessage: item.errorMessage || null,
        });
      }
    }

    // Parse Lidarr queue
    if (lidarrRes.success && Array.isArray(lidarrRes.data?.records)) {
      for (const item of lidarrRes.data.records) {
        const title = item.artist?.artistName
          ? `${item.artist.artistName} - ${item.album?.title || item.title || 'Unknown Album'}`
          : item.title || 'Unknown Music';

        queue.push({
          id: `lidarr-${item.id}`,
          service: 'lidarr',
          mediaType: 'music',
          title,
          artist: item.artist?.artistName || null,
          album: item.album?.title || null,
          size: item.size || 0,
          sizeleft: item.sizeleft || 0,
          timeleft: item.timeleft || null,
          estimatedCompletionTime: item.estimatedCompletionTime || null,
          status: item.status || 'downloading',
          trackedDownloadState: item.trackedDownloadState || item.status,
          protocol: item.protocol || 'unknown',
          downloadClient: item.downloadClient || 'Unknown Client',
          indexer: item.indexer || null,
          errorMessage: item.errorMessage || null,
        });
      }
    }

    // Parse RetroArr queue
    if (retroarrRes.success && Array.isArray(retroarrRes.data)) {
      for (const item of retroarrRes.data) {
        queue.push({
          id: `retroarr-${item.id || item.downloadId || Math.random()}`,
          service: 'retroarr',
          mediaType: 'game',
          title: item.title || item.name || 'Unknown Game',
          size: item.size || item.totalBytes || 0,
          sizeleft: item.sizeleft || item.remainingBytes || 0,
          timeleft: item.timeleft || item.eta || null,
          status: item.status || 'downloading',
          trackedDownloadState: item.status || 'downloading',
          protocol: 'usenet',
          downloadClient: item.clientName || 'SABnzbd',
          indexer: 'NZBgeek',
          errorMessage: null,
        });
      }
    }

    return {
      total: queue.length,
      queue,
      radarrConnected: !!radarrRes.success,
      sonarrConnected: !!sonarrRes.success,
      lidarrConnected: !!lidarrRes.success,
      retroarrConnected: !!retroarrRes.success,
    };
  }

  /**
   * Search for movies and/or TV shows across Radarr and Sonarr
   */
  async searchMedia(term, type = 'all') {
    if (!term || typeof term !== 'string') return { movies: [], series: [], music: [] };

    const searchMovies = type === 'all' || type === 'movie' || type === 'movies';
    const searchSeries = type === 'all' || type === 'series' || type === 'tv';
    const searchMusic = type === 'all' || type === 'music' || type === 'artist';

    const promises = [];
    if (searchMovies) {
      promises.push(
        this._request('radarr', `/movie/lookup?term=${encodeURIComponent(term)}`)
          .then((res) => ({ type: 'movies', res }))
          .catch((err) => ({ type: 'movies', res: { success: false, error: err.message } }))
      );
    }
    if (searchSeries) {
      promises.push(
        this._request('sonarr', `/series/lookup?term=${encodeURIComponent(term)}`)
          .then((res) => ({ type: 'series', res }))
          .catch((err) => ({ type: 'series', res: { success: false, error: err.message } }))
      );
    }
    if (searchMusic) {
      promises.push(
        this._request('lidarr', `/artist/lookup?term=${encodeURIComponent(term)}`)
          .then((res) => ({ type: 'music', res }))
          .catch((err) => ({ type: 'music', res: { success: false, error: err.message } }))
      );
    }

    const results = await Promise.all(promises);
    const output = { movies: [], series: [], music: [] };

    for (const r of results) {
      if (r.type === 'movies' && r.res.success && Array.isArray(r.res.data)) {
        output.movies = r.res.data.slice(0, 10).map((m) => ({
          title: m.title,
          year: m.year,
          tmdbId: m.tmdbId,
          imdbId: m.imdbId,
          overview: m.overview ? (m.overview.length > 200 ? `${m.overview.slice(0, 197)}...` : m.overview) : null,
          inLibrary: !!(m.id && m.id > 0),
          id: m.id || null,
          monitored: !!m.monitored,
          hasFile: !!m.hasFile,
          folderName: m.folderName || null,
        }));
      } else if (r.type === 'series' && r.res.success && Array.isArray(r.res.data)) {
        output.series = r.res.data.slice(0, 10).map((s) => ({
          title: s.title,
          year: s.year,
          tvdbId: s.tvdbId,
          imdbId: s.imdbId,
          overview: s.overview ? (s.overview.length > 200 ? `${s.overview.slice(0, 197)}...` : s.overview) : null,
          inLibrary: !!(s.id && s.id > 0),
          id: s.id || null,
          monitored: !!s.monitored,
          seasonCount: s.seasonCount || (s.seasons ? s.seasons.length : 0),
          status: s.status || 'unknown',
        }));
      } else if (r.type === 'music' && r.res.success && Array.isArray(r.res.data)) {
        output.music = r.res.data.slice(0, 10).map((a) => ({
          artistName: a.artistName,
          foreignArtistId: a.foreignArtistId,
          overview: a.overview ? (a.overview.length > 200 ? `${a.overview.slice(0, 197)}...` : a.overview) : null,
          inLibrary: !!(a.id && a.id > 0),
          id: a.id || null,
          monitored: !!a.monitored,
          genres: a.genres || [],
          disambiguation: a.disambiguation || null,
        }));
      }
    }

    return output;
  }

  /**
   * Get root storage folders configured in Radarr and Sonarr
   */
  async getRootFolders() {
    const [radarrRes, sonarrRes] = await Promise.all([
      this._request('radarr', '/rootfolder'),
      this._request('sonarr', '/rootfolder'),
    ]);

    return {
      radarr: radarrRes.success && Array.isArray(radarrRes.data)
        ? radarrRes.data.map((rf) => ({ id: rf.id, path: rf.path, freeSpace: rf.freeSpace }))
        : [],
      sonarr: sonarrRes.success && Array.isArray(sonarrRes.data)
        ? sonarrRes.data.map((rf) => ({ id: rf.id, path: rf.path, freeSpace: rf.freeSpace }))
        : [],
    };
  }

  /**
   * Get quality profiles available in Radarr and Sonarr
   */
  async getQualityProfiles() {
    const [radarrRes, sonarrRes] = await Promise.all([
      this._request('radarr', '/qualityprofile'),
      this._request('sonarr', '/qualityprofile'),
    ]);

    return {
      radarr: radarrRes.success && Array.isArray(radarrRes.data)
        ? radarrRes.data.map((p) => ({ id: p.id, name: p.name }))
        : [],
      sonarr: sonarrRes.success && Array.isArray(sonarrRes.data)
        ? sonarrRes.data.map((p) => ({ id: p.id, name: p.name }))
        : [],
    };
  }

  /**
   * Add a movie to Radarr and start monitoring/search
   */
  async addMovie({ tmdbId, title, year, qualityProfileId, rootFolderPath, searchForMovie = true }) {
    if (!tmdbId && !title) {
      throw new Error('tmdbId or title is required to add a movie');
    }

    let movieData = null;
    const lookupRes = await this._request('radarr', `/movie/lookup?term=${encodeURIComponent(tmdbId ? `tmdb:${tmdbId}` : title)}`);
    if (lookupRes.success && Array.isArray(lookupRes.data) && lookupRes.data.length > 0) {
      movieData = lookupRes.data[0];
    } else {
      throw new Error(`Movie lookup failed for "${title || tmdbId}" in Radarr.`);
    }

    if (!rootFolderPath) {
      const rf = await this.getRootFolders();
      if (rf.radarr.length > 0) rootFolderPath = rf.radarr[0].path;
      else rootFolderPath = 'P:\\Movies';
    }

    if (!qualityProfileId) {
      const qp = await this.getQualityProfiles();
      if (qp.radarr.length > 0) qualityProfileId = qp.radarr[0].id;
      else qualityProfileId = 1;
    }

    const payload = {
      ...movieData,
      qualityProfileId: qualityProfileId || 1,
      rootFolderPath,
      monitored: true,
      addOptions: {
        searchForMovie: searchForMovie !== false,
      },
    };

    const res = await this._request('radarr', '/movie', 'POST', payload);
    return res;
  }

  /**
   * Add a TV series to Sonarr and start monitoring/search
   */
  async addSeries({ tvdbId, title, qualityProfileId, rootFolderPath, searchForMissingEpisodes = true }) {
    if (!tvdbId && !title) {
      throw new Error('tvdbId or title is required to add a series');
    }

    let seriesData = null;
    const lookupRes = await this._request('sonarr', `/series/lookup?term=${encodeURIComponent(tvdbId ? `tvdb:${tvdbId}` : title)}`);
    if (lookupRes.success && Array.isArray(lookupRes.data) && lookupRes.data.length > 0) {
      seriesData = lookupRes.data[0];
    } else {
      throw new Error(`Series lookup failed for "${title || tvdbId}" in Sonarr.`);
    }

    if (!rootFolderPath) {
      const rf = await this.getRootFolders();
      if (rf.sonarr.length > 0) rootFolderPath = rf.sonarr[0].path;
      else rootFolderPath = 'P:\\TV Shows';
    }

    if (!qualityProfileId) {
      const qp = await this.getQualityProfiles();
      if (qp.sonarr.length > 0) qualityProfileId = qp.sonarr[0].id;
      else qualityProfileId = 1;
    }

    const payload = {
      ...seriesData,
      qualityProfileId: qualityProfileId || 1,
      rootFolderPath,
      monitored: true,
      addOptions: {
        searchForMissingEpisodes: searchForMissingEpisodes !== false,
      },
    };

    const res = await this._request('sonarr', '/series', 'POST', payload);
    return res;
  }

  /**
   * Add an artist to Lidarr and start monitoring/search
   */
  async addArtist({ artistName, foreignArtistId, qualityProfileId, metadataProfileId, rootFolderPath = 'P:\\Music', searchForMissing = true }) {
    if (!artistName && !foreignArtistId) {
      throw new Error('artistName or foreignArtistId is required to add an artist to Lidarr');
    }

    let artistData = null;
    if (foreignArtistId) {
      const lookup = await this._request('lidarr', `/artist/lookup?term=lidarr:${foreignArtistId}`);
      if (lookup.success && Array.isArray(lookup.data) && lookup.data.length > 0) {
        artistData = lookup.data[0];
      }
    }

    if (!artistData && artistName) {
      const lookup = await this._request('lidarr', `/artist/lookup?term=${encodeURIComponent(artistName)}`);
      if (lookup.success && Array.isArray(lookup.data) && lookup.data.length > 0) {
        artistData = lookup.data[0];
      }
    }

    if (!artistData) {
      throw new Error(`Artist lookup failed for "${artistName || foreignArtistId}" in Lidarr.`);
    }

    const payload = {
      ...artistData,
      qualityProfileId: qualityProfileId || 1,
      metadataProfileId: metadataProfileId || 1,
      rootFolderPath: rootFolderPath || 'P:\\Music',
      monitored: true,
      addOptions: {
        searchForMissingAlbums: searchForMissing !== false,
      },
    };

    const res = await this._request('lidarr', '/artist', 'POST', payload);
    return res;
  }

  /**
   * Instant audio rip / download via yt-dlp directly into P:\Music
   */
  async ripAudio(queryOrUrl) {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      const isUrl = /^https?:\/\//i.test((queryOrUrl || '').trim());
      const target = isUrl ? queryOrUrl.trim() : `ytsearch1:${(queryOrUrl || '').trim()}`;
      const outputTemplate = 'P:\\Music\\%(artist,creator,uploader)s\\%(album,title)s\\%(title)s.%(ext)s';

      const cmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 --embed-metadata --embed-thumbnail --no-playlist -o "${outputTemplate}" "${target}"`;

      exec(cmd, { timeout: 180000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, error: stderr || err.message });
        } else {
          // Trigger Jellyfin rescan
          try {
            const { jellyfinService } = require('./jellyfinService.cjs');
            jellyfinService.refreshLibrary().catch(() => {});
          } catch {}

          resolve({
            success: true,
            message: 'Music track downloaded and imported into P:\\Music & Jellyfin',
            output: stdout ? stdout.slice(-300) : null
          });
        }
      });
    });
  }

  /**
   * Query upcoming media release calendar from Radarr and Sonarr
   */
  async getCalendar(daysAhead = 14) {
    const start = new Date().toISOString().split('T')[0];
    const end = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [radarrRes, sonarrRes] = await Promise.all([
      this._request('radarr', `/calendar?start=${start}&end=${end}`),
      this._request('sonarr', `/calendar?start=${start}&end=${end}`),
    ]);

    const events = [];

    if (radarrRes.success && Array.isArray(radarrRes.data)) {
      for (const m of radarrRes.data) {
        events.push({
          type: 'movie',
          service: 'radarr',
          title: m.title,
          releaseDate: m.digitalRelease || m.physicalRelease || m.inCinemas || null,
          hasFile: !!m.hasFile,
          overview: m.overview || null,
        });
      }
    }

    if (sonarrRes.success && Array.isArray(sonarrRes.data)) {
      for (const ep of sonarrRes.data) {
        events.push({
          type: 'episode',
          service: 'sonarr',
          seriesTitle: ep.series?.title || 'Unknown Series',
          episodeTitle: ep.title,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          airDateUtc: ep.airDateUtc,
          hasFile: !!ep.hasFile,
        });
      }
    }

    events.sort((a, b) => {
      const dateA = a.airDateUtc || a.releaseDate || '';
      const dateB = b.airDateUtc || b.releaseDate || '';
      return dateA.localeCompare(dateB);
    });

    return { start, end, total: events.length, events };
  }

  /**
   * Ingest webhook payloads dispatched by Radarr/Sonarr on Download / Upgrade
   */
  async handleWebhook(body = {}) {
    const eventType = body.eventType || body.event_type || 'Unknown';
    const isMovie = !!body.movie;
    const isSeries = !!body.series;
    const title = body.movie?.title || body.series?.title || 'Media';
    const source = isMovie ? 'Radarr' : (isSeries ? 'Sonarr' : 'Arr-Service');

    const entry = {
      timestamp: new Date().toISOString(),
      source,
      eventType,
      title,
      details: {
        movie: body.movie?.title || null,
        series: body.series?.title || null,
        episode: body.episodes ? body.episodes.map(e => `S${e.seasonNumber}E${e.episodeNumber}`).join(', ') : null,
        release: body.release?.releaseTitle || null,
        downloadClient: body.downloadClient || null,
      },
    };

    this.emit('webhook', entry);

    // Trigger Jellyfin library rescan on successful download/import
    if (eventType === 'Download' || eventType === 'Upgrade' || eventType === 'Rename') {
      try {
        const { jellyfinService } = require('./jellyfinService.cjs');
        jellyfinService.refreshLibrary().catch(() => {});
      } catch {}
    }

    return { success: true, processed: entry };
  }
}

const defaultArrService = new ArrService();

module.exports = {
  ArrService,
  arrService: defaultArrService,
};
