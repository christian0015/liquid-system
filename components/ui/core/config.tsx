'use client';

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ */
/* Types publics                                                       */
/* ------------------------------------------------------------------ */

export type Color = string;
export type Radius = number | [number, number, number, number];
export type AppearName = 'ooze' | 'unfold' | 'bloom' | 'drip' | 'ripple' | 'melt';
export type HapticName = 'tick' | 'soft' | 'confirm' | 'warn';
export type SoundName = 'pop' | 'ooze' | 'merge' | 'snap' | 'tick' | 'soft-alert' | 'confirm';
export type Tint = Color | { glue?: Color; glass?: Color; glow?: Color };

export type UIConfig = {
  /** Interrupteur du système liquide. `false` : rendu CSS simple. Aucune autre désactivation automatique n'existe. */
  enabled: boolean;
  theme: {
    base: Color;
    mode: 'auto' | 'light' | 'dark';
    /** Fond de l'application : couleur du thème (défaut), noir / blanc cassé, ou couleur personnalisée. */
    background: 'theme' | 'neutral' | 'custom';
    backgroundColor?: Color;
    accent?: Color;
    glue?: Color;
    glass?: Color;
    glow?: Color;
  };
  fluidity: { min: number; max: number };
  material: {
    /** Viscosité et relief en coussin (n'influence pas la luminosité). */
    glue: number;
    /** Halo lumineux, sans couleur propre : blanc teinté de la couleur du thème. */
    glow: number;
    reactive: number;
    /** Luminosité de la matière : intensité de la lumière, indépendante du gluant. */
    brightness: number;
    radius: Radius;
  };
  typography: {
    /** `font-family` des titres. */
    title: string;
    titleStyle: 'normal' | 'italic';
    titleWeight: number;
    /** Multiplicateur de taille des titres (les polices manuscrites sont plus petites à corps égal). */
    titleScale: number;
    /** `font-family` du texte courant. */
    body: string;
    bodyWeight: number;
  };
  light: {
    refraction: number;
    dispersion: number;
    specular: number;
    fresnel: number;
    thickness: number;
    grain: number;
    frost: number;
    iridescence: number;
    environment: 'studio' | 'soft' | 'neon' | 'custom';
  };
  motion: { appear: AppearName | 'random'; respectReducedMotion: boolean; ambient: number };
  quality: { maxDpr: number; margin: number; adaptive: boolean };
  haptics: { enabled: boolean; intensity: number };
  audioUi: { enabled: boolean; volume: number };
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const DEFAULT_CONFIG: UIConfig = {
  enabled: true,
  theme: { base: '#2f4b8a', mode: 'auto', background: 'theme' },
  fluidity: { min: 0.7, max: 1.3 },
  material: { glue: 0.18, glow: 0.12, reactive: 0.7, brightness: 0.5, radius: 47 },
  typography: {
    title: 'Georgia, "Times New Roman", serif',
    titleStyle: 'italic',
    titleWeight: 500,
    titleScale: 1,
    body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    bodyWeight: 500,
  },
  light: {
    refraction: 0.49,
    dispersion: 1,
    specular: 0.09,
    fresnel: 0.5,
    thickness: 18,
    grain: 0.08,
    frost: 0.15,
    iridescence: 1,
    environment: 'studio',
  },
  /** `ambient` : mouvement continu de la matière au repos (0 = figé, 1 = marqué). Bordures fixes. */
  motion: { appear: 'random', respectReducedMotion: false, ambient: 0.55 },
  quality: { maxDpr: 2, margin: 160, adaptive: false },
  haptics: { enabled: false, intensity: 0.5 },
  audioUi: { enabled: false, volume: 0.4 },
};

/* ------------------------------------------------------------------ */
/* Couleurs (TypeScript pur)                                            */
/* ------------------------------------------------------------------ */

export type RGB = [number, number, number]; // 0–1

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', cyan: '#00ffff',
  magenta: '#ff00ff', gray: '#808080', grey: '#808080', teal: '#008080', navy: '#000080',
  indigo: '#4b0082', violet: '#ee82ee', gold: '#ffd700', coral: '#ff7f50', crimson: '#dc143c',
  tomato: '#ff6347', salmon: '#fa8072', lime: '#00ff00', turquoise: '#40e0d0', brown: '#a52a2a',
  transparent: '#00000000',
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

/** Lit hex, rgb(), hsl() et quelques noms. Renvoie null si inconnu (le fournisseur DOM tente alors une normalisation). */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  const named = NAMED[s];
  if (named) return parseColor(named);
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (Number.isNaN(n)) return null;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = s.match(/^(rgba?|hsla?)\(([^)]+)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  const num = (p: string, scale: number) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / scale);
  if (m[1].startsWith('rgb')) {
    const v = parts.slice(0, 3).map((p) => clamp(num(p, 255)));
    return v.length === 3 && v.every((x) => !Number.isNaN(x)) ? [v[0], v[1], v[2]] : null;
  }
  const h = parseFloat(parts[0]);
  const sat = num(parts[1] ?? '0', 100);
  const lig = num(parts[2] ?? '0', 100);
  return [h, sat, lig].some(Number.isNaN) ? null : hslToRgb(h, clamp(sat), clamp(lig));
}

