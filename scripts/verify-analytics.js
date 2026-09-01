#!/usr/bin/env node
/**
 * Ask PostHog what it actually received. Nothing else counts.
 *
 * Every other check in this repo reads source: is the handler installed, is the
 * tracker called, is the identifier in scope. All of that can be green while not
 * one event reaches PostHog - which is exactly the state the app was in for the
 * four days of the insights outage. This script closes the loop from the only
 * end that matters, the server's.
 *
 * Usage:
 *   export POSTHOG_PERSONAL_API_KEY=phx_...        # see --help for how to make one
 *   node scripts/verify-analytics.js               # last 60 minutes
 *   node scripts/verify-analytics.js --minutes 1440
 *   node scripts/verify-analytics.js --versions    # who is on which build
 *
 * Exits non-zero when a critical event is missing, so it can gate a release.
 */

const HOST = process.env.POSTHOG_HOST_API || 'https://eu.posthog.com';
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i === -1 ? d : args[i + 1];
};

if (has('--help') || has('-h')) {
  console.log(`
Verify Taylos Desktop analytics against PostHog.

  1. Open ${HOST}/settings/user-api-keys
  2. "Create personal API key"
  3. Scopes:  Query -> Read        (running the queries)
              Project -> Read      (finding the project id)
     Project:Read is only needed for auto-discovery. To use a Query:Read-only
     key, set POSTHOG_PROJECT_ID and discovery is skipped entirely - the id is
     the number in your PostHog URL, e.g. ${HOST}/project/12345/...
  4. export POSTHOG_PERSONAL_API_KEY=phx_...
     export POSTHOG_PROJECT_ID=12345          # optional

  node scripts/verify-analytics.js [--minutes N] [--versions] [--events] [--history] [--json]

The key is read from the environment and never printed.
`);
  process.exit(0);
}

if (!KEY) {
  console.error('POSTHOG_PERSONAL_API_KEY is not set. Run with --help for how to create one.');
  process.exit(2);
}

const MINUTES = Number(val('--minutes', '60'));
if (!Number.isFinite(MINUTES) || MINUTES <= 0) {
  console.error('--minutes must be a positive number');
  process.exit(2);
}

// The events that prove each half of the product is observable. A green run
// means the pipeline carried them end to end; it does not mean the numbers are
// right, only that they exist.
const CRITICAL = [
  { event: 'error_occurred', why: 'failures are visible at all' },
  { event: 'insight_clicked', why: 'the rep used a suggestion (the value claim)' },
  { event: 'insights_loaded', why: 'suggestions reached the overlay' },
  { event: 'recording_started', why: 'a call actually started' },
  { event: 'server_desktop_client_telemetry', why: 'server-side presence + version' },
];

