/**
 * The workspace as a bento: every repository's health, the advisories, what is behind, the
 * licenses to look at, the packages that disagree across repositories.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, Bars, List, ListRow } from './kit.js';

export const API = '/api/plugins/dependency-inspector';
const SEV = ['critical', 'high', 'moderate', 'low'];
export const sevTone = (s) => (s === 'critical' || s === 'high' ? 'var(--sy-rosin)' : s === 'moderate' ? 'var(--sy-brass)' : 'var(--sy-text-3)');
export const healthTone = (hv) => (hv === null || hv === undefined ? 'muted' : hv >= 80 ? 'moss' : hv >= 60 ? 'brass' : 'rosin');
export const healthColour = (hv) => (hv === null || hv === undefined ? 'var(--sy-text-3)' : hv >= 80 ? 'var(--sy-moss)' : hv >= 60 ? 'var(--sy-brass)' : 'var(--sy-rosin)');

export function useOverview(host) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState({});
  const reload = useCallback(() => {
    setError(null);
    api(`${API}/overview`).then((d) => {
      setData(d);
      // The cross-repo screens need every scanned repo's packages and advisories.
      Promise.all((d.repos || []).filter((r) => r.scanned).map((r) => api(`${API}/repos/${encodeURIComponent(r.name)}/detail`).then((x) => [r.name, x]).catch(() => [r.name, null])))
        .then((pairs) => setDetails(Object.fromEntries(pairs.filter((p) => p[1]))));
    }).catch((e) => { setData({ repos: [], totals: null, duplicates: [] }); setError(e.message); });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, details, error, reload };
}

const repoRow = (host, r, onOpen, extra) => ListRow(host, {
  key: r.name,
  lead: host.h('span', { className: 'mind-dot', style: { background: !r.scanned ? 'var(--sy-text-3)' : !r.hasManifest || !r.packages ? 'var(--sy-text-3)' : healthColour(r.health) } }),
  label: r.name,
  sub: !r.hasManifest ? 'no package manifest' : !r.scanned ? 'not scanned yet' : !r.packages ? 'no dependencies declared' : [`${r.packages} packages`, r.vulnerabilities.total ? `${r.vulnerabilities.total} vuln${r.vulnerabilities.total === 1 ? '' : 's'}` : null, r.outdated.major ? `${r.outdated.major} major behind` : null, r.licenseIssues ? `${r.licenseIssues} license issue${r.licenseIssues === 1 ? '' : 's'}` : null, r.deprecated ? `${r.deprecated} deprecated` : null].filter(Boolean).join(' - '),
  meta: extra !== undefined ? extra : (r.scanned && r.packages ? `${r.health}/100` : ''),
  onClick: () => onOpen(r.name),
});

export function Overview({ host, overview, q, scanning, onOpen, onScan, onScanAll }) {
  const { h, ui } = host;
  const { data, error } = overview;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const loading = data === null;
  const t = data ? data.totals : null;
  const repos = (data ? data.repos : []).filter((r) => !q || r.name.toLowerCase().includes(q));
  const withDeps = repos.filter((r) => r.scanned && r.packages);
  const attention = withDeps.slice().sort((a, b) => a.health - b.health).filter((r) => r.health < 80 || r.vulnerabilities.total);
  const healthy = withDeps.filter((r) => r.health >= 80 && !r.vulnerabilities.total);
  const unscanned = repos.filter((r) => r.hasManifest && !r.scanned);
  const noDeps = repos.filter((r) => !r.hasManifest || (r.scanned && !r.packages));
  const avg = withDeps.length ? Math.round(withDeps.reduce((n, r) => n + r.health, 0) / withDeps.length) : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Average health', value: loading ? '...' : avg === null ? '-' : avg, tone: healthTone(avg), hint: withDeps.length ? `over ${withDeps.length} repositories` : undefined }),
      Stat(host, { label: 'Vulnerabilities', value: !t ? '...' : t.vulnerabilities, tone: t && t.vulnerabilities ? 'rosin' : withDeps.some((r) => r.advisoriesChecked === false) ? 'brass' : 'muted', hint: t && (t.critical || t.high) ? `${t.critical} critical, ${t.high} high` : withDeps.some((r) => r.advisoriesChecked === false) ? `${withDeps.filter((r) => r.advisoriesChecked === false).length} not checked - scan again` : undefined }),
      Stat(host, { label: 'Major behind', value: !t ? '...' : t.major, tone: t && t.major ? 'brass' : 'muted', hint: t ? `${t.minor} minor, ${t.patch} patch` : undefined }),
      Stat(host, { label: 'License issues', value: !t ? '...' : t.licenseIssues, tone: t && t.licenseIssues ? 'rosin' : 'muted', hint: t && t.deprecated ? `${t.deprecated} deprecated too` : undefined })),
    h('div', { className: 'mhealth' },
      Health(host, { label: 'repositories', value: loading ? '...' : repos.length }),
      Health(host, { label: 'scanned', value: !t ? '...' : t.scanned }),
      Health(host, { label: 'packages', value: !t ? '...' : t.packages }),
      Health(host, { label: 'duplicates', value: data ? (data.duplicates || []).length : '...' }),
      Health(host, { label: 'last scan', value: withDeps.length ? ago(withDeps.map((r) => r.scannedAt).sort().pop()) : 'never' })),
    error ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-rosin)' } }, error) : null,
    unscanned.length ? Panel(host, { title: 'Not scanned yet', wide: true, action: h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !!scanning, onClick: onScanAll }, scanning === 'all' ? 'Scanning...' : 'Scan all') },
      List(host, unscanned.map((r) => repoRow(host, r, onOpen, h('button', { type: 'button', className: 'sy-btn sy-btn--sm', disabled: !!scanning, onClick: (e) => { e.stopPropagation(); onScan(r.name); } }, scanning === r.name ? 'Scanning...' : 'Scan'))))) : null,
    Panel(host, { title: 'Needs attention', wide: true, action: meta(loading ? '' : `${attention.length}`) },
      loading ? h(ui.Skeleton, { count: 4, height: 18 }) : attention.length ? List(host, attention.map((r) => repoRow(host, r, onOpen))) : empty(withDeps.length ? 'Every scanned repository is healthy.' : 'Scan a repository to see where it stands.')),
    h('div', { className: 'dep-row2' },
      Panel(host, { title: 'Healthy', action: meta(loading ? '' : `${healthy.length}`) },
        loading ? h(ui.Skeleton, { count: 3, height: 18 }) : healthy.length ? List(host, healthy.sort((a, b) => b.health - a.health).map((r) => repoRow(host, r, onOpen))) : empty('None yet.')),
      Panel(host, { title: 'No dependencies', action: meta(loading ? '' : `${noDeps.length}`) },
        loading ? h(ui.Skeleton, { count: 3, height: 18 }) : noDeps.length ? List(host, noDeps.map((r) => repoRow(host, r, onOpen, ''))) : empty('Every repository declares something.'))));
}

export function OverviewAside({ host, overview, onOpen, onScan, scanning }) {
  const { h, ui } = host;
  const { data, details } = overview;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const t = data ? data.totals : null;
  const worst = [];
  for (const [name, d] of Object.entries(details || {})) for (const v of d.vulnerabilities || []) worst.push({ ...v, repo: name });
  worst.sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity));
  const stale = (data ? data.repos : []).filter((r) => r.scanned && r.scannedAt && Date.now() - new Date(r.scannedAt) > 7 * 86400000);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Severity', action: meta(t ? `${t.vulnerabilities}` : '...') },
      t ? Bars(host, { rows: SEV.map((s) => ({ label: s, value: t[s], color: s === 'critical' || s === 'high' ? 'var(--sy-rosin)' : s === 'moderate' ? 'var(--sy-brass)' : undefined })) }) : h(ui.Skeleton, { count: 4, height: 14 })),
    Panel(host, { title: 'Worst first', ...FILL, action: meta(worst.length ? `${worst.length}` : '') },
      !data ? h(ui.Skeleton, { count: 4, height: 16 }) : worst.length ? List(host, worst.slice(0, 20).map((v, i) => ListRow(host, { key: `${v.repo}-${v.id}-${i}`, lead: h('span', { className: 'mind-dot', style: { background: sevTone(v.severity) } }), label: `${v.module} - ${v.severity}`, sub: `${v.repo} - ${v.title}`, onClick: () => onOpen(v.repo) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No known advisory in the scanned repositories.')),
    stale.length ? Panel(host, { title: 'Scans older than a week', action: meta(`${stale.length}`) },
      List(host, stale.map((r) => ListRow(host, { key: r.name, label: r.name, sub: `scanned ${ago(r.scannedAt)}`, meta: h('button', { type: 'button', className: 'sy-btn sy-btn--sm', disabled: !!scanning, onClick: (e) => { e.stopPropagation(); onScan(r.name); } }, scanning === r.name ? '...' : 'Scan'), onClick: () => onOpen(r.name) })))) : null);
}

/** Rows of packages across repositories, filtered by the search. */
function across(overview, pick) {
  const out = [];
  for (const [repo, d] of Object.entries(overview.details || {})) for (const p of d.packages || []) if (pick(p, d)) out.push({ ...p, repo });
  return out;
}
const pkgRow = (host, p, onOpenPackage, subExtra) => ListRow(host, {
  key: `${p.repo}-${p.name}`,
  lead: host.h('span', { className: 'mind-dot', style: { background: p.updateType === 'major' ? 'var(--sy-rosin)' : p.updateType === 'minor' ? 'var(--sy-brass)' : p.updateType === 'patch' ? 'var(--sy-moss)' : 'var(--sy-text-3)' } }),
  label: p.name,
  sub: [p.repo, `${p.installedVersion} -> ${p.latestVersion}`, p.isDev ? 'dev' : null, p.source === 'nuget' ? 'NuGet' : null, subExtra].filter(Boolean).join(' - '),
  meta: p.updateType === 'up-to-date' ? 'current' : p.updateType,
  onClick: () => onOpenPackage(p.name, p.repo),
});

