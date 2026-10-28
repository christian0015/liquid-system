/**
 * Géométrie unique du kit. TypeScript pur (aucune API DOM) : alimente le shader (uniformes),
 * le clip-path CSS du contenu DOM et le repli sans WebGL.
 *
 * Convention : repère écran (y vers le bas), rayons dans l'ordre [tl, tr, br, bl].
 * Rayon > 0 = coin convexe, rayon < 0 = coin concave (un disque de rayon |r| centré sur le sommet est retiré),
 * rayon = 0 = coin vif. La traversée convexe ↔ concave passe donc par 0, continue et animable.
 */

export type Radii = [number, number, number, number];
export type ShapeInput = 'rect' | 'ellipse' | { path: string };

export type ShapeState = {
  w: number;
  h: number;
  r: Radii;
  /** 0 = rectangle à rayons signés, 1 = ellipse. */
  ell: number;
  /** 0–1 : mélange avec le champ de distance d'un chemin SVG (clé `pathKey`). */
  path: number;
  pathKey: string | null;
  pathData: string | null;
};

export const toRadii = (r: number | Radii | undefined, fallback = 0): Radii =>
  Array.isArray(r) ? [r[0], r[1], r[2], r[3]] : (() => { const v = r ?? fallback; return [v, v, v, v] as Radii; })();

/** Limite les rayons pour qu'ils tiennent sur les arêtes (convexes et concaves consomment la même longueur). */
export function clampRadii(r: Radii, w: number, h: number): Radii {
  const [tl, tr, br, bl] = r.map(Math.abs);
  const f = Math.min(
    1,
    tl + tr > 0 ? w / (tl + tr) : 1,
    bl + br > 0 ? w / (bl + br) : 1,
    tl + bl > 0 ? h / (tl + bl) : 1,
    tr + br > 0 ? h / (tr + br) : 1,
  );
  return f < 1 ? (r.map((v) => v * f) as Radii) : r;
}

