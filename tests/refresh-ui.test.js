const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness() {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      disabled: false, textContent: '', value: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}
    });
    return elements.get(selector);
  };
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [] },
    AbortController, AbortSignal, URLSearchParams, Intl, Date, console,
    MultiSelect: class { constructor() { this.values = []; } setOptions() {} setValues(values) { this.values = values; } },
    confirm: () => true,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8').replace(/loadSession\(\);\s*$/, '');
  vm.runInContext(source, context);
  context.reloads = 0;
  vm.runInContext('loadSummary = async () => { reloads++; }; loadStock = async () => { reloads++; };', context);
  return { context, element, async tick() {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id); await callback();
  } };
}

test('usuarios conecta los botones de contraseña y estado de todos los usuarios', async () => {
  const h = harness();
  const buttons = () => [1, 2].map(id => ({ dataset: { id: String(id), name: `Usuario ${id}`, active: 'true' },
    events: {}, addEventListener(event, callback) { this.events[event] = callback; } }));
  const passwords = buttons(), toggles = buttons();
  h.context.document.querySelectorAll = selector => selector === '.user-password' ? passwords : selector === '.user-toggle' ? toggles : [];
  h.element('#replacementPassword').focus = () => {};
  let changed;
  h.context.api = async (url, options) => {
    if (options) { changed = { url, body: JSON.parse(options.body) }; return { updated: true }; }
    return { data: [{ ID_USER: 1, USERNAME: 'UNO', ACTIVE: true }, { ID_USER: 2, USERNAME: 'DOS', ACTIVE: true }] };
  };
  await vm.runInContext('loadUsers()', h.context);
  for (const button of [...passwords, ...toggles]) assert.equal(typeof button.events.click, 'function');
  passwords[1].events.click();
  assert.equal(h.element('#passwordUserTitle').textContent, 'Cambiar contraseña de Usuario 2');
  await toggles[1].events.click();
  assert.deepEqual(changed, { url: '/api/users/2', body: { active: false } });
});

test('superadministrador puede elegir la empresa al crear un usuario', async () => {
  const h = harness();
  vm.runInContext('state.user = { role: "ADMIN", isSuperAdmin: true, companyName: "Atomik" };', h.context);
  let created;
  h.context.api = async (url, options) => {
    if (options) { created = JSON.parse(options.body); return { created: true }; }
    if (url.endsWith('/companies')) return { data: [{ ID_EMPRESA: 1, CODIGO: '0', NOMBRE: 'Atomik' }, { ID_EMPRESA: 2, CODIGO: '3000', NOMBRE: 'MIDING' }] };
    return { data: [] };
  };
  await vm.runInContext('loadUsers()', h.context);
  assert.match(h.element('#newUserCompany').innerHTML, /MIDING/);
  h.element('#newUserCompany').value = '2';
  h.context.event = { preventDefault() {}, target: { reset() {} } };
  await vm.runInContext('createUser(event)', h.context);
  assert.equal(created.companyId, 2);
  assert.equal(created.isSuperAdmin, undefined);
});

test('conserva seleccion entre paginas y aplica la accion a todos los seleccionados', async () => {
  const h = harness();
  vm.runInContext("state.user = { role: 'ADMIN' }; selectedProducts.add('A'); state.page = 2; selectedProducts.add('B');", h.context);
  h.context.product = { COD_ALFA: 'A' };
  assert.match(vm.runInContext('rowHtml(product)', h.context), /value="A" checked/);
  let sent;
  h.context.api = async (url, options) => { sent = JSON.parse(options.body); };
  await vm.runInContext("changeClassification('ACCIONADO')", h.context);
  assert.deepEqual(sent.codAlfas, ['A', 'B']);
  assert.equal(vm.runInContext('selectedProducts.size', h.context), 0);
});

test('sueltos muestra talles arriba y cantidades debajo sin casilla de reclasificacion', () => {
  const h = harness();
  vm.runInContext("state.user = { role: 'ADMIN' };", h.context);
  h.context.product = { GROUPED_SINGLE: true, DMODC: 'Soft', DCOLORC: 'Verde', STOCK: 9,
    SIZES: [{ label: 'S', stock: 5, items: [] }, { label: 'M', stock: 4, items: [] }] };
  const html = vm.runInContext('rowHtml(product)', h.context);
  assert.match(html, /<th scope="col">S<\/th><th scope="col">M<\/th>/);
  assert.match(html, /<td>5<\/td><td>4<\/td>/);
  assert.doesNotMatch(html, /row-check/);
});

