(() => {
  const open = document.getElementById('exportSeveral');
  const dialog = document.createElement('dialog');
  dialog.className = 'grid-batch-dialog';
  dialog.setAttribute('aria-label', 'Exportar varias grillas');
  dialog.innerHTML = '<h2>Exportar varias grillas</h2><p>Elegí las grillas de esta empresa. Se descarga un Excel por grilla.</p><label><input type="checkbox" id="batchAll"> Seleccionar todas</label><div class="batch-options"></div><p class="batch-message" role="status"></p><div class="grid-controls"><button class="primary batch-start" disabled>Exportar seleccionadas</button><button class="secondary batch-close">Cancelar</button></div>';
  document.body.append(dialog);
  const options = dialog.querySelector('.batch-options');
  const start = dialog.querySelector('.batch-start');
  const all = dialog.querySelector('#batchAll');
  const message = dialog.querySelector('.batch-message');
  let grids = [];
  function update() {
    const checked = options.querySelectorAll('input:checked').length;
    start.disabled = !checked;
    start.textContent = checked ? `Exportar seleccionadas (${checked})` : 'Exportar seleccionadas';
    all.checked = grids.length > 0 && checked === grids.length;
    all.indeterminate = checked > 0 && checked < grids.length;
  }
  all.addEventListener('change', () => { options.querySelectorAll('input').forEach(input => { input.checked = all.checked; }); update(); });
  options.addEventListener('change', update);
  dialog.querySelector('.batch-close').addEventListener('click', () => dialog.close());
  open.addEventListener('click', async () => {
    dialog.showModal(); options.replaceChildren(); grids = []; update(); all.disabled = true; message.textContent = 'Cargando grillas…';
    try {
      grids = (await api('/api/grids')).data;
      for (const grid of grids) {
        const label = document.createElement('label');
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = grid.ID_GRID;
        label.append(input, document.createTextNode(grid.NAME)); options.append(label);
      }
      all.disabled = !grids.length;
      message.textContent = grids.length ? '' : 'No hay grillas guardadas en esta empresa.';
    } catch (error) { message.textContent = error.message; }
  });
  start.addEventListener('click', () => {
    const ids = new Set([...options.querySelectorAll('input:checked')].map(input => Number(input.value)));
    const selected = grids.filter(grid => ids.has(grid.ID_GRID)).map(grid => ({ name: grid.NAME,
      href: `/api/export/download?gridId=${grid.ID_GRID}&viewCompanyId=${encodeURIComponent(viewCompanyId || state.user.companyId)}` }));
    if (!selected.length) return;
    open.disabled = true; dialog.close();
    window.dispatchEvent(new CustomEvent('export-selected-grids', { detail: { grids: selected, done: ok => {
      open.disabled = false;
      toast(ok ? 'Grillas descargadas. Revisá las descargas del navegador.' : 'La exportación se detuvo. Revisá el mensaje de progreso.', !ok);
    } } }));
  });
})();
