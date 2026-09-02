import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/basic-languages/monaco.contribution.js';
import 'monaco-editor/language/json/monaco.contribution.js';

window.MonacoEnvironment = {
  getWorkerUrl(_moduleId, label) {
    return label === 'json'
      ? '/static/vendor/generated/monaco-json-worker.js'
      : '/static/vendor/generated/monaco-worker.js';
  },
};
window.monaco = monaco;
