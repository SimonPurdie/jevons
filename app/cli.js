const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config');
const { AuthStorage } = require('./auth');
const { getOAuthProvider, getOAuthProviders } = require('@mariozechner/pi-ai');

// Initialize AuthStorage with config/auth.json
const authStorage = new AuthStorage(path.join(process.cwd(), 'config', 'auth.json'));

function createInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

async function prompt(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}

function clearScreen() {
    console.clear();
}

async function runCLI() {
    const rl = createInterface();
    try {
        await mainMenu(rl);
    } catch (err) {
        console.error('An error occurred:', err);
    } finally {
        rl.close();
    }
}

async function mainMenu(rl) {
    while (true) {
        clearScreen();
        const config = loadConfig();
        console.log('--- Jevons Configuration ---');
        console.log(`Active Model: ${config.activeModel || 'None'}`);
        console.log('----------------------------');
        console.log('1. Change Active Model');
        console.log('2. Configure Models');
        console.log('3. Exit');
        console.log('');

        const choice = await prompt(rl, 'Select an option: ');

        switch (choice.trim()) {
            case '1':
                await changeActiveModel(rl, config);
                break;
            case '2':
                await configureModels(rl, config);
                break;
            case '3':
                return;
            default:
                await prompt(rl, 'Invalid option. Press Enter to continue...');
        }
    }
}

async function changeActiveModel(rl, config) {
    clearScreen();
    console.log('--- Change Active Model ---');
    const models = Array.isArray(config.models) ? config.models : [];

    if (models.length === 0) {
        console.log('No models configured.');
        await prompt(rl, 'Press Enter to continue...');
        return;
    }

    models.forEach((m, index) => {
        const id = `${m.provider}/${m.model}`;
        const isCurrent = id === config.activeModel;
        console.log(`${index + 1}. ${id} ${isCurrent ? '(Current)' : ''}`);
    });
    console.log('0. Cancel');
    console.log('');

    const choice = await prompt(rl, 'Select model number: ');
    const index = parseInt(choice.trim()) - 1;

    if (choice.trim() === '0') return;

    if (index >= 0 && index < models.length) {
        const selected = models[index];
        const selectedId = `${selected.provider}/${selected.model}`;
        config.activeModel = selectedId;
        saveConfig(config);
        console.log(`Active model set to: ${selectedId}`);
    } else {
        console.log('Invalid selection.');
    }
    await prompt(rl, 'Press Enter to continue...');
}

async function configureModels(rl, config) {
    while (true) {
        clearScreen();
        console.log('--- Configure Models ---');
        const models = Array.isArray(config.models) ? config.models : [];

        models.forEach((m, index) => {
            console.log(`${index + 1}. ${m.provider}/${m.model}`);
        });
        console.log(`${models.length + 1}. Add New Model`);
        console.log('0. Back');
        console.log('');

        const choice = await prompt(rl, 'Select option: ');
        const index = parseInt(choice.trim()) - 1;

        if (choice.trim() === '0') return;

        if (index === models.length) {
            await addNewModel(rl, config);
        } else if (index >= 0 && index < models.length) {
            await editModel(rl, config, index);
        } else {
            await prompt(rl, 'Invalid selection. Press Enter to continue...');
        }
    }
}

const SUPPORTED_PROVIDERS = [
    { id: 'google', name: 'Google (API Key)', oauth: false },
    { id: 'anthropic', name: 'Anthropic (API Key)', oauth: false },
    { id: 'openai', name: 'OpenAI (API Key)', oauth: false },
    { id: 'openai-codex', name: 'OpenAI Codex / ChatGPT Plus (OAuth)', oauth: true },
    { id: 'google-antigravity', name: 'Google Antigravity (OAuth)', oauth: true },
    { id: 'github-copilot', name: 'GitHub Copilot (OAuth)', oauth: true },
    { id: 'google-gemini-cli', name: 'Google Gemini CLI (OAuth)', oauth: true },
    { id: 'custom', name: 'Custom / Other', oauth: false }
];

