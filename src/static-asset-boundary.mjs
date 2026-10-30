import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// A public request must never resolve to backend source, dotfiles, source maps,
// configuration, or anything outside the explicitly approved asset root.
export async function resolveStaticAsset(assetRoot, requested) {
  if (typeof requested !== 'string' || !requested ||
      requested.includes('\\') || requested.includes('\0') || requested.startsWith('/')) return null;
  const segments = requested.split('/');
  if (segments.some(segment => !segment || segment.startsWith('.')) ||
      requested.toLowerCase().endsWith('.map')) return null;

  let canonicalRoot;
  let canonicalFile;
  try {
    canonicalRoot = await realpath(resolve(assetRoot));
    canonicalFile = await realpath(resolve(assetRoot, requested));
    if (canonicalFile === canonicalRoot || !canonicalFile.startsWith(`${canonicalRoot}${sep}`)) return null;
    if (!(await stat(canonicalFile)).isFile()) return null;
  } catch (error) {
    if (['ENOENT', 'EACCES', 'ELOOP', 'ENOTDIR'].includes(error?.code)) return null;
    throw error;
  }
  return canonicalFile;
}
