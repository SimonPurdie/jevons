# Session Management Migration Plan

## Executive Summary

This document outlines a comprehensive plan to migrate Jevons from its current manual chat history handling to the idiomatic session management provided by `@mariozechner/pi-coding-agent`'s `SessionManager`. This migration will:

1. **Replace** the custom `history/` system (`chatHistory.js`, `logWriter.js`, `logReader.js`) with `SessionManager`
2. **Implement** Discord slash commands mirroring pi-coding-agent's session features: `/new`, `/resume`, `/compact`, `/fork`
3. **Preserve** existing conversation logging semantics while gaining branching and compaction

---

## Part 1: Analysis of Current vs Target Architecture

### 1.1 Current Implementation (Manual Context Windows)

The current system manages chat history through three main components:

#### `history/chatHistory.js`
- **Purpose:** Windowing module that reads conversation logs and formats them for model context
- **Key Classes:**
  - `ChatHistoryWindow` - Manages token budgets and message selection
- **Key Functions:**
  - `readChatHistory(logPath, options)` - Reads history from log file with default settings
  - `buildHistory(entries)` - Builds history array from log entries
  - `selectMessagesWithinBudget(messages)` - Prioritizes recent messages within token budget
- **Configuration:**
  - `maxHistoryMessages: 20`
  - `maxTokensPerMessage: 500`
  - `totalTokenBudget: 3000`
  - `charsPerToken: 4`

#### `history/logs/logWriter.js`
- **Purpose:** Creates and appends to markdown log files
- **Key Classes:**
  - `createContextWindowResolver` - Factory for managing active windows per context
- **Key Functions:**
  - `createLogWriter(options)` - Creates writer for a specific window
  - `getOrCreateContextWindow(surface, contextId, context)` - Gets/creates window for context
  - `resetContextWindow(surface, contextId, context)` - Resets window (used by `/new`)
- **File Format:** Markdown with frontmatter-style metadata
  - Path: `~/jevons/memory/YYYY-MM-DD-hhmm.md`
  - Entry format: `<role>: [Discord Guild #<guild> <surface> id:<id> +<offset>m <time> GMT] <author>:`

#### `history/logs/logReader.js`
- **Purpose:** Parses markdown log files back into message arrays
- **Key Functions:**
  - `readAllLogEntries(filePath)` - Returns array of parsed entries
  - `parseLogLine(line)` - Parses individual header lines

#### `app/runtime.js` Integration Points
- `generateReply()` creates a **new `Agent` instance per message** with history injected via `initialState.messages`
- `getChatHistoryForContext()` reads history before each message
- `logEvent()` appends entries after user/assistant messages
- `/new` command triggers `windowResolver.resetContextWindow()`

**Critical Issues with Current Approach:**
1. **Ephemeral Agent:** Agent state is not persisted - each message creates fresh Agent
2. **Manual Serialization:** Custom markdown format, not standard JSONL tree structure
3. **No Branching:** Linear history only, no tree navigation
4. **No Compaction:** No automatic or manual context compaction
5. **Token Budget Crude:** Simple character-based estimation vs proper tokenization
6. **No Session Continuity:** Cannot resume specific sessions or fork conversations

### 1.2 Target Implementation (pi-coding-agent SessionManager)

The `pi-coding-agent` package provides a complete session management system:

