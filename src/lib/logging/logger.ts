type Level = 'debug' | 'info' | 'warn' | 'error';
type Entry = { level: Level; message: string; timestamp: string; context?: unknown };
const pending: Entry[] = [];
function record(level: Level, message: unknown, context?: unknown) {
  pending.push({ level, message: message instanceof Error ? message.message : String(message), timestamp: new Date().toISOString(), context });
  if (pending.length > 100) pending.shift();
}
export const log = {
  debug: (message: unknown, context?: unknown) => record('debug', message, context),
  info: (message: unknown, context?: unknown) => record('info', message, context),
  warn: (message: unknown, context?: unknown) => record('warn', message, context),
  error: (message: unknown, context?: unknown) => record('error', message, context),
};
// Remote ingestion is optional; never send participant data to a third-party logger.
export async function ingestLogs(endpoint: string) {
  if (!pending.length) return;
  const batch = pending.slice();
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: batch }), credentials: 'same-origin' });
  if (!response.ok) throw new Error('Log ingestion failed.');
  pending.splice(0, batch.length);
}
