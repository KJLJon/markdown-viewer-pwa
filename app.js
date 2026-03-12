/* =============================================================
   Markdown Viewer PWA — app.js
   ============================================================= */

// ── State ──────────────────────────────────────────────────────
const state = {
  rootHandle: null,   // FileSystemDirectoryHandle (FSA) or null
  rootName: '',
  files: [],          // [{path, name, handle?, file?}]
  activePath: null,
};

// ── DOM refs ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
  header:          $('header'),
  menuToggle:      $('menu-toggle'),
  sidebar:         $('sidebar'),
  overlay:         $('overlay'),
  dirName:         $('dir-name'),
  refreshBtn:      $('refresh-btn'),
  fileTree:        $('file-tree'),
  noFiles:         $('no-files'),
  welcome:         $('welcome'),
  contentWrap:     $('content-wrap'),
  breadcrumb:      $('breadcrumb'),
  markdownOutput:  $('markdown-output'),
  openDirBtn:      $('open-dir-btn'),
  openDirWelcome:  $('open-dir-welcome'),
  fallbackInput:   $('fallback-input'),
  themeToggle:     $('theme-toggle'),
  themeIconDark:   $('theme-icon-dark'),
  themeIconLight:  $('theme-icon-light'),
  fsaNote:         $('fsa-note'),
};

// ── Marked.js configuration ────────────────────────────────────
function configureMd() {
  if (!window.marked) return;

  const renderer = new marked.Renderer();

  // Open links in new tab
  renderer.link = ({ href, title, text }) => {
    const titleAttr = title ? ` title="${escHtml(title)}"` : '';
    const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'));
    const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escHtml(href)}"${titleAttr}${target}>${text}</a>`;
  };

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: false,
  });

}

// ── Theme ──────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('md-viewer-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('md-viewer-theme', theme);

  const isDark = theme === 'dark';
  els.themeIconDark.style.display  = isDark ? 'block' : 'none';
  els.themeIconLight.style.display = isDark ? 'none'  : 'block';

  // Swap highlight.js stylesheet
  const hlTheme = $('hljs-theme');
  if (hlTheme) {
    hlTheme.href = isDark
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
  }

  // Update PWA theme-color meta
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = isDark ? '#1e1e2e' : '#eff1f5';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ── Open directory ─────────────────────────────────────────────
async function openDirectory() {
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      await loadFromDirectoryHandle(handle);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        showToast('Failed to open folder: ' + e.message);
      }
    }
  } else {
    // Fallback for Firefox / older Safari
    els.fallbackInput.click();
  }
}

// ── Load via File System Access API ───────────────────────────
async function loadFromDirectoryHandle(handle) {
  state.rootHandle = handle;
  state.rootName   = handle.name;
  state.files      = [];

  els.dirName.textContent = handle.name;

  try {
    await scanDirHandle(handle, handle.name);
  } catch (e) {
    showToast('Error scanning folder: ' + e.message);
    return;
  }

  state.files.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  renderFileTree();
  showContent(false);
  els.refreshBtn.hidden = false;

  // On mobile the sidebar is a hidden drawer — open it so the user can see the file list
  // instead of landing on a blank screen after picking a folder.
  if (window.innerWidth < 768) openSidebar();
}

async function scanDirHandle(dirHandle, basePath) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue;   // skip hidden
    const fullPath = basePath + '/' + name;
    if (handle.kind === 'file' && isMarkdown(name)) {
      state.files.push({ path: fullPath, name, handle });
    } else if (handle.kind === 'directory') {
      await scanDirHandle(handle, fullPath);
    }
  }
}

// ── Load via fallback <input> ──────────────────────────────────
function loadFromInput(fileList) {
  state.rootHandle = null;
  state.files      = [];

  const files = Array.from(fileList).filter(f => isMarkdown(f.name));
  if (files.length === 0) {
    showToast('No markdown files found in selection.');
    return;
  }

  // Derive a root name from the common prefix
  const firstPath = files[0].webkitRelativePath || files[0].name;
  const rootName  = firstPath.split('/')[0] || 'Files';
  state.rootName  = rootName;
  els.dirName.textContent = rootName;

  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    state.files.push({ path, name: file.name, file });
  }

  state.files.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  renderFileTree();
  showContent(false);
  els.refreshBtn.hidden = true;  // can't refresh input-based

  // On mobile the sidebar is a hidden drawer — open it so the user sees the file list.
  if (window.innerWidth < 768) openSidebar();
}

// ── File tree rendering ────────────────────────────────────────
function renderFileTree() {
  els.fileTree.innerHTML = '';
  state.activePath = null;

  if (state.files.length === 0) {
    els.noFiles.hidden = false;
    return;
  }
  els.noFiles.hidden = true;

  const tree = buildTree(state.files);
  renderTreeNode(tree, els.fileTree, 0);
}

function buildTree(files) {
  const root = { dirs: {}, files: [] };

  for (const entry of files) {
    // Strip the root directory prefix for display
    const parts = entry.path.split('/');
    // parts[0] is the root dir name — start from index 1
    const displayParts = parts.slice(1);
    insertIntoNode(root, displayParts, entry);
  }

  return root;
}