#### Session File Format (JSONL Tree)
```
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Each line is a JSON object with:
- `type`: Entry type (session, message, compaction, branch_summary, custom, etc.)
- `id`: 8-char hex ID
- `parentId`: Parent entry ID (null for first entry)
- `timestamp`: ISO timestamp

#### SessionManager API

**Static Creation Methods:**
```typescript
SessionManager.create(cwd, sessionDir?)        // New session
SessionManager.open(path, sessionDir?)         // Open existing
SessionManager.continueRecent(cwd, sessionDir?)  // Continue or create new
SessionManager.inMemory(cwd?)                  // No file persistence
SessionManager.forkFrom(sourcePath, targetCwd)  // Fork from another project
```

**Static Listing Methods:**
```typescript
SessionManager.list(cwd, sessionDir?)          // List sessions for directory
SessionManager.listAll()                       // List all sessions
```

**Instance Methods - Session Management:**
```typescript
newSession(options?)                           // Start new session
setSessionFile(path)                           // Switch to different session
createBranchedSession(leafId)                  // Extract branch to new file
```

**Instance Methods - Appending:**
```typescript
appendMessage(message)                         // Add message
appendCompaction(summary, firstKeptId, tokensBefore)  // Add compaction
appendCustomEntry(customType, data)            // Extension state
```

**Instance Methods - Tree Navigation:**
```typescript
getLeafId()                                    // Current position
getBranch(fromId?)                             // Walk to root
getTree()                                      // Full tree structure
branch(entryId)                                // Move leaf to earlier entry
branchWithSummary(entryId, summary)            // Branch with context summary
```

**Instance Methods - Context:**
```typescript
buildSessionContext()                          // Get messages for LLM
```

#### AgentSession API (Higher Level)

For more control, `AgentSession` wraps SessionManager with:
- Event subscription with automatic persistence
- Model and thinking level management
- Compaction (manual and auto)
- Session switching and branching
- Fork and tree navigation

**Key Methods:**
```typescript
await session.prompt(text)                     // Send prompt
await session.newSession()                     // /new equivalent
await session.switchSession(path)              // /resume equivalent
await session.compact()                        // /compact equivalent
await session.fork(entryId)                    // /fork equivalent
```

---

## Part 2: Migration Steps

Each step is atomic and includes:
- **Objective:** What the step accomplishes
- **Contract:** The behavioral guarantees after this step
- **Implementation:** Technical details
- **Testing:** How to verify correctness

---

### Phase A: Foundation Setup

#### Step A.1: Add pi-coding-agent Dependency

**Objective:** Add `@mariozechner/pi-coding-agent` to the project dependencies.

**Contract:**
- Package is installed and importable
- Existing functionality is unchanged

**Implementation:**
```bash
npm install @mariozechner/pi-coding-agent
```

**Testing Guidance:**

Create `test/integration/pi-coding-agent-import.test.js` with tests that verify:
- Core exports are importable: `SessionManager`, `createAgentSession`, `AuthStorage`, `ModelRegistry`
- No import errors or missing dependencies
- Package version is accessible if needed

---

#### Step A.2: Create Session Directory Configuration

**Objective:** Establish configuration for session storage location, compatible with pi conventions but customizable.

**Contract:**
- Sessions stored in `~/.pi/agent/sessions/--jevons--/` by default
- Custom session directory configurable in `config.json`
- Configuration validated at startup

**Implementation:**
1. Add `sessionDir` field to config schema
2. Create `app/session.js` module with session directory resolution
3. Default to pi standard location with Discord-specific encoding

**Files Modified:**
- `config/config.json` - Add `sessionDir` field
- `app/session.js` - New module for session configuration

**Testing Guidance:**

Create `test/app/session.test.js` with tests that verify:
- Default session directory resolves to the pi standard path (`~/.pi/agent/sessions/`)
- Custom `sessionDir` from config overrides the default
- Directory path is absolute and valid
- Missing config gracefully falls back to default

---

#### Step A.3: Switch to pi-coding-agent's AuthStorage

**Objective:** Replace custom `app/auth.js` with `@mariozechner/pi-coding-agent`'s `AuthStorage`, configured with Jevons' path convention.

**Rationale:** The existing Jevons `AuthStorage` class is nearly identical to pi's implementation:
- Same resolution priority (runtime → auth.json → OAuth → env)
- Same file locking for OAuth refresh
- Same credential format
- Same async `getApiKey()` signature

No adapter or bridge is needed—just switch to pi's implementation with our path.

**Contract:**
- API keys resolved via same mechanisms as before
- Existing `config/auth.json` file remains compatible
- Runtime API key overrides still supported
- OAuth tokens still supported

**Implementation:**

Replace `app/auth.js` with a thin re-export:

```javascript
// app/auth.js (simplified)
const { AuthStorage } = require('@mariozechner/pi-coding-agent');
const path = require('path');

