import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  getDefaultSessionDir,
  getSessionDir,
  ensureSessionDirExists,
  validateSessionDir,
} from '../../app/session.js';

describe('session', () => {
  describe('getDefaultSessionDir()', () => {
    it('returns the pi standard path with jevons subdirectory', () => {
      const result = getDefaultSessionDir();
      const expected = path.join(os.homedir(), '.pi', 'agent', 'sessions', '--jevons--');
      assert.strictEqual(result, expected);
    });

    it('returns an absolute path', () => {
      const result = getDefaultSessionDir();
      assert.strictEqual(path.isAbsolute(result), true);
    });
  });

  describe('getSessionDir()', () => {
    it('returns default path when config is null', () => {
      const result = getSessionDir(null);
      assert.strictEqual(result, getDefaultSessionDir());
    });

    it('returns default path when config.sessionDir is null', () => {
      const result = getSessionDir({ sessionDir: null });
      assert.strictEqual(result, getDefaultSessionDir());
    });

    it('returns default path when config has no sessionDir field', () => {
      const result = getSessionDir({});
      assert.strictEqual(result, getDefaultSessionDir());
    });

    it('returns custom path when config.sessionDir is set', () => {
      const customDir = '/custom/sessions/path';
      const result = getSessionDir({ sessionDir: customDir });
      assert.strictEqual(result, '/custom/sessions/path');
    });

    it('resolves relative paths to absolute paths', () => {
      const result = getSessionDir({ sessionDir: './relative/path' });
      assert.strictEqual(path.isAbsolute(result), true);
      assert.ok(result.endsWith('relative/path'));
    });
  });

  describe('ensureSessionDirExists()', () => {
    it('creates directory if it does not exist', () => {
      const tempDir = path.join(os.tmpdir(), 'jevons-test-' + Date.now());
      
      try {
        assert.strictEqual(fs.existsSync(tempDir), false);
        
        const result = ensureSessionDirExists(tempDir);
        
        assert.strictEqual(result, tempDir);
        assert.strictEqual(fs.existsSync(tempDir), true);
        assert.strictEqual(fs.statSync(tempDir).isDirectory(), true);
      } finally {
        if (fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir);
        }
      }
    });

    it('returns existing directory without error', () => {
      const tempDir = path.join(os.tmpdir(), 'jevons-test-' + Date.now());
      
      try {
        fs.mkdirSync(tempDir, { recursive: true });
        
        const result = ensureSessionDirExists(tempDir);
        
        assert.strictEqual(result, tempDir);
      } finally {
        if (fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir);
        }
      }
    });
  });

  describe('validateSessionDir()', () => {
    it('throws error when sessionDir is null', () => {
      assert.throws(
        () => validateSessionDir(null),
        /Session directory is required/
      );
    });

    it('throws error when sessionDir is undefined', () => {
      assert.throws(
        () => validateSessionDir(undefined),
        /Session directory is required/
      );
    });

    it('throws error when sessionDir is empty string', () => {
      assert.throws(
        () => validateSessionDir(''),
        /Session directory is required/
      );
    });

    it('throws error when sessionDir is not absolute', () => {
      assert.throws(
        () => validateSessionDir('relative/path'),
        /Session directory must be an absolute path/
      );
    });

    it('returns true for valid absolute path', () => {
      const result = validateSessionDir('/absolute/path');
      assert.strictEqual(result, true);
    });

    it('returns true for absolute path with spaces', () => {
      const result = validateSessionDir('/path with spaces/to/sessions');
      assert.strictEqual(result, true);
    });
  });
});