export const rgbToCss = ([r, g, b]: RGB) =>
  `rgb(${Math.round(clamp(r) * 255)} ${Math.round(clamp(g) * 255)} ${Math.round(clamp(b) * 255)})`;

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a: RGB, b: RGB) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Éclaircit ou assombrit `c` jusqu'à atteindre le contraste demandé contre `bg`. */
function ensureContrast(c: RGB, bg: RGB, min: number): RGB {
  const [h, s, l] = rgbToHsl(c);
  const dir = luminance(bg) < 0.4 ? 1 : -1;
  let ll = l;
  let out = c;
  for (let i = 0; i < 40 && contrast(out, bg) < min; i++) {
    ll = clamp(ll + dir * 0.025);
    out = hslToRgb(h, s, ll);
  }
  return contrast(out, bg) >= min ? out : dir > 0 ? [1, 1, 1] : [0, 0, 0];
}

/* ------------------------------------------------------------------ */
/* Thème dérivé (TypeScript pur)                                        */
/* ------------------------------------------------------------------ */

export type ResolvedTheme = {
  mode: 'light' | 'dark';
  /** Type de fond effectivement appliqué. */
  bgKind: 'theme' | 'neutral' | 'custom';
  base: RGB;
  bg: RGB;
  bg2: RGB;
  surface: RGB;
  ink: RGB;
  inkSoft: RGB;
  glue: RGB;
  glass: RGB;
  glow: RGB;
  palette: RGB[];
};