/**
 * Create AuthStorage with Jevons' path convention.
 * Default: ./config/auth.json (project-local, not ~/.pi/agent/)
 */
function createAuthStorage(customPath) {
  const authPath = customPath || path.join(process.cwd(), 'config', 'auth.json');
  return new AuthStorage(authPath);
}

module.exports = { AuthStorage, createAuthStorage };
```

**Files Modified:**
- `app/auth.js` - Simplify to re-export pi's AuthStorage

**Files Archived (for reference):**
- Original `app/auth.js` logic preserved in `archive/auth.js` if needed

**Testing Guidance:**

Create `test/app/auth.test.js` with tests that verify:
- API key resolution from environment variables (e.g., `ANTHROPIC_API_KEY`)
- API key resolution from `config/auth.json` file (both `api_key` and `oauth` types)
- Runtime override via `setRuntimeApiKey()` takes precedence over file and env
- Missing credentials return `undefined`
- File path defaults to `./config/auth.json` (project-local, not global `~/.pi/agent/`)
- OAuth token refresh with file locking still works (may require integration test)

---

### Phase B: SessionManager Integration

#### Step B.1: Create SessionManager Wrapper

**Objective:** Create a thin wrapper around `SessionManager` that handles Discord-specific context mapping.

**Contract:**
- Maps Discord `contextId` (channel/thread ID) to sessions
- Supports per-channel session tracking
- Provides CRUD operations for sessions

**Implementation:**
1. Create `app/sessionManager.js` module
2. Map Discord contexts to session paths
3. Maintain in-memory registry of active sessions

**Key Types:**
```typescript
interface DiscordSession {
  contextId: string;
  sessionManager: SessionManager;
  isActive: boolean;
}
```

**Files Created:**
- `app/sessionManager.js`

**Testing Guidance:**

Create `test/app/sessionManager.test.js` with tests that verify:
- `getOrCreate(contextId)` returns a valid session object with `sessionManager` and `isActive` properties
- Calling `getOrCreate()` twice with the same `contextId` returns the same session (no duplicates)
- Different `contextId` values create separate sessions
- Session paths are derived from context IDs in a predictable way
- Use a temporary directory for session storage in tests

---

#### Step B.2: Migrate Agent Creation to Use SessionManager

**Objective:** Replace ephemeral per-message Agent creation with persistent session-backed Agents.

**Contract:**
- Messages are persisted to session immediately
- Session context used for LLM prompts
- Agent state survives across messages in same session

**Implementation:**
1. Modify `generateReply()` to use `sessionManager.buildSessionContext()` instead of `readChatHistory()`
2. Call `sessionManager.appendMessage()` after each user/assistant message
3. Remove direct `logEvent()` calls

**Before:**
```javascript
const chatHistory = getChatHistoryForContext(payload.contextId, ...);
const agent = new AgentClass({
  initialState: { messages: historyMessages, ... }
});
await agent.prompt({ role: 'user', content });
```

**After:**
```javascript
const session = await sessionManager.getOrCreate(payload.contextId);
const context = session.sessionManager.buildSessionContext();
// Agent uses context.messages
session.sessionManager.appendMessage({ role: 'user', content, timestamp: Date.now() });
await agent.prompt({ role: 'user', content });
// After response:
session.sessionManager.appendMessage(assistantMessage);
```

**Files Modified:**
- `app/runtime.js` - Major refactor of `generateReply()` and `createDiscordRuntime()`

**Testing Guidance:**

Create `test/app/runtime_session.test.js` with tests that verify:
- User messages are persisted to the session after `handleMessage()` completes
- Assistant responses are persisted to the session
- Session entries have correct `type: 'message'` and appropriate role
- Multiple messages in succession are all recorded in the same session
- Session context (`buildSessionContext()`) returns all messages for LLM consumption
- Consider mocking the LLM response to avoid API calls in tests

---

#### Step B.3: Implement Session Persistence and Recovery

**Objective:** Ensure sessions are persisted to disk and can be recovered on restart.

**Contract:**
- Session state survives process restart
- Active sessions can be resumed
- Corrupt session files are handled gracefully

**Implementation:**
1. Use `SessionManager.continueRecent()` on context access
2. Implement session listing for Discord contexts
3. Add error handling for corrupt sessions

**Files Modified:**
- `app/sessionManager.js` - Add persistence logic
- `app/index.js` - Initialize session recovery on startup

**Testing Guidance:**

Create `test/app/session_persistence.test.js` with tests that verify:
- After appending a message, a session file exists on disk (check with `fs.existsSync()`)
- Session file is in JSONL format with valid JSON per line
- After creating a new manager instance with the same `sessionDir`, `getOrCreate()` recovers the previous session
- Recovered session contains messages from before the "restart"
- Corrupt session files (invalid JSON) are handled gracefully without crashing
- Use temporary directories and clean up after each test

---

### Phase C: Discord Command Implementation

#### Step C.1: Refactor `/new` Command

**Objective:** Migrate existing `/new` command from custom reset to `SessionManager.newSession()`.

**Contract:**
- `/new` creates a fresh session
- Previous session remains accessible for `/resume`
- Confirmation message sent to user

**Implementation:**
1. Update `onInteraction` handler for 'new' command
2. Call `sessionManager.newSession()` instead of `windowResolver.resetContextWindow()`
3. Update confirmation message

**Before:**
```javascript
if (windowResolver) {
  windowResolver.resetContextWindow(surface, contextId, context);
}
await interaction.reply('Context window reset. Starting fresh conversation.');
```

**After:**
```javascript
const session = await discordSessionManager.getOrCreate(contextId);
session.sessionManager.newSession();
await interaction.reply('New session started. Use /resume to access previous sessions.');
```

**Files Modified:**
- `app/runtime.js` - Update `onInteraction` handler

**Testing Guidance:**

Create `test/app/commands/new.test.js` with tests that verify:
- After `/new`, the session context is empty (no user messages from before)
- The old session file still exists on disk and can be listed
- The reply message confirms the new session and mentions `/resume`
- Multiple `/new` commands create multiple distinct sessions
- Use a mock interaction object to capture replies

---

#### Step C.2: Implement `/resume` Command

**Objective:** Create `/resume` command that lists and switches between sessions.

**Contract:**
- Lists all sessions for current channel/thread with preview
- User can select a session to resume
- Session context is restored after selection

**Implementation:**
1. Register new slash command with Discord
2. Implement session listing via `SessionManager.list()`
3. Use Discord select menu for session selection
4. Call `setSessionFile()` to switch sessions

**Discord Interaction Flow:**
```
User: /resume
Bot: [Select Menu: Session list with first message preview]
     - "Session 1: 'Hello, can you help...' (2 hours ago)"
     - "Session 2: 'What's the weather...' (yesterday)"
