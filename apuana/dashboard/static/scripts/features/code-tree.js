function normalizeCodeKind(entry) {
  if (entry.kind === 'dir' || entry.kind === 'directory' || entry.is_dir) return 'dir';
  return 'file';
}

function codeNodeName(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function codeSortRank(node) {
  const hidden = String(node.name || '').startsWith('.') ? 1 : 0;
  const kind = node.kind === 'dir' ? 0 : 1;
  return hidden * 2 + kind;
}

function sortCodeNodes(nodes) {
  nodes.sort((a, b) => {
    const rank = codeSortRank(a) - codeSortRank(b);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name, 'pt-BR', {sensitivity: 'base'});
  });
  nodes.forEach(node => {
    if (node.children?.length) sortCodeNodes(node.children);
  });
  return nodes;
}

function buildCodeTree(entries, rootPath) {
  const root = {name: '', path: '', absPath: rootPath || '', kind: 'dir', children: []};
  const nodes = new Map([['', root]]);

  (entries || []).forEach(entry => {
    const relPath = String(entry.path || '').replace(/^\/+|\/+$/g, '');
    if (!relPath) return;
    const segments = relPath.split('/').filter(Boolean);
    let parent = root;
    let current = '';

    segments.forEach((segment, index) => {
      current = current ? `${current}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let node = nodes.get(current);
      if (!node) {
        const absPath = isLeaf && entry.abs_path
          ? entry.abs_path
          : `${String(rootPath || '').replace(/\/+$/, '')}/${current}`;
        node = {
          name: segment,
          path: current,
          absPath,
          kind: isLeaf ? normalizeCodeKind(entry) : 'dir',
          language: isLeaf ? entry.language || '' : '',
          sizeHuman: isLeaf ? entry.size_human || '' : '',
          children: [],
        };
        nodes.set(current, node);
        parent.children.push(node);
      } else if (isLeaf) {
        node.kind = normalizeCodeKind(entry);
        node.absPath = entry.abs_path || node.absPath;
        node.language = entry.language || node.language || '';
        node.sizeHuman = entry.size_human || node.sizeHuman || '';
      }
      parent = node;
    });
  });

  return sortCodeNodes(root.children);
}

function filterCodeTree(nodes, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return nodes;
  return (nodes || []).map(node => {
    const children = filterCodeTree(node.children || [], needle);
    const haystack = `${node.name} ${node.path}`.toLowerCase();
    if (haystack.includes(needle) || children.length) {
      return {...node, children};
    }
    return null;
  }).filter(Boolean);
}
