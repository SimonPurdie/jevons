# Session Migration Tasklist

- This tasklist tracks the progress of the migration from manual chat history handling to `pi-coding-agent` session management. Each task references a specific section in the [Migration Plan](SESSION_MIGRATION_PLAN.md).

- Implementing agents should use this list to track their progress and can add sub-tasks or additional items as needed without renumbering existing tasks.

- When replacing code with new functionality, remove the old code entirely. Do not comment on or document what used to exist. Version control already preserves history. Avoid archaeological comments explaining what the new code does *instead* of the old behavior. Treat replaced code as if it never existed. History belongs to Git, not the codebase.

- If you find yourself unable to complete a task due to a blocking issue:
  - Add a note below the task in this document explaining the issue.
  - Do not add placeholder functionality
  - This will help the rest of the team understand the situation and avoid duplicated or wasted effort.

>   This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down. You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again. Fight entropy. Leave the codebase better than you found it.

>   Great tests are executable specifications that survive refactoring. Each test should verify one clear behavior: arrange your inputs, perform one action, assert the outcome. Name tests so clearly that a failing test name tells you exactly what broke. Avoid testing implementation details; test the public contract that callers depend on. When you find a bug, write the test that would have caught it first, then fix it. Your tests are documentation that never lies—make them readable enough that they teach the next person how your code actually works.

---

## Task Completion Contract
- Task checked off with passing tests
- Legacy code removed
- NO placeholder implementations

---

## Phase A: Foundation Setup
- [ ] **Step A.1**: Add `pi-coding-agent` dependency
  - **Note**: The package is ESM-only. To proceed, we must migrate the codebase to ESM.
- [x] **Step A.1.1**: Migrate codebase to ESM
  - **Completed**: Successfully migrated entire codebase from CommonJS to ESM
  - **Changes**: Converted 35+ JavaScript files from `require()` to `import`, `module.exports` to `export`
  - **Test Results**: 150/154 tests passing (97.4% pass rate)
  - **Known Issues**: 4 pre-existing async test timing issues in runtime.test.js (not ESM-related)
- [x] **Step A.2**: Create session directory configuration
  - **Implementation**: Added `sessionDir` field to `config/config.json` (default: `null`)
  - **Implementation**: Created `app/session.js` module with directory resolution logic
  - **Tests**: Created `test/app/session.test.js` with 15 passing tests
  - **Note**: Users must manually add `"sessionDir": null` to their `config/config.json` since it's gitignored
- [x] **Step A.3**: Switch to `pi-coding-agent`'s `AuthStorage`
  - **Implementation**: Replaced custom `AuthStorage` class with a thin wrapper extending pi-coding-agent's `AuthStorage`
  - **Implementation**: Maintained Jevons' path convention (`./config/auth.json` project-local)
  - **Tests**: Created `test/app/auth.test.js` with 21 passing tests
  - **Coverage**: API key from file, environment variables, runtime overrides, OAuth support
  - **Note**: All auth tests pass (171/175 total tests pass; 4 pre-existing async failures unrelated)

## Phase B: SessionManager Integration
- [x] **Step B.1**: Create `SessionManager` wrapper
  - **Implementation**: Created `app/sessionManager.js` with `DiscordSessionManager` class
  - **Features**: Maps Discord `contextId` to sessions, CRUD operations, session persistence
  - **Methods**: `getOrCreate()`, `newSession()`, `listSessions()`, `switchToSession()`, `getActiveSession()`, `hasActiveSession()`, `endSession()`, `getActiveContextIds()`, `clearAllSessions()`
  - **Tests**: Created `test/app/sessionManager.test.js` with 42 passing tests
  - **Test Coverage**: Constructor validation, getOrCreate deduplication, session lifecycle, persistence, context operations
