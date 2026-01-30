# AI Agent Specification (pi-mono–based)

## 1. High-level goals

- Build a long-running AI agent using **badlogic pi-mono** as the primary stack.
    
- Keep the **tool surface minimal** and explicit.
    
- Treat everything else as **skills** (content + helper scripts), not tools.
    
- Primary interaction happens in **Discord**; CLI exists only for testing.
    
- Use a **framework-managed model serving setup** (no hand-rolled infra).
    
- Implement a **powerful, automatic memory system** without relying on extra LLM calls for summarization or fact extraction.
    

---

## 2. Interaction surfaces

### 2.1 Discord (primary)

- The agent lives in a **dedicated Discord channel**.
    
- Conversations can happen:
    
    - directly in the channel, or
        
    - inside **threads** created from that channel.
        
    

### 2.2 CLI (secondary)

- Minimal CLI for:
    
    - local testing
        
    - debugging
        
    - development workflows
        
- CLI mirrors Discord behavior but does not introduce extra features.

- CLI has no persistent chat history; each invocation is stateless.
    

---

## 3. Tools 

1. **bash**

---

## 4. Skills (non-tool capabilities)

Everything that is _not_ a tool is a **skill**.

See pi-skills for potential skills, for now we only import/use brave-search

Memory search should be handled as a skill.

Skills can include helper scripts that are executed via **bash**.

---

## 5. Model serving

### 5.1 Requirements

- Model serving must be handled by a **framework**, not custom glue code.
    
- The agent must be agnostic to where models run.
    

### 5.2 Approach

- Use pi-mono tooling for:
    
    - provider abstraction
        
    - managed vLLM deployments for self-hosted models
        
- The agent talks only to a provider interface, never directly to infrastructure.
    

### 5.3 Embeddings

- Default embedding provider: **Google**.
    
- Embedding calls should include retry with exponential backoff.
- we handle cases where embedding has failed in the past to ensure memories are not left orphaned.

---

## 6. Memory system

### 6.1 Core principles

- **No LLM calls** for:
    
    - summarization
        
    - fact extraction
        
    - preference extraction
        
- Raw conversation data is the **source of truth**.
    

### 6.2 Event log (ground truth)

- Append-only log of all events:
    
    - user messages
        
    - agent messages
        
    - tool calls and results
        
- Each event includes:
    
    - timestamp
        
    - author/role
        
    - raw content
        
    - optional metadata (tool name, args, outputs)
        
- Format is markdown (automatically formatted appropriately).
- Logs are **append-only and immutable** once written.
- One markdown document per **context window**:
    - Each Discord channel and each Discord thread are separate context windows.
    - A context window continues until explicitly ended with `/new` in that channel or thread.
    - `/new` resets the chat history sent to the model and starts a new log file.
    - The CLI has **no context windows** and **no chat history**; it does not create or append to logs.
- Log files live under a single log root (see **Open Items / TBD** for final layout).
    - Naming pattern: `logs/<surface>/<context_id>/<window_start_utc>_<seq>.md`
    - `surface` is `discord-channel` or `discord-thread`
    - `context_id` is the Discord channel ID or thread ID
    - `window_start_utc` is the UTC timestamp when the window started (e.g., `20260130T142355Z`)
    - `seq` is a zero-padded integer used only if multiple windows start at the same timestamp
### 6.3 Embeddings

- Embeddings are generated for:
    
    - every user/agent turn
        
- Each embedding stores a pointer back to:
    - markdown file location and line number

- Tool calls/results are **not** embedded; they may be stored as metadata.

- Embeddings index is stored in **SQLite** with sufficient metadata to resolve the log pointer.
    - Minimum fields: `embedding`, `path`, `line`, `timestamp`, `role`, `context_id`, `pinned`

#### 6.3.1 Embedding failures and recovery

- Embedding generation runs asynchronously.
- Each turn has an embedding status: `pending`, `ok`, `failed`.
- On `failed` or timeout, retry with exponential backoff.
- On agent startup (or on a scheduled maintenance job), run a reconciliation pass to enqueue any turns without embeddings.

### 6.4 Retrieval (automatic)

On every user turn:

1. Generate an embedding for the new input.
    
2. Perform global similarity search over all stored embeddings.
    
