import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPublicKey, verify as verifySignature } from 'node:crypto';

const receiptFile = resolve(process.env.LIGHTNAS_LICENSE_RECEIPT || '/var/lib/lightnas/license-receipt.json');
const licenseServer = String(process.env.LIGHTNAS_LICENSE_SERVER_URL || '').trim();
const publicKeyPem = String(process.env.LIGHTNAS_LICENSE_PUBLIC_KEY_PEM || '').trim();
const publicKeyFile = String(process.env.LIGHTNAS_LICENSE_PUBLIC_KEY_FILE || '/etc/lightnas/license-public.pem').trim();

function validReceiptPayload(payload, instanceId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (String(payload.instanceId || '') !== String(instanceId || '')) return false;
  if (!['community', 'pro', 'enterprise'].includes(String(payload.edition || ''))) return false;
  if (payload.expiresAt && !Number.isFinite(Date.parse(payload.expiresAt))) return false;
  return true;
}

async function configuredPublicKey() {
  if (publicKeyPem) return publicKeyPem;
  try { return (await readFile(publicKeyFile, 'utf8')).trim(); } catch { return ''; }
}


/**
 * Persist and recheck the original signed bytes, not decoded JSON. Otherwise
 * a modified receipt can grant paid privileges after restart without proof
 * that the license server signed those privileges.
 * Legacy unsigned receipts fail closed and require reactivation.
 */
function signedReceiptPayload(receipt, instanceId, verificationKey) {
  if (!verificationKey || typeof receipt?.payload !== 'string' || typeof receipt.signature !== 'string') {
    throw new Error('A signed license receipt and verification key are required.');
  }
  const encodedPayload = receipt.payload;
  const encodedSignature = receipt.signature;
  if (!encodedPayload || encodedPayload.length > 65536 || !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
      !encodedSignature || encodedSignature.length > 128 || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
    throw new Error('Invalid license receipt encoding.');
  }
  const payloadBytes = Buffer.from(encodedPayload, 'base64url');
  const signature = Buffer.from(encodedSignature, 'base64url');
  if (payloadBytes.toString('base64url') !== encodedPayload || signature.toString('base64url') !== encodedSignature || signature.length !== 64) {
    throw new Error('Invalid license receipt encoding.');
  }
  const key = createPublicKey(verificationKey);
  if (key.asymmetricKeyType !== 'ed25519' || !verifySignature(null, payloadBytes, key, signature)) {
    throw new Error('The license signature could not be verified.');
  }
  let payload;
  try { payload = JSON.parse(payloadBytes.toString('utf8')); }
  catch { throw new Error('The license server returned an invalid payload.'); }
  if (!validReceiptPayload(payload, instanceId)) {
    throw new Error('The license response does not match this LightNAS appliance.');
  }
  if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) {
    throw new Error('The license has expired.');
  }
  return payload;
}

export async function licenseStatus({ instanceId, version }) {
  const verificationKey = await configuredPublicKey();
  let payload = null;
  try {
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    payload = signedReceiptPayload(receipt, instanceId, verificationKey);
  } catch {
    // Missing, legacy unsigned, malformed, expired or tampered receipts
    // are never evidence of production entitlement.
  }
  const edition = payload ? payload.edition : 'community';
  const paidProduction = Boolean(payload && ['pro', 'enterprise'].includes(edition));
  return {
    edition,
    verified: Boolean(payload),
    expiresAt: payload?.expiresAt || null,
    features: payload && payload.features && typeof payload.features === 'object' ? payload.features : {},
    serverConfigured: Boolean(licenseServer && verificationKey),
    instanceId,
    version,
    licenseName: 'LightNAS Development and Community Evaluation License',
    developmentOnly: !paidProduction,
    productionAllowed: paidProduction,
    enterpriseUseAllowed: edition === 'enterprise' && Boolean(payload),
    communityUse: edition === 'community' && !paidProduction
  };
}

export async function verifyLicense({ licenseKey, instanceId, version }) {
  const verificationKey = await configuredPublicKey();
  if (!licenseServer || !verificationKey) {
    throw Object.assign(new Error('The LightNAS license server is not configured yet.'), { status: 409 });
  }
  if (!/^https:\/\//i.test(licenseServer)) {
    throw Object.assign(new Error('The LightNAS license server must use HTTPS.'), { status: 500 });
  }
  const key = String(licenseKey || '').trim();
  if (key.length < 8 || key.length > 512) {
    throw Object.assign(new Error('Enter a valid license key.'), { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(licenseServer, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': `LightNAS/${version}` },
      body: JSON.stringify({ licenseKey: key, instanceId, version })
    });
  } finally { clearTimeout(timer); }
  if (!response.ok) throw Object.assign(new Error(`License verification failed with HTTP ${response.status}.`), { status: 409 });

  const body = await response.json();
  const receipt = { payload: body?.payload, signature: body?.signature };
  try { signedReceiptPayload(receipt, instanceId, verificationKey); }
  catch (error) { throw Object.assign(error, { status: 409 }); }

  await mkdir(dirname(receiptFile), { recursive: true, mode: 0o700 });
  await writeFile(receiptFile, JSON.stringify({ ...receipt, verifiedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return await licenseStatus({ instanceId, version });
}
