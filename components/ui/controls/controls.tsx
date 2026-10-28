'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { useReducedMotion } from '../core/config';
import { useFeedback } from '../core/feedback';
import { clamp01, Spring } from '../core/motion';
import { makeShape } from '../core/shape';
import { getStage, useStageItem, type Blob, type ItemFrame, type Material } from '../core/stage';
import { LiquidPanel, useOpenState } from '../overlays/overlays';
import {
  splitMatter,
  Surface,
  useMaterial,
  useMergedRef,
  type MatterProps,
  type SurfaceProps,
} from '../surfaces/surfaces';

const SIZES = {
  sm: { h: 34, thumb: 10, track: 8, font: 13 },
  md: { h: 44, thumb: 13, track: 10, font: 15 },
  lg: { h: 54, thumb: 16, track: 12, font: 17 },
} as const;
type Size = keyof typeof SIZES;

/* ------------------------------------------------------------------ */
/* Button                                                               */
/* ------------------------------------------------------------------ */

export type ButtonProps = Omit<SurfaceProps, 'as'> & {
  as?: 'button' | 'a';
  size?: Size;
};

/** Origine naturelle du gluant : déformation élastique à l'appui, goutte qui suit le doigt, rebond au relâchement. */
export function Button({ size = 'md', variant = 'raised', radius = 999, glue = 0.75, onFrame, onClick, children, className, type, ...rest }: ButtonProps) {
  const { matter } = splitMatter(rest);
  const { haptic, sound } = useFeedback(matter);
  const frame = useCallback(
    (f: ItemFrame, c: Parameters<NonNullable<SurfaceProps['onFrame']>>[1]): ItemFrame => {
      const press = c.pointer.press;
      let out = f;
      if (press > 0.002) {
        // Écrasement élastique et goutte qui suit le doigt.
        const sq = 1 + 0.045 * press;
        const sh = 1 - 0.07 * press;
        const w = f.box.w * sq;
        const h = f.box.h * sh;
        const cx = f.box.x + f.box.w / 2;
        const cy = f.box.y + f.box.h / 2;
        const r = Math.min(f.box.h, f.box.w) * 0.32 * press;
        const px = Math.min(Math.max(c.pointer.x, f.box.x + r), f.box.x + f.box.w - r);
        const py = Math.min(Math.max(c.pointer.y, f.box.y + r), f.box.y + f.box.h - r);
        out = {
          ...f,
          box: { x: cx - w / 2, y: cy - h / 2, w, h },
          shape: { ...f.shape, w, h },
          blobs: [...(f.blobs ?? []), { x: px, y: py, r }],
          smooth: 16 + 14 * press,
        };
      }
      return onFrame ? onFrame(out, c) : out;
    },
    [onFrame],
  );
  const isLink = rest.href !== undefined || (rest as { as?: string }).as === 'a';
  return (
    <Surface
      as={isLink ? 'a' : 'button'}
      type={isLink ? undefined : (type ?? 'button')}
      variant={variant}
      radius={radius}
      glue={glue}
      size={size}
      className={`lq-btn${className ? ` ${className}` : ''}`}
      onFrame={frame}
      onClick={(e) => {
        if (!matter.disabled) {
          haptic('soft');
          sound('pop');
        }
        onClick?.(e);
      }}
      {...rest}
    >
      <span className="lq-btn-label">{children}</span>
    </Surface>
  );
}

/* ------------------------------------------------------------------ */
/* Pouce liquide partagé (Switch, Slider)                               */
/* ------------------------------------------------------------------ */

type ThumbGeom = {
  track: DOMRect;
  /** 0–1, position courante (ressort). */
  t: number;
  /** Position lente pour le cou de matière. */
  tail: number;
  vel: number;
};

