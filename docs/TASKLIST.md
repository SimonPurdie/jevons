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
- [x] **Step A.1**: Add `pi-coding-agent` dependency
  - **Note**: The package is ESM-only. To proceed, we must migrate the codebase to ESM.
- [x] **Step A.2**: Create session directory configuration
  - **Implementation**: Added `sessionDir` field to `config/config.json` (default: `null`)
  - **Implementation**: Created `app/session.js` module with directory resolution logic
  - **Tests**: Created `test/app/session.test.js` with 15 passing tests
  - **Note**: Users must manually add `"sessionDir": null` to their `config/config.json` since it's gitignored
- [ ] **Step A.3**: Switch to `pi-coding-agent`'s `AuthStorage`

## Phase B: SessionManager Integration
- [ ] **Step B.1**: Create `SessionManager` wrapper
- [ ] **Step B.2**: Migrate Agent creation to use `SessionManager`
- [ ] **Step B.3**: Implement session persistence and recovery

## Phase C: Discord Command Implementation
- [ ] **Step C.1**: Refactor `/new` command
- [ ] **Step C.2**: Implement `/resume` command
- [ ] **Step C.3**: Implement `/compact` command
- [ ] **Step C.4**: Implement `/fork` command
- [ ] **Step C.5**: Implement `/tree` command

## Phase D: Cleanup and Deprecation
- [ ] **Step D.1**: Deprecate custom history modules
- [ ] **Step D.2**: Remove legacy dependencies
- [ ] **Step D.3**: Archive old history directory

## Phase E: Migration of Existing Data
- [ ] **Step E.1**: Create migration script
