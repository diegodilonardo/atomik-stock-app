const state = { user: null, type: '', page: 1, pageSize: 50, total: 0, searchTimer: null };

const viewCompanyId = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('company') || '';

const selectedProducts = new Set();

let selectionScope = '';

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) => [...document.querySelectorAll(selector)];

const pickers = {

  brand: new MultiSelect($('#brandFilter'), 'Marca', 'Todas las marcas'),

  license: new MultiSelect($('#licenseFilter'), 'Licencia', 'Todas las licencias'),

  rubro: new MultiSelect($('#rubroFilter'), 'Rubro', 'Todos los rubros'),

  year: new MultiSelect($('#yearFilter'), 'Año', 'Todos los años'),

  season: new MultiSelect($('#seasonFilter'), 'Temporada', 'Todas las temporadas'),

  level: new MultiSelect($('#levelFilter'), 'Tipo producto', 'Todos los tipos de producto')

};

pickers.level.setOptions(['950', '900']);

let selectedGrid = null;

let selectedExcelColumns;

const excelColumnOptions = { image:'Imagen', year:'Año', model:'Modelo', color:'Color', curve:'Curva (módulos)', pairs:'Pares por talle (módulos)', sex:'Sexo', age:'Edad', discipline:'Disciplina', wholesale:'Precio mayorista', public:'Precio público', base:'Precio base', brand:'Marca', license:'Licencia' };

const defaultExcelColumns = Object.keys(excelColumnOptions).filter(key => !['base','brand','license'].includes(key));

function renderExcelColumns() {

  const selected = selectedExcelColumns || defaultExcelColumns;

  $('#excelColumns').innerHTML = Object.entries(excelColumnOptions).map(([key,label]) => `<label><input type="checkbox" data-column="${key}" ${selected.includes(key) ? 'checked' : ''}> ${label}</label>`).join('');

}

$('#excelColumns').addEventListener('change', () => {

  selectedExcelColumns = $$('#excelColumns input:checked').map(input => input.dataset.column);

  renderGridState();

  $('#downloadView').href = '/api/export/download?' + rulesParams(currentRules());

});





async function api(url, options = {}) {

  const { timeoutMs = 20000, ...fetchOptions } = options;

  const response = await fetch(url, {

    ...fetchOptions,

    headers: { 'Content-Type': 'application/json', ...(viewCompanyId && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/logout') ? { 'X-Company-ID': viewCompanyId } : {}), ...(fetchOptions.headers || {}) },

    signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs)

  });

  if (response.status === 401) { showLogin(); throw new Error('La sesión venció'); }

  const data = response.status === 204 ? null : await response.json();

  if (!response.ok) throw new Error(data?.error || 'No se pudo completar la operación');

  return data;

}



function money(value) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value || 0)); }

function integer(value) { return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(value || 0)); }

function dateTime(value) { return value ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(value)) : 'Sin actualizaciones'; }

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }



function toast(message, isError = false) {

  const element = $('#toast'); element.textContent = message;

  element.classList.toggle('error-toast', isError); element.classList.remove('hidden');

  setTimeout(() => element.classList.add('hidden'), 4200);

}



function showLogin() { clearPasswordForm(); $('#companyModal').classList.add('hidden'); $('#usersModal').classList.add('hidden'); $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }

async function showApp() {

  $('#viewCompanyField').classList.toggle('hidden', !state.user.isSuperAdmin);

  if (state.user.isSuperAdmin) {

    const companies = (await api('/api/auth/companies')).data;

    $('#viewCompany').innerHTML = companies.map(company => `<option value="${company.ID_EMPRESA}">${escapeHtml(company.NOMBRE)} (${escapeHtml(company.CODIGO)})</option>`).join('');

    $('#viewCompany').value = String(state.user.companyId);

    $('#viewCompanyHint').textContent = 'Administrando la empresa seleccionada';

  }

  selectedProducts.clear(); selectionScope = '';

  for (const picker of Object.values(pickers)) picker.setValues([]);

  selectedGrid = null; $('#positiveStock').checked = false; $('#gridName').value = '';

  renderSchedule();

  applyGridRules({});

  renderGridState(); loadGrids().catch(error => toast(error.message, true));

  await loadFilters();

  $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');

  $('#companyName').textContent = state.user.companyName;

  $('#companyHeading').textContent = `GRILLA ${state.user.companyName}`;

  $('#userName').textContent = state.user.name; $('#userRole').textContent = state.user.isSuperAdmin ? 'Superadministrador' : state.user.role;

  document.body.classList.toggle('is-consultation', state.user.role !== 'ADMIN');

  $$('.admin-only').forEach((element) => element.classList.toggle('hidden', state.user.role !== 'ADMIN'));

}



