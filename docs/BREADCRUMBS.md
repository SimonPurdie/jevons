# Breadcrumbs

Operational notes for future agents working on this codebase.

## Memory/Embeddings Testing

When using `generateEmbedding(dimensions, seed)` test helper:
- Seeds 1 and 2 produce embeddings with ~0.85 cosine similarity
- Seeds 1 and 10 produce embeddings with ~0.36 cosine similarity
- Don't assume "similar" seeds will have >0.9 similarity; use thresholds appropriate for actual values

## Scheduler/Timezones

- Native `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` is used to handle timezone conversions without external libraries.
- For DST Gaps (Spring Forward), we use a binary search to find the "transition point" (Next Valid Minute) where the local time offset changes. This allows us to map invalid local times (e.g. 01:30 during the 01:00-02:00 gap) to the first valid moment (02:00 BST / 01:00 UTC).
- For DST Overlaps (Fall Back), checking the "earlier occurrence" corresponds to checking the BST offset (+1) before the GMT offset (+0).

## Test Running

- Tests use Node.js built-in test runner: `npm test` or `node --test`
- All tests in `/test/**/*.test.js` pattern are discovered automatically

## Application Entry Point Testing

- `app/index.js` exports `startDiscordRuntime` which now accepts an optional `deps` object for dependency injection.
- This allows testing the bootstrap logic by injecting mocks for `config`, `runtime`, `scheduler`, and `discord.js`.
- See `test/app/logging_integration.test.js` for an example of how to test the application entry point.

## File Layout

- Runtime data (logs, embeddings, pins) is stored in the `data/` directory, separate from the implementation code in `memory/`.
- `config/config.json` points to `data/` for `logs_root`, `index_path`, and `pins_path`.
- The `data/` directory is ignored by git.
