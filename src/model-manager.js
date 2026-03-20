const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

/**
 * Manages whisper model downloads in a shared location.
 *
 * macOS:   /Users/Shared/annadata-vad-dt/models/
 * Windows: C:\ProgramData\annadata-vad-dt\models\
 * Linux:   /var/lib/annadata-vad-dt/models/
 *
 * Falls back to user-level ~/annadata-vad-dt/models/ if shared path fails.
 */
class ModelManager {
  constructor() {
    this._modelsDir = ModelManager._resolveModelsDir();
  }

  static _resolveModelsDir() {
    const candidates = ModelManager._sharedCandidates();
    for (const dir of candidates) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        // Verify writable
        fs.accessSync(dir, fs.constants.W_OK);
        return dir;
      } catch (_) {
        // Try next candidate
      }
    }
    // Final fallback — user home
    const fallback = path.join(os.homedir(), 'annadata-vad-dt', 'models');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }

  static _sharedCandidates() {
    if (process.platform === 'win32') {
      const base = process.env.PROGRAMDATA || 'C:\\ProgramData';
      return [path.join(base, 'annadata-vad-dt', 'models')];
    }
    if (process.platform === 'darwin') {
      return [path.join('/Users/Shared', 'annadata-vad-dt', 'models')];
    }
    // Linux
    return [path.join('/var/lib', 'annadata-vad-dt', 'models')];
  }

  getModelsDir() {
    return this._modelsDir;
  }

  /** Check if a model file exists locally by its URL filename. */
  isDownloaded(url) {
    if (!url) return false;
    const filename = url.split('/').pop();
    return fs.existsSync(path.join(this._modelsDir, filename));
  }

  /** Get local path for a model by its URL. */
  getModelPath(url) {
    if (!url) return null;
    const filename = url.split('/').pop();
    const fullPath = path.join(this._modelsDir, filename);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  /**
   * Download a model from URL with progress callback.
   * Skips if already downloaded.
   * @param {string} url
   * @param {(progress: {loaded: number, total: number, percentage: number}) => void} onProgress
   * @returns {Promise<string>} local file path
   */
  downloadModel(url, onProgress) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('No download URL'));

      const filename = url.split('/').pop();
      const destPath = path.join(this._modelsDir, filename);

      if (fs.existsSync(destPath)) {
        return resolve(destPath);
      }

      console.log(`⬇️ Downloading model: ${url}`);
      const tmpPath = destPath + '.tmp';

      const followRedirects = (requestUrl) => {
        const mod = requestUrl.startsWith('https') ? https : require('http');
        mod.get(requestUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return followRedirects(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let loaded = 0;
          const file = fs.createWriteStream(tmpPath);

          res.on('data', (chunk) => {
            loaded += chunk.length;
            file.write(chunk);
            if (onProgress && total > 0) {
              onProgress({ loaded, total, percentage: Math.round((loaded / total) * 100) });
            }
          });

          res.on('end', () => {
            file.end(() => {
              fs.renameSync(tmpPath, destPath);
              console.log(`✅ Model downloaded: ${destPath}`);
              resolve(destPath);
            });
          });

          res.on('error', (err) => {
            file.close();
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            reject(err);
          });
        }).on('error', (err) => {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          reject(err);
        });
      };

      followRedirects(url);
    });
  }
}

module.exports = { ModelManager };
