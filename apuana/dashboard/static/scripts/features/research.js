function researchSetStatus(message, tone = '') {
  const el = $('research-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = tone ? `research-status-${tone}` : '';
}

function researchTemplateById(id) {
  return (researchState.templates || []).find(item => item.id === id) || null;
}

function researchJsString(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c');
}

function researchFieldValue(field) {
  if (field.default !== undefined && field.default !== null) return String(field.default);
  if (field.type === 'select' && Array.isArray(field.options) && field.options.length) return String(field.options[0]);
  return '';
}

function researchPathFieldMode(field) {
  if (field.type === 'path') return 'path';
  return field.name === 'project' ? 'project' : '';
}

function researchSplitPathInput(value) {
  const raw = String(value || '').trim();
  const home = String(transferState.home || '').replace(/\/+$/, '');
  if (!raw) return {path: home || '~', query: ''};
  if (raw === '~' || raw === '~/') return {path: '~', query: ''};
  if (raw.endsWith('/')) return {path: raw, query: ''};
  if (raw.startsWith('~/')) {
    const idx = raw.lastIndexOf('/');
    return {path: raw.slice(0, idx + 1) || '~/', query: raw.slice(idx + 1)};
  }
  if (!raw.startsWith('/')) return {path: home || '~', query: raw};
  const idx = raw.lastIndexOf('/');
  return {
    path: idx <= 0 ? '/' : raw.slice(0, idx),
    query: raw.slice(idx + 1),
  };
}

function researchHidePathSuggestions() {
  if (researchPathSuggestTimer) {
    clearTimeout(researchPathSuggestTimer);
    researchPathSuggestTimer = null;
  }
  lastResearchPathSuggestKey = '';
  document.querySelectorAll('.research-path-suggestions').forEach(box => {
    box.classList.add('hidden');
    box.innerHTML = '';
  });
}

function researchHideOtherPathSuggestions(input) {
  document.querySelectorAll('.research-path-suggestions').forEach(box => {
    if (box === input.closest('.research-path-control')?.querySelector('.research-path-suggestions')) return;
    box.classList.add('hidden');
    box.innerHTML = '';
  });
}

function researchFolderName(path) {
  const clean = String(path || '').replace(/\/+$/, '');
  if (!clean || clean === '~') return clean || '';
  return clean.split('/').filter(Boolean).pop() || clean;
}

function researchApplyPathSuggestion(input, path) {
  const mode = input.getAttribute('data-research-path-mode') || 'path';
  const value = mode === 'project' ? researchFolderName(path) : trailingSlash(path);
  input.value = value;
  if (mode === 'project') {
    const workDir = document.querySelector('[data-research-param="work_dir"]');
    const currentWorkDir = String(workDir?.value || '').trim();
    if (workDir && (!currentWorkDir || currentWorkDir === '~')) workDir.value = trailingSlash(path);
  }
  researchHidePathSuggestions();
  input.focus();
}

function researchRenderPathSuggestions(input, data) {
  const box = input.closest('.research-path-control')?.querySelector('.research-path-suggestions');
  if (!box) return;
  if (!data.ok) {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="research-path-empty">${esc(data.error || 'Não foi possível listar este caminho.')}</div>`;
    return;
  }
  const dirs = (data.items || []).filter(item => item.is_dir).slice(0, 14);
  box.classList.remove('hidden');
  if (!dirs.length) {
    box.innerHTML = '<div class="research-path-empty">Nenhum diretório encontrado neste caminho.</div>';
    return;
  }
  box.innerHTML = dirs.map(item => `
    <button class="research-path-suggestion" type="button" data-path="${esc(item.path)}">
      ${transferSuggestionKindIcon('directory')}
      <span>${esc(item.path)}</span>
    </button>
  `).join('');
  box.querySelectorAll('button[data-path]').forEach(button => {
    button.addEventListener('click', () => researchApplyPathSuggestion(input, button.getAttribute('data-path') || ''));
  });
}

function researchRefreshPathSuggestions(input) {
  researchHideOtherPathSuggestions(input);
  const typed = input.value || '';
  const {path, query} = researchSplitPathInput(typed);
  const key = `${input.getAttribute('data-research-param') || ''}|${path}|${query}`;
  if (key === lastResearchPathSuggestKey) return;
  lastResearchPathSuggestKey = key;
  const seq = ++researchPathSuggestSeq;
  apiFetch('/api/fs?path=' + encodeURIComponent(path || '~') + '&query=' + encodeURIComponent(query || ''))
    .then(response => response.json())
    .then(data => {
      if (seq !== researchPathSuggestSeq) return;
      if (document.activeElement !== input) return;
      researchRenderPathSuggestions(input, data);
    })
    .catch(() => {
      if (seq !== researchPathSuggestSeq) return;
      researchRenderPathSuggestions(input, {ok: false, error: 'Não foi possível carregar diretórios.'});
    });
}

function researchSchedulePathSuggestions(input, delayMs = 220) {
  if (researchPathSuggestTimer) clearTimeout(researchPathSuggestTimer);
  researchPathSuggestTimer = setTimeout(() => {
    researchPathSuggestTimer = null;
    researchRefreshPathSuggestions(input);
  }, delayMs);
}

function researchBindPathInputs() {
  document.querySelectorAll('[data-research-path-input]').forEach(input => {
    input.addEventListener('focus', () => researchSchedulePathSuggestions(input, 0));
    input.addEventListener('input', () => researchSchedulePathSuggestions(input));
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') researchHidePathSuggestions();
      if (ev.key !== 'Enter') return;
      const first = input.closest('.research-path-control')?.querySelector('.research-path-suggestion[data-path]');
      if (!first) return;
      ev.preventDefault();
      researchApplyPathSuggestion(input, first.getAttribute('data-path') || '');
    });
  });
}

function researchLoadTemplates(force = false) {
  if (researchState.loaded && !force) return Promise.resolve(researchState.templates);
  researchState.loading = true;
  researchSetStatus('Carregando templates...');
  return apiFetch('/api/research/templates')
    .then(response => response.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || 'Falha ao carregar templates.');
      researchState.templates = data.templates || [];
      researchState.loaded = true;
      const select = $('research-template');
      if (select) {
        select.innerHTML = researchState.templates.map(template => `
          <option value="${esc(template.id)}">${esc(template.name || template.id)}</option>
        `).join('');
        if (!researchState.selectedTemplate && researchState.templates[0]) {
          researchState.selectedTemplate = researchState.templates[0].id;
        }
        select.value = researchState.selectedTemplate || '';
      }
      researchRenderTemplateFields();
      researchSetStatus(researchState.templates.length ? 'Templates prontos.' : 'Nenhum template encontrado.', researchState.templates.length ? '' : 'warn');
      return researchState.templates;
    })
    .catch(err => {
      researchSetStatus(err?.message || 'Falha ao carregar templates.', 'error');
      throw err;
    })
    .finally(() => {
      researchState.loading = false;
    });
}

function researchRenderTemplateFields() {
  const mount = $('research-template-fields');
  if (!mount) return;
  const templateId = $('research-template')?.value || researchState.selectedTemplate || '';
  researchState.selectedTemplate = templateId;
  const template = researchTemplateById(templateId);
  if (!template) {
    mount.innerHTML = '<div class="research-empty">Selecione um template.</div>';
    return;
  }
  const fields = template.fields || [];
  mount.innerHTML = `
    <div class="research-params-grid">
      ${fields.map(field => {
        const name = field.name || '';
        const value = researchFieldValue(field);
        const label = field.label || name;
        const required = field.required ? '<em>obrigatório</em>' : '';
        const pathMode = researchPathFieldMode(field);
        if (field.type === 'textarea') {
          const rows = name === 'command' || name === 'env_activation' ? 2 : 3;
          return `<label class="research-field research-field-wide research-field-textarea research-field-${esc(name)}">
            <span>${esc(label)} ${required}</span>
            <textarea data-research-param="${esc(name)}" rows="${rows}">${esc(value)}</textarea>
          </label>`;
        }
        if (field.type === 'select') {
          const options = (field.options || []).map(option => `
            <option value="${esc(option)}" ${String(option) === value ? 'selected' : ''}>${esc(option)}</option>
          `).join('');
          return `<label class="research-field">
            <span>${esc(label)} ${required}</span>
            <select data-research-param="${esc(name)}">${options}</select>
          </label>`;
        }
        if (pathMode) {
          return `<label class="research-field research-field-path">
            <span>${esc(label)} ${required}</span>
            <div class="research-path-control">
              <input data-research-param="${esc(name)}" data-research-path-input="1" data-research-path-mode="${esc(pathMode)}" type="text" value="${esc(value)}" autocomplete="off">
              <div class="research-path-suggestions hidden" data-research-path-menu="${esc(name)}"></div>
            </div>
          </label>`;
        }
        return `<label class="research-field ${field.type === 'path' ? 'research-field-path' : ''}">
          <span>${esc(label)} ${required}</span>
          <input data-research-param="${esc(name)}" type="text" value="${esc(value)}">
        </label>`;
      }).join('')}
    </div>
  `;
  researchBindPathInputs();
}

function researchOpenModal() {
  const modal = $('research-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  if (researchState.loaded) {
    researchRenderTemplateFields();
    researchSetStatus(researchState.templates.length ? 'Templates prontos.' : 'Nenhum template encontrado.', researchState.templates.length ? '' : 'warn');
    return;
  }
  researchLoadTemplates().catch(() => {});
}

function researchCloseModal() {
  const modal = $('research-modal');
  if (!modal) return;
  researchHidePathSuggestions();
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function researchCollectPayload() {
  const params = {};
  document.querySelectorAll('[data-research-param]').forEach(input => {
    params[input.getAttribute('data-research-param')] = input.value || '';
  });
  return {
    template: $('research-template')?.value || researchState.selectedTemplate || '',
    params,
    resources: {
      partition: $('research-slurm-partition')?.value || 'short-simple',
      cpus: Number($('research-slurm-cpus')?.value || 4),
      mem: $('research-slurm-mem')?.value || '16G',
      gpus: Number($('research-slurm-gpus')?.value || 0),
      time: $('research-slurm-time')?.value || '02:00:00',
      node: $('research-slurm-node')?.value || '',
      job_name: $('research-slurm-name')?.value || 'research',
    },
  };
}

function researchPreview() {
  const preview = $('research-preview');
  researchSetStatus('Gerando preview...');
  if (preview) preview.textContent = 'Gerando sbatch...';
  return apiFetch('/api/research/preview', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(researchCollectPayload()),
  })
    .then(response => response.json().then(data => ({response, data})))
    .then(({response, data}) => {
      if (!response.ok || !data.ok) throw new Error(data.error || 'Preview falhou.');
      researchState.preview = data.sbatch || '';
      if (preview) preview.textContent = researchState.preview || 'Sem conteúdo.';
      researchSetStatus(`Preview pronto: ${data.manifest?.run_id || ''}`);
      return data;
    })
    .catch(err => {
      if (preview) preview.textContent = err?.message || 'Preview falhou.';
      researchSetStatus(err?.message || 'Preview falhou.', 'error');
      throw err;
    });
}

function researchSubmit() {
  const payload = researchCollectPayload();
  const resources = payload.resources || {};
  const message = [
    'Submeter este experimento no SLURM?',
    '',
    `Partição: ${resources.partition || '-'}`,
    `Tempo: ${resources.time || '-'}`,
    `CPUs: ${resources.cpus || 0}`,
    `GPUs: ${resources.gpus || 0}`,
    `Memória: ${resources.mem || '-'}`,
  ].join('\n');
  if (!window.confirm(message)) {
    researchSetStatus('Submissão cancelada.');
    return Promise.resolve(null);
  }
  const submit = $('research-submit');
  if (submit) submit.disabled = true;
  researchSetStatus('Submetendo no SLURM...');
  return apiFetch('/api/research/submit', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  })
    .then(response => response.json().then(data => ({response, data})))
    .then(({response, data}) => {
      if (!response.ok || !data.ok) throw new Error(data.error || 'Submit falhou.');
      researchSetStatus(`Job ${data.job_id || '-'} submetido.`);
      researchCloseModal();
      if (data.job_id) {
        $('job-id-in').value = data.job_id;
        jobState.inspectedId = data.job_id;
        if (typeof fetchJob === 'function') fetchJob(data.job_id);
      }
      if (typeof window.poll === 'function') window.poll();
      return data;
    })
    .catch(err => {
      researchSetStatus(err?.message || 'Submit falhou.', 'error');
      throw err;
    })
    .finally(() => {
      if (submit) submit.disabled = false;
    });
}

function researchStatusLabel(payload) {
  const status = payload?.status?.status || payload?.manifest?.status || '';
  if (status) return status;
  const jobStateValue = payload?.job?.state || '';
  return jobStateValue || 'manifest';
}

function researchRenderJob(slot, payload) {
  const manifest = payload.manifest || {};
  const status = researchStatusLabel(payload);
  const runDir = manifest.run_dir || '';
  const outputDir = manifest.output_dir || '';
  slot.hidden = false;
  slot.innerHTML = `
    <div class="research-job-card">
      <div class="research-job-head">
        <div>
          <div class="research-job-kicker">Research run</div>
          <strong>${esc(manifest.project || 'research')} · ${esc(manifest.template_name || manifest.template || '')}</strong>
          <span>${esc(manifest.run_id || '')}</span>
        </div>
        <span class="research-job-state">${esc(status)}</span>
      </div>
      <div class="research-job-grid">
        ${jobField('Run dir', runDir, true)}
        ${jobField('Output', outputDir, true)}
        ${jobField('Created by', manifest.created_by || '-', true)}
        ${jobField('Created at', manifest.created_at || '-', true)}
      </div>
      <div class="research-job-actions">
        <button class="mini-btn btn-with-icon" type="button" onclick="researchShowMetrics(${researchJsString(manifest.slurm_job_id || payload.job_id || '')})">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 3 5-7"/></svg>
          <span>Métricas</span>
        </button>
        <button class="mini-btn btn-with-icon" type="button" onclick="researchShowArtifacts(${researchJsString(manifest.slurm_job_id || payload.job_id || '')})">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>
          <span>Artefatos</span>
        </button>
        <button class="mini-btn btn-with-icon" type="button" onclick="researchOpenFolder(${researchJsString(outputDir || runDir)})">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          <span>Abrir pasta</span>
        </button>
      </div>
      <div id="research-job-extra" class="research-job-extra"></div>
    </div>
  `;
}

function researchLoadForJob(jobId) {
  const slot = $('research-job-slot');
  if (!slot || !jobId) return;
  const seq = ++researchState.requestSeq;
  slot.hidden = true;
  slot.innerHTML = '';
  apiFetch('/api/research/job?id=' + encodeURIComponent(jobId))
    .then(response => response.json())
    .then(data => {
      if (seq !== researchState.requestSeq) return;
      if (!data.ok) {
        slot.hidden = true;
        slot.innerHTML = '';
        return;
      }
      data.job_id = jobId;
      researchRenderJob(slot, data);
    })
    .catch(() => {
      if (seq !== researchState.requestSeq) return;
      slot.hidden = true;
      slot.innerHTML = '';
    });
}

function researchShowMetrics(jobId) {
  const target = $('research-job-extra');
  if (!target || !jobId) return;
  target.innerHTML = '<div class="research-loading">Carregando métricas...</div>';
  apiFetch('/api/research/metrics?id=' + encodeURIComponent(jobId))
    .then(response => response.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || 'Sem métricas.');
      const metrics = data.metrics || {};
      const keys = Object.keys(metrics);
      target.innerHTML = keys.length
        ? `<pre class="code-block research-json">${esc(JSON.stringify(metrics, null, 2))}</pre>`
        : '<div class="research-empty">Nenhum metrics.json encontrado ainda.</div>';
    })
    .catch(err => {
      target.innerHTML = `<div class="alert a-danger">${esc(err?.message || 'Falha ao carregar métricas.')}</div>`;
    });
}

function researchShowArtifacts(jobId) {
  const target = $('research-job-extra');
  if (!target || !jobId) return;
  target.innerHTML = '<div class="research-loading">Carregando artefatos...</div>';
  apiFetch('/api/research/artifacts?id=' + encodeURIComponent(jobId))
    .then(response => response.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || 'Sem artefatos.');
      const items = data.items || [];
      if (!items.length) {
        target.innerHTML = '<div class="research-empty">Nenhum artefato encontrado ainda.</div>';
        return;
      }
      target.innerHTML = `<div class="research-artifacts">
        ${items.map(item => {
          const isImage = item.kind === 'image';
          const preview = isImage
            ? `<img src="/api/research/artifact-file?path=${encodeURIComponent(item.path)}" alt="${esc(item.name)}">`
            : '<span class="research-file-icon">#</span>';
          return `<button class="research-artifact" type="button" onclick="researchOpenFolder(${researchJsString(item.path)})">
            ${preview}
            <strong title="${esc(item.path)}">${esc(item.name)}</strong>
            <span>${esc(item.kind || 'file')}</span>
          </button>`;
        }).join('')}
      </div>`;
    })
    .catch(err => {
      target.innerHTML = `<div class="alert a-danger">${esc(err?.message || 'Falha ao carregar artefatos.')}</div>`;
    });
}

function researchOpenFolder(path) {
  const raw = String(path || '').trim();
  if (!raw) return;
  const folder = /\.[A-Za-z0-9]{1,8}$/.test(raw) ? raw.split('/').slice(0, -1).join('/') : raw;
  if (typeof setView === 'function') setView('transfer');
  if ($('remote-visual-path')) $('remote-visual-path').value = folder;
  if (typeof loadRemoteExplorer === 'function') loadRemoteExplorer(folder, undefined, {pushHistory: true, force: true});
}

function initResearch() {
  $('research-open')?.addEventListener('click', researchOpenModal);
  $('research-close')?.addEventListener('click', researchCloseModal);
  $('research-cancel')?.addEventListener('click', researchCloseModal);
  $('research-template')?.addEventListener('change', researchRenderTemplateFields);
  $('research-preview-btn')?.addEventListener('click', () => researchPreview().catch(() => {}));
  $('research-submit')?.addEventListener('click', () => researchSubmit().catch(() => {}));
  $('research-modal')?.addEventListener('click', ev => {
    if (ev.target === $('research-modal')) researchCloseModal();
  });
  document.addEventListener('pointerdown', ev => {
    if (!ev.target.closest?.('.research-path-control')) researchHidePathSuggestions();
  });
}
