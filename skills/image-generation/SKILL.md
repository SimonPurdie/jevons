---
name: image-generation
description: Generate or edit images using Google's Gemini API (Nano Banana). Includes a reliable workflow for calling gemini-2.5-flash-image / gemini-3-pro-image-preview and handling inlineData image parts.
---

# Image Generation (Nano Banana / Gemini API)

Use this skill when the user asks you to **generate an image** or **edit an image** using Google's Gemini API (a.k.a. **Nano Banana**).

## Models (as per our local doc copy)

- **Nano Banana** (fast): `gemini-2.5-flash-image`
- **Nano Banana Pro** (higher fidelity / more instruction-following): `gemini-3-pro-image-preview`

Reference copy of the upstream doc page:
- `references/gemini-api-image-generation.txt`

## Preferred workflow (in this repo / tool setup)

### 1) Pick the right model

- Default to `gemini-2.5-flash-image`.
- Use `gemini-3-pro-image-preview` when:
  - the prompt is complex (many constraints),
  - text-in-image must be accurate (posters, covers, UI),
  - user wants “best quality” over latency.

### 2) Call the Google API via provider_api

Use the Generative Language REST endpoint:

- `POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent`

Request body (minimal):

```json
{
  "contents": [{
    "parts": [
      {"text": "<YOUR PROMPT HERE>"}
    ]
  }]
}
```

Notes:
- Prefer `params.responseType: "json"`.
- The response may include multiple parts. Some parts may be text, others images.
- Images arrive as base64 in `inlineData` (sometimes shown as `inline_data` depending on client).

### 3) Extract and return the image bytes

When the response contains an image part:
- Find the first part with `inlineData` / `inline_data`.
- Decode base64 to bytes.
- Save to a file (e.g. `artifacts/<slug>.png`) and return/attach it.

If there is **no** image part:
- Do not fabricate an image.
- Return the text and explain that the model/project didn’t emit an image modality.

## Prompting guidance (what consistently works)

Include, in roughly this order:

1. **Subject**: what it is (e.g. “a smiling teapot”)
2. **Action / pose**: what it’s doing (e.g. “doing a kickflip mid-air”)
3. **Style**: photo vs illustration, medium, rendering style
4. **Composition**: camera angle, framing, background
5. **Constraints**: “no text”, “single subject”, “white background”, etc.

Good defaults:
- If user didn’t specify: ask *one* clarifying question only if needed (e.g. photo vs cartoon).
- Otherwise pick a sensible style and proceed.

Example (text-to-image):

"A cute smiling ceramic teapot doing a kickflip on a skateboard mid-air, dynamic pose with motion lines, bright cheerful colours, clean bold outlines, soft shading, white studio background, centered composition, high detail, no text."

## Image editing (text + image)

If the user provides an input image:
- Provide it as an additional `part` with inline data (base64) and correct MIME type.
- Add a text instruction part describing the edit.
- Remind the user they must have rights to the image if it’s not theirs.

## Common pitfalls in this environment

- **Don’t rely on webfetch** for `ai.google.dev` docs: direct fetch may fail from this runtime. Prefer our local reference file under `references/`.
- If a user says “nano banana” but the model name isn’t clear: use `gemini-2.5-flash-image` unless they explicitly want Pro.
