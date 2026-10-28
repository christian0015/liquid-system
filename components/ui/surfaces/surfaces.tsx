'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { resolveTint, useTheme, useUIConfig, type RGB, type Tint } from '../core/config';
import { fluidityMult, Spring } from '../core/motion';
import { useFeedback } from '../core/feedback';
import { pathClipUrl, useStageItem, type ItemFrame, type Material } from '../core/stage';
import {
  borderRadiusCss,
  makeShape,
  needsClipPath,
  shapeToClipPath,
  type Radii,
  type ShapeInput,
} from '../core/shape';

/* ------------------------------------------------------------------ */
/* Lexique de matière (props réservées, section 5.2 du README)         */
/* ------------------------------------------------------------------ */

export type MatterProps = {
  tint?: Tint;
  glue?: number;
  glow?: number | boolean;
  dispersion?: number;
  refraction?: number;
  specular?: number;
  fresnel?: number;
  grain?: number;
  frost?: number;
  iridescence?: number;
  /** Luminosité de la matière (indépendante du gluant). */
  brightness?: number;
  thickness?: number;
  shape?: ShapeInput;
  radius?: number | Radii;
  speed?: number;
  reactive?: number;
  disabled?: boolean;
  haptics?: boolean | import('../core/config').HapticName;
  audioUi?: boolean | import('../core/config').SoundName;
};

export type FrameCtx = {
  el: HTMLElement;
  rect: DOMRect;
  now: number;
  dt: number;
  mult: number;
  pointer: { x: number; y: number; inside: boolean; down: boolean; dent: number; press: number };
};

export type SurfaceProps = MatterProps &
  Omit<ComponentPropsWithoutRef<'div'>, 'color'> & {
    as?: ElementType;
    type?: 'button' | 'submit' | 'reset';
    href?: string;
    variant?: 'flat' | 'raised' | 'inset';
    size?: 'sm' | 'md' | 'lg';
    ref?: Ref<HTMLElement>;
    children?: ReactNode;
    /** Avancé : modifie l'image envoyée à la scène (blobs, forme, alpha). Utilisé par les contrôles. */
    onFrame?: (frame: ItemFrame, ctx: FrameCtx) => ItemFrame;
  };

const MATTER_KEYS = [
  'tint', 'glue', 'glow', 'dispersion', 'refraction', 'specular', 'fresnel', 'grain', 'frost', 'iridescence', 'brightness',
  'thickness', 'shape', 'radius', 'speed', 'reactive', 'disabled', 'haptics', 'audioUi',
] as const;

/** Sépare les props de matière des props DOM. */
export function splitMatter<T extends MatterProps>(props: T) {
  const matter: MatterProps = {};
  const rest: Record<string, unknown> = { ...props };
  for (const k of MATTER_KEYS) {
    if (k in rest) {
      (matter as Record<string, unknown>)[k] = rest[k];
      delete rest[k];
    }
  }
  return { matter, rest: rest as Omit<T, (typeof MATTER_KEYS)[number]> };
}

/** Résout la matière d'un composant : props > config globale. */
export function useMaterial(p: MatterProps) {
  const [config] = useUIConfig();
  const theme = useTheme();
  const { material, light } = config;
  const glow = p.glow === undefined ? material.glow : p.glow === true ? Math.max(material.glow, 0.65) : p.glow === false ? 0 : p.glow;
  const mat: Material = {
    glue: p.glue ?? material.glue,
    glow,
    refraction: p.refraction ?? light.refraction,
    dispersion: p.dispersion ?? light.dispersion,
    specular: p.specular ?? light.specular,
    fresnel: p.fresnel ?? light.fresnel,
    thickness: p.thickness ?? light.thickness,
    grain: p.grain ?? light.grain,
    frost: p.frost ?? light.frost,
    iridescence: p.iridescence ?? light.iridescence,
    brightness: p.brightness ?? material.brightness,
  };
  const colors = useMemo(() => resolveTint(theme, p.tint), [theme, p.tint]);
  return {
    mat,
    colors,
    reactive: p.reactive ?? material.reactive,
    mult: fluidityMult(p.speed, config.fluidity),
    radius: p.radius ?? material.radius,
    shape: p.shape ?? ('rect' as ShapeInput),
    config,
    theme,
  };
}

