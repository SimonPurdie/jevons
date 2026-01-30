# config

Configuration is loaded from an optional JSON file and environment variables.

Loading order (lowest to highest priority):
1. `config/jevons.config.json` (optional, ignored if missing)
2. `config/.env` (optional; KEY=VALUE format)
3. Environment variables with `JEVONS_` prefix

Notes:
- Env vars override file values.
- Paths may be absolute or repo-relative.
- Secrets should live in `config/.env` or real env vars, not in the JSON file.

See `config/config.sample.json` for the full template and
`config/env.sample` for example environment overrides.
