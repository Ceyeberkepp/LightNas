/* Lightweight, accessible command search for the existing LightNAS navigation.
   No extra dependencies, backend calls, or changes to authorization. */
export function normalizeNavigationText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function rankNavigationItems(items, query, limit = 8) {
  const needle = normalizeNavigationText(query);
  const ranked = items.map((item, index) => {
    const label = normalizeNavigationText(item.label);
    const group = normalizeNavigationText(item.group);
    const haystack = label + ' ' + group;
    let score = needle ? 0 : Math.max(1, 25 - index);
    if (needle) {
      if (label === needle) score = 100;
      else if (label.startsWith(needle)) score = 85;
      else if (label.split(/[\s/&-]+/).some(word => word.startsWith(needle))) score = 72;
      else if (label.includes(needle)) score = 60;
      else if (haystack.includes(needle)) score = 35;
    }
    return { item, index, score };
  });
  return ranked.filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map(entry => entry.item);
}

const iconPaths = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9v11h14V9', 'M9 20v-7h6v7'],
  storage: ['M4 5h16l2 14H2L4 5Z', 'M7 16h.01', 'M17 16h.01'],
  pools: ['M4 4h16v16H4z', 'M11 4v16', 'M4 11h16'],
  files: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h6'],
  shares: ['M12 3v6', 'M6 9h12', 'M6 9v4', 'M18 9v4', 'M3 13h6v7H3z', 'M15 13h6v7h-6z'],
  backups: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 7v5l3 2'],
  apps: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  ai: ['M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z'],
  kubernetes: ['M12 2l8.5 5v10L12 22l-8.5-5V7L12 2Z', 'M12 7v10', 'M7 10l10 4', 'M17 10 7 14'],
  containers: ['M12 2l9 5v10l-9 5-9-5V7l9-5Z', 'M3 7l9 5 9-5', 'M12 12v10'],
  vms: ['M3 4h18v13H3z', 'M8 21h8', 'M12 17v4'],
  network: ['M12 3v6', 'M6 9h12', 'M6 9v6', 'M18 9v6', 'M3 15h6v6H3z', 'M15 15h6v6h-6z', 'M9 3h6v6H9z'],
  firewall: ['M12 2l9 4v6c0 5-3.5 8.5-9 10-5.5-1.5-9-5-9-10V6l9-4Z', 'M9 12l2 2 4-4'],
  integrations: ['M8 3h4v4a2 2 0 1 0 4 0V3h5v6h-4a2 2 0 1 0 0 4h4v8h-8v-4a2 2 0 1 0-4 0v4H3v-8h4a2 2 0 1 0 0-4H3V3h5Z'],
  admin: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3', 'M5.6 5.6l2.1 2.1', 'M16.3 16.3l2.1 2.1', 'M18.4 5.6l-2.1 2.1', 'M7.7 16.3l-2.1 2.1', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'],
  hypervisor: ['M4 3h16v8H4z', 'M4 13h16v8H4z', 'M7 7h.01', 'M7 17h.01']
};

function upgradeNavigationIcons() {
  const links = document.querySelectorAll('#nav a[data-view], .sidebar-foot a[data-view], .mobile-nav a[data-view]');
  for (const link of links) {
    const glyph = link.querySelector(':scope > span');
    const paths = iconPaths[link.dataset.view];
    if (!glyph || !paths || glyph.querySelector('svg')) continue;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    glyph.replaceChildren(svg);
    glyph.classList.add('ln-nav-icon');
  }
}

function visibleNavigationLink(link) {
  let current = link;
  while (current && current.id !== 'console') {
    if (current.hidden || current.classList?.contains('hidden')) return false;
    if (getComputedStyle(current).display === 'none') return false;
    current = current.parentElement;
  }
  return true;
}

function navigationLabel(link) {
  const copy = link.cloneNode(true);
  copy.querySelector(':scope > span')?.remove();
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

function navigationItems() {
  const links = document.querySelectorAll('#nav a[data-view], .sidebar-foot a[data-view]');
  const items = [];
  const seen = new Set();
  for (const link of links) {
    if (!visibleNavigationLink(link)) continue;
    const library = link.dataset.fileLibrary;
    const key = link.dataset.view + ':' + (library || '');
    if (seen.has(key)) continue;
    seen.add(key);
    const isLibrary = Boolean(link.closest('.nav-files-subtabs'));
    const group = isLibrary ? 'Files & media' :
      link.closest('.nav-group')?.querySelector('summary')?.textContent?.trim() || 'Workspace';
    items.push({
      label: navigationLabel(link),
      group,
      action: () => link.click()
    });
  }
  const admin = document.querySelector('#content[data-current-view="admin"]');
  if (admin) {
    for (const button of admin.querySelectorAll('.admin-center-nav-item[data-admin-section]')) {
      if (!visibleNavigationLink(button)) continue;
      items.push({
        label: button.textContent.trim(),
        group: 'Admin Center',
        action: () => button.click()
      });
    }
  }
  return items;
}

function initWorkspaceSearch() {
  const root = document.getElementById('console');
  const wrapper = document.getElementById('workspace-search-shell');
  const input = document.getElementById('workspace-search');
  const list = document.getElementById('workspace-search-results');
  if (!root || !wrapper || !input || !list) return;
  upgradeNavigationIcons();
  let results = [];
  let active = -1;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index) {
    if (!results.length) return;
    active = (index + results.length) % results.length;
    const buttons = [...list.querySelectorAll('[role="option"]')];
    buttons.forEach((button, i) => {
      button.classList.toggle('selected', i === active);
      button.setAttribute('aria-selected', String(i === active));
    });
    input.setAttribute('aria-activedescendant', buttons[active].id);
    buttons[active].scrollIntoView({ block: 'nearest' });
  }

  function activate(index) {
    const result = results[index];
    if (!result) return;
    close();
    input.value = '';
    result.action();
    input.blur();
  }

  function refresh() {
    results = rankNavigationItems(navigationItems(), input.value);
    list.replaceChildren();
    active = -1;
    if (!results.length) {
      const empty = document.createElement('p');
      empty.className = 'workspace-search-empty';
      empty.textContent = 'No matching pages. Try Storage, Files, Apps, or Admin.';
      list.append(empty);
    }
    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'workspace-search-option-' + index;
      button.className = 'workspace-search-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      const title = document.createElement('strong');
      title.textContent = item.label;
      const group = document.createElement('small');
      group.textContent = item.group;
      button.append(title, group);
      button.addEventListener('click', () => activate(index));
      list.append(button);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      input.blur();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (list.hidden) refresh();
      highlight(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) refresh();
      highlight(active - 1);
    } else if (event.key === 'Enter') {
      if (list.hidden) refresh();
      if (results.length) {
        event.preventDefault();
        activate(active < 0 ? 0 : active);
      }
    }
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' &&
        !root.classList.contains('hidden')) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target)) close();
  });
  window.addEventListener('hashchange', close);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWorkspaceSearch, { once: true });
  } else {
    initWorkspaceSearch();
  }
}
