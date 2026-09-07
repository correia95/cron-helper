// Standard 5-field cron parser: minute hour day-of-month month day-of-week.
// Supports  *  ,  -  /  and 3-letter names for months (JAN..DEC) and days (SUN..SAT).
// Day-of-week: 0 and 7 both mean Sunday. No @macros, no seconds, no L/W/#.

export interface CronField {
  values: number[]; // sorted, unique, in range
  raw: string;
  all: boolean; // true when the field was "*"
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

export interface ParseResult {
  ok: boolean;
  error?: string;
  cron?: ParsedCron;
}

type FieldName = 'minute' | 'hour' | 'dom' | 'month' | 'dow';

const RANGES: Record<FieldName, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 6],
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const MONTH_LABEL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nameToNum(token: string, field: FieldName): string {
  const t = token.toUpperCase();
  if (field === 'month') {
    const i = MONTHS.indexOf(t);
    if (i !== -1) return String(i + 1);
  }
  if (field === 'dow') {
    const i = DAYS.indexOf(t);
    if (i !== -1) return String(i);
  }
  return token;
}

function parseField(raw: string, field: FieldName): CronField {
  const [lo, hi] = RANGES[field];
  const all = raw === '*';
  const set = new Set<number>();

  for (let part of raw.split(',')) {
    part = part.trim();
    if (part === '') throw new Error(`empty item in "${raw}"`);

    let step = 1;
    const slash = part.split('/');
    if (slash.length > 2) throw new Error(`too many "/" in "${part}"`);
    if (slash.length === 2) {
      step = Number(slash[1]);
      if (!Number.isInteger(step) || step < 1) throw new Error(`bad step "${slash[1]}"`);
      part = slash[0];
    }

    let start = lo;
    let end = hi;
    if (part === '*' || part === '') {
      // full range
    } else if (part.includes('-')) {
      const [a, b] = part.split('-');
      start = Number(nameToNum(a, field));
      end = Number(nameToNum(b, field));
      if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error(`bad range "${part}"`);
    } else {
      start = Number(nameToNum(part, field));
      if (!Number.isInteger(start)) throw new Error(`"${part}" is not valid here`);
      end = slash.length === 2 ? hi : start; // "5/10" means from 5 to max
    }

    // dow: allow 7 as Sunday
    if (field === 'dow') {
      if (start === 7) start = 0;
      if (end === 7) end = 0;
    }

    if (start < lo || start > hi) throw new Error(`${start} out of range ${lo}-${hi}`);
    if (end < lo || end > hi) throw new Error(`${end} out of range ${lo}-${hi}`);

    if (start <= end) {
      for (let v = start; v <= end; v += step) set.add(v);
    } else {
      // wrap-around range e.g. FRI-MON or 22-3
      for (let v = start; v <= hi; v += step) set.add(v);
      for (let v = lo; v <= end; v += step) set.add(v);
    }
  }

  return { values: [...set].sort((a, b) => a - b), raw, all };
}

export function parseCron(expr: string): ParseResult {
  const parts = expr.trim().split(/\s+/);
  if (expr.trim() === '') return { ok: false, error: 'Enter a cron expression.' };
  if (parts.length !== 5) {
    return {
      ok: false,
      error: `Expected 5 fields (minute hour day month weekday), got ${parts.length}.`,
    };
  }
  const names: FieldName[] = ['minute', 'hour', 'dom', 'month', 'dow'];
  const out: Partial<ParsedCron> = {};
  for (let i = 0; i < 5; i++) {
    try {
      out[names[i]] = parseField(parts[i], names[i]);
    } catch (e) {
      return { ok: false, error: `Field ${i + 1} (${names[i]}): ${(e as Error).message}` };
    }
  }
  return { ok: true, cron: out as ParsedCron };
}

// ---------- next run times ----------

