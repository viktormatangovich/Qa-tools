// "Which request does this number come from?": the user picks an element on the page (a counter,
// a badge, a date, a table row) and its value is looked up in the captured response bodies.
// Paths are those of JsonTreeNode ("root.meta.total"), so a match can be opened in the tree.

import type { ApiRequest, StreamMessage } from '../types';
import { contentTypeOf, requestBodyTree } from './formBody.ts';

/** What content.js reports about the clicked element. */
export interface PickedElement {
  tag: string;
  text: string;
  attributes: Array<{ name: string; value: string }>;
  selector: string;
  /** Separate texts inside the element (cells of a row, lines of a card). */
  parts?: string[];
  /** Address of the frame when the element is inside an iframe. */
  frameUrl?: string;
}

/** How a shown number was converted to the stored one. */
export type DerivedNote = 'percent' | 'cents' | 'seconds' | 'milliseconds' | 'minutes';

/** One value read from the element: its text or an attribute. */
export interface ValueCandidate {
  /** "text", "part" or the attribute name. */
  source: string;
  raw: string;
  /** Exact numbers the text can mean ("1.234" → 1234 and 1.234). */
  numbers: number[];
  /** A shortened number ("1,2K") stands for a range of values. */
  ranges: Array<[number, number]>;
  /** The same quantity in another unit: 45% → 0.45, 12,50 ₽ → 1250, 2 ч → 7200 seconds. */
  derived: Array<{ value: number; note: DerivedNote }>;
  /** Moments the text can mean, [from, to) in epoch ms of the panel's time zone. */
  dates: Array<[number, number]>;
}

export type MatchKind = 'exact' | 'number' | 'converted' | 'date' | 'approx' | 'row' | 'length' | 'computed' | 'contains';

export interface MatchDetail {
  note?: DerivedNote;
  /** A value the page may compute: items with field = value counted, or a field summed up. */
  computed?: { op: 'count' | 'sum'; field: string; equals?: string | number | boolean | null };
  /** A row or a card: how many of its texts were found in one object. */
  row?: { matched: number; total: number };
}

/**
 * Where in the request the value was found: the response body, a response header, a URL parameter,
 * the request body, or a WebSocket/SSE message (shown as a pseudo-request, see streamRequests).
 */
export type MatchSection = 'response' | 'headers' | 'query' | 'requestBody' | 'stream';

export interface ValueMatch {
  request: ApiRequest;
  section: MatchSection;
  /** Tree path ("root.items.0"); for headers and URL parameters "root.<name>". */
  path: string;
  /** Containers to open in the tree so the matching node is visible. */
  ancestors: string[];
  /** Field name, or the array index. */
  key: string | number | null;
  value: unknown;
  kind: MatchKind;
  /** Which candidate matched ("text", "title"...). */
  source: string;
  score: number;
  detail?: MatchDetail;
  /** What to put into the response search; see searchTermFor. */
  term?: string;
}

// ---- Reading the shown text -------------------------------------------------------------------

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^(k|к|тыс\.?)$/i, 1e3],
  [/^(m|м|млн\.?|mln)$/i, 1e6],
  [/^(b|bn|млрд\.?)$/i, 1e9],
];

