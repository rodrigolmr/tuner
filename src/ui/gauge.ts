const SVG_NS = 'http://www.w3.org/2000/svg';

/** Geometry of the dial, in SVG user units (viewBox 0 0 320 182). */
const CENTER_X = 160;
const CENTER_Y = 164;
/** The dial spans -50 to +50 cents over a half circle. */
const MAX_CENTS = 50;
const DEGREES_PER_CENT = 90 / MAX_CENTS;
/** How far past the end of the scale the pointer rests when the note is off the scale. */
const OVERSHOOT_CENTS = 2;

/** The scale is a ring of short bars, one every two cents. */
const SEGMENT_CENTS = 2;
const SEGMENT_OUTER = 142;
const SEGMENT_INNER = 127;
/** Every tenth cent gets a longer bar. */
const MAJOR_INNER = 121;
/** The in-tune zone is an arc just outside the ring. */
const ZONE_RADIUS = 149;
/** The pointer covers the ring and reaches a little further in. */
const POINTER_INNER = 104;
const POINTER_OUTER = SEGMENT_OUTER;
/** The flat and sharp signs stand inside the ring, clear of the pointer at either end. */
const LABEL_OFFSET = 88;

function polar(cents: number, radius: number): [number, number] {
  const angle = (cents * DEGREES_PER_CENT * Math.PI) / 180;
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

function radialLine(cents: number, inner: number, outer: number, className: string): SVGLineElement {
  const [x1, y1] = polar(cents, inner);
  const [x2, y2] = polar(cents, outer);
  return svg('line', {
    class: className,
    x1: x1.toFixed(2),
    y1: y1.toFixed(2),
    x2: x2.toFixed(2),
    y2: y2.toFixed(2),
  });
}

/**
 * The half-circle meter, from -50 to +50 cents. A pointer rides the ring and
 * the bars between the centre and the pointer light up, so the size of the
 * error can be read at a glance. The middle of the dial is left free for the
 * note name.
 */
export class Gauge {
  private readonly zone: SVGPathElement;
  private readonly pointer: SVGGElement;
  /** Bars of the ring, from -50 to +50 cents. */
  private readonly segments: SVGLineElement[] = [];
  /** Bar the lit stretch reaches to, counted from the centre; null when nothing is lit. */
  private reach: number | null = null;

  constructor(root: SVGSVGElement) {
    root.replaceChildren();

    for (let cents = -MAX_CENTS; cents <= MAX_CENTS; cents += SEGMENT_CENTS) {
      const major = cents % 10 === 0;
      const segment = radialLine(
        cents,
        major ? MAJOR_INNER : SEGMENT_INNER,
        SEGMENT_OUTER,
        major ? 'dial-segment major' : 'dial-segment',
      );
      this.segments.push(segment);
      root.append(segment);
    }

    this.zone = svg('path', { class: 'dial-zone', d: '' });
    root.append(this.zone);

    // A notch above the ring marks the centre.
    const top = CENTER_Y - ZONE_RADIUS;
    root.append(
      svg('path', {
        class: 'dial-notch',
        d: `M${CENTER_X} ${top - 3}l-5.5 -8.5h11z`,
      }),
    );

    for (const [className, text, x] of [
      ['dial-label flat', '♭', CENTER_X - LABEL_OFFSET],
      ['dial-label sharp', '♯', CENTER_X + LABEL_OFFSET],
    ] as const) {
      const label = svg('text', { class: className, x, y: CENTER_Y - 2 });
      label.textContent = text;
      root.append(label);
    }

    this.pointer = svg('g', { class: 'dial-pointer' });
    this.pointer.append(
      radialLine(0, POINTER_INNER, POINTER_OUTER, 'dial-pointer-glow'),
      radialLine(0, POINTER_INNER, POINTER_OUTER, 'dial-pointer-edge'),
      radialLine(0, POINTER_INNER, POINTER_OUTER, 'dial-pointer-bar'),
    );
    this.pointer.style.transformOrigin = `${CENTER_X}px ${CENTER_Y}px`;
    root.append(this.pointer);
  }

  /** Redraws the highlighted in-tune zone for a tolerance in cents. */
  setTolerance(cents: number): void {
    this.zone.setAttribute('d', arcPath(-cents, cents, ZONE_RADIUS));
  }

  /** Points at a deviation in cents; null sends the pointer back to the centre. */
  setCents(cents: number | null): void {
    const limit = MAX_CENTS + OVERSHOOT_CENTS;
    const clamped = cents === null ? 0 : Math.min(limit, Math.max(-limit, cents));
    this.pointer.style.transform = `rotate(${(clamped * DEGREES_PER_CENT).toFixed(2)}deg)`;
    this.light(cents === null ? null : Math.round(clamped / SEGMENT_CENTS));
  }

  /** Lights the bars from the centre up to the given one. */
  private light(reach: number | null): void {
    if (reach === this.reach) return;
    this.reach = reach;
    const centre = (this.segments.length - 1) / 2;
    this.segments.forEach((segment, index) => {
      const offset = index - centre;
      const lit =
        reach !== null && (reach >= 0 ? offset >= 0 && offset <= reach : offset <= 0 && offset >= reach);
      segment.classList.toggle('lit', lit);
    });
  }
}
