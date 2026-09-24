// ledger-body.mjs — the shape of a wave ledger's text, read and rewritten without a forge.
//
// A ledger in the current format opens with its marker, carries its format on the next line, and
// is cut into sections each opened by `<!-- wave-section: <name> -->`, the names fixed whatever
// language the text is in (`references/wave-ledger.md`). Everything here is text in, text out:
// which comment holds it, and writing it back, are `ledger.mjs`'s.

export const FORMAT = 2;
export const SECTION_NAMES = ['header', 'batches', 'verdicts', 'decisions', 'constraints', 'queue',
  'expectations', 'journal', 'candidates'];

const FORMAT_LINE = /<!--\s*wave-ledger-format:\s*(\d{1,4})\s*-->/;
const SECTION_LINE = /^\s*<!--\s*wave-section:\s*([a-z-]+)\s*-->\s*$/;
const ARCHIVE_MARK = /<!--\s*wave-journal-(\d{1,6})\s*-->/g;
// Every marker a ledger's own text may carry; any other `wave-` marker in it is somebody's slip.
const KNOWN = /^(wave-ledger|wave-ledger-format:\s*\d+|wave-section:\s*[a-z-]+|wave-journal-\d{1,6})$/;
// An entry of a list: a bullet or a number at the start of a line.
const ITEM = /^(?:[-*]|\d+\.)\s/;

const bytes = (s) => Buffer.byteLength(s, 'utf8');

// Format 1 is every ledger written before the format line existed.
export const formatOf = (body) => {
  const m = FORMAT_LINE.exec(body);
  return m ? Number(m[1]) : 1;
};

// The sections in order, each with the lines it holds (its opening line excluded) and where it
// starts and ends in the body's lines.
export const sectionsOf = (body) => {
  const lines = body.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const m = SECTION_LINE.exec(line);
    if (m) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ name: m[1], start: i, end: lines.length });
    }
  });
  return { lines, sections: out };
};

// A section's entries: an item line and the lines that continue it, up to the next item or a
// blank line. Lines before the first item — a heading, a sentence — are no entry.
const entriesOf = (lines, s) => {
  const entries = [];
  let cur = null;
  for (let i = s.start + 1; i < s.end; i += 1) {
    const line = lines[i];
    if (ITEM.test(line)) { cur = { from: i, to: i + 1 }; entries.push(cur); }
    else if (line.trim() === '') cur = null;
    else if (cur) cur.to = i + 1;
  }
  return entries;
};

// What the text itself says is wrong with it — advisory: what blocks a chip is `faults`, read off
// the issue, and none of this is.
export const lint = (body, { budget, entryBytes = 700, journalBytes = 300 }) => {
  const found = [];
  const add = (rule, detail, section = null) => found.push({ rule, section, detail });
  const format = formatOf(body);
  if (format < FORMAT) add('format', `format ${format}, the current one being ${FORMAT}`);
  const size = bytes(body);
  if (size > budget) add('budget', `${size} bytes against a budget of ${budget}`);
  const { lines, sections } = sectionsOf(body);
  const names = sections.map((s) => s.name);
  if (format >= FORMAT) {
    for (const n of SECTION_NAMES) if (!names.includes(n)) add('section-missing', `no ${n} section`, n);
  }
  for (const n of new Set(names)) {
    if (!SECTION_NAMES.includes(n)) add('section-unknown', `a section named ${n}`, n);
    if (names.filter((x) => x === n).length > 1) add('section-twice', `${n} opens more than once`, n);
  }
  for (const m of body.matchAll(/<!--\s*(wave-[^>]*?)\s*-->/g)) {
    if (!KNOWN.test(m[1])) add('marker-unknown', `<!-- ${m[1]} --> is no ledger marker`);
  }
  for (const s of sections) {
    if (s.name === 'decisions' || s.name === 'constraints') {
      for (let i = s.start + 1; i < s.end; i += 1) {
        if (/^#{1,6}\s/.test(lines[i])) add('subsection', `a heading inside ${s.name}: ${lines[i].slice(0, 60)}`, s.name);
      }
      for (const e of entriesOf(lines, s)) {
        const text = lines.slice(e.from, e.to).join('\n');
        if (bytes(text) > entryBytes) add('entry-size', `an entry of ${bytes(text)} bytes, line ${e.from + 1}`, s.name);
        if (/~~[^~]+~~/.test(text)) add('struck', `a struck entry, line ${e.from + 1} — one lifted leaves`, s.name);
      }
    }
    if (s.name === 'journal') {
      for (const e of entriesOf(lines, s)) {
        const text = lines.slice(e.from, e.to).join('\n');
        if (e.to - e.from > 1 || bytes(text) > journalBytes) {
          add('journal-entry', `an entry of ${e.to - e.from} lines and ${bytes(text)} bytes, line ${e.from + 1}`, 'journal');
        }
      }
    }
  }
  return found;
};

// The journal's entries, oldest first, without the index line — the one that names archives.
export const journalOf = (body) => {
  const { lines, sections } = sectionsOf(body);
  const s = sections.find((x) => x.name === 'journal');
  if (!s) return { lines, section: null, entries: [] };
  const entries = entriesOf(lines, s).filter((e) => {
    ARCHIVE_MARK.lastIndex = 0;
    return !ARCHIVE_MARK.test(lines.slice(e.from, e.to).join('\n'));
  });
  return { lines, section: s, entries };
};

// The body with the `count` oldest journal entries taken out, and those entries' text.
export const takeOldest = (body, count) => {
  const { lines, entries } = journalOf(body);
  const taken = entries.slice(0, count);
  const drop = new Set();
  for (const e of taken) for (let i = e.from; i < e.to; i += 1) drop.add(i);
  return {
    body: lines.filter((_, i) => !drop.has(i)).join('\n'),
    moved: taken.map((e) => lines.slice(e.from, e.to).join('\n')),
  };
};

// The body with its archive index naming exactly `numbers`: the journal's index line rewritten
// where it stands, or put first in the journal where there was none.
export const withIndex = (body, numbers) => {
  const { lines, section } = journalOf(body);
  if (!section) return body;
  const index = `- archives: ${numbers.map((n) => `<!-- wave-journal-${n} -->`).join(' ')}`;
  for (let i = section.start + 1; i < section.end; i += 1) {
    ARCHIVE_MARK.lastIndex = 0;
    if (ARCHIVE_MARK.test(lines[i])) { lines[i] = index; return lines.join('\n'); }
  }
  lines.splice(section.start + 1, 0, index);
  return lines.join('\n');
};

export { bytes };