/** Parses "1 234", "1,234", "1.234", "12,5", "-3" into the numbers it may mean. */
function parseNumberToken(token: string): number[] {
  const sign = token.startsWith('-') || token.startsWith('−') ? -1 : 1;
  const body = token.replace(/^[-−+]/, '').replace(/[\s  '’]/g, '');
  if (!/^\d[\d.,]*$/.test(body) || /[.,]$/.test(body)) return [];
  const commas = (body.match(/,/g) || []).length;
  const dots = (body.match(/\./g) || []).length;
  const out: number[] = [];
  const push = (text: string) => {
    const value = Number(text);
    if (Number.isFinite(value) && !out.includes(sign * value)) out.push(sign * value);
  };
  if (commas && dots) {
    // The later separator is the decimal one: "1,234.5" and "1.234,5".
    const decimal = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    push(body.split(group).join('').replace(decimal, '.'));
  } else if (commas || dots) {
    const separator = commas ? ',' : '.';
    const count = commas || dots;
    const grouped = new RegExp(`^\\d{1,3}(\\${separator}\\d{3})+$`).test(body);
    if (grouped) push(body.split(separator).join(''));
    // "12,5" or "1.234" read as a decimal fraction as well.
    if (count === 1) push(body.replace(separator, '.'));
  } else {
    push(body);
  }
  return out;
}

// A plain space is a thousands separator only before a group of exactly three digits: "1 234".
// Digits after a letter ("d0482", "v2") are part of an id, not a number. Letters after the digits
// are allowed: they may be a suffix ("1,2K", "12шт").
const NUMBER_TOKEN = /(?<![\p{L}\d])[-−+]?\d(?:[\d  '’]|[.,](?=\d)| (?=\d{3}(?!\d)))*/gu;

const CURRENCY = /[₽₸$€£¥]|руб|тг\b|тенге|usd|eur|rub|kzt/i;

// ---- Dates ------------------------------------------------------------------------------------

const MONTHS: Array<[RegExp, number]> = [
  [/^(янв|jan)/i, 0], [/^(фев|feb)/i, 1], [/^(мар|mar)/i, 2], [/^(апр|apr)/i, 3],
  [/^(ма[йя]|may)/i, 4], [/^(июн|jun)/i, 5], [/^(июл|jul)/i, 6], [/^(авг|aug)/i, 7],
  [/^(сен|sep)/i, 8], [/^(окт|oct)/i, 9], [/^(ноя|nov)/i, 10], [/^(дек|dec)/i, 11],
];
const MONTH_WORD = '(?<mw>(?:янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-zа-яё]*\\.?)';
const TIME = '(?:[,\\s]+(?:в\\s+|at\\s+)?(?<h>\\d{1,2}):(?<mi>\\d{2})(?::(?<s>\\d{2}))?)?';

const DATE_PATTERNS: RegExp[] = [
  // 18.11.2026, 18/11/26, 18.11.2026 12:30
  new RegExp(`(?<![\\d.])(?<d>\\d{1,2})[./](?<mo>\\d{1,2})[./](?<y>\\d{4}|\\d{2})(?![\\d.])${TIME}`, 'giu'),
  // 2026-11-18, 2026-11-18 12:30, 2026-11-18T12:30:05
  new RegExp('(?<!\\d)(?<y>\\d{4})-(?<mo>\\d{2})-(?<d>\\d{2})(?:[T\\s](?<h>\\d{2}):(?<mi>\\d{2})(?::(?<s>\\d{2}))?)?', 'giu'),
  // 18 ноября 2026 г., 18 нояб., 18 Nov 2026
  new RegExp(`(?<!\\d)(?<d>\\d{1,2})\\s+${MONTH_WORD}(?:\\s+(?<y>\\d{4}))?(?:\\s*(?:г\\.?|года))?${TIME}`, 'giu'),
  // Nov 18, 2026
  new RegExp(`${MONTH_WORD}\\s+(?<d>\\d{1,2})(?:,?\\s+(?<y>\\d{4}))?${TIME}`, 'giu'),
];

/** Dates and times of a text as [from, to) ranges, and the parts of the text they took. */
function readDates(text: string): { ranges: Array<[number, number]>; spans: Array<[number, number]> } {
  const ranges: Array<[number, number]> = [];
  const spans: Array<[number, number]> = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (spans.some(([from, to]) => start < to && end > from)) continue;
      const groups = match.groups ?? {};
      const month = groups.mo ? Number(groups.mo) - 1 : MONTHS.find(([word]) => word.test(groups.mw ?? ''))?.[1];
      const day = Number(groups.d);
      const year = groups.y ? (groups.y.length === 2 ? 2000 + Number(groups.y) : Number(groups.y)) : new Date().getFullYear();
      if (month === undefined || month < 0 || month > 11 || day < 1 || day > 31) continue;
      const hours = groups.h ? Number(groups.h) : 0;
      const minutes = groups.mi ? Number(groups.mi) : 0;
      const seconds = groups.s ? Number(groups.s) : 0;
      if (hours > 23 || minutes > 59 || seconds > 59) continue;
      const date = new Date(year, month, day, hours, minutes, seconds);
      if (date.getDate() !== day || date.getMonth() !== month) continue; // 31.02 and the like
      const width = groups.s ? 1000 : groups.h ? 60000 : 86400000;
      ranges.push([date.getTime(), date.getTime() + width]);
      spans.push([start, end]);
    }
  }
  return { ranges, spans };
}

/** The moment a stored value means: unix seconds or milliseconds, or an ISO date (time). */
function leafMoment(value: unknown): number | null {
  let number: number | null = typeof value === 'number' ? value : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{10}(\.\d+)?$|^\d{13}$/.test(text)) number = Number(text);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split('-').map(Number);
      return new Date(year, month - 1, day).getTime(); // a bare date is a local day, not UTC
    } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
      const parsed = Date.parse(text.replace(' ', 'T'));
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  if (number === null) return null;
  if (number >= 1e9 && number < 1e10) return number * 1000;
  if (number >= 1e12 && number < 1e13) return number;
  return null;
}

