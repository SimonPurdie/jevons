import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
    DiscordSessionManager,
    createDiscordSessionManager,
} from '../../app/sessionManager.js';

describe('DiscordSessionManager', () => {
    let tempDir;
    let manager;

    beforeEach(() => {
        tempDir = path.join(os.tmpdir(), 'jevons-session-test-' + Date.now());
        fs.mkdirSync(tempDir, { recursive: true });
        manager = new DiscordSessionManager({
            sessionDir: tempDir,
            cwd: process.cwd(),
        });
    });

    afterEach(() => {
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('constructor', () => {
        it('requires sessionDir option', () => {
            assert.throws(
                () => new DiscordSessionManager({}),
                /Session directory is required/
            );
        });

        it('requires sessionDir to be provided', () => {
            assert.throws(
                () => new DiscordSessionManager(),
                /Session directory is required/
            );
        });

        it('accepts sessionDir and cwd options', () => {
            const customCwd = '/custom/cwd';
            const customManager = new DiscordSessionManager({
                sessionDir: tempDir,
                cwd: customCwd,
            });
            assert.strictEqual(customManager.sessionDir, tempDir);
            assert.strictEqual(customManager.cwd, customCwd);
        });

        it('defaults cwd to process.cwd()', () => {
            assert.strictEqual(manager.cwd, process.cwd());
        });

        it('initializes with empty sessions map', () => {
            assert.strictEqual(manager.getActiveContextIds().length, 0);
        });
    });

    describe('getOrCreate()', () => {
        it('returns a valid session object with sessionManager and isActive properties', () => {
            const session = manager.getOrCreate('channel-123');

            assert.strictEqual(typeof session, 'object');
            assert.strictEqual(session.contextId, 'channel-123');
            assert.strictEqual(typeof session.sessionManager, 'object');
            assert.strictEqual(session.isActive, true);
        });

        it('calling twice with same contextId returns the same session', () => {
            const session1 = manager.getOrCreate('channel-123');
            const session2 = manager.getOrCreate('channel-123');

            assert.strictEqual(session1.sessionManager, session2.sessionManager);
            assert.strictEqual(session1.contextId, session2.contextId);
        });

        it('different contextId values create separate sessions', () => {
            const session1 = manager.getOrCreate('channel-123');
            const session2 = manager.getOrCreate('channel-456');

            assert.notStrictEqual(session1.sessionManager, session2.sessionManager);
            assert.notStrictEqual(session1.contextId, session2.contextId);
        });

        it('throws error when contextId is null', () => {
            assert.throws(
                () => manager.getOrCreate(null),
                /Context ID is required and must be a string/
            );
        });

        it('throws error when contextId is undefined', () => {
            assert.throws(
                () => manager.getOrCreate(undefined),
                /Context ID is required and must be a string/
            );
        });

        it('throws error when contextId is not a string', () => {
            assert.throws(
                () => manager.getOrCreate(123),
                /Context ID is required and must be a string/
            );
        });

        it('creates session in context-specific subdirectory', () => {
            manager.getOrCreate('channel-123');

            const contextDir = path.join(tempDir, 'channel-123');
            assert.strictEqual(fs.existsSync(contextDir), true);
            assert.strictEqual(fs.statSync(contextDir).isDirectory(), true);
        });

        it('sessionManager has expected methods', () => {
            const session = manager.getOrCreate('channel-123');
            const sm = session.sessionManager;

            // Core SessionManager methods
            assert.strictEqual(typeof sm.appendMessage, 'function');
            assert.strictEqual(typeof sm.buildSessionContext, 'function');
            assert.strictEqual(typeof sm.getSessionFile, 'function');
            assert.strictEqual(typeof sm.newSession, 'function');
            assert.strictEqual(typeof sm.getTree, 'function');
            assert.strictEqual(typeof sm.getLeafId, 'function');
        });
    });

    describe('newSession()', () => {
        it('creates a fresh session for a context', () => {
            const oldSession = manager.getOrCreate('channel-123');
            const newSession = manager.newSession('channel-123');

            assert.notStrictEqual(oldSession.sessionManager, newSession.sessionManager);
            assert.strictEqual(newSession.contextId, 'channel-123');
            assert.strictEqual(newSession.isActive, true);
        });

        it('replaces existing session in memory', () => {
            manager.getOrCreate('channel-123');
            const newSession = manager.newSession('channel-123');

            const activeSession = manager.getActiveSession('channel-123');
            assert.strictEqual(activeSession.sessionManager, newSession.sessionManager);
        });

        it('throws error when contextId is invalid', () => {
            assert.throws(
                () => manager.newSession(null),
                /Context ID is required and must be a string/
            );
        });
    });

    describe('listSessions()', () => {
        it('returns empty array when no sessions exist', async () => {
            const sessions = await manager.listSessions('channel-123');
            assert.strictEqual(Array.isArray(sessions), true);
            assert.strictEqual(sessions.length, 0);
        });

        it('returns array of session info objects', async () => {
            const session = manager.getOrCreate('channel-123');

            // Add a message to create a session file
            session.sessionManager.appendMessage({
                role: 'user',
                content: 'Hello',
                timestamp: Date.now(),
            });
            session.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Hi there',
                timestamp: Date.now(),
            });

            const sessions = await manager.listSessions('channel-123');
            assert.strictEqual(Array.isArray(sessions), true);
            assert.strictEqual(sessions.length >= 1, true);

            // Verify session info structure
            const info = sessions[0];
            assert.strictEqual(typeof info.path, 'string');
            assert.strictEqual(typeof info.id, 'string');
            assert.ok(info.created instanceof Date);
            assert.ok(info.modified instanceof Date);
        });

        it('throws error when contextId is invalid', async () => {
            await assert.rejects(
                manager.listSessions(null),
                /Context ID is required and must be a string/
            );
        });
    });

    describe('switchToSession()', () => {
        it('switches to a specific session file', () => {
            const session1 = manager.getOrCreate('channel-123');
            const sessionFile = session1.sessionManager.getSessionFile();

            // Add messages
            session1.sessionManager.appendMessage({
                role: 'user',
                content: 'First message',
                timestamp: Date.now(),
            });

            // Create a second session (simulate /new)
            const session2 = manager.newSession('channel-123');
            session2.sessionManager.appendMessage({
                role: 'user',
                content: 'Second session',
                timestamp: Date.now(),
            });

            // Switch back to first session
            const switched = manager.switchToSession('channel-123', sessionFile);

            assert.strictEqual(switched.sessionManager.getSessionFile(), sessionFile);
            assert.strictEqual(switched.contextId, 'channel-123');
        });

        it('throws error when contextId is invalid', () => {
            assert.throws(
                () => manager.switchToSession(null, '/some/path'),
                /Context ID is required and must be a string/
            );
        });

        it('throws error when sessionFilePath is invalid', () => {
            assert.throws(
                () => manager.switchToSession('channel-123', null),
                /Session file path is required and must be a string/
            );
        });
    });

    describe('getActiveSession()', () => {
        it('returns null when no active session for context', () => {
            const session = manager.getActiveSession('channel-123');
            assert.strictEqual(session, null);
        });

        it('returns session object when session is active', () => {
            manager.getOrCreate('channel-123');

            const session = manager.getActiveSession('channel-123');
            assert.strictEqual(typeof session, 'object');
            assert.strictEqual(session.contextId, 'channel-123');
            assert.strictEqual(session.isActive, true);
            assert.strictEqual(typeof session.sessionManager, 'object');
        });

        it('throws error when contextId is invalid', () => {
            assert.throws(
                () => manager.getActiveSession(null),
                /Context ID is required and must be a string/
            );
        });
    });

    describe('hasActiveSession()', () => {
        it('returns false when no session exists', () => {
            assert.strictEqual(manager.hasActiveSession('channel-123'), false);
        });

        it('returns true when session exists', () => {
            manager.getOrCreate('channel-123');
            assert.strictEqual(manager.hasActiveSession('channel-123'), true);
        });

        it('returns false for invalid contextId', () => {
            assert.strictEqual(manager.hasActiveSession(null), false);
            assert.strictEqual(manager.hasActiveSession(''), false);
        });
    });

    describe('endSession()', () => {
        it('returns false when no session exists', () => {
            assert.strictEqual(manager.endSession('channel-123'), false);
        });

        it('returns true when session is ended', () => {
            manager.getOrCreate('channel-123');
            assert.strictEqual(manager.hasActiveSession('channel-123'), true);

            const result = manager.endSession('channel-123');
            assert.strictEqual(result, true);
            assert.strictEqual(manager.hasActiveSession('channel-123'), false);
        });

        it('removes session from memory but preserves file', () => {
            const session = manager.getOrCreate('channel-123');
            const sessionFile = session.sessionManager.getSessionFile();

            // Add messages (need assistant message for persistence)
            session.sessionManager.appendMessage({
                role: 'user',
                content: 'Test',
                timestamp: Date.now(),
            });
            session.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Response',
                timestamp: Date.now(),
            });

            // End session
            manager.endSession('channel-123');

            // File should still exist
            assert.strictEqual(fs.existsSync(sessionFile), true);
        });

        it('returns false for invalid contextId', () => {
            assert.strictEqual(manager.endSession(null), false);
            assert.strictEqual(manager.endSession(''), false);
        });
    });

    describe('getActiveContextIds()', () => {
        it('returns empty array initially', () => {
            const ids = manager.getActiveContextIds();
            assert.strictEqual(Array.isArray(ids), true);
            assert.strictEqual(ids.length, 0);
        });

        it('returns array of active context IDs', () => {
            manager.getOrCreate('channel-123');
            manager.getOrCreate('channel-456');
            manager.getOrCreate('thread-789');

            const ids = manager.getActiveContextIds();
            assert.strictEqual(ids.length, 3);
            assert.ok(ids.includes('channel-123'));
            assert.ok(ids.includes('channel-456'));
            assert.ok(ids.includes('thread-789'));
        });
    });

    describe('clearAllSessions()', () => {
        it('removes all sessions from memory', () => {
            manager.getOrCreate('channel-123');
            manager.getOrCreate('channel-456');

            assert.strictEqual(manager.getActiveContextIds().length, 2);

            manager.clearAllSessions();

            assert.strictEqual(manager.getActiveContextIds().length, 0);
            assert.strictEqual(manager.hasActiveSession('channel-123'), false);
            assert.strictEqual(manager.hasActiveSession('channel-456'), false);
        });

        it('does not delete session files', () => {
            const session1 = manager.getOrCreate('channel-123');
            const file1 = session1.sessionManager.getSessionFile();

            // Add messages
            session1.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Hello',
                timestamp: Date.now(),
            });

            manager.clearAllSessions();

            // Files should still exist
            assert.strictEqual(fs.existsSync(file1), true);
        });
    });

    describe('createDiscordSessionManager()', () => {
        it('creates a DiscordSessionManager instance', () => {
            const dm = createDiscordSessionManager({
                sessionDir: tempDir,
            });

            assert.ok(dm instanceof DiscordSessionManager);
            assert.strictEqual(dm.sessionDir, tempDir);
        });
    });

    describe('session persistence', () => {
        it('session files persist after manager is destroyed', () => {
            const contextId = 'channel-persist';
            const session = manager.getOrCreate(contextId);
            const sessionFile = session.sessionManager.getSessionFile();

            // Add messages
            session.sessionManager.appendMessage({
                role: 'user',
                content: 'First message',
                timestamp: Date.now(),
            });
            session.sessionManager.appendMessage({
                role: 'assistant',
                content: 'First response',
                timestamp: Date.now(),
            });

            // Clear from memory
            manager.endSession(contextId);

            // File should exist
            assert.strictEqual(fs.existsSync(sessionFile), true);

            // Verify file content
            const content = fs.readFileSync(sessionFile, 'utf8');
            const lines = content.trim().split('\n');
            assert.strictEqual(lines.length >= 3, true); // header + 2 messages

            // Parse and verify structure
            const entries = lines.map(line => JSON.parse(line));
            assert.strictEqual(entries[0].type, 'session');
        });

        it('can resume session with continueRecent pattern', () => {
            const contextId = 'channel-resume';
            const session1 = manager.getOrCreate(contextId);
            const sessionFile = session1.sessionManager.getSessionFile();

            // Add messages
            session1.sessionManager.appendMessage({
                role: 'user',
                content: 'Hello',
                timestamp: Date.now(),
            });
            session1.sessionManager.appendMessage({
                role: 'assistant',
                content: 'World',
                timestamp: Date.now(),
            });

            // End session
            manager.endSession(contextId);

            // Create new manager (simulating restart)
            const newManager = new DiscordSessionManager({
                sessionDir: tempDir,
                cwd: process.cwd(),
            });

            // Get session - should continue from existing
            const session2 = newManager.getOrCreate(contextId);

            // Should have the same session file
            assert.strictEqual(session2.sessionManager.getSessionFile(), sessionFile);

            // Build context should have messages
            const context = session2.sessionManager.buildSessionContext();
            assert.ok(context.messages.length >= 2);
        });
    });

    describe('session context operations', () => {
        it('can append and retrieve messages', () => {
            const session = manager.getOrCreate('channel-123');

            // Add user message
            session.sessionManager.appendMessage({
                role: 'user',
                content: 'Hello assistant',
                timestamp: Date.now(),
            });

            // Add assistant message
            session.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Hello user',
                timestamp: Date.now(),
            });

            // Build context
            const context = session.sessionManager.buildSessionContext();
            assert.strictEqual(context.messages.length, 2);
            assert.strictEqual(context.messages[0].role, 'user');
            assert.strictEqual(context.messages[0].content, 'Hello assistant');
            assert.strictEqual(context.messages[1].role, 'assistant');
            assert.strictEqual(context.messages[1].content, 'Hello user');
        });

        it('can get tree structure', () => {
            const session = manager.getOrCreate('channel-123');

            // Add messages (need assistant for persistence)
            session.sessionManager.appendMessage({
                role: 'user',
                content: 'Message 1',
                timestamp: Date.now(),
            });
            session.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Response 1',
                timestamp: Date.now(),
            });

            const tree = session.sessionManager.getTree();
            assert.strictEqual(Array.isArray(tree), true);
            // Tree contains entries with parent-child relationships
            assert.strictEqual(tree.length >= 1, true);
        });

        it('can get leaf ID', () => {
            const session = manager.getOrCreate('channel-123');

            // Initially no leaf (empty session)
            const initialLeaf = session.sessionManager.getLeafId();
            // Leaf is null for empty session
            assert.strictEqual(initialLeaf, null);

            // Add message
            const msgId = session.sessionManager.appendMessage({
                role: 'user',
                content: 'Test',
                timestamp: Date.now(),
            });

            // Leaf should be the message ID
            const leafId = session.sessionManager.getLeafId();
            assert.strictEqual(leafId, msgId);
        });
    });
});