User: [Selects Session 2]
Bot: "Resumed session from yesterday. Ready to continue."
```

**Files Modified:**
- `scripts/register-commands.js` - Add /resume command definition
- `app/runtime.js` - Add /resume handler
- `app/discord.js` - May need interaction collector support

**New Slash Command Definition:**
```javascript
new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume a previous chat session')
```

**Testing Guidance:**

Create `test/app/commands/resume.test.js` with tests that verify:
- `/resume` replies with a Discord select menu component containing session options
- Session options include preview text (first message snippet) and relative time
- Selecting a session switches the active session to that file
- After resume, `buildSessionContext()` returns messages from the resumed session, not the previous active session
- Resuming current session is a no-op (or shows appropriate message)
- Use mock Discord interaction objects to simulate selection

---

#### Step C.3: Implement `/compact` Command

**Objective:** Create `/compact` command for manual context compaction.

**Contract:**
- Summarizes older messages to reduce context size
- Summary is injected at start of context
- Original messages beyond summary are no longer in context

**Implementation:**
1. Register `/compact` slash command
2. Use `pi-coding-agent` compaction utilities or implement summarization
3. Call `sessionManager.appendCompaction()` with summary
4. Handle optional custom instructions parameter

**Discord Interaction Flow:**
```
User: /compact
Bot: "Compacting session... Summarized 24 messages (12,000 tokens) into summary. Context now has 8 messages."
```

**New Slash Command Definition:**
```javascript
new SlashCommandBuilder()
  .setName('compact')
  .setDescription('Summarize older messages to reduce context size')
  .addStringOption(option =>
    option.setName('instructions')
      .setDescription('Optional: Custom focus for the summary')
      .setRequired(false))
