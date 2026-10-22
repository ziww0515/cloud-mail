const PORTAL_SENDER = 'service@ziww.cc.cd';
const PORTAL_SUBJECTS = new Set([
  'Ziww 登录验证码 · 大陆站',
  'Ziww 登录验证码 · 全球站'
]);
const PORTAL_SEND_TYPE = 1;
const CHALLENGE_MARKER = /^[0-9a-f]{64}$/i;

export function isPortalOtpEmail(row) {
  return Boolean(row)
    && typeof row.sendEmail === 'string'
    && row.sendEmail.toLowerCase() === PORTAL_SENDER
    && row.type === PORTAL_SEND_TYPE
    && PORTAL_SUBJECTS.has(row.subject)
    && (row.messageId === undefined || (typeof row.messageId === 'string' && CHALLENGE_MARKER.test(row.messageId)));
}

// Match only a labelled six-digit OTP; IP octets and unrelated numeric text are untouched.
const OTP_PATTERN = /(验证码|verification\s+code|one[- ]time(?:\s+password)?|otp|test\s+code)(\s*(?:是|为|[:：])?\s*)\d{6}\b/giu;

export function maskPortalOtpText(value) {
  return typeof value === 'string'
    ? value.replace(OTP_PATTERN, '$1$2[已隐藏]')
    : value;
}

export function maskPortalOtpEmail(row) {
  if (!isPortalOtpEmail(row)) return row;
  return {
    ...row,
    // The code-copy affordance must not expose a value hidden from the body.
    code: '',
    text: maskPortalOtpText(row.text),
    content: maskPortalOtpText(row.content)
  };
}

export function maskPortalOtpList(list) {
  return list.map(maskPortalOtpEmail);
}
