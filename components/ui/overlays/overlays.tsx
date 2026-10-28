'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion, useThemeVars, useUIContext, type AppearName, type Tint } from '../core/config';
import { APPEARANCES, clamp01, easeInOut, lerp, pickAppear, residuePoint, smoothstep, Spring } from '../core/motion';
import { useFeedback } from '../core/feedback';
import { makeShape, lerpShape, type ShapeState } from '../core/shape';
import { getStage, StageLayer, useStageItem, type Blob, type ItemFrame } from '../core/stage';
import {
  rgbCss,
  resolveOrigin,
  splitMatter,
  useMaterial,
  useShapeStyle,
  Surface,
  type MatterProps,
  type Origin,
} from '../surfaces/surfaces';

const noopSubscribe = () => () => undefined;
/** Vrai côté client après hydratation, faux côté serveur (portails sûrs pour l'hydratation). */
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* ------------------------------------------------------------------ */
/* LiquidPanel : le cycle ouverture / morphing / résidu / fermeture     */
/* ------------------------------------------------------------------ */

export type LiquidPanelProps = MatterProps & {
  id?: string;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  origin?: Origin;
  target?: RefObject<Element | null>;
  appear?: AppearName | AppearName[] | 'random';
  side?: 'top' | 'right' | 'bottom' | 'left';
  placement?: 'anchor' | 'center';
  /** Échap et clic extérieur ferment. */
  dismissible?: boolean;
  /** Voile, focus piégé, le reste de la page est inerte. */
  modal?: boolean;
  role?: string;
  label?: string;
  labelledBy?: string;
  variant?: 'flat' | 'raised' | 'inset';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Gouttes minuscules (tooltip) : pas de voile, pas de piège de focus, pas de capture d'événements. */
  passive?: boolean;
  onExited?: () => void;
};

/**
 * Animation signature : émergence depuis l'origine (blob + cou de matière), transformation réelle de la forme
 * (interpolation de formes, rayons convexes et concaves) jusqu'à la forme du div cible, résidu qui remonte
 * en suivant une trajectoire courbe puis fusionne avec une ondulation. La fermeture suit le chemin inverse
 * (même progression, ressort inversé).
 */
