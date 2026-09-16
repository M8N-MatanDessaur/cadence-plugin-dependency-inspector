/**
 * Ask, as a bento: the question and its answer on the left, questions prepared from the scans
 * and the answers kept in the app's memory on the right.
 */
import { waitForTask } from './helpers.js';
import { Panel, Health, List, ListRow } from './kit.js';

const RECENT_KEY = 'sy.deps.ask.recent';
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20))); } catch {} };
const when = (at) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

function prepare({ overview, repo }) {
  const out = [];
  const t = overview.data ? overview.data.totals : null;
  if (!t) return out;
  if (t.critical || t.high) out.push({ q: 'Which vulnerabilities should I fix today, and what is the exact command for each?', why: `${t.critical} critical, ${t.high} high` });
  if (t.major) out.push({ q: `What are the riskiest major upgrades waiting${repo ? ` in ${repo}` : ''}, and what breaks in each?`, why: `${t.major} major behind` });
  if (t.licenseIssues) out.push({ q: 'Which packages have a license we should not ship with, and what replaces them?', why: `${t.licenseIssues} license issues` });
  if ((overview.data.duplicates || []).length) out.push({ q: 'Which packages disagree across repositories, and which version should everyone be on?', why: `${overview.data.duplicates.length} duplicates` });
  if (t.deprecated) out.push({ q: 'Which deprecated packages do we depend on, and what do their authors recommend instead?', why: `${t.deprecated} deprecated` });
  out.push({ q: `Give me a safe update plan${repo ? ` for ${repo}` : ' for the workspace'}: minor and patch first, then majors in order.`, why: 'the whole picture' });
  out.push({ q: 'Which repository is in the worst shape, and what would bring it above 80?', why: 'health scores' });
  return out.slice(0, 7);
}

export function Ask({ host, api: API, overview, repo, onOpen }) {
  const { h, ui, api, react, icons } = host;
  const { useState, useEffect, useMemo } = react;
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => { if (!asking) { setElapsed(0); return undefined; } const started = Date.now(); const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000); return () => clearInterval(t); }, [asking]);
  const suggestions = useMemo(() => prepare({ overview, repo }), [overview.data, repo]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const ask = async (text) => {
    const asked = (text || question).trim();
    if (!asked || asking) return;
    setQuestion(asked); setAsking(true); setAnswer(null);
    const started = Date.now();
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const prompt = [
        `Answer a question about the dependencies of the repositories in this workspace${repo ? ` (the user is looking at "${repo}")` : ''}. Today is ${new Date().toISOString().slice(0, 10)}.`,
        'Read from these READ-ONLY routes on the local Cadence server (plain GET with curl, JSON back). Never call POST, PUT, PATCH or DELETE, never run npm or yarn.',
        `  ${base}${API}/overview                                every repository: health, vulnerabilities by severity, outdated by kind, license issues, duplicates across repos`,
        `  ${base}${API}/repos/<name>/detail                       one repository: every package (installed, latest, license, dev, deprecated), every advisory with its fix, package manager, path`,
        `  ${base}${API}/package?name=<package>                     registry facts on one package (versions, dates, repository, deprecation)`,
        '', `Question: ${asked}`, '',
        'Answer in Markdown from what you read only: a short lead, then bold labels, bullets or a table where they help. Name packages and versions; give exact install commands when the question is about fixing. Say plainly if the data does not cover it.',
        'This is a one-off answer, not a session: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the answer only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'deps-ask', timeout: 300000, prompt }) });
      const text = result.handledLocally ? (result.answer || '(no answer)') : result.id ? await waitForTask(api, result.id, 300000) : (result.error || 'No answer came back.');
      const entry = { question: asked, answer: String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim(), at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) };
      setAnswer(entry); const next = [entry, ...recent.filter((e) => e.question !== asked)]; writeRecent(next); setRecent(next);
    } catch (e) { setAnswer({ question: asked, answer: e.message, at: new Date().toISOString(), seconds: 0 }); } finally { setAsking(false); }
  };
  const t = overview.data ? overview.data.totals : null;
  const answerPanel = asking
    ? Panel(host, { title: 'Reading the scans', action: meta(`${elapsed}s`), ...FILL }, h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI is reading the scans and the registry, then writing the answer.'), h(ui.Skeleton, { count: 5, height: 16 }))
    : !answer
      ? Panel(host, { title: 'Answer', action: meta('nothing asked yet'), ...FILL },
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI reads the dependency scans through this plugin for whatever the question needs and answers from what it read: packages, versions, advisories, licenses, commands.'),
        h('div', { className: 'mhealth' }, Health(host, { label: 'scanned', value: t ? `${t.scanned}` : '...', tone: 'brass' }), Health(host, { label: 'packages', value: t ? `${t.packages}` : '...' }), Health(host, { label: 'advisories', value: t ? `${t.vulnerabilities}` : '...' })))
      : Panel(host, { title: 'Answer', ...FILL, action: meta(`${when(answer.at)} - ${answer.seconds}s`) }, h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, answer.question), h(ui.Markdown, { source: answer.answer }));
  const column = (...children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0 } }, ...children);
  return h('div', { className: 'dep-ask' },
    column(
      Panel(host, { title: 'Ask about the dependencies', action: meta(repo ? `looking at ${repo}` : 'whole workspace') },
        h('div', { style: { display: 'flex', gap: 8 } },
          h(ui.Input, { placeholder: '"what should I fix first?" or "is lodash safe to bump?"', value: question, disabled: asking, onChange: (e) => setQuestion(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') ask(); }, 'aria-label': 'Question' }),
          h(ui.Button, { variant: 'primary', disabled: asking || !question.trim(), onClick: () => ask() }, asking ? `Asking... ${elapsed}s` : 'Ask'))),
      answerPanel),
    column(
      Panel(host, { title: 'Worth asking', action: meta('from the scans') },
        suggestions.length ? List(host, suggestions.map((s) => ListRow(host, { key: s.q, lead: h(icons.search, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: s.q, sub: s.why, onClick: asking ? undefined : () => ask(s.q) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Scan a repository first.')),
      Panel(host, { title: 'Recently asked', ...FILL, action: recent.length ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, onClick: () => { writeRecent([]); setRecent([]); } }, 'forget all') : meta('kept in the app') },
        recent.length ? List(host, recent.map((e) => ListRow(host, { key: e.at, lead: h(icons.history, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: short(e.question), sub: `${when(e.at)} - ${e.seconds}s`, onClick: () => { setQuestion(e.question); setAnswer(e); } }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing asked yet. Every answer is kept here and comes back in one click.'))));
}
