/**
 * Aloy Media Library Formatter & Audit Service
 * Standardizes TV Shows and Movies according to Plex / Jellyfin / Kodi naming conventions.
 * Audits for missing release years, non-standard season/episode numbering, tracker junk, and filesystem errors.
 */

const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.m4v', '.mov', '.wmv', '.iso', '.mpg', '.mpeg', '.ts', '.m2ts']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.sub', '.idx', '.vtt', '.ass', '.ssa']);
const JUNK_FILE_PATTERNS = [
  /Downloaded from/i,
  /torrentgalaxy/i,
  /Torrent Description/i,
  /YTSProxies/i,
  /Official site/i,
  /\.nfo$/i,
  /\.txt$/i,
  /Thumbs\.db$/i,
  /\.DS_Store$/i,
  /\s+\d+\.png$/i
];

const JUNK_DIR_PATTERNS = [
  /Cartoons YOU'd Like/i,
  /FANTASY-Adventure Movies/i,
  /Sample/i,
  /Cover-Screens/i,
  /^Images$/i
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function robustRename(src, dst, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.renameSync(src, dst);
      return { success: true };
    } catch (err) {
      if (i === maxRetries - 1) {
        return { success: false, error: err.message };
      }
      await sleep(200);
    }
  }
}

class MediaFormatterService {
  constructor(defaultTvPath = 'P:\\TV Shows', defaultMoviesPath = 'P:\\Movies') {
    this.defaultTvPath = defaultTvPath;
    this.defaultMoviesPath = defaultMoviesPath;
  }

