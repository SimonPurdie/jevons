import { AuthStorage } from '../app/auth.js';
import { selectOAuthOption } from '../app/oauthLogin.js';
import path from 'path';
import { getOAuthProviders } from '@earendil-works/pi-ai/oauth';
import readline from 'readline';

async function promptStdin(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return await new Promise((resolve) => rl.question(question, resolve));
    } finally {
        rl.close();
    }
}

async function login(providerId) {
    const authPath = path.join(process.cwd(), 'config', 'auth.json');
    const authStorage = new AuthStorage(authPath);

    console.log(`Logging in to ${providerId}...`);

    try {
        await authStorage.login(providerId, {
            onAuth: (info) => {
                console.log(`\nPlease visit this URL to authenticate:\n${info.url}\n`);
                if (info.instructions) console.log(info.instructions);
            },
            onDeviceCode: (info) => {
                console.log(`\nOpen ${info.verificationUri} and enter code: ${info.userCode}\n`);
            },
            onPrompt: async (promptConfig) => {
                return await promptStdin(`${promptConfig.message} `);
            },
            onManualCodeInput: async () => {
                return await promptStdin('Paste the authorization code: ');
            },
            onSelect: async (selectPrompt) => selectOAuthOption(selectPrompt, {
                providerId,
                prompt: promptStdin
            }),
            onProgress: (message) => console.log(message)
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
        const providers = getOAuthProviders();
        console.log('Supported OAuth providers:', providers.map((provider) => provider.id).join(', '));
        process.exit(1);
    }

    const provider = args[0];
    await login(provider);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
