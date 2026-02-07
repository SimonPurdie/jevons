# Provider Tool Contract

## Scope

This document defines the runtime contract between tools that produce rich outputs (especially provider API calls) and Jevons delivery layers (Discord).

## Tool Input

`provider_api` accepts:

- `provider` (string, required): Provider ID from runtime config/model list.
- `service` (string, optional): Provider sub-service label for diagnostics.
- `action` (string, required): Operation name (`request` in current implementation).
- `params` (object, optional): Action arguments.
- `outputHint` (string, optional): Desired MIME type hint (for binary/media preference).

## Tool Output

Tool responses remain model-readable via standard `content` blocks and include structured metadata in `details`.

Canonical shape:

```json
{
  "content": [{ "type": "text", "text": "summary for the agent" }],
  "details": {
    "ok": true,
    "provider": "google",
    "service": "generativelanguage",
    "action": "request",
    "status": 200,
    "contentType": "image/png",
    "artifacts": [
      {
        "kind": "file",
        "name": "generated.png",
        "contentType": "image/png",
        "size": 123456
      }
    ]
  }
}
```

## Artifact Contract

Runtime artifact objects (captured from tools, then consumed by Discord dispatcher):

- `kind`: currently `file`
- `name`: filename for Discord
- `contentType`: MIME type if known
- `size`: size estimate in bytes if known
- One of:
  - `attachment`: `Buffer` or local file path
  - `url`: remote URL (optional future path)

## Error Codes

Tool-level policy/validation failures should emit structured codes in `details.code`:

- `blocked_provider`: provider not allowed by config.
- `missing_api_key`: no provider credential found in auth storage.
- `invalid_request`: required params are missing/invalid.
- `provider_request_failed`: upstream API/network error.
- `response_parse_failed`: response body could not be parsed as requested.

Dispatcher-level delivery failures should include:

- `oversize_attachment`
- `too_many_attachments`
- `invalid_attachment`

## Delivery Rules

- Discord dispatcher attempts up to 10 files per message.
- Default max file size is 8 MB unless runtime overrides `maxAttachmentBytes`.
- Rejected files are summarized in fallback text appended to message content.
