import { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * Discord-aware SessionManager wrapper that maps Discord context IDs
 * (channel/thread IDs) to pi-coding-agent sessions.
 */
export class DiscordSessionManager {
    /**
     * @param {Object} options
     * @param {string} options.sessionDir - Directory for session storage
     * @param {string} [options.cwd] - Working directory for sessions (defaults to process.cwd())
     */
    constructor(options) {
        if (!options || !options.sessionDir) {
            throw new Error('Session directory is required');
        }
        this.sessionDir = options.sessionDir;
        this.cwd = options.cwd || process.cwd();
        /** @type {Map<string, PiSessionManager>} */
        this.sessions = new Map();
    }

    /**
     * Get the session path for a Discord context ID.
     * @param {string} contextId - Discord channel or thread ID
     * @returns {string} The session directory path for this context
     */
    _getContextSessionDir(contextId) {
        return path.join(this.sessionDir, contextId);
    }

    /**
     * Get or create a session for a Discord context.
     * Uses SessionManager.continueRecent() to either resume the most recent
     * session or create a new one.
     *
     * @param {string} contextId - Discord channel or thread ID
     * @returns {DiscordSession} Session object with sessionManager and isActive properties
     */
    getOrCreate(contextId) {
        if (!contextId || typeof contextId !== 'string') {
            throw new Error('Context ID is required and must be a string');
        }

        // Check if we already have this session in memory
        if (this.sessions.has(contextId)) {
            const sessionManager = this.sessions.get(contextId);
            return {
                contextId,
                sessionManager,
                isActive: true,
            };
        }

        // Create new session using continueRecent pattern
        const contextSessionDir = this._getContextSessionDir(contextId);
        let sessionManager;
        
        try {
            sessionManager = PiSessionManager.continueRecent(this.cwd, contextSessionDir);
        } catch (err) {
            logger.warn(`Corrupt session file detected for context ${contextId}, creating new session`, {
                contextId,
                error: err.message,
            });
            // Create a fresh session if continueRecent fails
            sessionManager = PiSessionManager.create(this.cwd, contextSessionDir);
        }

        this.sessions.set(contextId, sessionManager);

        return {
            contextId,
            sessionManager,
            isActive: true,
        };
    }

    /**
     * Create a new session for a context, preserving any existing session.
     * This is used by the /new command.
     *
     * @param {string} contextId - Discord channel or thread ID
     * @returns {DiscordSession} New session object
     */
    newSession(contextId) {
        if (!contextId || typeof contextId !== 'string') {
            throw new Error('Context ID is required and must be a string');
        }

        const contextSessionDir = this._getContextSessionDir(contextId);

        // Create a fresh session (don't continue recent)
        const sessionManager = PiSessionManager.create(this.cwd, contextSessionDir);

        this.sessions.set(contextId, sessionManager);

        return {
            contextId,
            sessionManager,
            isActive: true,
        };
    }

    /**
     * List all sessions for a given context.
     *
     * @param {string} contextId - Discord channel or thread ID
     * @returns {Promise<Array>} Array of session info objects
     */
    async listSessions(contextId) {
        if (!contextId || typeof contextId !== 'string') {
            throw new Error('Context ID is required and must be a string');
        }

        const contextSessionDir = this._getContextSessionDir(contextId);
        
        try {
            const sessions = await PiSessionManager.list(this.cwd, contextSessionDir);
            return sessions;
        } catch (err) {
            logger.error(`Failed to list sessions for context ${contextId}`, {
                contextId,
                error: err.message,
            });
            // Return empty array on error to maintain consistent return type
            return [];
        }
    }

    /**
     * Switch to a specific session file for a context.
     *
     * @param {string} contextId - Discord channel or thread ID
     * @param {string} sessionFilePath - Path to the session file to switch to
     * @returns {DiscordSession} Session object pointing to the specified file
     */
    switchToSession(contextId, sessionFilePath) {
        if (!contextId || typeof contextId !== 'string') {
            throw new Error('Context ID is required and must be a string');
        }
        if (!sessionFilePath || typeof sessionFilePath !== 'string') {
            throw new Error('Session file path is required and must be a string');
        }

        const contextSessionDir = this._getContextSessionDir(contextId);
        const fullPath = path.isAbsolute(sessionFilePath)
            ? sessionFilePath
            : path.join(contextSessionDir, sessionFilePath);
            
        let sessionManager;
        
        try {
            sessionManager = PiSessionManager.open(fullPath, contextSessionDir);
        } catch (err) {
            logger.warn(`Failed to open session file for context ${contextId}, creating new session`, {
                contextId,
                sessionFilePath,
                error: err.message,
            });
            sessionManager = PiSessionManager.create(this.cwd, contextSessionDir);
        }

        this.sessions.set(contextId, sessionManager);

        return {
            contextId,
            sessionManager,
            isActive: true,
        };
    }

    /**
     * Fork the current session from a specific message ID.
     *
     * @param {string} contextId - Discord channel or thread ID
     * @param {string} entryId - The ID of the message to fork from
     * @returns {DiscordSession} The new branched session
     */
    forkSession(contextId, entryId) {
        if (!contextId || typeof contextId !== 'string') {
            throw new Error('Context ID is required and must be a string');
        }
        if (!entryId || typeof entryId !== 'string') {
            throw new Error('Entry ID is required and must be a string');
        }

        const session = this.getActiveSession(contextId);
        if (!session) {
            throw new Error('No active session to fork from');
        }

        // createBranchedSession returns the path to the new session file and updates
        // the source manager to point at the branched session.
        const branchedSessionPath = session.sessionManager.createBranchedSession(entryId);
        
        // Open the new branched session. Pi defers writing user-only sessions until
        // an assistant message is appended; write the branch explicitly here so the
        // Discord resume UI can discover the fork immediately.
        const contextSessionDir = this._getContextSessionDir(contextId);
        if (branchedSessionPath && !fs.existsSync(branchedSessionPath)) {
            const header = session.sessionManager.getHeader();
            const entries = session.sessionManager.getBranch();
            if (header) {
                fs.mkdirSync(path.dirname(branchedSessionPath), { recursive: true });
                fs.writeFileSync(
                    branchedSessionPath,
                    [header, ...entries].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
                    'utf8'
                );
            }
        }
        const branchedManager = PiSessionManager.open(branchedSessionPath, contextSessionDir);
        
        this.sessions.set(contextId, branchedManager);

        return {
            contextId,
            sessionManager: branchedManager,
            isActive: true,
        };
    }

    /**
     * Get the active session for a context if one exists.
     *
     * @param {string} contextId - Discord channel or thread ID
     * @returns {DiscordSession|null} Session object or null if not active
     */
    getActiveSession(contextId) {
        if (!contextId || typeof contextId !== 'string') {
            throw new Error('Context ID is required and must be a string');
        }

        const sessionManager = this.sessions.get(contextId);
        if (!sessionManager) {
            return null;
        }

        return {
            contextId,
            sessionManager,
            isActive: true,
        };
    }

    /**
     * Check if a session is active for a context.
     *
     * @param {string} contextId - Discord channel or thread ID
     * @returns {boolean} True if a session is active
     */
    hasActiveSession(contextId) {
        if (!contextId || typeof contextId !== 'string') {
            return false;
        }
        return this.sessions.has(contextId);
    }

    /**
     * End the active session for a context (removes from memory, persists to disk).
     *
     * @param {string} contextId - Discord channel or thread ID
     * @returns {boolean} True if a session was ended, false if none existed
     */
    endSession(contextId) {
        if (!contextId || typeof contextId !== 'string') {
            return false;
        }
        return this.sessions.delete(contextId);
    }

    /**
     * Get all active context IDs.
     *
     * @returns {string[]} Array of active context IDs
     */
    getActiveContextIds() {
        return Array.from(this.sessions.keys());
    }

    /**
     * Clear all active sessions from memory.
     * Sessions are persisted to disk, so they can be resumed later.
     */
    clearAllSessions() {
        this.sessions.clear();
    }
}

/**
 * Create a DiscordSessionManager instance.
 *
 * @param {Object} options
 * @param {string} options.sessionDir - Directory for session storage
 * @param {string} [options.cwd] - Working directory for sessions
 * @returns {DiscordSessionManager}
 */
export function createDiscordSessionManager(options) {
    return new DiscordSessionManager(options);
}

/**
 * @typedef {Object} DiscordSession
 * @property {string} contextId - Discord channel or thread ID
 * @property {PiSessionManager} sessionManager - The SessionManager instance
 * @property {boolean} isActive - Whether this session is currently active in memory
 */
