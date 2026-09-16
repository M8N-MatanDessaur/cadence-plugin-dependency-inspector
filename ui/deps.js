/**
 * Dependencies in Cadence 3.0: three regions and a header, like the GitHub and Azure DevOps
 * plugins.
 *
 *   Sidebar: the nav (Overview, Vulnerabilities, Outdated, Licenses, Duplicates, Ask), the
 *   repository this screen is on, a search.
 *   Main: the whole workspace as a bento, one repository as a dashboard, one package.
 *   Right: what needs attention first, or the repo's quick facts.
 *
 * Every number comes from the last scan, kept on the server; Scan reads the manifests and the
 * registries again. The AI reads the same routes; the user clicks Update.
 */
import { ensureStyles, NavItem, Section } from './kit.js';
import { ago } from './helpers.js';
import { useOverview, Overview, OverviewAside, Vulnerabilities, Outdated, Licenses, Duplicates } from './overview.js';
import { useRepo, RepoPage, RepoAside, PackagePage, PackageAside } from './repo.js';
import { Ask } from './ask.js';

export const API = '/api/plugins/dependency-inspector';

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'chart', hint: 'Every repository in the workspace: health, vulnerabilities, what is behind.' },
  { id: 'vulns', label: 'Vulnerabilities', icon: 'warning', hint: 'Known advisories across the workspace, worst first.' },
  { id: 'outdated', label: 'Outdated', icon: 'clock', hint: 'Packages behind their latest, by how far.' },
  { id: 'licenses', label: 'Licenses', icon: 'story', hint: 'Packages whose license is unknown or not on the allowed list.' },
  { id: 'duplicates', label: 'Duplicates', icon: 'epic', hint: 'The same package at different versions across repositories.' },
  { id: 'ask', label: 'Ask', icon: 'search', hint: 'A question about the dependencies. The AI reads the scans for you.' },
];