export function makeShape(input: ShapeInput | undefined, w: number, h: number, radius?: number | Radii): ShapeState {
  const base = toRadii(radius, 0);
  if (input && typeof input === 'object') {
    return { w, h, r: clampRadii(base, w, h), ell: 0, path: 1, pathKey: input.path, pathData: input.path };
  }
  return {
    w,
    h,
    r: clampRadii(base, w, h),
    ell: input === 'ellipse' ? 1 : 0,
    path: 0,
    pathKey: null,
    pathData: null,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Interpolation de forme à forme : tailles, rayons signés, ellipse et chemin. */
export function lerpShape(a: ShapeState, b: ShapeState, t: number): ShapeState {
  const useB = t >= 0.5;
  return {
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
    r: [lerp(a.r[0], b.r[0], t), lerp(a.r[1], b.r[1], t), lerp(a.r[2], b.r[2], t), lerp(a.r[3], b.r[3], t)],
    ell: lerp(a.ell, b.ell, t),
    path: lerp(a.path, b.path, t),
    pathKey: useB ? b.pathKey ?? a.pathKey : a.pathKey ?? b.pathKey,
    pathData: useB ? b.pathData ?? a.pathData : a.pathData ?? b.pathData,
  };
}

/** Clé de géométrie pour les caches (clip-path, champs de distance). */
export const shapeKey = (s: ShapeState) =>
  `${Math.round(s.w)}x${Math.round(s.h)}|${s.r.map((v) => Math.round(v * 10) / 10).join(',')}|${s.ell.toFixed(2)}|${s.path.toFixed(2)}|${s.pathKey ?? ''}`;

/* ------------------------------------------------------------------ */
/* Distance signée de référence (le shader reproduit cette fonction)   */
/* ------------------------------------------------------------------ */

/** Maximum lissé (intersection arrondie) sur une largeur k. */
export function smoothMax(a: number, b: number, k: number) {
  if (k <= 1e-4) return Math.max(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** Distance signée au rectangle à rayons signés. (px, py) relatif au centre. Négatif = dedans. */
export function sdSignedRect(px: number, py: number, w: number, h: number, r: Radii): number {
  const hx = w / 2;
  const hy = h / 2;
  const quad = px > 0 ? (py > 0 ? 2 : 1) : py > 0 ? 3 : 0; // tl, tr, br, bl
  const rc = Math.max(r[quad], 0);
  const qx = Math.abs(px) - hx + rc;
  const qy = Math.abs(py) - hy + rc;
  let d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rc;
  const corners: [number, number][] = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  for (let i = 0; i < 4; i++) {
    if (r[i] < 0) {
      // Intersection lissée avec le disque retiré : les raccords au bord sont arrondis (pas de pointe).
      const a = Math.abs(r[i]);
      const b = a - Math.hypot(px - corners[i][0], py - corners[i][1]);
      d = smoothMax(d, b, Math.min(a * 0.55, 16));
    }
  }
  return d;
}

export function sdEllipse(px: number, py: number, w: number, h: number): number {
  const a = w / 2;
  const b = h / 2;
  const k = Math.hypot(px / a, py / b);
  const g = Math.hypot(px / (a * a), py / (b * b));
  return g > 1e-6 ? (k * (k - 1)) / g : -Math.min(a, b);
}

export function sdShape(px: number, py: number, s: ShapeState): number {
  const rect = sdSignedRect(px, py, s.w, s.h, s.r);
  return s.ell > 0 ? lerp(rect, sdEllipse(px, py, s.w, s.h), s.ell) : rect;
}

/* ------------------------------------------------------------------ */
/* Clip-path CSS                                                        */
/* ------------------------------------------------------------------ */

const f = (n: number) => (Math.abs(n) < 1e-4 ? 0 : Math.round(n * 100) / 100);

/** Chemin SVG exact du rectangle à rayons signés (arcs convexes et concaves), origine (0,0). */
export function rectPath(w: number, h: number, rIn: Radii): string {
  const r = clampRadii(rIn, w, h);
  const a = r.map(Math.abs);
  // Sens horaire. Pour chaque coin : point d'entrée, point de sortie, sens de l'arc.
  const C = [
    { vx: 0, vy: 0, inx: 0, iny: -1, ox: 1, oy: 0 }, // tl
    { vx: w, vy: 0, inx: 1, iny: 0, ox: 0, oy: 1 }, // tr
    { vx: w, vy: h, inx: 0, iny: 1, ox: -1, oy: 0 }, // br
    { vx: 0, vy: h, inx: -1, iny: 0, ox: 0, oy: -1 }, // bl
  ];
  const pt = (i: number) => {
    const c = C[i];
    return {
      p1: [c.vx - c.inx * a[i], c.vy - c.iny * a[i]],
      p2: [c.vx + c.ox * a[i], c.vy + c.oy * a[i]],
    };
  };
  const start = pt(0).p2;
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (const i of [1, 2, 3, 0]) {
    const { p1, p2 } = pt(i);
    d += `L${f(p1[0])} ${f(p1[1])}`;
    if (a[i] > 0.01) d += `A${f(a[i])} ${f(a[i])} 0 0 ${r[i] > 0 ? 1 : 0} ${f(p2[0])} ${f(p2[1])}`;
    else d += `L${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

/** Contour échantillonné depuis la distance signée (formes mixtes ou intermédiaires de morphing). */
export function sampledPath(s: ShapeState, n = 180): string {
  const pts: string[] = [];
  const maxR = Math.hypot(s.w, s.h) / 2 + 2;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let lo = 0;
    let hi = maxR;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (sdShape(dx * mid, dy * mid, s) < 0) lo = mid;
      else hi = mid;
    }
    pts.push(`${f(s.w / 2 + dx * lo)} ${f(s.h / 2 + dy * lo)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * Valeur CSS `clip-path` pour un état de forme. Rectangle pur : arcs exacts. Ellipse ou mélange : contour échantillonné.
 * Chemin SVG : `null` (le contenu est découpé par un `<clipPath>` en unités de boîte, géré par la scène).
 */
export function shapeToClipPath(s: ShapeState): string | null {
  if (s.path > 0.5 && s.pathKey) return null;
  if (s.ell > 0.001 || s.r.some((v) => v < -0.01)) return `path('${sampledPath(s)}')`;
  return `path('${rectPath(s.w, s.h, s.r)}')`;
}

/** Vrai si le `border-radius` CSS suffit (tous rayons convexes, pas d'ellipse ni de chemin). */
export const needsClipPath = (s: ShapeState) => s.ell > 0.001 || s.path > 0.001 || s.r.some((v) => v < -0.01);

/** Repli CSS : `border-radius` équivalent pour les formes convexes. */
export function borderRadiusCss(s: ShapeState): string {
  if (s.ell > 0.5) return '50%';
  return s.r.map((v) => `${f(Math.max(0, v))}px`).join(' ');
}

/** Boîte englobante d'un cercle et d'un rectangle (pour dimensionner la zone dessinée). */
export function unionBounds(rects: { x: number; y: number; w: number; h: number }[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