async function selectProvider(rl) {
    while (true) {
        clearScreen();
        console.log('--- Select Provider ---');
        SUPPORTED_PROVIDERS.forEach((p, index) => {
            console.log(`${index + 1}. ${p.name}`);
        });
        console.log('0. Cancel');
        console.log('');

        const choice = await prompt(rl, 'Select a provider: ');
        if (choice.trim() === '0') return null;

        const index = parseInt(choice.trim()) - 1;
        if (index >= 0 && index < SUPPORTED_PROVIDERS.length) {
            const selected = SUPPORTED_PROVIDERS[index];
            if (selected.id === 'custom') {
                const customId = await prompt(rl, 'Enter custom provider ID: ');
                return customId.trim() || null;
            }
            return selected.id;
        }
        await prompt(rl, 'Invalid selection. Press Enter to continue...');
    }
}

async function addNewModel(rl, config) {
    clearScreen();
    console.log('--- Add New Model ---');

    const provider = await selectProvider(rl);
    if (!provider) return;

    const modelName = await prompt(rl, `Enter model ID for ${provider} (e.g., gemini-1.5-pro, claude-3-5-sonnet): `);
    if (!modelName.trim()) return;

    if (!config.models) config.models = [];

    // Check for duplicates
    const exists = config.models.some(m => m.provider === provider && m.model === modelName.trim());
    if (exists) {
        console.log('This model is already in your configuration.');
        await prompt(rl, 'Press Enter to continue...');
        return;
    }

    config.models.push({ provider: provider, model: modelName.trim() });
    saveConfig(config);

    console.log(`Model "${provider}/${modelName.trim()}" added.`);

    // Check if auth is needed
    await checkAndSetupAuth(rl, provider);
}

async function editModel(rl, config, index) {
    while (true) {
        clearScreen();
        const model = config.models[index];
        const id = `${model.provider}/${model.model}`;
        console.log(`--- Edit Model: ${id} ---`);
        console.log(`1. Provider: ${model.provider}`);
        console.log(`2. Model ID: ${model.model}`);
        console.log(`3. Authenticate / Setup Auth`);
        console.log(`4. Delete Model`);
        console.log('0. Back');
        console.log('');

        const choice = await prompt(rl, 'Select option: ');

        switch (choice.trim()) {
            case '1':
                const newProvider = await selectProvider(rl);
                if (newProvider) {
                    model.provider = newProvider;
                    saveConfig(config);
                    await checkAndSetupAuth(rl, model.provider);
                }
                break;
            case '2':
                const newModelId = await prompt(rl, 'Enter new model ID: ');
                if (newModelId.trim()) {
                    model.model = newModelId.trim();
                    saveConfig(config);
                }
                break;
            case '3':
                await checkAndSetupAuth(rl, model.provider, true);
                break;
            case '4':
                const confirm = await prompt(rl, `Are you sure you want to delete "${id}"? (y/N): `);
                if (confirm.toLowerCase() === 'y') {
                    const deletedId = `${model.provider}/${model.model}`;
                    config.models.splice(index, 1);
                    if (config.activeModel === deletedId) {
                        config.activeModel = config.models.length > 0 ? `${config.models[0].provider}/${config.models[0].model}` : null;
                    }
                    saveConfig(config);
                    return;
                }
                break;
            case '0':
                return;
        }
    }
}

async function checkAndSetupAuth(rl, providerId, force = false) {
    // Check if we have auth already
    if (!force && authStorage.hasAuth(providerId)) {
        return;
    }

    const oauthProvider = getOAuthProvider(providerId);

    if (oauthProvider) {
        console.log(`\nInitiating OAuth flow for ${providerId}...`);
        try {
            const credentials = await oauthProvider.login({
                onAuth: (info) => {
                    console.log(`\nPlease authenticate via your browser: ${info.url}`);
                    if (info.instructions) console.log(info.instructions);
                },
                onPrompt: async (promptConfig) => {
                    return await prompt(rl, `\n${promptConfig.message} `);
                },
                onProgress: (msg) => console.log(msg)
            });

            authStorage.set(providerId, { type: 'oauth', ...credentials });
            console.log('Authentication successful!');
            await prompt(rl, 'Press Enter to continue...');
        } catch (err) {
            console.error('Authentication failed:', err.message);
            await prompt(rl, 'Press Enter to continue...');
        }
    } else {
        // API Key fallback
        if (force || !authStorage.hasAuth(providerId)) {
            const apiKey = await prompt(rl, `Enter API Key for ${providerId} (leave empty to skip): `);
            if (apiKey.trim()) {
                authStorage.set(providerId, { type: 'api_key', key: apiKey.trim() });
                console.log('API Key saved.');
            }
        }
    }
}

module.exports = { runCLI };
