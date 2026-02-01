import { REST, Routes } from 'discord.js';
import { loadConfig } from '../app/config.js';
import { AuthStorage } from '../app/auth.js';
import { getCommandDefinitions } from '../app/commands.js';
import path from 'path';

async function registerCommands() {
    const config = loadConfig();
    const discordConfig = config.discord || {};
    const authStorage = new AuthStorage();

    const token = await authStorage.getApiKey('discord') || process.env.JEVONS_DISCORD_TOKEN || discordConfig.token;
    if (!token || !discordConfig.application_id) {
        console.error('Error: Discord token (in auth.json or JEVONS_DISCORD_TOKEN env var) and "application_id" are required.');
        process.exit(1);
    }

    const commands = getCommandDefinitions().map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // Register globally
        const data = await rest.put(
            Routes.applicationCommands(discordConfig.application_id),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
}

registerCommands();
