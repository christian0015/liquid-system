/** Mouvement : ressorts, plage `fluidity`, jeu d'apparitions. TypeScript pur (aucune API DOM). */

import type { AppearName } from './config';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const quadBezier = (p0: number, p1: number, p2: number, t: number) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;

/** Multiplicateur de vitesse : `speed` (0–1) choisit une valeur dans [fluidity.min, fluidity.max]. */
export const fluidityMult = (speed: number | undefined, f: { min: number; max: number }) =>
  lerp(f.min, f.max, clamp01(speed ?? 0.5));

/** Raideur et amortissement dérivés du multiplicateur (rendu vivant plutôt que des durées fixes). */
export function springParams(mult: number, bounce = 0.62, stiff = 190) {
  const k = stiff * mult * mult;
  const c = 2 * Math.sqrt(k) * bounce;
  return { k, c };
}

export class Spring {
  x: number;
  v = 0;
  target: number;
  k: number;
  c: number;

  constructor(value = 0, mult = 1, bounce = 0.62, stiff = 190) {
    this.x = value;
    this.target = value;
    const p = springParams(mult, bounce, stiff);
    this.k = p.k;
    this.c = p.c;
  }

  tune(mult: number, bounce = 0.62, stiff = 190) {
    const p = springParams(mult, bounce, stiff);
    this.k = p.k;
    this.c = p.c;
  }

  get settled() {
    return Math.abs(this.target - this.x) < 0.0008 && Math.abs(this.v) < 0.004;
  }

  /** Intégration semi-implicite en sous-pas (stable pour les gros dt). */
  step(dt: number) {
    // Un dt nul, négatif ou invalide ne doit jamais intégrer (un pas négatif rend le ressort instable).
    if (!(dt > 0)) return this.x;
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = Math.min(dt, 0.1) / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - this.target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.v)) this.snap(this.target);
    if (this.settled) {
      this.x = this.target;
      this.v = 0;
    }
    return this.x;
  }

  snap(value: number) {
    this.x = value;
    this.target = value;
    this.v = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Jeu d'apparitions                                                    */
/* ------------------------------------------------------------------ */

export type AppearSpec = {
  needsOrigin: boolean;
  /** Point de départ de la matière. */
  from: 'origin' | 'center' | 'top' | 'bottom';
  /** Taille initiale relative à la cible. */
  scale: [number, number];
  /** Cou de matière entre l'origine et le corps (0–1). */
  neck: number;
  /** Goutte laissée à l'origine qui remonte vers le corps (0–1). */
  residue: number;
  /** Ondulation de surface à l'impact (0–1). */
  ripple: number;
  /** Dépassement élastique (0–1). */
  wobble: number;
  /** 0 = départ en disque (ellipse), 1 = départ en rectangle déjà formé. */
  rect: number;
  /** Rayon initial signé relatif (négatif = départ concave). */
  startRadius: number;
  /** Traînée verticale en forme de goutte (0–1). */
  drip: number;
};

export const APPEARANCES: Record<AppearName, AppearSpec> = {
  ooze: { needsOrigin: true, from: 'origin', scale: [0.05, 0.05], neck: 1, residue: 1, ripple: 0.8, wobble: 0.7, rect: 0, startRadius: 1, drip: 0 },
  unfold: { needsOrigin: false, from: 'top', scale: [1, 0.04], neck: 0, residue: 0, ripple: 0.25, wobble: 0.35, rect: 1, startRadius: -0.6, drip: 0 },
  bloom: { needsOrigin: false, from: 'center', scale: [0.35, 0.35], neck: 0, residue: 0.3, ripple: 0.5, wobble: 0.8, rect: 0.4, startRadius: -1, drip: 0 },
  drip: { needsOrigin: false, from: 'top', scale: [0.22, 0.12], neck: 0.4, residue: 0.8, ripple: 0.5, wobble: 0.5, rect: 0, startRadius: 1, drip: 1 },
  ripple: { needsOrigin: false, from: 'center', scale: [0.88, 0.88], neck: 0, residue: 0, ripple: 1, wobble: 0.3, rect: 1, startRadius: 0.5, drip: 0 },
  melt: { needsOrigin: false, from: 'bottom', scale: [1.06, 0.1], neck: 0.3, residue: 0.4, ripple: 0.4, wobble: 0.6, rect: 1, startRadius: 1, drip: 0 },
};

export const APPEAR_NAMES = Object.keys(APPEARANCES) as AppearName[];

/**
 * Choisit une apparition. `setting` : un nom, une liste (tirage dans la liste) ou 'random' (tirage dans tout le jeu).
 * Jamais deux fois la même d'affilée (si le tirage a plus d'un candidat). `ooze` est exclu sans origine.
 */
export function pickAppear(
  setting: AppearName | AppearName[] | 'random' | undefined,
  hasOrigin: boolean,
  last: AppearName | null,
  rng: () => number = Math.random,
): AppearName {
  const pool = setting === 'random' || setting === undefined ? APPEAR_NAMES : Array.isArray(setting) ? setting : [setting];
  let cands = pool.filter((n) => hasOrigin || !APPEARANCES[n].needsOrigin);
  if (cands.length === 0) cands = APPEAR_NAMES.filter((n) => !APPEARANCES[n].needsOrigin);
  if (cands.length > 1) cands = cands.filter((n) => n !== last);
  return cands[Math.floor(rng() * cands.length) % cands.length];
}

/** Trajectoire courbe du résidu : point de contrôle décalé perpendiculairement au segment. */
export function residuePoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
  bend = 0.35,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cx = (from.x + to.x) / 2 - dy * bend;
  const cy = (from.y + to.y) / 2 + dx * bend;
  return { x: quadBezier(from.x, cx, to.x, t), y: quadBezier(from.y, cy, to.y, t) };
}
