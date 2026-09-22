// schema.mjs — checks a value against the subset of JSON Schema the files under
// schemas/ are written in.
//
// Those files are the one statement of what a finder, an engine and a verifier hand
// over. A hand-written copy of the same rules in code would drift from them the first
// time either changed, so the rules are read from the file itself. Only the keywords
// the files use are understood, and an unknown one is refused rather than skipped:
// skipping it would read as a rule that held.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const KNOWN = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
  'allOf', 'if', 'then', 'else',
]);

// One reader per schema directory, each file parsed once however many `$ref`s reach it.
export function schemaDir(dir) {
  const cache = new Map();
  return (file) => {
    if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    return cache.get(file);
  };
}

// `integer` before `number`: JSON has one number type, and a schema asking for an
// integer means a value with no fractional part, whatever its spelling.
const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};

// Every error carries where it is (`/candidates/2/severity`) and what is wrong, which
// is what the agent that submitted the value needs to fix it without guessing.
export function validate(load, file, pointer, value) {
  const errors = [];
  const resolve = (from, ref) => {
    const [target, fragment = ''] = ref.split('#');
    const owner = target || from;
    let node = load(owner);
    for (const key of fragment.split('/').filter(Boolean)) node = node === undefined ? undefined : node[key];
    if (node === undefined) throw new Error(`unresolvable $ref '${ref}' in ${from}`);
    return { owner, node };
  };
  const walk = (owner, schema, v, at) => {
    for (const k of Object.keys(schema)) {
      if (!KNOWN.has(k)) throw new Error(`schema keyword '${k}' in ${owner} is not one this checker understands`);
    }
    if (schema.$ref) {
      const r = resolve(owner, schema.$ref);
      walk(r.owner, r.node, v, at);
    }
    for (const sub of schema.allOf || []) walk(owner, sub, v, at);
    // `if` is a probe, not a rule: its own errors are discarded, only whether it held.
    if (schema.if) {
      const mark = errors.length;
      walk(owner, schema.if, v, at);
      const held = errors.length === mark;
      errors.length = mark;
      if (held && schema.then) walk(owner, schema.then, v, at);
      if (!held && schema.else) walk(owner, schema.else, v, at);
    }
    if (schema.type) {
      const t = typeOf(v);
      const want = [].concat(schema.type);
      if (!want.includes(t) && !(t === 'integer' && want.includes('number'))) {
        errors.push({ at, message: `must be ${want.join(' or ')}, not ${t}` });
        return;
      }
    }
    if (schema.enum && !schema.enum.includes(v)) {
      errors.push({ at, message: `must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
    }
    if ('const' in schema && schema.const !== v) {
      errors.push({ at, message: `must be ${JSON.stringify(schema.const)}` });
    }
    if (typeof v === 'string') {
      // Counted in code points, as the schema language counts them — a UTF-16 length
      // would hold a Cyrillic summary to half the cap a Latin one gets.
      const len = [...v].length;
      if (schema.minLength !== undefined && len < schema.minLength) errors.push({ at, message: `must be at least ${schema.minLength} characters` });
      if (schema.maxLength !== undefined && len > schema.maxLength) errors.push({ at, message: `must be at most ${schema.maxLength} characters` });
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(v)) errors.push({ at, message: `must match ${schema.pattern}` });
    }
    if (typeof v === 'number') {
      if (schema.minimum !== undefined && v < schema.minimum) errors.push({ at, message: `must be at least ${schema.minimum}` });
      if (schema.maximum !== undefined && v > schema.maximum) errors.push({ at, message: `must be at most ${schema.maximum}` });
    }
    if (Array.isArray(v)) {
      if (schema.minItems !== undefined && v.length < schema.minItems) errors.push({ at, message: `must have at least ${schema.minItems} item(s)` });
      if (schema.maxItems !== undefined && v.length > schema.maxItems) errors.push({ at, message: `must have at most ${schema.maxItems} item(s)` });
      if (schema.items) v.forEach((item, i) => walk(owner, schema.items, item, `${at}/${i}`));
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const key of schema.required || []) {
        if (!(key in v)) errors.push({ at: `${at}/${key}`, message: 'is required' });
      }
      const props = schema.properties || {};
      for (const [key, val] of Object.entries(v)) {
        if (key in props) walk(owner, props[key], val, `${at}/${key}`);
        else if (schema.additionalProperties === false) errors.push({ at: `${at}/${key}`, message: 'is not a field this schema has' });
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          walk(owner, schema.additionalProperties, val, `${at}/${key}`);
        }
      }
    }
  };
  const start = pointer ? resolve(file, `${file}#${pointer}`) : { owner: file, node: load(file) };
  walk(start.owner, start.node, value, '');
  return errors;
}