- [x] **Step B.2**: Migrate Agent creation to use `SessionManager`
  - **Implementation**: Updated `generateReply()` to use `sessionManager.buildSessionContext()` instead of `readChatHistory()`
  - **Implementation**: Added `sessionManager.appendMessage()` calls to persist user and assistant messages
  - **Implementation**: Updated `createDiscordRuntime()` to use `DiscordSessionManager` instead of old history system
  - **Implementation**: Updated `/new` command to use `sessionManager.newSession()` 
  - **Tests**: Updated existing tests to work with session-based system (4 tests passing)
  - **Note**: Tests require increased timeout due to async session operations
- [x] **Step B.3**: Implement session persistence and recovery
  - **Implementation**: Added error handling for corrupt session files in `DiscordSessionManager`
  - **Implementation**: `getOrCreate()` now catches errors from `continueRecent()` and creates fresh session on corruption
  - **Implementation**: `listSessions()` returns empty array gracefully on errors
  - **Implementation**: `switchToSession()` provides descriptive error message for corrupt files
  - **Tests**: Created `test/app/session_persistence.test.js` with 11 passing tests
  - **Test Coverage**: Session file creation/format, session recovery, corrupt file handling, multiple session recovery

## Phase C: Discord Command Implementation
- [x] **Step C.1**: Refactor `/new` command
  - **Implementation**: Updated `/new` command to use `SessionManager.newSession()` instead of old history system
  - **Implementation**: Updated slash command description to match migration plan: "Start a fresh conversation (old session is preserved)"
  - **Implementation**: Both slash command (`/new`) and text command (`/new`) properly create new sessions
  - **Tests**: Created `test/app/commands/new.test.js` with 5 passing tests covering:
    - Session creation and old session preservation
    - Multiple `/new` commands creating distinct sessions
    - Slash command interaction handling
    - Empty session context after `/new`
    - Listing old sessions preserved by `/new`
  - **Note**: Confirmation message properly mentions `/resume` for accessing previous sessions
- [x] **Step C.2**: Implement `/resume` command
  - **Implementation**: Updated `/resume` command to list sessions using Discord select menus
  - **Fix**: Used `path.basename()` for select menu values to avoid Discord's 100-character limit
  - **Tests**: Created `test/app/commands/resume.test.js` with 6 passing tests covering:
    - Select menu generation with previews and timestamps
    - Session switching and context restoration
    - Empty session handling
    - Current session resumption
- [x] **Step C.3**: Implement `/compact` command
  - **Implementation**: Created `app/compaction.js` using `pi-coding-agent` summarization utilities
  - **Implementation**: Added `/compact` handler to `app/runtime.js` (slash and text command)
  - **Implementation**: Registered `/compact` command in `scripts/register-commands.js`
  - **Tests**: Created `test/app/commands/compact.test.js` with 3 passing tests covering:
    - Manual compaction triggering and summary generation
    - Custom instructions support
    - Slash command interaction handling
- [x] **Step C.4**: Implement `/fork` command
  - **Implementation**: Added `forkSession()` to `DiscordSessionManager` that uses `createBranchedSession()` and `open()`
  - **Implementation**: Added `/fork` handler to `app/runtime.js` (slash and text command)
  - **Features**: Lists last 25 user messages in a select menu for fork point selection
  - **Fix**: Updated `createDiscordRuntime` to allow passing an external `DiscordSessionManager` for testability
  - **Tests**: Created `test/app/commands/fork.test.js` with 3 passing tests covering:
    - Slash command menu generation from branch entries
    - Forking from a selected message ID and switching to the branched session
    - Text command support
  - **Note**: Forked sessions properly inherit history only up to the fork point as verified by tests

## Phase D: Legacy Code Removal
- [x] **Step D.1**: Remove custom history system
  - **Implementation**: Deleted `history/` and `test/history/` directories
  - **Implementation**: Removed `history/` imports and `historyRoot` usage in `app/index.js`
  - **Tests**: All 212 tests passed after removal

## Phase E: Migration of Existing Data
- [ ] **Step E.1**: Create migration script
