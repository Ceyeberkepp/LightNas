import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { arch, platform } from 'node:process';

const MAX_MANIFEST_BYTES = 65536;
const VALID_TIERS = new Set(['community', 'premium', 'enterprise']);
const VALID_CHANNELS = new Set(['stable', 'beta']);

function configError(message) {
  return { updateAvailable: false, updateEnabled: false, checkStatus: 'not_configured', message };
}

export async function checkSignedUpdates({ currentVersion, edition = 'community', channel = 'stable' }) {
  const endpoint = String(process.env.LIGHTNAS_UPDATE_MANIFEST_URL || '').trim();
  const keyPath = String(process.env.LIGHTNAS_UPDATE_PUBLIC_KEY_FILE || '').trim();
  if (!endpoint || !keyPath) return configError('Signed HTTPS update repository is not configured.');
  let url;
  try { url = new URL(endpoint); } catch { return configError('Invalid update repository URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname) {
    return configError('Update repository must use an HTTPS URL without credentials or query parameters.');
  }
  const tier = VALID_TIERS.has(edition) ? edition : 'community';
  const selectedChannel = VALID_CHANNELS.has(channel) ? channel : 'stable';
  const requestUrl = new URL(url);
  requestUrl.searchParams.set('tier', tier);
  requestUrl.searchParams.set('channel', selectedChannel);
  requestUrl.searchParams.set('arch', arch);
  requestUrl.searchParams.set('platform', platform);
  let response;
  try {
    response = await fetch(requestUrl, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES) throw new Error('Manifest exceeds size limit.');
    const envelope = JSON.parse(body);
    if (!envelope || !envelope.payload || typeof envelope.signature !== 'string') throw new Error('Missing signed manifest.');
    const pem = await readFile(keyPath, 'utf8');
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Update signing key must be Ed25519.');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature)) throw new Error('Invalid signature encoding.');
    const signature = Buffer.from(envelope.signature, 'base64');
    if (signature.length !== 64 || !verify(null, Buffer.from(JSON.stringify(envelope.payload)), key, signature)) throw new Error('Manifest signature invalid.');
    const p = envelope.payload;
    if (p.product !== 'lightnas-nas' || p.tier !== tier || p.channel !== selectedChannel || p.arch !== arch || p.platform !== platform) throw new Error('Manifest does not match device or edition.');
    if (!Number.isFinite(Date.parse(p.expiresAt)) || Date.parse(p.expiresAt) <= Date.now()) throw new Error('Update metadata expired.');
    if (!/^\\d+\\.\\d+\\.\\d+$/.test(String(p.version || ''))) throw new Error('Invalid release version.');
    const comparable = v => v.split('.').map(Number);
    const a = comparable(p.version);
    const b = /^\\d+\\.\\d+\\.\\d+$/.test(String(currentVersion)) ? comparable(String(currentVersion)) : null;
    if (!b) throw new Error('Installed version cannot be compared safely.');
    const newer = a.findIndex((v, i) => v !== b[i]);
    const available = newer >= 0 && a[newer] > b[newer];
    return {
      checkStatus: 'verified', version: currentVersion, latestVersion: p.version,
      updateAvailable: available, updateEnabled: false,
      message: available
        ? 'Signed update available. Installation is locked until the verified package staging and rollback service is ready.'
        : 'No newer signed NAS release available.',
      repository: url.origin, channel: selectedChannel, tier,
    };
  } catch (error) {
    return { updateAvailable: false, updateEnabled: false, checkStatus: 'error',
      message: 'Secure update verification failed: ' + error.message };
  }
}
