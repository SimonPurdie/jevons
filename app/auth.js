import path from 'path';
import { AuthStorage as PiAuthStorage, FileAuthStorageBackend } from '@earendil-works/pi-coding-agent';

function getDefaultAuthPath() {
    return path.join(process.cwd(), 'config', 'auth.json');
}

/**
 * AuthStorage with Jevons' path convention.
 * Default: ./config/auth.json (project-local, not ~/.pi/agent/)
 */
export class AuthStorage extends PiAuthStorage {
    constructor(authPath) {
        super(new FileAuthStorageBackend(authPath || getDefaultAuthPath()));
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
