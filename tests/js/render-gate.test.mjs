import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const CodeWorkspaceCore = require('../../apuana/dashboard/static/scripts/features/code-workspace-core.js');

function createRenderHarness() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        textContent: '',
        innerHTML: '',
        classList: {
          add() {},
          remove() {},
          toggle() {},
        },
        querySelector() {
          return null;
        },
      });
    }
    return elements.get(id);
  };
  const calls = {
    hideInitialLoader: 0,
    renderKpis: 0,
    renderView: 0,
    showInitialLoader: 0,
    syncTransferMeta: 0,
  };
  const context = {
    CodeWorkspaceCore,
    MAX_HIST: 48,
    _last: {},
    clusterBootNoticeShown: false,
    clusterDataReady: false,
    document: {
      body: {
        dataset: {},
      },
      querySelector(selector) {
        if (selector === '.view.active') return {id: 'view-overview'};
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    esc(value) {
      return String(value ?? '');
    },
    hist: {run: [], pnd: [], total: [], cpuRun: [], cpuPending: [], requestedRam: [], loginRam: [], load1: [], load5: [], load15: [], gpus: []},
    hideInitialLoader() {
      calls.hideInitialLoader += 1;
      context.waitingForFirstData = false;
    },
    hideVpnModal() {},
    performanceChartMode: 'hardware',
    renderLineChart() {},
    renderQueuePerformance() {},
    renderResources() {},
    renderSparkline() {
      return '';
    },
    renderUserSettings() {},
    showInitialLoader() {
      calls.showInitialLoader += 1;
      context.waitingForFirstData = true;
    },
    syncTransferMeta() {
      calls.syncTransferMeta += 1;
    },
    waitingForFirstData: true,
    $: element,
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apuana/dashboard/static/scripts/features/render.js', 'utf8'), context);
  context.renderKpis = () => {
    calls.renderKpis += 1;
  };
  context.renderView = () => {
    calls.renderView += 1;
  };
  return {calls, context, element};
}

test('keeps the initial loader visible until a full SLURM snapshot is available', () => {
  const {calls, context, element} = createRenderHarness();

  context.render({
    user: 'gwam',
    node: 'slurm-client2.cin.ufpe.br',
    queue: {ok: true},
    sinfo: {ok: false, error: 'sinfo ainda carregando'},
    resources: {ok: true},
  });

  assert.equal(calls.showInitialLoader, 1);
  assert.equal(calls.hideInitialLoader, 0);
  assert.equal(calls.renderKpis, 0);
  assert.equal(calls.renderView, 0);
  assert.equal(context.clusterDataReady, false);
  assert.match(element('chip-node').textContent, /carregando dados SLURM/);
});

test('renders the dashboard only after queue, sinfo and resources are ready', () => {
  const {calls, context, element} = createRenderHarness();

  context.render({
    user: 'gwam',
    node: 'slurm-client2.cin.ufpe.br',
    ts: '2026-08-18 16:55:00',
    queue: {ok: true, rows: []},
    sinfo: {ok: true, rows: []},
    resources: {ok: true},
  });

  assert.equal(calls.showInitialLoader, 0);
  assert.equal(calls.hideInitialLoader, 1);
  assert.equal(calls.renderKpis, 1);
  assert.equal(calls.renderView, 1);
  assert.equal(context.clusterDataReady, true);
  assert.equal(element('chip-node').textContent, 'slurm-client2.cin.ufpe.br - 2026-08-18 16:55:00');
});