export function Vulnerabilities({ host, overview, q, onOpen, onOpenPackage }) {
  const { h, ui } = host;
  const { data, details } = overview;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const all = [];
  for (const [repo, d] of Object.entries(details || {})) for (const v of d.vulnerabilities || []) if (!q || `${v.module} ${v.title}`.toLowerCase().includes(q)) all.push({ ...v, repo });
  const by = (s) => all.filter((v) => v.severity === s);
  const t = data ? data.totals : null;
  const row = (v, i) => ListRow(host, { key: `${v.repo}-${v.id}-${i}`, lead: h('span', { className: 'mind-dot', style: { background: sevTone(v.severity) } }), label: `${v.module} - ${v.title}`, sub: `${v.repo} - affects ${v.range} - fix: ${v.recommendation}`, meta: v.url ? h('a', { href: v.url, target: '_blank', rel: 'noreferrer', className: 'mpanel__meta', onClick: (e) => e.stopPropagation() }, 'advisory') : null, onClick: () => onOpenPackage(v.module, v.repo) });
  const section = (s) => by(s).length ? Panel(host, { title: s[0].toUpperCase() + s.slice(1), wide: true, action: meta(`${by(s).length}`) }, List(host, by(s).map(row))) : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' }, SEV.map((s) => Stat(host, { key: s, label: s[0].toUpperCase() + s.slice(1), value: !t ? '...' : t[s], tone: t && t[s] ? (s === 'critical' || s === 'high' ? 'rosin' : s === 'moderate' ? 'brass' : 'muted') : 'muted' }))),
    h('div', { className: 'mhealth' },
      Health(host, { label: 'repositories hit', value: !data ? '...' : new Set(all.map((v) => v.repo)).size }),
      Health(host, { label: 'packages hit', value: !data ? '...' : new Set(all.map((v) => v.module)).size }),
      Health(host, { label: 'with a fix', value: !data ? '...' : all.filter((v) => v.recommendation && !/no fix/i.test(v.recommendation)).length })),
    !data ? Panel(host, { title: 'Advisories', wide: true }, h(ui.Skeleton, { count: 5, height: 18 })) : all.length ? SEV.map(section) : Panel(host, { title: 'Advisories', wide: true }, empty('No known advisory in the scanned repositories.')));
}