export function LiquidPanel(props: LiquidPanelProps) {
  const {
    id, open, onOpenChange, origin, target, appear, side = 'bottom', placement = 'anchor', dismissible = true,
    modal = false, role = 'dialog', label, labelledBy, variant = 'raised', className, style, children, passive = false, onExited,
  } = props;
  const { matter } = splitMatter(props);
  const m = useMaterial(matter);
  const { config } = useUIContext();
  const reduced = useReducedMotion();
  const client = useIsClient();
  const { vars, mode } = useThemeVars();
  const { haptic, sound } = useFeedback(matter);

  const content = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const shapeStyle = useShapeStyle(content, m.shape, m.radius);

  // Monté pendant l'ouverture et pendant l'animation de fermeture.
  const [exiting, setExiting] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setExiting(true);
  }
  const mounted = open || exiting;

  const sp = useRef(new Spring(0, m.mult, 0.9, 58));
  const appearName = useRef<AppearName>('bloom');
  const lastAppear = useRef<AppearName | null>(null);
  const ripple = useRef<{ t0: number } | null>(null);
  const fired = useRef(false);
  const restore = useRef<Element | null>(null);

  const live = useRef({ m, origin, target, variant, onExited, open, reduced, modal });
  useLayoutEffect(() => {
    live.current = { m, origin, target, variant, onExited, open, reduced, modal };
  });

  // Ouverture et fermeture : tirage de l'apparition, réglage du ressort, retour sensoriel.
  useEffect(() => {
    const s = sp.current;
    if (open) {
      const o = resolveOrigin(origin);
      const name = pickAppear(appear ?? config.motion.appear, !!o, lastAppear.current);
      appearName.current = name;
      lastAppear.current = name;
      const spec = APPEARANCES[name];
      s.tune(m.mult, 0.93 - spec.wobble * 0.12, 58); // raideur douce : ≈ 0,6 s pour s'ouvrir
      ripple.current = null;
      fired.current = false;
      restore.current = document.activeElement;
      if (reduced) s.snap(1);
      else s.target = 1;
      haptic('soft');
      sound(name === 'ooze' ? 'ooze' : 'pop');
    } else {
      s.tune(m.mult, 0.97, 70);
      if (reduced) s.snap(0);
      else s.target = 0;
      sound('merge');
      const r = restore.current;
      if (r instanceof HTMLElement && document.contains(r)) r.focus({ preventScroll: true });
    }
    getStage()?.invalidate();
    // L'apparition ne se retire qu'à l'ouverture : les autres dépendances ne la relancent pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Placement fixe (aucun décalage de scroll : l'élément est en position fixed).
  const place = useCallback(() => {
    const el = content.current;
    if (!el) return;
    const t = target ? resolveOrigin(target) : null;
    if (t) {
      Object.assign(el.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px` });
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const o = resolveOrigin(origin);
    let x = (vw - w) / 2;
    let y = (vh - h) / 2;
    if (placement === 'anchor' && o) {
      const gap = 12;
      let sd = side;
      if (sd === 'bottom' && o.y + o.h + gap + h > vh - 8 && o.y - gap - h > 8) sd = 'top';
      else if (sd === 'top' && o.y - gap - h < 8 && o.y + o.h + gap + h < vh - 8) sd = 'bottom';
      if (sd === 'bottom' || sd === 'top') {
        x = o.x + o.w / 2 - w / 2;
        y = sd === 'bottom' ? o.y + o.h + gap : o.y - h - gap;
      } else {
        y = o.y + o.h / 2 - h / 2;
        x = sd === 'right' ? o.x + o.w + gap : o.x - w - gap;
      }
      x = Math.min(Math.max(8, x), Math.max(8, vw - w - 8));
      y = Math.min(Math.max(8, y), Math.max(8, vh - h - 8));
    }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }, [origin, target, placement, side]);

  useLayoutEffect(() => {
    if (!mounted) return;
    place();
    const on = () => {
      place();
      getStage()?.invalidate();
    };
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, { passive: true, capture: true });
    const ro = content.current ? new ResizeObserver(on) : null;
    if (content.current) ro?.observe(content.current);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, { capture: true });
      ro?.disconnect();
    };
  }, [mounted, place]);

  // Focus, Échap, clic extérieur, piège de focus.
  useEffect(() => {
    if (!open || passive) return;
    const el = content.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus({ preventScroll: true });
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onOpenChange?.(false);
      } else if (e.key === 'Tab' && modal) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === el)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    const down = (e: PointerEvent) => {
      if (!dismissible || modal) return;
      const n = e.target as Node;
      if (el.contains(n)) return;
      const og = origin && 'current' in origin ? origin.current : null;
      if (og && og.contains(n)) return; // le déclencheur gère lui-même sa bascule
      onOpenChange?.(false);
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [open, passive, dismissible, modal, onOpenChange, origin]);

  // Page inerte derrière une modale.
  useEffect(() => {
    if (!open || !modal) return;
    const roots = [...document.body.children].filter((c) => !c.classList.contains('lq-portal') && !c.classList.contains('lq-canvas')) as HTMLElement[];
    roots.forEach((r) => r.setAttribute('inert', ''));
    return () => roots.forEach((r) => r.removeAttribute('inert'));
  }, [open, modal]);

  useStageItem({
    layer: 'top',
    z: 10,
    frame: (now, dt) => {
      const el = content.current;
      const L = live.current;
      if (!el) return null;
      const s = sp.current;
      s.step(dt);
      const p = s.x;
      if (s.settled && s.target === 0 && !L.open) {
        el.style.visibility = 'hidden';
        setExiting(false);
        L.onExited?.();
        return null;
      }
      const R = el.getBoundingClientRect();
      if (R.width < 1 || R.height < 1) return null;
      const spec = APPEARANCES[appearName.current];
      const tShape: ShapeState = makeShape(L.m.shape, R.width, R.height, L.m.radius);
      const tcx = R.left + R.width / 2;
      const tcy = R.top + R.height / 2;
      const o = resolveOrigin(L.origin);
      const useOrigin = spec.from === 'origin' && !!o;
      const oc = o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : null;
      const ro = o ? Math.max(9, Math.min(o.w, o.h) / 2) : 14;
      const q = clamp01(p);

      // Forme de départ : exactement celle du déclencheur (le bouton « se lève »), ou un volume replié.
      let start: ShapeState;
      let c0 = { x: tcx, y: tcy };
      if (useOrigin && o && oc) {
        start = makeShape('rect', Math.max(o.w, 18), Math.max(o.h, 18), Math.min(o.w, o.h) / 2);
        c0 = oc;
      } else {
        const w0 = Math.max(R.width * spec.scale[0], 2);
        const h0 = Math.max(R.height * spec.scale[1], 2);
        if (spec.from === 'top') c0 = { x: tcx, y: R.top + h0 / 2 };
        else if (spec.from === 'bottom') c0 = { x: tcx, y: R.bottom - h0 / 2 };
        const r0 = spec.startRadius * (Math.min(w0, h0) / 2);
        start = { w: w0, h: h0, r: [r0, r0, r0, r0], ell: 1 - spec.rect, path: 0, pathKey: null, pathData: null };
      }
      // Trois courbes distinctes : la taille croît en douceur, la position part vite puis se pose, la forme se redresse en dernier.
      const eSize = easeInOut(clamp01((q - 0.03) / 0.92));
      const ePos = 1 - Math.pow(1 - clamp01(q / 0.88), 3);
      const shape = lerpShape(start, tShape, eSize);
      const over = Math.max(0, p - 1);
      const kOver = 1 + over * 0.35 * spec.wobble;
      const w = Math.max(shape.w * kOver, 2);
      const h = Math.max(shape.h * (1 + spec.drip * 0.22 * Math.sin(Math.PI * q) + (kOver - 1)), 2);
      const cx = lerp(c0.x, tcx, ePos);
      const cy = lerp(c0.y, tcy, ePos);
      shape.w = w;
      shape.h = h;
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };

      const blobs: Blob[] = [];
      let smooth = 10 + L.m.mat.glue * 6;
      const src = oc ?? c0;
      if (!L.reduced) {
        // Filament visqueux : un fil fin entre le déclencheur et le corps, épais aux deux bouts, qui s'amincit puis se rétracte.
        const thread = spec.neck * smoothstep(0.02, 0.16, q) * (1 - smoothstep(0.5, 0.86, q));
        if (thread > 0.02) {
          const dx = src.x - cx;
          const dy = src.y - cy;
          const tEdge = Math.min(dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity, dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity);
          const ax = cx + dx * Math.min(1, tEdge);
          const ay = cy + dy * Math.min(1, tEdge);
          const len = Math.hypot(src.x - ax, src.y - ay);
          if (len > 6) {
            const n = Math.min(6, Math.max(3, Math.round(len / 12)));
            for (let i = 0; i < n; i++) {
              const u = i / (n - 1);
              const flare = Math.pow(1 - Math.sin(Math.PI * u), 2);
              const r = thread * (1.6 + (ro * 0.4 - 1.6) * flare);
              if (r > 0.6) blobs.push({ x: lerp(src.x, ax, u), y: lerp(src.y, ay, u), r });
            }
            smooth = 8 + L.m.mat.glue * 4;
          }
        }
        // Résidu : une petite goutte reste au déclencheur, remonte par une trajectoire courbe et fusionne avec le corps.
        if (spec.residue > 0) {
          const qr = easeInOut(clamp01((q - 0.42) / 0.5));
          const nx = Math.min(Math.max(src.x, R.left + 16), R.right - 16);
          const ny = Math.min(Math.max(src.y, R.top + 16), R.bottom - 16);
          const entry = { x: lerp(nx, tcx, 0.3), y: lerp(ny, tcy, 0.3) };
          const pt = residuePoint(src, entry, qr, (src.x < tcx ? 1 : -1) * 0.3);
          const rr = ro * 0.34 * spec.residue * smoothstep(0.34, 0.5, q) * (1 - 0.4 * qr) * (1 - smoothstep(0.9, 1, qr));
          if (rr > 0.6 && blobs.length < 7) blobs.push({ x: pt.x, y: pt.y, r: rr });
        }
        if (spec.drip > 0 && blobs.length < 8) {
          const sw = Math.sin(Math.PI * q);
          blobs.push({ x: cx, y: box.y + box.h + 3 + 14 * sw * spec.drip, r: (4 + 7 * sw * spec.drip) * smoothstep(0, 0.12, q) });
        }
      }

      // Ondulation de surface à l'arrivée (fine) : déclenchée quand la matière a fusionné avec le corps.
      let rip: ItemFrame['ripple'];
      const trigger = appearName.current === 'ripple' ? 0.25 : 0.95;
      if (!L.reduced && L.open && !fired.current && p >= trigger) {
        fired.current = true;
        ripple.current = { t0: now };
      }
      let busy = !s.settled;
      if (ripple.current) {
        const age = (now - ripple.current.t0) / 1000;
        if (age < 1.5) {
          rip = { x: tcx, y: tcy, t: age, amp: spec.ripple * 0.55 };
          busy = true;
        }
      }

      // Contenu DOM : apparaît quand la forme est presque formée.
      const vis = smoothstep(0.82, 0.98, p);
      el.style.opacity = String(vis);
      el.style.visibility = p < 0.03 ? 'hidden' : 'visible';
      el.style.pointerEvents = L.open && vis > 0.6 && !passive ? 'auto' : 'none';
      if (scrim.current) scrim.current.style.opacity = String(smoothstep(0, 0.7, p));

      return {
        box,
        shape,
        mat: L.m.mat,
        colors: L.m.colors,
        blobs,
        smooth,
        ripple: rip,
        alpha: smoothstep(0, useOrigin ? 0.03 : 0.1, p),
        variant: L.variant === 'flat' ? 0 : L.variant === 'inset' ? 2 : 1,
        busy,
      };
    },
  });

  if (!client || !mounted) return null;
  return createPortal(
    <div className="lq-portal" data-mode={mode} style={vars}>
      {modal && <div ref={scrim} className="lq-scrim" aria-hidden="true" onClick={dismissible ? () => onOpenChange?.(false) : undefined} />}
      <div
        ref={content}
        id={id}
        className={`lq-panel${className ? ` ${className}` : ''}`}
        role={passive ? 'tooltip' : role}
        aria-modal={modal && !passive ? true : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
        data-matter=""
        tabIndex={passive ? undefined : -1}
        style={
          {
            '--lq-tint-glass': rgbCss(m.colors.glass),
            '--lq-tint-glue': rgbCss(m.colors.glue),
            '--lq-tint-glow': rgbCss(m.colors.glow),
            '--lq-glow-k': m.mat.glow,
            '--lq-frost-px': `${Math.round(6 + m.mat.frost * 18)}px`,
            visibility: 'hidden',
            ...shapeStyle,
            ...style,
          } as CSSProperties
        }
      >
        <StageLayer layer="top" z={10}>
          {children}
        </StageLayer>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Popup                                                                */
/* ------------------------------------------------------------------ */

export type PopupProps = Omit<LiquidPanelProps, 'open' | 'onOpenChange' | 'modal' | 'passive' | 'role'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Contrôlé ou non : `open` + `onOpenChange`, ou `defaultOpen`. */
export function useOpenState(open: boolean | undefined, defaultOpen: boolean | undefined, onOpenChange?: (o: boolean) => void) {
  const [inner, setInner] = useState(defaultOpen ?? false);
  const value = open ?? inner;
  const set = useCallback(
    (o: boolean) => {
      if (open === undefined) setInner(o);
      onOpenChange?.(o);
    },
    [open, onOpenChange],
  );
  return [value, set] as const;
}

/** Contenu flottant qui sort d'un `origin` avec l'animation signature. */
export function Popup({ open, defaultOpen, onOpenChange, children, ...rest }: PopupProps) {
  const [o, setO] = useOpenState(open, defaultOpen, onOpenChange);
  return (
    <LiquidPanel {...rest} open={o} onOpenChange={setO} role="dialog">
      {children}
    </LiquidPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Alert                                                                */
/* ------------------------------------------------------------------ */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';
export type AlertAction = { label: string; onClick?: () => void | false; tone?: 'default' | 'primary' | 'danger'; autoFocus?: boolean };

const TONE_COLOR: Record<Exclude<AlertTone, 'info'>, string> = { success: '#34d399', warning: '#fbbf24', danger: '#fb7185' };

const toneTint = (tone: AlertTone): Tint | undefined => (tone === 'info' ? undefined : { glow: TONE_COLOR[tone], glue: TONE_COLOR[tone] });

function ToneIcon({ tone }: { tone: AlertTone }) {
  const c = tone === 'info' ? 'var(--lq-glow)' : TONE_COLOR[tone];
  return (
    <svg className="lq-tone-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tone === 'success' && <path d="M5 12.5l4.5 4.5L19 7.5" />}
      {tone === 'warning' && <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.2v.1" /></>}
      {tone === 'danger' && <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>}
      {tone === 'info' && <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.1" /></>}
    </svg>
  );
}

export type AlertProps = Omit<LiquidPanelProps, 'open' | 'onOpenChange' | 'modal' | 'passive' | 'role' | 'placement' | 'side' | 'label' | 'target'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: AlertTone;
  title?: string;
  actions?: AlertAction[];
};

/** Dialogue modal de confirmation ou d'erreur : focus piégé, Échap, rôle `alertdialog`. */
export function Alert({ open, defaultOpen, onOpenChange, tone = 'info', title, actions, children, tint, dismissible = true, ...rest }: AlertProps) {
  const [o, setO] = useOpenState(open, defaultOpen, onOpenChange);
  const { haptic, sound } = useFeedback(rest);
  const id = useId();
  const list = actions ?? [{ label: 'OK', tone: 'primary' as const }];
  const focusIdx = Math.max(0, list.findIndex((a) => a.autoFocus));

  const prevOpen = useRef(o);
  useEffect(() => {
    if (o && !prevOpen.current) {
      haptic(tone === 'danger' || tone === 'warning' ? 'warn' : 'confirm');
      sound(tone === 'danger' || tone === 'warning' ? 'soft-alert' : 'confirm');
    }
    prevOpen.current = o;
  }, [o, tone, haptic, sound]);

  return (
    <LiquidPanel
      {...rest}
      open={o}
      onOpenChange={setO}
      modal
      dismissible={dismissible}
      role="alertdialog"
      labelledBy={title ? `${id}-t` : undefined}
      placement="center"
      tint={tint ?? toneTint(tone)}
      className="lq-alert"
      appear={rest.appear ?? (rest.origin ? undefined : ['bloom', 'unfold', 'ripple'])}
    >
      <div className="lq-alert-head">
        <ToneIcon tone={tone} />
        {title && (
          <h2 id={`${id}-t`} className="lq-alert-title">
            {title}
          </h2>
        )}
      </div>
      {children && <div className="lq-alert-body">{children}</div>}
      <div className="lq-alert-actions">
        {list.map((a, i) => (
          <Surface
            key={a.label}
            as="button"
            type="button"
            variant={a.tone === 'primary' ? 'raised' : 'flat'}
            glue={0.7}
            glow={a.tone === 'primary' ? 0.55 : a.tone === 'danger' ? 0.4 : 0.1}
            tint={a.tone === 'danger' ? { glue: TONE_COLOR.danger, glow: TONE_COLOR.danger } : undefined}
            radius={999}
            className="lq-btn"
            data-tone={a.tone ?? 'default'}
            data-autofocus={i === focusIdx ? '' : undefined}
            onClick={() => {
              if (a.onClick?.() !== false) setO(false);
            }}
          >
            <span className="lq-btn-label">{a.label}</span>
          </Surface>
        ))}
      </div>
    </LiquidPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                                */
/* ------------------------------------------------------------------ */

export type ToastOptions = { title: string; description?: string; tone?: AlertTone; duration?: number; side?: 'top' | 'bottom' };
type ToastItem = ToastOptions & { id: number };

let toastItems: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());
const toastSubscribe = (l: () => void) => {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
};
const toastSnapshot = () => toastItems;
const toastServer: ToastItem[] = [];

function pushToast(o: ToastOptions) {
  const id = ++toastSeq;
  toastItems = [...toastItems, { ...o, id }].slice(-5);
  emitToasts();
  return id;
}
function dropToast(id: number) {
  toastItems = toastItems.filter((t) => t.id !== id);
  emitToasts();
}

function ToastView({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const m = useMaterial({ glue: 0.9, glow: 0.35, radius: 22 });
  const reduced = useReducedMotion();
  const { haptic, sound } = useFeedback();
  const sp = useRef(new Spring(0, m.mult, 0.5));
  const closing = useRef(false);
  const hover = useRef(false);
  const timer = useRef<number | null>(null);
  const tint = toneTint(item.tone ?? 'info');
  const tm = useMaterial({ tint });
  const side = item.side ?? 'top';

  const close = useCallback(() => {
    closing.current = true;
    sp.current.target = 0;
    if (reduced) sp.current.snap(0);
    getStage()?.invalidate();
  }, [reduced]);

  useEffect(() => {
    sp.current.tune(m.mult, 0.5);
    if (reduced) sp.current.snap(1);
    else sp.current.target = 1;
    haptic(item.tone === 'danger' || item.tone === 'warning' ? 'warn' : 'soft');
    sound(item.tone === 'danger' || item.tone === 'warning' ? 'soft-alert' : item.tone === 'success' ? 'confirm' : 'pop');
    getStage()?.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dur = item.duration ?? 4200;
    if (dur <= 0) return;
    const arm = () => {
      timer.current = window.setTimeout(() => (hover.current ? arm() : close()), dur);
    };
    arm();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [item.duration, close]);

  useStageItem({
    layer: 'top',
    z: 20,
    frame: (_now, dt) => {
      const el = ref.current;
      if (!el) return null;
      const s = sp.current;
      s.step(dt);
      if (closing.current && s.settled) {
        onDone();
        return null;
      }
      const p = s.x;
      const dir = side === 'top' ? -1 : 1;
      el.style.transform = `translateY(${(1 - Math.min(p, 1.05)) * dir * 46}px)`;
      el.style.opacity = String(smoothstep(0.35, 0.8, p));
      const R = el.getBoundingClientRect();
      if (R.width < 1) return null;
      const edgeY = side === 'top' ? 0 : window.innerHeight;
      const sw = 1 - Math.min(p, 1);
      const blobs: Blob[] = [];
      // Goutte qui sort du bord : un disque sur le bord, relié au toast par un cou de matière.
      if (!reduced && sw > 0.01) blobs.push({ x: R.left + R.width / 2, y: edgeY + dir * -2, r: 16 * (0.4 + sw) });
      return {
        box: { x: R.left, y: R.top, w: R.width, h: R.height },
        shape: makeShape('rect', R.width, R.height, 22),
        mat: tm.mat,
        colors: tm.colors,
        blobs,
        smooth: 30 + 20 * sw,
        alpha: smoothstep(0, 0.2, p),
        busy: !s.settled,
        variant: 1,
      };
    },
  });

  return (
    <div
      ref={ref}
      className="lq-toast"
      data-matter=""
      data-tone={item.tone ?? 'info'}
      role={item.tone === 'danger' ? 'alert' : 'status'}
      onPointerEnter={() => (hover.current = true)}
      onPointerLeave={() => (hover.current = false)}
      style={{ '--lq-tint-glass': rgbCss(tm.colors.glass), '--lq-glow-k': tm.mat.glow } as CSSProperties}
    >
      <ToneIcon tone={item.tone ?? 'info'} />
      <div className="lq-toast-text">
        <strong>{item.title}</strong>
        {item.description && <span>{item.description}</span>}
      </div>
      <button type="button" className="lq-toast-x" aria-label="Fermer la notification" onClick={close}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

function ToastHost() {
  const items = useSyncExternalStore(toastSubscribe, toastSnapshot, () => toastServer);
  const client = useIsClient();
  const { vars, mode } = useThemeVars();
  if (!client) return null;
  const sides: ('top' | 'bottom')[] = ['top', 'bottom'];
  return createPortal(
    <div className="lq-portal" data-mode={mode} style={vars}>
      {sides.map((sd) => {
        const list = items.filter((t) => (t.side ?? 'top') === sd);
        return (
          list.length > 0 && (
            <div key={sd} className="lq-toasts" data-side={sd} aria-live="polite">
              {list.map((t) => (
                <ToastView key={t.id} item={t} onDone={() => dropToast(t.id)} />
              ))}
            </div>
          )
        );
      })}
    </div>,
    document.body,
  );
}

/** API impérative : `const toast = useToast(); toast({ title, tone, duration })`. L'hôte se monte tout seul. */
export function useToast() {
  const { registerHost } = useUIContext();
  useEffect(() => registerHost('toast', <ToastHost />), [registerHost]);
  return useCallback(
    (o: ToastOptions | string) => {
      const id = pushToast(typeof o === 'string' ? { title: o } : o);
      return () => dropToast(id);
    },
    [],
  );
}

/* ------------------------------------------------------------------ */
/* Loader                                                               */
/* ------------------------------------------------------------------ */

export type LoaderProps = MatterProps & {
  kind?: 'blob' | 'bar';
  /** 0–1 ; absent = indéterminé. */
  progress?: number;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
  style?: CSSProperties;
};

const LOADER_SIZE = { sm: 36, md: 56, lg: 84 } as const;

/** Chargement liquide : blob ou barre, fusion et séparation continues. */
export function Loader({ kind = 'blob', progress, size = 'md', label = 'Chargement', className, style, ...props }: LoaderProps) {
  const { matter } = splitMatter(props);
  const m = useMaterial({ glue: 0.9, glow: 0.4, ...matter });
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const prog = useRef(new Spring(progress ?? 0, m.mult, 0.55));
  const live = useRef({ m, kind, progress, reduced });
  useLayoutEffect(() => {
    live.current = { m, kind, progress, reduced };
    prog.current.tune(m.mult, 0.55);
    if (progress !== undefined) prog.current.target = clamp01(progress);
    getStage()?.invalidate();
  });

  useStageItem({
    ref,
    z: 1,
    frame: (now, dt) => {
      const el = ref.current;
      if (!el) return null;
      const L = live.current;
      const R = el.getBoundingClientRect();
      if (R.width < 1 || R.height < 1) return null;
      const t = now / 1000;
      const det = L.progress !== undefined;
      const pr = prog.current;
      pr.step(dt);
      const anim = !L.reduced;
      const blobs: Blob[] = [];
      const cx = R.left + R.width / 2;
      const cy = R.top + R.height / 2;
      let shape: ShapeState;
      let box: { x: number; y: number; w: number; h: number };
      let smooth: number;
      if (L.kind === 'bar') {
        // Remplissage : barre qui s'étire jusqu'à une goutte de tête (cou de matière) ; la piste est une Surface creuse.
        const h = R.height;
        const fh = h - 4;
        const x0 = R.left + 2;
        const span = R.width - 4;
        smooth = fh * 1.1;
        if (det) {
          const f = clamp01(pr.x);
          const w = Math.max(fh, span * f);
          box = { x: x0, y: R.top + 2, w, h: fh };
          shape = makeShape('rect', w, fh, 999);
          if (f > 0.02 && f < 0.995) blobs.push({ x: x0 + w - fh * 0.5, y: cy, r: fh * 0.62 * (1 + 0.1 * Math.sin(t * 6) * (anim ? 1 : 0)) });
        } else {
          const w = Math.max(fh, span * 0.22);
          const a = anim ? (t * 0.7) % 1.25 - 0.2 : 0.3;
          const hx = x0 + Math.min(Math.max(a, 0), 1) * (span - w);
          box = { x: hx, y: R.top + 2, w, h: fh };
          shape = makeShape('rect', w, fh, 999);
          blobs.push({ x: hx + w, y: cy, r: fh * 0.62 });
        }
        return { box, shape, mat: { ...L.m.mat, thickness: Math.max(5, fh * 0.55), glow: Math.max(L.m.mat.glow, 0.3) }, colors: L.m.colors, blobs, smooth, variant: 1, busy: anim && !det ? true : !pr.settled } as ItemFrame;
      }
      // Blob : un noyau et des satellites qui orbitent, fusionnent et se détachent.
      const base = Math.min(R.width, R.height) / 2;
      const core = base * (det ? 0.28 + 0.34 * clamp01(pr.x) : 0.42);
      shape = makeShape('ellipse', core * 2, core * 2 * (anim ? 1 + 0.06 * Math.sin(t * 3.1) : 1), 0);
      box = { x: cx - shape.w / 2, y: cy - shape.h / 2, w: shape.w, h: shape.h };
      smooth = base * 0.8;
      const sat = det ? Math.max(0, 1 - clamp01(pr.x)) : 1;
      const count = 3;
      for (let i = 0; i < count; i++) {
        const ph = (i / count) * Math.PI * 2;
        const orb = anim ? t * (1.1 + i * 0.27) + ph : ph;
        const dist = base * (0.52 + 0.3 * (anim ? Math.sin(t * 1.3 + i * 2.1) : 0.4)) * (0.35 + 0.65 * sat);
        blobs.push({ x: cx + Math.cos(orb) * dist, y: cy + Math.sin(orb * 0.9) * dist, r: base * (0.2 + 0.07 * i) * (0.5 + 0.5 * sat) });
      }
      return { box, shape, mat: L.m.mat, colors: L.m.colors, blobs, smooth, variant: 1, busy: anim && !det ? true : anim || !pr.settled };
    },
  });

  const px = LOADER_SIZE[size];
  const dims: CSSProperties = kind === 'bar' ? { width: px * 3.2, height: Math.max(14, px * 0.3), maxWidth: '100%' } : { width: px, height: px };
  const pct = progress === undefined ? undefined : Math.round(clamp01(progress) * 100);
  return (
    <div
      ref={ref}
      className={`lq-loader${className ? ` ${className}` : ''}`}
      data-kind={kind}
      role="progressbar"
      aria-label={label}
      aria-busy={progress === undefined || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      data-determinate={progress !== undefined ? '' : undefined}
      style={{ ...dims, '--lq-progress': `${pct ?? 0}%`, ...style } as CSSProperties}
    >
      {kind === 'bar' && <Surface variant="inset" radius={999} glue={0.2} glow={0} reactive={0} className="lq-loader-track" haptics={false} audioUi={false} />}
    </div>
  );
}
