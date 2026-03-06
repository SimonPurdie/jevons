import { SlashCommandBuilder } from 'discord.js';

/**
 * Returns the canonical command definitions for the Discord bot.
 * These are used both for registration and runtime sync detection.
 */
export function getCommandDefinitions() {
    return [
        new SlashCommandBuilder()
            .setName('new')
            .setDescription('Start a fresh conversation (old session is preserved)'),
        new SlashCommandBuilder()
            .setName('resume')
            .setDescription('Resume a previous conversation session'),
        new SlashCommandBuilder()
            .setName('compact')
            .setDescription('Summarize older messages to reduce context size')
            .addStringOption(option =>
                option.setName('instructions')
                    .setDescription('Optional: Custom focus for the summary')
                    .setRequired(false)),
        new SlashCommandBuilder()
            .setName('fork')
            .setDescription('Branch conversation from an earlier message'),
        new SlashCommandBuilder()
            .setName('thinking')
            .setDescription('Get or set the global thinking level')
            .addStringOption(option =>
                option.setName('level')
                    .setDescription('Thinking level to apply')
                    .setRequired(false)
                    .addChoices(
                        { name: 'off', value: 'off' },
                        { name: 'minimal', value: 'minimal' },
                        { name: 'low', value: 'low' },
                        { name: 'medium', value: 'medium' },
                        { name: 'high', value: 'high' },
                        { name: 'xhigh', value: 'xhigh' },
                    )),
        new SlashCommandBuilder()
            .setName('model')
            .setDescription('List, add, and switch active model')
            .addStringOption(option =>
                option.setName('provider')
                    .setDescription('Provider ID (for adding/switching)')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('model')
                    .setDescription('Model ID (for adding/switching)')
                    .setRequired(false)),
    ];
}
