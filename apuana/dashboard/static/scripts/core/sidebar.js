const SIDEBAR_STORAGE_KEY = 'apuana.sidebar.expanded';

function setSidebarExpanded(expanded) {
  const isExpanded = Boolean(expanded);
  document.body.classList.toggle('sidebar-expanded', isExpanded);
  document.documentElement.style.setProperty('--sidebar-w', isExpanded ? '248px' : '72px');
  const sidebar = $('app-sidebar');
  if (sidebar) sidebar.classList.toggle('is-expanded', isExpanded);
  const toggle = $('sb-toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  toggle.setAttribute('aria-label', isExpanded ? 'Collapse sidebar' : 'Expand sidebar');
  toggle.setAttribute('title', isExpanded ? 'Collapse sidebar' : 'Expand sidebar');
}

function initSidebarToggle() {
  const toggle = $('sb-toggle');
  if (!toggle) return;

  const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  setSidebarExpanded(saved);

  toggle.addEventListener('click', () => {
    const expanded = !document.body.classList.contains('sidebar-expanded');
    setSidebarExpanded(expanded);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, expanded ? '1' : '0');
  });
}
