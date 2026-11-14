const SVG_NS = 'http://www.w3.org/2000/svg';

/** Geometry of the dial, in SVG user units (viewBox 0 0 320 180). */
const CENTER_X = 160;
const CENTER_Y = 172;
const RADIUS = 140;
/** The dial spans -50 to +50 cents, drawn at one degree per cent. */
const MAX_CENTS = 50;
/** How far past the end of the scale the needle rests when the note is off the scale. */
const OVERSHOOT_CENTS = 3;

function polar(cents: number, radius: number): [number, number] {
  const angle = (cents * Math.PI) / 180;
  return [CENTER_X + radius * Math.sin(angle), CENTER_Y - radius * Math.cos(angle)];
}

function arcPath(fromCents: number, toCents: number, radius: number): string {
  const [x1, y1] = polar(fromCents, radius);
  const [x2, y2] = polar(toCents, radius);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${radius} ${radius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

/** The arc-shaped meter with a needle, from -50 to +50 cents. */
export class Gauge {
  private readonly zone: SVGPathElement;
  private readonly needle: SVGGElement;

  constructor(root: SVGSVGElement) {
    root.replaceChildren();
    root.append(svg('path', { class: 'dial-track', d: arcPath(-MAX_CENTS, MAX_CENTS, RADIUS) }));

    this.zone = svg('path', { class: 'dial-zone', d: '' });
    root.append(this.zone);

    for (let cents = -MAX_CENTS; cents <= MAX_CENTS; cents += 5) {
      const major = cents % 10 === 0;
      const length = cents === 0 ? 18 : major ? 12 : 7;
      const [x1, y1] = polar(cents, RADIUS - 6);
      const [x2, y2] = polar(cents, RADIUS - 6 - length);
      const tick = svg('line', {
        class: cents === 0 ? 'dial-tick center' : major ? 'dial-tick major' : 'dial-tick',
        x1: x1.toFixed(2),
        y1: y1.toFixed(2),
        x2: x2.toFixed(2),
        y2: y2.toFixed(2),
      });
      root.append(tick);
    }

    for (const [cents, text] of [
      [-MAX_CENTS, '−50'],
      [0, '0'],
      [MAX_CENTS, '+50'],
    ] as const) {
      const [x, y] = polar(cents, RADIUS + 14);
      const label = svg('text', { class: 'dial-label', x: x.toFixed(2), y: (y + 4).toFixed(2) });
      label.textContent = text;
      root.append(label);
    }

    this.needle = svg('g', { class: 'dial-needle' });
    const [tipX, tipY] = polar(0, RADIUS - 10);
    this.needle.append(
      svg('line', { x1: CENTER_X, y1: CENTER_Y, x2: tipX.toFixed(2), y2: tipY.toFixed(2) }),
      svg('circle', { cx: CENTER_X, cy: CENTER_Y, r: 7 }),
    );
    this.needle.style.transformOrigin = `${CENTER_X}px ${CENTER_Y}px`;
    root.append(this.needle);
  }

  /** Redraws the highlighted in-tune zone for a tolerance in cents. */
  setTolerance(cents: number): void {
    this.zone.setAttribute('d', arcPath(-cents, cents, RADIUS));
  }

  /** Points the needle at a deviation in cents; null sends it back to the centre. */
  setCents(cents: number | null): void {
    const limit = MAX_CENTS + OVERSHOOT_CENTS;
    const clamped = cents === null ? 0 : Math.min(limit, Math.max(-limit, cents));
    this.needle.style.transform = `rotate(${clamped.toFixed(2)}deg)`;
  }
}
