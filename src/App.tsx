import { useEffect, useMemo, useState } from 'react';
import {
  DAY_LABEL,
  MONTH_LABEL,
  PRESETS,
  describe,
  fmt,
  nextRuns,
  parseCron,
  relative,
  type ParsedCron,
} from './cron';

const FIELD_META = [
  { name: 'Minute', range: '0–59', pos: 'minute' as const },
  { name: 'Hour', range: '0–23', pos: 'hour' as const },
  { name: 'Day of month', range: '1–31', pos: 'dom' as const },
  { name: 'Month', range: '1–12 or JAN–DEC', pos: 'month' as const },
  { name: 'Day of week', range: '0–6 or SUN–SAT', pos: 'dow' as const },
];

function fieldSummary(cron: ParsedCron, pos: (typeof FIELD_META)[number]['pos']): string {
  const f = cron[pos];
  if (f.all) return 'every';
  if (pos === 'dow') return f.values.map((v) => DAY_LABEL[v]).join(', ');
  if (pos === 'month') return f.values.map((v) => MONTH_LABEL[v - 1]).join(', ');
  if (f.values.length > 12) return `${f.values.length} values`;
  return f.values.join(', ');
}

function initialExpr(): string {
  try {
    const u = new URL(window.location.href);
    const q = u.searchParams.get('e');
    if (q && q.trim().split(/\s+/).length === 5) return q.trim();
  } catch {
    /* ignore */
  }
  return '*/5 * * * *';
}

export default function App() {
  const [expr, setExpr] = useState(initialExpr);
  const [now, setNow] = useState(() => new Date());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const parsed = useMemo(() => parseCron(expr), [expr]);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (parsed.ok) u.searchParams.set('e', expr.trim());
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* ignore */
    }
  }, [expr, parsed.ok]);

  const runs = useMemo(
    () => (parsed.ok && parsed.cron ? nextRuns(parsed.cron, now, 7) : []),
    [parsed, now],
  );

  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time';
    } catch {
      return 'your local time';
    }
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Cron Expression Helper</h1>
        <p className="tag">
          Paste a cron schedule to see what it means in plain English and exactly when it runs next.
          Everything is worked out in your browser.
        </p>
      </header>

      <div className={`inputwrap${expr && !parsed.ok ? ' bad' : ''}`}>
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Cron expression"
          placeholder="* * * * *"
        />
        <button className="copy" onClick={() => copy(expr.trim())}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="legend">
        <span>minute</span>
        <span>hour</span>
        <span>day (month)</span>
        <span>month</span>
        <span>day (week)</span>
      </div>

      {parsed.ok && parsed.cron ? (
        <>
          <p className="describe">{describe(parsed.cron)}</p>

          <table className="fields">
            <tbody>
              {FIELD_META.map((m) => (
                <tr key={m.pos}>
                  <th>{m.name}</th>
                  <td className="mono">{parsed.cron![m.pos].raw}</td>
                  <td className="sum">{fieldSummary(parsed.cron!, m.pos)}</td>
                  <td className="rng">{m.range}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Next 7 runs</h2>
          <p className="tznote">Times shown in {tz}.</p>
          <ol className="runs">
            {runs.map((d, i) => (
              <li key={i}>
                <span className="when">{fmt(d)}</span>
                <span className="rel">{relative(d, now)}</span>
              </li>
            ))}
            {runs.length === 0 && <li className="none">No upcoming runs in the near future.</li>}
          </ol>
        </>
      ) : (
        <p className="error">{parsed.error}</p>
      )}

      <h2>Common schedules</h2>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.expr} onClick={() => setExpr(p.expr)} className={expr.trim() === p.expr ? 'on' : ''}>
            <b>{p.label}</b>
            <code>{p.expr}</code>
          </button>
        ))}
      </div>

      <section className="explainer">
        <h2>How cron expressions work</h2>
        <p>
          A cron expression is five fields separated by spaces. Each field controls one part of the
          schedule:
        </p>
        <pre>
{`┌───────────── minute (0–59)
│ ┌───────────── hour (0–23)
│ │ ┌───────────── day of month (1–31)
│ │ │ ┌───────────── month (1–12 or JAN–DEC)
│ │ │ │ ┌───────────── day of week (0–6 or SUN–SAT, 0 = Sunday)
│ │ │ │ │
* * * * *`}
        </pre>
        <h3>Field values</h3>
        <ul>
          <li>
            <code>*</code> — every value (“every minute”, “every day”, …).
          </li>
          <li>
            <code>5</code> — an exact value.
          </li>
          <li>
            <code>1-5</code> — a range (Monday to Friday).
          </li>
          <li>
            <code>*/15</code> — a step: every 15th value, starting from the lowest.
          </li>
          <li>
            <code>0,30</code> — a list of specific values.
          </li>
          <li>
            <code>10-16/2</code> — a step within a range.
          </li>
        </ul>
        <h3>The day-of-month / day-of-week trap</h3>
        <p>
          When <em>both</em> the day-of-month and day-of-week fields are restricted (neither is{' '}
          <code>*</code>), cron runs the job when <strong>either</strong> one matches, not both. So{' '}
          <code>0 0 13 * 5</code> fires every Friday <em>and</em> on the 13th of every month. This
          tool follows that same rule when it lists the next run times.
        </p>
        <h3>Examples</h3>
        <table>
          <thead>
            <tr>
              <th>Expression</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">*/5 * * * *</td>
              <td>Every 5 minutes</td>
            </tr>
            <tr>
              <td className="mono">0 9 * * 1-5</td>
              <td>09:00 on weekdays</td>
            </tr>
            <tr>
              <td className="mono">30 3 * * 0</td>
              <td>03:30 every Sunday</td>
            </tr>
            <tr>
              <td className="mono">0 0 1 * *</td>
              <td>Midnight on the 1st of every month</td>
            </tr>
            <tr>
              <td className="mono">0 */6 * * *</td>
              <td>Every 6 hours (00:00, 06:00, 12:00, 18:00)</td>
            </tr>
          </tbody>
        </table>
        <h3>What this tool does not cover</h3>
        <p>
          It handles the standard 5-field POSIX format. It does not parse the non-standard extras
          some schedulers add: seconds as a sixth field, macros like <code>@daily</code>, or the{' '}
          <code>L</code>, <code>W</code> and <code>#</code> characters (Quartz). Day-of-week{' '}
          <code>7</code> is accepted as Sunday.
        </p>
        <h3>Is my expression sent anywhere?</h3>
        <p>
          No. Parsing, the description and the next-run calculation all happen in your browser. The
          expression is only ever put in the page URL so you can bookmark or share it.
        </p>
        <footer>Cron Expression Helper · runs entirely client-side · no sign-up</footer>
      </section>
    </div>
  );
}
