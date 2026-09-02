import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function loadRemoteExplorerContext() {
  const context = {
    closeRemoteTileMenus() {},
    document: {
      querySelectorAll() {
        return [];
      },
    },
    findRemoteExplorerItem() {
      return null;
    },
    isRemoteImageItem() {
      return false;
    },
    remoteExplorerCache: new Map(),
    remoteExplorerState: {items: [], dragPath: '', path: '/home/CIN/gwam', period: 'all'},
    transferState: {home: '/home/CIN/gwam'},
    uploadTasks: [],
    $() {
      return null;
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apuana/dashboard/static/scripts/features/remote-explorer.js', 'utf8'), context);
  return context;
}

test('remote drag/drop rejects self and descendant folder targets', () => {
  const context = loadRemoteExplorerContext();

  assert.equal(
    context.canDropRemoteItem('/home/CIN/gwam/project', '/home/CIN/gwam/project'),
    false,
  );
  assert.equal(
    context.canDropRemoteItem('/home/CIN/gwam/project', '/home/CIN/gwam/project/nested'),
    false,
  );
});

test('remote drag/drop accepts moving an item into another folder', () => {
  const context = loadRemoteExplorerContext();

  assert.equal(
    context.canDropRemoteItem('/home/CIN/gwam/file.txt', '/home/CIN/gwam/research'),
    true,
  );
  assert.equal(context.parentRemotePath('/home/CIN/gwam/file.txt'), '/home/CIN/gwam');
});
