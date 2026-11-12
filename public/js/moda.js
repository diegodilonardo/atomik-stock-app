(() => {
  const $ = id => document.getElementById(id);
  const company = new URLSearchParams(location.search).get('company');
  const suffix = company ? '?company=' + encodeURIComponent(company) : '';
  $('back').href = '/' + suffix;
  const headers = { 'Content-Type': 'application/json', ...(company ? { 'X-Company-ID': company } : {}) };
  let products = [], grids = [], current = null, page = 1, busy = false, dirty = false, admin = false;
  let curves=[],curveDraft=[],batchRows=[],batchSnapshot=null;
  const batchSelected=new Set();
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
    const available = products.filter(p=>!filters.years.length || filters.years.includes(p.COD_ANIO));
    const seasonMap = new Map();
    for(const p of available) {
      if(!seasonMap.has(p.COD_TEM)) seasonMap.set(p.COD_TEM,new Map());
      const labels=seasonMap.get(p.COD_TEM), label=p.DCOD_TEM || p.COD_TEM;
      labels.set(label,(labels.get(label)||0)+1);
    }
    const seasons=[...seasonMap].sort(([a],[b])=>a.localeCompare(b)).map(([code,labels])=>{
      const label=[...labels].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0][0];
      return [code,code ? label : 'Sin código de temporada'];
    });
    setOptions('years', [...new Set([...years,...filters.years])].map(y => [y,y || 'Sin año']), filters.years);
    const options=seasons.map(([code,label])=>[code,seasons.filter(([,other])=>other===label).length>1 ? label+' (código '+code+')' : label]);
    setOptions('seasons', options, filters.seasons.filter(code=>seasonMap.has(code)));
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
    $('positiveStock').checked=false;
    for (const id of Object.keys(extraFilters)) pickers[id].setValues([]);
  }
  function visible() {
    const years = selected('years'), seasons = selected('seasons'), scope = $('scope').value;
    const stockMatches = p => !$('positiveStock').checked || (p.STOCK !== null && p.STOCK !== undefined && Number.isFinite(Number(p.STOCK)) && Number(p.STOCK)>0);
    const normalizeSearch=value=>String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
    const tableWords=normalizeSearch($('tableSearch').value).split(/\s+/).filter(Boolean);
    const tableMatches=p=>tableWords.every(word=>normalizeSearch([p.DMODC,p.DCOLORC,p.DTALLC,p.TALLC,p.CODIGO,p.COD_ALFA].join(' ')).includes(word));
    // Review the entire assignment, even when browse filters hide some products.
    if (scope === 'assigned' || categories.includes(scope)) {
      return products.filter(p => tableMatches(p) && stockMatches(p) && (scope === 'assigned' ? assignments.has(p.id) : assignments.get(p.id) === scope));
    }
    const additional = Object.entries(extraFilters).map(([id,field])=>({field,values:selected(id)}));
    const words = $('search').value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return products.filter(p => tableMatches(p) && stockMatches(p) && years.includes(p.COD_ANIO) && seasons.includes(p.COD_TEM) &&
      additional.every(({field,values})=>!values.length || values.includes(filterValue(p, field))) &&
      words.every(w => `${p.DMODC} ${p.DCOLORC} ${p.COD_ALFA} ${p.CODIGO}`.toLocaleLowerCase().includes(w)) &&
      (scope === 'all' || (scope === 'assigned' ? assignments.has(p.id) : scope === 'unassigned' ? !assignments.has(p.id) : assignments.get(p.id) === scope)));
  }
  function render() {
    invalidateBatch();
    renderCurves();
    const list = visible().sort(productComparator()), pages = Math.max(1, Math.ceil(list.length / 50)); page = Math.min(page, pages);
    const rows = list.slice((page-1)*50, page*50);
    $('rows').innerHTML = rows.map(p => `<tr><td><input type="checkbox" data-id="${p.id}" ${checked.has(p.id)?'checked':''} aria-label="Seleccionar ${escape(p.DMODC)} ${escape(p.DCOLORC)}"></td><td>${escape(p.COD_ANIO)}</td><td>${escape(p.DCOD_TEM)}</td><td>${escape(p.DMODC)}</td><td>${escape(p.DCOLORC)}</td><td>${escape(p.DTALLC)}</td><td>${p.PARES}</td><td>${escape(p.STOCK ?? 'Sin dato')}</td><td>${money(p.PRICE_WHOLESALE)}</td><td>${money(p.PRICE_PUBLIC)}</td><td>${escape(p.COD_ALFA)}</td><td>${escape((assignments.get(p.id)||'Sin asignar')+(curves.some(c=>c.parts.some(part=>part.id===p.id))?' · Curva virtual':''))}</td></tr>`).join('') || '<tr><td colspan="12">Seleccioná año y temporada. Si ya los elegiste, no hay productos para estos filtros.</td></tr>';
    const scope = $('scope').value;
    const tabs = [['all','Explorar productos'],['assigned',`Ver asignados (${assignments.size})`],
      ...categories.map(c => [c,`${c}: ${[...assignments.values()].filter(v=>v===c).length}`])];
    $('counts').innerHTML = tabs.map(([value,label]) => `<button type="button" class="secondary" data-scope="${value}" aria-pressed="${scope===value}" ${busy?'disabled':''}>${label}</button>`).join('');
    const reviewing = scope === 'assigned' || categories.includes(scope);
    $('selectionViewHint').hidden = !reviewing;
    $('selectionViewHint').textContent = 'Mostrando los productos asignados, con la búsqueda de esta vista y Solo stock mayor a 0 si está activado. Los filtros de año, temporada y demás opciones de exploración no se aplican aquí. Podés seleccionarlos para cambiar su categoría o quitarlos. “Explorar productos” vuelve a tus filtros.';
    $('clearTableSearch').disabled=busy||!$('tableSearch').value;
    $('selectFiltered').textContent = `Seleccionar todos los ${reviewing ? 'resultados' : 'filtrados'} (${list.length})`;
    $('selectFiltered').disabled = busy || !list.length || list.every(p=>checked.has(p.id));
    $('clearSelection').disabled = busy || !checked.size;
    $('checkedCount').textContent = `${checked.size} seleccionados`;
    $('pageInfo').textContent = `${list.length} productos · Página ${page} de ${pages}`;
    $('prev').disabled = busy || page === 1; $('next').disabled = busy || page === pages;
    $('checkAll').checked = rows.length > 0 && rows.every(p=>checked.has(p.id));
    $('checkAll').indeterminate = rows.some(p=>checked.has(p.id)) && !$('checkAll').checked;
    $('save').disabled = busy || !current || !admin;
    $('saveFromColumns').disabled = busy || !current || !admin;
    $('columnSaveHelp').textContent=current ? 'El orden y la visibilidad pertenecen a «'+current.name+'». Guardar cambios conserva también los demás cambios de esta grilla.' : 'Para conservar este orden, ingresá un nombre y usá Guardar como nueva. Cada grilla tiene su propia configuración.';
    $('archive').disabled = busy || !current || !admin;
    $('export').disabled = busy || !assignments.size;
    $('assign').disabled = $('remove').disabled = busy || !checked.size;
  }
  function payload() { return { name:$('name').value, filters:{years:selected('years'),seasons:selected('seasons')}, curves, items:[...assignments].map(([id,category])=>({id,category})), columns:columnOrder.filter(key=>visibleColumns.has(key)), columnOrder:[...columnOrder], excludedColumns:[...excludedColumns], protectExcel:$('protectExcel').checked, version:current?.version, sort:currentSort() }; }
  function gridOptions() { setOptions('saved', [['','Nueva grilla'],...grids.map(g=>[String(g.id),g.name])], [String(current?.id || '')]); }
  function openGrid(grid) {
    current = grid; batchSelected.clear();batchSnapshot=null;$('batchConfirmation').hidden=true;$('tableSearch').value=''; curves=structuredClone(grid?.curves || []); curveDraft=[];$('curveDraft').hidden=true; assignments.clear(); checked.clear();
    $('protectExcel').checked=grid?.protectExcel !== false;
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
  ['years','seasons'].forEach(id => $(id).onchange = () => { checked.clear();page=1;dirty=true;masterOptions();render(); status('Los productos ya asignados se conservan. Podés combinar distintos años y temporadas en la misma grilla.'); });
  Object.keys(extraFilters).forEach(id => $(id).onchange = () => { checked.clear();page=1;render(); });
  $('positiveStock').onchange = () => {checked.clear();page=1;render();};
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
  $('protectExcel').onchange=()=>{dirty=true;};
  $('resetColumns').onclick=()=>{restoreColumns();dirty=true;};
  $('rows').onchange = e => { if(e.target.dataset.id) { if(e.target.checked) checked.add(e.target.dataset.id); else checked.delete(e.target.dataset.id); render(); } };
  $('selectFiltered').onclick = () => { if(busy)return; for(const product of visible()) checked.add(product.id); render(); };
  $('tableSearch').oninput=()=>{checked.clear();page=1;render();};
  $('clearTableSearch').onclick=()=>{$('tableSearch').value='';checked.clear();page=1;render();$('tableSearch').focus();};
  $('clearSelection').onclick = () => { if(busy)return; checked.clear();render(); };
  $('checkAll').onchange = () => { visible().sort(productComparator()).slice((page-1)*50,page*50).forEach(p=>{$('checkAll').checked?checked.add(p.id):checked.delete(p.id);});render(); };
  $('assign').onclick = () => { if(!allowCurveEdit())return; for(const id of checked) assignments.set(id,$('category').value); checked.clear(); dirty=true;render(); };
  $('remove').onclick = () => { if(!allowCurveEdit())return; curves=curves.filter(c=>!c.parts.every(p=>checked.has(p.id)));for(const id of checked) assignments.delete(id);checked.clear();dirty=true;render(); };
  function invalidateBatch(){batchSnapshot=null;$('batchConfirmation').hidden=true;}
  function renderBatch(){
    const previous=$('batchTemplate').value;
    $('batchTemplate').innerHTML='<option value="">Elegir curva guardada</option>'+curves.map(c=>'<option value="'+escape(c.id)+'">'+escape(c.name)+'</option>').join('');
    $('batchTemplate').value=curves.some(c=>c.id===previous)?previous:'';
    const template=curves.find(c=>c.id===$('batchTemplate').value);
    const query=$('batchSearch').value.trim().toLocaleLowerCase('es').split(/\s+/).filter(Boolean);
    const keys=[...new Set(visible().filter(p=>Number(p.NIVEL)===900&&Number(p.PARES)===1).filter(p=>query.every(w=>[p.DMODC,p.DCOLORC,p.COD_ANIO,p.DCOD_TEM,p.COD_TEM].join(' ').toLocaleLowerCase('es').includes(w))).map(FashionCurves.identity))];
    try {batchRows=template?FashionCurves.planBatch(template,products,keys,curves):[];}
    catch(error){batchRows=[];$('batchSummary').textContent=error.message;}
    const allowed=new Set(batchRows.filter(r=>!r.reasons.length).map(r=>r.key));
    for(const key of batchSelected)if(!allowed.has(key))batchSelected.delete(key);
    $('batchGroups').innerHTML=batchRows.map((r,i)=>'<label class="fashion-batch-row"><input type="checkbox" data-batch="'+i+'" '+(batchSelected.has(r.key)?'checked':'')+' '+(r.reasons.length||busy?'disabled':'')+'><span><strong>'+escape([r.product?.DMODC,r.product?.DCOLORC].join(' · '))+'</strong><small>'+escape('Año '+(r.product?.COD_ANIO||'Sin dato')+' · Temporada '+(r.product?.DCOD_TEM||r.product?.COD_TEM||'Sin dato'))+'</small><small>'+escape(r.reasons.length?r.reasons.join('; '):r.parts.length+' talles disponibles · '+r.parts.reduce((n,p)=>n+p.quantity,0)+' pares por módulo')+'</small></span></label>').join('');
    $('batchSummary').textContent=template?batchSelected.size+' combinaciones marcadas · '+batchRows.filter(r=>r.reasons.length).length+' pendientes por revisar.':'Primero creá o cargá una curva de esta grilla para reutilizarla.';
    $('batchPreview').disabled=busy||!admin||!batchSelected.size;
    $('batchSelectAll').disabled=busy||!admin||!allowed.size;
    $('batchClear').disabled=busy||!batchSelected.size;
  }
  $('batchTemplate').onchange=()=>{batchSelected.clear();invalidateBatch();renderBatch();};
  $('batchSearch').oninput=()=>{invalidateBatch();renderBatch();};
  $('batchCategory').onchange=invalidateBatch;
  $('batchGroups').onchange=event=>{const row=batchRows[Number(event.target.dataset.batch)];if(!row||row.reasons.length)return;if(event.target.checked)batchSelected.add(row.key);else batchSelected.delete(row.key);invalidateBatch();renderBatch();};
  $('batchSelectAll').onclick=()=>{batchRows.filter(r=>!r.reasons.length).forEach(r=>batchSelected.add(r.key));invalidateBatch();renderBatch();};
  $('batchClear').onclick=()=>{batchSelected.clear();invalidateBatch();renderBatch();};
  $('batchPreview').onclick=()=>{
    const template=curves.find(c=>c.id===$('batchTemplate').value);if(!template||!batchSelected.size)return;
    batchSnapshot={templateId:template.id,keys:[...batchSelected],category:$('batchCategory').value};
    $('batchPreviewText').textContent='Se crearán '+batchSelected.size+' módulos virtuales con la curva «'+template.name+'» en '+batchSnapshot.category+'. Sus talles se asignarán a esa categoría. Los productos con stock y las combinaciones pendientes no se modificarán.';
    $('batchConfirmation').hidden=false;
  };
  $('batchApply').onclick=()=>{
    if(busy||!admin||!batchSnapshot)return;
    try{
      const template=curves.find(c=>c.id===batchSnapshot.templateId);if(!template)throw new Error('La curva de origen cambió. Revisá nuevamente.');
      const plan=FashionCurves.planBatch(template,products,batchSnapshot.keys,curves);
      if(plan.some(r=>r.reasons.length))throw new Error('Cambió la disponibilidad de una combinación. Revisá la vista previa nuevamente.');
      const next=new Map(assignments);
      const additions=plan.map(r=>{r.parts.forEach(p=>next.set(p.id,batchSnapshot.category));return {id:Array.from(crypto.getRandomValues(new Uint32Array(4))).map(n=>n.toString(16)).join('-'),name:template.name,parts:r.parts};});
      const validated=FashionCurves.validate([...curves,...additions],products,[...next].map(([id,category])=>({id,category})));
      curves=validated;for(const [id,category] of next)assignments.set(id,category);
      batchSelected.clear();invalidateBatch();checked.clear();dirty=true;render();status(additions.length+' curvas creadas. Guardá la grilla para conservarlas.');
    }catch(error){invalidateBatch();renderBatch();status(error.message,true);}
  };
  function allowCurveEdit(){
    if(curves.some(c=>c.parts.some(p=>checked.has(p.id))&&!c.parts.every(p=>checked.has(p.id)))){
      status('Seleccioná todos los talles de la curva o desarmala antes de modificar sus productos.',true);return false;
    }
    return true;
  }
  function renderCurves(){
    renderBatch();
    $('prepareCurve').disabled=busy||!admin||!checked.size;
    $('virtualCurves').innerHTML=curves.map(c=>{
      const first=products.find(p=>p.id===c.parts[0]?.id);
      const detail=c.parts.map(part=>{const p=products.find(p=>p.id===part.id);return (p?FashionCurves.size(p):'Ausente')+' × '+part.quantity;}).join(' / ');
      const valid=c.parts.every(part=>{const p=products.find(p=>p.id===part.id);return p&&FashionCurves.eligible(p)&&assignments.has(part.id);});
      return '<div class="fashion-curve-card"><strong>'+escape(c.name)+'</strong><p>'+escape((first?.DMODC||'')+' · '+(first?.DCOLORC||'')+' · '+detail)+'</p><p>'+c.parts.reduce((n,p)=>n+p.quantity,0)+' pares por módulo'+(valid?'':' · Revisar: producto ausente, sin asignar o con stock')+'</p><button type="button" class="secondary" data-dissolve="'+escape(c.id)+'" '+(busy||!admin?'disabled':'')+'>Desarmar curva</button></div>';
    }).join('') || '<p>No hay curvas virtuales en esta grilla.</p>';
  }
  $('prepareCurve').onclick=()=>{
    if(busy||!admin)return;
    const chosen=products.filter(p=>checked.has(p.id));
    if(!chosen.length||chosen.some(p=>!FashionCurves.eligible(p)))return status('Seleccioná solamente sueltos de un par con stock 0.',true);
    if(chosen.some(p=>FashionCurves.identity(p)!==FashionCurves.identity(chosen[0])))return status('Seleccioná un único modelo y color, del mismo año y temporada.',true);
    if(curves.some(c=>c.parts.some(p=>checked.has(p.id))))return status('Hay productos que ya pertenecen a una curva. Desarmala primero.',true);
    curveDraft=chosen.sort((a,b)=>FashionSort.compareSizes(FashionCurves.size(a),FashionCurves.size(b)));
    $('curveName').value='';
    $('curveTemplate').innerHTML='<option value="">Definir cantidades</option>'+curves.map((c,i)=>'<option value="'+i+'">'+escape(c.name)+'</option>').join('');
    $('curveParts').innerHTML=curveDraft.map(p=>'<label>'+escape(FashionCurves.size(p))+'<input type="number" min="1" max="1000" step="1" value="1" data-part="'+p.id+'"></label>').join('');
    $('curveDraft').hidden=false;$('virtualCurvePanel').open=true;updateCurveTotal();
    $('virtualCurvePanel').scrollIntoView({behavior:'smooth',block:'start'});
  };
  function draftParts(){return [...$('curveParts').querySelectorAll('[data-part]')].map(input=>({id:input.dataset.part,quantity:Number(input.value)}));}
  function updateCurveTotal(){$('curveTotal').textContent='Total: '+draftParts().reduce((n,p)=>n+(Number.isFinite(p.quantity)?p.quantity:0),0)+' pares por módulo · Categoría: '+$('category').value;}
  $('curveTemplate').onchange=()=>{
    if($('curveTemplate').value==='')return;
    const template=curves[Number($('curveTemplate').value)];
    const parts=template.parts.map(part=>({product:products.find(p=>p.id===part.id),quantity:part.quantity}));
    const inputs=[...$('curveParts').querySelectorAll('[data-part]')];
    if(parts.some(p=>!p.product)||parts.length!==curveDraft.length||curveDraft.some(p=>!parts.some(part=>FashionSort.compareSizes(FashionCurves.size(part.product),FashionCurves.size(p))===0))){
      $('curveTemplate').value='';return status('La distribución requiere los mismos talles. Seleccioná todos los talles necesarios.',true);
    }
    for(const input of inputs){const p=curveDraft.find(p=>p.id===input.dataset.part);input.value=parts.find(part=>FashionSort.compareSizes(FashionCurves.size(part.product),FashionCurves.size(p))===0).quantity;}
    $('curveName').value=template.name;updateCurveTotal();
  };
  $('category').onchange=updateCurveTotal;
  $('curveParts').oninput=updateCurveTotal;
  $('cancelCurve').onclick=()=>{curveDraft=[];$('curveDraft').hidden=true;};
  $('createCurve').onclick=()=>{
    if(busy||!admin)return;
    try{
      const curve={id:Array.from(crypto.getRandomValues(new Uint32Array(4))).map(n=>n.toString(16)).join('-'),name:$('curveName').value,parts:draftParts()};
      const next=new Map(assignments);curve.parts.forEach(p=>next.set(p.id,$('category').value));
      const validated=FashionCurves.validate([...curves,curve],products,[...next].map(([id,category])=>({id,category})));
      curves=validated;curve.parts.forEach(p=>assignments.set(p.id,$('category').value));
      curveDraft=[];$('curveDraft').hidden=true;checked.clear();dirty=true;render();status('Curva creada. Guardá la grilla para conservarla.');
    }catch(error){status(error.message,true);}
  };
  $('virtualCurves').onclick=event=>{
    const button=event.target.closest('[data-dissolve]');if(!button||busy||!admin)return;
    curves=curves.filter(c=>c.id!==button.dataset.dissolve);dirty=true;render();status('Curva desarmada. Sus productos siguen asignados como sueltos.');
  };
  $('prev').onclick=()=>{page--;render();}; $('next').onclick=()=>{page++;render();};
  async function save(asNew) {
    status('Guardando grilla…');
    const result = await (await request('fashion/grids'+(asNew?'':'/'+current.id), {method:asNew?'POST':'PUT',body:JSON.stringify(payload())})).json();
    current=result; grids=(await (await request('fashion/grids')).json()).data; gridOptions();dirty=false;status('Grilla guardada con sus productos, orden de campos y opciones de visibilidad.');
  }
  $('saveFromColumns').onclick=()=>run(()=>save(false));
  $('saveNew').onclick=()=>run(()=>save(true)); $('save').onclick=()=>run(()=>save(false));
  $('archive').onclick=()=>{
    if(!current || !confirm(`¿Anular la grilla “${current.name}”?`)) return;
    run(async()=>{await request('fashion/grids/'+current.id,{method:'DELETE',body:JSON.stringify({version:current.version})});grids=grids.filter(g=>g.id!==current.id);openGrid(null);gridOptions();status('Grilla anulada.');});
  };
  $('refresh').onclick=()=>run(async()=>{status('Actualizando maestro desde FTP…');const data=await (await request('fashion/refresh',{method:'POST'})).json();products=data.products;masterOptions();status(`Maestro actualizado: ${products.length} productos. Las asignaciones se conservaron.`);missingButton.hidden=![...assignments.keys()].some(id=>!products.some(p=>p.id===id));});
  $('export').onclick=()=>run(async()=>{
    window.scrollTo({top:0,behavior:'smooth'});status('Preparando Excel e imágenes… Mantené esta página abierta.');
    const started=performance.now();
    const elapsed=()=>{const seconds=Math.floor((performance.now()-started)/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
    $('exportActivity').hidden=false;
    $('exportProgress').removeAttribute('value');
    $('exportProgress').max=1;
    $('exportPhase').textContent='Preparando Excel e imágenes…';
    $('exportProgressHelp').textContent='Tiempo transcurrido. Mantené esta página abierta hasta que comience la descarga.';
    $('exportElapsed').textContent='00:00';
    const timer=setInterval(()=>{$('exportElapsed').textContent=elapsed();},1000);
    try {
    const response=await request('fashion/export',{method:'POST',body:JSON.stringify(payload())});
    $('exportPhase').textContent='Recibiendo el archivo…';
    const blob=await response.blob(), url=URL.createObjectURL(blob), a=document.createElement('a');
    const filename = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    a.href=url;a.download=filename ? decodeURIComponent(filename) : ($('name').value||'Grilla Moda')+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Excel listo. Descarga iniciada.');
    $('exportProgress').value=1;
    $('exportPhase').textContent='Excel listo · Descarga iniciada';
    $('exportProgressHelp').textContent='Tiempo total de preparación y recepción del archivo.';
    } catch(error) {
      $('exportProgress').value=0;
      $('exportPhase').textContent='No se completó la exportación';
      $('exportProgressHelp').textContent='Podés volver a intentarlo. Revisá el mensaje de error.';
      throw error;
    } finally {clearInterval(timer);$('exportElapsed').textContent=elapsed();}
  });
  window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
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