export function deriveTheme(theme: UIConfig['theme'], normalize?: (c: string) => RGB | null): ResolvedTheme {
  const read = (c: string | undefined, fallback: RGB): RGB => {
    if (!c) return fallback;
    return parseColor(c) ?? normalize?.(c) ?? fallback;
  };
  const base = read(theme.base, parseColor(DEFAULT_CONFIG.theme.base) as RGB);
  const [h, s] = rgbToHsl(base);
  // Fond : couleur du thème (défaut), noir / blanc cassé, ou couleur personnalisée.
  const custom = theme.background === 'custom' && theme.backgroundColor ? parseColor(theme.backgroundColor) ?? normalize?.(theme.backgroundColor) ?? null : null;
  const bgKind: ResolvedTheme['bgKind'] = theme.background === 'custom' && custom ? 'custom' : theme.background === 'neutral' ? 'neutral' : 'theme';
  // En mode auto, le texte suit la luminance du fond choisi (le fond personnalisé prime sur la base).
  const modeRef = bgKind === 'custom' && custom ? custom : base;
  const mode = theme.mode === 'auto' ? (luminance(modeRef) < 0.36 ? 'dark' : 'light') : theme.mode;
  const dark = mode === 'dark';
  const sat = clamp(s, 0.25, 0.95);

  let bg: RGB;
  let bg2: RGB;
  if (bgKind === 'custom' && custom) {
    bg = custom;
    bg2 = mixRgb(custom, dark ? [1, 1, 1] : [0, 0, 0], 0.07);
  } else if (bgKind === 'neutral') {
    bg = dark ? hslToRgb(h, 0.12, 0.018) : hslToRgb(h, 0.1, 0.945);
    bg2 = dark ? hslToRgb(h, 0.14, 0.05) : hslToRgb(h, 0.1, 0.9);
  } else {
    bg = dark ? hslToRgb(h, clamp(s, 0, 0.55), 0.065) : hslToRgb(h, clamp(s, 0, 0.45), 0.95);
    bg2 = dark ? hslToRgb(h, clamp(s, 0.2, 0.8), 0.17) : hslToRgb(h + 12, clamp(s, 0.2, 0.7), 0.86);
  }
  const surface = dark ? mixRgb(bg, [1, 1, 1], 0.07) : mixRgb(bg, [1, 1, 1], 0.55);

  const accent = theme.accent ? read(theme.accent, base) : undefined;
  const glueDefault = hslToRgb(h, clamp(sat, 0.5, 0.95), dark ? 0.58 : 0.5);
  const glassDefault = hslToRgb(h + 18, clamp(sat * 0.7, 0.2, 0.8), dark ? 0.74 : 0.62);
  // Le glow n'a pas de couleur propre : un blanc teinté de la couleur du thème (ou l'intensité de la même couleur).
  const glowDefault = accent ?? (dark ? hslToRgb(h, clamp(sat * 0.4, 0.12, 0.5), 0.82) : hslToRgb(h, clamp(sat * 0.8, 0.3, 0.9), 0.45));

  const inkRaw = dark ? hslToRgb(h, 0.25, 0.95) : hslToRgb(h, 0.35, 0.1);
  // Référence de contraste : le fond éclairé par les lueurs du backdrop et le verre (pire cas courant).
  const lift = bgKind === 'theme' ? (dark ? 0.3 : 0.2) : dark ? 0.12 : 0.08;
  const ref = mixRgb(bg, glueDefault, lift);
  const ink = ensureContrast(inkRaw, ref, 7);
  const inkSoft = ensureContrast(mixRgb(ink, ref, 0.3), ref, 4.5);

  const baseHsl = rgbToHsl(glueDefault);
  const palette: RGB[] = [0, 52, 118, 190, 255, 312].map((d) => hslToRgb(baseHsl[0] + d, clamp(baseHsl[1], 0.5, 0.9), dark ? 0.62 : 0.48));

  return {
    mode,
    bgKind,
    base,
    bg,
    bg2,
    surface,
    ink,
    inkSoft,
    glue: read(theme.glue, glueDefault),
    glass: read(theme.glass, glassDefault),
    glow: read(theme.glow, glowDefault),
    palette,
  };
}

/** Résout une prop `tint` contre le thème. */
export function resolveTint(theme: ResolvedTheme, tint?: Tint): { glue: RGB; glass: RGB; glow: RGB } {
  if (!tint) return { glue: theme.glue, glass: theme.glass, glow: theme.glow };
  if (typeof tint === 'string') {
    const c = parseColor(tint);
    return c ? { glue: c, glass: mixRgb(c, [1, 1, 1], 0.35), glow: mixRgb(c, [1, 1, 1], 0.15) } : resolveTint(theme);
  }
  const p = (v: string | undefined, f: RGB) => (v ? parseColor(v) ?? f : f);
  return { glue: p(tint.glue, theme.glue), glass: p(tint.glass, theme.glass), glow: p(tint.glow, theme.glow) };
}

/* ------------------------------------------------------------------ */
/* Fusion de configs (TypeScript pur)                                   */
/* ------------------------------------------------------------------ */

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeConfig<T>(base: T, patch?: DeepPartial<T>): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? mergeConfig(out[k], v) : v;
  }
  return out as T;
}

/* ------------------------------------------------------------------ */
/* Contexte et fournisseur                                              */
/* ------------------------------------------------------------------ */

type Ctx = {
  /** Monte un nœud (ex. l'hôte des toasts) dans le provider racine ; renvoie la fonction de retrait. */
  registerHost: (key: string, node: ReactNode) => () => void;
  config: UIConfig;
  setConfig: (patch: DeepPartial<UIConfig>) => void;
  resetConfig: () => void;
  theme: ResolvedTheme;
  reducedMotion: boolean;
};

const UIContext = createContext<Ctx | null>(null);

let normalizer: ((c: string) => RGB | null) | undefined;
function domNormalize(c: string): RGB | null {
  if (typeof document === 'undefined') return null;
  if (!normalizer) {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    normalizer = (col) => {
      if (!ctx) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#010203';
      ctx.fillStyle = col;
      const first = ctx.fillStyle;
      ctx.fillStyle = '#fdfcfb';
      ctx.fillStyle = col;
      if (first !== ctx.fillStyle) return null; // couleur invalide
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] / 255, d[1] / 255, d[2] / 255];
    };
  }
  return normalizer(c);
}