// ---- Durations --------------------------------------------------------------------------------

const DURATION = /(?<![\p{L}\d.,])(\d+(?:[.,]\d+)?)\s*(дн[а-яё]*|д|days?|d|час[а-яё]*|ч|hours?|hrs?|h|мин[а-яё]*|min[a-z]*|сек[а-яё]*|с|sec[a-z]*|s)(?![\p{L}])/giu;

function unitSeconds(unit: string): number {
  const lower = unit.toLowerCase();
  if (/^(д|d)/.test(lower)) return 86400;
  if (/^(ч|h)/.test(lower)) return 3600;
  if (/^(мин|min)/.test(lower)) return 60;
  return 1;
}

/** "2 ч 5 мин", "1h 30min", "45 сек" as seconds; null when the text names no duration. */
function readDuration(text: string): { seconds: number; onlyMinutes: boolean } | null {
  let seconds = 0;
  let found = false;
  let onlyMinutes = true;
  for (const match of text.matchAll(DURATION)) {
    const unit = unitSeconds(match[2]);
    seconds += Number(match[1].replace(',', '.')) * unit;
    if (unit !== 60) onlyMinutes = false;
    found = true;
  }
  return found ? { seconds, onlyMinutes } : null;
}

// ---- Candidates -------------------------------------------------------------------------------

function addDerived(candidate: ValueCandidate, value: number, note: DerivedNote) {
  const rounded = Math.round(value * 1e6) / 1e6;
  if (candidate.numbers.includes(rounded) || candidate.derived.some((item) => item.value === rounded)) return;
  candidate.derived.push({ value: rounded, note });
}

