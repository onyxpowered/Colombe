const NS = 'http://www.w3.org/2000/svg';

export class Icons {
  constructor() {
    this.sprite = document.createElementNS(NS, 'svg');
    this.sprite.setAttribute('width', '0');
    this.sprite.setAttribute('height', '0');
    this.sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.appendChild(this.sprite);
    this.names = new Set();
  }

  define(name, svgMarkup) {
    if (this.names.has(name)) return;
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml').documentElement;
    const symbol = document.createElementNS(NS, 'symbol');
    symbol.id = 'unf-i-' + name;
    symbol.setAttribute('viewBox', doc.getAttribute('viewBox') || '0 0 16 16');
    while (doc.firstChild) symbol.appendChild(doc.firstChild);
    this.sprite.appendChild(symbol);
    this.names.add(name);
  }

  use(name, size = 16) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.cssText = 'display:block;flex:none;fill:currentColor';
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#unf-i-' + name);
    svg.appendChild(use);
    return svg;
  }
}
