(() => {
  const tableScroll = document.getElementById('stockTableScroll');
  const table = tableScroll.querySelector('table');
  const bar = document.createElement('div');
  bar.className = 'stock-floating-scroll hidden';
  bar.tabIndex = 0;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Desplazamiento horizontal de productos');
  bar.setAttribute('aria-controls', 'stockTableScroll');
  const track = document.createElement('div');
  bar.append(track);
  document.body.append(bar);
  bar.addEventListener('scroll', () => {
    if (tableScroll.scrollLeft !== bar.scrollLeft) tableScroll.scrollLeft = bar.scrollLeft;
  }, { passive: true });
  tableScroll.addEventListener('scroll', () => {
    if (bar.scrollLeft !== tableScroll.scrollLeft) bar.scrollLeft = tableScroll.scrollLeft;
  }, { passive: true });
  let pending = false;
  function update() {
    pending = false;
    const rect = tableScroll.getBoundingClientRect();
    const visible = rect.width > 0 && rect.top < window.innerHeight - 40 && rect.bottom > window.innerHeight
      && tableScroll.scrollWidth > tableScroll.clientWidth;
    bar.classList.toggle('hidden', !visible);
    if (!visible) return;
    bar.style.left = `${rect.left}px`;
    bar.style.width = `${tableScroll.clientWidth}px`;
    track.style.width = `${tableScroll.scrollWidth}px`;
    bar.scrollLeft = tableScroll.scrollLeft;
  }
  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(update); }
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  const observer = new ResizeObserver(schedule);
  observer.observe(tableScroll);
  observer.observe(table);
  schedule();
})();
