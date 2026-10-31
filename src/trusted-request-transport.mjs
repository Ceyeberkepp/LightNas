import {isIP} from 'node:net';

// X-Forwarded-Proto is supplied by clients unless a specific trusted reverse
// proxy is configured. Never use it to mark a session cookie Secure by default.
function normalizeIp(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4) return raw.slice(7);
  return isIP(raw) ? raw.toLowerCase() : '';
}

export function requestUsesHttps(req, trustedProxyIps = '') {
  if (req?.socket?.encrypted === true) return true;
  const peer = normalizeIp(req?.socket?.remoteAddress);
  const allowed = String(trustedProxyIps || '').split(',').map(normalizeIp).filter(Boolean);
  if (!peer || !allowed.includes(peer)) return false;
  const forwarded = req?.headers?.['x-forwarded-proto'];
  // Disallow multi-valued proxy chains and incorrect protocol schemes.
  return typeof forwarded === 'string' && forwarded.trim().toLowerCase() === 'https';
}