  /**
   * Audit TV Shows and Movies for naming compliance and issues.
   */
  async audit({ tvPath = this.defaultTvPath, moviesPath = this.defaultMoviesPath } = {}) {
    const report = {
      timestamp: new Date().toISOString(),
      tv: {
        path: tvPath,
        accessible: false,
        totalShows: 0,
        totalSeasons: 0,
        totalEpisodes: 0,
        totalSubtitles: 0,
        issues: [],
      },
      movies: {
        path: moviesPath,
        accessible: false,
        totalFolders: 0,
        totalVideos: 0,
        totalSubtitles: 0,
        corrupt: [],
        issues: [],
      },
    };

    // 1. Audit TV Shows
    try {
      if (fs.existsSync(tvPath)) {
        report.tv.accessible = true;
        const shows = fs.readdirSync(tvPath);

        for (const show of shows) {
          const showPath = path.join(tvPath, show);
          try {
            const stat = fs.statSync(showPath);
            if (stat.isFile()) {
              report.tv.issues.push({ type: 'LOOSE_FILE_ROOT', path: showPath, message: `Loose file at TV root: ${show}` });
              continue;
            }

            report.tv.totalShows++;
            // Check show year: Show Name (YYYY)
            if (!/\((19\d\d|20\d\d)\)$/.test(show.trim())) {
              report.tv.issues.push({ type: 'SHOW_MISSING_YEAR', path: showPath, message: `Show folder missing release year: "${show}"` });
            }

            const showContents = fs.readdirSync(showPath);
            for (const item of showContents) {
              const itemPath = path.join(showPath, item);
              const itemStat = fs.statSync(itemPath);

              if (itemStat.isFile()) {
                report.tv.issues.push({ type: 'LOOSE_FILE_SHOW', path: itemPath, message: `Loose file in show folder "${show}": ${item}` });
                continue;
              }

              // Season folder validation
              if (!/^(Season \d{2}|Specials|Season \d{1})$/i.test(item)) {
                report.tv.issues.push({ type: 'NON_STANDARD_SEASON_DIR', path: itemPath, message: `Non-standard season directory in "${show}": ${item}` });
              }

              report.tv.totalSeasons++;
              const seasonFiles = fs.readdirSync(itemPath);

              for (const f of seasonFiles) {
                const fPath = path.join(itemPath, f);
                const ext = path.extname(f).toLowerCase();

                if (VIDEO_EXTENSIONS.has(ext)) {
                  report.tv.totalEpisodes++;
                  // Plex episode pattern: SxxExx or SxxExx-Exx
                  if (!/S\d{2}E\d{2}/i.test(f)) {
                    report.tv.issues.push({ type: 'NON_STANDARD_EPISODE_NAME', path: fPath, message: `Non-standard episode filename: ${f}` });
                  }
                } else if (SUBTITLE_EXTENSIONS.has(ext)) {
                  report.tv.totalSubtitles++;
                } else {
                  report.tv.issues.push({ type: 'UNRECOGNIZED_FILE', path: fPath, message: `Unrecognized file type in season: ${f}` });
                }
              }
            }
          } catch (showErr) {
            report.tv.issues.push({ type: 'SHOW_ACCESS_ERROR', path: showPath, message: `Error accessing show "${show}": ${showErr.message}` });
          }
        }
      }
    } catch (err) {
      report.tv.error = err.message;
    }

    // 2. Audit Movies
    try {
      if (fs.existsSync(moviesPath)) {
        report.movies.accessible = true;
        const entries = fs.readdirSync(moviesPath);

        for (const entry of entries) {
          const entryPath = path.join(moviesPath, entry);
          try {
            const stat = fs.statSync(entryPath);
            if (stat.isFile()) {
              report.movies.issues.push({ type: 'LOOSE_FILE_ROOT', path: entryPath, message: `Loose file at Movies root: ${entry}` });
              continue;
            }

            report.movies.totalFolders++;

            // Check folder year
            if (!/\((19\d\d|20\d\d)\)/.test(entry)) {
              report.movies.issues.push({ type: 'MOVIE_MISSING_YEAR', path: entryPath, message: `Movie folder missing year: "${entry}"` });
            }

            const files = fs.readdirSync(entryPath);
            let videoCount = 0;

            for (const f of files) {
              const fPath = path.join(entryPath, f);
              const ext = path.extname(f).toLowerCase();
              const base = path.basename(f, ext);

              if (VIDEO_EXTENSIONS.has(ext)) {
                report.movies.totalVideos++;
                videoCount++;

                if (!/\((19\d\d|20\d\d)\)/.test(base)) {
                  report.movies.issues.push({ type: 'MOVIE_FILE_MISSING_YEAR', path: fPath, message: `Movie file missing year: "${f}"` });
                }

                const baseWithoutEdition = base.replace(/\s*(\[[^\]]+\]|\{[^}]+\})\s*$/, '').trim();
                const entryWithoutEdition = entry.replace(/\s*(\[[^\]]+\]|\{[^}]+\})\s*$/, '').trim();

                if (base !== entry && baseWithoutEdition.toLowerCase() !== entryWithoutEdition.toLowerCase()) {
                  report.movies.issues.push({ type: 'NAME_MISMATCH', path: fPath, message: `File name "${f}" does not match folder "${entry}"` });
                }
              } else if (SUBTITLE_EXTENSIONS.has(ext)) {
                report.movies.totalSubtitles++;
              } else if (fs.statSync(fPath).isDirectory() && (f === 'Subs' || f.toLowerCase() === 'subtitles')) {
                // Standard subtitles directory, allowed
              } else {
                report.movies.issues.push({ type: 'NON_VIDEO_FILE', path: fPath, message: `Extra/Junk file in movie folder: "${f}"` });
              }
            }

            if (videoCount === 0) {
              report.movies.issues.push({ type: 'EMPTY_MOVIE_FOLDER', path: entryPath, message: `No video files found in "${entry}"` });
            }
          } catch (entryErr) {
            report.movies.corrupt.push({ folder: entry, error: entryErr.message });
          }
        }
      }
    } catch (err) {
      report.movies.error = err.message;
    }

    report.summary = `Audit completed: TV Shows: ${report.tv.issues.length} issues (${report.tv.totalEpisodes} episodes in ${report.tv.totalShows} shows), Movies: ${report.movies.issues.length} issues (${report.movies.totalVideos} videos in ${report.movies.totalFolders} folders), Corrupt: ${report.movies.corrupt.length}.`;
    return report;
  }

  /**
   * Format & standardize media libraries.
   */
  async format({ tvPath = this.defaultTvPath, moviesPath = this.defaultMoviesPath, target = 'all', dryRun = false } = {}) {
    const actions = [];
    const errors = [];

    // Format TV Shows
    if (target === 'all' || target === 'tv') {
      try {
        if (fs.existsSync(tvPath)) {
          const shows = fs.readdirSync(tvPath);

          for (const show of shows) {
            const showPath = path.join(tvPath, show);
            try {
              if (!fs.statSync(showPath).isDirectory()) continue;

              // Check for junk files at show root
              const showItems = fs.readdirSync(showPath);
              for (const item of showItems) {
                const itemPath = path.join(showPath, item);
                const isDir = fs.statSync(itemPath).isDirectory();

                if (!isDir && JUNK_FILE_PATTERNS.some((p) => p.test(item))) {
                  actions.push({ action: 'DELETE_JUNK_FILE', path: itemPath });
                  if (!dryRun) fs.unlinkSync(itemPath);
                } else if (isDir && JUNK_DIR_PATTERNS.some((p) => p.test(item))) {
                  actions.push({ action: 'DELETE_JUNK_DIR', path: itemPath });
                  if (!dryRun) fs.rmSync(itemPath, { recursive: true, force: true });
                }
              }

              // Standardize Season Folders and Episodes
              const currentSeasons = fs.readdirSync(showPath);
              for (const season of currentSeasons) {
                const seasonPath = path.join(showPath, season);
                if (!fs.statSync(seasonPath).isDirectory()) continue;

                let standardSeason = season;
                const sMatch = season.match(/^Season\s*(\d+)/i);
                if (sMatch) {
                  const sNum = parseInt(sMatch[1], 10);
                  standardSeason = `Season ${sNum.toString().padStart(2, '0')}`;
                } else if (/^Extras?$/i.test(season)) {
                  standardSeason = 'Specials';
                }

                // Rename episodes inside season
                const epFiles = fs.readdirSync(seasonPath);
                for (const ep of epFiles) {
                  const epPath = path.join(seasonPath, ep);
                  if (!fs.statSync(epPath).isFile()) continue;

                  const ext = path.extname(ep).toLowerCase();
                  if (!VIDEO_EXTENSIONS.has(ext) && !SUBTITLE_EXTENSIONS.has(ext)) continue;

                  // Clean episode pattern: Show - S01 E01 - Title (480p) -> Show - S01E01 - Title
                  const epMatch = ep.match(/^(.*?)\s*-\s*S(\d+)\s*E(\d+)\s*-\s*(.*?)(?:\s*\(\d+p.*?\))?(\.[a-z0-9]+)$/i);
                  if (epMatch) {
                    const [, showPrefix, sNum, eNum, epTitle] = epMatch;
                    const cleanEpName = `${showPrefix.trim()} - S${parseInt(sNum, 10).toString().padStart(2, '0')}E${parseInt(eNum, 10).toString().padStart(2, '0')} - ${epTitle.trim()}${ext}`;
                    if (ep !== cleanEpName) {
                      const newEpPath = path.join(seasonPath, cleanEpName);
                      actions.push({ action: 'RENAME_EPISODE', from: epPath, to: newEpPath });
                      if (!dryRun) await robustRename(epPath, newEpPath);
                    }
                  }
                }

                // Rename season directory if needed
                if (season !== standardSeason) {
                  const newSeasonPath = path.join(showPath, standardSeason);
                  actions.push({ action: 'RENAME_SEASON', from: seasonPath, to: newSeasonPath });
                  if (!dryRun) await robustRename(seasonPath, newSeasonPath);
                }
              }

              // Standardize Show Folder if needed
              const rawShowMatch = show.match(/^([A-Za-z0-9\s'&.-]+?)\s*(?:\((\d{4})(?:-\d{4})?\))?.*?(?:Complete|\d+p|x264|Web-DL|BluRay)/i);
              if (rawShowMatch && rawShowMatch[2]) {
                const cleanShowName = `${rawShowMatch[1].trim()} (${rawShowMatch[2]})`;
                if (show !== cleanShowName) {
                  const newShowPath = path.join(tvPath, cleanShowName);
                  actions.push({ action: 'RENAME_SHOW', from: showPath, to: newShowPath });
                  if (!dryRun) await robustRename(showPath, newShowPath);
                }
              }
            } catch (showErr) {
              errors.push({ target: showPath, error: showErr.message });
            }
          }
        }
      } catch (err) {
        errors.push({ target: tvPath, error: err.message });
      }
    }

    // Format Movies
    if (target === 'all' || target === 'movies') {
      try {
        if (fs.existsSync(moviesPath)) {
          const movies = fs.readdirSync(moviesPath);

          for (const movie of movies) {
            const moviePath = path.join(moviesPath, movie);
            try {
              if (!fs.statSync(moviePath).isDirectory()) continue;

              // Clean junk files in movie folder
              const files = fs.readdirSync(moviePath);
              for (const f of files) {
                const fPath = path.join(moviePath, f);
                if (fs.statSync(fPath).isFile() && JUNK_FILE_PATTERNS.some((p) => p.test(f))) {
                  actions.push({ action: 'DELETE_JUNK_FILE', path: fPath });
                  if (!dryRun) fs.unlinkSync(fPath);
                }
              }

              // Clean scene tags from movie folder name
              let cleanMovieDir = movie
                .replace(/\s*\[(IMAX|1080p|720p|4k|2160p|WEBRip|BluRay|BRRip|x264|x265|HEVC|AAC|5\.1|YTS\.[A-Z]+)\].*$/i, '')
                .trim();

              // Synchronize video files inside with clean folder name
              const remainingFiles = fs.readdirSync(moviePath);
              for (const f of remainingFiles) {
                const fPath = path.join(moviePath, f);
                if (!fs.statSync(fPath).isFile()) continue;

                const ext = path.extname(f).toLowerCase();
                const base = path.basename(f, ext);

                if (VIDEO_EXTENSIONS.has(ext)) {
                  const editionMatch = base.match(/(\[[^\]]+\]|\{[^}]+\})\s*$/);
                  const editionSuffix = editionMatch ? ` ${editionMatch[1]}` : '';
                  const targetFileName = `${cleanMovieDir}${editionSuffix}${ext}`;
                  if (f !== targetFileName) {
                    const newFilePath = path.join(moviePath, targetFileName);
                    actions.push({ action: 'RENAME_MOVIE_FILE', from: fPath, to: newFilePath });
                    if (!dryRun) await robustRename(fPath, newFilePath);
                  }
                } else if (SUBTITLE_EXTENSIONS.has(ext)) {
                  const targetSubName = `${cleanMovieDir}${ext}`;
                  if (f !== targetSubName && !base.startsWith(cleanMovieDir)) {
                    const newSubPath = path.join(moviePath, targetSubName);
                    actions.push({ action: 'RENAME_SUBTITLE', from: fPath, to: newSubPath });
                    if (!dryRun) await robustRename(fPath, newSubPath);
                  }
                }
              }

              // Rename movie folder if clean name differs
              if (movie !== cleanMovieDir) {
                const newMoviePath = path.join(moviesPath, cleanMovieDir);
                actions.push({ action: 'RENAME_MOVIE_DIR', from: moviePath, to: newMoviePath });
                if (!dryRun) await robustRename(moviePath, newMoviePath);
              }
            } catch (movieErr) {
              errors.push({ target: moviePath, error: movieErr.message });
            }
          }
        }
      } catch (err) {
        errors.push({ target: moviesPath, error: err.message });
      }
    }

    return {
      success: errors.length === 0,
      dryRun,
      actionsCount: actions.length,
      actions,
      errors,
      summary: `Formatting ${dryRun ? 'dry-run' : 'execution'} completed: ${actions.length} action(s) planned/executed, ${errors.length} error(s).`,
    };
  }
}

const mediaFormatterService = new MediaFormatterService();

module.exports = {
  MediaFormatterService,
  mediaFormatterService,
};
