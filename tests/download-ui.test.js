const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('descarga muestra preparacion, porcentaje, archivo y recupera controles ante errores', async () => {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { href: '/api/export/download', attrs: {}, events: {}, classList: { add() {}, remove() {} },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(k, fn) { this.events[k] = fn; } });
    return elements.get(id);
  };
  let saved, fail = false, release;
  const anchor = { click() { saved = this.download; }, remove() {} };
  const context = vm.createContext({
    document: { getElementById: el, createElement: () => anchor, body: { appendChild() {} } },
    window: { addEventListener() {}, removeEventListener() {} }, Date, Blob, AbortSignal,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout() {},
    fetch: async () => {
      await new Promise(resolve => { release = resolve; });
      if (fail) return { ok: false, json: async () => ({ error: 'Error de prueba' }) };
      let part = 0;
      return { ok: true, headers: { get: key => key === 'Content-Length' ? '4' : "attachment; filename*=UTF-8''Grilla%20prueba.xlsx" },
        body: { getReader: () => ({ read: async () => {
          if (part++ < 2) return { value: new Uint8Array(2), done: false };
          assert.equal(el('downloadBar').value, 99);
          return { done: true };
        } }) } };
    }
  });
  vm.runInContext(fs.readFileSync('public/js/download.js', 'utf8'), context);
  const event = { preventDefault() {}, currentTarget: el('downloadView') };
  const pending = el('downloadView').events.click(event);
  assert.match(el('downloadStatus').textContent, /Preparando/);
  assert.equal(el('downloadGrid').attrs['aria-disabled'], 'true');
  release(); await pending;
  assert.equal(saved, 'Grilla prueba.xlsx'); assert.equal(el('downloadBar').value, 100);
  assert.equal(el('downloadGrid').attrs['aria-disabled'], undefined);
  fail = true;
  const failed = el('downloadView').events.click(event); release(); await failed;
  assert.match(el('downloadStatus').textContent, /Error de prueba/);
  assert.equal(el('downloadView').attrs['aria-disabled'], undefined);
});
