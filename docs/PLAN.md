- Only tick off an item if you have fully completed it and tested that it is successfully working.

- Do not add placeholders or fake functionality in order to mark a task as complete.

---

- This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.
	You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.
	Fight entropy. Leave the codebase better than you found it.

- Great tests are executable specifications that survive refactoring. Each test should verify one clear behavior: arrange your inputs, perform one action, assert the outcome. Name tests so clearly that a failing test name tells you exactly what broke. Avoid testing implementation details; test the public contract that callers depend on. When you find a bug, write the test that would have caught it first, then fix it.
	Your tests are documentation that never lies—make them readable enough that they teach the next person how your code actually works.

---

- [x] Initialize repo skeleton per directory sketch; add placeholders and brief READMEs in key dirs.
- [x] Define config loading strategy (env + config files) and add a sample config template.
- [x] Implement config loader (file + env overrides) with tests.
- [x] Implement Discord bot bootstrap (connect, basic message receive, thread handling); add smoke tests/mocks.

--- Tracer A: minimal end-to-end (Discord -> model -> reply + logging)

- Tracer A is "done" when: a Discord message yields a model reply, the reply is sent, and an append-only log entry is written in the correct context window (channel/thread), with tests covering happy path.

- [x] Implement model serving (pi-mono provider integration, provider-agnostic calls); add tests/mocks for provider selection and request shape.
- [x] Wire Discord runtime to model client and send replies; add tests for reply flow.
- [x] Implement event log writer (append-only markdown, per context window); add tests for format and immutability behavior.
- [x] Implement log naming rules and path resolver; add tests for timestamp/seq uniqueness.
- [x] Implement /new command to end a context window and reset per-window chat history; add tests around state reset.
- [x] Implement embedding generation (Google provider, async queue, retry/backoff); add tests for retry states and status transitions.
- [x] Implement SQLite embeddings index schema + CRUD; add tests for insert/query/migration.
- [x] Implement embedding reconciliation job (find missing embeddings, enqueue); add tests for coverage.
- [x] Implement memory retrieval (similarity + recency + MMR + pinned-first); add tests for ranking outcomes.
- [x] Implement memory injection (JSON schema + token heuristics, injected-before-prompt); add tests for truncation and budgets.
- [x] Implement prompt-side chat history windowing (per context window, injected before user prompt); add tests for history ordering and /new reset behavior.

--- Tracer B: memory UX expansion

- Tracer B is "done" when: /remember pins a message and pinned memories are boosted in retrieval on the next turn, with tests covering precedence and storage.

- [x] Implement pinned memory flow (/remember command + storage + retrieval boost); add tests for precedence.
- [x] Implement skills loader + execution via bash; add tests for script invocation and error handling.
- [x] Implement minimal CLI harness (stateless, no history); add tests for parity with Discord core behaviors.

--- Tracer C: reminders and scheduler

- Tracer C is "done" when: a reminder line in the file triggers a Discord notification at the correct local time and confirms with the exact line, with tests for DST edge cases.

- [x] Implement reminders file parser (line grammar, invalid line handling); add tests for parsing edge cases.
- [ ] Implement reminder ID assignment (rid format) and safe append logic; add tests for id stability.
- [ ] Implement scheduler scan + due detection (Europe/London time rules); add tests for DST edge cases.
- [ ] Implement reminder lifecycle actions (one-off delete, recurring keep); add tests for file edits.
- [ ] Implement Discord reminder notifications + confirmation messages; add tests/mocks for output format.

--- Cross-cutting

- [ ] Add basic observability (structured logs, error reporting); add tests for log emission paths.


## Issue Tracker:

- List any issues you encounter here.
