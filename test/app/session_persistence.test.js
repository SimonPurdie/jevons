import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { DiscordSessionManager } from '../../app/sessionManager.js';

describe('Session Persistence and Recovery', () => {
    let tempDir;
    let manager;

    beforeEach(() => {
        tempDir = path.join(os.tmpdir(), 'jevons-persistence-test-' + Date.now());
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

    describe('Session File Creation and Format', () => {
        it('session file exists after appending messages', () => {
            const contextId = 'test-channel-1';
            const session = manager.getOrCreate(contextId);
            
            // Add messages
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

            const sessionFile = session.sessionManager.getSessionFile();
            assert.strictEqual(fs.existsSync(sessionFile), true, 'Session file should exist on disk');
        });

        it('session file is in JSONL format with valid JSON per line', () => {
            const contextId = 'test-channel-2';
            const session = manager.getOrCreate(contextId);
            
            // Add messages
            session.sessionManager.appendMessage({
                role: 'user',
                content: 'Test message',
                timestamp: Date.now(),
            });
            session.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Test response',
                timestamp: Date.now(),
            });

            const sessionFile = session.sessionManager.getSessionFile();
            const content = fs.readFileSync(sessionFile, 'utf8');
            const lines = content.trim().split('\n');
            
            // Each line should be valid JSON
            lines.forEach((line, index) => {
                try {
                    const parsed = JSON.parse(line);
                    assert.ok(parsed, `Line ${index} should parse to valid JSON object`);
                    assert.ok(parsed.type, `Line ${index} should have a type field`);
                } catch (err) {
                    assert.fail(`Line ${index} is not valid JSON: ${line}`);
                }
            });

            // First line should be session type
            const firstEntry = JSON.parse(lines[0]);
            assert.strictEqual(firstEntry.type, 'session', 'First entry should be type "session"');
        });
    });

    describe('Session Recovery', () => {
        it('recovers session after creating new manager instance', () => {
            const contextId = 'test-channel-3';
            const session1 = manager.getOrCreate(contextId);
            
            // Add messages
            session1.sessionManager.appendMessage({
                role: 'user',
                content: 'First message',
                timestamp: Date.now(),
            });
            session1.sessionManager.appendMessage({
                role: 'assistant',
                content: 'First response',
                timestamp: Date.now(),
            });

            // End session (simulating process restart)
            manager.endSession(contextId);

            // Create new manager instance
            const newManager = new DiscordSessionManager({
                sessionDir: tempDir,
                cwd: process.cwd(),
            });

            // Get session - should recover existing
            const session2 = newManager.getOrCreate(contextId);
            
            // Should be able to get the session context
            const context = session2.sessionManager.buildSessionContext();
            assert.ok(context.messages.length >= 2, 'Recovered session should have messages');
        });

        it('recovered session contains messages from before restart', () => {
            const contextId = 'test-channel-4';
            const session1 = manager.getOrCreate(contextId);
            
            // Add multiple messages
            const messages = [
                { role: 'user', content: 'Message 1', timestamp: Date.now() },
                { role: 'assistant', content: 'Response 1', timestamp: Date.now() },
                { role: 'user', content: 'Message 2', timestamp: Date.now() },
                { role: 'assistant', content: 'Response 2', timestamp: Date.now() },
            ];

            messages.forEach(msg => {
                session1.sessionManager.appendMessage(msg);
            });

            // End session
            manager.endSession(contextId);

            // Create new manager and recover
            const newManager = new DiscordSessionManager({
                sessionDir: tempDir,
                cwd: process.cwd(),
            });
            const session2 = newManager.getOrCreate(contextId);

            // Build context and verify messages
            const context = session2.sessionManager.buildSessionContext();
            assert.ok(context.messages.length >= 4, 'Should have all messages after recovery');
            
            // Verify content preservation
            const userMessages = context.messages.filter(m => m.role === 'user');
            assert.ok(userMessages.some(m => m.content === 'Message 1'), 'Should preserve Message 1');
            assert.ok(userMessages.some(m => m.content === 'Message 2'), 'Should preserve Message 2');
        });
    });

    describe('Corrupt Session File Handling', () => {
        it('handles corrupt session file gracefully in getOrCreate', () => {
            const contextId = 'corrupt-channel-1';
            const contextDir = path.join(tempDir, contextId);
            fs.mkdirSync(contextDir, { recursive: true });

            // Create a corrupt session file
            const corruptSessionFile = path.join(contextDir, 'corrupt_session.jsonl');
            fs.writeFileSync(corruptSessionFile, 'this is not valid JSON\n{invalid json here}', 'utf8');

            // Should not throw, should create a new session instead
            const session = manager.getOrCreate(contextId);
            
            assert.ok(session, 'Should return a session object');
            assert.ok(session.sessionManager, 'Session should have sessionManager');
            assert.strictEqual(session.contextId, contextId, 'Context ID should match');
            assert.strictEqual(session.isActive, true, 'Session should be active');
        });

        it('handles corrupt session file gracefully in listSessions', async () => {
            const contextId = 'corrupt-channel-2';
            const contextDir = path.join(tempDir, contextId);
            fs.mkdirSync(contextDir, { recursive: true });

            // Create a corrupt session file
            const corruptSessionFile = path.join(contextDir, 'corrupt_list.jsonl');
            fs.writeFileSync(corruptSessionFile, 'corrupt data here!!!', 'utf8');

            // Should return empty array instead of crashing
            const sessions = await manager.listSessions(contextId);
            
            assert.ok(Array.isArray(sessions), 'Should return an array');
            assert.strictEqual(sessions.length, 0, 'Should return empty array for corrupt sessions');
        });

        it('handles corrupt session file gracefully in switchToSession', () => {
            const contextId = 'corrupt-channel-3';
            const contextDir = path.join(tempDir, contextId);
            fs.mkdirSync(contextDir, { recursive: true });

            // Create a corrupt session file
            const corruptSessionFile = path.join(contextDir, 'corrupt_switch.jsonl');
            fs.writeFileSync(corruptSessionFile, 'completely invalid!!!', 'utf8');

            // SessionManager is resilient and doesn't throw on corrupt files
            // It should still allow the switch (though the session will be effectively empty)
            const session = manager.switchToSession(contextId, corruptSessionFile);
            
            assert.ok(session, 'Should return a session object even for corrupt file');
            assert.ok(session.sessionManager, 'Session should have sessionManager');
            assert.strictEqual(session.contextId, contextId, 'Context ID should match');
        });

        it('continues functioning after encountering corrupt session', () => {
            const contextId = 'corrupt-channel-4';
            const contextDir = path.join(tempDir, contextId);
            fs.mkdirSync(contextDir, { recursive: true });

            // Create a corrupt session file
            const corruptSessionFile = path.join(contextDir, 'corrupt_continue.jsonl');
            fs.writeFileSync(corruptSessionFile, 'corrupt!!!', 'utf8');

            // First call with corrupt file should handle gracefully
            const session1 = manager.getOrCreate(contextId);
            
            // Add messages to the new session
            session1.sessionManager.appendMessage({
                role: 'user',
                content: 'New message after corruption',
                timestamp: Date.now(),
            });
            session1.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Response after corruption',
                timestamp: Date.now(),
            });

            // Create another session to verify manager is still functional
            const contextId2 = 'normal-channel-5';
            const session2 = manager.getOrCreate(contextId2);
            
            assert.ok(session2, 'Should be able to create another session');
            
            // Verify we can still use the manager
            assert.strictEqual(manager.hasActiveSession(contextId), true);
            assert.strictEqual(manager.hasActiveSession(contextId2), true);
        });

        it('creates new session when continueRecent encounters corrupt file', () => {
            const contextId = 'corrupt-channel-5';
            const contextDir = path.join(tempDir, contextId);
            fs.mkdirSync(contextDir, { recursive: true });

            // Create a corrupt session file with valid JSONL extension
            const corruptSessionFile = path.join(contextDir, '20240201_120000_abc123.jsonl');
            fs.writeFileSync(corruptSessionFile, 'invalid json content here', 'utf8');

            // Should create new session instead of crashing
            const session = manager.getOrCreate(contextId);
            
            assert.ok(session, 'Should return a session');
            assert.ok(session.sessionManager, 'Should have sessionManager');
            
            // Should be able to use the new session
            const msgId = session.sessionManager.appendMessage({
                role: 'user',
                content: 'Test in new session',
                timestamp: Date.now(),
            });
            
            assert.ok(msgId, 'Should be able to append messages to new session');
        });
    });

    describe('Multiple Session Recovery', () => {
        it('recovers multiple sessions independently', () => {
            const contextId1 = 'multi-channel-1';
            const contextId2 = 'multi-channel-2';

            // Create sessions with user and assistant messages (assistant needed for file creation)
            const session1 = manager.getOrCreate(contextId1);
            session1.sessionManager.appendMessage({
                role: 'user',
                content: 'Channel 1 message',
                timestamp: Date.now(),
            });
            session1.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Channel 1 response',
                timestamp: Date.now(),
            });

            const session2 = manager.getOrCreate(contextId2);
            session2.sessionManager.appendMessage({
                role: 'user',
                content: 'Channel 2 message',
                timestamp: Date.now(),
            });
            session2.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Channel 2 response',
                timestamp: Date.now(),
            });

            // End all sessions
            manager.clearAllSessions();

            // Create new manager
            const newManager = new DiscordSessionManager({
                sessionDir: tempDir,
                cwd: process.cwd(),
            });

            // Recover both sessions
            const recovered1 = newManager.getOrCreate(contextId1);
            const recovered2 = newManager.getOrCreate(contextId2);

            // Verify independent recovery
            const context1 = recovered1.sessionManager.buildSessionContext();
            const context2 = recovered2.sessionManager.buildSessionContext();

            assert.ok(
                context1.messages.some(m => m.content === 'Channel 1 message'),
                'Should recover Channel 1 messages'
            );
            assert.ok(
                context2.messages.some(m => m.content === 'Channel 2 message'),
                'Should recover Channel 2 messages'
            );
        });

        it('handles mix of valid and corrupt sessions', async () => {
            const validContextId = 'mixed-valid';
            const corruptContextId = 'mixed-corrupt';

            // Create valid session with user and assistant messages
            const validSession = manager.getOrCreate(validContextId);
            validSession.sessionManager.appendMessage({
                role: 'user',
                content: 'Valid session message',
                timestamp: Date.now(),
            });
            validSession.sessionManager.appendMessage({
                role: 'assistant',
                content: 'Valid session response',
                timestamp: Date.now(),
            });

            // Create corrupt session directory with invalid file
            const corruptDir = path.join(tempDir, corruptContextId);
            fs.mkdirSync(corruptDir, { recursive: true });
            fs.writeFileSync(
                path.join(corruptDir, 'corrupt.jsonl'),
                'not valid json',
                'utf8'
            );

            // End valid session
            manager.endSession(validContextId);

            // Create new manager
            const newManager = new DiscordSessionManager({
                sessionDir: tempDir,
                cwd: process.cwd(),
            });

            // Valid session should recover normally
            const recoveredValid = newManager.getOrCreate(validContextId);
            const validContext = recoveredValid.sessionManager.buildSessionContext();
            assert.ok(
                validContext.messages.some(m => m.content === 'Valid session message'),
                'Valid session should recover'
            );

            // Corrupt session should be handled gracefully
            const recoveredCorrupt = newManager.getOrCreate(corruptContextId);
            assert.ok(recoveredCorrupt, 'Should handle corrupt session gracefully');
            assert.ok(recoveredCorrupt.sessionManager, 'Should have sessionManager for corrupt session replacement');
        });
    });
});
