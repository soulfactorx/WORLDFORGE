/**
 * Lua 코드에서 데이터 표만 꺼낸다 — 코드는 절대 실행하지 않는다.
 * RisuAI 카드의 트리거 Lua에는 `EVENTS = { {...}, ... }`, `local RUIN_YEAR, RUIN_DAY = 429, 243` 같은
 * 원작 타임라인·상수가 들어 있는 경우가 많다. 이런 "리터럴 대입"만 정적으로 해석한다.
 * 함수 호출·연산식이 섞인 값은 건너뛴다.
 */

type LuaValue = string | number | boolean | null | LuaValue[] | { [k: string]: LuaValue };

class Parser {
  i = 0;
  constructor(readonly s: string) {}
  ws() {
    for (;;) {
      const c = this.s[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { this.i++; continue; }
      if (this.s.startsWith('--', this.i)) {
        if (this.s.startsWith('--[[', this.i)) { const e = this.s.indexOf(']]', this.i); this.i = e < 0 ? this.s.length : e + 2; }
        else { const e = this.s.indexOf('\n', this.i); this.i = e < 0 ? this.s.length : e + 1; }
        continue;
      }
      return;
    }
  }
  fail(): never { throw new Error(`lua literal parse error at ${this.i}`); }
  string(): string {
    const q = this.s[this.i];
    if (q === '[') {
      const m = /^\[(=*)\[/.exec(this.s.slice(this.i, this.i + 12));
      if (!m) this.fail();
      const close = `]${m[1]}]`;
      const start = this.i + m[0].length;
      const end = this.s.indexOf(close, start);
      if (end < 0) this.fail();
      this.i = end + close.length;
      return this.s.slice(start, end).replace(/^\n/, '');
    }
    this.i++;
    let out = '';
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined) this.fail();
      if (c === q) return out;
      if (c === '\\') {
        const n = this.s[this.i++];
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '' : n === '\n' ? '\n' : n ?? '';
      } else out += c;
    }
  }
  value(): LuaValue {
    this.ws();
    const c = this.s[this.i];
    if (c === '"' || c === "'" || (c === '[' && /^\[=*\[/.test(this.s.slice(this.i, this.i + 12)))) return this.string();
    if (c === '{') return this.table();
    const num = /^-?(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][-+]?\d+)?)/.exec(this.s.slice(this.i, this.i + 40));
    if (num) { this.i += num[0].length; return Number(num[0]); }
    for (const [w, v] of [['true', true], ['false', false], ['nil', null]] as const) {
      if (this.s.startsWith(w, this.i) && !/\w/.test(this.s[this.i + w.length] ?? '')) { this.i += w.length; return v; }
    }
    this.fail();
  }
  table(): LuaValue {
    this.i++; // {
    const arr: LuaValue[] = [];
    const obj: Record<string, LuaValue> = {};
    let hasKeys = false;
    for (;;) {
      this.ws();
      if (this.s[this.i] === '}') { this.i++; break; }
      let key: string | null = null;
      if (this.s[this.i] === '[' && !/^\[=*\[/.test(this.s.slice(this.i, this.i + 12))) {
        this.i++;
        const k = this.value();
        this.ws();
        if (this.s[this.i] !== ']') this.fail();
        this.i++;
        key = String(k);
        this.ws();
        if (this.s[this.i] !== '=') this.fail();
        this.i++;
      } else {
        const m = /^[A-Za-z_]\w*\s*=(?!=)/.exec(this.s.slice(this.i, this.i + 80));
        if (m) { key = m[0].replace(/\s*=$/, ''); this.i += m[0].length; }
      }
      const v = this.value();
      if (key !== null) { obj[key] = v; hasKeys = true; } else arr.push(v);
      this.ws();
      const sep = this.s[this.i];
      if (sep === ',' || sep === ';') { this.i++; continue; }
      if (sep === '}') { this.i++; break; }
      this.fail();
    }
    if (!hasKeys) return arr;
    arr.forEach((v, i) => { obj[String(i + 1)] = v; });
    return obj;
  }
}

/** 코드 맨 바깥(들여쓰기 없는 줄)의 `[local] 이름 = 리터럴` 대입을 모은다 */
export function extractLuaData(code: string, limits = { maxValues: 200, maxChars: 400_000 }): Record<string, LuaValue> {
  const out: Record<string, LuaValue> = {};
  const re = /^(?:local\s+)?([A-Za-z_][\w]*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=\s*(?!=)/gm;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(code)) && n < limits.maxValues) {
    const names = m[1]!.split(',').map((x) => x.trim());
    const p = new Parser(code);
    p.i = m.index + m[0].length;
    try {
      const values: LuaValue[] = [];
      for (let k = 0; k < names.length; k++) {
        values.push(p.value());
        if (k < names.length - 1) { p.ws(); if (code[p.i] !== ',') throw new Error('arity'); p.i++; }
      }
      // 같은 줄에 리터럴 뒤로 연산·호출이 이어지면(식이면) 버린다
      const eol = code.indexOf('\n', p.i);
      const rest = code.slice(p.i, eol < 0 ? code.length : eol).replace(/--.*$/, '').trim();
      if (rest && rest !== ';') continue;
      names.forEach((nm, k) => { out[nm] = values[k]!; n++; });
    } catch { /* 리터럴이 아닌 대입 */ }
  }
  // 너무 큰 값은 잘라낸다
  const json = JSON.stringify(out);
  if (json.length > limits.maxChars) {
    for (const k of Object.keys(out).sort((a, b) => JSON.stringify(out[b]).length - JSON.stringify(out[a]).length)) {
      delete out[k];
      if (JSON.stringify(out).length <= limits.maxChars) break;
    }
  }
  return out;
}

export type { LuaValue };