export function Outdated({ host, overview, q, onOpen, onOpenPackage }) {
  const { h, ui } = host;
  const { data } = overview;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const all = across(overview, (p) => ['major', 'minor', 'patch'].includes(p.updateType) && (!q || p.name.toLowerCase().includes(q)));
  const by = (k) => all.filter((p) => p.updateType === k);
  const t = data ? data.totals : null;
  const section = (k, hint) => by(k).length ? Panel(host, { title: `${k[0].toUpperCase() + k.slice(1)} behind`, wide: true, action: meta(`${by(k).length} - ${hint}`) }, List(host, by(k).sort((a, b) => a.name.localeCompare(b.name)).map((p) => pkgRow(host, p, onOpenPackage)))) : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Major', value: !t ? '...' : t.major, tone: t && t.major ? 'rosin' : 'muted', hint: 'breaking changes likely' }),
      Stat(host, { label: 'Minor', value: !t ? '...' : t.minor, tone: t && t.minor ? 'brass' : 'muted', hint: 'new features, usually safe' }),
      Stat(host, { label: 'Patch', value: !t ? '...' : t.patch, tone: t && t.patch ? 'moss' : 'muted', hint: 'fixes only' }),
      Stat(host, { label: 'Deprecated', value: !t ? '...' : t.deprecated, tone: t && t.deprecated ? 'rosin' : 'muted' })),
    !data ? Panel(host, { title: 'Outdated', wide: true }, h(ui.Skeleton, { count: 5, height: 18 })) : all.length ? [section('major', 'read the changelog first'), section('minor', 'safe updates'), section('patch', 'safe updates')] : Panel(host, { title: 'Outdated', wide: true }, empty('Everything scanned is at its latest.')));
}

