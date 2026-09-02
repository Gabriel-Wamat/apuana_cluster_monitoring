import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

class FakeImage {
  constructor() {
    this.dataset = {};
    this.hidden = true;
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this._src = '';
    this.onload = null;
    this.onerror = null;
  }

  set src(value) {
    this._src = value;
    this.complete = true;
    this.naturalWidth = 4032;
    this.naturalHeight = 3024;
    if (this.onload) this.onload();
  }

  get src() {
    return this._src;
  }

  removeAttribute(name) {
    if (name === 'src') {
      this._src = '';
      this.complete = false;
    }
  }
}

function loadImagePreviewContext() {
  let fetchCount = 0;
  let objectUrlCount = 0;
  const context = {
    window: {CodeWorkspaceCore: {isImagePath: value => /\.(png|jpe?g)$/i.test(String(value || ''))}},
    $() {
      return null;
    },
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout,
    URL: {
      createObjectURL() {
        objectUrlCount += 1;
        return `blob:remote-image-${objectUrlCount}`;
      },
      revokeObjectURL() {},
    },
    apiFetch: async () => {
      fetchCount += 1;
      return {
        ok: true,
        headers: {get: () => 'image/jpeg'},
        blob: async () => ({size: 3121163, type: 'image/jpeg'}),
      };
    },
    getFetchCount() {
      return fetchCount;
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apuana/dashboard/static/scripts/features/image-preview.js', 'utf8'), context);
  return context;
}

test('remote image preview reuses cached blob for same path and revision', async () => {
  const context = loadImagePreviewContext();
  const first = new FakeImage();
  const second = new FakeImage();
  const firstStatus = {};
  const secondStatus = {};

  await context.loadRemoteImageElement(first, '/home/CIN/gwam/lixeiro-1.jpg', firstStatus, {revision: '3121163-1'});
  await context.loadRemoteImageElement(second, '/home/CIN/gwam/lixeiro-1.jpg', secondStatus, {revision: '3121163-1'});

  assert.equal(context.getFetchCount(), 1);
  assert.equal(first.src, 'blob:remote-image-1');
  assert.equal(second.src, 'blob:remote-image-1');
  assert.equal(second.hidden, false);
  assert.equal(secondStatus.textContent, '4032 × 3024 px');
});

test('remote image preview fetches again when revision changes', async () => {
  const context = loadImagePreviewContext();

  await context.loadRemoteImageElement(new FakeImage(), '/home/CIN/gwam/lixeiro-1.jpg', {}, {revision: 'old'});
  await context.loadRemoteImageElement(new FakeImage(), '/home/CIN/gwam/lixeiro-1.jpg', {}, {revision: 'new'});

  assert.equal(context.getFetchCount(), 2);
});
