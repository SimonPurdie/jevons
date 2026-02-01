import fs from 'fs';
import path from 'path';
import os from 'os';

const PI_SESSION_DIR = path.join(os.homedir(), '.pi', 'agent', 'sessions');

export function getDefaultSessionDir() {
  return path.join(PI_SESSION_DIR, '--jevons--');
}

export function getSessionDir(config) {
  let configuredDir = config && config.sessionDir;

  if (configuredDir) {
    // Expand ~ to home directory
    if (configuredDir.startsWith('~')) {
      configuredDir = path.join(os.homedir(), configuredDir.slice(1));
    }
    const absolutePath = path.resolve(configuredDir);
    return absolutePath;
  }

  return getDefaultSessionDir();
}

export function ensureSessionDirExists(sessionDir) {
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}

export function validateSessionDir(sessionDir) {
  if (!sessionDir) {
    throw new Error('Session directory is required');
  }

  if (!path.isAbsolute(sessionDir)) {
    throw new Error(`Session directory must be an absolute path: ${sessionDir}`);
  }

  return true;
}
