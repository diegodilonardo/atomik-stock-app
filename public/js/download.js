(() => {
  const links = ['downloadView', 'downloadGrid'].map(id => document.getElementById(id));
  const panel = document.getElementById('downloadProgress');
  const label = document.getElementById('downloadStatus');
  const bar = document.getElementById('downloadBar');
  let busy = false;
  const protectDownload = event => { event.preventDefault(); event.returnValue = ''; };

  async function download(event, prefix = '') {
    event.preventDefault();
    if (busy) return false;
    busy = true;
    const href = event.currentTarget.href;
    links.forEach(link => { link.setAttribute('aria-disabled', 'true'); link.classList.add('download-busy'); });
    panel.classList.remove('hidden');
    bar.removeAttribute('value');
    const started = Date.now();
    const preparing = () => { label.textContent = `${prefix}Preparando Excel… ${Math.floor((Date.now() - started) / 1000)} s. Mantené esta pestaña abierta; las fotos pueden demorar.`; };
    preparing();
    if (event.currentTarget.id === 'downloadGrid' || prefix) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    const timer = setInterval(preparing, 1000);
    window.addEventListener('beforeunload', protectDownload);
    try {
      const response = await fetch(href, { signal: AbortSignal.timeout(15 * 60 * 1000) });
      clearInterval(timer);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'No se pudo generar el Excel. Intentá nuevamente.');
      }
      const total = Number(response.headers.get('Content-Length'));
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.byteLength;
        if (total > 0) {
          const percent = Math.min(99, Math.floor(received / total * 100));
          bar.value = percent;
          label.textContent = `${prefix}Descargando Excel… ${percent}%`;
        } else label.textContent = `${prefix}Descargando Excel… ${(received / 1024 / 1024).toFixed(1)} MB recibidos`;
      }
      const disposition = response.headers.get('Content-Disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      let filename = 'Grilla-stock.xlsx';
      if (encodedName) { try { filename = decodeURIComponent(encodedName); } catch {} }
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      bar.value = 100;
      label.textContent = prefix + '100% — Excel recibido. Revisá las descargas del navegador para abrirlo.';
      return true;
    } catch (error) {
      bar.removeAttribute('value');
      label.textContent = error.name === 'TimeoutError'
        ? 'La generación demoró demasiado. Intentá descargar una grilla con menos productos.'
        : `No se completó la descarga: ${error.message}`;
      return false;
    } finally {
      clearInterval(timer); busy = false;
      window.removeEventListener('beforeunload', protectDownload);
      links.forEach(link => { link.removeAttribute('aria-disabled'); link.classList.remove('download-busy'); });
    }
  }
  links.forEach(link => link.addEventListener('click', download));
  window.addEventListener('export-selected-grids', async event => {
    if (busy) { event.detail.done(false); return; }
    const grids = event.detail.grids;
    for (let i = 0; i < grids.length; i++) {
      const ok = await download({ preventDefault() {}, currentTarget: { href: grids[i].href, id: 'downloadGrid' } }, `${i + 1}/${grids.length} · ${grids[i].name} · `);
      if (!ok) { event.detail.done(false); return; }
    }
    event.detail.done(true);
  });
})();