```

**Files Modified:**
- `scripts/register-commands.js` - Add /compact command
- `app/runtime.js` - Add /compact handler
- `app/compaction.js` - New module for compaction logic

**Testing Guidance:**

Create `test/app/commands/compact.test.js` with tests that verify:
- After `/compact`, a compaction entry exists in the session (`type: 'compaction'`)
- The compaction entry contains a `summary` field with text
- `buildSessionContext()` returns fewer messages after compaction than before
- The summary is included at the start of the context (as a system or summary message)
- Optional custom instructions are reflected in the summary focus
- Compacting an already-compact session handles gracefully

---

#### Step C.4: Implement `/fork` Command

**Objective:** Create `/fork` command to branch from earlier point in conversation.

**Contract:**
- Lists user messages with preview
- Creates new session file from selected point
- Original session unchanged

**Implementation:**
1. Register `/fork` slash command
2. Display user messages via select menu
3. Use `sessionManager.createBranchedSession()` for new file
4. Switch to new session

**Discord Interaction Flow:**
```
User: /fork
Bot: [Select Menu: User messages to fork from]
     - "Hello, can you help with..."
     - "Actually, let's try a different approach..."
     - "What about using Python instead?"
User: [Selects 2nd message]
Bot: "Forked session from 'Actually, let's try...'. You can edit your message or continue."
```

**New Slash Command Definition:**
```javascript
new SlashCommandBuilder()
  .setName('fork')
  .setDescription('Branch conversation from an earlier message')