export function Licenses({ host, overview, q, onOpen, onOpenPackage }) {
  const { h, ui } = host;
  const { data } = overview;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const bad = across(overview, (p) => !p.licenseOk && (!q || p.name.toLowerCase().includes(q)));
  const unknown = bad.filter((p) => !p.license || /unknown/i.test(p.license));
  const notAllowed = bad.filter((p) => !unknown.includes(p));
  const counts = {};
  for (const p of across(overview, () => true)) counts[p.license || 'Unknown'] = (counts[p.license || 'Unknown'] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const allowed = Object.values(overview.details || {})[0]?.allowedLicenses || [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Not allowed', value: !data ? '...' : notAllowed.length, tone: notAllowed.length ? 'rosin' : 'muted' }),
      Stat(host, { label: 'Unknown', value: !data ? '...' : unknown.length, tone: unknown.length ? 'brass' : 'muted' }),
      Stat(host, { label: 'Licenses seen', value: !data ? '...' : Object.keys(counts).length }),
      Stat(host, { label: 'Allowed list', value: allowed.length, tone: 'muted', hint: allowed.slice(0, 3).join(', ') })),
    h('div', { className: 'mhealth' }, top.map(([l, n]) => Health(host, { key: l, label: l, value: n }))),
    notAllowed.length ? Panel(host, { title: 'Not on the allowed list', wide: true, action: meta(`${notAllowed.length}`) }, List(host, notAllowed.map((p) => pkgRow(host, p, onOpenPackage, p.license)))) : null,
    unknown.length ? Panel(host, { title: 'License unknown', wide: true, action: meta(`${unknown.length} - the registry did not say`) }, List(host, unknown.map((p) => pkgRow(host, p, onOpenPackage)))) : null,
    data && !bad.length ? Panel(host, { title: 'Licenses', wide: true }, empty('Every package carries a license on the allowed list.')) : null,
    !data ? Panel(host, { title: 'Licenses', wide: true }, h(ui.Skeleton, { count: 5, height: 18 })) : null);
}

export function Duplicates({ host, overview, q, onOpen, onOpenPackage }) {
  const { h, ui } = host;
  const { data } = overview;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const dups = (data ? data.duplicates || [] : []).filter((d) => !q || d.name.toLowerCase().includes(q));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Packages that disagree', value: !data ? '...' : dups.length, tone: dups.length ? 'brass' : 'muted' }),
      Stat(host, { label: 'Most spread', value: !data ? '...' : dups[0] ? dups[0].name : '-', tone: 'muted', hint: dups[0] ? `${dups[0].instances.length} repositories, ${dups[0].versions} versions` : undefined }),
      Stat(host, { label: 'Repositories involved', value: !data ? '...' : new Set(dups.flatMap((d) => d.instances.map((i) => i.repo))).size }),
      Stat(host, { label: 'Why it matters', value: 'drift', tone: 'muted', hint: 'one fix, many places' })),
    !data ? Panel(host, { title: 'Duplicates', wide: true }, h(ui.Skeleton, { count: 5, height: 18 }))
      : dups.length ? Panel(host, { title: 'Same package, different versions', wide: true, action: meta(`${dups.length}`) },
        List(host, dups.map((d) => ListRow(host, { key: d.name, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-brass)' } }), label: d.name, sub: d.instances.map((i) => `${i.repo} ${i.version}`).join(' - '), meta: `${d.versions} versions`, onClick: () => onOpenPackage(d.name, d.instances[0].repo) }))))
      : Panel(host, { title: 'Duplicates', wide: true }, empty('Every shared package is at the same version everywhere.')));
}