async function login(event) {

  event.preventDefault(); $('#loginError').textContent = '';

  try {

    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#loginUser').value, password: $('#loginPassword').value }) });

    if (viewCompanyId) { location.assign(location.pathname); return; }

    state.user = data.user; state.page = 1; state.type = ''; $('#searchInput').value = ''; await showApp(); await Promise.all([loadSummary(), loadStock()]);

  } catch (error) { $('#loginError').textContent = error.message; }

}



async function loadSession() {

  try { state.user = (await api('/api/auth/me')).user; await showApp(); await Promise.all([loadSummary(), loadStock()]); }

  catch { showLogin(); }

}



let summaryRequestVersion = 0;
async function loadSummary() {

  const version = ++summaryRequestVersion;
  const params = new URLSearchParams();
  for (const key of ['year','season','rubro','license','brand']) for (const value of pickers[key].values) params.append(key, value);
  const data = await api('/api/stock/summary?' + params);
  if (version !== summaryRequestVersion) return;
  const summary = data.stock || {};

  $('#productsCount').textContent = integer(summary.ROWS_COUNT);

  $('#stockTotal').textContent = integer(summary.STOCK_TOTAL);

  $('#moduleStock').textContent = integer(summary.MODULE_STOCK);

  $('#singleStock').textContent = integer(summary.SINGLE_STOCK);

  $('#lastUpdate').textContent = `Última actualización válida: ${dateTime(data.lastImport?.FINISHED_AT || summary.LAST_UPDATE)}`;



}



function productPhoto(row) {
  const params = new URLSearchParams({ code: row.COD_ALFA, viewCompanyId: String(state.user.companyId) });
  if (viewCompanyId) params.set('viewCompanyId', viewCompanyId);
  return `<td class="product-photo-cell"><button type="button" class="product-photo" aria-label="${escapeHtml('Ampliar foto de ' + row.DMODC)}"><img loading="lazy" decoding="async" src="/api/stock/image?${escapeHtml(params.toString())}" alt="${escapeHtml(row.DMODC + ' ' + row.DCOLORC)}"><span hidden>Sin imagen</span></button></td>`;
}
function rowHtml(row) {

  if (row.GROUPED_SINGLE) return singleRowHtml(row);

  const adminCell = state.user.role === 'ADMIN' ? `<td><input class="row-check" type="checkbox" value="${escapeHtml(row.COD_ALFA)}"${selectedProducts.has(row.COD_ALFA) ? ' checked' : ''}></td>` : '';

  const possibleActioned = row.CLASSIFICATION !== 'ACCIONADO' && (row.POSSIBLE_ACTIONED === true || row.POSSIBLE_ACTIONED === 1);

  const alert = possibleActioned ? '<span class="actioned-warning" title="El precio mayorista por par es menor que el precio base por par">Posible accionado</span>' : '';

  return `<tr${possibleActioned ? ' class="possible-actioned"' : ''}>${adminCell}${productPhoto(row)}<td><span class="tag">${escapeHtml(row.CLASSIFICATION)}</span>${alert}</td><td>${escapeHtml(row.COD_ANIO || '—')}</td><td>${escapeHtml(row.DMODC)}</td><td>${escapeHtml(row.DCOLORC)}</td>

    <td>${escapeHtml(row.NIVEL === 950 ? row.DTALLC : row.TALLC)}</td><td>${escapeHtml(row.SEXO)}</td><td>${escapeHtml(row.EDAD)}</td><td>${escapeHtml(row.DISCIPLINA)}</td>

    <td>${escapeHtml(row.COD_ALFA)}</td><td class="number">${integer(row.STOCK)}</td><td class="number">${row.PRICE_BASE == null ? '—' : money(row.PRICE_BASE)}</td><td class="number">${row.PRICE_WHOLESALE == null ? '—' : money(row.PRICE_WHOLESALE)}</td><td class="number">${money(row.PRICE_PUBLIC)}</td></tr>`;

}



function singleRowHtml(row) {

  const sizes = `<table class="size-stock" aria-label="Talles y stock"><thead><tr>${row.SIZES.map(size => `<th scope="col">${escapeHtml(size.label)}</th>`).join('')}</tr></thead><tbody><tr>${row.SIZES.map(size => `<td>${integer(size.stock)}</td>`).join('')}</tr></tbody></table>`;

  const details = `<details><summary>Ver por talle</summary>${row.SIZES.map(size => size.items.map(item => `<div class="size-detail"><strong>${escapeHtml(size.label)}</strong> · ${escapeHtml(item.code)} · Depósito ${escapeHtml(item.depot)} · Stock ${integer(item.stock)}<br>Base: ${item.base == null ? '—' : money(item.base)} · Mayorista: ${item.wholesale == null ? '—' : money(item.wholesale)} · Público: ${item.public == null ? '—' : money(item.public)}</div>`).join('')).join('')}</details>`;

  const price = value => value == null ? 'Ver por talle' : money(value);

  return `<tr${row.POSSIBLE_ACTIONED ? ' class="possible-actioned"' : ''}>${state.user.role === 'ADMIN' ? '<td></td>' : ''}${productPhoto(row)}<td><span class="tag">SUELTOS</span>${row.POSSIBLE_ACTIONED ? '<span class="actioned-warning">Posible accionado</span>' : ''}</td><td>${escapeHtml(row.COD_ANIO || '—')}</td><td>${escapeHtml(row.DMODC)}</td><td>${escapeHtml(row.DCOLORC)}</td><td>${sizes}</td><td>${escapeHtml(row.SEXO)}</td><td>${escapeHtml(row.EDAD)}</td><td>${escapeHtml(row.DISCIPLINA)}</td><td>${details}</td><td class="number">${integer(row.STOCK)}</td><td class="number">${price(row.PRICE_BASE)}</td><td class="number">${price(row.PRICE_WHOLESALE)}</td><td class="number">${price(row.PRICE_PUBLIC)}</td></tr>`;

}



