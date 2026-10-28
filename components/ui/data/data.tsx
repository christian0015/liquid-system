'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { parseColor, rgbToCss, useReducedMotion, useTheme, useUIConfig, type Color, type RGB } from '../core/config';
import { fluidityMult, Spring } from '../core/motion';

/** Données : pas de gluant (la lisibilité prime). Couleurs et glow hérités du thème ; les changements de données
 *  se font par interpolation de formes (barres, courbes, parts) pilotée par des ressorts. */

const css = (c: RGB) => rgbToCss(c);
const colorOf = (c: Color | undefined, fallback: RGB) => (c ? (parseColor(c) ? c : css(fallback)) : css(fallback));

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Valeurs animées vers `target` (un ressort par valeur). Retourne le tableau courant. */
function useTween(target: number[], speed?: number) {
  const [config] = useUIConfig();
  const reduced = useReducedMotion();
  const mult = fluidityMult(speed, config.fluidity);
  const springs = useRef<Spring[]>([]);
  const [vals, setVals] = useState<number[]>(target);
  const key = target.join('|');

  useEffect(() => {
    const list = springs.current;
    while (list.length < target.length) list.push(new Spring(0, mult, 0.78));
    list.length = target.length;
    list.forEach((s, i) => {
      s.tune(mult, 0.78);
      if (reduced) s.snap(target[i]);
      else s.target = target[i];
    });
    if (reduced) {
      setVals([...target]);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.max(0, Math.min(0.05, (t - last) / 1000));
      last = t;
      let settled = true;
      for (const s of list) {
        s.step(dt);
        if (!s.settled) settled = false;
      }
      setVals(list.map((s) => s.x));
      if (!settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mult, reduced]);

  return vals.length === target.length ? vals : target;
}

/* ------------------------------------------------------------------ */
/* Chart                                                                */
/* ------------------------------------------------------------------ */

export type ChartRow = { label: string } & Record<string, string | number>;
export type ChartSeries = { key: string; name?: string; color?: Color };

export type ChartProps = {
  type?: 'line' | 'area' | 'bar' | 'donut';
  data: ChartRow[];
  /** Séries tracées (par défaut : toutes les clés numériques des lignes). */
  series?: ChartSeries[];
  height?: number;
  /** Halo des traits, 0–1. */
  glow?: number | boolean;
  palette?: Color[];
  unit?: string;
  speed?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
};

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(Math.round(v * 10) / 10));

/** Courbe lissée (Catmull-Rom → Bézier). */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    d += `C${p1[0] + (p2[0] - p0[0]) * t} ${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t} ${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  return `M${p(a0)}A${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

export function Chart({ type = 'line', data, series, height = 220, glow, palette, unit = '', speed, label, className, style }: ChartProps) {
  const theme = useTheme();
  const [config] = useUIConfig();
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const keys = useMemo<ChartSeries[]>(
    () => series ?? Object.keys(data[0] ?? {}).filter((k) => k !== 'label' && typeof data[0][k] === 'number').map((k) => ({ key: k })),
    [series, data],
  );
  const colors = keys.map((s, i) => colorOf(s.color ?? palette?.[i], theme.palette[i % theme.palette.length]));
  const glowK = glow === undefined ? config.material.glow : glow === true ? 0.7 : glow === false ? 0 : glow;
  const target = useMemo(() => data.flatMap((row) => keys.map((k) => Number(row[k.key] ?? 0))), [data, keys]);
  const vals = useTween(target, speed);
  const nS = keys.length;
  const at = (row: number, s: number) => vals[row * nS + s] ?? 0;
  const [active, setActive] = useState<number | null>(null);

  const w = Math.max(width, 160);
  const m = type === 'donut' ? { l: 8, r: 8, t: 8, b: 8 } : { l: 38, r: 14, t: 14, b: 28 };
  const iw = w - m.l - m.r;
  const ih = height - m.t - m.b;
  const maxV = niceMax(Math.max(1, ...target));
  const yOf = (v: number) => m.t + ih * (1 - v / maxV);
  const n = data.length;
  const xOf = (i: number) => (type === 'bar' ? m.l + (iw / n) * (i + 0.5) : m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxV);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  const glowStyle = (c: string): CSSProperties => ({ filter: glowK > 0 ? `drop-shadow(0 0 ${3 + glowK * 9}px ${c})` : undefined });

  const pointerIdx = (e: ReactPointerEvent) => {
    const R = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - R.left;
    if (type === 'bar') return Math.min(n - 1, Math.max(0, Math.floor(((x - m.l) / iw) * n)));
    return Math.min(n - 1, Math.max(0, Math.round(((x - m.l) / iw) * (n - 1))));
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const total = Array.from({ length: n }, (_, i) => at(i, 0)).reduce((a, b) => a + b, 0);
  const summary = `${label ?? 'Graphique'} : ${data.map((r) => `${r.label} ${keys.map((k) => `${k.name ?? k.key} ${r[k.key]}${unit}`).join(', ')}`).join(' ; ')}`;

  return (
    <div ref={ref} className={`lq-chart${className ? ` ${className}` : ''}`} style={style} data-type={type}>
      {width > 0 && (
        <svg
          width={w}
          height={height}
          viewBox={`0 0 ${w} ${height}`}
          role="img"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={type === 'donut' ? undefined : onKey}
          onPointerMove={type === 'donut' ? undefined : (e) => setActive(pointerIdx(e))}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          <defs>
            {keys.map((_, s) => (
              <linearGradient key={s} id={`${gid}-g${s}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[s]} stopOpacity="0.38" />
                <stop offset="100%" stopColor={colors[s]} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {type !== 'donut' &&
            ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={w - m.r} y1={yOf(t)} y2={yOf(t)} className="lq-grid" />
                <text x={m.l - 8} y={yOf(t) + 4} textAnchor="end" className="lq-axis">
                  {fmt(t)}
                </text>
              </g>
            ))}
          {type !== 'donut' &&
            data.map((r, i) =>
              i % every === 0 ? (
                <text key={`${i}-${r.label}`} x={xOf(i)} y={height - 8} textAnchor="middle" className="lq-axis">
                  {r.label}
                </text>
              ) : null,
            )}

          {(type === 'line' || type === 'area') &&
            keys.map((k, s) => {
              const pts: [number, number][] = data.map((_, i) => [xOf(i), yOf(at(i, s))]);
              const d = smoothPath(pts);
              return (
                <g key={k.key}>
                  {type === 'area' && pts.length > 1 && <path d={`${d}L${pts[pts.length - 1][0]} ${m.t + ih}L${pts[0][0]} ${m.t + ih}Z`} fill={`url(#${gid}-g${s})`} />}
                  <path d={d} fill="none" stroke={colors[s]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={glowStyle(colors[s])} />
                </g>
              );
            })}

          {type === 'bar' &&
            data.map((_, i) => {
              const group = (iw / n) * 0.66;
              const bw = Math.max(4, group / nS - 3);
              return keys.map((k, s) => {
                const v = at(i, s);
                const x = xOf(i) - group / 2 + s * (group / nS) + 1.5;
                const y = yOf(Math.max(0, v));
                return (
                  <rect key={`${i}-${k.key}`} x={x} y={y} width={bw} height={Math.max(0, m.t + ih - y)} rx={Math.min(7, bw / 2)} fill={colors[s]} opacity={active === null || active === i ? 1 : 0.45} style={glowStyle(colors[s])} />
                );
              });
            })}

          {type === 'donut' &&
            (() => {
              const R = Math.min(w, height) / 2 - 14;
              const cx = w / 2;
              const cy = height / 2;
              const sw = Math.max(12, R * 0.26);
              let a = -Math.PI / 2;
              const gap = n > 1 ? 0.07 : 0;
              return (
                <>
                  {data.map((r, i) => {
                    const frac = total > 0 ? at(i, 0) / total : 0;
                    const span = frac * Math.PI * 2;
                    const a0 = a + gap / 2;
                    const a1 = a + span - gap / 2;
                    a += span;
                    const c = colorOf(palette?.[i], theme.palette[i % theme.palette.length]);
                    return span > gap + 0.01 ? (
                      <path key={`${i}-${r.label}`} d={arc(cx, cy, R - sw / 2, a0, a1)} fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" style={glowStyle(c)} />
                    ) : null;
                  })}
                  <text x={cx} y={cy - 2} textAnchor="middle" className="lq-donut-total">
                    {fmt(total)}
                    {unit}
                  </text>
                  <text x={cx} y={cy + 20} textAnchor="middle" className="lq-axis">
                    {keys[0]?.name ?? 'Total'}
                  </text>
                </>
              );
            })()}

          {active !== null && type !== 'donut' && data[active] && (
            <g pointerEvents="none">
              <line x1={xOf(active)} x2={xOf(active)} y1={m.t} y2={m.t + ih} className="lq-cross" />
              {type !== 'bar' && keys.map((k, s) => <circle key={k.key} cx={xOf(active)} cy={yOf(at(active, s))} r="5" fill={colors[s]} className="lq-dot" />)}
            </g>
          )}
        </svg>
      )}

      {active !== null && type !== 'donut' && data[active] && (
        <div className="lq-chart-tip" style={{ left: Math.min(Math.max(xOf(active), 70), w - 70) }} role="status">
          <strong>{data[active].label}</strong>
          {keys.map((k, s) => (
            <span key={k.key}>
              <i style={{ background: colors[s] }} />
              {k.name ?? k.key} {fmt(Number(data[active][k.key]))}
              {unit}
            </span>
          ))}
        </div>
      )}

      {(keys.length > 1 || type === 'donut') && (
        <ul className="lq-legend">
          {(type === 'donut' ? data.map((r, i) => ({ name: r.label, color: colorOf(palette?.[i], theme.palette[i % theme.palette.length]) })) : keys.map((k, s) => ({ name: k.name ?? k.key, color: colors[s] }))).map((l) => (
            <li key={l.name}>
              <i style={{ background: l.color }} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diagram                                                              */
/* ------------------------------------------------------------------ */

export type DiagramNode = { id: string; label: string; sub?: string; status?: 'idle' | 'active' | 'done' | 'error'; tint?: Color };
export type DiagramLink = { from: string; to: string; label?: string; active?: boolean };
export type DiagramProps = {
  nodes: DiagramNode[];
  links: DiagramLink[];
  /** `auto` : horizontal si la largeur le permet, vertical sinon. */
  direction?: 'horizontal' | 'vertical' | 'auto';
  glow?: number | boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
};

const NODE_W = 150;
const NODE_H = 58;

/** Nœuds et liens (flux, pipeline). Couleurs et glow hérités du thème ; mise en page par couches. */
export function Diagram({ nodes, links, direction = 'auto', glow, label = 'Diagramme', className, style }: DiagramProps) {
  const theme = useTheme();
  const [config] = useUIConfig();
  const reduced = useReducedMotion();
  const [ref, width] = useWidth<HTMLDivElement>();
  const glowK = glow === undefined ? config.material.glow : glow === true ? 0.7 : glow === false ? 0 : glow;
  const vertical = direction === 'vertical' || (direction === 'auto' && width > 0 && width < nodes.length * (NODE_W * 0.62 + 40));

  const layout = useMemo(() => {
    const layer = new Map<string, number>();
    const preds = new Map<string, string[]>();
    links.forEach((l) => preds.set(l.to, [...(preds.get(l.to) ?? []), l.from]));
    const depth = (id: string, seen: Set<string>): number => {
      if (layer.has(id)) return layer.get(id) as number;
      if (seen.has(id)) return 0;
      seen.add(id);
      const d = Math.max(-1, ...(preds.get(id) ?? []).map((p) => depth(p, seen))) + 1;
      layer.set(id, d);
      return d;
    };
    nodes.forEach((n) => depth(n.id, new Set()));
    const cols = new Map<number, string[]>();
    nodes.forEach((n) => cols.set(layer.get(n.id) ?? 0, [...(cols.get(layer.get(n.id) ?? 0) ?? []), n.id]));
    const nLayers = Math.max(...cols.keys(), 0) + 1;
    const maxPer = Math.max(...[...cols.values()].map((c) => c.length), 1);
    const gx = vertical ? 30 : 56;
    const gy = 26;
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((ids, l) => {
      ids.forEach((id, i) => {
        const off = ((maxPer - ids.length) / 2) * (vertical ? NODE_W + gx : NODE_H + gy);
        pos.set(id, vertical ? { x: off + i * (NODE_W + gx * 0.4), y: l * (NODE_H + gx) } : { x: l * (NODE_W + gx), y: off + i * (NODE_H + gy) });
      });
    });
    const W = vertical ? maxPer * NODE_W + (maxPer - 1) * gx * 0.4 : nLayers * NODE_W + (nLayers - 1) * gx;
    const H = vertical ? nLayers * NODE_H + (nLayers - 1) * gx : maxPer * NODE_H + (maxPer - 1) * gy;
    return { pos, W, H };
  }, [nodes, links, vertical]);

  const status = (n: DiagramNode): string => {
    if (n.tint) return colorOf(n.tint, theme.glue);
    switch (n.status) {
      case 'active': return css(theme.glow);
      case 'done': return css(theme.palette[3]);
      case 'error': return '#fb7185';
      default: return css(theme.inkSoft);
    }
  };
  const pad = 14;
  const scale = width > 0 ? Math.min(1, (width - pad * 2) / layout.W) : 1;
  const vw = layout.W + pad * 2;
  const vh = layout.H + pad * 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div ref={ref} className={`lq-diagram${className ? ` ${className}` : ''}`} style={style}>
      {width > 0 && (
        <svg width={vw * scale} height={vh * scale} viewBox={`0 0 ${vw} ${vh}`} role="img" aria-label={`${label} : ${nodes.map((n) => n.label).join(', ')}`}>
          {links.map((l) => {
            const a = layout.pos.get(l.from);
            const b = layout.pos.get(l.to);
            if (!a || !b) return null;
            const x1 = pad + a.x + (vertical ? NODE_W / 2 : NODE_W);
            const y1 = pad + a.y + (vertical ? NODE_H : NODE_H / 2);
            const x2 = pad + b.x + (vertical ? NODE_W / 2 : 0);
            const y2 = pad + b.y + (vertical ? 0 : NODE_H / 2);
            const d = vertical ? `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}` : `M${x1} ${y1}C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
            const c = status(byId.get(l.from) as DiagramNode);
            return (
              <g key={`${l.from}-${l.to}`}>
                <path d={d} fill="none" stroke={c} strokeOpacity="0.35" strokeWidth="2" />
                {l.active && <path d={d} fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 10" className={reduced ? undefined : 'lq-flow'} style={{ filter: glowK > 0 ? `drop-shadow(0 0 ${2 + glowK * 6}px ${c})` : undefined }} />}
                {l.label && (
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" className="lq-axis">
                    {l.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const c = status(n);
            return (
              <g key={n.id} transform={`translate(${pad + p.x} ${pad + p.y})`}>
                <rect width={NODE_W} height={NODE_H} rx="16" className="lq-node" stroke={c} style={{ filter: glowK > 0 && n.status && n.status !== 'idle' ? `drop-shadow(0 0 ${3 + glowK * 8}px ${c})` : undefined }} />
                <circle cx="16" cy={NODE_H / 2} r="4.5" fill={c} />
                <text x="30" y={n.sub ? NODE_H / 2 - 3 : NODE_H / 2 + 5} className="lq-node-title">
                  {n.label}
                </text>
                {n.sub && (
                  <text x="30" y={NODE_H / 2 + 14} className="lq-axis">
                    {n.sub}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
