import { describe, expect, it } from 'vitest';
import { isPortalOtpEmail, maskPortalOtpEmail } from '../src/utils/portal-otp-mask';

const base = {
  sendEmail: 'service@ziww.cc.cd',
  type: 1,
  subject: 'Ziww 登录验证码 · 大陆站',
  messageId: 'a'.repeat(64),
  text: '验证码：482731\n登录站点：大陆站\n登录来源 IP：203.0.113.7\nIP属地：China/Shanghai',
  content: '验证码：482731<br>登录站点：大陆站<br>登录来源 IP：203.0.113.7<br>IP属地：China/Shanghai'
};

describe('portal OTP read-time masking', () => {
  it('reproduces the old raw Sent leak before applying the renderer', () => {
    expect(base.text).toContain('482731');
    expect(base.content).toContain('482731');
  });

  it('masks only the OTP in exact portal Sent records and preserves site/IP/location', () => {
    const row = { ...base };
    expect(isPortalOtpEmail(row)).toBe(true);
    const masked = maskPortalOtpEmail(row);
    expect(masked).not.toBe(row);
    expect(masked.text).not.toContain('482731');
    expect(masked.content).not.toContain('482731');
    expect(masked.text).toContain('大陆站');
    expect(masked.text).toContain('203.0.113.7');
    expect(masked.text).toContain('China/Shanghai');
    expect(masked.content).toContain('203.0.113.7');
  });

  it('does not redact ordinary mail or unrelated records', () => {
    for (const row of [
      { ...base, sendEmail: 'other@example.test' },
      { ...base, type: 0 },
      { ...base, subject: '普通通知' },
      { ...base, messageId: 'not-a-challenge' }
    ]) {
      expect(isPortalOtpEmail(row)).toBe(false);
      expect(maskPortalOtpEmail(row)).toEqual(row);
    }
  });

  it('supports both portal site subjects and preserves reserved example IPs', () => {
    for (const site of ['大陆站', '全球站']) {
      const row = { ...base, subject: `Ziww 登录验证码 · ${site}`, text: `TEST CODE 000000; IP 198.51.100.20; location ${site}` };
      const masked = maskPortalOtpEmail(row);
      expect(masked.text).not.toContain('000000');
      expect(masked.text).toContain('198.51.100.20');
      expect(masked.text).toContain(site);
    }
  });

  it('masks the production sentence without changing the original record or metadata', () => {
    const row = { ...base, text: '你的 Ziww 登录验证码是 654321，5 分钟内有效。\n登录站点：大陆站\n登录来源 IP：203.0.113.7\nIP属地：China/Shanghai' };
    const before = { ...row };
    const masked = maskPortalOtpEmail(row);
    expect(masked.text).not.toContain('654321');
    expect(masked.text).toContain('[已隐藏]');
    expect(masked.text).toContain('大陆站');
    expect(masked.text).toContain('203.0.113.7');
    expect(masked.text).toContain('China/Shanghai');
    expect(row).toEqual(before);
  });

  it('suppresses the extracted-code copy field in full and brief portal Sent projections', () => {
    for (const messageId of [base.messageId, undefined]) {
      const row = { ...base, messageId, code: '482731' };
      const masked = maskPortalOtpEmail(row);
      expect(masked.code).toBe('');
      expect(row.code).toBe('482731');
      expect(masked.text).toContain('203.0.113.7');
    }
    const ordinary = { ...base, subject: '普通通知', code: '482731' };
    expect(maskPortalOtpEmail(ordinary).code).toBe('482731');
  });
});
