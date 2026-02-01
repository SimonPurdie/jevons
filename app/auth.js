import path from 'path';
import { AuthStorage as PiAuthStorage } from '@mariozechner/pi-coding-agent';

/**
 * AuthStorage with Jevons' path convention.
 * Default: ./config/auth.json (project-local, not ~/.pi/agent/)
 */
export class AuthStorage extends PiAuthStorage {
    constructor(authPath) {
        const defaultPath = path.join(process.cwd(), 'config', 'auth.json');
        super(authPath || defaultPath);
    }
}

/**
 * Create AuthStorage with Jevons' path convention.
 * @param {string} [customPath] - Optional custom auth file path
 * @returns {AuthStorage} Configured AuthStorage instance
 */
export function createAuthStorage(customPath) {
    return new AuthStorage(customPath);
}
