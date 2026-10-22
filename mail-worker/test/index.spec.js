import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, { normalizeBindings } from '../src';

describe('Cloud Mail worker', () => {
	it('serves the Cloud Mail app (unit style)', async () => {
		const request = new Request('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Cloud Mail</title>');
	});

	it('serves the Cloud Mail app (integration style)', async () => {
		const response = await SELF.fetch('http://example.com');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<title>Cloud Mail</title>');
	});

	it('keeps the private portal callback out of the SPA fallback', async () => {
		let assetFetches = 0;
		const assets = { fetch: async () => { assetFetches += 1; return new Response('<title>Cloud Mail</title>'); } };
		const response = await worker.fetch(new Request('http://example.com/internal/portal-otp-log', { method: 'POST', body: '{}' }), { assets }, {});
		expect(response.status).toBe(404);
		expect(assetFetches).toBe(0);
	});

	it('preserves API/assets routing and normalizes an uppercase R2 binding without mutation', async () => {
		let assetFetches = 0;
		const assets = { fetch: async () => { assetFetches += 1; return new Response('asset'); } };
		const upper = { assets, R2: { put: () => {} } };
		const normalized = normalizeBindings(upper);
		expect(normalized).not.toBe(upper);
		expect(normalized.r2).toBe(upper.R2);
		expect(upper.r2).toBeUndefined();
		const assetResponse = await worker.fetch(new Request('http://example.com/asset.js'), upper, {});
		expect(assetResponse.status).toBe(200);
		expect(assetFetches).toBe(1);
		const apiResponse = await worker.fetch(new Request('http://example.com/api/not-a-route'), upper, {});
		expect(apiResponse.status).toBe(200);
		expect(assetFetches).toBe(1);
	});
});
