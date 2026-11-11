(() => {
  const $ = id => document.getElementById(id);
  const company = new URLSearchParams(location.search).get('company');
  const suffix = company ? '?company=' + encodeURIComponent(company) : '';
  $('back').href = '/' + suffix;
  const headers = { 'Content-Type': 'application/json', ...(company ? { 'X-Company-ID': company } : {}) };
  let products = [], grids = [], current = null, page = 1, busy = false, dirty = false, admin = false;
  const assignments = new Map(), checked = new Set();
  const categories = ['DISCIPLINA','HOMBRE','DAMA','KIDS','SUELTOS','ACCESORIOS'];
  let columnOrder=[...FashionColumns.defaults], visibleColumns=new Set(columnOrder), excludedColumns=new Set();
  function restoreColumns(columns, excluded, order) {
    const selected=FashionColumns.normalize(columns);
    visibleColumns=new Set(selected);
    excludedColumns=new Set(FashionColumns.normalizeExcluded(excluded, selected));
    columnOrder=FashionColumns.normalizeOrder(order,selected);
    renderColumns();
  }
  function renderColumns() {
    const labels=new Map(FashionColumns.fields.map(field=>[field.key,field.label]));
    $('fashionColumns').innerHTML=columnOrder.map((key,i)=>`<div class="fashion-column-row"><label for="column-visibility-${key}">${labels.get(key)}${key==='order'?' (obligatorio)':''}</label><select id="column-visibility-${key}" data-column="${key}" aria-label="Visibilidad de ${labels.get(key)}" ${key==='order'||busy?'disabled':''}><option value="visible" ${visibleColumns.has(key)?'selected':''}>Mostrar</option><option value="hidden" ${!visibleColumns.has(key)&&!excludedColumns.has(key)?'selected':''}>Ocultar</option><option value="excluded" ${excludedColumns.has(key)?'selected':''} ${FashionColumns.required.includes(key)?'disabled':''}>No incluir</option></select><button type="button" class="secondary" data-move="-1" data-key="${key}" aria-label="Subir ${labels.get(key)}" ${i===0||busy?'disabled':''}>↑</button><button type="button" class="secondary" data-move="1" data-key="${key}" aria-label="Bajar ${labels.get(key)}" ${i===columnOrder.length-1||busy?'disabled':''}>↓</button></div>`).join('');
    const hidden=columnOrder.filter(key=>!visibleColumns.has(key)&&!excludedColumns.has(key)).map(key=>labels.get(key));
    $('columnsPreview').textContent='Orden visible: '+columnOrder.filter(key=>visibleColumns.has(key)).map(key=>labels.get(key)).join(' → ') + (hidden.length ? '. Ocultos (conservados para cálculos): '+hidden.join(', ') : '') + (excludedColumns.size ? '. No incluidos: '+[...excludedColumns].map(key=>labels.get(key)).join(', ') : '');
  }
  let sortRules = FashionSort.fields.map(f=>({field:f.key,direction:'asc'}));
  function renderSort() {
    $('sortRules').hidden = !$('customSort').checked;
    $('sortRules').innerHTML = sortRules.map((rule,i)=>`<div><label>Prioridad ${i+1}<select data-sort-field="${i}">${FashionSort.fields.map(f=>`<option value="${f.key}" ${f.key===rule.field?'selected':''}>${f.label}</option>`).join('')}</select></label><select data-sort-direction="${i}" aria-label="Dirección prioridad ${i+1}"><option value="asc" ${rule.direction==='asc'?'selected':''}>Ascendente</option><option value="desc" ${rule.direction==='desc'?'selected':''}>Descendente</option></select></div>`).join('');
  }
  function currentSort() { return $('customSort').checked ? sortRules : null; }
  function productComparator() { return FashionSort.create(currentSort(),p=>assignments.get(p.id)||'Sin asignar'); }
  $('customSort').onchange=()=>{dirty=true;page=1;renderSort();render();};
  $('sortRules').onchange=event=>{
    const fieldIndex=event.target.dataset.sortField;
    if(fieldIndex!==undefined) {
      const index=Number(fieldIndex), other=sortRules.findIndex(r=>r.field===event.target.value);
      const previous=sortRules[index].field;
      sortRules[index].field=event.target.value;
      if(other!==-1 && other!==index) sortRules[other].field=previous;
    } else if(event.target.dataset.sortDirection!==undefined) sortRules[Number(event.target.dataset.sortDirection)].direction=event.target.value;
    dirty=true;page=1;renderSort();render();
  };
  renderSort();
  const extraFilters = { brands:'DMARCA', licenses:'LICENCIAS', rubros:'RUBRO', levels:'NIVEL', classifications:'DCLASIFIC', ages:'EDAD', sexes:'SEXO', colors:'DCOLORC', disciplines:'DISCIPLINA' };
  const filterValue = (product, field) => {
    const value = String(product[field] ?? '').trim();
    return field === 'LICENCIAS' && (!value || value.toUpperCase() === 'SIN LICENCIA') ? 'Sin licencia' : value;
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pickers = Object.fromEntries([
    ['years','Año','Elegir año'],['seasons','Temporada','Elegir temporada'],
    ['brands','Marca','Todas las marcas'],['licenses','Licencia','Todas las licencias'],['rubros','Rubro','Todos los rubros'],['ages','Edad','Todas las edades'],
    ['levels','Nivel / tipo de módulo','Todos los niveles'],
    ['classifications','Clasificación (detalle)','Todas las clasificaciones'],
    ['sexes','Sexo','Todos los sexos'],['colors','Color','Todos los colores'],
    ['disciplines','Disciplina','Todas las disciplinas']
  ].map(([id,label,all])=>[id,new MultiSelect($(id),label,all)]));
  const selected = id => pickers[id] ? pickers[id].values : [...$(id).selectedOptions].map(o => o.value);
  const money = value => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(value);
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  async function request(url, options = {}) {
    const response = await fetch('/api/' + url, { ...options, headers, signal: AbortSignal.timeout(180000) });
    if (response.status === 401) { location.href = '/' + suffix; throw new Error('Ingresá nuevamente'); }
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'No se pudo completar la operación'); }
    return response;
  }
  async function run(task) {
    if (busy) return;
    busy = true;
    $('workspace').setAttribute('aria-busy','true');
    document.querySelectorAll('button,input,select').forEach(el => el.disabled = true);
    try { await task(); } catch (error) { status(error.message, true); }
    finally { busy = false; $('workspace').setAttribute('aria-busy','false'); document.querySelectorAll('button,input,select').forEach(el => el.disabled = false); render(); renderColumns(); }
  }
  function setOptions(id, options, chosen) {
    if (pickers[id]) {
      const labels = new Map(options);
      pickers[id].display = value => labels.get(value) ?? (value || 'Sin dato');
      pickers[id].setOptions(options.map(([value])=>value));
      pickers[id].setValues(chosen);
      return;
    }
    $(id).innerHTML = options.map(([value,label]) => `<option value="${escape(value)}" ${chosen.includes(value) ? 'selected' : ''}>${escape(label)}</option>`).join('');
  }
  function masterOptions(filters = { years: selected('years'), seasons: selected('seasons') }) {
    const years = [...new Set(products.map(p => p.COD_ANIO))].sort();
    const seasons = [...new Map(products.map(p => [p.COD_TEM, p.DCOD_TEM || p.COD_TEM])).entries()].sort();
    setOptions('years', [...new Set([...years,...filters.years])].map(y => [y,y || 'Sin año']), filters.years);
    const seasonMap = new Map(seasons); filters.seasons.forEach(s => { if (!seasonMap.has(s)) seasonMap.set(s,s); });
    setOptions('seasons', [...seasonMap].map(([code,label])=>[code,label || 'Sin temporada']), filters.seasons);
    extraOptions();
  }
  function extraOptions() {
    const years = selected('years'), seasons = selected('seasons');
    const available = products.filter(p => years.includes(p.COD_ANIO) && seasons.includes(p.COD_TEM));
    for (const [id, field] of Object.entries(extraFilters)) {
      const chosen = selected(id);
      // Keep selected values even if they have no results in a new year/season.
      const values = [...new Set([...available.map(p => filterValue(p, field)), ...chosen])].sort((a,b)=>a.localeCompare(b,'es'));
      setOptions(id, values.map(value => [value,id === 'levels'
        ? ({'950':'950 — Módulo','900':'900 — Par suelto'}[value] || value || 'Sin dato')
        : value || 'Sin dato']), chosen);
    }
  }
  function clearExtraFilters() {
    for (const id of Object.keys(extraFilters)) pickers[id].setValues([]);
  }
  function visible() {
    const years = selected('years'), seasons = selected('seasons'), scope = $('scope').value;
    // Review the entire assignment, even when browse filters hide some products.
    if (scope === 'assigned' || categories.includes(scope)) {
      return products.filter(p => scope === 'assigned' ? assignments.has(p.id) : assignments.get(p.id) === scope);
    }
    const additional = Object.entries(extraFilters).map(([id,field])=>({field,values:selected(id)}));
    const words = $('search').value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return products.filter(p => years.includes(p.COD_ANIO) && seasons.includes(p.COD_TEM) &&
      additional.every(({field,values})=>!values.length || values.includes(filterValue(p, field))) &&
      words.every(w => `${p.DMODC} ${p.DCOLORC} ${p.COD_ALFA} ${p.CODIGO}`.toLocaleLowerCase().includes(w)) &&
      (scope === 'all' || (scope === 'assigned' ? assignments.has(p.id) : scope === 'unassigned' ? !assignments.has(p.id) : assignments.get(p.id) === scope)));
  }
  function render() {
    const list = visible().sort(productComparator()), pages = Math.max(1, Math.ceil(list.length / 50)); page = Math.min(page, pages);
    const rows = list.slice((page-1)*50, page*50);
    $('rows').innerHTML = rows.map(p => `<tr><td><input type="checkbox" data-id="${p.id}" ${checked.has(p.id)?'checked':''} aria-label="Seleccionar ${escape(p.DMODC)} ${escape(p.DCOLORC)}"></td><td>${escape(p.COD_ANIO)}</td><td>${escape(p.DCOD_TEM)}</td><td>${escape(p.DMODC)}</td><td>${escape(p.DCOLORC)}</td><td>${escape(p.DTALLC)}</td><td>${p.PARES}</td><td>${escape(p.STOCK ?? 'Sin dato')}</td><td>${money(p.PRICE_WHOLESALE)}</td><td>${money(p.PRICE_PUBLIC)}</td><td>${escape(p.COD_ALFA)}</td><td>${escape(assignments.get(p.id)||'Sin asignar')}</td></tr>`).join('') || '<tr><td colspan="12">Seleccioná año y temporada. Si ya los elegiste, no hay productos para estos filtros.</td></tr>';
    const scope = $('scope').value;
    const tabs = [['all','Explorar productos'],['assigned',`Ver asignados (${assignments.size})`],
      ...categories.map(c => [c,`${c}: ${[...assignments.values()].filter(v=>v===c).length}`])];
    $('counts').innerHTML = tabs.map(([value,label]) => `<button type="button" class="secondary" data-scope="${value}" aria-pressed="${scope===value}" ${busy?'disabled':''}>${label}</button>`).join('');
    const reviewing = scope === 'assigned' || categories.includes(scope);
    $('selectionViewHint').hidden = !reviewing;
    $('selectionViewHint').textContent = 'Mostrando los productos asignados, sin aplicar los filtros de búsqueda. Podés seleccionarlos para cambiar su categoría o quitarlos. “Explorar productos” vuelve a tus filtros.';
    $('checkedCount').textContent = `${checked.size} seleccionados`;
    $('pageInfo').textContent = `${list.length} productos · Página ${page} de ${pages}`;
    $('prev').disabled = busy || page === 1; $('next').disabled = busy || page === pages;
    $('checkAll').checked = rows.length > 0 && rows.every(p=>checked.has(p.id));
    $('checkAll').indeterminate = rows.some(p=>checked.has(p.id)) && !$('checkAll').checked;
    $('save').disabled = busy || !current || !admin;
    $('archive').disabled = busy || !current || !admin;
    $('export').disabled = busy || !assignments.size;
    $('assign').disabled = $('remove').disabled = busy || !checked.size;
  }
  function payload() { return { name:$('name').value, filters:{years:selected('years'),seasons:selected('seasons')}, items:[...assignments].map(([id,category])=>({id,category})), columns:columnOrder.filter(key=>visibleColumns.has(key)), columnOrder:[...columnOrder], excludedColumns:[...excludedColumns], version:current?.version, sort:currentSort() }; }
  function gridOptions() { setOptions('saved', [['','Nueva grilla'],...grids.map(g=>[String(g.id),g.name])], [String(current?.id || '')]); }
  function openGrid(grid) {
    current = grid; assignments.clear(); checked.clear();
    restoreColumns(grid?.columns, grid?.excludedColumns, grid?.columnOrder);
    const savedSort=FashionSort.normalize(grid?.sort);
    $('customSort').checked=!!savedSort;
    sortRules=savedSort || FashionSort.fields.map(f=>({field:f.key,direction:'asc'}));
    renderSort();
    $('scope').value = grid ? 'assigned' : 'all';
    clearExtraFilters();
    for (const item of grid?.items || []) assignments.set(item.id,item.category === 'SUELTOS Y ACCESORIOS' ? 'SUELTOS' : item.category);
    $('name').value = grid?.name || ''; masterOptions(grid?.filters || {years:[],seasons:[]}); page=1; dirty=false; render();
    const missing = [...assignments.keys()].filter(id=>!products.some(p=>p.id===id));
    status(missing.length ? `${missing.length} productos ya no están en el maestro. Actualizá la selección con “Quitar ausentes” antes de guardar o exportar.` : grid ? 'Grilla cargada. Se usarán los precios actuales del maestro.' : 'Elegí año y temporada para comenzar.', !!missing.length);
    if (!missing.length && grid?.items.some(item=>item.category==='SUELTOS Y ACCESORIOS')) {
      dirty=true;
      status('La categoría anterior se separó: sus productos quedaron en SUELTOS. Mové a ACCESORIOS los que correspondan y guardá los cambios.');
    }
    $('removeMissing').hidden = !missing.length;
  }
  // Explicit removal avoids silently dropping products from a saved collection after a master refresh.
  const missingButton = document.createElement('button'); missingButton.id='removeMissing'; missingButton.textContent='Quitar ausentes'; missingButton.className='secondary'; missingButton.hidden=true;
  $('status').after(missingButton);
  missingButton.onclick = () => { const ids=new Set(products.map(p=>p.id)); for(const id of assignments.keys()) if(!ids.has(id)) assignments.delete(id); dirty=true; missingButton.hidden=true; render(); status('Productos ausentes quitados. Guardá los cambios.'); };
  $('saved').onchange = () => { if(dirty && !confirm('Hay cambios sin guardar. ¿Querés descartarlos?')) { gridOptions(); return; } openGrid(grids.find(g=>String(g.id)===$('saved').value)); };
  ['years','seasons'].forEach(id => $(id).onchange = () => { checked.clear();page=1;dirty=true;extraOptions();render(); status('Los productos ya asignados se conservan. Podés combinar distintos años y temporadas en la misma grilla.'); });
  Object.keys(extraFilters).forEach(id => $(id).onchange = () => { checked.clear();page=1;render(); });
  $('clearExtraFilters').onclick = () => { clearExtraFilters();checked.clear();page=1;extraOptions();render(); };
  ['search','scope'].forEach(id => $(id).addEventListener(id==='search'?'input':'change',()=>{checked.clear();page=1;render();}));
  $('counts').onclick = event => {
    const button = event.target.closest('button[data-scope]');
    if (!button || busy) return;
    $('scope').value = button.dataset.scope; checked.clear(); page=1; render();
  };
  $('name').oninput = () => {dirty=true;};
  $('fashionColumns').onchange = event => {
    const key=event.target.dataset.column;
    if(!key||busy)return;
    if(event.target.value==='excluded' && FashionColumns.required.includes(key)) {renderColumns();return;}
    if(event.target.value==='excluded')excludedColumns.add(key);else excludedColumns.delete(key);
    if(event.target.value==='visible' || key==='order')visibleColumns.add(key);else visibleColumns.delete(key);
    dirty=true;renderColumns();
  };
  $('fashionColumns').onclick = event => {
    const button=event.target.closest('button[data-move]');
    if(!button||busy)return;
    const i=columnOrder.indexOf(button.dataset.key),target=i+Number(button.dataset.move);
    if(i<0||target<0||target>=columnOrder.length)return;
    [columnOrder[i],columnOrder[target]]=[columnOrder[target],columnOrder[i]];
    dirty=true;renderColumns();
    $('fashionColumns').querySelector(`[data-key="${button.dataset.key}"][data-move="${button.dataset.move}"]`)?.focus();
  };
  $('resetColumns').onclick=()=>{restoreColumns();dirty=true;};
  $('rows').onchange = e => { if(e.target.dataset.id) { if(e.target.checked) checked.add(e.target.dataset.id); else checked.delete(e.target.dataset.id); render(); } };
  $('checkAll').onchange = () => { visible().sort(productComparator()).slice((page-1)*50,page*50).forEach(p=>{$('checkAll').checked?checked.add(p.id):checked.delete(p.id);});render(); };
  $('assign').onclick = () => { for(const id of checked) assignments.set(id,$('category').value); checked.clear(); dirty=true;render(); };
  $('remove').onclick = () => { for(const id of checked) assignments.delete(id);checked.clear();dirty=true;render(); };
  $('prev').onclick=()=>{page--;render();}; $('next').onclick=()=>{page++;render();};
  async function save(asNew) {
    status('Guardando grilla…');
    const result = await (await request('fashion/grids'+(asNew?'':'/'+current.id), {method:asNew?'POST':'PUT',body:JSON.stringify(payload())})).json();
    current=result; grids=(await (await request('fashion/grids')).json()).data; gridOptions();dirty=false;status('Grilla de moda guardada.');
  }
  $('saveNew').onclick=()=>run(()=>save(true)); $('save').onclick=()=>run(()=>save(false));
  $('archive').onclick=()=>{
    if(!current || !confirm(`¿Anular la grilla “${current.name}”?`)) return;
    run(async()=>{await request('fashion/grids/'+current.id,{method:'DELETE',body:JSON.stringify({version:current.version})});grids=grids.filter(g=>g.id!==current.id);openGrid(null);gridOptions();status('Grilla anulada.');});
  };
  $('refresh').onclick=()=>run(async()=>{status('Actualizando maestro desde FTP…');const data=await (await request('fashion/refresh',{method:'POST'})).json();products=data.products;masterOptions();status(`Maestro actualizado: ${products.length} productos. Las asignaciones se conservaron.`);missingButton.hidden=![...assignments.keys()].some(id=>!products.some(p=>p.id===id));});
  $('export').onclick=()=>run(async()=>{
    window.scrollTo({top:0,behavior:'smooth'});status('Preparando Excel e imágenes… Mantené esta página abierta.');
    const response=await request('fashion/export',{method:'POST',body:JSON.stringify(payload())});
    const blob=await response.blob(), url=URL.createObjectURL(blob), a=document.createElement('a');
    const filename = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    a.href=url;a.download=filename ? decodeURIComponent(filename) : ($('name').value||'Grilla Moda')+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Excel listo. Descarga iniciada.');
  });
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  run(async()=>{
    const {user}=await (await request('auth/me')).json();
    if(!user.fashionEnabled) throw new Error('Esta empresa no tiene configurado un maestro de moda.');
    $('fashionCompany').textContent = user.companyName + ' · COLECCIONES';
    document.title = 'Grillas de moda · ' + user.companyName;
    admin=user.role==='ADMIN';document.querySelectorAll('.editor').forEach(el=>el.hidden=!admin);
    const data=await (await request('fashion/master')).json();products=data.products;
    grids=(await (await request('fashion/grids')).json()).data;
    masterOptions();gridOptions();$('workspace').hidden=false;
    status(`Maestro disponible: ${products.length} productos. Elegí año y temporada para comenzar.`);
  });
})();
