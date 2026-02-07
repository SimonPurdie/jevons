**ESM**:
- ESM requires explicit file extensions in imports (e.g., `./config.js` not `./config`)
- Dynamic imports return a module namespace object; use `const module = await import('pkg'); const { name } = module;`

**Discord Select Menu Limits**
- Discord select menu `value` fields have a maximum length of 100 characters. When using absolute file paths as values (e.g., for `/resume`), ensure you use only the filename (`path.basename()`) and reconstruct the path on the backend if necessary.
- Discord select menu `label` and `description` fields also have a 100-character limit. Previews and titles must be truncated.

**pi-coding-agent API nuances**
- `SessionManager.createBranchedSession(entryId)` returns a **string** containing the absolute path to the new session file, NOT a `SessionManager` instance. You must call `SessionManager.open(path)` on the returned string to get a manager for the new branched session.
- `sessionManager.buildSessionContext().messages` returns model-ready message objects without the internal `id` fields. To get messages with their entry IDs (e.g., for forking), use `sessionManager.getBranch()` which returns raw entries containing `id`, `type`, `timestamp`, and `message` properties.
- **Session Persistence**: `SessionManager` from `pi-coding-agent` only flushes to disk once the first **assistant** message is appended. User-only sessions remain in memory only. The migration script and tests now reflect this behavior.

**Environment Configuration**
- Added `JEVONS_SESSION_DIR` to the configuration environment map (`app/config.js`). This allows overriding the session directory via environment variables, which is particularly useful for containerized deployments and testing.

**Sandbox Test Limitation**
- In restricted/sandboxed environments, tests that open local listeners may fail with `listen EPERM: operation not permitted 127.0.0.1` (observed in `test/app/e2e_history.test.js` and `test/app/logging_integration.test.js`). Run those in an environment that permits loopback binds.

**This Document**
- This AGENTS.md contains information likely to be of assistance when working in this repo. It is a living document maintained by the human user, and by the agents working here. If you encounter a problem with the environment, and come away from that problem with information that would be helpful for future agents to avoid the same issue, then note it down here for their benefit. You should also inform the human user when you do this.