/* ------------------------------------------------------------------ */
/* Pointeur : creux élastique et appui                                  */
/* ------------------------------------------------------------------ */

export function usePointerMatter(ref: RefObject<HTMLElement | null>, reactive: number, mult: number, disabled?: boolean) {
  const st = useRef({
    x: 0,
    y: 0,
    inside: false,
    down: false,
    dent: new Spring(0, mult, 0.5),
    press: new Spring(0, mult, 0.42),
  });
  const { invalidate } = useStageItemInvalidate();

  useEffect(() => {
    st.current.dent.tune(mult, 0.5);
    st.current.press.tune(mult, 0.42);
  }, [mult]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = st.current;
    const upd = () => {
      s.dent.target = disabled ? 0 : reactive * ((s.inside ? 0.38 : 0) + (s.down ? 0.62 : 0));
      s.press.target = s.down && !disabled ? 1 : 0;
      invalidate();
    };
    const move = (e: PointerEvent) => {
      s.x = e.clientX;
      s.y = e.clientY;
      s.inside = true;
      upd();
    };
    const leave = () => {
      s.inside = false;
      s.down = false;
      upd();
    };
    const down = (e: PointerEvent) => {
      s.x = e.clientX;
      s.y = e.clientY;
      s.down = true;
      s.inside = true;
      upd();
    };
    const up = () => {
      s.down = false;
      upd();
    };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerenter', move, { passive: true });
    el.addEventListener('pointerleave', leave, { passive: true });
    el.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerenter', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [ref, reactive, disabled, invalidate]);

  const sample = useCallback((dt: number) => {
    const s = st.current;
    s.dent.step(dt);
    s.press.step(dt);
    return {
      x: s.x,
      y: s.y,
      inside: s.inside,
      down: s.down,
      dent: s.dent.x,
      press: s.press.x,
      busy: !s.dent.settled || !s.press.settled,
    };
  }, []);

  return { sample };
}

function useStageItemInvalidate() {
  // Évite d'importer getStage ici : l'invalidation passe par un événement léger sur window.
  return useMemo(
    () => ({
      invalidate: () => {
        window.dispatchEvent(new Event('lq-invalidate'));
      },
    }),
    [],
  );
}

/* ------------------------------------------------------------------ */
/* Utilitaires partagés (non exportés publiquement)                     */
/* ------------------------------------------------------------------ */

export function useMergedRef<T>(...refs: (Ref<T> | undefined)[]) {
  return useCallback(
    (node: T | null) => {
      for (const r of refs) {
        if (typeof r === 'function') r(node);
        else if (r) (r as { current: T | null }).current = node;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    refs,
  );
}

export type Origin = RefObject<Element | null> | DOMRect | { x: number; y: number };

/** Rectangle viewport d'une origine (élément, DOMRect ou point). */
export function resolveOrigin(o: Origin | undefined): { x: number; y: number; w: number; h: number } | null {
  if (!o) return null;
  if ('current' in o) {
    const el = o.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  if ('width' in o) return { x: o.x, y: o.y, w: o.width, h: o.height };
  return { x: o.x, y: o.y, w: 0, h: 0 };
}

export const rgbCss = (c: RGB, a = 1) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)} / ${a})`;

/** Contour DOM : border-radius pour les formes convexes, clip-path sinon (coins concaves, ellipse, chemin). */
export function useShapeStyle(
  ref: RefObject<HTMLElement | null>,
  shape: ShapeInput,
  radius: number | Radii,
): CSSProperties {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.borderBoxSize?.[0]?.inlineSize ?? e.contentRect.width);
      const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height);
      setDims((d) => (d && d.w === w && d.h === h ? d : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const dep = typeof shape === 'string' ? shape : shape.path;
  const rkey = Array.isArray(radius) ? radius.join(',') : String(radius);
  return useMemo(() => {
    const w = dims?.w ?? 0;
    const h = dims?.h ?? 0;
    const state = makeShape(shape, Math.max(w, 1), Math.max(h, 1), radius);
    if (!dims) return { borderRadius: borderRadiusCss(state) };
    if (!needsClipPath(state)) return { borderRadius: borderRadiusCss(state) };
    const clip = shapeToClipPath(state) ?? (state.pathData ? pathClipUrl(state.pathData) : undefined);
    return { borderRadius: 0, clipPath: clip };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, dep, rkey]);
}

/* ------------------------------------------------------------------ */
/* Surface                                                              */
/* ------------------------------------------------------------------ */

/**
 * Le « div » du kit : base de toute matière. La matière (verre, gluant, glow) est dessinée dans le canvas partagé ;
 * le contenu reste du DOM, découpé au même contour.
 */
export function Surface({ as, variant = 'raised', size, children, className, style, onFrame, ref, ...props }: SurfaceProps) {
  const { matter, rest } = splitMatter(props);
  const Tag = (as ?? 'div') as ElementType;
  const own = useRef<HTMLElement>(null);
  const setRef = useMergedRef<HTMLElement>(own, ref);
  const m = useMaterial(matter);
  const { sample } = usePointerMatter(own, m.reactive, m.mult, matter.disabled);
  const shapeStyle = useShapeStyle(own, m.shape, m.radius);
  const { haptic, sound } = useFeedback(matter);

  // Les données de la dernière passe de rendu React sont relues à chaque image.
  const live = useRef({ m, variant, onFrame, disabled: matter.disabled });
  useLayoutEffect(() => {
    live.current = { m, variant, onFrame, disabled: matter.disabled };
  });

  useEffect(() => {
    const el = own.current;
    if (!el || matter.disabled) return;
    const onDown = () => {
      haptic('tick');
      sound('tick');
    };
    el.addEventListener('pointerdown', onDown, { passive: true });
    return () => el.removeEventListener('pointerdown', onDown);
  }, [haptic, sound, matter.disabled]);

  useStageItem({
    ref: own,
    frame: (now, dt) => {
      const el = own.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      const L = live.current;
      const ptr = sample(dt);
      const active = ptr.dent > 0.002 || ptr.press > 0.002;
      let f: ItemFrame = {
        box: { x: r.left, y: r.top, w: r.width, h: r.height },
        shape: makeShape(L.m.shape, r.width, r.height, L.m.radius),
        mat: L.m.mat,
        colors: L.m.colors,
        variant: L.variant === 'flat' ? 0 : L.variant === 'inset' ? 2 : 1,
        alpha: L.disabled ? 0.55 : 1,
        smooth: 10 + L.m.mat.glue * 26,
        pointer: active || ptr.inside ? { x: ptr.x, y: ptr.y, dent: ptr.dent, press: ptr.press } : undefined,
        busy: ptr.busy,
      };
      if (L.onFrame) {
        f = L.onFrame(f, { el, rect: r, now, dt, mult: L.m.mult, pointer: ptr });
      }
      return f;
    },
  });

  const vars = {
    '--lq-tint-glass': rgbCss(m.colors.glass),
    '--lq-tint-glue': rgbCss(m.colors.glue),
    '--lq-tint-glow': rgbCss(m.colors.glow),
    '--lq-glow-k': m.mat.glow,
    '--lq-frost-px': `${Math.round(6 + m.mat.frost * 18)}px`,
    ...shapeStyle,
    ...style,
  } as CSSProperties;

  return (
    <Tag
      ref={setRef}
      className={`lq-surface${className ? ` ${className}` : ''}`}
      data-variant={variant}
      data-size={size}
      data-matter=""
      data-disabled={matter.disabled ? '' : undefined}
      style={vars}
      {...rest}
    >
      {children}
    </Tag>
  );
}
