const { AuthStorage } = require('../app/auth');
const path = require('path');
const readline = require('readline');

async function login(providerId) {
    const authPath = path.join(process.cwd(), 'config', 'auth.json');
    const authStorage = new AuthStorage(authPath);

    console.log(`Logging in to ${providerId}...`);

    try {
        await authStorage.login(providerId, {
            onUrl: (url) => {
                console.log(`\nPlease visit this URL to authenticate:\n${url}\n`);
            },
            onCode: (code) => {
                console.log(`Enter code: ${code}`);
            }
        });
        console.log(`Successfully logged in to ${providerId}. Credentials saved to ${authPath}`);
    } catch (err) {
        console.error(`Login failed: ${err.message}`);
        process.exit(1);
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node scripts/login.js <provider>');
        console.log('Available providers: openai-codex, github-copilot, etc.');
        const authPath = path.join(process.cwd(), 'config', 'auth.json');
        const authStorage = new AuthStorage(authPath);
        const providers = authStorage.getOAuthProviders();
        console.log('Supported OAuth providers:', providers.join(', '));
        process.exit(1);
    }

    const provider = args[0];
    await login(provider);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
