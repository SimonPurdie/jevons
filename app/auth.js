const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');
const { getEnvApiKey, getOAuthApiKey, getOAuthProvider, getOAuthProviders } = require('@mariozechner/pi-ai');

class AuthStorage {
    constructor(authPath) {
        this.authPath = authPath || path.join(process.cwd(), 'config', 'auth.json');
        this.data = {};
        this.runtimeOverrides = new Map();
        this.reload();
    }

    setRuntimeApiKey(provider, apiKey) {
        this.runtimeOverrides.set(provider, apiKey);
    }

    reload() {
        if (!fs.existsSync(this.authPath)) {
            this.data = {};
            return;
        }
        try {
            this.data = JSON.parse(fs.readFileSync(this.authPath, 'utf8'));
        } catch {
            this.data = {};
        }
    }

    save() {
        const dir = path.dirname(this.authPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        fs.writeFileSync(this.authPath, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    }

    set(provider, credential) {
        this.data[provider] = credential;
        this.save();
    }

    async refreshOAuthTokenWithLock(providerId) {
        const provider = getOAuthProvider(providerId);
        if (!provider) return null;

        if (!fs.existsSync(this.authPath)) {
            const dir = path.dirname(this.authPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }
            fs.writeFileSync(this.authPath, '{}', { encoding: 'utf8', mode: 0o600 });
        }

        let release;
        try {
            release = await lockfile.lock(this.authPath, {
                retries: {
                    retries: 10,
                    factor: 2,
                    minTimeout: 100,
                    maxTimeout: 10000,
                    randomize: true,
                },
                stale: 30000,
            });

            this.reload();
            const cred = this.data[providerId];
            if (cred?.type !== 'oauth') return null;

            if (Date.now() < cred.expires) {
                const apiKey = provider.getApiKey(cred);
                return { apiKey, newCredentials: cred };
            }

            const oauthCreds = {};
            for (const [key, value] of Object.entries(this.data)) {
                if (value.type === 'oauth') oauthCreds[key] = value;
            }

            const result = await getOAuthApiKey(providerId, oauthCreds);
            if (result) {
                this.data[providerId] = { type: 'oauth', ...result.newCredentials };
                this.save();
                return result;
            }
            return null;

        } finally {
            if (release) {
                try { await release(); } catch { }
            }
        }
    }

    async getApiKey(providerId) {
        const runtimeKey = this.runtimeOverrides.get(providerId);
        if (runtimeKey) return runtimeKey;

        const cred = this.data[providerId];
        if (cred?.type === 'api_key') {
            return cred.key;
        }

        if (cred?.type === 'oauth') {
            const provider = getOAuthProvider(providerId);
            if (!provider) return undefined;

            if (Date.now() >= cred.expires) {
                try {
                    const result = await this.refreshOAuthTokenWithLock(providerId);
                    if (result) return result.apiKey;
                } catch {
                    this.reload();
                    const updatedCred = this.data[providerId];
                    if (updatedCred?.type === 'oauth' && Date.now() < updatedCred.expires) {
                        return provider.getApiKey(updatedCred);
                    }
                    return undefined;
                }
            } else {
                return provider.getApiKey(cred);
            }
        }

        const envKey = getEnvApiKey(providerId);
        if (envKey) return envKey;

        return undefined;
    }

    hasAuth(provider) {
        if (this.runtimeOverrides.has(provider)) return true;
        if (this.data[provider]) return true;
        if (getEnvApiKey(provider)) return true;
        return false;
    }
}

module.exports = { AuthStorage };