function insertIntoNode(node, parts, entry) {
  if (parts.length === 1) {
    node.files.push(entry);
    return;
  }
  const dir = parts[0];
  if (!node.dirs[dir]) node.dirs[dir] = { dirs: {}, files: [], name: dir };
  insertIntoNode(node.dirs[dir], parts.slice(1), entry);
}

function renderTreeNode(node, container, depth) {
  // Directories first
  const dirNames = Object.keys(node.dirs).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  for (const dirName of dirNames) {
    const dirNode = node.dirs[dirName];
    const details = document.createElement('details');
    details.open = depth < 2;

    const summary = document.createElement('summary');
    summary.className = 'tree-dir-label';
    summary.innerHTML = `
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <svg class="dir-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span>${escHtml(dirName)}</span>`;
    details.appendChild(summary);
    renderTreeNode(dirNode, details, depth + 1);
    container.appendChild(details);
  }

  // Files
  const sortedFiles = [...node.files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  for (const entry of sortedFiles) {
    const btn = document.createElement('button');
    btn.className = 'tree-file-btn';
    btn.dataset.path = entry.path;
    btn.innerHTML = `
      <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="tree-file-name">${escHtml(entry.name.replace(/\.md$/i, ''))}</span>`;
    btn.addEventListener('click', () => openFile(entry));
    if (entry.path === state.activePath) btn.classList.add('active');
    container.appendChild(btn);
  }
}

// ── Open & render a file ───────────────────────────────────────
async function openFile(entry) {
  let text;
  try {
    if (entry.handle) {
      const file = await entry.handle.getFile();
      text = await file.text();
    } else {
      text = await entry.file.text();
    }
  } catch (e) {
    showToast('Could not read file: ' + e.message);
    return;
  }

  state.activePath = entry.path;

  // Update active state in sidebar
  document.querySelectorAll('.tree-file-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.path === entry.path);
  });

  // Render markdown
  const html = window.marked ? marked.parse(text) : escHtml(text).replace(/\n/g, '<br>');
  els.markdownOutput.innerHTML = html;

  // Syntax highlighting
  if (window.hljs) {
    els.markdownOutput.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block);
    });
  }

  // Breadcrumb — strip root dir prefix for display
  const displayPath = entry.path.split('/').slice(1).join(' / ');
  els.breadcrumb.textContent = displayPath;

  // Show content
  showContent(true, entry);

  // Scroll to top
  els.contentWrap.scrollTop = 0;

  // Close sidebar on mobile
  if (window.innerWidth < 768) {
    closeSidebar();
  }
}

// ── UI helpers ─────────────────────────────────────────────────
function showContent(hasFile, entry) {
  if (!hasFile && !entry) {
    // Just opened folder, show welcome or content based on state
    els.welcome.hidden     = state.files.length > 0;
    els.contentWrap.hidden = !(state.files.length > 0 && state.activePath);
    return;
  }
  if (hasFile) {
    els.welcome.hidden     = true;
    els.contentWrap.hidden = false;
  } else {
    // Folder loaded but no file selected yet
    if (state.activePath) {
      els.welcome.hidden     = true;
      els.contentWrap.hidden = false;
    } else {
      els.welcome.hidden     = true;
      els.contentWrap.hidden = true;
      // Show a subtle prompt in the sidebar — already handled by sidebar being visible
    }
  }
}

function openSidebar() {
  els.sidebar.classList.add('open');
  els.overlay.classList.add('visible');
  els.menuToggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  els.sidebar.classList.remove('open');
  els.overlay.classList.remove('visible');
  els.menuToggle.setAttribute('aria-expanded', 'false');
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function isMarkdown(name) {
  return /\.(md|markdown|mdown|mkd|mkdn)$/i.test(name);
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Service Worker registration ────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/markdown-viewer-pwa/sw.js', { scope: '/markdown-viewer-pwa/' })
      .catch(err => console.warn('SW registration failed:', err));
  }
}

// ── Init ───────────────────────────────────────────────────────
function init() {
  registerSW();
  initTheme();
  configureMd();

  // FSA support note
  if (!('showDirectoryPicker' in window)) {
    els.fsaNote.textContent =
      'Your browser doesn\'t support the File System Access API. ' +
      'You can still select a folder using the system file picker.';
  }

  // Event listeners
  els.menuToggle.addEventListener('click', () => {
    els.sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  els.overlay.addEventListener('click', closeSidebar);

  els.openDirBtn.addEventListener('click', openDirectory);
  els.openDirWelcome.addEventListener('click', openDirectory);

  els.refreshBtn.addEventListener('click', async () => {
    if (!state.rootHandle || els.refreshBtn.disabled) return;
    els.refreshBtn.disabled = true;
    try {
      const prevPath = state.activePath;
      await loadFromDirectoryHandle(state.rootHandle);
      // Re-open the same file if it still exists
      if (prevPath) {
        const entry = state.files.find(f => f.path === prevPath);
        if (entry) await openFile(entry);
      }
    } finally {
      els.refreshBtn.disabled = false;
    }
  });

  els.fallbackInput.addEventListener('change', e => {
    if (e.target.files.length > 0) loadFromInput(e.target.files);
    // Reset so same folder can be reopened
    e.target.value = '';
  });

  els.themeToggle.addEventListener('click', toggleTheme);

  // Keyboard: Escape closes sidebar
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebar();
  });
}

document.addEventListener('DOMContentLoaded', init);