async function api(path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} on ${path}\n${text.slice(0, 400)}`);
  }
  return res.json();
}

async function hogql(projectId, query) {
  const out = await api(`/api/projects/${projectId}/query/`, {
    query: { kind: 'HogQLQuery', query },
  });
  const rows = out.results || out.result || [];
  // HogQL returns rows as arrays ordered by `columns`. Normalise object rows
  // too rather than assuming, so a response-shape change degrades to wrong
  // column order instead of a crash with no output.
  const columns = out.columns || [];
  return rows.map((row) =>
    Array.isArray(row) ? row : columns.map((c) => row[c]));
}

function table(rows, headers) {
  if (!rows.length) return '  (none)';
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

// PostHog documents project listing under the organization route and gates it
// behind Project:Read, which a Query:Read-only key does not have. Try the
// shapes in order and let an explicit id skip all of them, so the narrowest
// possible key still works.
async function resolveProject() {
  const explicit = process.env.POSTHOG_PROJECT_ID;
  if (explicit) return { id: explicit, name: `project ${explicit}` };

  const routes = ['/api/projects/', '/api/organizations/@current/projects/'];
  const failures = [];
  for (const route of routes) {
    try {
      const body = await api(route);
      const list = body.results || (Array.isArray(body) ? body : []);
      if (list.length) return list[0];
      failures.push(`${route}: empty`);
    } catch (error) {
      failures.push(`${route}: ${error.message.split('\n')[0]}`);
    }
  }
  throw new Error(
    'could not resolve a project id.\n  ' + failures.join('\n  ') +
    '\n\nEither add the Project:Read scope to the key, or set POSTHOG_PROJECT_ID' +
    '\nto the number in your PostHog URL and re-run.',
  );
}

(async () => {
  const project = await resolveProject();
  console.log(`Project: ${project.name} (id ${project.id})`);
  console.log(`Window:  last ${MINUTES} minute(s)\n`);

  const since = `now() - INTERVAL ${MINUTES} MINUTE`;

  // 1. Everything the Desktop sent, so a missing event is visible next to the
  //    ones that arrived rather than as an absence you have to notice.
  const seen = await hogql(project.id, `
    SELECT event, count() AS n, max(timestamp) AS last_seen
    FROM events
    WHERE timestamp > ${since}
      AND (properties.source = 'desktop' OR event LIKE '%desktop%' OR event LIKE '%insight%'
           OR event LIKE '%ask_%' OR event LIKE '%recording%' OR event = 'error_occurred')
    GROUP BY event ORDER BY n DESC
  `);

  if (has('--events') || !has('--versions')) {
    console.log('Events received:');
    console.log(table(seen.map((r) => [r[0], r[1], String(r[2]).slice(0, 19)]),
      ['event', 'count', 'last seen']));
    console.log('');
  }

  // 2. Who is on which build. The question server telemetry alone cannot answer,
  //    because that endpoint only exists from v1.0.101 onward.
  if (has('--versions')) {
    const versions = await hogql(project.id, `
      SELECT properties.app_version AS version,
             distinct_id AS user,
             count() AS events,
             max(timestamp) AS last_seen
      FROM events
      WHERE timestamp > ${since} AND properties.app_version != ''
      GROUP BY version, user ORDER BY last_seen DESC
    `);
    console.log('Installed versions (from client events):');
    console.log(table(versions.map((r) => [r[0], r[1], r[2], String(r[3]).slice(0, 19)]),
      ['version', 'user', 'events', 'last seen']));
    console.log('');
  }

  // 3. Has a critical event ever gone quiet?
  //
  // This is the check that found the real defect. `insight_clicked` fired 204
  // times in Dec 2025, 84 in Jan 2026, then NOTHING until 2026-09-01: the call
  // site was lost in a refactor and no one noticed for seven months. A window
  // check cannot see that - the event looks absent for the same reason a
  // feature nobody used that hour looks absent.
  if (has('--history')) {
    console.log('Monthly volume per critical event (a gap is a lost call site):');
    for (const { event } of CRITICAL) {
      const months = await hogql(project.id, `
        SELECT toStartOfMonth(timestamp) AS m, count() AS n
        FROM events WHERE event = '${event}' GROUP BY m ORDER BY m
      `);
      if (!months.length) { console.log(`  ${event}: never seen`); continue; }
      const spark = months.map(([m, n]) => `${String(m).slice(0, 7)}:${n}`).join('  ');
      console.log(`  ${event}\n    ${spark}`);
      // Any month with no row between the first and last sighting is a silence
      // that had a cause.
      const stamps = months.map(([m]) => String(m).slice(0, 7));
      const gaps = [];
      for (let i = 1; i < stamps.length; i++) {
        const [py, pm] = stamps[i - 1].split('-').map(Number);
        const [cy, cm] = stamps[i].split('-').map(Number);
        const delta = (cy - py) * 12 + (cm - pm);
        if (delta > 1) gaps.push(`${stamps[i - 1]} -> ${stamps[i]} (${delta - 1} silent month(s))`);
      }
      for (const gap of gaps) console.log(`    GAP  ${gap}`);
    }
    console.log('');
  }

  // 4. The verdict.
  const arrived = new Set(seen.map((r) => r[0]));
  const missing = CRITICAL.filter(({ event }) =>
    !arrived.has(event) && ![...arrived].some((e) => e.startsWith(event)));

  console.log('Critical coverage:');
  for (const { event, why } of CRITICAL) {
    const ok = arrived.has(event) || [...arrived].some((e) => e.startsWith(event));
    console.log(`  ${ok ? 'OK     ' : 'MISSING'}  ${event.padEnd(34)} ${why}`);
  }

  if (has('--json')) {
    console.log('\n' + JSON.stringify({ arrived: [...arrived], missing: missing.map((m) => m.event) }, null, 2));
  }

  if (missing.length) {
    console.error(`\n${missing.length} critical event(s) never arrived in this window.`);
    console.error('If you did not exercise that part of the app, widen --minutes or use it and re-run.');
    process.exit(1);
  }
  console.log('\nAll critical events arrived.');
})().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(2);
});
