# Current Issues and Missing Integrations

This document tracks technical debt and missing integrations identified during orientation.

## Brave Search Implementation
- **Status:** Placeholder
- **Description:** `skills/brave-search` contains only a text description in `skill.md`.
- **Impact:** The model cannot actually perform web searches.
- **Required Action:** Implement a functional bash script or integration for Brave Search as a skill.

## Automatic Turn-by-Turn Embeddings
- **Status:** Incomplete
- **Description:** Turn-by-turn embedding generation is not yet hooked into the runtime logic. 
- **Impact:** The embeddings index remains empty (`data/index/embeddings.sqlite3`), making memory retrieval ineffective.
- **Required Action:** Integrate `EmbeddingQueue` into `app/runtime.js` to enqueue log entries for embedding upon creation.

## Startup Reconciliation
- **Status:** Incomplete
- **Description:** The reconciliation job is implemented (`memory/index/reconciliation.js`) but not triggered on agent startup.
- **Impact:** New or missed log entries are not indexed after restarts.
- **Required Action:** Trigger a reconciliation pass in `app/index.js` during startup.

