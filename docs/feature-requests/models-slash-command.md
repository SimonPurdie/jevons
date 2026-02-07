# Models Slash Command

*Date:* 2026-02-07

## Summary

Add a Discord slash command (maybe `/model` or `/models`) that mirrors what `jevons --options` currently does in the terminal. It should list available models, highlight the active model, and allow switching if appropriate.

## Motivation

Right now the CLI command `jevons --options` is the only place that surfaces the short list of available models and their active status. Bringing that flow into Discord via a slash command would make it easier for users who habitually interact through the bot to inspect and change models without dropping to the shell. It would also lay the groundwork to expose other CLI options in Discord if we decide that is useful later.

## Proposal

- Create a slash command such as `/model` with an optional `list` subcommand.
- The response would include:
  - The currently active model (pulled from `config/config.json`).
  - A table/list of all available models (matching what the CLI shows).
  - Buttons or select menus to change the active model, if we want terse interactions.
- As an alternative or extension, the command could represent the broader `jevons --options` flow: listing config keys and values and providing a way to edit them from Discord.

## Additional Notes

If the Discord command surfaces configuration edits, we should make sure the channel is limited to trusted users, since changing the active model has downstream effects.
