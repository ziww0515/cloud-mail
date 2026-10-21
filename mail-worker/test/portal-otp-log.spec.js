import { describe, expect, it } from 'vitest';
import { persistPortalOtpLog, validatePortalOtpLogPayload, verifyPortalOtpLogRequest } from '../src/service/portal-otp-log-service';

const secret = 'test-secret-that-is-at-least-32-chars';
const payload = { providerId: 'provider-1', challenge: 'a'.repeat(64), status: 'accepted', sentAt: '2026-01-01T00:00:00.000Z' };

async function signedRequest(body, timestamp = '1704067200000') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return new Request('https://example.test/internal/portal-otp-log', { method: 'POST', body, headers: { 'x-portal-log-timestamp': timestamp, 'x-portal-log-signature': hex } });
}

function ormMock() {
  let selects = 0;
  return { select: () => ({ from: () => ({ where: () => ({ get: async () => ++selects === 1 ? { userId: 7 } : { accountId: 11 } }) }) }) };
}

function d1Mock(row = { email_id: 99, status: 1 }) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, args: [] };
      calls.push(call);
      return {
        bind(...args) { call.args = args; return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return row; }
      };
    }
  };
}

describe('portal OTP log contract', () => {
  it('rejects wrong signature, short secret, and replay/out-of-window timestamp', async () => {
    const body = JSON.stringify(payload);
    const request = await signedRequest(body);
    request.headers.set('x-portal-log-signature', '0'.repeat(64));
    expect(await verifyPortalOtpLogRequest(request, secret, 1704067200000)).toBeNull();
    expect(await verifyPortalOtpLogRequest(await signedRequest(body), 'short', 1704067200000)).toBeNull();
    expect(await verifyPortalOtpLogRequest(await signedRequest(body), secret, 1704067200000 + 5 * 60 * 1000 + 1)).toBeNull();
  });

  it('rejects payloads over 2KB and unknown fields', async () => {
    const oversized = JSON.stringify({ ...payload, providerId: 'x'.repeat(2000) });
    expect(await verifyPortalOtpLogRequest(await signedRequest(oversized), secret, 1704067200000)).toBeNull();
    expect(validatePortalOtpLogPayload({ ...payload, otp: '123456' })).toBeNull();
    expect(validatePortalOtpLogPayload({ ...payload, recipient: 'real@gmail.com' })).toBeNull();
  });

  it('accepts successful portal content metadata while keeping failure callbacks status-only', () => {
    const contentPayload = { ...payload, subject: '登录验证码', text: '验证码 123456', loginIp: '203.0.113.10', targetHost: 'my.example.test' };
    expect(validatePortalOtpLogPayload(contentPayload)).toMatchObject({ subject: '登录验证码', text: '验证码 123456', loginIp: '203.0.113.10', targetHost: 'my.example.test' });
    expect(validatePortalOtpLogPayload({ ...payload, status: 'failed', ...contentPayload })).toBeNull();
  });

  it('uses one atomic INSERT SELECT and redacts sensitive values', async () => {
    const db = d1Mock();
    const result = await persistPortalOtpLog({ env: { admin: 'admin@example.com', db } }, payload, ormMock());
    expect(result.emailId).toBe(99);
    expect(db.calls[0].sql).toContain('INSERT INTO email');
    expect(db.calls[0].sql).toContain('WHERE NOT EXISTS');
    expect(db.calls[0].sql).not.toContain(payload.challenge);
    expect(db.calls[0].args).toContain('已隐藏安全验证码');
    expect(db.calls[0].args).not.toContain('123456');
  });

  it('does not downgrade delivered or accepted rows when failed is replayed', async () => {
    const deliveredDb = d1Mock({ email_id: 99, status: 2 });
    await persistPortalOtpLog({ env: { admin: 'admin@example.com', db: deliveredDb } }, { ...payload, status: 'failed' }, ormMock());
    const deliveredUpdate = deliveredDb.calls.find(c => c.sql.startsWith('UPDATE'));
    expect(deliveredUpdate.args[0]).toBe(2);

    const acceptedDb = d1Mock({ email_id: 99, status: 1 });
    await persistPortalOtpLog({ env: { admin: 'admin@example.com', db: acceptedDb } }, { ...payload, status: 'failed' }, ormMock());
    const acceptedUpdate = acceptedDb.calls.find(c => c.sql.startsWith('UPDATE'));
    expect(acceptedUpdate.args[0]).toBe(1);
  });

  it('supports concurrent callers through the atomic D1 statement', async () => {
    const db = d1Mock();
    await Promise.all([
      persistPortalOtpLog({ env: { admin: 'admin@example.com', db } }, payload, ormMock()),
      persistPortalOtpLog({ env: { admin: 'admin@example.com', db } }, payload, ormMock())
    ]);
    expect(db.calls.filter(c => c.sql.includes('WHERE NOT EXISTS'))).toHaveLength(2);
  });
});
