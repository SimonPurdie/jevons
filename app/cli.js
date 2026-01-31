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
    const models = Object.keys(config.models || {});

    if (models.length === 0) {
        console.log('No models configured.');
        await prompt(rl, 'Press Enter to continue...');
        return;
    }

    models.forEach((model, index) => {
        const isCurrent = model === config.activeModel;
        console.log(`${index + 1}. ${model} ${isCurrent ? '(Current)' : ''}`);
    });
    console.log('0. Cancel');
    console.log('');

    const choice = await prompt(rl, 'Select model number: ');
    const index = parseInt(choice.trim()) - 1;

    if (choice.trim() === '0') return;

    if (index >= 0 && index < models.length) {
        const selectedModel = models[index];
        config.activeModel = selectedModel;
        saveConfig(config);
        console.log(`Active model set to: ${selectedModel}`);
    } else {
        console.log('Invalid selection.');
    }
    await prompt(rl, 'Press Enter to continue...');
}

async function configureModels(rl, config) {
    while (true) {
        clearScreen();
        console.log('--- Configure Models ---');
        const models = Object.entries(config.models || {});

        models.forEach(([name, details], index) => {
            console.log(`${index + 1}. ${name} (${details.provider}/${details.model})`);
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
            await editModel(rl, config, models[index][0]);
        } else {
            await prompt(rl, 'Invalid selection. Press Enter to continue...');
        }
    }
}

async function addNewModel(rl, config) {
    clearScreen();
    console.log('--- Add New Model ---');

    const name = await prompt(rl, 'Enter model nickname (e.g., "coding", "creative"): ');
    if (!name.trim()) return;
    if (config.models && config.models[name]) {
        console.log('Model with this name already exists.');
        await prompt(rl, 'Press Enter to continue...');
        return;
    }

    const provider = await prompt(rl, 'Enter provider (google, anthropic, openai-codex, etc.): ');
    const modelName = await prompt(rl, 'Enter model ID (e.g., gemini-1.5-pro, claude-3-5-sonnet): ');

    if (!config.models) config.models = {};
    config.models[name] = { provider, model: modelName };
    saveConfig(config);

    console.log(`Model "${name}" added.`);

    // Check if auth is needed
    await checkAndSetupAuth(rl, provider);
}

async function editModel(rl, config, modelName) {
    while (true) {
        clearScreen();
        const model = config.models[modelName];
        console.log(`--- Edit Model: ${modelName} ---`);
        console.log(`1. Provider: ${model.provider}`);
        console.log(`2. Model ID: ${model.model}`);
        console.log(`3. Authenticate / Setup Auth`);
        console.log(`4. Delete Model`);
        console.log('0. Back');
        console.log('');

        const choice = await prompt(rl, 'Select option: ');

        switch (choice.trim()) {
            case '1':
                const newProvider = await prompt(rl, 'Enter new provider: ');
                if (newProvider.trim()) {
                    model.provider = newProvider.trim();
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
                const confirm = await prompt(rl, `Are you sure you want to delete "${modelName}"? (y/N): `);
                if (confirm.toLowerCase() === 'y') {
                    delete config.models[modelName];
                    if (config.activeModel === modelName) {
                        config.activeModel = null;
                        if (Object.keys(config.models).length > 0) {
                            config.activeModel = Object.keys(config.models)[0];
                        }
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
