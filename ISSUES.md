# Current Issues and Missing Integrations

This document tracks technical debt and missing integrations identified during orientation.

## Review system prompt docs
- we almost certainly have some old clawdbot crap hiding in them screwing things up. Like making memory documents lying around places is definitely from them somehow.

## Maybe we should get rid of the fancy memory stuff?
{
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
}