function Deps({ host }) {
  const { h, ui, api, notify, context } = host;
  const { useState, useEffect, useMemo } = host.react;
  const [tab, setTab] = useState('overview');
  const [repo, setRepo] = useState(() => { try { return localStorage.getItem('sy.deps.repo') || ''; } catch { return ''; } });
  const [openRepo, setOpenRepo] = useState(null);
  const [openPkg, setOpenPkg] = useState(null);
  const [q, setQ] = useState('');
  const [scanning, setScanning] = useState(null);
  const overview = useOverview(host);
  const detail = useRepo(host, openRepo);
  useEffect(() => { ensureStyles(); }, []);
  useEffect(() => { try { if (repo) localStorage.setItem('sy.deps.repo', repo); } catch {} }, [repo]);
  // The repository this screen starts on: the one the active shell is on, if the workspace has it.
  useEffect(() => {
    const names = (overview.data ? overview.data.repos : []).map((r) => r.name);
    if (!names.length) return;
    const focused = ((context && context()) || {}).focused;
    setRepo((cur) => (cur && names.includes(cur) ? cur : (focused && names.includes(focused.repo) ? focused.repo : '')));
  }, [overview.data]);

  const repos = overview.data ? overview.data.repos : [];
  const scanned = repos.filter((r) => r.scanned);
  const current = NAV.find((n) => n.id === tab) || NAV[0];
  const leave = () => { setOpenRepo(null); setOpenPkg(null); };
  const scanAll = async () => {
    setScanning('all');
    try { const r = await api(`${API}/scan-all`, { method: 'POST' }); notify(`Scanned ${(r.repos || []).length} repositories`, 'moss'); overview.reload(); if (openRepo) detail.reload(); }
    catch (e) { notify(e.message, 'rosin'); } finally { setScanning(null); }
  };
  const scanOne = async (name) => {
    setScanning(name);
    try { await api(`${API}/repos/${encodeURIComponent(name)}/scan`, { method: 'POST' }); notify(`Scanned ${name}`, 'moss'); overview.reload(); if (openRepo === name) detail.reload(); }
    catch (e) { notify(e.message, 'rosin'); } finally { setScanning(null); }
  };
  const open = (name) => { setOpenPkg(null); setOpenRepo(name); };
  const openPackage = (name, inRepo) => { if (inRepo) setOpenRepo(inRepo); setOpenPkg(name); };

  // ---------------------------------------------------------------- sidebar
  const t = overview.data ? overview.data.totals : null;
  const left = h('div', { className: 'sb' },
    h('div', { className: 'sb__head' }, h('span', { className: 'sb__title' }, 'Dependencies')),
    h('div', { className: 'mind-stats' },
      !t ? h('span', null, 'reading the scans...') : [h('span', { key: 's' }, `${t.scanned} scanned`), h('span', { key: 'v' }, `${t.vulnerabilities} vuln${t.vulnerabilities === 1 ? '' : 's'}`), h('span', { key: 'o' }, `${t.major} major behind`)]),
    h('ul', { className: 'sb__list', role: 'list' },
      NAV.map((n) => NavItem(host, {
        key: n.id, icon: host.icons[n.icon], label: n.label, active: tab === n.id && !openRepo, title: n.hint,
        badge: !t ? undefined : n.id === 'vulns' ? (t.vulnerabilities || undefined) : n.id === 'outdated' ? (t.major + t.minor + t.patch || undefined) : n.id === 'licenses' ? (t.licenseIssues || undefined) : n.id === 'duplicates' ? ((overview.data.duplicates || []).length || undefined) : n.id === 'overview' ? (repos.length || undefined) : undefined,
        onClick: () => { setTab(n.id); leave(); },
      }))),
    h('div', { style: { flex: 1 } }),
    Section(host, 'Repository'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '0 var(--sy-s3) var(--sy-s2)' } },
      h(ui.Select, { value: openRepo || repo, onChange: (e) => { setRepo(e.target.value); if (e.target.value) open(e.target.value); else leave(); }, 'aria-label': 'Repository' },
        h('option', { value: '' }, 'Whole workspace'),
        repos.map((r) => h('option', { key: r.name, value: r.name }, `${r.name}${r.scanned ? '' : ' (not scanned)'}`))),
      tab !== 'ask' ? h(ui.Input, { value: q, placeholder: 'Search a package', onChange: (e) => setQ(e.target.value), 'aria-label': 'Search packages' }) : null),
    h('div', { className: 'sb__foot' }, openPkg ? 'One package. Back from the header.' : openRepo ? 'One repository. Back to the workspace from the header.' : current.hint));

  // ---------------------------------------------------------------- header
  const repoRow = openRepo ? repos.find((r) => r.name === openRepo) : null;
  const header = h('div', { className: 'mind-view__head' },
    h('div', null,
      h('h1', { className: 'stage-title' }, openPkg ? openPkg : openRepo ? openRepo : current.label),
      h('p', { style: { margin: 0, color: 'var(--sy-text-3)', fontSize: 'var(--sy-fs-sm)' } },
        openPkg ? `In ${openRepo}.` : openRepo ? (repoRow && repoRow.scanned ? `Scanned ${ago(repoRow.scannedAt)}. ${repoRow.packages} package${repoRow.packages === 1 ? '' : 's'}.` : 'Not scanned yet.') : `${current.hint} ${t ? `${t.scanned} of ${repos.length} repositories scanned.` : ''}`)),
    h('div', { className: 'mind-view__actions' },
      openRepo && !openPkg ? h(ui.Button, { variant: 'primary', disabled: !!scanning, onClick: () => scanOne(openRepo) }, scanning === openRepo ? 'Scanning...' : 'Scan now') : null,
      !openRepo ? h(ui.Button, { variant: 'primary', disabled: !!scanning, onClick: scanAll, title: 'Read every manifest again and ask the registries' }, scanning === 'all' ? 'Scanning all...' : 'Scan all') : null,
      openRepo || openPkg ? h(ui.Button, { onClick: () => (openPkg ? setOpenPkg(null) : leave()) }, openPkg ? 'Back to the repository' : 'Back to the workspace') : h(ui.Button, { onClick: () => overview.reload() }, 'Refresh')));

  // ---------------------------------------------------------------- main
  const filtered = useMemo(() => q.trim().toLowerCase(), [q]);
  const main = h('div', { style: { padding: '12px 16px 48px' } },
    overview.error ? h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)', color: 'var(--sy-rosin)' } }, overview.error) : null,
    openPkg
      ? h(PackagePage, { host, api: API, repo: openRepo, name: openPkg, detail, overview, onChanged: () => { detail.reload(); overview.reload(); } })
      : openRepo
        ? h(RepoPage, { host, api: API, repo: openRepo, detail, q: filtered, scanning: scanning === openRepo, onScan: () => scanOne(openRepo), onOpenPackage: (n) => setOpenPkg(n), onChanged: () => { detail.reload(); overview.reload(); } })
        : tab === 'vulns' ? h(Vulnerabilities, { host, overview, q: filtered, onOpen: open, onOpenPackage: openPackage })
        : tab === 'outdated' ? h(Outdated, { host, overview, q: filtered, onOpen: open, onOpenPackage: openPackage })
        : tab === 'licenses' ? h(Licenses, { host, overview, q: filtered, onOpen: open, onOpenPackage: openPackage })
        : tab === 'duplicates' ? h(Duplicates, { host, overview, q: filtered, onOpen: open, onOpenPackage: openPackage })
        : tab === 'ask' ? h(Ask, { host, api: API, overview, repo, onOpen: open })
        : h(Overview, { host, overview, q: filtered, scanning, onOpen: open, onScan: scanOne, onScanAll: scanAll }));

  // ---------------------------------------------------------------- aside
  const right = openPkg
    ? h(PackageAside, { host, api: API, repo: openRepo, name: openPkg, detail, overview, onOpen: open })
    : openRepo
      ? h(RepoAside, { host, api: API, repo: openRepo, detail, overview, onOpenPackage: (n) => setOpenPkg(n) })
      : h(OverviewAside, { host, overview, onOpen: open, onScan: scanOne, scanning });

  return h(ui.Regions, { left, right, paneId: `deps-${tab}`, paneLabel: openPkg ? 'This package' : openRepo ? 'This repository' : 'Needs attention' },
    h('div', { className: 'dep-main' }, h('div', { style: { padding: '32px 16px 0' } }, header), main));
}

Deps.cadenceComponent = true;
export default Deps;
