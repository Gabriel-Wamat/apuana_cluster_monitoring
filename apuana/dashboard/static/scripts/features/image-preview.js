const remoteImagePreviewState = {
  path: '',
  objectUrl: '',
};
const REMOTE_IMAGE_CACHE_MAX_ITEMS = 24;
const REMOTE_IMAGE_CACHE_MAX_BYTES = 160 * 1024 * 1024;
const remoteImageObjectUrlCache = new Map();
let remoteImageObjectUrlCacheBytes = 0;

function isRemoteImagePath(path) {
  return !!window.CodeWorkspaceCore?.isImagePath?.(path);
}

function isRemoteImageItem(item) {
  return !!(item?.kind === 'image' || isRemoteImagePath(item?.path || item?.name || ''));
}

async function parseRemoteImageError(response) {
  try {
    const payload = await response.json();
    return payload?.error || 'Could not load image preview.';
  } catch (_) {
    return 'Could not load image preview.';
  }
}

function revokeRemoteImageObjectUrl(url) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch (_) {
    // Object URLs are best-effort cleanup only.
  }
}

function remoteImageCacheKey(path, meta = {}) {
  const revision = meta?.revision || meta?.mtime_epoch || meta?.mtimeEpoch || meta?.size || meta?.size_human || '';
  return `${String(path || '')}::${String(revision || '')}`;
}

function deleteRemoteImageCacheEntry(key) {
  const entry = remoteImageObjectUrlCache.get(key);
  if (!entry) return;
  remoteImageObjectUrlCache.delete(key);
  if (entry.objectUrl) revokeRemoteImageObjectUrl(entry.objectUrl);
  remoteImageObjectUrlCacheBytes = Math.max(0, remoteImageObjectUrlCacheBytes - (entry.size || 0));
}

function trimRemoteImageObjectUrlCache() {
  while (
    remoteImageObjectUrlCache.size > REMOTE_IMAGE_CACHE_MAX_ITEMS
    || remoteImageObjectUrlCacheBytes > REMOTE_IMAGE_CACHE_MAX_BYTES
  ) {
    const entries = [...remoteImageObjectUrlCache.entries()]
      .filter(([, entry]) => !entry.promise)
      .sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0));
    if (!entries.length) break;
    deleteRemoteImageCacheEntry(entries[0][0]);
  }
}

function clearRemoteImageCache(path = '') {
  const target = String(path || '');
  for (const [key, entry] of [...remoteImageObjectUrlCache.entries()]) {
    if (!target || entry.path === target || key.startsWith(`${target}::`)) deleteRemoteImageCacheEntry(key);
  }
}

async function fetchRemoteImageObjectUrl(path, meta = {}) {
  const key = remoteImageCacheKey(path, meta);
  const cached = remoteImageObjectUrlCache.get(key);
  if (cached?.objectUrl) {
    cached.lastUsed = Date.now();
    return {...cached, cacheKey: key, cached: true};
  }
  if (cached?.promise) {
    const pending = await cached.promise;
    return {...pending, cacheKey: key, cached: true};
  }

  const promise = (async () => {
    const created = await createRemoteImageObjectUrl(path);
    const entry = {
      path,
      objectUrl: created.objectUrl,
      size: created.size || 0,
      contentType: created.contentType || '',
      width: 0,
      height: 0,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };
    remoteImageObjectUrlCache.set(key, entry);
    remoteImageObjectUrlCacheBytes += entry.size;
    trimRemoteImageObjectUrlCache();
    return entry;
  })();

  remoteImageObjectUrlCache.set(key, {path, promise, size: 0, createdAt: Date.now(), lastUsed: Date.now()});
  try {
    const entry = await promise;
    return {...entry, cacheKey: key, cached: false};
  } catch (err) {
    remoteImageObjectUrlCache.delete(key);
    throw err;
  }
}

async function createRemoteImageObjectUrl(path) {
  const response = await apiFetch('/api/preview/image?path=' + encodeURIComponent(path || ''));
  if (!response.ok) throw new Error(await parseRemoteImageError(response));
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  return {
    objectUrl,
    size: blob.size || 0,
    contentType: blob.type || response.headers?.get?.('Content-Type') || '',
  };
}

