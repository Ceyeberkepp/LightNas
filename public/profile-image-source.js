// Profile previews accept only our avatar endpoint or a local object URL.
// Do not reuse this function for iframe/object/script elements.
export function setProfileImageSource(image, source) {
  if (!(image instanceof HTMLImageElement)) throw new TypeError('Profile preview must be an image');
  const url = new URL(source, window.location.origin);
  const local = url.origin === window.location.origin && !url.username && !url.password;
  const avatar = local && url.protocol === window.location.protocol && url.pathname === '/api/profile/avatar';
  const objectUrl = local && url.protocol === 'blob:';
  if (!avatar && !objectUrl) throw new TypeError('Unsupported profile image source');
  image.src = url.href;
}