/** Reads numbers, shortened numbers, percents, money, dates and durations of one text. */
export function parseDisplayedValue(raw: string, source = 'text'): ValueCandidate {
  const candidate: ValueCandidate = { source, raw, numbers: [], ranges: [], derived: [], dates: [] };
  const text = raw.trim();
  const dates = readDates(text);
  candidate.dates = dates.ranges;
  // The digits of a date are not numbers of their own: "18.11.2026" is not 18, 11 and 2026.
  let rest = text;
  for (const [from, to] of dates.spans) rest = rest.slice(0, from) + ' '.repeat(to - from) + rest.slice(to);

  const money = CURRENCY.test(text);
  for (const match of rest.matchAll(NUMBER_TOKEN)) {
    const token = match[0];
    const after = rest.slice((match.index ?? 0) + token.length).trimStart();
    const suffix = after.match(/^(тыс\.?|млн\.?|млрд\.?|mln|bn|[kmbкм])(?![a-zа-яё])/i)?.[1];
    const multiplier = suffix ? MULTIPLIERS.find(([pattern]) => pattern.test(suffix))?.[1] : undefined;
    for (const value of parseNumberToken(token)) {
      if (multiplier) {
        // "1,2K" is anything from 1150 to 1249: half of the last shown digit either way.
        const decimals = (String(Math.abs(value)).split('.')[1] || '').length;
        const half = (multiplier / 10 ** decimals) / 2;
        const centre = value * multiplier;
        candidate.ranges.push([centre - half, centre + half]);
        const rounded = Math.round(centre * 1e6) / 1e6;
        if (!candidate.numbers.includes(rounded)) candidate.numbers.push(rounded);
        continue;
      }
      if (!candidate.numbers.includes(value)) candidate.numbers.push(value);
      if (after.startsWith('%')) addDerived(candidate, value / 100, 'percent');
      if (money) addDerived(candidate, Math.round(value * 100), 'cents');
    }
  }

  const duration = readDuration(rest);
  if (duration && duration.seconds > 0) {
    addDerived(candidate, duration.seconds, 'seconds');
    addDerived(candidate, duration.seconds * 1000, 'milliseconds');
    if (!duration.onlyMinutes && duration.seconds % 60 === 0) addDerived(candidate, duration.seconds / 60, 'minutes');
  }
  return candidate;
}

/** Candidates of a picked element: its text first, then the attributes that carry a value. */
export function candidatesOf(element: Pick<PickedElement, 'text' | 'attributes'>): ValueCandidate[] {
  const list: ValueCandidate[] = [];
  const seen = new Set<string>();
  const add = (raw: string, source: string) => {
    const value = raw.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    list.push(parseDisplayedValue(value, source));
  };
  add(element.text, 'text');
  for (const attribute of element.attributes) add(attribute.value, attribute.name);
  return list;
}

/** Separate texts of a row or a card; fewer than two give nothing to compare as a row. */
export function partsOf(element: Pick<PickedElement, 'parts'>): ValueCandidate[] {
  const parts = [...new Set((element.parts ?? []).map((part) => part.trim()).filter(Boolean))].slice(0, 20);
  return parts.length >= 2 ? parts.map((part) => parseDisplayedValue(part, 'part')) : [];
}

// ---- Matching ---------------------------------------------------------------------------------

/** Field names that usually hold a counter rank higher. */
const COUNTER_KEY = /count|total|amount|qty|quantity|num|size|unread|badge|cnt|sum|length|колич/i;

