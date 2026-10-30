// Separate tightly capped upload traffic from interactive API requests.
// Only the HTTP layer decides whether a chunk is authenticated and authorized.
export function createApiRateLimiter({
  clock = () => Date.now(),
  windowMs = 60_000,
  normalLimit = 240,
  uploadLimit = 720,
  maxBuckets = 10_000
} = {}) {
  const buckets = new Map();
  return (req, authorizedChunk = false) => {
    const now = clock();
    const peer = String(req.socket?.remoteAddress || 'unknown');
    const key = `${authorizedChunk ? 'chunk' : 'general'}:${peer}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      if (bucket) buckets.delete(key);
      if (buckets.size >= maxBuckets) {
        for (const [id, entry] of buckets) {
          if (entry.expiresAt <= now) buckets.delete(id);
        }
        if (buckets.size >= maxBuckets) return false;
      }
      bucket = { count: 0, expiresAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    return bucket.count <= (authorizedChunk ? uploadLimit : normalLimit);
  };
}
