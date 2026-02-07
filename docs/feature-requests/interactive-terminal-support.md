# Feature request: Interactive terminal support

## Summary
Add **first-class interactive TTY support** to the Jevons tool runtime so an agent can run commands that require a pseudo-terminal and respond to prompts incrementally (e.g. password-less interactive flows, REPL-like CLIs, TUIs).

## Use case (the one we discussed)
Some tasks are awkward or unreliable with the current “run a command, get stdout/stderr” model:

- Tools that **change behaviour when not attached to a TTY** (colour, progress, spinners, paging, prompt rendering).
- Commands that require **multiple rounds of input** (confirmations, stepwise prompts).
- Short interactive sessions where the agent needs to **observe output mid-stream** and decide what to send next.

We want a guardrailed way to do the above without resorting to brittle hacks (flags to disable prompts, rewriting commands, or ad-hoc expect scripts).

## Proposal (concise)
Introduce a new tool (or extend the existing bash tool) to support an interactive session lifecycle:

- `terminal.open({ cwd, env, command, args, cols, rows, timeout }) -> { sessionId }`
- `terminal.read({ sessionId, maxBytes, timeoutMs }) -> { stdout, stderr, exitCode? }`
- `terminal.write({ sessionId, stdin, appendNewline? }) -> { ok }`
- `terminal.resize({ sessionId, cols, rows }) -> { ok }`
- `terminal.close({ sessionId, force? }) -> { exitCode? }`

Key behavioural constraints:

- **No keystroke echo by default** when the tool detects a password prompt (best-effort heuristics), and/or allow an explicit `sensitive: true` on writes so content is never logged.
- **Hard limits**: total bytes, wall-clock time, max sessions, and output truncation.
- **Deterministic logging**: record session metadata (start/end, command, exit code) but allow redaction of sensitive stdin.

## Acceptance criteria
- Agent can run a command that checks `isatty(1)` and sees TTY behaviour.
- Agent can complete a multi-prompt flow by alternating `read`/`write`.
- Sensitive input can be sent without being persisted in logs.
- Sessions are reliably cleaned up on timeout/crash.

## Notes / non-goals
- Not asking for a full remote shell experience; just enough interactivity to support common CLIs safely.
- Prefer implementation using a PTY library (platform-dependent), but exact approach is up to the implementer.
