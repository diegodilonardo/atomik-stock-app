class MultiSelect {
  constructor(host, label, allLabel) {
    this.host = host; this.label = label; this.allLabel = allLabel; this.selected = []; this.options = [];
    this.render();
  }
  get values() { return [...this.selected]; }
  setValues(values = []) { this.selected = [...new Set(values.map(String))]; this.render(); }
  setOptions(options) { this.options = [...new Set(options.map(String))]; this.render(); }
  render() {
    const opened = this.host.querySelector('details')?.open || false;
    const details = document.createElement('details'); details.className = 'multi-picker'; details.open = opened;
    const summary = document.createElement('summary');
    summary.textContent = this.selected.length ? this.selected.map(value => this.display(value)).join(', ') : this.allLabel;
    summary.setAttribute('aria-label', `${this.label}: ${summary.textContent}`);
    const panel = document.createElement('div'); panel.className = 'multi-options';
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary'; clear.textContent = this.allLabel;
    clear.addEventListener('click', () => { this.setValues([]); this.host.dispatchEvent(new Event('change', { bubbles: true })); });
    panel.append(clear);
    const options = [...new Set([...this.options, ...this.selected])];
    if (!options.length) { const empty = document.createElement('p'); empty.textContent = 'Sin opciones disponibles'; panel.append(empty); }
    for (const value of options) {
      const label = document.createElement('label'), checkbox = document.createElement('input'), text = document.createElement('span');
      checkbox.type = 'checkbox'; checkbox.value = value; checkbox.checked = this.selected.includes(value);
      checkbox.setAttribute('aria-label', this.display(value));
      text.textContent = this.display(value) + (this.options.includes(value) ? '' : ' (sin stock actual)');
      checkbox.addEventListener('change', event => {
        event.stopPropagation();
        this.selected = checkbox.checked ? [...this.selected, value] : this.selected.filter(item => item !== value);
        summary.textContent = this.selected.length ? this.selected.map(item => this.display(item)).join(', ') : this.allLabel;
        summary.setAttribute('aria-label', `${this.label}: ${summary.textContent}`);
        this.host.dispatchEvent(new Event('change', { bubbles: true }));
      });
      label.append(checkbox, text); panel.append(label);
    }
    details.append(summary, panel); this.host.replaceChildren(details);
  }
  display(value) { return this.label === 'Tipo producto' ? ({ '950': 'Módulo', '900': 'Par suelto' }[value] || value) : value; }
}
document.addEventListener('click', event => {
  document.querySelectorAll('.multi-picker[open]').forEach(details => { if (!details.contains(event.target)) details.open = false; });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.multi-picker[open]').forEach(details => { details.open = false; details.querySelector('summary').focus(); });
});