export function nextRuns(cron: ParsedCron, from: Date, count: number): Date[] {
  const out: Date[] = [];
  const domRestricted = !cron.dom.all;
  const dowRestricted = !cron.dow.all;

  const t = new Date(from.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1); // strictly after "from"

  let guard = 0;
  const maxIter = 500000;
  while (out.length < count && guard++ < maxIter) {
    const mo = t.getMonth() + 1;
    if (!cron.month.values.includes(mo)) {
      // jump to first day of next month
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    const dom = t.getDate();
    const dow = t.getDay();
    const domOk = cron.dom.values.includes(dom);
    const dowOk = cron.dow.values.includes(dow);
    // cron rule: if BOTH dom and dow are restricted, either matching is enough.
    let dayOk: boolean;
    if (domRestricted && dowRestricted) dayOk = domOk || dowOk;
    else if (domRestricted) dayOk = domOk;
    else if (dowRestricted) dayOk = dowOk;
    else dayOk = true;

    if (!dayOk) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hour.values.includes(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minute.values.includes(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    out.push(new Date(t.getTime()));
    t.setMinutes(t.getMinutes() + 1);
  }
  return out;
}

// ---------- human-readable description ----------

function list(nums: number[], label: (n: number) => string, conj = 'and'): string {
  const parts = nums.map(label);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${conj} ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} ${conj} ${parts[parts.length - 1]}`;
}

const isContiguous = (v: number[]) => v.length > 2 && v.every((n, i) => i === 0 || n === v[i - 1] + 1);

function dowPhrase(values: number[]): string {
  const s = [...values].sort((a, b) => a - b).join(',');
  if (s === '1,2,3,4,5') return 'on weekdays';
  if (s === '0,6') return 'on weekends';
  if (isContiguous(values)) return `${DAY_LABEL[values[0]]} through ${DAY_LABEL[values[values.length - 1]]}`;
  return `on ${list(values, (d) => DAY_LABEL[d])}`;
}

// Detect a simple "every N" step pattern from a value list over a range.
function stepOf(values: number[], lo: number, hi: number): number | null {
  if (values.length < 2) return null;
  const d = values[1] - values[0];
  if (d < 2) return null;
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== d) return null;
  }
  if (values[0] !== lo && values[0] !== 0) return null;
  if (values[values.length - 1] + d <= hi) return null;
  return d;
}

export function describe(cron: ParsedCron): string {
  const { minute, hour, dom, month, dow } = cron;

  // time-of-day clause
  let time: string;
  const minStep = stepOf(minute.values, 0, 59);
  const hrStep = stepOf(hour.values, 0, 23);

  const hourWindow = isContiguous(hour.values)
    ? `between ${pad(hour.values[0])}:00 and ${pad(hour.values[hour.values.length - 1])}:59`
    : `during ${list(hour.values, (h) => `${pad(h)}:00–${pad(h)}:59`)}`;

  if (minute.all && hour.all) {
    time = 'every minute';
  } else if (minStep && hour.all) {
    time = `every ${minStep} minutes`;
  } else if (minStep && !hour.all) {
    time = `every ${minStep} minutes, ${hourWindow}`;
  } else if (minute.values.length === 1 && minute.values[0] === 0 && hour.all) {
    time = 'every hour, on the hour';
  } else if (minute.all && !hour.all) {
    time = `every minute ${hourWindow}`;
  } else if (minute.values.length === 1 && hrStep && hour.values.length > 4) {
    const mm = minute.values[0];
    time =
      mm === 0
        ? `every ${hrStep} hours, on the hour`
        : `at ${mm} minute${mm === 1 ? '' : 's'} past the hour, every ${hrStep} hours`;
  } else if (minute.values.length === 1 && hour.values.length >= 1 && !hour.all) {
    const mm = minute.values[0];
    time = `at ${list(hour.values, (h) => `${pad(h)}:${pad(mm)}`)}`;
  } else if (minute.values.length >= 1 && hour.values.length === 1) {
    time = `at ${list(minute.values, (m) => `${pad(hour.values[0])}:${pad(m)}`)}`;
  } else {
    time = `at minute ${list(minute.values, String)} of hour ${list(hour.values, String)}`;
  }

  // day clause
  const clauses: string[] = [];
  const domStep = stepOf(dom.values, 1, 31);
  if (!dom.all) {
    if (domStep) clauses.push(`every ${domStep} days`);
    else clauses.push(`on the ${list(dom.values, ordinal)} of the month`);
  }
  if (!dow.all) {
    const dowStep = stepOf(dow.values, 0, 6);
    if (dowStep) clauses.push(`every ${dowStep} days of the week starting Sunday`);
    else clauses.push(dowPhrase(dow.values));
  }

  // month clause
  let monthClause = '';
  if (!month.all) {
    monthClause = `, in ${list(month.values, (m) => MONTH_LABEL[m - 1])}`;
  }

  let dayJoin = '';
  if (clauses.length === 1) dayJoin = ` ${clauses[0]}`;
  else if (clauses.length === 2) {
    // both dom and dow restricted → cron runs when EITHER matches
    dayJoin = ` ${clauses[0]} and ${clauses[1]} (whichever matches)`;
  } else {
    dayJoin = ' every day';
  }

  const sentence = `Runs ${time}${dayJoin}${monthClause}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const pad = (n: number) => String(n).padStart(2, '0');
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const PRESETS: { label: string; expr: string }[] = [
  { label: 'Every minute', expr: '* * * * *' },
  { label: 'Every 5 minutes', expr: '*/5 * * * *' },
  { label: 'Every 15 minutes', expr: '*/15 * * * *' },
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Every day at midnight', expr: '0 0 * * *' },
  { label: 'Every day at 9am', expr: '0 9 * * *' },
  { label: 'Weekdays at 8:30am', expr: '30 8 * * 1-5' },
  { label: 'Every Monday at 6pm', expr: '0 18 * * 1' },
  { label: 'First of the month', expr: '0 0 1 * *' },
  { label: 'Every Sunday midnight', expr: '0 0 * * 0' },
  { label: 'Every quarter', expr: '0 0 1 1,4,7,10 *' },
  { label: 'Twice a day', expr: '0 0,12 * * *' },
];

export function fmt(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${d.getDate()} ${MONTH_LABEL[d.getMonth()].slice(0, 3)} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relative(d: Date, from: Date): string {
  let s = Math.round((d.getTime() - from.getTime()) / 1000);
  if (s < 0) return 'now';
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let unit = 'second';
  let val = s;
  for (const [size, name] of units) {
    if (val < size) {
      unit = name;
      break;
    }
    val = Math.floor(val / size);
    unit = name;
  }
  return `in ${val} ${unit}${val === 1 ? '' : 's'}`;
}
