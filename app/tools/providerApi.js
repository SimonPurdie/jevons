import { Type } from '@sinclair/typebox';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const MAX_TEXT_PREVIEW = 4000;

const providerApiSchema = Type.Object({
  provider: Type.String({ description: 'Provider id configured in Jevons (for example: google, openai, anthropic)' }),
  service: Type.Optional(Type.String({ description: 'Optional provider sub-service label' })),
  action: Type.String({ description: 'Provider action. Currently: request' }),
  params: Type.Optional(Type.Any({ description: 'Action parameters' })),
  outputHint: Type.Optional(Type.String({ description: 'Optional MIME hint (for example image/png)' })),
});

export function createProviderApiTool(options = {}) {
  const {
    authStorage,
    allowedProviders = [],
    onArtifact,
  } = options;

  const allowSet = new Set(
    Array.isArray(allowedProviders)
      ? allowedProviders.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
      : []
  );

  return {
    name: 'provider_api',
    label: 'provider_api',
    description:
      'Call allowlisted provider APIs using project auth. Use this for provider operations such as text/image generation, uploads, and downloads.',
    parameters: providerApiSchema,
    execute: async (_toolCallId, params, signal) => {
      const provider = typeof params?.provider === 'string' ? params.provider.trim() : '';
      const service = typeof params?.service === 'string' ? params.service.trim() : '';
      const action = typeof params?.action === 'string' ? params.action.trim() : '';

      try {
        if (!provider) {
          throw createToolError('invalid_request', 'Missing required field: provider');
        }
        if (!action) {
          throw createToolError('invalid_request', 'Missing required field: action');
        }
        if (allowSet.size > 0 && !allowSet.has(provider)) {
          throw createToolError(
            'blocked_provider',
            `Provider "${provider}" is not enabled in config. Ask the user to enable access first.`
          );
        }

        if (action !== 'request') {
          throw createToolError('invalid_request', `Unsupported action "${action}". Supported actions: request`);
        }

        const apiKey = await authStorage?.getApiKey(provider);
        if (!apiKey) {
          throw createToolError(
            'missing_api_key',
            `No API key found for provider "${provider}". Ask the user to add credentials in auth.json.`
          );
        }

        const requestParams = normalizeRequestParams(params?.params);
        const method = requestParams.method.toUpperCase();
        const headers = { ...requestParams.headers };

        applyAuth({ provider, apiKey, requestParams, headers });
        const body = buildRequestBody(requestParams, headers);

        let response;
        try {
          response = await fetch(requestParams.url, {
            method,
            headers,
            body,
            signal,
          });
        } catch (err) {
          throw createToolError('provider_request_failed', `Provider request failed: ${err.message}`);
        }

        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const filenameHint = requestParams.filename || filenameFromContentDisposition(response.headers.get('content-disposition'));
        const status = response.status;
        const responseType = chooseResponseType(requestParams.responseType, contentType, params?.outputHint);

        if (responseType === 'binary') {
          const buffer = Buffer.from(await response.arrayBuffer());
          const filename = filenameHint || defaultFilename(provider, contentType);
          const stagedPath = stageTempArtifact(buffer, filename);
          const artifact = {
            kind: 'file',
            name: filename,
            contentType: contentType || 'application/octet-stream',
            size: buffer.byteLength,
            attachment: stagedPath,
          };
          if (typeof onArtifact === 'function') {
            onArtifact(artifact);
          }

          return {
            content: [{
              type: 'text',
              text: `Provider request completed (${status}). Binary artifact ready: ${filename} (${buffer.byteLength} bytes).`,
            }],
            details: {
              ok: response.ok,
              provider,
              service,
              action,
              status,
              contentType: artifact.contentType,
              artifacts: [{
                kind: artifact.kind,
                name: artifact.name,
                contentType: artifact.contentType,
                size: artifact.size,
              }],
            },
          };
        }

        const bodyResult = await parseNonBinaryResponse(response, responseType);
        const preview = previewText(bodyResult.preview);
        return {
          content: [{
            type: 'text',
            text: `Provider request completed (${status}).\n${preview}`,
          }],
          details: {
            ok: response.ok,
            provider,
            service,
            action,
            status,
            contentType,
            data: bodyResult.data,
          },
        };
      } catch (err) {
        const code = typeof err?.code === 'string' ? err.code : 'provider_request_failed';
        return {
          content: [{
            type: 'text',
            text: `Provider request failed: ${err.message}`,
          }],
          details: {
            ok: false,
            provider: provider || null,
            service: service || null,
            action: action || null,
            code,
            error: err.message,
          },
        };
      }
    },
  };
}

function createToolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeRequestParams(raw) {
  const params = raw && typeof raw === 'object' ? raw : {};
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (!url) {
    throw createToolError('invalid_request', 'params.url is required for action "request"');
  }

  return {
    url,
    method: typeof params.method === 'string' && params.method.trim() ? params.method.trim() : 'GET',
    headers: normalizeHeaders(params.headers),
    body: params.body,
    responseType: typeof params.responseType === 'string' ? params.responseType.trim().toLowerCase() : '',
    filename: typeof params.filename === 'string' && params.filename.trim() ? params.filename.trim() : '',
    auth: params.auth && typeof params.auth === 'object' ? params.auth : {},
  };
}

function normalizeHeaders(value) {
  const result = {};
  if (!value || typeof value !== 'object') {
    return result;
  }
  for (const [key, headerValue] of Object.entries(value)) {
    if (!key || typeof headerValue !== 'string') {
      continue;
    }
    result[key] = headerValue;
  }
  return result;
}

function applyAuth({ provider, apiKey, requestParams, headers }) {
  const placement = typeof requestParams.auth?.placement === 'string'
    ? requestParams.auth.placement
    : defaultAuthPlacement(provider);

  if (placement === 'none') {
    return;
  }

  if (placement === 'query') {
    const queryName = typeof requestParams.auth?.name === 'string' && requestParams.auth.name.trim()
      ? requestParams.auth.name.trim()
      : defaultAuthQueryName(provider);
    const url = new URL(requestParams.url);
    url.searchParams.set(queryName, apiKey);
    requestParams.url = url.toString();
    return;
  }

  const headerName = typeof requestParams.auth?.name === 'string' && requestParams.auth.name.trim()
    ? requestParams.auth.name.trim()
    : 'Authorization';
  const prefix = typeof requestParams.auth?.prefix === 'string'
    ? requestParams.auth.prefix
    : defaultAuthPrefix(provider, headerName);
  headers[headerName] = prefix ? `${prefix}${apiKey}` : apiKey;
}

function defaultAuthPlacement(provider) {
  if (provider === 'google') {
    return 'query';
  }
  return 'header';
}

function defaultAuthQueryName(provider) {
  if (provider === 'google') {
    return 'key';
  }
  return 'api_key';
}

function defaultAuthPrefix(provider, headerName) {
  if (headerName.toLowerCase() === 'authorization') {
    return 'Bearer ';
  }
  if (provider === 'google' && headerName.toLowerCase() === 'x-goog-api-key') {
    return '';
  }
  return '';
}

function buildRequestBody(requestParams, headers) {
  if (requestParams.body === undefined || requestParams.body === null) {
    return undefined;
  }
  if (typeof requestParams.body === 'string' || Buffer.isBuffer(requestParams.body)) {
    return requestParams.body;
  }
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
  if (!hasContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return JSON.stringify(requestParams.body);
}

function chooseResponseType(responseType, contentType, outputHint) {
  if (responseType === 'binary' || responseType === 'json' || responseType === 'text') {
    return responseType;
  }
  const candidate = (contentType || outputHint || '').toLowerCase();
  if (candidate.startsWith('image/') || candidate.startsWith('audio/') || candidate.startsWith('video/')) {
    return 'binary';
  }
  if (candidate.includes('application/octet-stream')) {
    return 'binary';
  }
  if (candidate.includes('json')) {
    return 'json';
  }
  return 'text';
}

async function parseNonBinaryResponse(response, responseType) {
  if (responseType === 'json') {
    try {
      const data = await response.json();
      return { data, preview: JSON.stringify(data, null, 2) };
    } catch (err) {
      throw createToolError('response_parse_failed', `Failed to parse JSON response: ${err.message}`);
    }
  }
  const text = await response.text();
  return { data: text, preview: text };
}

function previewText(value) {
  const text = typeof value === 'string' ? value : String(value);
  if (text.length <= MAX_TEXT_PREVIEW) {
    return text || '(empty response)';
  }
  return `${text.slice(0, MAX_TEXT_PREVIEW)}\n\n[truncated]`;
}

function filenameFromContentDisposition(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const match = value.match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i);
  if (!match) {
    return '';
  }
  const encoded = match[1] || match[2] || '';
  try {
    return decodeURIComponent(encoded);
  } catch (_err) {
    return encoded;
  }
}

function defaultFilename(provider, contentType) {
  const extension = extensionForContentType(contentType);
  return `${provider}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;
}

function extensionForContentType(contentType) {
  switch ((contentType || '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'application/pdf':
      return 'pdf';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    default:
      return 'bin';
  }
}

function stageTempArtifact(buffer, filename) {
  const root = path.join(os.tmpdir(), 'jevons-artifacts');
  fs.mkdirSync(root, { recursive: true });
  const safeName = path.basename(filename || 'artifact.bin');
  const filePath = path.join(root, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}
