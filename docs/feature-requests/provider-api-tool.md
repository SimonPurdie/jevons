# Feature Request: Provider API Tool

## Summary
Provide a reusable tool within the Jevons harness that lets the assistant call provider APIs (text, image, etc.) using the project's existing plumbing, and return structured results so delivery layers (Discord, webhooks) can act on them.

## Background
Currently the runtime only exposes the `bash` helper as a tool, and the assistant cannot reach external provider APIs (such as Gemini image generation) or surface their outputs in Discord. Requests to expand the assistant's capabilities end up constrained by the lack of a dedicated integration point.

Because the project already manages auth, request helpers, and Discord output logic, the best approach is to wrap that infrastructure in a dedicated tool. This tool would encapsulate the provider-specific API calls while exposing a generic interface to the agent and the runtime.

## Goals
- Let the assistant ask for arbitrary provider operations (model calls, uploads, downloads) while reusing the existing plumbing (auth storage, request utilities, logging).
- Return typed results (plain text, base64 binary, URLs with metadata) so the dispatcher can turn them into Discord attachments, embeds, or follow-on API calls.
- Keep the tool modular and discoverable, so it can be swapped with future provider layers without rewiring the runtime.

## Requirements
1. **Tool interface**
   - Inputs: `provider`, `service`, `action`, `params`, optional `outputHint` (e.g., `image/png`).
   - Outputs: structured JSON that describes the response type, any base64 payload, URLs, status, and diagnostics.
   - Expose a human-friendly description so the assistant knows when to use it and what it can do.
2. **Plumbing reuse**
   - Pull credentials from `authStorage` like other project code.
   - Reuse shared HTTP helpers or clients so each provider isn't reimplemented.
   - Log requests/responses in the existing logging pipeline for debugging.
3. **Dispatcher integration**
   - Ensure a response handler maps `contentType` to Discord messages (strings, attachments) without manual steps.
   - Support waiting for the tool's resolution before the agent continues reasoning.

## Acceptance Criteria
- The tool exists under `app/tools` (or similar) and is registered with the runtime so the agent can invoke it.
- Documentation describes how to call the tool and what structured output to expect.
- A simple example (e.g., Gemini image call) demonstrates using the tool and rendering the result in Discord via attachments.
