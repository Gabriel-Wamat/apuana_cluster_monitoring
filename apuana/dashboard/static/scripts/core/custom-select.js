const customSelectRegistry = new Map();

function customSelectChevron() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
}

function customSelectStatusKind(state) {
  const value = String(state || '').toLowerCase();
  if (value === 'running') return 'running';
  if (value === 'pending') return 'pending';
  return value ? 'error' : '';
}

function customSelectStatusIcon(state) {
  const kind = customSelectStatusKind(state);
  if (!kind) return '';
  const svg = kind === 'running'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-8 6 16 3-8h4"/></svg>'
    : kind === 'pending'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
  return `<span class="job-option-status ${esc(kind)}" aria-label="${esc(state)}" title="${esc(state)}">${svg}</span>`;
}

function createCustomSelectShell(select, config) {
  const picker = document.createElement('div');
  picker.id = config.pickerId || `${select.id}-picker`;
  picker.className = 'job-select-wrap custom-select-wrap';
  picker.setAttribute('role', 'button');
  picker.setAttribute('tabindex', '0');
  picker.setAttribute('aria-haspopup', 'listbox');
  picker.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.id = config.labelId || `${select.id}-label`;
  label.className = 'job-select-label';

  const menu = document.createElement('div');
  menu.id = config.menuId || `${select.id}-menu`;
  menu.className = 'job-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-hidden', 'true');

  select.parentNode.insertBefore(picker, select);
  picker.append(label);
  picker.insertAdjacentHTML('beforeend', customSelectChevron());
  picker.append(select);
  picker.append(menu);
  return {picker, label, menu};
}

function initCustomSelect(selectId, config = {}) {
  const select = $(selectId);
  if (!select) return null;

  const existing = customSelectRegistry.get(selectId);
  if (existing) {
    existing.config = {...existing.config, ...config};
    refreshCustomSelect(selectId);
    return existing;
  }

  let picker = config.pickerId ? $(config.pickerId) : null;
  let label = config.labelId ? $(config.labelId) : null;
  let menu = config.menuId ? $(config.menuId) : null;

  if (!picker) {
    ({picker, label, menu} = createCustomSelectShell(select, config));
  }

  label = label || picker.querySelector('.job-select-label');
  menu = menu || picker.querySelector('.job-select-menu');

  picker.classList.add('job-select-wrap', 'custom-select-wrap');
  picker.classList.toggle('is-full', config.size !== 'inline');
  picker.classList.toggle('is-inline', config.size === 'inline');
  label?.classList.add('job-select-label');
  menu?.classList.add('job-select-menu');
  select.classList.add('custom-select-native', 'job-queue-select');

  const state = {
    select,
    picker,
    label,
    menu,
    open: false,
    config: {
      placeholder: select.getAttribute('aria-label') || 'Select option',
      emptyText: 'No options.',
      ...config,
    },
  };
  customSelectRegistry.set(selectId, state);

  picker.addEventListener('click', ev => {
    if (ev.target?.closest?.('.job-select-menu')) return;
    toggleCustomSelect(selectId);
  });
  picker.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      closeCustomSelect(selectId);
      return;
    }
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggleCustomSelect(selectId);
    }
  });
  select.addEventListener('change', () => refreshCustomSelect(selectId));

  refreshCustomSelect(selectId);
  return state;
}

function customSelectRows(select) {
  return Array.from(select.options).map(option => ({
    value: option.value,
    label: option.textContent || '',
    title: option.getAttribute('title') || option.textContent || '',
    state: option.dataset.state || option.dataset.status || '',
    selected: option.selected,
  }));
}

function renderCustomSelectMenu(selectId) {
  const state = customSelectRegistry.get(selectId);
  if (!state?.menu) return;
  const {select, menu, config} = state;
  const rows = customSelectRows(select);

  menu.innerHTML = rows.length ? rows.map(row => {
    const selected = row.selected ? ' selected' : '';
    const status = customSelectStatusIcon(row.state);
    return `<button class="job-select-option${selected}" type="button" role="option" data-value="${esc(row.value)}" aria-selected="${row.selected ? 'true' : 'false'}" title="${esc(row.title)}">
      <span class="job-option-check">${row.selected ? '✓' : ''}</span>
      <span class="job-option-main">${esc(row.label)}</span>
      ${status}
    </button>`;
  }).join('') : `<div class="job-select-empty">${esc(config.emptyText)}</div>`;

  menu.querySelectorAll('.job-select-option').forEach(row => {
    row.addEventListener('click', ev => {
      ev.stopPropagation();
      setCustomSelectValue(selectId, row.getAttribute('data-value') || '');
    });
  });
}

function refreshCustomSelect(selectId) {
  const state = customSelectRegistry.get(selectId);
  if (!state) return;
  const {select, picker, label, menu, open, config} = state;
  const text = select.options[select.selectedIndex]?.textContent || config.placeholder;
  if (label) {
    label.textContent = text;
    label.title = text;
  }
  picker.setAttribute('aria-label', text);
  picker.setAttribute('aria-expanded', open ? 'true' : 'false');
  menu?.classList.toggle('open', open);
  menu?.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) renderCustomSelectMenu(selectId);
}

function openCustomSelect(selectId) {
  customSelectRegistry.forEach((state, id) => {
    state.open = id === selectId;
    refreshCustomSelect(id);
  });
}

function closeCustomSelect(selectId) {
  const state = customSelectRegistry.get(selectId);
  if (!state?.open) return;
  state.open = false;
  refreshCustomSelect(selectId);
}

function toggleCustomSelect(selectId) {
  const state = customSelectRegistry.get(selectId);
  if (!state) return;
  state.open ? closeCustomSelect(selectId) : openCustomSelect(selectId);
}

function setCustomSelectValue(selectId, value) {
  const state = customSelectRegistry.get(selectId);
  if (!state) return;
  state.select.value = value;
  closeCustomSelect(selectId);
  refreshCustomSelect(selectId);
  state.select.dispatchEvent(new Event('change', {bubbles:true}));
}

function closeCustomSelectsOutside(target) {
  if (!target?.closest) return;
  customSelectRegistry.forEach((state, id) => {
    if (!state.picker.contains(target)) closeCustomSelect(id);
  });
}