const BARE_NUMBER = /^[-−+]?[\d\s  '’.,]+$/;

const KIND_SCORE: Record<MatchKind, number> = {
  exact: 100, number: 90, converted: 75, date: 75, approx: 60, row: 70, length: 50, computed: 45, contains: 25,
};

/** The response body as data: a JSON text is parsed, other text is searched as one string. */
function bodyData(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  const text = body.trim();
  if (!/^[[{]/.test(text)) return body;
  try {
    return JSON.parse(text);
  } catch {
    return body;
  }
}

function numberFromLeaf(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

interface NodeHit {
  kind: MatchKind;
  source: string;
  note?: DerivedNote;
}

/** How one node matches the candidates, the best kind first; null when it does not. */
function matchNode(value: unknown, candidates: ValueCandidate[]): NodeHit | null {
  let best: NodeHit | null = null;
  const consider = (hit: NodeHit) => {
    if (!best || KIND_SCORE[hit.kind] > KIND_SCORE[best.kind]) best = hit;
  };
  for (const candidate of candidates) {
    const { source } = candidate;
    if (Array.isArray(value)) {
      if (candidate.numbers.includes(value.length)) consider({ kind: 'length', source });
      continue;
    }
    if (value !== null && typeof value === 'object') continue;
    const text = value === null ? 'null' : String(value);
    const raw = candidate.raw.trim();
    if (text.trim().toLowerCase() === raw.toLowerCase()) {
      consider({ kind: 'exact', source });
      continue;
    }
    const number = numberFromLeaf(value);
    if (number !== null) {
      if (candidate.numbers.some((item) => same(item, number))) consider({ kind: 'number', source });
      else {
        const derived = candidate.derived.find((item) => same(item.value, number));
        if (derived) consider({ kind: 'converted', source, note: derived.note });
        else if (candidate.ranges.some(([from, to]) => number >= from && number < to)) consider({ kind: 'approx', source });
      }
    }
    if (candidate.dates.length) {
      const moment = leafMoment(value);
      if (moment !== null && candidate.dates.some(([from, to]) => moment >= from && moment < to)) consider({ kind: 'date', source });
    }
    // A text shown inside a longer string: only for texts long enough not to match everything,
    // and not for a bare number, which would light up every id, timestamp and link holding its digits.
    if (typeof value === 'string' && raw.length >= 3 && !BARE_NUMBER.test(raw) && value.toLowerCase().includes(raw.toLowerCase())) {
      consider({ kind: 'contains', source });
    }
  }
  return best;
}

type Primitive = string | number | boolean | null;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Values the page may compute from an array of objects: how many items have field = value
 * ("unread: true" → 12) and the sum of a numeric field.
 */
function computedValues(items: unknown[], targets: number[]): Array<NonNullable<MatchDetail['computed']> & { n: number }> {
  if (items.length < 2 || items.length > 5000 || !items.slice(0, 20).every(isPlainObject)) return [];
  const wanted = targets.filter((target) => Number.isFinite(target) && target >= 2);
  if (wanted.length === 0) return [];
  const fields = new Set<string>();
  for (const item of items.slice(0, 200)) {
    if (!isPlainObject(item)) continue;
    for (const key of Object.keys(item)) if (fields.size < 40) fields.add(key);
  }
  const found: Array<NonNullable<MatchDetail['computed']> & { n: number }> = [];
  for (const field of fields) {
    const counts = new Map<string, { value: Primitive; n: number }>();
    let sum = 0;
    let numeric = 0;
    let tooMany = false;
    for (const item of items) {
      const value = isPlainObject(item) ? item[field] : undefined;
      if (typeof value === 'number') {
        sum += value;
        numeric += 1;
      }
      const primitive = value === null || ['string', 'number', 'boolean'].includes(typeof value);
      if (tooMany || !primitive || (typeof value === 'string' && value.length > 60)) continue;
      const key = `${typeof value}:${String(value)}`;
      const entry = counts.get(key);
      if (entry) entry.n += 1;
      else if (counts.size >= 30) tooMany = true;
      else counts.set(key, { value: value as Primitive, n: 1 });
    }
    for (const target of wanted) {
      // Counting all items is the array length, reported on its own.
      for (const { value, n } of counts.values()) {
        if (n === target && n < items.length) found.push({ op: 'count', field, equals: value, n });
      }
      if (numeric >= 2 && same(sum, target)) found.push({ op: 'sum', field, n: target });
    }
    if (found.length >= 5) break;
  }
  return found.slice(0, 5);
}

/** Whether one part of a row is the stored value; returns the stored text to search for. */
function partHit(value: unknown, part: ValueCandidate): boolean {
  const hit = matchNode(value, [part]);
  if (!hit) return false;
  return hit.kind !== 'contains' || part.raw.trim().length >= 4;
}

/** Id prefix of the pseudo-requests made from WebSocket/SSE messages. */
export const STREAM_PREFIX = 'stream:';

/**
 * WebSocket and SSE messages as pseudo-requests, so that they are searched, listed and opened like
 * responses: the method says the protocol and direction, the body is the message (parsed JSON when
 * it is JSON). Binary frames are left out.
 */
export function streamRequests(messages: StreamMessage[]): ApiRequest[] {
  return messages
    .filter((message) => !message.binary && message.data)
    .map((message) => ({
      id: `${STREAM_PREFIX}${message.id}`,
      type: 'other',
      method: message.protocol === 'SSE' ? 'SSE' : message.direction === 'sent' ? 'WS ↑' : 'WS ↓',
      url: message.url,
      requestHeaders: {},
      requestBody: null,
      responseHeaders: {},
      responseBody: bodyData(message.data),
      status: 0,
      statusText: '',
      duration: 0,
      timestamp: message.timestamp,
      error: null,
      pageUrl: '',
      pageTitle: '',
    }) as ApiRequest);
}

/** URL parameters as an object; a repeated parameter becomes a list. */
function queryOf(url: string): Record<string, string | string[]> | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const result: Record<string, string | string[]> = {};
  params.forEach((value, name) => {
    const previous = result[name];
    result[name] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  });
  return Object.keys(result).length ? result : null;
}

/**
 * The parts of a request worth searching. Bodies come first; headers and parameters rank a little
 * lower, as a counter more often comes from a body. A header such as X-Total-Count still wins over
 * a plain body field thanks to the counter-name bonus.
 */
function sectionsOf(request: ApiRequest): Array<{ section: MatchSection; data: unknown; bonus: number; deep: boolean }> {
  const stream = request.id.startsWith(STREAM_PREFIX);
  const list: Array<{ section: MatchSection; data: unknown; bonus: number; deep: boolean }> = [];
  if (request.responseBody != null) list.push({ section: stream ? 'stream' : 'response', data: bodyData(request.responseBody), bonus: 0, deep: true });
  if (stream) return list;
  if (request.responseHeaders && Object.keys(request.responseHeaders).length) {
    list.push({ section: 'headers', data: request.responseHeaders, bonus: -5, deep: false });
  }
  const query = queryOf(request.url);
  if (query) list.push({ section: 'query', data: query, bonus: -15, deep: false });
  const body = requestBodyTree(request.requestBody, contentTypeOf(request.requestHeaders));
  if (body) list.push({ section: 'requestBody', data: body.data, bonus: -15, deep: true });
  return list;
}

export interface FindOptions {
  /** Upper bound of the result list. */
  limit?: number;
  /** Texts of a row or a card (partsOf): objects holding several of them are reported as rows. */
  parts?: ValueCandidate[];
}

/**
 * Looks the candidates up in every captured response with a body. Newer requests rank higher among
 * equal matches, as do field names that look like counters.
 */
export function findValueInRequests(requests: ApiRequest[], candidates: ValueCandidate[], options: FindOptions = {}): ValueMatch[] {
  const limit = options.limit ?? 300;
  const usable = candidates.filter((candidate) => candidate.raw.trim());
  const parts = options.parts ?? [];
  if (usable.length === 0 && parts.length === 0) return [];
  const needParts = Math.min(parts.length, Math.max(2, Math.ceil(parts.length / 2)));
  const targets = [...new Set(usable.flatMap((candidate) => candidate.numbers))];
  const ordered = [...requests].sort((a, b) => b.timestamp - a.timestamp);
  const matches: ValueMatch[] = [];

  ordered.forEach((request, order) => {
    for (const { section, data, bonus, deep } of sectionsOf(request)) {
      scan(request, section, data, Math.max(0, 10 - order) / 2 + bonus, deep);
    }
  });

  /**
   * Walks one part of a request. `deep` parts (bodies) also get computed values and rows; headers
   * and URL parameters are flat lists where neither means anything.
   */
  function scan(request: ApiRequest, section: MatchSection, data: unknown, extra: number, deep: boolean) {
    const push = (match: Omit<ValueMatch, 'request' | 'score' | 'section'>, base: number) =>
      matches.push({ ...match, request, section, score: base + extra });
    const rowParts = deep ? parts : [];

    /** Returns, for an object, the row parts found in it and in its nested objects. */
    const visit = (key: string | number | null, value: unknown, path: string, parents: string[]): Map<number, string> | null => {
      const hit = usable.length ? matchNode(value, usable) : null;
      if (hit) {
        let score = KIND_SCORE[hit.kind];
        if (typeof key === 'string' && COUNTER_KEY.test(key)) score += 20;
        if (hit.source !== 'text') score -= 5;
        push({ path, ancestors: parents, key, value, kind: hit.kind, source: hit.source, ...(hit.note ? { detail: { note: hit.note } } : {}) }, score);
      }
      if (value === null || typeof value !== 'object') return null;
      const next = [...parents, path];

      if (Array.isArray(value)) {
        for (const computed of deep ? computedValues(value, targets) : []) {
          const { n: _n, ...detail } = computed;
          push({ path, ancestors: parents, key, value, kind: 'computed', source: 'text', detail: { computed: detail }, term: detail.field }, KIND_SCORE.computed);
        }
        value.forEach((child, index) => void visit(index, child, `${path}.${index}`, next));
        return null; // a list holds many rows: its items are not one row together
      }

      const found = new Map<number, string>();
      let bestChild = 0;
      for (const [childKey, child] of Object.entries(value)) {
        const childFound = visit(childKey, child, `${path}.${childKey}`, next);
        if (childFound) {
          childFound.forEach((text, index) => found.set(index, text));
          bestChild = Math.max(bestChild, childFound.size);
        } else if (rowParts.length && (child === null || typeof child !== 'object')) {
          rowParts.forEach((part, index) => {
            if (!found.has(index) && partHit(child, part)) found.set(index, String(child));
          });
        }
      }
      // Report the smallest object holding the row, not each of its parents.
      if (rowParts.length && found.size >= needParts && found.size > bestChild) {
        const term = [...found.values()].filter((text) => text.length <= 60).sort((a, b) => b.length - a.length)[0];
        push(
          { path, ancestors: parents, key, value, kind: 'row', source: 'part', detail: { row: { matched: found.size, total: rowParts.length } }, term },
          KIND_SCORE.row + 10 * found.size + (20 * found.size) / rowParts.length,
        );
      }
      return found;
    };
    visit(null, data, 'root', []);
  }

  // A stable sort keeps the tree order inside one request among equal scores.
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A change of a watched element and the requests that may have brought the new value. */
export interface WatchedChange {
  at: number;
  from: string | null;
  to: string | null;
  /** Requests finished between the previous change (or the start of watching) and this one. */
  checked: number;
  /** Best matches of the new value among those requests; empty: the page computed it itself. */
  matches: ValueMatch[];
}

/**
 * Which requests explain a change of a watched element: the new value looked up only among the
 * requests that finished after `since` and no later than a second after the change (the response
 * handler runs before the DOM changes, but the capture may report the request a little late).
 */
export function explainChange(requests: ApiRequest[], change: { at: number; from: string | null; to: string | null }, since: number): WatchedChange {
  const recent = requests.filter((request) => {
    const end = request.timestamp + (request.duration || 0);
    return end >= since && end <= change.at + 1000;
  });
  const text = change.to?.trim() ?? '';
  const matches = text ? findValueInRequests(recent, candidatesOf({ text, attributes: [] }), { limit: 3 }) : [];
  return { at: change.at, from: change.from, to: change.to, checked: recent.length, matches };
}

/**
 * What to type into the response search so that the match is highlighted: the field value, the
 * shown text for a match inside a longer string, the field name for an array length or a computed
 * value, the longest matched text of a row.
 */
export function searchTermFor(match: ValueMatch, query: string): string {
  if (match.term) return match.term;
  if (match.kind === 'length') return typeof match.key === 'string' ? match.key : query.trim();
  if (match.kind === 'contains') return query.trim();
  return match.value === null ? 'null' : String(match.value);
}

/** Short text of a matched value for the result list. */
export function previewValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value !== null && typeof value === 'object') return '{…}';
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
