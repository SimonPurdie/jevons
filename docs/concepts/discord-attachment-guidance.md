# Concept: Discord attachment handling

## Why this matters
The provider-API tool we discussed will often return binary payloads (images, rendered PDFs, generated data) that the assistant would ideally surface directly inside Discord. That requires two things: (1) the runtime needs a clean way to hand attachments to `sendDiscordMessage()`, and (2) we must respect Discord’s own delivery constraints so the user isn’t met with silent failures when a tool tries to upload too much.

The existing feature request in `docs/feature-requests/provider-api-tool.md` lays the groundwork for structured tool output (content type, base64 blobs, URLs). This concept note focuses on what Discord imposes on attachments so the dispatcher can behave predictably.

## Discord’s attachment constraints
Per Discord’s upload limits documentation (https://support.discord.com/hc/en-us/articles/360049968612-Discord-Upload-Limits), every message can carry **at most ten attachments**, and **each individual file** has a maximum size that depends on the account tier:

- **Standard (non-Nitro) users**: 8 MB per attachment.
- **Nitro Classic**: 50 MB per attachment.
- **Nitro (full tier, including boosts)**: 100 MB per attachment.

There are no guarantees that every user interacting with the bot has Nitro, so the runtime must assume the conservative 8 MB ceiling when prepping binaries. Discord also rejects uploads that are malformed or otherwise unsupported, so tools should verify that any base64 data actually decodes into a valid image/mime type before handing it off.

## How the provider tool should behave
1. **Annotate the payload.** Every tool response that expects to be shown as an attachment should return a `contentType`, `filename`, and a size estimate. If the tool is returning a URL instead of raw bytes, the dispatcher can opt to re-upload it (subject to the same limits) or leave it as a hyperlink.
2. **Guard against overage.** If the binary exceeds 8 MB, the tool or dispatcher should either:
   - downscale/compress the output (e.g., reduce image resolution),
   - offload the asset to a durable hosting service and send the link instead,
   - or fall back to a text summary explaining why the preview could not be delivered.
3. **Limit attachments per response.** The dispatcher must count attachments per Discord message and, if the tool tries to deliver more than ten, bundle them into multiple replies or degrade gracefully (e.g., upload the most relevant asset and describe the rest in text).
4. **Log and surface failures.** If Discord rejects the attachment (size, mime, corrupted payload, etc.), log the error and inform the user in the channel so they can retry or request a lower-resolution version.

## Dispatcher-level responsibilities
- Extend `sendDiscordMessage()` to accept `{ content, files, embeds }` so attachments can travel alongside textual replies.
- Before calling Discord’s API, double-check the payload sizes and names, and annotate the request with a helpful failure message if any limit is exceeded.
- Cache or remove temporary files after the upload finishes to avoid accumulating binaries in the runtime.

## When to avoid attachments altogether
If a tool’s result is extremely large or already hosted (e.g., a pre-signed URL from Gemini), it may be better to send a short textual explanation with that link instead of rebottling it as an attachment. The provider tool should make that decision part of its response metadata (`attachmentAllowed: false`, `explanation: ...`) so the dispatcher knows not to try uploading it.

Keeping this attachment-aware concept in lockstep with the provider API tool will make it possible to deliver rich media while still surviving Discord’s constraints.
