// H6 vérifié avec le code de Nay (src/lifecycle.js) : node verif-h6.mjs
const { applyJobEvent, emptyJobs, jobStatus } = await import(new URL('../../../../src/lifecycle.js', import.meta.url));
const T0 = Date.parse('2026-11-19T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const events = [
  { ts: at(0), callId: 'a', kind: 'call_start' }, { ts: at(5), callId: 'a', kind: 'tool_start' },
  { ts: at(40), callId: 'a', kind: 'call_end', status: 'error', cause: 'shell_blocked', retrying: true },
  { ts: at(50), callId: 'b', kind: 'call_start', resumedFrom: 'a' }, { ts: at(60), callId: 'b', kind: 'message' },
  { ts: at(300), callId: 'b', kind: 'call_end', status: 'ok', question: true },
  { ts: at(0), storyId: 's', kind: 'story_start', feature: 'f' },
  { ts: at(1), callId: 'c', storyId: 's', kind: 'call_start' }, { ts: at(10), callId: 'c', storyId: 's', kind: 'tool_end' },
  { ts: at(0), callId: 'd', kind: 'call_start' },
  { ts: at(20), callId: 'd', kind: 'call_end', status: 'error', error: 'HTTP 429 Too Many Requests' },
];
const config = { silenceSec: 60, quotaPattern: 'quota|rate[ _-]?limit|usage limit|too many requests|\\b429\\b' };
for (const [id, t] of [['a', 45], ['a', 130], ['a', 300], ['s', 65], ['s', 75], ['d', 30]]) {
  const jobs = events.filter((e) => Date.parse(e.ts) <= T0 + t * 1000).reduce(applyJobEvent, emptyJobs());
  const status = jobStatus(jobs, id, T0 + t * 1000, config);
  console.log('H6', id, t, status.state, status.cause ?? '');
}
