'use strict';

const { spawn } = require('child_process');

function mergeAV(videoPath, audioPath, outPath, { ffmpegPath = 'ffmpeg', log = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', videoPath, '-i', audioPath, '-c', 'copy', outPath];
    const child = spawn(ffmpegPath, args, { stdio: log ? 'inherit' : 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with code ' + code));
    });
  });
}

function muxSubs(inputPath, subsPath, outPath, { ffmpegPath = 'ffmpeg', log = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', inputPath, '-i', subsPath, '-c', 'copy', outPath];
    const child = spawn(ffmpegPath, args, { stdio: log ? 'inherit' : 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with code ' + code));
    });
  });
}

function tagFile(inputPath, outPath, { title, ffmpegPath = 'ffmpeg', log = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', inputPath];
    if (title) args.push('-metadata', `title=${title}`);
    args.push('-c', 'copy', outPath);
    const child = spawn(ffmpegPath, args, { stdio: log ? 'inherit' : 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exited with code ' + code));
    });
  });
}

function embedSubsMp4(inputPath, subsPath, outPath, { ffmpegPath = 'ffmpeg', log = false } = {}) {
  return new Promise((resolve, reject) => {
    // mov_text required for MP4
    const args = ['-y', '-i', inputPath, '-i', subsPath, '-c', 'copy', '-c:s', 'mov_text', outPath];
    const child = spawn(ffmpegPath, args, { stdio: log ? 'inherit' : 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(); else reject(new Error('ffmpeg exited with code ' + code));
    });
  });
}

function embedMetadata(inputPath, outPath, meta = {}, { ffmpegPath = 'ffmpeg', log = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', inputPath];
    for (const [k, v] of Object.entries(meta)) {
      if (v) args.push('-metadata', `${k}=${v}`);
    }
    args.push('-c', 'copy', outPath);
    const child = spawn(ffmpegPath, args, { stdio: log ? 'inherit' : 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => { if (code === 0) resolve(); else reject(new Error('ffmpeg exited with code ' + code)); });
  });
}

module.exports = { mergeAV, muxSubs, tagFile, embedSubsMp4, embedMetadata };
