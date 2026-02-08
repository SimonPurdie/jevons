import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs';
import { createProviderApiTool } from '../../../app/tools/providerApi.js';

test('provider_api blocks providers outside allowlist', async () => {
  const tool = createProviderApiTool({
    authStorage: { getApiKey: async () => 'key' },
    allowedProviders: ['google'],
  });

  const result = await tool.execute('call-1', {
    provider: 'openai',
    action: 'request',
    params: { url: 'https://example.com' },
  });

  assert.equal(result.details.ok, false);
  assert.equal(result.details.code, 'blocked_provider');
});

test('provider_api injects google auth key into query string by default', async () => {
  const originalFetch = globalThis.fetch;
  const seen = { url: '', method: '', headers: {} };
  globalThis.fetch = async (url, options) => {
    seen.url = String(url);
    seen.method = options.method;
    seen.headers = options.headers;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const tool = createProviderApiTool({
      authStorage: { getApiKey: async () => 'secret-key' },
      allowedProviders: ['google'],
    });
    const result = await tool.execute('call-2', {
      provider: 'google',
      action: 'request',
      params: { url: 'https://example.com/v1/test', method: 'POST', body: { hello: 'world' } },
    });

    assert.equal(result.details.ok, true);
    assert.ok(seen.url.includes('key=secret-key'));
    assert.equal(seen.method, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider_api captures binary response as artifact', async () => {
  const originalFetch = globalThis.fetch;
  const artifacts = [];
  globalThis.fetch = async () => {
    return new Response(Buffer.from('image-data'), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  };

  try {
    const tool = createProviderApiTool({
      authStorage: { getApiKey: async () => 'secret-key' },
      allowedProviders: ['google'],
      onArtifact: (artifact) => artifacts.push(artifact),
    });
    const result = await tool.execute('call-3', {
      provider: 'google',
      action: 'request',
      outputHint: 'image/png',
      params: { url: 'https://example.com/v1/image' },
    });

    assert.equal(result.details.ok, true);
    assert.ok(Array.isArray(result.details.artifacts));
    assert.equal(result.details.artifacts[0].storage.kind, 'temp_file');
    assert.equal(result.details.artifacts[0].storage.ephemeral, true);
    assert.ok(typeof result.details.artifacts[0].storage.path === 'string');
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].kind, 'file');
    assert.ok(fs.existsSync(artifacts[0].attachment), 'Staged artifact file should exist');
  } finally {
    for (const artifact of artifacts) {
      if (artifact && artifact.attachment && typeof artifact.attachment === 'string' && fs.existsSync(artifact.attachment)) {
        fs.unlinkSync(artifact.attachment);
      }
    }
    globalThis.fetch = originalFetch;
  }
});

test('provider_api extracts inlineData image artifacts from JSON response', async () => {
  const originalFetch = globalThis.fetch;
  const artifacts = [];
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: Buffer.from('png-bytes').toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  };

  try {
    const tool = createProviderApiTool({
      authStorage: { getApiKey: async () => 'secret-key' },
      allowedProviders: ['google'],
      onArtifact: (artifact) => artifacts.push(artifact),
    });
    const result = await tool.execute('call-4', {
      provider: 'google',
      action: 'request',
      params: {
        url: 'https://example.com/v1/generate',
        responseType: 'json',
      },
    });

    assert.equal(result.details.ok, true);
    assert.ok(Array.isArray(result.details.artifacts));
    assert.equal(result.details.artifacts.length, 1);
    assert.equal(result.details.artifacts[0].storage.kind, 'temp_file');
    assert.equal(result.details.artifacts[0].storage.ephemeral, true);
    assert.ok(typeof result.details.artifacts[0].storage.path === 'string');
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].contentType, 'image/png');
    assert.ok(fs.existsSync(artifacts[0].attachment), 'Staged inlineData artifact should exist');
  } finally {
    for (const artifact of artifacts) {
      if (artifact && artifact.attachment && typeof artifact.attachment === 'string' && fs.existsSync(artifact.attachment)) {
        fs.unlinkSync(artifact.attachment);
      }
    }
    globalThis.fetch = originalFetch;
  }
});

