import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = require('../../apuana/dashboard/static/scripts/features/code-workspace-core.js');

test('normalizes Monaco languages and unknown values safely', () => {
  assert.equal(core.monacoLanguage('py'), 'python');
  assert.equal(core.monacoLanguage('YML'), 'yaml');
  assert.equal(core.monacoLanguage('not-a-language'), 'plaintext');
  assert.equal(core.monacoLanguage(null), 'plaintext');
});

test('uses fitted terminal dimensions and clamps unsafe values', () => {
  assert.deepEqual(core.terminalDimensions({cols: 132, rows: 41}, null), {cols: 132, rows: 41});
  assert.deepEqual(core.terminalDimensions({cols: 999, rows: 2}, null), {cols: 240, rows: 10});
});

test('falls back to the current or default terminal size', () => {
  assert.deepEqual(core.terminalDimensions(null, {cols: 100, rows: 30}), {cols: 100, rows: 30});
  assert.deepEqual(core.terminalDimensions(null, null), {cols: 120, rows: 28});
});

test('derives explorer paths without prefix collisions', () => {
  assert.equal(core.relativeEntryPath('/work/project/src/a.py', '/work/project'), 'src/a.py');
  assert.equal(core.relativeEntryPath('/work/project', '/work/project/'), '');
  assert.equal(core.relativeEntryPath('/work/project-two/a.py', '/work/project'), '/work/project-two/a.py');
});

test('detects image paths supported by remote preview', () => {
  assert.equal(core.isImagePath('/home/CIN/gwam/results/mask.PNG'), true);
  assert.equal(core.isImagePath('figure.final.tiff'), true);
  assert.equal(core.isImagePath('/home/CIN/gwam/readme.md'), false);
  assert.equal(core.fileExtension('/tmp/a/b/example.JPG'), 'jpg');
});

test('starts a terminal only after the SSH session is validated', () => {
  assert.equal(core.terminalCanStart({loggedIn: true, validated: false, token: 'saved'}), false);
  assert.equal(core.terminalCanStart({loggedIn: true, validated: true, token: 'active'}), true);
  assert.equal(core.terminalCanStart({loggedIn: false, validated: true, token: 'active'}), false);
});

test('keeps cluster data gated until the full SLURM snapshot arrives', () => {
  assert.equal(core.authenticatedShellReady({user: 'gwam', node: 'slurm-client2.cin.ufpe.br'}), true);
  assert.equal(core.clusterSnapshotReady({user: 'gwam', node: 'slurm-client2.cin.ufpe.br'}), false);
  assert.equal(core.clusterSnapshotReady({
    ts: '2026-08-18 15:43:00',
    queue: {ok: true},
    sinfo: {ok: true},
    resources: {ok: true},
  }), true);
});
