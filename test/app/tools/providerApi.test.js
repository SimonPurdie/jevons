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