let passwordUserId = null;

function clearPasswordForm() {

  passwordUserId = null;

  $('#replacementPassword').value = ''; $('#confirmPassword').value = '';

  $('#passwordError').textContent = ''; $('#changePasswordForm').classList.add('hidden');

}

$('#cancelPassword').addEventListener('click', clearPasswordForm);

$('#changePasswordForm').addEventListener('submit', async event => {

  event.preventDefault();

  if (!passwordUserId) return;

  const id = passwordUserId;

  const password = $('#replacementPassword').value;

  const confirmation = $('#confirmPassword').value;

  if (password !== confirmation) { $('#passwordError').textContent = 'Las contraseñas no coinciden'; return; }

  $('#savePassword').disabled = true; $('#passwordError').textContent = '';

  try {

    await api('/api/users/' + id + '/password', { method: 'PUT', body: JSON.stringify({ password, confirmation }) });

    if (passwordUserId === id) clearPasswordForm();

    toast('Contraseña actualizada.');

  } catch (error) { if (passwordUserId === id) $('#passwordError').textContent = error.message; }

  finally { $('#savePassword').disabled = false; }

}

);

let editingUserId = null;
function cancelUserEdit() {
  editingUserId = null;
  $('#userForm').reset();
  $('#newPassword').required = true;
  $('#newPassword').parentElement.classList.remove('hidden');
  $('#userForm button[type="submit"]').textContent = 'Crear usuario';
  $('#cancelUserEdit').classList.add('hidden');
}
async function loadUsers() {

  const result = await api('/api/users');

  const superAdmin = Boolean(state.user?.isSuperAdmin);

  $('#newUserCompanyField').classList.toggle('hidden', !superAdmin);

  $('#userCompanyAssignment').textContent = superAdmin ? 'Administración general: elegí la empresa a la que ingresará cada usuario.' : `Empresa asignada: ${state.user?.companyName || ''}. Los usuarios creados aquí ingresan directamente a esta empresa.`;

  if (superAdmin) {

    const companies = (await api('/api/users/companies')).data;

    const selected = $('#newUserCompany').value;

    $('#newUserCompany').innerHTML = companies.map(company => `<option value="${company.ID_EMPRESA}">${escapeHtml(company.NOMBRE)} (${escapeHtml(company.CODIGO)})</option>`).join('');

    if (companies.some(company => String(company.ID_EMPRESA) === selected)) $('#newUserCompany').value = selected;

  }

  $('#userRows').innerHTML = result.data.map((user) => `<tr><td>${escapeHtml(user.USERNAME)}</td><td>${escapeHtml(user.FULL_NAME)}</td><td>${escapeHtml(user.COMPANY_NAME)}</td><td>${user.IS_SUPERADMIN ? 'Superadministrador' : escapeHtml(user.ROLE)}</td>

    <td class="${user.ACTIVE ? 'status-active' : 'status-inactive'}">${user.ACTIVE ? 'Activo' : 'Inactivo'}</td>

    <td>${!user.IS_SUPERADMIN || superAdmin ? `<button class="secondary user-password" data-id="${user.ID_USER}" data-name="${escapeHtml(user.USERNAME)}">Cambiar contraseña</button>` : ''} ${!user.IS_SUPERADMIN ? `<button class="secondary user-edit" data-id="${user.ID_USER}">Editar</button> <button class="secondary user-toggle" data-id="${user.ID_USER}" data-active="${user.ACTIVE ? 'true' : 'false'}">${user.ACTIVE ? 'Desactivar' : 'Activar'}</button>` : ''}</td></tr>`).join('');

  $$('.user-edit').forEach(button => button.addEventListener('click', () => {
    const user = result.data.find(item => item.ID_USER === Number(button.dataset.id));
    editingUserId = user.ID_USER;
    $('#newUsername').value = user.USERNAME;
    $('#newFullName').value = user.FULL_NAME;
    $('#newRole').value = user.ROLE;
    $('#newUserCompany').value = String(user.ID_EMPRESA);
    $('#newPassword').value = '';
    $('#newPassword').required = false;
    $('#newPassword').parentElement.classList.add('hidden');
    $('#userForm button[type="submit"]').textContent = 'Guardar cambios';
    $('#cancelUserEdit').classList.remove('hidden');
    $('#newUsername').focus();
  }));
  $$('.user-password').forEach(button => button.addEventListener('click', () => {

    clearPasswordForm();

    passwordUserId = Number(button.dataset.id);

    $('#passwordUserTitle').textContent = `Cambiar contraseña de ${button.dataset.name}`;

    $('#changePasswordForm').classList.remove('hidden');

    $('#replacementPassword').focus();

  }));

  $$('.user-toggle').forEach((button) => button.addEventListener('click', async () => {

    try {

      await api(`/api/users/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== 'true' }) });

      await loadUsers();

    } catch (error) { toast(error.message, true); }

  }));

}



async function createUser(event) {

  event.preventDefault();

  try {

    await api(editingUserId ? `/api/users/${editingUserId}` : '/api/users', { method: editingUserId ? 'PUT' : 'POST', body: JSON.stringify({

      username: $('#newUsername').value, fullName: $('#newFullName').value,

      password: $('#newPassword').value, role: $('#newRole').value,

      ...(state.user.isSuperAdmin ? { companyId: Number($('#newUserCompany').value) } : {})

    }) });

    const editedSelf = editingUserId === state.user.id;
    toast(editingUserId ? 'Usuario actualizado.' : 'Usuario creado.'); cancelUserEdit();
    if (editedSelf) await loadSession();
    await loadUsers();

  } catch (error) { toast(error.message, true); }

}



async function loadFilters() {

  const data = await api('/api/stock/filters');

  const lists = data.priceLists || [];

  const previous = $('#priceListFilter').value;

  $('#priceListField').hidden = !lists.length;

  $('#priceListFilter').innerHTML = lists.length

    ? lists.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('')

    : '<option value="">Precio habitual</option>';

  $('#priceListFilter').value = lists.some(item => item.value === previous) ? previous : (lists[0]?.value || '');

  pickers.brand.setOptions(data.brands || []);

  pickers.license.setOptions(data.licenses); pickers.rubro.setOptions(data.rubros); pickers.year.setOptions(data.years); pickers.season.setOptions(data.seasons);

}



function currentRules() {

  return { excelColumns: selectedExcelColumns, brand: pickers.brand.values, priceList: $('#priceListFilter').value, license: pickers.license.values, rubro: pickers.rubro.values, year: pickers.year.values, season: pickers.season.values,

    actioned: $('#actionedFilter').value, level: pickers.level.values, type: state.type, search: $('#searchInput').value.trim(), positiveStock: $('#positiveStock').checked };

}

function rulesParams(rules) {

  const params = new URLSearchParams({ priceList: rules.priceList || '', actioned: rules.actioned || '', type: rules.type, search: rules.search, positiveStock: String(rules.positiveStock) });

  if (viewCompanyId) params.set('viewCompanyId', viewCompanyId);

  if (rules.excelColumns !== undefined) params.set('excelColumns', JSON.stringify(rules.excelColumns));

  for (const key of ['brand', 'license', 'rubro', 'year', 'season', 'level']) for (const value of rules[key]) params.append(key, value);

  return params;

}



let stockRequestVersion = 0;

function updateSelection() {

  const boxes = $$('.row-check');

  boxes.forEach(box => { box.checked = selectedProducts.has(box.value); });

  const checked = boxes.filter(box => box.checked).length;

  $('#selectAll').checked = boxes.length > 0 && checked === boxes.length;

  $('#selectAll').indeterminate = checked > 0 && checked < boxes.length;

  $('#selectionCount').textContent = `${selectedProducts.size} producto(s) seleccionado(s)`;

  $('#clearSelection').disabled = selectedProducts.size === 0;

}

async function loadStock() {

  const requestVersion = ++stockRequestVersion;

  const params = rulesParams(currentRules());

  if (selectionScope !== params.toString()) {

    selectedProducts.clear(); selectionScope = params.toString(); updateSelection();

  }

  $('#downloadView').href = '/api/export/download?' + params;

  params.set('page', state.page); params.set('pageSize', state.pageSize);

  params.set('groupSizes', '1');

  renderGridState();

  const [result] = await Promise.all([api(`/api/stock?${params}`), loadSummary()]);

  if (requestVersion !== stockRequestVersion) return;

  state.total = result.total;

  $('#stockRows').innerHTML = result.data.map(rowHtml).join('') || `<tr><td colspan="${state.user.role === 'ADMIN' ? 15 : 14}">No se encontraron productos.</td></tr>`;

  const from = state.total ? (state.page - 1) * state.pageSize + 1 : 0;

  const to = Math.min(state.page * state.pageSize, state.total);

  $('#pageInfo').textContent = `${from}–${to} de ${integer(state.total)}${result.grouped ? ' modelos y colores con stock' : ''}`;

  $('#sizeColumnTitle').textContent = result.grouped ? 'Talles y stock' : 'Curva / talle';

  $('#prevPage').disabled = state.page <= 1; $('#nextPage').disabled = to >= state.total;

  updateSelection();

}



async function changeClassification(classification) {

  const codAlfas = [...selectedProducts];

  if (codAlfas.length > 500) return toast('Podés actualizar hasta 500 productos por operación.', true);

  if (!codAlfas.length) return toast('Seleccioná al menos un producto.', true);

  try {

    await api('/api/stock/classification', { method: 'PATCH', body: JSON.stringify({ codAlfas, classification }) });

    codAlfas.forEach(code => selectedProducts.delete(code)); updateSelection();

    toast(`${codAlfas.length} producto(s) actualizado(s).`); await loadStock();

  } catch (error) { toast(error.message, true); }

}



async function refreshStock() {

  if (!confirm('¿Importar ahora el stock de la empresa?')) return;

  const button = $('#refreshButton');

  const progress = $('#refreshProgress');

  button.disabled = true; button.textContent = 'Importando stock…';

  progress.classList.remove('hidden');

  progress.textContent = 'Consultando el estado de la actualización…';

  let monitoring = true, timer, previousId, completed = false;

  const controller = new AbortController();

  const checkProgress = async () => {

    try {

      const latest = (await api('/api/imports')).data[0];

      if (!monitoring || !latest || String(latest.ID_IMPORT) === previousId) return;

      if (latest.STATUS === 'SUCCESS') {

        completed = true;

        controller.abort();

        progress.textContent = `Actualización completa: ${integer(latest.ROW_COUNT)} registros importados.`;

        button.disabled = false; button.textContent = 'Actualizar stock';

        monitoring = false;

        await loadFilters();

        await Promise.all([loadSummary(), loadStock()]);

      } else if (latest.STATUS === 'ERROR') {

        completed = true;

        controller.abort();

        progress.textContent = latest.ERROR_MESSAGE || 'La actualización terminó con un error.';

        button.disabled = false; button.textContent = 'Actualizar stock';

        monitoring = false;

      }

    } catch {

      if (monitoring) progress.textContent = 'No se pudo consultar el avance. El servidor puede seguir procesando; no repitas la actualización todavía.';

    } finally {

      if (monitoring) timer = setTimeout(checkProgress, 4000);

    }

  };

  try {

    previousId = String((await api('/api/imports')).data[0]?.ID_IMPORT || '');

    progress.textContent = 'Importando el archivo de stock…';

    timer = setTimeout(checkProgress, 1500);

    const result = await api('/api/imports/run', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]) });

    progress.textContent = `Actualización completa: ${integer(result.rowCount)} registros importados.`;

    toast(`Actualización completa: ${integer(result.rowCount)} registros.`);

    await loadFilters();

    await Promise.all([loadSummary(), loadStock()]);

  } catch (error) {

    if (!completed) {

      const message = ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)

        ? 'Se perdió la respuesta del servidor. El proceso puede continuar; recargá la página para consultar su estado antes de reintentar.'

        : error.message;

      progress.textContent = message; toast(message, true);

    }

  } finally {

    monitoring = false; clearTimeout(timer);

    button.disabled = false; button.textContent = 'Actualizar stock';

  }

}



$('#loginForm').addEventListener('submit', login);

$('#logoutButton').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = null; showLogin(); });

$$('.nav-item[data-type]').forEach((button) => button.addEventListener('click', async () => {

  $$('.nav-item').forEach((item) => item.classList.remove('active')); button.classList.add('active');

  state.type = button.dataset.type; state.page = 1; $('#viewTitle').textContent = button.textContent;
  try {
    await loadStock();
    if (state.type === button.dataset.type) {
      $('#stockTableScroll').scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  } catch (error) { toast(error.message, true); }

}));

$('#searchInput').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { state.page = 1; loadStock().catch((e) => toast(e.message, true)); }, 350); });

for (const selector of ['#brandFilter', '#priceListFilter', '#licenseFilter', '#rubroFilter', '#yearFilter', '#seasonFilter', '#levelFilter', '#positiveStock', '#actionedFilter']) $(selector).addEventListener('change', () => {

  state.page = 1; loadStock().catch(error => toast(error.message, true));

});

$('#clearFilters').addEventListener('click', () => {

  clearTimeout(state.searchTimer);

  for (const picker of Object.values(pickers)) picker.setValues([]);

  $('#searchInput').value = ''; $('#positiveStock').checked = false; $('#actionedFilter').value = '';

  state.page = 1; loadStock().catch(error => toast(error.message, true));

});

$('#prevPage').addEventListener('click', () => { state.page -= 1; loadStock().catch((e) => toast(e.message, true)); });

$('#nextPage').addEventListener('click', () => { state.page += 1; loadStock().catch((e) => toast(e.message, true)); });

$('#selectAll').addEventListener('change', (event) => {

  $$('.row-check').forEach(box => { if (event.target.checked) selectedProducts.add(box.value); else selectedProducts.delete(box.value); });

  updateSelection();

});

$('#stockRows').addEventListener('change', event => {

  if (!event.target.matches('.row-check')) return;

  if (event.target.checked) selectedProducts.add(event.target.value); else selectedProducts.delete(event.target.value);

  updateSelection();

});

$('#clearSelection').addEventListener('click', () => { selectedProducts.clear(); updateSelection(); });

$('#toModulesButton').addEventListener('click', () => changeClassification('MODULOS'));

$('#toActionedButton').addEventListener('click', () => changeClassification('ACCIONADO'));

$('#refreshButton').addEventListener('click', refreshStock);

$('#usersButton').addEventListener('click', async () => {

  $('#usersModal').classList.remove('hidden');

  try { await loadUsers(); } catch (error) { toast(error.message, true); }

});

$('#closeUsers').addEventListener('click', () => { clearPasswordForm(); $('#usersModal').classList.add('hidden'); });

$('#usersModal').addEventListener('click', (event) => { if (event.target === $('#usersModal')) { clearPasswordForm(); $('#usersModal').classList.add('hidden'); } });

$('#userForm').addEventListener('submit', createUser);
$('#cancelUserEdit').addEventListener('click', cancelUserEdit);

$('#companyButton').addEventListener('click', async () => {

  try {

    const data = await api('/api/company');

    $('#companyCode').textContent = `${data.NOMBRE} · Código: ${data.CODIGO}`;

    $('#companySource').value = data.SOURCE_FILE || '';

    $('#companyExcel').value = data.EXCEL_PATH || '';

    $('#companyImages').value = data.IMAGE_DIRECTORY || '';

    $('#companyFactor').value = data.PUBLIC_PRICE_FACTOR;

    const factorBaseRows = [

      ...(data.brands || []).map(MARCA => ({ MARCA, LICENCIA: '', RUBRO: '', specific: false })),

      ...(data.combinations || []).map(row => ({ ...row, specific: true }))

    ];

    const factorRows = ['', ...(data.priceLists || [])].flatMap(list => factorBaseRows.map(row => ({ ...row, list })));
    $('#companyPriceFactors').innerHTML = factorRows.map(row => `<tr><td>${escapeHtml(row.list || 'Todas')}</td><td>${escapeHtml(row.MARCA || 'Sin marca')}</td><td>${row.specific ? escapeHtml(row.LICENCIA || 'Sin licencia') : 'Todas'}</td><td>${row.specific ? escapeHtml(row.RUBRO || 'Sin rubro') : 'Todos'}</td>${[950,900].map(level => {

      const factor = (data.priceFactors || []).find(rule => (rule.LISTA || '') === row.list && rule.MARCA === row.MARCA && rule.NIVEL === level && Boolean(rule.ESPECIFICO) === row.specific && (!row.specific || (rule.LICENCIA === row.LICENCIA && rule.RUBRO === row.RUBRO)))?.FACTOR;

      return `<td><input class="company-price-factor" data-list="${escapeHtml(row.list)}" data-brand="${escapeHtml(row.MARCA)}" data-specific="${row.specific}" data-license="${escapeHtml(row.LICENCIA)}" data-rubro="${escapeHtml(row.RUBRO)}" data-level="${level}" type="number" min="0.0001" max="99999" step="0.0001" value="${factor ?? ''}" placeholder="${row.specific ? 'Marca / general' : 'General'}" aria-label="${escapeHtml([row.MARCA, row.LICENCIA, row.RUBRO].join(' '))} ${level === 950 ? 'módulo' : 'suelto'}"></td>`;

    }).join('')}</tr>`).join('') || '<tr><td colspan="6">Importá el stock para obtener las combinaciones de la empresa.</td></tr>';

    $('#companyRetention').value = data.RETENTION_DAYS;

    $('#companyError').textContent = '';

    $('#companyModal').classList.remove('hidden');

  } catch (error) { toast(error.message, true); }

});

$('#closeCompany').addEventListener('click', () => $('#companyModal').classList.add('hidden'));

$('#companyModal').addEventListener('click', event => { if (event.target === $('#companyModal')) $('#companyModal').classList.add('hidden'); });

$('#companyForm').addEventListener('submit', async event => {

  event.preventDefault();

  const button = event.target.querySelector('button[type="submit"]');

  button.disabled = true;

  try {

    await api('/api/company', { method: 'PUT', body: JSON.stringify({

      sourceFile: $('#companySource').value, excelPath: $('#companyExcel').value,

      imageDirectory: $('#companyImages').value,

      publicPriceFactor: Number($('#companyFactor').value), retentionDays: Number($('#companyRetention').value),

      priceFactors: $$('.company-price-factor').filter(input => input.value !== '').map(input => ({ list: input.dataset.list, brand: input.dataset.brand, specific: input.dataset.specific === 'true', license: input.dataset.license, rubro: input.dataset.rubro, level: Number(input.dataset.level), factor: Number(input.value) }))

    }) });

    $('#companyModal').classList.add('hidden'); toast('Configuración guardada.'); await loadStock();

  } catch (error) { $('#companyError').textContent = error.message; }

  finally { button.disabled = false; }

});

function normalizedRulesKey(rules) {

  return JSON.stringify({ excelColumns: [...(rules.excelColumns || defaultExcelColumns)].sort(), brand: [...(rules.brand || [])].sort(), priceList: rules.priceList || '', license: [...(rules.license || [])].sort(), rubro: [...rules.rubro].sort(), year: [...rules.year].sort(),

    season: [...rules.season].sort(), level: [...rules.level].sort(), type: rules.type, search: rules.search, positiveStock: rules.positiveStock, actioned: rules.actioned || '' });

}



function renderGridState() {
  const rules = selectedGrid?.rules;
  const parts = [];
  if (rules) {
    for (const [key, label] of [['brand','Marca'],['license','Licencia'],['rubro','Rubro'],['year','Año'],['season','Temporada'],['level','Tipo producto']]) {
      if (rules[key]?.length) parts.push(label + ': ' + rules[key].map(value => key === 'level' ? ({'950':'Módulo','900':'Suelto'}[value] || value) : value).join(', '));
    }
    if (rules.priceList) { const list = JSON.parse(rules.priceList); parts.push('Lista: ' + list[0]); parts.push('Versión: ' + list[1]); }
    if (rules.type) parts.push('Vista: ' + rules.type);
    if (rules.actioned) parts.push('Accionado: ' + ({confirmed:'Confirmados',possible:'Posibles',unconfirmed:'Sin confirmar'}[rules.actioned] || rules.actioned));
    if (rules.positiveStock) parts.push('Stock: Mayor que 0');
    if (rules.search) parts.push('Búsqueda: ' + rules.search);
  }
  $('#gridRulesSummary').innerHTML = rules ? '<strong class="grid-filters-title">Filtros guardados</strong>' + (parts.length ? parts.map(part => {
    const separator = part.indexOf(':');
    return `<span class="grid-filter-chip"><strong>${escapeHtml(part.slice(0, separator))}:</strong> ${escapeHtml(part.slice(separator + 1).trim())}</span>`;
  }).join('') : '<span>Todos los productos</span>') : '';


  $('#gridSchedule').disabled = !selectedGrid;

  $('#updateGrid').disabled = !selectedGrid;

  $('#archiveGrid').disabled = !selectedGrid;

  $('#downloadGrid').classList.toggle('hidden', !selectedGrid);

  if (!selectedGrid) {

    $('#gridStatus').textContent = 'Vista libre: elegí filtros y guardalos con un nombre para crear una grilla.';

    return;

  }

  $('#downloadGrid').href = `/api/export/download?gridId=${selectedGrid.ID_GRID}${viewCompanyId ? '&viewCompanyId=' + encodeURIComponent(viewCompanyId) : ''}`;

  const changed = normalizedRulesKey(currentRules()) !== normalizedRulesKey(selectedGrid.rules)

    || (state.user?.role === 'ADMIN' && $('#gridName').value.trim() !== selectedGrid.NAME);

  $('#gridStatus').textContent = changed

    ? `Vista modificada de «${selectedGrid.NAME}». La grilla guardada conserva sus reglas hasta guardar los cambios.`

    : `«${selectedGrid.NAME}» usa el stock vigente. Selecciones del mismo filtro se combinan; los distintos filtros se cumplen juntos.`;

}



async function loadGrids() {

  const data = (await api('/api/grids')).data;

  $('#savedGrid').innerHTML = '<option value="">Vista libre</option>' + data.map(grid => `<option value="${grid.ID_GRID}">${escapeHtml(grid.NAME)}</option>`).join('');

  if (selectedGrid && !data.some(grid => grid.ID_GRID === selectedGrid.ID_GRID)) selectedGrid = null;

  $('#savedGrid').value = selectedGrid ? String(selectedGrid.ID_GRID) : '';

  renderGridState();

}



function applyGridRules(rules) {

  selectedExcelColumns = rules.excelColumns;

  renderExcelColumns();

  clearTimeout(state.searchTimer);

  if (rules.priceList) {

    const select = $('#priceListFilter');

    if (![...select.options].some(option => option.value === rules.priceList)) {

      select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(rules.priceList)}">Lista guardada no disponible</option>`);

    }

    select.value = rules.priceList;

  }

  for (const key of ['brand', 'license', 'rubro', 'year', 'season', 'level']) pickers[key].setValues(rules[key] || []);

  $('#positiveStock').checked = Boolean(rules.positiveStock);

  $('#actionedFilter').value = rules.actioned || '';

  $('#searchInput').value = rules.search || '';

  state.type = rules.type || ''; state.page = 1;

  $$('.nav-item[data-type]').forEach(button => {

    button.classList.toggle('active', button.dataset.type === state.type);

    if (button.dataset.type === state.type) $('#viewTitle').textContent = button.textContent;

  });

}



let gridSelectionVersion = 0;

$('#savedGrid').addEventListener('change', async () => {

  const selectionVersion = ++gridSelectionVersion;

  try {

    const id = $('#savedGrid').value;

    const grid = id ? await api(`/api/grids/${id}`) : null;

    if (selectionVersion !== gridSelectionVersion) return;

    selectedGrid = grid;

    renderSchedule();

    $('#gridName').value = selectedGrid?.NAME || '';

    applyGridRules(selectedGrid?.rules || {});

    renderGridState(); await loadStock();

  } catch (error) { toast(error.message, true); }

});



async function saveGrid(update) {

  const button = $(update ? '#updateGrid' : '#createGrid');

  if (update && !selectedGrid) return;

  const name = $('#gridName').value.trim();

  if (!name) return toast('Ingresá un nombre para la grilla.', true);

  button.disabled = true;

  try {

    selectedGrid = await api(update ? `/api/grids/${selectedGrid.ID_GRID}` : '/api/grids', {

      method: update ? 'PUT' : 'POST', body: JSON.stringify({ name, rules: currentRules(), version: selectedGrid?.VERSION })

    });

    $('#gridName').value = selectedGrid.NAME;

    renderSchedule();

    await loadGrids(); toast(update ? 'Cambios guardados.' : 'Grilla creada.');

  } catch (error) { toast(error.message, true); }

  finally { button.disabled = update ? !selectedGrid : false; }

}

$('#createGrid').addEventListener('click', () => saveGrid(false));

$('#updateGrid').addEventListener('click', () => saveGrid(true));

$('#gridName').addEventListener('input', renderGridState);

$('#archiveGrid').addEventListener('click', async () => {

  if (!selectedGrid || !confirm(`¿Anular la grilla «${selectedGrid.NAME}»? Dejara de estar disponible para consulta y descarga. Se conserva su registro y el stock no se modifica.`)) return;

  try {

    await api(`/api/grids/${selectedGrid.ID_GRID}`, { method: 'DELETE', body: JSON.stringify({ version: selectedGrid.VERSION }) });

    selectedGrid = null; renderSchedule(); $('#gridName').value = ''; await loadGrids(); toast('Grilla anulada.');

  } catch (error) { toast(error.message, true); }

});

function renderSchedule() {
  $('#scheduleSummary').textContent = !selectedGrid ? 'Sin grilla seleccionada'
    : selectedGrid.EXPORT_ENABLED ? `Activa · Todos los días a las ${selectedGrid.EXPORT_TIME} · Hora de Argentina` : 'Desactivada';


  $('#exportEnabled').checked = Boolean(selectedGrid?.EXPORT_ENABLED);

  $('#exportTime').value = selectedGrid?.EXPORT_TIME || '08:00';

  $('#exportPath').value = selectedGrid?.EXPORT_PATH || '';

  const status = selectedGrid?.EXPORT_STATUS;

  $('#scheduleStatus').textContent = !selectedGrid ? 'Guardá o seleccioná una grilla para programarla.'

    : status === 'SUCCESS' ? `Última exportación correcta: ${dateTime(selectedGrid.EXPORT_FINISHED_AT)}`

    : status === 'ERROR' ? `No se pudo exportar: ${selectedGrid.EXPORT_ERROR}. Se volverá a intentar al día siguiente.`

    : status === 'RUNNING' ? 'Exportación iniciada. Si la aplicación se interrumpió, verificá el archivo de destino.'

    : 'Sin ejecuciones registradas.';

}

$('#saveSchedule').addEventListener('click', async () => {

  if (!selectedGrid) return;

  const gridId = selectedGrid.ID_GRID;

  $('#saveSchedule').disabled = true;

  try {

    const updated = await api(`/api/grids/${gridId}/schedule`, { method: 'PUT', body: JSON.stringify({

      version: selectedGrid.VERSION, enabled: $('#exportEnabled').checked,

      time: $('#exportTime').value, path: $('#exportPath').value.trim()

    }) });

    if (selectedGrid?.ID_GRID === gridId) { selectedGrid = updated; renderSchedule(); renderGridState(); }

    toast('Programación guardada.');

  } catch (error) { toast(error.message, true); }

  finally { $('#saveSchedule').disabled = false; }

});

$('#viewCompany').addEventListener('change', event => {

  const url = new URL(location.href);

  url.searchParams.set('company', event.target.value);

  location.assign(url.href);

});

loadSession();


$('#gridsButton').addEventListener('click', () => {
  const title = $('#gridsTitle');
  title.focus({ preventScroll: true });
  title.closest('.grid-manager').scrollIntoView({ behavior: 'instant', block: 'start' });
});
