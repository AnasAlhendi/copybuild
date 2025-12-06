'use strict';

const { spawn } = require('child_process');

function pickPythonCmd() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function extractWithPython(url, opts = {}) {
  const py = pickPythonCmd();
  const args = ['-m', 'youtube_dl', '--dump-json', '--no-playlist', url];
  return await new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const p = spawn(py, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { out += d.toString('utf8'); });
    p.stderr.on('data', (d) => { err += d.toString('utf8'); });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code !== 0) return reject(new Error('python youtube_dl failed: ' + (err.trim() || code)));
      try { resolve(JSON.parse(out.trim().split(/\r?\n/).pop())); } catch (e) { reject(e); }
    });
  });
}

module.exports = { extractWithPython };

