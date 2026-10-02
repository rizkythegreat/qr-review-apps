export function number(value: number) {
  return new Intl.NumberFormat('id-ID').format(value);
}
export function dateTime(value: string | null | undefined) {
  if (!value) return 'Belum ada';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
export function date(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value));
}
export function parsePublicToken(input: string) {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{22}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return /^\/r\/([A-Za-z0-9_-]{22})\/?$/.exec(url.pathname)?.[1] || null;
  } catch {
    return null;
  }
}
export function normalizeActivationCode(value: string) {
  return value.replace(/[\s-]/g, '').toUpperCase();
}
export function supportedReviewUrl(value: string) {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\%#]/u.test(value)) return false;
  const match = /^https:\/\/(g\.page|search\.google\.com)(?::443)?(\/[^?#]*)(\?[^#]*)?$/i.exec(
    value,
  );
  if (!match) return false;
  const host = match[1].toLowerCase();
  return host === 'g.page'
    ? /^\/r\/[A-Za-z0-9_-]{1,200}\/review$/.test(match[2]) && !match[3]
    : match[2] === '/local/writereview' && /^\?placeid=[A-Za-z0-9_-]{1,255}$/.test(match[3] || '');
}
