/**
 * One repository as a dashboard, and one package inside it.
 *
 * The repository: health and its reasons, the advisories with their fix, what is behind (with
 * "Update safe" for minor and patch, "Update" per package), licenses, every package with
 * filters, and an AI panel that audits or plans the update work and hands it to a terminal.
 * The package: registry facts, the versions, where else it is used, and Update here.
 */
import { ago, waitForTask } from './helpers.js';
import { Panel, Stat, Health, Bars, List, ListRow } from './kit.js';
import { sevTone, healthTone, healthColour } from './overview.js';

const SEV = ['critical', 'high', 'moderate', 'low'];

export function useRepo(host, name) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!name) return;
    setError(null);
    api(`/api/plugins/dependency-inspector/repos/${encodeURIComponent(name)}/detail`).then(setData).catch((e) => setError(e.message));
  }, [name]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, error, reload };
}

const cmdFor = (manager, specs, dev) => manager === 'yarn' ? `yarn add${dev ? ' --dev' : ''} ${specs.join(' ')}` : manager === 'pnpm' ? `pnpm add${dev ? ' -D' : ''} ${specs.join(' ')}` : manager === 'dotnet' ? specs.map((s) => `dotnet add package ${s.replace('@', ' --version ')}`).join('; ') : `npm install${dev ? ' --save-dev' : ''} ${specs.join(' ')}`;