/** Enregistre la matière d'un pouce (goutte qui s'étire et fusionne avec sa piste). */
function useThumbMatter(
  trackRef: RefObject<HTMLElement | null>,
  geom: () => { t: number; tail: number; vel: number; active: number },
  build: (g: ThumbGeom, mat: ReturnType<typeof useMaterial>, active: number) => (Omit<ItemFrame, 'mat' | 'colors'> & { mat?: Material }) | null,
  m: ReturnType<typeof useMaterial>,
) {
  const live = useRef({ m, build, geom });
  useLayoutEffect(() => {
    live.current = { m, build, geom };
  });
  useStageItem({
    ref: trackRef,
    z: 2,
    frame: () => {
      const el = trackRef.current;
      if (!el) return null;
      const R = el.getBoundingClientRect();
      if (R.width < 1) return null;
      const L = live.current;
      const g = L.geom();
      const out = L.build({ track: R, t: g.t, tail: g.tail, vel: g.vel }, L.m, g.active);
      if (!out) return null;
      return { ...out, mat: out.mat ?? L.m.mat, colors: L.m.colors } as ItemFrame;
    },
  });
}

/* ------------------------------------------------------------------ */
/* Switch                                                               */
/* ------------------------------------------------------------------ */

export type SwitchProps = MatterProps & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: Size;
  label?: string;
  className?: string;
  style?: CSSProperties;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