/** Variables CSS du thème (utilisées par UIProvider et par les portails, qui sortent du `.lq-root`). */
export function themeVars(theme: ResolvedTheme, radius: UIConfig['material']['radius'], typo: UIConfig['typography']): CSSProperties {
  const css = (c: RGB) => rgbToCss(c);
  return {
    '--lq-bg': css(theme.bg),
    '--lq-bg2': css(theme.bg2),
    '--lq-surface': css(theme.surface),
    '--lq-ink': css(theme.ink),
    '--lq-ink-soft': css(theme.inkSoft),
    '--lq-glue': css(theme.glue),
    '--lq-glass': css(theme.glass),
    '--lq-glow': css(theme.glow),
    '--lq-radius': `${Array.isArray(radius) ? Math.max(0, radius[0]) : Math.max(0, radius)}px`,
    '--lq-font-title': typo.title,
    '--lq-title-style': typo.titleStyle,
    '--lq-title-weight': typo.titleWeight,
    '--lq-title-scale': typo.titleScale,
    '--lq-font-body': typo.body,
    '--lq-body-weight': typo.bodyWeight,
  } as CSSProperties;
}

export function UIProvider({
  config,
  children,
  className,
  style,
}: {
  config?: DeepPartial<UIConfig>;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const parent = useContext(UIContext);
  const [local, setLocal] = useState<DeepPartial<UIConfig>>({});
  const [reducedMotion, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const merged = useMemo(
    () => mergeConfig(mergeConfig(parent?.config ?? DEFAULT_CONFIG, config), local),
    [parent?.config, config, local],
  );

  const setConfig = useCallback((patch: DeepPartial<UIConfig>) => setLocal((l) => mergeConfig(l as UIConfig, patch as DeepPartial<UIConfig>) as DeepPartial<UIConfig>), []);
  const resetConfig = useCallback(() => setLocal({}), []);

  // Le thème est recalculé après montage pour accepter les noms CSS inconnus de parseColor (normalisation canvas).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const theme = useMemo(() => deriveTheme(merged.theme, ready ? domNormalize : undefined), [merged.theme, ready]);

  // Hôtes montés à la demande (ex. toasts) : rendus dans le contexte du provider racine.
  const [hosts, setHosts] = useState<Record<string, ReactNode>>({});
  const parentRegister = parent?.registerHost;
  const registerHost = useCallback(
    (key: string, node: ReactNode) => {
      if (parentRegister) return parentRegister(key, node);
      setHosts((h) => ({ ...h, [key]: node }));
      return () =>
        setHosts((h) => {
          const next = { ...h };
          delete next[key];
          return next;
        });
    },
    [parentRegister],
  );

  const value = useMemo<Ctx>(
    () => ({ registerHost, config: merged, setConfig, resetConfig, theme, reducedMotion }),
    [registerHost, merged, setConfig, resetConfig, theme, reducedMotion],
  );

  const vars = { ...themeVars(theme, merged.material.radius, merged.typography), ...style } as CSSProperties;

  return (
    <UIContext.Provider value={value}>
      <div className={`lq-root${className ? ` ${className}` : ''}`} data-mode={theme.mode} style={vars}>
        {children}
        {Object.entries(hosts).map(([k, n]) => (
          <Fragment key={k}>{n}</Fragment>
        ))}
      </div>
    </UIContext.Provider>
  );
}

function useCtx(): Ctx {
  const c = useContext(UIContext);
  if (!c) throw new Error('Liquid UI : enveloppez l’application dans <UIProvider>.');
  return c;
}

/** `[config, setConfig]` : lecture de la config fusionnée et mise à jour à chaud (fusion profonde). */
export function useUIConfig(): [UIConfig, (patch: DeepPartial<UIConfig>) => void, () => void] {
  const { config, setConfig, resetConfig } = useCtx();
  return [config, setConfig, resetConfig];
}

export const useTheme = () => useCtx().theme;
export const useReducedMotion = () => {
  const { reducedMotion, config } = useCtx();
  return reducedMotion && config.motion.respectReducedMotion;
};
export const useUIContext = useCtx;

/** Variables CSS du thème courant, pour les portails. */
export function useThemeVars(): { vars: CSSProperties; mode: 'light' | 'dark' } {
  const { theme, config } = useCtx();
  return { vars: themeVars(theme, config.material.radius, config.typography), mode: theme.mode };
}
