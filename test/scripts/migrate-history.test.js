import assert from 'node:assert';
import test, { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { SessionManager } from '@mariozechner/pi-coding-agent';

describe('Migration Script', () => {
    let tempDir;
    let historyDir;
    let sessionDir;
    const scriptPath = path.join(process.cwd(), 'scripts', 'migrate-history.js');

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-migration-test-'));
        historyDir = path.join(tempDir, 'history');
        sessionDir = path.join(tempDir, 'sessions');
        fs.mkdirSync(historyDir);
        fs.mkdirSync(sessionDir);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should migrate markdown log files to JSONL sessions', () => {
        // Create a sample history file
        const historyFile = path.join(historyDir, '2026-01-30-1424.md');
        const contextId = '123456789';
        const historyContent = `user: [Discord Guild #TestGuild channel id:${contextId} +0m 2026-01-30 14:24 GMT] user-name:
Hello Jevons!
[message_id: msg1]
assistant: [Discord Guild #TestGuild channel id:${contextId} +0m 2026-01-30 14:25 GMT] Jevons:
Hello user! How can I help?
[message_id: msg2]
`;
        fs.writeFileSync(historyFile, historyContent);

        // Run the migration script
        const result = spawnSync('node', [scriptPath, historyDir], {
            env: { ...process.env, JEVONS_SESSION_DIR: sessionDir },
            encoding: 'utf8'
        });

        if (result.status !== 0) {
            console.error('Migration output:', result.stdout);
            console.error('Migration error:', result.stderr);
        }
        assert.strictEqual(result.status, 0, 'Migration script should exit with status 0');

        // Verify session was created
        const contextSessionDir = path.join(sessionDir, contextId);
        assert.ok(fs.existsSync(contextSessionDir), 'Session directory for context should exist');

        const manager = SessionManager.continueRecent(process.cwd(), contextSessionDir);
        const context = manager.buildSessionContext();

        assert.strictEqual(context.messages.length, 2, 'Should have 2 messages in session');
        assert.strictEqual(context.messages[0].role, 'user');
        assert.strictEqual(context.messages[0].content, 'Hello Jevons!');
        assert.strictEqual(context.messages[1].role, 'assistant');
        assert.strictEqual(context.messages[1].content, 'Hello user! How can I help?');
        
        // Check timestamps
        const expectedTimestamp0 = new Date('2026-01-30 14:24 GMT').getTime();
        const expectedTimestamp1 = new Date('2026-01-30 14:25 GMT').getTime();
        
        // We need to look at raw entries to see timestamps if buildSessionContext hides them
        const entries = manager.getBranch();
        const msgEntries = entries.filter(e => e.type === 'message');
        assert.strictEqual(msgEntries[0].message.timestamp, expectedTimestamp0);
        assert.strictEqual(msgEntries[1].message.timestamp, expectedTimestamp1);
    });

    it('should handle multiple contexts across files', () => {
        const context1 = 'ctx1';
        const context2 = 'ctx2';
        
        fs.writeFileSync(path.join(historyDir, 'file1.md'), 
`user: [Discord Guild #G1 c1 id:${context1} +0m 2026-01-30 10:00 GMT] u1:
Msg 1
assistant: [Discord Guild #G1 c1 id:${context1} +0m 2026-01-30 10:01 GMT] J:
Reply 1
`);
        fs.writeFileSync(path.join(historyDir, 'file2.md'), 
`user: [Discord Guild #G1 c1 id:${context2} +0m 2026-01-30 11:00 GMT] u1:
Msg 2
assistant: [Discord Guild #G1 c1 id:${context2} +0m 2026-01-30 11:01 GMT] J:
Reply 2
`);

        spawnSync('node', [scriptPath, historyDir], {
            env: { ...process.env, JEVONS_SESSION_DIR: sessionDir },
            encoding: 'utf8'
        });

        assert.ok(fs.existsSync(path.join(sessionDir, context1)), 'Context 1 session should exist');
        assert.ok(fs.existsSync(path.join(sessionDir, context2)), 'Context 2 session should exist');
    });

    it('should handle multiline content and preserve structure', () => {
        const contextId = 'multi';
        const multilineContent = `user: [Discord Guild #G1 c1 id:${contextId} +0m 2026-01-30 12:00 GMT] u1:
Line 1
Line 2

Line 4
[message_id: msg3]
assistant: [Discord Guild #G1 c1 id:${contextId} +0m 2026-01-30 12:01 GMT] J:
Reply
`;
        fs.writeFileSync(path.join(historyDir, 'multi.md'), multilineContent);

        spawnSync('node', [scriptPath, historyDir], {
            env: { ...process.env, JEVONS_SESSION_DIR: sessionDir },
            encoding: 'utf8'
        });

        const manager = SessionManager.continueRecent(process.cwd(), path.join(sessionDir, contextId));
        const context = manager.buildSessionContext();
        assert.ok(context.messages.length > 0, 'Should have messages');
        assert.strictEqual(context.messages[0].content, 'Line 1\nLine 2\n\nLine 4');
    });
});
