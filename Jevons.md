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
        
- Threads are UX-level grouping only.
    
- **Memory is global**: no thread- or channel-scoped retrieval restrictions.
    

### 2.2 CLI (secondary)

- Minimal CLI for:
    
    - local testing
        
    - debugging
        
    - development workflows
        
- CLI mirrors Discord behavior but does not introduce extra features.
    

---

## 3. Tools 

1. **bash**

---

## 4. Skills (non-tool capabilities)

Everything that is _not_ a tool is a **skill**.

See pi-skills for potential skills, for now we only import/use brave-search

Memory search should be handled as a skill

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
    
- Memory is **global** across all conversations and threads.
    

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
        
- Format is markdown (automatically formatted appropriately)
	- one markdown document per context window
### 6.3 Embeddings

- Embeddings are generated for:
    
    - every user/agent turn
        
- Each embedding stores a pointer back to:
    - markdown file location and line number

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

### 6.5 Context expansion

- Initial injection uses **snippets only**.
    
- If the agent determines more detail is needed:
    
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
    

### 8.3 Reminder identity

- Each reminder line includes a **stable identifier (`id`)**.
    
- Identifiers are:
    
    - unique within the file
        
    - opaque
        
    - stable once assigned
        
- Humans may write reminder lines without an `id`.
    
- The scheduler is permitted to **append an `id`** to any valid reminder line that lacks one, without changing its meaning.
    

### 8.4 Scheduling and execution

- A cron-driven scheduler:
    
    - periodically scans the reminders file
        
    - determines which reminders are due
        
    - sends a **Discord notification** when a reminder fires
        
- The agent itself does not act as a scheduler.
    

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
    