test('provider_api summarizes model-list JSON so all model names remain visible', async () => {
  const originalFetch = globalThis.fetch;
  const models = [];
  for (let i = 0; i < 80; i += 1) {
    models.push({
      name: `models/example-${i}`,
      description: `Model ${i} ${'x'.repeat(200)}`,
    });
  }
  models.push({
    name: 'models/gemini-3-flash-preview',
    description: `Newest model ${'y'.repeat(400)}`,
  });

  globalThis.fetch = async () => new Response(
    JSON.stringify({ models }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );

  try {
    const tool = createProviderApiTool({
      authStorage: { getApiKey: async () => 'secret-key' },
      allowedProviders: ['google'],
    });
    const result = await tool.execute('call-5', {
      provider: 'google',
      action: 'request',
      params: { url: 'https://example.com/v1/models', responseType: 'json' },
    });

    assert.equal(result.details.ok, true);
    const text = result.content[0].text;
    assert.ok(text.includes('"modelCount"'));
    assert.ok(text.includes('models/gemini-3-flash-preview'));
    assert.ok(!text.includes('[truncated]'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider_api accepts params.data as request body alias', async () => {
  const originalFetch = globalThis.fetch;
  const seen = { body: '' };
  globalThis.fetch = async (_url, options) => {
    seen.body = String(options.body || '');
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const tool = createProviderApiTool({
      authStorage: { getApiKey: async () => 'secret-key' },
      allowedProviders: ['google'],
    });
    const result = await tool.execute('call-6', {
      provider: 'google',
      action: 'request',
      params: {
        url: 'https://example.com/v1/generate',
        method: 'POST',
        data: { hello: 'world' },
      },
    });

    assert.equal(result.details.ok, true);
    assert.ok(seen.body.includes('"hello":"world"'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider_api stores large JSON responses as fullData and omits inline details.data', async () => {
  const originalFetch = globalThis.fetch;
  const hugePayload = {
    items: Array.from({ length: 300 }, (_, i) => ({
      id: i,
      text: `row-${i}-${'x'.repeat(80)}`,
    })),
  };

  globalThis.fetch = async () => new Response(
    JSON.stringify(hugePayload),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );

  let result;
  try {
    const tool = createProviderApiTool({
      authStorage: { getApiKey: async () => 'secret-key' },
      allowedProviders: ['google'],
    });
    result = await tool.execute('call-7', {
      provider: 'google',
      action: 'request',
      params: { url: 'https://example.com/v1/huge', responseType: 'json' },
    });

    assert.equal(result.details.ok, true);
    assert.equal(result.details.dataOmitted, true);
    assert.equal(result.details.data, undefined);
    assert.equal(result.details.fullData.storage.kind, 'temp_file');
    assert.ok(fs.existsSync(result.details.fullData.storage.path));
    assert.ok(result.content[0].text.includes('Full response saved to:'));
  } finally {
    if (result?.details?.fullData?.storage?.path && fs.existsSync(result.details.fullData.storage.path)) {
      fs.unlinkSync(result.details.fullData.storage.path);
    }
    globalThis.fetch = originalFetch;
  }
});

test('provider_api stores large text responses as fullData and keeps short preview', async () => {
  const originalFetch = globalThis.fetch;
  const hugeText = 'A'.repeat(12000);

  globalThis.fetch = async () => new Response(hugeText, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });

  let result;
  try {
    const tool = createProviderApiTool({
      authStorage: { getApiKey: async () => 'secret-key' },
      allowedProviders: ['google'],
    });
    result = await tool.execute('call-8', {
      provider: 'google',
      action: 'request',
      params: { url: 'https://example.com/v1/huge-text', responseType: 'text' },
    });

    assert.equal(result.details.ok, true);
    assert.equal(result.details.dataOmitted, true);
    assert.equal(result.details.data, undefined);
    assert.equal(result.details.fullData.storage.kind, 'temp_file');
    assert.ok(fs.existsSync(result.details.fullData.storage.path));
    assert.ok(result.details.preview.includes('[truncated]'));
    assert.ok(result.content[0].text.includes('Full response saved to:'));
  } finally {
    if (result?.details?.fullData?.storage?.path && fs.existsSync(result.details.fullData.storage.path)) {
      fs.unlinkSync(result.details.fullData.storage.path);
    }
    globalThis.fetch = originalFetch;
  }
});
