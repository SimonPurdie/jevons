import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from '../app/config.js';
import path from 'path';

async function registerCommands() {
    const config = loadConfig();
    const discordConfig = config.discord || {};

    const token = process.env.JEVONS_DISCORD_TOKEN || discordConfig.token;
    if (!token || !discordConfig.application_id) {
        console.error('Error: "token" (or JEVONS_DISCORD_TOKEN env var) and "application_id" are required in config.json under "discord".');
        process.exit(1);
    }

    const commands = [
        new SlashCommandBuilder()
            .setName('new')
            .setDescription('Start a fresh conversation (old session is preserved)'),
        new SlashCommandBuilder()
            .setName('resume')
            .setDescription('Resume a previous conversation session'),
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(discordConfig.token);

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
