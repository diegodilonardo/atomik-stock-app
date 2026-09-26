(() => {
  const rows = document.getElementById('stockRows');
  rows.addEventListener('error', event => {
    const img = event.target;
    if (!img.matches('.product-photo img')) return;
    img.hidden = true;
    img.nextElementSibling.hidden = false;
    img.parentElement.disabled = true;
  }, true);
  const dialog = document.createElement('dialog');
  dialog.className = 'product-photo-dialog';
  dialog.setAttribute('aria-label', 'Imagen del producto');
  dialog.innerHTML = '<form method="dialog"><button class="secondary">Cerrar</button></form><img alt="">';
  document.body.append(dialog);
  rows.addEventListener('click', event => {
    const button = event.target.closest('.product-photo');
    if (!button || button.disabled) return;
    const source = button.querySelector('img');
    const image = dialog.querySelector('img');
    image.src = source.src;
    image.alt = source.alt;
    dialog.showModal();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
})();