```

**Files Modified:**
- `scripts/register-commands.js` - Add /fork command
- `app/runtime.js` - Add /fork handler

**Testing Guidance:**

Create `test/app/commands/fork.test.js` with tests that verify:
- After `/fork`, a new session file is created (different path from original)
- The original session file is unchanged
- The forked session contains messages only up to the fork point
- Messages after the fork point are not in the forked session's context
- User messages are displayed in a select menu for fork point selection
- Forking from the most recent message is valid (creates duplicate session)

---


---

### Phase D: Legacy Code Removal

#### Step D.1: Remove Custom History System

**Objective:** Delete all code related to the old history system.

**Contract:**
- Old modules are deleted from the filesystem
- No code references old history modules
- Tests pass without old modules
- Build is clean

**Implementation:**
1. Delete `history/` directory
2. Remove old imports and logic from `app/runtime.js`
3. Remove old tests in `test/history/`
4. Clean up unused configuration in `config.json`

**Files Removed:**
- `history/chatHistory.js`
- `history/logs/logWriter.js`
- `history/logs/logReader.js`
- `test/history/*.test.js`

---

### Phase E: Migration of Existing Data (Optional)

#### Step E.1: Create Migration Script

**Objective:** Convert existing markdown logs to JSONL sessions.

**Contract:**
- Existing conversations preserved
- New format readable by SessionManager
- Migration is reversible (original files kept)

**Implementation:**
1. Create `scripts/migrate-history.js`
2. Parse markdown logs using existing `logReader.js`
3. Write to JSONL format using `SessionManager`

**Testing Guidance:**

Create `test/scripts/migrate-history.test.js` with tests that verify:
- A markdown log file is successfully converted to JSONL format
- The resulting session contains all messages from the original log
- Message roles (user/assistant) are preserved
- Timestamps are converted appropriately
- Original markdown files are not modified (non-destructive migration)
- Empty or malformed markdown files are handled gracefully
- Consider testing with real sample logs from `~/jevons/memory/`

---

## Part 3: Implementation Order Summary

### Recommended Sequence

```
Phase A: Foundation (1-2 days)
├── A.1 Add pi-coding-agent dependency
├── A.2 Create session directory configuration
└── A.3 Switch to pi-coding-agent's AuthStorage

Phase B: SessionManager Integration (2-3 days)
├── B.1 Create SessionManager wrapper
├── B.2 Migrate Agent creation
└── B.3 Implement session persistence

Phase C: Discord Commands (3-4 days)
├── C.1 Refactor /new command
├── C.2 Implement /resume command
├── C.3 Implement /compact command
└── C.4 Implement /fork command

Phase D: Removal (1 day)
└── D.1 Remove legacy history system

Phase E: Migration (Optional, 0.5 days)
└── E.1 Create migration script
```

---

## Part 4: Risk Assessment

### Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Session format incompatibility | High | Low | Use pi-coding-agent types directly, extensive testing |
| Discord rate limiting on interactions | Medium | Medium | Debounce selections, cache session lists |
| Loss of existing conversation data | High | Low | Keep old files, create migration script |
| Agent state synchronization bugs | High | Medium | Extensive integration testing, gradual rollout |

### Rollback Strategy

If issues arise:
1. Revert using Git history
2. SessionManager is file-based; sessions can be manually inspected
3. No database migrations; reverting is code-only

---

## Part 5: Success Metrics

After migration:
- [ ] All existing tests pass (minus deprecated ones)
- [ ] `/new` creates new session and preserves old
- [ ] `/resume` lists and switches between sessions correctly
- [ ] `/compact` reduces context while preserving meaning
- [ ] `/fork` creates new session file from branch point
- [ ] Sessions persist across process restarts
- [ ] No regression in response quality or latency

---

## Appendix A: File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `app/session.js` | Session directory configuration |
| `app/sessionManager.js` | Discord-aware SessionManager wrapper |
| `app/compaction.js` | Compaction logic |
| `scripts/migrate-history.js` | (Optional) Migration script |
| `docs/SESSION_MIGRATION_PLAN.md` | This document |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add @mariozechner/pi-coding-agent |
| `config/config.json` | Add sessionDir field |
| `app/auth.js` | Simplify to re-export pi's AuthStorage with Jevons' path |
| `scripts/register-commands.js` | Add /resume, /compact, /fork |
| `app/runtime.js` | Major refactor for SessionManager |
| `app/discord.js` | Add interaction collectors if needed |
| `app/index.js` | Add session initialization |

### Removed Files

| File | Status |
|------|--------|
| `history/` | Deleted |
| `test/history/` | Deleted |

---

## Appendix B: Discord Slash Command Definitions

```javascript
const commands = [
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
        .setDescription('Custom focus for the summary')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('fork')
    .setDescription('Branch from an earlier point in the conversation'),
].map(command => command.toJSON());
```

---

## Appendix C: References

- [pi-coding-agent Session Documentation](/tmp/package/docs/session.md)
- [pi-coding-agent SDK Documentation](/tmp/package/docs/sdk.md)
- [SessionManager TypeScript Definitions](/tmp/package/dist/core/session-manager.d.ts)
- [AgentSession TypeScript Definitions](/tmp/package/dist/core/agent-session.d.ts)