test('precio base y alerta visual sin cambiar la clasificacion del producto', () => {
  const h = harness();
  vm.runInContext("state.user = { role: 'CONSULTA' };", h.context);
  h.context.product = { CLASSIFICATION: 'MODULOS', POSSIBLE_ACTIONED: true, PRICE_BASE: 50, PRICE_WHOLESALE: 40 };
  const html = vm.runInContext('rowHtml(product)', h.context);
  assert.match(html, /possible-actioned/);
  assert.match(html, /Posible accionado/);
  assert.match(html, /MODULOS/);
  assert.match(html, /50,00/);
  h.context.product.CLASSIFICATION = 'ACCIONADO';
  const confirmedHtml = vm.runInContext('rowHtml(product)', h.context);
  assert.match(confirmedHtml, /ACCIONADO/);
  assert.doesNotMatch(confirmedHtml, /possible-actioned|Posible accionado/);
  h.context.product.CLASSIFICATION = 'MODULOS';
  assert.match(vm.runInContext('rowHtml(product)', h.context), /Posible accionado/);
  h.context.product.POSSIBLE_ACTIONED = false;
  assert.doesNotMatch(vm.runInContext('rowHtml(product)', h.context), /possible-actioned|Posible accionado/);
});

test('termina al importar sin esperar un Excel ni la respuesta del POST', async () => {
  const h = harness();
  let phase = 0;
  h.context.api = async (url, options = {}) => {
    if (url === '/api/stock/filters') return { licenses: [], rubros: [], years: [], seasons: [], priceLists: [] };
    if (url === '/api/imports') return { data: [{ ID_IMPORT: phase ? '2' : '1', STATUS: phase === 1 ? 'RUNNING' : 'SUCCESS', ROW_COUNT: 6792, EXCEL_STATUS: null }] };
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
  };
  const running = vm.runInContext('refreshStock()', h.context);
  await new Promise(setImmediate);
  phase = 1; await h.tick();
  assert.equal(h.element('#refreshButton').textContent, 'Importando stock…');
  assert.equal(h.element('#refreshButton').disabled, true);
  phase = 2; await h.tick(); await running;
  assert.equal(h.element('#refreshButton').disabled, false);
  assert.match(h.element('#refreshProgress').textContent, /Actualización completa/);
  assert.doesNotMatch(h.element('#refreshProgress').textContent, /Excel/);
  assert.equal(h.context.reloads, 2);
});

test('un error del servidor libera el boton y muestra la causa', async () => {
  const h = harness();
  h.context.api = async url => {
    if (url === '/api/imports') return { data: [] };
    throw new Error('Archivo de stock inaccesible');
  };
  await vm.runInContext('refreshStock()', h.context);
  assert.equal(h.element('#refreshButton').disabled, false);
  assert.equal(h.element('#refreshProgress').textContent, 'Archivo de stock inaccesible');
});

test('la lista elegida viaja en consulta, descarga y reglas guardadas', async () => {
  const h = harness();
  h.context.api = async () => ({ priceLists: [
    { value: '["93","17"]', label: 'Lista 93 — version 17' },
    { value: '["94","12"]', label: 'Lista 94 — version 12' }
  ], licenses: [], rubros: [], years: [], seasons: [] });
  await vm.runInContext('loadFilters()', h.context);
  assert.equal(h.element('#priceListField').hidden, false);
  assert.equal(h.element('#priceListFilter').value, '["93","17"]');
  h.element('#priceListFilter').value = '["94","12"]';
  assert.equal(vm.runInContext('currentRules().priceList', h.context), '["94","12"]');
  assert.equal(vm.runInContext('rulesParams(currentRules()).get("priceList")', h.context), '["94","12"]');
  assert.notEqual(vm.runInContext('normalizedRulesKey(currentRules())', h.context), vm.runInContext('normalizedRulesKey({...currentRules(),priceList: ""})', h.context));
});
