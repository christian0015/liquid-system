'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion, useThemeVars } from '../core/config';
import { clamp01, lerp, smoothstep, Spring } from '../core/motion';
import { useFeedback } from '../core/feedback';
import { makeShape, type Radii } from '../core/shape';
import { getStage, StageLayer, useStageItem, type Blob } from '../core/stage';
import { rgbCss, splitMatter, useMaterial, useShapeStyle, type MatterProps } from '../surfaces/surfaces';

/* ------------------------------------------------------------------ */
/* Magasin : ouverture par action (`useDrawer`)                         */
/* ------------------------------------------------------------------ */

type DrawerState = { open: boolean; snapIndex: number };
const stores = new Map<string, DrawerState>();
const listeners = new Map<string, Set<() => void>>();
const DEFAULT_STATE: DrawerState = { open: false, snapIndex: 0 };

const getState = (id: string) => stores.get(id) ?? DEFAULT_STATE;
function setState(id: string, patch: Partial<DrawerState>) {
  stores.set(id, { ...getState(id), ...patch });
  listeners.get(id)?.forEach((l) => l());
}
function subscribe(id: string, l: () => void) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)?.add(l);
  return () => listeners.get(id)?.delete(l);
}

/** Ouvre un `<Drawer>` par une action : `const drawer = useDrawer(); drawer.open({ snapIndex: 0 })`. */
export function useDrawer(id = 'default') {
  const sub = useCallback((l: () => void) => subscribe(id, l), [id]);
  const state = useSyncExternalStore(sub, () => getState(id), () => DEFAULT_STATE);
  return useMemo(
    () => ({
      isOpen: state.open,
      snapIndex: state.snapIndex,
      open: (o?: { snapIndex?: number }) => setState(id, { open: true, snapIndex: o?.snapIndex ?? 0 }),
      close: () => setState(id, { open: false }),
      toggle: () => setState(id, { open: !getState(id).open }),
      snapTo: (i: number) => setState(id, { snapIndex: i }),
    }),
    [id, state.open, state.snapIndex],
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                               */
/* ------------------------------------------------------------------ */

export type DrawerProps = MatterProps & {
  id?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Paliers en % de l'axe de tirage (hauteur pour top/bottom, largeur pour left/right). */
  snap?: number[];
  snapIndex?: number;
  defaultSnapIndex?: number;
  onSnapChange?: (index: number) => void;
  dismissible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

const noop = () => () => undefined;
const sideRadius = (side: string): Radii =>
  side === 'bottom' ? [30, 30, 0, 0] : side === 'top' ? [0, 0, 30, 30] : side === 'right' ? [30, 0, 0, 30] : [0, 30, 30, 0];

/**
 * Tiroir à tirer : poignée, paliers (`snap`), élan, élasticité aux limites. Le contenu défile quand le tiroir
 * est au dernier palier ; avant, tout tire le tiroir. À la fermeture, la matière se détache de la poignée puis se résorbe.
 */
export function Drawer(props: DrawerProps) {
  const {
    id = 'default', side = 'bottom', snap = [35, 70, 95], snapIndex: snapControlled, defaultSnapIndex, onSnapChange,
    dismissible = true, open: openControlled, defaultOpen, onOpenChange, label = 'Panneau', className, style, children,
  } = props;
  const { matter } = splitMatter(props);
  const client = useSyncExternalStore(noop, () => true, () => false);
  const { vars, mode } = useThemeVars();
  const reduced = useReducedMotion();
  const { haptic, sound } = useFeedback(matter);
  const m = useMaterial({ glue: 0.85, glow: 0.35, ...matter, radius: matter.radius ?? sideRadius(side) });
  const horizontal = side === 'left' || side === 'right';
  const sign = side === 'bottom' || side === 'right' ? -1 : 1; // sens du tirage selon le côté

  // État : prop contrôlée > magasin (useDrawer) > défaut.
  const store = useSyncExternalStore(
    useCallback((l: () => void) => subscribe(id, l), [id]),
    () => getState(id),
    () => DEFAULT_STATE,
  );
  const [localOpen, setLocalOpen] = useState(defaultOpen ?? false);
  const [localSnap, setLocalSnap] = useState(defaultSnapIndex ?? 0);
  const storeUsed = stores.has(id);
  const open = openControlled ?? (storeUsed ? store.open : localOpen);
  const snapIdx = Math.min(snapControlled ?? (storeUsed ? store.snapIndex : localSnap), snap.length - 1);

  const setOpen = useCallback(
    (o: boolean) => {
      if (openControlled === undefined) {
        setLocalOpen(o);
        if (stores.has(id)) setState(id, { open: o });
      }
      onOpenChange?.(o);
    },
    [openControlled, id, onOpenChange],
  );
  const setSnapIdx = useCallback(
    (i: number) => {
      if (snapControlled === undefined) {
        setLocalSnap(i);
        if (stores.has(id)) setState(id, { snapIndex: i });
      }
      onSnapChange?.(i);
    },
    [snapControlled, id, onSnapChange],
  );

  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const shapeStyle = useShapeStyle(panel, 'rect', m.radius);

  const [exiting, setExiting] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setExiting(true);
  }
  const mounted = open || exiting;

  const pos = useRef(new Spring(0, m.mult, 0.72));
  const drag = useRef({ active: false, start: 0, startPos: 0, lastC: 0, lastT: 0, v: 0, grab: 0 });
  const bead = useRef<{ x: number; y: number; t0: number } | null>(null);
  const restore = useRef<Element | null>(null);
  const [atMax, setAtMax] = useState(snapIdx >= snap.length - 1);
  const lastSnap = useRef(snapIdx);

  const axisSize = () => (horizontal ? window.innerWidth : window.innerHeight);
  const extents = useCallback(() => snap.map((s) => (clamp01(s / 100) * axisSize())), [snap, horizontal]);
  const maxExtent = () => Math.max(...extents());

  const live = useRef({ m, open, side, snapIdx, reduced });
  useLayoutEffect(() => {
    live.current = { m, open, side, snapIdx, reduced };
  });

  // Ouverture, fermeture et changement de palier pilotent la cible du ressort.
  useEffect(() => {
    const s = pos.current;
    s.tune(m.mult, 0.72);
    if (open) {
      const ext = extents();
      const target = ext[Math.min(snapIdx, ext.length - 1)] ?? 0;
      if (!drag.current.active) {
        if (reduced) s.snap(target);
        else s.target = target;
      }
      if (lastSnap.current !== snapIdx) {
        haptic('tick');
        sound('snap');
        lastSnap.current = snapIdx;
      }
      setAtMax(snapIdx >= snap.length - 1);
    } else {
      const R = panel.current?.getBoundingClientRect();
      if (R && !reduced) {
        // La matière se détache de la poignée : une goutte reste, puis se résorbe.
        bead.current = horizontal
          ? { x: side === 'right' ? R.left : R.right, y: R.top + R.height / 2, t0: performance.now() }
          : { x: R.left + R.width / 2, y: side === 'bottom' ? R.top : R.bottom, t0: performance.now() };
      }
      if (reduced) s.snap(0);
      else s.target = 0;
      const r = restore.current;
      if (r instanceof HTMLElement && document.contains(r)) r.focus({ preventScroll: true });
    }
    getStage()?.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapIdx, m.mult]);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement;
    haptic('soft');
    sound('ooze');
    const raf = requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Les paliers suivent la taille de la fenêtre.
  useEffect(() => {
    if (!open) return;
    const on = () => {
      if (!drag.current.active) pos.current.snap(extents()[snapIdx] ?? 0);
      getStage()?.invalidate();
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [open, extents, snapIdx]);

  /* ----- Gestes ----- */

  const coord = (e: { clientX: number; clientY: number }) => (horizontal ? e.clientX : e.clientY);

  const beginDrag = useCallback((c: number, now: number) => {
    const d = drag.current;
    d.active = true;
    d.start = c;
    d.startPos = pos.current.x;
    d.lastC = c;
    d.lastT = now;
    d.v = 0;
    pos.current.v = 0;
    getStage()?.invalidate();
  }, []);

  const moveDrag = useCallback(
    (c: number, now: number) => {
      const d = drag.current;
      if (!d.active) return;
      const ext = extents();
      const top = Math.max(...ext);
      const first = Math.min(...ext);
      let raw = d.startPos + sign * (c - d.start);
      // Élasticité aux limites : résistance au-delà du dernier palier, et sous le premier si non fermable.
      if (raw > top) raw = top + (raw - top) * 0.32;
      if (!dismissible && raw < first) raw = first - (first - raw) * 0.32;
      if (raw < 0) raw = raw * 0.2;
      const dt = Math.max(1, now - d.lastT) / 1000;
      d.v = lerp(d.v, (sign * (c - d.lastC)) / dt, 0.4);
      d.lastC = c;
      d.lastT = now;
      pos.current.x = raw;
      pos.current.target = raw;
      getStage()?.invalidate();
    },
    [extents, sign, dismissible],
  );

  const endDrag = useCallback(() => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const ext = extents();
    const projected = pos.current.x + d.v * 0.2; // élan : la vitesse de relâchement projette la position
    const first = ext[0];
    let idx = 0;
    let best = Infinity;
    ext.forEach((e, i) => {
      const dist = Math.abs(projected - e);
      if (dist < best) {
        best = dist;
        idx = i;
      }
    });
    pos.current.v = d.v;
    if (dismissible && projected < first * 0.55) {
      setOpen(false);
    } else {
      pos.current.target = ext[idx];
      if (idx !== lastSnap.current) setSnapIdx(idx);
      else {
        haptic('tick');
        getStage()?.invalidate();
      }
      setAtMax(idx >= ext.length - 1);
    }
  }, [extents, dismissible, setOpen, setSnapIdx, haptic]);

  const onGrabDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    beginDrag(coord(e), e.timeStamp);
  };
  const onGrabMove = (e: ReactPointerEvent) => moveDrag(coord(e), e.timeStamp);
  const onGrabUp = () => endDrag();

  // Contenu : tire le tiroir tant qu'il n'est pas au dernier palier ; au dernier palier, il défile,
  // et un tirage vers la fermeture depuis le haut du contenu reprend la main sur le défilement.
  useEffect(() => {
    const el = body.current;
    if (!el || !open) return;
    let claimed = false;
    let c0 = 0;
    const startTouch = (e: TouchEvent) => {
      c0 = horizontal ? e.touches[0].clientX : e.touches[0].clientY;
      claimed = false;
    };
    const moveTouch = (e: TouchEvent) => {
      const c = horizontal ? e.touches[0].clientX : e.touches[0].clientY;
      const delta = sign * (c - c0);
      const scrolled = horizontal ? el.scrollLeft : el.scrollTop;
      if (!claimed && !drag.current.active) {
        const atTop = scrolled <= 0;
        const towardLess = delta < -6;
        const towardMore = delta > 6;
        if ((!live.current.snapIdx || live.current.snapIdx < snap.length - 1) && (towardMore || (towardLess && atTop))) claimed = true;
        else if (live.current.snapIdx >= snap.length - 1 && atTop && towardLess) claimed = true;
        if (claimed) beginDrag(c, e.timeStamp);
      }
      if (claimed) {
        e.preventDefault();
        moveDrag(c, e.timeStamp);
      }
    };
    const endTouch = () => {
      if (claimed) endDrag();
      claimed = false;
    };
    el.addEventListener('touchstart', startTouch, { passive: true });
    el.addEventListener('touchmove', moveTouch, { passive: false });
    el.addEventListener('touchend', endTouch, { passive: true });
    el.addEventListener('touchcancel', endTouch, { passive: true });
    return () => {
      el.removeEventListener('touchstart', startTouch);
      el.removeEventListener('touchmove', moveTouch);
      el.removeEventListener('touchend', endTouch);
      el.removeEventListener('touchcancel', endTouch);
    };
  }, [open, horizontal, sign, snap.length, beginDrag, moveDrag, endDrag]);

  const onGrabKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      const grow = (side === 'bottom' && e.key === 'ArrowUp') || (side === 'top' && e.key === 'ArrowDown') || (side === 'right' && e.key === 'ArrowLeft') || (side === 'left' && e.key === 'ArrowRight');
      e.preventDefault();
      if (grow) setSnapIdx(Math.min(snap.length - 1, snapIdx + 1));
      else if (snapIdx > 0) setSnapIdx(snapIdx - 1);
      else if (dismissible) setOpen(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSnapIdx((snapIdx + 1) % snap.length);
    }
  };

  /* ----- Dessin ----- */

  useStageItem({
    layer: 'top',
    z: 30,
    frame: (now, dt) => {
      const el = panel.current;
      const L = live.current;
      if (!el) return null;
      const s = pos.current;
      if (!drag.current.active) s.step(dt);
      const p = s.x;
      if (!L.open && s.settled && p <= 0.5) {
        const b = bead.current;
        if (!b || now - b.t0 > 650) {
          el.style.visibility = 'hidden';
          setExiting(false);
          if (scrim.current) scrim.current.style.opacity = '0';
          return null;
        }
      }
      const maxE = maxExtent();
      const total = maxE + 90; // zone d'élasticité hors écran
      // Position du panneau : la partie visible vaut `p` le long de l'axe.
      const shift = total - p;
      let tf: string;
      if (side === 'bottom') tf = `translate3d(0, ${shift}px, 0)`;
      else if (side === 'top') tf = `translate3d(0, ${-shift}px, 0)`;
      else if (side === 'right') tf = `translate3d(${shift}px, 0, 0)`;
      else tf = `translate3d(${-shift}px, 0, 0)`;
      el.style.transform = tf;
      el.style.visibility = 'visible';
      el.style[horizontal ? 'width' : 'height'] = `${total}px`;
      if (scrim.current) scrim.current.style.opacity = String(smoothstep(0, Math.max(1, extents()[0]), p) * 0.9);

      const R = el.getBoundingClientRect();
      const blobs: Blob[] = [];
      let smooth = 14 + L.m.mat.glue * 16;
      if (!L.reduced) {
        // Ménisque : le bord se tend vers le doigt pendant le tirage (tension selon la vitesse).
        const d = drag.current;
        const tension = d.active ? clamp01(Math.abs(d.v) / 1800) : clamp01(Math.abs(s.v) / 1800);
        if (d.active || tension > 0.02) {
          const grabC = horizontal ? R.top + R.height / 2 : R.left + R.width / 2;
          const edge = side === 'bottom' ? R.top : side === 'top' ? R.bottom : side === 'right' ? R.left : R.right;
          const r = 12 + tension * 26 + (d.active ? 6 : 0);
          const off = (side === 'bottom' || side === 'right' ? -1 : 1) * (r * 0.35 + tension * 14);
          blobs.push(horizontal ? { x: edge + off, y: grabC, r } : { x: grabC, y: edge + off, r });
          smooth += 20 * tension;
        }
        // Résorption : la goutte détachée de la poignée rétrécit et remonte vers le bord.
        const b = bead.current;
        if (b) {
          const age = (now - b.t0) / 1000;
          if (age < 0.62) {
            const k = age / 0.62;
            const r = 15 * (1 - smoothstep(0.1, 1, k));
            const lift = (1 - Math.pow(1 - k, 2)) * 22;
            if (r > 0.5)
              blobs.push(
                horizontal
                  ? { x: b.x + (side === 'right' ? -lift : lift), y: b.y, r }
                  : { x: b.x, y: b.y + (side === 'bottom' ? -lift : lift), r },
              );
          } else bead.current = null;
        }
      }
      return {
        box: { x: R.left, y: R.top, w: R.width, h: R.height },
        shape: makeShape('rect', R.width, R.height, L.m.radius),
        mat: L.m.mat,
        colors: L.m.colors,
        blobs,
        smooth,
        alpha: 1,
        variant: 1,
        busy: !s.settled || drag.current.active || !!bead.current,
      };
    },
  });

  if (!client || !mounted) return null;
  const pct = Math.round(((snap[snapIdx] ?? 0) / Math.max(...snap)) * 100);
  return createPortal(
    <div className="lq-portal" data-mode={mode} style={vars}>
      <div ref={scrim} className="lq-scrim lq-scrim-soft" aria-hidden="true" onClick={dismissible ? () => setOpen(false) : undefined} />
      <div
        ref={panel}
        className={`lq-drawer${className ? ` ${className}` : ''}`}
        data-side={side}
        data-matter=""
        data-atmax={atMax ? '' : undefined}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
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
        onPointerDown={(e) => {
          // Tant que le dernier palier n'est pas atteint, tout le panneau tire (souris et stylet).
          if (!atMax && e.pointerType !== 'touch' && !(e.target as HTMLElement).closest('button,a,input,textarea,select')) onGrabDown(e);
        }}
        onPointerMove={(e) => {
          if (drag.current.active && e.pointerType !== 'touch') onGrabMove(e);
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== 'touch') onGrabUp();
        }}
      >
        <div
          className="lq-drawer-grab"
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
        >
          <button
            type="button"
            className="lq-drawer-handle"
            role="slider"
            aria-label="Hauteur du panneau"
            aria-orientation={horizontal ? 'horizontal' : 'vertical'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`Palier ${snapIdx + 1} sur ${snap.length}`}
            onKeyDown={onGrabKey}
          />
        </div>
        <div ref={body} className="lq-drawer-body" data-locked={atMax ? undefined : ''} style={{ paddingBottom: 90 + 16 }}>
          <StageLayer layer="top" z={30}>
            {children}
          </StageLayer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