function rememberRemoteImageDimensions(cacheKey, image) {
  const entry = remoteImageObjectUrlCache.get(cacheKey);
  if (!entry || entry.promise) return;
  entry.width = image.naturalWidth || entry.width || 0;
  entry.height = image.naturalHeight || entry.height || 0;
  entry.lastUsed = Date.now();
}

function showRemoteImageLoaded(image, status, entry, cacheKey) {
  image.hidden = false;
  rememberRemoteImageDimensions(cacheKey, image);
  const cached = remoteImageObjectUrlCache.get(cacheKey) || entry;
  const width = image.naturalWidth || cached.width || '?';
  const height = image.naturalHeight || cached.height || '?';
  if (status) {
    status.className = 'remote-image-status ok';
    status.textContent = `${width} × ${height} px`;
  }
}

async function loadRemoteImageElement(image, path, status = null, meta = {}) {
  if (!image || !path) return;
  const requestId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  image.dataset.remoteImageRequestId = requestId;
  const nextCacheKey = remoteImageCacheKey(path, meta);
  const cached = remoteImageObjectUrlCache.get(nextCacheKey);
  image.dataset.objectUrl = '';
  image.dataset.remoteImageCacheKey = '';
  image.removeAttribute('src');
  image.hidden = true;
  if (status && cached?.objectUrl && (cached.width || cached.height)) {
    status.className = 'remote-image-status ok';
    status.textContent = `${cached.width || '?'} × ${cached.height || '?'} px`;
  } else if (status) {
    status.className = 'remote-image-status loading';
    status.textContent = 'Loading image from Apuana...';
  }
  try {
    const entry = await fetchRemoteImageObjectUrl(path, meta);
    if (image.dataset.remoteImageRequestId !== requestId) return;
    image.dataset.objectUrl = entry.objectUrl;
    image.dataset.remoteImageCacheKey = entry.cacheKey;
    image.onload = () => {
      showRemoteImageLoaded(image, status, entry, entry.cacheKey);
    };
    image.onerror = () => {
      image.hidden = true;
      image.dataset.objectUrl = '';
      image.dataset.remoteImageCacheKey = '';
      if (status) {
        status.className = 'remote-image-status error';
        status.textContent = 'Could not render this image in the browser.';
      }
    };
    image.src = entry.objectUrl;
    if (entry.cached && (entry.width || entry.height)) {
      image.hidden = false;
      if (status) {
        status.className = 'remote-image-status ok';
        status.textContent = `${entry.width || '?'} × ${entry.height || '?'} px`;
      }
    }
    const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : callback => setTimeout(callback, 0);
    schedule(() => {
      if (image.dataset.remoteImageRequestId === requestId && image.complete && image.src === entry.objectUrl) {
        showRemoteImageLoaded(image, status, entry, entry.cacheKey);
      }
    });
  } catch (err) {
    if (image.dataset.remoteImageRequestId !== requestId) return;
    image.hidden = true;
    if (status) {
      status.className = 'remote-image-status error';
      status.textContent = err?.message || 'Could not load image preview.';
    }
  }
}

function openRemoteImagePreview(path, meta = {}) {
  if (!path) return;
  const modal = $('remote-image-modal');
  const image = $('remote-image-content');
  const title = $('remote-image-title');
  const remotePath = $('remote-image-path');
  const status = $('remote-image-status');
  const size = meta?.size_human || meta?.sizeHuman || '';
  if (!modal || !image) return;

  remoteImagePreviewState.path = path;
  remoteImagePreviewState.objectUrl = '';
  if (title) title.textContent = meta?.name || path.split('/').filter(Boolean).pop() || 'Image preview';
  if (remotePath) remotePath.textContent = size ? `${path} · ${size}` : path;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  loadRemoteImageElement(image, path, status, meta).then(() => {
    remoteImagePreviewState.objectUrl = image.dataset.objectUrl || '';
  });
}

function closeRemoteImagePreview() {
  const modal = $('remote-image-modal');
  const image = $('remote-image-content');
  if (image) {
    image.dataset.objectUrl = '';
    image.dataset.remoteImageCacheKey = '';
    image.removeAttribute('src');
    image.hidden = true;
  }
  remoteImagePreviewState.path = '';
  remoteImagePreviewState.objectUrl = '';
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}
