# Current Issues and Missing Integrations

This document tracks technical debt and missing integrations identified during orientation.

## 1. Tool Call Integration
- **Status:** Incomplete
- **Description:** The `app/runtime.js` uses `completeSimple`, which does not support model-driven tool calls. 
- **Impact:** The model cannot use the `bash` tool to execute skills (e.g., managing reminders).
- **Required Action:** Transition to a tool-aware completion loop and expose the `bash` tool as defined in `SPEC.md`.

## 2. Automatic Turn-by-Turn Embeddings
- **Status:** Incomplete
- **Description:** Turn-by-turn embedding generation is not yet hooked into the runtime logic. 
- **Impact:** The embeddings index remains empty (`data/index/embeddings.sqlite3`), making memory retrieval ineffective.
- **Required Action:** Integrate `EmbeddingQueue` into `app/runtime.js` to enqueue log entries for embedding upon creation.

## 3. Startup Reconciliation
- **Status:** Incomplete
- **Description:** The reconciliation job is implemented (`memory/index/reconciliation.js`) but not triggered on agent startup.
- **Impact:** New or missed log entries are not indexed after restarts.
- **Required Action:** Trigger a reconciliation pass in `app/index.js` during startup.

## 4. Brave Search Implementation
- **Status:** Placeholder
- **Description:** `skills/brave-search` contains only a text description in `skill.md`.
- **Impact:** The model cannot actually perform web searches.
- **Required Action:** Implement a functional bash script or integration for Brave Search as a skill.

## 5. Token Heuristics
- **Status:** Basic
- **Description:** Token budget estimation is using very simple heuristics.
- **Impact:** Risk of context overflow or inefficient memory injection.
- **Required Action:** Verify if current heuristics (4 chars ≈ 1 token) are sufficient or need refinement based on target models.