export function RepoPage({ host, api: API, repo, detail, q, scanning, onScan, onOpenPackage, onChanged }) {
  const { h, ui, api, notify } = host;
  const { useState } = host.react;
  const { data, error } = detail;
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(null);
  const [ai, setAi] = useState(null);
  const [aiKind, setAiKind] = useState(null);
  const [aiWide, setAiWide] = useState(false);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (error) return h(ui.EmptyState, { title: `Could not read ${repo}`, body: error });
  if (!data) return h('div', null, h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))), h('div', { className: 'dep-item', style: { marginTop: 'var(--sy-s3)' } }, Panel(host, { title: 'Vulnerabilities' }, h(ui.Skeleton, { count: 5, height: 16 })), Panel(host, { title: 'Health' }, h(ui.Skeleton, { count: 4, height: 16 }))));
  if (!data.scanned) return h('div', null,
    Panel(host, { title: data.manifest ? 'Not scanned yet' : 'No package manifest', wide: true },
      h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, data.manifest ? `${repo} has a ${data.manifest === 'nuget' ? '.csproj' : 'package.json'}. A scan reads it and asks the registry about every package.` : `${repo} has no package.json or .csproj at its root, so there is nothing to inspect.`),
      data.manifest ? h(ui.Button, { variant: 'primary', disabled: scanning, onClick: onScan }, scanning ? 'Scanning...' : 'Scan now') : null));

  const pk = data.packages || [];
  const vulns = data.vulnerabilities || [];
  const outdated = pk.filter((p) => ['major', 'minor', 'patch'].includes(p.updateType));
  const safe = pk.filter((p) => p.updateType === 'minor' || p.updateType === 'patch');
  const major = pk.filter((p) => p.updateType === 'major');
  const licBad = pk.filter((p) => !p.licenseOk);
  const deprecated = pk.filter((p) => p.deprecated);
  const shown = pk.filter((p) => (filter === 'all' || (filter === 'prod' && !p.isDev) || (filter === 'dev' && p.isDev) || (filter === 'outdated' && outdated.includes(p)) || (filter === 'issues' && (!p.licenseOk || p.deprecated || vulns.some((v) => v.module === p.name)))) && (!q || p.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const sevCount = (s) => vulns.filter((v) => v.severity === s).length;
  const reasons = [
    { label: 'vulnerabilities', value: sevCount('critical') * 15 + sevCount('high') * 10 + sevCount('moderate') * 5 + sevCount('low') * 2, tone: 'rosin' },
    { label: 'behind', value: Math.round(((major.length + pk.filter((p) => p.updateType === 'minor').length) / (pk.length || 1)) * 20) + major.length * 2, tone: 'brass' },
    { label: 'licenses', value: licBad.length * 3, tone: 'brass' },
    { label: 'deprecated', value: deprecated.length * 5 },
  ];

  const update = async (list, label) => {
    setBusy(label);
    try {
      const r = await api(`${API}/repos/${encodeURIComponent(repo)}/update-many`, { method: 'POST', body: JSON.stringify({ packages: list.map((p) => ({ name: p.name, version: p.latestVersion })) }) });
      if (r.ok) notify(`Updated ${list.length} package${list.length === 1 ? '' : 's'}. Scan again to confirm.`, 'moss'); else notify(`Some installs failed: ${(r.results || []).filter((x) => !x.ok).map((x) => x.command).join('; ')}`, 'rosin');
      onChanged();
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const toShell = (list, dev) => host.sendToShell && host.sendToShell(cmdFor(data.manager, list.map((p) => `${p.name}@${p.latestVersion}`), dev), { newlines: false, target: { repo, path: data.path } });

  const askAi = async (kind) => {
    setAiKind(kind); setAi(null);
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const prompt = [
        kind === 'audit' ? `Audit the dependencies of the repository "${repo}" and say what to do first.` : kind === 'plan' ? `Write an update plan for the dependencies of the repository "${repo}": what to bump, in what order, what can break, how to verify.` : `Explain the license situation of the repository "${repo}": which packages are not on the allowed list or unknown, what each license means for a commercial product, what to replace or accept.`,
        `Today is ${new Date().toISOString().slice(0, 10)}. Read from these READ-ONLY routes on the local Cadence server (plain GET with curl, JSON back). Never call POST, PUT, PATCH or DELETE, never run npm or yarn.`,
        `  ${base}${API}/repos/${encodeURIComponent(repo)}/detail     every package (installed, latest, license, dev, deprecated), every advisory, health, package manager`,
        `  ${base}${API}/package?name=<package>                         registry facts on one package (versions, dates, repository)`,
        `  ${base}${API}/overview                                        the other repositories, for versions that already work elsewhere`,
        `  The repository is checked out at ${data.path}; you may read its files (package.json, lock file, source) to see how a package is used.`,
        '', 'Be concrete: name packages and versions, give the exact install command for this repository\'s package manager, and say what to test after. Short lead, then bold labels and bullets. Do not run any bootstrap, do not save to Mind or any memory. Reply with the answer only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'deps', timeout: 300000, prompt }) });
      const text = result.handledLocally ? (result.answer || '') : result.id ? await waitForTask(api, result.id, 300000) : (result.error || 'Nothing came back.');
      setAi(String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim());
    } catch (e) { notify(e.message, 'rosin'); setAiKind(null); }
  };
  const aiPanel = (wide) => Panel(host, { title: 'AI', style: wide ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined, bodyStyle: wide ? { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } : undefined,
    action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      ai && host.sendToShell ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => host.sendToShell(`Dependency ${aiKind} for ${repo}:\n${ai}`, { target: { repo, path: data.path } }) }, 'Insert in terminal') : null,
      ai && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: async () => { if (await host.writeNote(`${repo} dependency ${aiKind}`, `# ${repo} - dependency ${aiKind}\n\n${ai}`)) notify('Saved and opened', 'moss'); } }, 'Save as note') : null,
      ai ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setAiWide(!wide) }, wide ? 'Close' : 'Expand') : null,
      !ai ? meta(aiKind ? 'reading...' : 'reads the scan and the code') : null) },
    ai ? h('div', { style: wide ? undefined : { maxHeight: 360, overflow: 'auto', paddingRight: 4 } }, h(ui.Markdown, { source: ai })) : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Audit says what is risky and what to do first. Update plan orders the bumps and says what can break. Licenses explains what each license means here.'),
    aiKind && !ai ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
    !wide ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: ai ? 'var(--sy-s3)' : 0 } },
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('audit') }, 'Audit'),
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('plan') }, 'Update plan'),
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind && !ai, onClick: () => askAi('licenses') }, 'Licenses')) : null);

  const pkgRow = (p) => ListRow(host, {
    key: p.name,
    lead: h('span', { className: 'mind-dot', style: { background: vulns.some((v) => v.module === p.name) ? 'var(--sy-rosin)' : p.updateType === 'major' ? 'var(--sy-rosin)' : p.updateType === 'minor' ? 'var(--sy-brass)' : p.updateType === 'patch' ? 'var(--sy-moss)' : 'var(--sy-text-3)' } }),
    label: p.name,
    sub: [`${p.installedVersion}${p.updateType !== 'up-to-date' && p.latestVersion !== 'unknown' ? ` -> ${p.latestVersion}` : ''}`, p.isDev ? 'dev' : 'prod', p.source === 'nuget' ? 'NuGet' : null, p.license || 'license unknown', p.licenseOk ? null : 'not allowed', p.deprecated ? 'deprecated' : null].filter(Boolean).join(' - '),
    meta: p.updateType === 'up-to-date' ? 'current' : p.updateType === 'unknown' ? '' : p.updateType,
    onClick: () => onOpenPackage(p.name),
  });

  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, h('span', { className: 'mind-dot', style: { background: healthColour(data.health) } }), h('span', { className: 'mpanel__title' }, `${data.manifest === 'nuget' ? 'NuGet' : 'npm'} - ${data.manager || 'npm'} - scanned ${ago(data.scannedAt)}`)),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, `${pk.length} package${pk.length === 1 ? '' : 's'}, ${vulns.length ? `${vulns.length} known advisor${vulns.length === 1 ? 'y' : 'ies'}` : 'no known advisory'}, ${outdated.length ? `${outdated.length} behind` : 'all current'}.`),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, data.path))),
    aiWide && ai ? h('div', { style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)', minHeight: 420 } }, aiPanel(true)) : null,
    aiWide && ai ? null : h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Health', value: data.health, tone: healthTone(data.health), hint: data.health >= 80 ? 'good' : data.health >= 60 ? 'needs care' : 'act on it' }),
      Stat(host, { label: 'Vulnerabilities', value: vulns.length, tone: vulns.length ? 'rosin' : 'muted', hint: vulns.length ? `${sevCount('critical')} critical, ${sevCount('high')} high` : undefined }),
      Stat(host, { label: 'Behind', value: outdated.length, tone: outdated.length ? 'brass' : 'muted', hint: `${major.length} major, ${safe.length} safe` }),
      Stat(host, { label: 'License issues', value: licBad.length, tone: licBad.length ? 'rosin' : 'muted', hint: deprecated.length ? `${deprecated.length} deprecated` : undefined })),
    aiWide && ai ? null : h('div', { className: 'dep-item' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Vulnerabilities', bodyStyle: { maxHeight: 260, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(vulns.length ? 'worst first' : data.advisoriesChecked === false ? 'check failed' : 'none known') },
          data.advisoriesChecked === false ? h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)', color: 'var(--sy-rosin)' } }, 'The advisory service did not answer during the last scan, so this list may be incomplete. Scan again.') : null,
          vulns.length ? List(host, vulns.slice().sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity)).map((v, i) => ListRow(host, { key: `${v.id}-${i}`, lead: h('span', { className: 'mind-dot', style: { background: sevTone(v.severity) } }), label: `${v.module} - ${v.severity}`, sub: `${v.title} - affects ${v.range} - fix: ${v.recommendation}`, meta: v.url ? h('a', { href: v.url, target: '_blank', rel: 'noreferrer', className: 'mpanel__meta', onClick: (e) => e.stopPropagation() }, 'advisory') : null, onClick: () => onOpenPackage(v.module) }))) : data.advisoriesChecked === false ? null : empty('The registry reports no advisory for these versions.')),
        Panel(host, { title: 'Behind', bodyStyle: { maxHeight: 340, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: h('div', { style: { display: 'flex', gap: 6 } },
          safe.length ? h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !!busy, onClick: () => update(safe, 'safe'), title: 'Minor and patch updates, installed now' }, busy === 'safe' ? 'Updating...' : `Update ${safe.length} safe`) : null,
          safe.length && host.sendToShell ? h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: () => { toShell(safe.filter((p) => !p.isDev), false); if (safe.some((p) => p.isDev)) toShell(safe.filter((p) => p.isDev), true); }, title: 'Put the command in a shell instead' }, 'In terminal') : null,
          !safe.length ? meta(outdated.length ? 'only majors' : 'all current') : null) },
          outdated.length ? List(host, outdated.slice().sort((a, b) => ['major', 'minor', 'patch'].indexOf(a.updateType) - ['major', 'minor', 'patch'].indexOf(b.updateType) || a.name.localeCompare(b.name)).map(pkgRow)) : empty('Every package is at its latest version.')),
        Panel(host, { title: 'All packages', action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [['all', 'All'], ['prod', 'Prod'], ['dev', 'Dev'], ['outdated', 'Behind'], ['issues', 'Issues']].map(([k, l]) => h(ui.Chip, { key: k, on: filter === k, onClick: () => setFilter(k) }, l))) },
          shown.length ? h('div', { style: { maxHeight: 420, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, shown.map(pkgRow))) : empty('Nothing matches.'))),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Why this health', action: meta(`${data.health}/100`) },
          Bars(host, { rows: reasons.map((r) => ({ label: r.label, value: r.value, color: r.value ? (r.tone === 'rosin' ? 'var(--sy-rosin)' : 'var(--sy-brass)') : undefined })), max: 100 }),
          h('p', { className: 'mlead', style: { margin: 'var(--sy-s2) 0 0' } }, 'Points taken off 100: advisories by severity, how much is behind, licenses off the list, deprecated packages.')),
        aiPanel(false),
        Panel(host, { title: 'Licenses', action: meta(licBad.length ? `${licBad.length} to look at` : 'all allowed') },
          licBad.length ? List(host, licBad.map((p) => ListRow(host, { key: p.name, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-brass)' } }), label: p.name, sub: p.license || 'unknown', onClick: () => onOpenPackage(p.name) }))) : empty(`Everything is on the allowed list: ${(data.allowedLicenses || []).join(', ')}.`)),
        deprecated.length ? Panel(host, { title: 'Deprecated', action: meta(`${deprecated.length}`) }, List(host, deprecated.map((p) => ListRow(host, { key: p.name, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-rosin)' } }), label: p.name, sub: `${p.installedVersion} - the registry marks it deprecated`, onClick: () => onOpenPackage(p.name) })))) : null,
        Panel(host, { title: 'Details' }, h(ui.InfoGrid, { items: [{ label: 'Manifest', value: data.manifest === 'nuget' ? '.csproj' : 'package.json' }, { label: 'Package manager', value: data.manager || 'npm' }, { label: 'Production', value: pk.filter((p) => !p.isDev).length }, { label: 'Development', value: pk.filter((p) => p.isDev).length }, { label: 'Scanned', value: new Date(data.scannedAt).toLocaleString() }] })))));
}

export function RepoAside({ host, api: API, repo, detail, overview, onOpenPackage }) {
  const { h, ui } = host;
  const { data } = detail;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const pk = data ? data.packages || [] : [];
  const dups = (overview.data ? overview.data.duplicates || [] : []).filter((d) => d.instances.some((i) => i.repo === repo));
  const first = pk.filter((p) => (data.vulnerabilities || []).some((v) => v.module === p.name) || p.updateType === 'major' || p.deprecated).slice(0, 12);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Do first', ...FILL, action: meta(data ? `${first.length}` : '...') },
      !data ? h(ui.Skeleton, { count: 4, height: 16 }) : first.length ? List(host, first.map((p) => ListRow(host, { key: p.name, label: p.name, sub: (data.vulnerabilities || []).some((v) => v.module === p.name) ? 'has an advisory' : p.deprecated ? 'deprecated' : `major behind: ${p.installedVersion} -> ${p.latestVersion}`, onClick: () => onOpenPackage(p.name) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing urgent here.')),
    Panel(host, { title: 'Differs elsewhere', ...FILL, action: meta(overview.data ? `${dups.length}` : '...') },
      !overview.data ? h(ui.Skeleton, { count: 3, height: 16 }) : dups.length ? List(host, dups.map((d) => ListRow(host, { key: d.name, label: d.name, sub: d.instances.map((i) => `${i.repo} ${i.version}`).join(' - '), onClick: () => onOpenPackage(d.name) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Same versions as the other repositories.')));
}

export function PackagePage({ host, api: API, repo, name, detail, overview, onChanged }) {
  const { h, ui, api, notify } = host;
  const { useState, useEffect } = host.react;
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState('');
  useEffect(() => { setInfo(null); api(`${API}/package?name=${encodeURIComponent(name)}`).then(setInfo).catch((e) => setInfo({ error: e.message })); }, [name]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const p = detail.data ? (detail.data.packages || []).find((x) => x.name === name) : null;
  const vulns = detail.data ? (detail.data.vulnerabilities || []).filter((v) => v.module === name) : [];
  const elsewhere = [];
  for (const [r, d] of Object.entries(overview.details || {})) { const x = (d.packages || []).find((y) => y.name === name); if (x && r !== repo) elsewhere.push({ repo: r, version: x.installedVersion }); }
  const target = version.trim() || (p ? p.latestVersion : 'latest');
  const update = async () => {
    setBusy(true);
    try { const r = await api(`${API}/repos/${encodeURIComponent(repo)}/update`, { method: 'POST', body: JSON.stringify({ package: name, version: target }) }); notify(`${r.command || 'Installed'} - scan again to confirm`, 'moss'); onChanged(); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(false); }
  };
  const manager = detail.data ? detail.data.manager : 'npm';
  return h('div', null,
    h('div', { style: { marginBottom: 'var(--sy-s3)' } },
      h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, info && info.description ? info.description : name),
      h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, p ? `${p.installedVersion} installed in ${repo}${p.latestVersion !== 'unknown' ? `, ${p.latestVersion} is the latest` : ''}. ${p.isDev ? 'A development dependency.' : 'A production dependency.'}` : `Not installed in ${repo}.`)),
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Installed', value: p ? p.installedVersion : '-', tone: 'muted' }),
      Stat(host, { label: 'Latest', value: p ? p.latestVersion : info ? info.latest || '-' : '...', tone: p && p.updateType === 'up-to-date' ? 'moss' : p && p.updateType === 'major' ? 'rosin' : 'brass', hint: p ? (p.updateType === 'up-to-date' ? 'current' : `${p.updateType} behind`) : undefined }),
      Stat(host, { label: 'Advisories', value: vulns.length, tone: vulns.length ? 'rosin' : 'muted' }),
      Stat(host, { label: 'License', value: p ? p.license || 'unknown' : info ? info.license || '-' : '...', tone: p && !p.licenseOk ? 'rosin' : 'muted' })),
    h('div', { className: 'dep-item' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'On the registry', action: info && info.npmUrl ? h('a', { className: 'mpanel__meta', href: info.npmUrl, target: '_blank', rel: 'noreferrer' }, 'npm') : null },
          !info ? h(ui.Skeleton, { count: 5, height: 16 }) : info.error ? empty(`The registry did not answer: ${info.error}`) : h(ui.InfoGrid, { items: [{ label: 'Latest', value: `${info.latest}${info.latestAt ? ` - ${ago(info.latestAt)}` : ''}` }, { label: 'Versions', value: info.versions }, { label: 'First published', value: info.created ? new Date(info.created).toLocaleDateString() : '-' }, { label: 'Maintainers', value: info.maintainers }, { label: 'Dependencies', value: info.dependencies }, { label: 'Repository', value: info.repository ? h('a', { href: info.repository, target: '_blank', rel: 'noreferrer' }, info.repository.replace(/^https?:\/\//, '')) : '-' }, { label: 'Deprecated', value: info.deprecated || 'no' }] })),
        Panel(host, { title: 'Recent versions', action: meta(info && info.recent ? `${info.recent.length} latest` : '') },
          !info ? h(ui.Skeleton, { count: 4, height: 16 }) : (info.recent || []).length ? List(host, info.recent.map((v) => ListRow(host, { key: v.version, lead: h('span', { className: 'mind-dot', style: { background: p && v.version === p.installedVersion ? 'var(--sy-moss)' : v.deprecated ? 'var(--sy-rosin)' : 'var(--sy-text-3)' } }), label: v.version, sub: `${v.at ? ago(v.at) : ''}${p && v.version === p.installedVersion ? ' - installed' : ''}${v.deprecated ? ' - deprecated' : ''}`, onClick: () => setVersion(v.version) }))) : empty('No version history.')),
        vulns.length ? Panel(host, { title: 'Advisories', action: meta(`${vulns.length}`) }, List(host, vulns.map((v, i) => ListRow(host, { key: i, lead: h('span', { className: 'mind-dot', style: { background: sevTone(v.severity) } }), label: `${v.severity} - ${v.title}`, sub: `affects ${v.range} - fix: ${v.recommendation}`, onClick: v.url ? () => window.open(v.url, '_blank') : undefined })))) : null),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Update here', action: meta(repo) },
          p ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(ui.Field, { label: 'Version' }, h(ui.Input, { value: version, placeholder: p.latestVersion !== 'unknown' ? p.latestVersion : 'latest', onChange: (e) => setVersion(e.target.value) })),
            h('code', { className: 'mpanel__meta', style: { display: 'block', whiteSpace: 'pre-wrap' } }, cmdFor(manager, [`${name}@${target}`], p.isDev)),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h(ui.Button, { variant: 'primary', disabled: busy || (p.updateType === 'up-to-date' && !version.trim()), onClick: update }, busy ? 'Installing...' : p.updateType === 'up-to-date' && !version.trim() ? 'Already current' : `Update to ${target}`),
              host.sendToShell ? h(ui.Button, { onClick: () => host.sendToShell(cmdFor(manager, [`${name}@${target}`], p.isDev), { newlines: false, target: { repo, path: detail.data.path } }) }, 'In terminal') : null))
            : empty(`${name} is not in ${repo}.`)),
        Panel(host, { title: 'Elsewhere in the workspace', action: meta(overview.details ? `${elsewhere.length}` : '...') },
          elsewhere.length ? List(host, elsewhere.map((e) => ListRow(host, { key: e.repo, label: e.repo, sub: e.version, meta: p && e.version !== p.installedVersion ? 'differs' : 'same' }))) : empty('Only this repository uses it.')),
        p ? Panel(host, { title: 'Details' }, h(ui.InfoGrid, { items: [{ label: 'Wanted', value: p.specifier }, { label: 'Installed', value: p.installedVersion }, { label: 'Kind', value: p.isDev ? 'development' : 'production' }, { label: 'Source', value: p.source }, { label: 'License', value: `${p.license || 'unknown'}${p.licenseOk ? '' : ' (not on the allowed list)'}` }] })) : null)));
}

export function PackageAside({ host, repo, name, detail, overview, onOpen }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const users = [];
  for (const [r, d] of Object.entries(overview.details || {})) { const x = (d.packages || []).find((y) => y.name === name); if (x) users.push({ repo: r, version: x.installedVersion, latest: x.latestVersion }); }
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Used in', action: meta(`${users.length}`) },
      users.length ? List(host, users.map((u) => ListRow(host, { key: u.repo, lead: h('span', { className: 'mind-dot', style: { background: u.repo === repo ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: u.repo, sub: `${u.version}${u.latest && u.latest !== u.version ? ` (latest ${u.latest})` : ''}`, onClick: () => onOpen(u.repo) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Only here.')));
}