3. rank results using:
    
    - similarity score
        
    - recency decay
        
    - diversity
        
    - pinned-memory boost
        
4. Inject the top results into context as:
    
    - short excerpts
        
    - references to their position in the event log
        

Memory injection appears immediately prior to user prompt and is clearly marked within the context as being additional injected memory so the model is not confused.

Injected memories are not saved in chat history, the only injected memories a model sees are the ones from the current turn.

Token efficiency of memories is important. We should only provide a small number of the most relevant memories and they must be short - truncated if necessary and clearly marked as such. The agent can decide if they were relevant and investigate further using the references to the full records.

The agent does not need to ask for memory; it is always supplied.

#### 6.4.1 Ranking details (pinned-first + MMR)

- **Pinned memories always take precedence** and are inserted first.
- Remaining slots are selected with Maximal Marginal Relevance (MMR):
    - Let `sim` be cosine similarity in [0, 1].
    - Let `recency` be `exp(-age_days / 14)`.
    - For a candidate `c` and selected set `S`, define:
        - `diversity_penalty = max(sim(c, s)) for s in S`
    - Score: `0.7 * sim + 0.2 * recency - 0.1 * diversity_penalty`
- If no pinned memories exist, selection starts with the top `sim` item and continues via MMR.

#### 6.4.2 Memory injection schema

Injected memories are included as **JSON** immediately before the user prompt.
Prefix the JSON block with the literal line:
`INJECTED_CONTEXT_RELEVANT_MEMORIES`

Schema:
```
{
  "budget_tokens_est": 1000,
  "memories": [
    {
      "path": "logs/discord-thread/123/20260130T142355Z_0001.md",
      "line": 42,
      "excerpt": "short snippet...",
      "truncated": true
    }
  ]
}
```

Rules:
- Total injected memory uses a **1000-token heuristic budget**.
- Each memory has a **250-token heuristic max**.
- Use a simple estimation heuristic (e.g., 4 chars ≈ 1 token) rather than precise tokenization.
- Each memory must include `path` and `line` fields (path=, line=) to allow lookup in the log.

### 6.5 Context expansion

- Initial injection uses **snippets only**.
    
- If the calling model determines more detail is needed:
    
    - the runtime may expand the referenced log range internally
        
    - no tool call is required
        

### 6.6 Pinned memory (/remember)

- A Discord command `/remember` exists.
    
- When used, the referenced message or content is:
    
    - explicitly marked as pinned memory
        
    - always eligible for retrieval
        
    - strongly boosted during ranking
        

Pinned memory replaces the need for automatic fact extraction.

---

## 7. Agent runtime behavior

- Built on pi-mono agent runtime primitives.
    
- Responsibilities:
    
    - conversation loop
        
    - tool invocation and guardrails
        
    - skill retrieval and injection
        
    - memory retrieval and ranking
        
    - provider-agnostic model calls
        

The agent core must remain:

- UI-agnostic
    
- transport-agnostic
    
- model-provider-agnostic
    
---

## 7.1 Framework delegation (pi)

- Default to **pi** framework behavior unless this spec explicitly overrides it.
- This spec only defines requirements that **constrain or override** pi defaults.
- When a conflict is discovered, the spec takes precedence and should be updated to clarify intent.

### 7.1.1 Pi components in scope

Use:
- `@mariozechner/pi-agent-core` for runtime loop, tool calling, and state.
- `@mariozechner/pi-ai` for provider-agnostic model access.
- `@mariozechner/pi-pods` for managed vLLM deployments when self-hosting models.

Avoid unless scope expands:
- `@mariozechner/pi-coding-agent` (full CLI agent; we only need a minimal test CLI).
- `@mariozechner/pi-mom` (Slack bot; primary UI is Discord).
- `@mariozechner/pi-tui` and `@mariozechner/pi-web-ui` (UI layers not needed).

## 8. Scheduling and reminders

### 8.1 Source of truth

- All reminders are stored in a **single markdown file** within an **Obsidian vault**.
    
- This file is the **only source of truth** for scheduling.
    
- The file is:
    
    - human-readable and human-editable
        
    - safe to modify outside the agent
        
    - authoritative over all agent or system state
        

### 8.2 Reminder representation

- Each reminder is represented by **one markdown line**.
    