/** Le pouce est une goutte qui s'étire et fusionne avec la piste pendant le changement d'état. */
export function Switch({ checked, defaultChecked, onCheckedChange, size = 'md', label, className, style, id, name, ...props }: SwitchProps) {
  const { matter } = splitMatter(props);
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  const m = useMaterial({ glue: 0.9, glow: on ? 0.55 : 0.1, ...matter });
  const reduced = useReducedMotion();
  const { haptic, sound } = useFeedback(matter);
  const trackRef = useRef<HTMLElement>(null);
  const head = useRef(new Spring(on ? 1 : 0, m.mult, 0.5));
  const tail = useRef(new Spring(on ? 1 : 0, m.mult * 0.55, 0.8));
  const sz = SIZES[size];
  const trackH = Math.round(sz.h * 0.68);
  const trackW = Math.round(trackH * 1.85);

  useEffect(() => {
    head.current.tune(m.mult * 1.15, 0.5);
    tail.current.tune(m.mult * 0.5, 0.85);
    const t = on ? 1 : 0;
    if (reduced) {
      head.current.snap(t);
      tail.current.snap(t);
    } else {
      head.current.target = t;
      tail.current.target = t;
    }
    getStage()?.invalidate();
  }, [on, m.mult, reduced]);

  const toggle = () => {
    if (matter.disabled) return;
    const next = !on;
    if (checked === undefined) setInner(next);
    onCheckedChange?.(next);
    haptic('confirm');
    sound('merge');
  };

  const pad = 4;
  useThumbMatter(
    trackRef,
    () => {
      const h = head.current;
      const t2 = tail.current;
      const dt = 1 / 60;
      h.step(dt);
      t2.step(dt);
      return { t: h.x, tail: t2.x, vel: h.v, active: clamp01(Math.abs(h.v) / 3) };
    },
    (g, mm, active) => {
      const r = g.track.height / 2 - pad;
      const span = g.track.width - 2 * (pad + r);
      const cy = g.track.top + g.track.height / 2;
      const x = g.track.left + pad + r + g.t * span;
      const xt = g.track.left + pad + r + g.tail * span;
      const stretch = Math.abs(x - xt);
      const blobs: Blob[] = stretch > 0.5 ? [{ x: xt, y: cy, r: r * (0.92 - Math.min(0.3, stretch / 90)) }] : [];
      // Gluant bas au repos (pouce net), élevé en mouvement (fusion avec la piste).
      const glue = 0.42 + 0.5 * Math.max(active, clamp01(stretch / 14));
      return {
        box: { x: x - r, y: cy - r, w: r * 2, h: r * 2 },
        shape: makeShape('ellipse', r * 2, r * 2),
        blobs,
        smooth: 10 + stretch * 0.4,
        variant: 1,
        busy: !head.current.settled || !tail.current.settled,
        mat: { ...mm.mat, glue, glow: mm.mat.glow * 0.7, thickness: Math.max(6, r * 0.7) },
        alpha: matter.disabled ? 0.55 : 1,
      };
    },
    m,
  );

  const key = (e: ReactKeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  };

  const el = (
    <Surface
      ref={trackRef}
      as="button"
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      id={id}
      name={name}
      variant="inset"
      radius={999}
      glue={0.35}
      glow={on ? 0.6 : 0}
      reactive={0.25}
      disabled={matter.disabled}
      tint={matter.tint}
      className={`lq-switch${className ? ` ${className}` : ''}`}
      data-on={on ? '' : undefined}
      style={{ width: trackW, height: trackH, ...style }}
      onClick={toggle}
      onKeyDown={key}
      haptics={false}
      audioUi={false}
    />
  );
  if (!label) return el;
  return (
    <label className="lq-field-inline">
      {el}
      <span>{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Slider                                                               */
/* ------------------------------------------------------------------ */

export type SliderProps = MatterProps & {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: Size;
  label?: string;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-valuetext'?: string;
};

const snapTo = (v: number, min: number, max: number, step: number) => {
  const n = Math.round((v - min) / step) * step + min;
  const dec = (String(step).split('.')[1] ?? '').length;
  return Math.min(max, Math.max(min, Number(n.toFixed(dec))));
};

/** Le pouce est une goutte ; la piste forme un cou de matière vers lui pendant le glissement. */
export function Slider({ value, defaultValue, onValueChange, min = 0, max = 1, step = 0.01, size = 'md', label, className, style, ...props }: SliderProps) {
  const { matter } = splitMatter(props);
  const [inner, setInner] = useState(defaultValue ?? min);
  const v = Math.min(max, Math.max(min, value ?? inner));
  const m = useMaterial({ glue: 0.9, glow: 0.45, ...matter });
  const reduced = useReducedMotion();
  const { haptic, sound } = useFeedback(matter);
  const wrap = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const head = useRef(new Spring((v - min) / (max - min || 1), m.mult * 1.6, 0.7));
  const tail = useRef(new Spring((v - min) / (max - min || 1), m.mult * 0.7, 0.8));
  const dragging = useRef(false);
  const lastTick = useRef(v);
  const sz = SIZES[size];

  useEffect(() => {
    const t = (v - min) / (max - min || 1);
    head.current.tune(m.mult * 1.6, 0.7);
    tail.current.tune(m.mult * 0.7, 0.8);
    if (reduced) {
      head.current.snap(t);
      tail.current.snap(t);
    } else {
      head.current.target = t;
      tail.current.target = t;
    }
    getStage()?.invalidate();
  }, [v, min, max, m.mult, reduced]);

  const commit = (next: number) => {
    const s = snapTo(next, min, max, step);
    if (s === v) return;
    if (value === undefined) setInner(s);
    onValueChange?.(s);
    if (Math.abs(s - lastTick.current) >= (max - min) / 20) {
      lastTick.current = s;
      haptic('tick');
      sound('tick');
    }
  };

  const fromPointer = (e: ReactPointerEvent) => {
    const R = trackRef.current?.getBoundingClientRect();
    if (!R) return;
    const r = sz.thumb;
    commit(min + clamp01((e.clientX - R.left - r) / Math.max(1, R.width - 2 * r)) * (max - min));
  };

  const key = (e: ReactKeyboardEvent) => {
    const big = Math.max(step, (max - min) / 10);
    const map: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big };
    if (e.key in map) {
      e.preventDefault();
      commit(v + map[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      commit(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      commit(max);
    }
  };

  useThumbMatter(
    trackRef,
    () => {
      head.current.step(1 / 60);
      tail.current.step(1 / 60);
      return { t: head.current.x, tail: tail.current.x, vel: head.current.v, active: dragging.current ? 1 : clamp01(Math.abs(head.current.v) / 2) };
    },
    (g, mm, active) => {
      const r = sz.thumb + 1.5 + active * 2.5;
      const span = g.track.width - 2 * sz.thumb;
      const cy = g.track.top + g.track.height / 2;
      const x = g.track.left + sz.thumb + g.t * span;
      const xt = g.track.left + sz.thumb + g.tail * span;
      const fillH = g.track.height * 0.82;
      // Remplissage : barre de la piste jusqu'au pouce ; le cou de matière naît de la fusion barre/goutte.
      const fillW = Math.max(fillH, x - g.track.left + fillH * 0.4);
      const blobs: Blob[] = [{ x, y: cy, r }];
      if (Math.abs(x - xt) > 1) blobs.push({ x: xt, y: cy, r: r * 0.78 });
      return {
        box: { x: g.track.left, y: cy - fillH / 2, w: fillW, h: fillH },
        shape: makeShape('rect', fillW, fillH, 999),
        blobs,
        smooth: 14 + active * 12 + Math.abs(x - xt) * 0.3,
        variant: 1,
        busy: !head.current.settled || !tail.current.settled || dragging.current,
        mat: { ...mm.mat, thickness: Math.max(6, sz.track * 0.8), glow: mm.mat.glow * (0.7 + 0.5 * active) },
        alpha: matter.disabled ? 0.55 : 1,
      };
    },
    m,
  );

  const pct = Math.round(((v - min) / (max - min || 1)) * 100);
  const track = (
    <div
      ref={wrap}
      className={`lq-slider${className ? ` ${className}` : ''}`}
      role="slider"
      tabIndex={matter.disabled ? -1 : 0}
      aria-label={props['aria-label'] ?? label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={v}
      aria-valuetext={props['aria-valuetext']}
      aria-disabled={matter.disabled || undefined}
      data-size={size}
      style={{ '--lq-slider-fill': `${pct}%`, ...style } as CSSProperties}
      onKeyDown={matter.disabled ? undefined : key}
      onPointerDown={(e) => {
        if (matter.disabled) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
        fromPointer(e);
        getStage()?.invalidate();
      }}
      onPointerMove={(e) => {
        if (dragging.current) fromPointer(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
        getStage()?.invalidate();
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <Surface
        ref={trackRef as Ref<HTMLElement>}
        variant="inset"
        radius={999}
        glue={0.2}
        glow={0}
        reactive={0}
        tint={matter.tint}
        disabled={matter.disabled}
        className="lq-slider-track"
        style={{ height: sz.track }}
        haptics={false}
        audioUi={false}
      />
    </div>
  );
  if (!label) return track;
  return (
    <div className="lq-field">
      <div className="lq-field-head">
        <span className="lq-label">{label}</span>
        <output className="lq-value">{Number.isInteger(step) ? v : v.toFixed(Math.min(3, (String(step).split('.')[1] ?? '').length))}</output>
      </div>
      {track}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TextField                                                            */
/* ------------------------------------------------------------------ */

export type TextFieldProps = MatterProps &
  Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'color' | 'disabled'> & {
    size?: Size;
    label?: string;
    hint?: string;
    error?: string;
    multiline?: boolean;
    rows?: number;
    ref?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  };

/** Au focus, la bordure et le glow se propagent comme un liquide autour du champ, depuis le point de contact. */
export function TextField({ size = 'md', label, hint, error, multiline, rows = 3, className, style, id, ref, ...props }: TextFieldProps) {
  const { matter, rest } = splitMatter(props);
  const auto = useId();
  const fid = id ?? auto;
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLElement>(null);
  const focus = useRef(new Spring(0, 1, 0.55));
  const origin = useRef({ x: 0, y: 0, t0: -1 });
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const setRef = useMergedRef<HTMLInputElement | HTMLTextAreaElement>(inputRef, ref);
  const m = useMaterial({ glue: 0.55, glow: 0.2, radius: multiline ? 20 : 999, ...matter, tint: error ? { glow: '#fb7185', glue: '#fb7185' } : matter.tint });
  const { haptic, sound } = useFeedback(matter);

  useEffect(() => {
    focus.current.tune(m.mult, 0.55);
  }, [m.mult]);

  const setFocus = (on: boolean, e?: { clientX?: number; clientY?: number }) => {
    const R = wrapRef.current?.getBoundingClientRect();
    if (on && R) {
      origin.current = { x: e?.clientX ?? R.left + R.width / 2, y: e?.clientY ?? R.top + R.height / 2, t0: performance.now() };
      haptic('tick');
      sound('tick');
    }
    if (reduced) focus.current.snap(on ? 1 : 0);
    else focus.current.target = on ? 1 : 0;
    getStage()?.invalidate();
  };

  const onFrame = useCallback(
    (f: ItemFrame, c: { now: number; dt: number }): ItemFrame => {
      focus.current.step(c.dt);
      const k = focus.current.x;
      const age = (c.now - origin.current.t0) / 1000;
      const growing = origin.current.t0 > 0 && age < 1.4 && k > 0.02;
      const g = f.mat.glow + (0.95 - f.mat.glow) * clamp01(k);
      const pad = 3 * clamp01(k);
      return {
        ...f,
        box: { x: f.box.x - pad, y: f.box.y - pad, w: f.box.w + pad * 2, h: f.box.h + pad * 2 },
        shape: { ...f.shape, w: f.shape.w + pad * 2, h: f.shape.h + pad * 2 },
        mat: { ...f.mat, glow: g, glue: f.mat.glue + 0.3 * clamp01(k) },
        // Propagation : une onde part du point de contact et fait le tour de la bordure.
        ripple: growing ? { x: origin.current.x, y: origin.current.y, t: age, amp: 0.7 * clamp01(k) } : undefined,
        busy: f.busy || !focus.current.settled || growing,
      };
    },
    [],
  );

  const Tag = (multiline ? 'textarea' : 'input') as 'input';
  return (
    <div className={`lq-field${className ? ` ${className}` : ''}`} data-size={size} data-invalid={error ? '' : undefined} style={style}>
      {label && (
        <label className="lq-label" htmlFor={fid}>
          {label}
        </label>
      )}
      <Surface
        ref={wrapRef}
        variant="inset"
        glue={m.mat.glue}
        glow={m.mat.glow}
        radius={m.radius}
        tint={error ? { glow: '#fb7185', glue: '#fb7185' } : matter.tint}
        disabled={matter.disabled}
        reactive={matter.reactive}
        speed={matter.speed}
        className="lq-input-wrap"
        onFrame={onFrame}
        haptics={false}
        audioUi={false}
        onPointerDown={(e) => {
          if (e.target !== inputRef.current) inputRef.current?.focus();
        }}
      >
        <Tag
          ref={setRef as Ref<HTMLInputElement>}
          id={fid}
          className="lq-input"
          disabled={matter.disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fid}-d` : undefined}
          {...(multiline ? { rows } : {})}
          {...(rest as ComponentPropsWithoutRef<'input'>)}
          onFocus={(e) => {
            setFocus(true, { clientX: undefined, clientY: undefined });
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          onPointerDown={(e) => {
            origin.current = { x: e.clientX, y: e.clientY, t0: performance.now() };
          }}
        />
      </Surface>
      {(error || hint) && (
        <span id={`${fid}-d`} className="lq-hint" data-error={error ? '' : undefined} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                 */
/* ------------------------------------------------------------------ */

export type TabItem = { value: string; label: ReactNode; disabled?: boolean };
export type TabsProps = MatterProps & {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: Size;
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** Rend le panneau de l'onglet actif (rôle `tabpanel`). */
  children?: (value: string) => ReactNode;
};

/** L'indicateur est une goutte qui s'étire d'un onglet à l'autre, puis se rétracte. */
export function Tabs({ items, value, defaultValue, onValueChange, size = 'md', label = 'Onglets', className, style, children, ...props }: TabsProps) {
  const { matter } = splitMatter(props);
  const [inner, setInner] = useState(defaultValue ?? items[0]?.value ?? '');
  const current = value ?? inner;
  const m = useMaterial({ glue: 0.9, glow: 0.45, ...matter });
  const reduced = useReducedMotion();
  const { haptic, sound } = useFeedback(matter);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const left = useRef(new Spring(0, m.mult, 0.62));
  const right = useRef(new Spring(0, m.mult, 0.62));
  const ready = useRef(false);
  const uid = useId();

  const measure = useCallback(() => {
    const list = listRef.current;
    const el = tabRefs.current.get(current);
    if (!list || !el) return null;
    const L = list.getBoundingClientRect();
    const R = el.getBoundingClientRect();
    return { a: R.left - L.left, b: R.right - L.left };
  }, [current]);

  useLayoutEffect(() => {
    const t = measure();
    if (!t) return;
    const l = left.current;
    const r = right.current;
    const moveRight = t.a > l.x;
    // Le bord d'attaque part vite, le bord de fuite le suit en retard : la goutte s'étire puis se rétracte.
    l.tune(m.mult * (moveRight ? 0.55 : 1.5), moveRight ? 0.85 : 0.55);
    r.tune(m.mult * (moveRight ? 1.5 : 0.55), moveRight ? 0.55 : 0.85);
    if (!ready.current || reduced) {
      l.snap(t.a);
      r.snap(t.b);
      ready.current = true;
    } else {
      l.target = t.a;
      r.target = t.b;
    }
    getStage()?.invalidate();
  }, [current, measure, m.mult, reduced, items.length]);

  useStageItem({
    ref: listRef,
    z: 2,
    frame: (_n, dt) => {
      const list = listRef.current;
      if (!list || !ready.current) return null;
      const L = list.getBoundingClientRect();
      if (L.width < 1) return null;
      // Si la mise en page a changé (redimensionnement), recale la cible.
      const t = measure();
      if (t && (Math.abs(left.current.target - t.a) > 0.5 || Math.abs(right.current.target - t.b) > 0.5)) {
        left.current.target = t.a;
        right.current.target = t.b;
      }
      left.current.step(dt);
      right.current.step(dt);
      const a = left.current.x;
      const b = Math.max(right.current.x, a + 16);
      const pad = 4;
      const h = L.height - pad * 2;
      const stretch = Math.abs(left.current.v) + Math.abs(right.current.v);
      const lead = right.current.v > left.current.v ? b : a;
      return {
        box: { x: L.left + a, y: L.top + pad, w: b - a, h },
        shape: makeShape('rect', b - a, h, 999),
        blobs: stretch > 20 ? [{ x: L.left + lead, y: L.top + L.height / 2, r: h * 0.38 }] : [],
        smooth: 14 + Math.min(18, stretch * 0.03),
        mat: { ...m.mat, thickness: Math.max(6, h * 0.35) },
        colors: m.colors,
        variant: 1,
        alpha: matter.disabled ? 0.55 : 1,
        busy: !left.current.settled || !right.current.settled,
      };
    },
  });

  const select = (v: string) => {
    if (v === current) return;
    if (value === undefined) setInner(v);
    onValueChange?.(v);
    haptic('tick');
    sound('snap');
  };

  const onKey = (e: ReactKeyboardEvent) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.value === current);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next >= 0) {
      e.preventDefault();
      select(enabled[next].value);
      tabRefs.current.get(enabled[next].value)?.focus();
    }
  };

  return (
    <div className={`lq-tabs${className ? ` ${className}` : ''}`} style={style}>
      <Surface
        variant="inset"
        radius={999}
        glue={0.3}
        glow={0}
        reactive={0.2}
        tint={matter.tint}
        className="lq-tablist"
        data-size={size}
        haptics={false}
        audioUi={false}
        disabled={matter.disabled}
      >
        <div ref={listRef} className="lq-tablist-inner" role="tablist" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button
              key={it.value}
              ref={(n) => {
                if (n) tabRefs.current.set(it.value, n);
                else tabRefs.current.delete(it.value);
              }}
              type="button"
              role="tab"
              id={`${uid}-t-${it.value}`}
              aria-selected={current === it.value}
              aria-controls={children ? `${uid}-p` : undefined}
              tabIndex={current === it.value ? 0 : -1}
              disabled={it.disabled || matter.disabled}
              className="lq-tab"
              onClick={() => select(it.value)}
            >
              {it.label}
            </button>
          ))}
        </div>
      </Surface>
      {children && (
        <div id={`${uid}-p`} role="tabpanel" aria-labelledby={`${uid}-t-${current}`} className="lq-tabpanel" tabIndex={0}>
          {children(current)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Menu                                                                 */
/* ------------------------------------------------------------------ */

export type MenuItem =
  | { separator: true }
  | { label: string; onSelect?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; hint?: string; separator?: false };

export type MenuProps = MatterProps & {
  items: MenuItem[];
  /** Texte du déclencheur par défaut. */
  label?: string;
  /** Déclencheur personnalisé : reçoit le `ref` (origine du gluant) et les attributs ARIA. */
  trigger?: (p: { ref: RefObject<HTMLButtonElement | null>; onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  appear?: ComponentPropsWithoutRef<typeof LiquidPanel>['appear'];
  side?: 'top' | 'right' | 'bottom' | 'left';
  size?: Size;
  className?: string;
};

/** S'ouvre depuis son déclencheur avec le mécanisme du Popup ; navigation clavier complète. */
export function Menu({ items, label = 'Options', trigger, open, defaultOpen, onOpenChange, appear, side, size = 'md', className, ...props }: MenuProps) {
  const { matter } = splitMatter(props);
  const [isOpen, setOpen] = useOpenState(open, defaultOpen, onOpenChange);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { haptic, sound } = useFeedback(matter);

  const entries = items
    .map((it, i) => ({ it, i }))
    .filter((e): e is { it: Extract<MenuItem, { label: string }>; i: number } => !('separator' in e.it && e.it.separator) && !(e.it as { disabled?: boolean }).disabled);

  const focusItem = (n: number) => {
    const nodes = list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    if (!nodes?.length) return;
    nodes[(n + nodes.length) % nodes.length]?.focus();
  };

  const onKey = (e: ReactKeyboardEvent) => {
    const nodes = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(idx < 0 ? -1 : idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(-1); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const select = (it: Extract<MenuItem, { label: string }>) => {
    haptic('tick');
    sound('snap');
    setOpen(false);
    it.onSelect?.();
  };

  const props2 = { ref: btn, onClick: () => setOpen(!isOpen), 'aria-haspopup': 'menu' as const, 'aria-expanded': isOpen };
  void entries;
  return (
    <>
      {trigger ? (
        trigger(props2)
      ) : (
        <Button ref={btn as Ref<HTMLElement>} size={size} onClick={props2.onClick} aria-haspopup="menu" aria-expanded={isOpen} {...matter}>
          {label}
        </Button>
      )}
      <LiquidPanel
        {...matter}
        open={isOpen}
        onOpenChange={setOpen}
        origin={btn}
        appear={appear}
        side={side}
        role="menu"
        label={label}
        className={`lq-menu${className ? ` ${className}` : ''}`}
        radius={matter.radius ?? 22}
      >
        <div ref={list} className="lq-menu-list" onKeyDown={onKey}>
          {items.map((it, i) =>
            'separator' in it && it.separator ? (
              <div key={`s${i}`} className="lq-menu-sep" role="separator" />
            ) : (
              <button
                key={(it as { label: string }).label}
                type="button"
                role="menuitem"
                className="lq-menu-item"
                data-danger={(it as { danger?: boolean }).danger ? '' : undefined}
                aria-disabled={(it as { disabled?: boolean }).disabled || undefined}
                tabIndex={-1}
                data-autofocus={i === 0 ? '' : undefined}
                onClick={() => !(it as { disabled?: boolean }).disabled && select(it as Extract<MenuItem, { label: string }>)}
              >
                {(it as { icon?: ReactNode }).icon && <span className="lq-menu-icon">{(it as { icon?: ReactNode }).icon}</span>}
                <span>{(it as { label: string }).label}</span>
                {(it as { hint?: string }).hint && <kbd>{(it as { hint?: string }).hint}</kbd>}
              </button>
            ),
          )}
        </div>
      </LiquidPanel>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                              */
/* ------------------------------------------------------------------ */

export type TooltipProps = MatterProps & {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Délai d'apparition en ms. */
  delay?: number;
  children: ReactNode;
};

/** Petite goutte qui sort du déclencheur (survol ou focus clavier). Échap la ferme. */
export function Tooltip({ content, side = 'top', delay = 350, children, ...props }: TooltipProps) {
  const { matter } = splitMatter(props);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const id = useId();

  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);

  return (
    <>
      <span
        ref={ref}
        className="lq-tooltip-wrap"
        aria-describedby={open ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      <LiquidPanel
        glue={0.8}
        glow={0.25}
        refraction={0.4}
        thickness={8}
        speed={0.95}
        radius={12}
        {...matter}
        id={id}
        open={open}
        origin={ref}
        side={side}
        appear="ooze"
        passive
        className="lq-tooltip"
      >
        {content}
      </LiquidPanel>
    </>
  );
}

