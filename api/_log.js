// Structured JSON logs (one line per event) for Vercel's log viewer.
// Never pass secrets in here. Anything that looks like one is dropped anyway, and user content is never logged.
const SENSITIVE = /token|secret|password|cookie|authorization|session|signature|email|text|prompt|message|content|body/i;

function clean(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '...' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: String(value.message).slice(0, 200) };
  if (depth > 2) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clean(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).slice(0, 30)) out[k] = SENSITIVE.test(k) ? '[removed]' : clean(value[k], depth + 1);
    return out;
  }
  return String(value).slice(0, 200);
}

function log(level, event, fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...clean(fields || {}) });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

module.exports = { log };