- Each line encodes, explicitly and unambiguously:
    
    - reminder message
        
    - date
        
    - time
        
    - recurrence (none, daily, weekly, monthly)
        
- All reminders use **local UK time (Europe/London)**, including BST/GMT transitions.
    
- Time zone information is implicit and not encoded in the file.

#### 8.2.2 Time zone and recurrence rules

- All scheduling uses the IANA time zone `Europe/London`.
- If a local time is **nonexistent** (spring-forward gap), schedule at the next valid local minute.
- If a local time is **ambiguous** (fall-back overlap), schedule at the earlier occurrence.
- Monthly recurrence on dates that do not exist in a given month fires on the **last day of that month** at the same local time.

#### 8.2.1 Reminder line grammar

Each line uses a strict key-value format to stay human-editable and machine-parseable:
`- [ ] date=YYYY-MM-DD time=HH:MM recur=none|daily|weekly|monthly msg="..." id=RID`

Rules:
- `msg` is a double-quoted string; `\"` is used for quotes inside the message.
- Spaces are allowed only inside `msg`.
- Fields may appear in any order but must all be present when the agent writes the line.
- Humans may omit `id`; the scheduler may append `id=...` at the end.

Invalid lines are ignored by the scheduler and must not be modified automatically.
    

### 8.3 Reminder identity

- Each reminder line includes a **stable identifier (`id`)**.
    
- Identifiers are:
    
    - unique within the file
        
    - opaque
        
    - stable once assigned
        
- Humans may write reminder lines without an `id`.
    
- The scheduler is permitted to **append an `id`** to any valid reminder line that lacks one, without changing its meaning.

#### 8.3.1 ID format

- `id` is an opaque identifier of the form `rid_<base32>`.
- `base32` is 12 characters (A-Z2-7), randomly generated.
- Example: `id=rid_K5V4M2J9Q2ZP`
    

### 8.4 Scheduling and execution

- A cron-driven scheduler:
    
    - periodically scans the reminders file
        
    - determines which reminders are due
        
    - sends a **Discord notification** when a reminder fires
        
- The agent itself does not act as a scheduler.

- Scheduler cadence is **once per minute**; if a run takes more than a few seconds, treat it as an error condition.
    

### 8.5 Reminder lifecycle

- **One-off reminders**:
    
    - are automatically **deleted** from the file after firing
        
- **Recurring reminders**:
    
    - persist until explicitly modified or removed
        
- The file represents **future intent only**; no execution history is stored.
    

### 8.6 Agent interaction and tooling

- The agent has narrow tooling to:
    
    - create reminders
        
    - modify reminders (by `id`)
        
    - delete reminders
        
- The agent must treat the markdown file as canonical and must not maintain parallel reminder state.
    

### 8.7 Reporting and safety

- Whenever the agent creates or modifies a reminder:
    
    - it must send a **Discord confirmation**
        
    - the confirmation includes the **exact reminder line** as written to markdown
        
- This confirmation acts as the primary safety and audit mechanism.
    
- Malformed or missing confirmations are handled manually at the human level.
    

### 8.8 Design intent

- The system prioritizes:
    
    - explicit state
        
    - minimal hidden behavior
        
    - deterministic agent actions
        
- Human editing is a first-class workflow and must not conflict with agent operation.

---

## 9. Open items / TBD

- None.

---

## 10. Directory sketch (non-prescriptive)

This is a lightweight sketch to aid implementation; paths may change as requirements evolve.

```
.
├─ app/                     # agent runtime + discord integration
├─ cli/                     # minimal test CLI
├─ data/                    # runtime data storage (ignored by git)
│  ├─ logs/                 # append-only markdown logs
│  ├─ index/                # embeddings index + metadata (SQLite)
│  └─ pins/                 # pinned memory metadata
├─ skills/                  # skill content + helper scripts
├─ memory/                  # memory system implementation
│  ├─ logs/                 # log writer/reader logic
│  ├─ index/                # embeddings index logic
│  └─ pins/                 # pins manager logic
├─ scheduler/               # reminder scanner + dispatcher
├─ config/                  # config templates / sample env files
└─ docs/                    # internal docs and implementation notes
```

Notes:
- The Obsidian reminders file may live **outside** the repo; treat it as an external path.
    
