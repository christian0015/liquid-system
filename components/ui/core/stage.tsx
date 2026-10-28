'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  mixRgb,
  useUIContext,
  type Color,
  type ResolvedTheme,
  type RGB,
  type UIConfig,
  parseColor,
} from './config';
import { FRAG_BACKDROP, FRAG_BLIT, FRAG_ITEM, MAX_BLOBS, VERT_FULL, VERT_ITEM } from './shaders';
import type { ShapeState } from './shape';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type LayerName = 'page' | 'top';
export type Blob = { x: number; y: number; r: number };

export type Material = {
  glue: number;
  glow: number;
  refraction: number;
  dispersion: number;
  specular: number;
  fresnel: number;
  thickness: number;
  grain: number;
  frost: number;
  iridescence: number;
  brightness: number;
};

export type ItemFrame = {
  /** Boîte de la forme principale, en px viewport (coin haut gauche) ; la scène la convertit vers sa couche. */
  box: { x: number; y: number; w: number; h: number };
  shape: ShapeState;
  mat: Material;
  colors: { glue: RGB; glass: RGB; glow: RGB };
  blobs?: Blob[];
  /** Rayon de fusion du gluant, en px. */
  smooth?: number;
  /** Surfaces voisines fusionnées avec celle-ci (calculé par la scène quand `glue` est élevé). */
  neighbors?: { cx: number; cy: number; w: number; h: number; r: number }[];
  alpha?: number;
  /** 0 plat, 1 relief, 2 creux. */
  variant?: 0 | 1 | 2;
  pointer?: { x: number; y: number; dent: number; press: number };
  ripple?: { x: number; y: number; t: number; amp: number };
  /** L'élément demande une image de plus (animation en cours). */
  busy?: boolean;
};

export type StageItem = {
  /** Graine 0–1 propre à l'élément : décale les phases et vitesses du mouvement ambiant. */
  seed: number;
  layer: LayerName;
  z: number;
  active: boolean;
  frame: (now: number, dt: number) => ItemFrame | null;
};

export type BackdropSpec = {
  kind: 'environment' | 'gradient' | 'image' | 'video';
  src?: string;
  from?: Color;
  to?: Color;
  angle?: number;
};

type Globals = { theme: ResolvedTheme; light: UIConfig['light']; quality: UIConfig['quality']; /** 0–1 : mouvement ambiant. */ ambient: number; /** Interrupteur du système liquide. */ enabled: boolean; bgKind: ResolvedTheme['bgKind'] };

/* ------------------------------------------------------------------ */
/* Programme WebGL avec cache d'uniformes                               */
/* ------------------------------------------------------------------ */

class Prog {
  readonly program: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  private cache = new Map<string, string>();

  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string) {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error('createShader');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
      return sh;
    };
    const p = gl.createProgram();
    if (!p) throw new Error('createProgram');
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.program = p;
  }

  use() {
    this.gl.useProgram(this.program);
  }

  private loc(name: string) {
    if (!this.locs.has(name)) this.locs.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locs.get(name) ?? null;
  }

  /** Met à jour un uniforme seulement si sa valeur a changé. */
  set(name: string, ...v: number[]) {
    const key = v.join(',');
    if (this.cache.get(name) === key) return;
    this.cache.set(name, key);
    const l = this.loc(name);
    if (!l) return;
    const g = this.gl;
    if (v.length === 1) g.uniform1f(l, v[0]);
    else if (v.length === 2) g.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) g.uniform3f(l, v[0], v[1], v[2]);
    else g.uniform4f(l, v[0], v[1], v[2], v[3]);
  }

  seti(name: string, v: number) {
    const key = `i${v}`;
    if (this.cache.get(name) === key) return;
    this.cache.set(name, key);
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, v);
  }

  setv4(name: string, data: Float32Array) {
    const key = Array.from(data).join(',');
    if (this.cache.get(name) === key) return;
    this.cache.set(name, key);
    const l = this.loc(name);
    if (l) this.gl.uniform4fv(l, data);
  }

  setv3(name: string, data: Float32Array) {
    const key = Array.from(data).join(',');
    if (this.cache.get(name) === key) return;
    this.cache.set(name, key);
    const l = this.loc(name);
    if (l) this.gl.uniform3fv(l, data);
  }
}

/* ------------------------------------------------------------------ */
/* Champ de distance d'un chemin SVG (mis en cache)                     */
/* ------------------------------------------------------------------ */

const PATH_RES = 128;
const pathFields = new Map<string, Uint8Array>();
let pathHost: SVGSVGElement | null = null;

function ensurePathHost() {
  if (pathHost) return pathHost;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.appendChild(svg);
  pathHost = svg;
  return svg;
}

const pathBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();
function measurePath(d: string) {
  const hit = pathBoxes.get(d);
  if (hit) return hit;
  const host = ensurePathHost();
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  host.appendChild(p);
  const b = p.getBBox();
  host.removeChild(p);
  const box = { x: b.x, y: b.y, w: Math.max(b.width, 1e-3), h: Math.max(b.height, 1e-3) };
  pathBoxes.set(d, box);
  return box;
}

/** Valeur `clip-path: url(#…)` en unités de boîte, pour découper le contenu DOM selon un chemin SVG. */
const clipIds = new Map<string, string>();
export function pathClipUrl(d: string): string {
  let id = clipIds.get(d);
  if (!id) {
    id = `lq-clip-${clipIds.size}`;
    clipIds.set(d, id);
    const host = ensurePathHost();
    const b = measurePath(d);
    const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    cp.setAttribute('id', id);
    cp.setAttribute('clipPathUnits', 'objectBoundingBox');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('transform', `scale(${1 / b.w} ${1 / b.h}) translate(${-b.x} ${-b.y})`);
    cp.appendChild(p);
    host.appendChild(cp);
  }
  return `url(#${id})`;
}

function pathField(d: string): Uint8Array | null {
  const hit = pathFields.get(d);
  if (hit) return hit;
  const b = measurePath(d);
  const c = document.createElement('canvas');
  c.width = c.height = PATH_RES;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(PATH_RES / b.w, 0, 0, PATH_RES / b.h, (-b.x * PATH_RES) / b.w, (-b.y * PATH_RES) / b.h);
  ctx.fill(new Path2D(d));
  const img = ctx.getImageData(0, 0, PATH_RES, PATH_RES).data;
  const n = PATH_RES * PATH_RES;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = img[i * 4 + 3] > 127 ? 1 : 0;
  // Transformée en distance (chamfer 3-4) vers l'autre classe, signée.
  const dist = (target: number) => {
    const out = new Float32Array(n).fill(1e4);
    for (let i = 0; i < n; i++) if (inside[i] === target) out[i] = 0;
    const R = PATH_RES;
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        const i = y * R + x;
        let v = out[i];
        if (x > 0) v = Math.min(v, out[i - 1] + 1);
        if (y > 0) v = Math.min(v, out[i - R] + 1);
        if (x > 0 && y > 0) v = Math.min(v, out[i - R - 1] + 1.414);
        if (x < R - 1 && y > 0) v = Math.min(v, out[i - R + 1] + 1.414);
        out[i] = v;
      }
    for (let y = R - 1; y >= 0; y--)
      for (let x = R - 1; x >= 0; x--) {
        const i = y * R + x;
        let v = out[i];
        if (x < R - 1) v = Math.min(v, out[i + 1] + 1);
        if (y < R - 1) v = Math.min(v, out[i + R] + 1);
        if (x < R - 1 && y < R - 1) v = Math.min(v, out[i + R + 1] + 1.414);
        if (x > 0 && y < R - 1) v = Math.min(v, out[i + R - 1] + 1.414);
        out[i] = v;
      }
    return out;
  };
  const toOutside = dist(0); // distance au vide, pour les pixels dedans
  const toInside = dist(1); // distance au plein, pour les pixels dehors
  const field = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const sd = inside[i] ? -toOutside[i] + 0.5 : toInside[i] - 0.5;
    field[i] = Math.round(Math.min(1, Math.max(0, 0.5 + sd / 32)) * 255);
  }
  pathFields.set(d, field);
  return field;
}

/* ------------------------------------------------------------------ */
/* Couche : un canvas WebGL2                                            */
/* ------------------------------------------------------------------ */

const ENV_INDEX = { studio: 0, soft: 1, neon: 2, custom: 3 } as const;

type Rect = { x: number; y: number; w: number; h: number };
const unionRect = (a: Rect, b: Rect): Rect => {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
};
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const holds = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Zone dessinée par un élément (forme, blobs, voisins, halo), en px locaux à la couche. */
function frameBounds(f: ItemFrame): Rect {
  const glowPad = 14 + 34 * f.mat.glow;
  const pad = 44 + glowPad * 2.4;
  let x0 = f.box.x - pad;
  let y0 = f.box.y - pad;
  let x1 = f.box.x + f.box.w + pad;
  let y1 = f.box.y + f.box.h + pad;
  for (const b of (f.blobs ?? []).slice(0, MAX_BLOBS)) {
    const r = b.r + (f.smooth ?? 0) + glowPad * 1.6;
    x0 = Math.min(x0, b.x - r);
    y0 = Math.min(y0, b.y - r);
    x1 = Math.max(x1, b.x + r);
    y1 = Math.max(y1, b.y + r);
  }
  for (const nb of (f.neighbors ?? []).slice(0, 2)) {
    const kk = 40 + glowPad;
    x0 = Math.min(x0, nb.cx - nb.w / 2 - kk);
    y0 = Math.min(y0, nb.cy - nb.h / 2 - kk);
    x1 = Math.max(x1, nb.cx + nb.w / 2 + kk);
    y1 = Math.max(y1, nb.cy + nb.h / 2 + kk);
  }
  return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0) + 1, h: Math.ceil(y1 - y0) + 1 };
}

/** Empreinte de ce qui est dessiné : si elle ne change pas, l'élément n'est pas redessiné. */
function frameSig(f: ItemFrame, c: { glue: RGB; glass: RGB; glow: RGB }, tb: number): string {
  const s = f.shape;
  const m = f.mat;
  return [
    r2(f.box.x), r2(f.box.y), r2(f.box.w), r2(f.box.h), r2(s.w), r2(s.h), s.r.map(r2).join(','), r2(s.ell), r2(s.path), s.pathKey ?? '',
    m.glue, m.glow, m.refraction, m.dispersion, m.specular, m.fresnel, m.thickness, m.grain, m.frost, m.iridescence, m.brightness,
    f.alpha ?? 1, f.variant ?? 1, f.smooth ?? 0, c.glue.map(r2).join(','), c.glass.map(r2).join(','), c.glow.map(r2).join(','),
    (f.blobs ?? []).map((b) => `${r2(b.x)},${r2(b.y)},${r2(b.r)}`).join(';'),
    f.pointer ? `${r2(f.pointer.x)},${r2(f.pointer.y)},${r2(f.pointer.dent)},${r2(f.pointer.press)}` : '',
    f.ripple ? `${r2(f.ripple.x)},${r2(f.ripple.y)},${r2(f.ripple.t)},${r2(f.ripple.amp)}` : '',
    (f.neighbors ?? []).map((n) => `${r2(n.cx)},${r2(n.cy)},${r2(n.w)},${r2(n.h)},${r2(n.r)}`).join(';'),
    tb,
  ].join('|');
}

/** Décale une image en y (viewport → repère local de la bande). */
function shiftFrame(f: ItemFrame, dy: number): ItemFrame {
  return {
    ...f,
    box: { ...f.box, y: f.box.y + dy },
    blobs: f.blobs?.map((b) => ({ ...b, y: b.y + dy })),
    pointer: f.pointer ? { ...f.pointer, y: f.pointer.y + dy } : undefined,
    ripple: f.ripple ? { ...f.ripple, y: f.ripple.y + dy } : undefined,
  };
}

type Entry = { item: StageItem; f: ItemFrame; colors: { glue: RGB; glass: RGB; glow: RGB }; b: Rect; sig: string };

/**
 * Couche : un canvas WebGL2.
 * - `page` : une bande plus haute que l'écran (≈ 3 écrans) posée DANS le document : elle défile avec le contenu,
 *   à la vitesse du compositeur, donc sans aucun retard sur le texte. Elle est recentrée quand l'écran s'approche de ses bords.
 * - `top` : canvas fixe pour la matière des overlays (leur contenu est fixe aussi : aucun décalage possible).
 */
class Layer {
  canvas!: HTMLCanvasElement;
  readonly wrapper: HTMLDivElement | null;
  readonly items = new Set<StageItem>();
  gl: WebGL2RenderingContext | null = null;
  private item!: Prog;
  private backdrop!: Prog;
  private blit!: Prog;
  private backTex: WebGLTexture | null = null;
  private backFbo: WebGLFramebuffer | null = null;
  private backSize = [0, 0];
  private imgTex: WebGLTexture | null = null;
  private pathTex = new Map<string, WebGLTexture>();
  private emptyPath: WebGLTexture | null = null;
  private imgVersion = -1;
  lost = false;
  cssW = 0;
  cssH = 0;
  dpr = 1;
  /** Position de la bande dans le document (page) ; 0 pour la couche fixe. */
  top = 0;
  needFull = true;
  backDirty = true;
  backOrigin = Number.NaN;
  prev = new Map<StageItem, { sig: string; b: Rect }>();

  private watchdog = 0;
  private tries = 0;

  constructor(readonly name: LayerName, private onRestored: () => void, private onLost: () => void) {
    this.wrapper = null;
    if (name === 'page') {
      // La bande vit dans le document : le corps doit servir de repère de positionnement.
      if (getComputedStyle(document.body).position === 'static') document.body.style.position = 'relative';
      const w = document.createElement('div');
      w.className = 'lq-strip';
      w.setAttribute('aria-hidden', 'true');
      document.body.appendChild(w);
      (this as { wrapper: HTMLDivElement | null }).wrapper = w;
    }
    this.attach();
  }

  /** Crée le canvas et ses écouteurs de perte de contexte. */
  private attach() {
    const c = document.createElement('canvas');
    c.className = `lq-canvas lq-canvas-${this.name}`;
    c.setAttribute('aria-hidden', 'true');
    if (this.canvas) this.canvas.remove();
    this.canvas = c;
    if (this.wrapper) this.wrapper.appendChild(c);
    else document.body.appendChild(c);
    if (this.wrapper) c.style.top = `${this.top}px`;
    c.addEventListener('webglcontextlost', (e) => {
      // Perte de contexte (GPU saturé, onglet en arrière-plan…) : on cache le rendu GL pour laisser le repli CSS visible,
      // on laisse le navigateur restaurer, et sinon on recrée le canvas nous-mêmes.
      e.preventDefault();
      this.lost = true;
      this.onLost();
      window.clearTimeout(this.watchdog);
      this.watchdog = window.setTimeout(() => this.recover(), 900);
    });
    c.addEventListener('webglcontextrestored', () => {
      window.clearTimeout(this.watchdog);
      this.lost = false;
      if (this.init()) {
        this.tries = 0;
        this.needFull = true;
        this.backDirty = true;
        this.onRestored();
      } else this.recover();
    });
  }

  /** Recrée le canvas et le contexte (jusqu'à 6 essais espacés) quand le navigateur ne restaure pas le contexte. */
  private recover() {
    if (!this.lost && this.gl) return;
    this.tries++;
    if (this.tries > 6) return;
    this.cssW = 0; // force le redimensionnement du nouveau canvas
    this.attach();
    if (this.init()) {
      this.lost = false;
      this.tries = 0;
      this.needFull = true;
      this.backDirty = true;
      this.onRestored();
    } else {
      this.lost = true;
      window.clearTimeout(this.watchdog);
      this.watchdog = window.setTimeout(() => this.recover(), 1200 * this.tries);
    }
  }

  get ready() {
    return !!this.backTex;
  }

  /** Masque ou affiche le canvas (interrupteur du système liquide). */
  setHidden(hidden: boolean) {
    const el = this.wrapper ?? this.canvas;
    el.style.display = hidden ? 'none' : '';
    if (!hidden) {
      this.needFull = true;
      this.backDirty = true;
    }
  }

  /** Crée le contexte et les programmes. Renvoie false si WebGL2 est indisponible. */
  init(): boolean {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // mises à jour partielles : le reste de l'image doit survivre
      powerPreference: 'high-performance',
    });
    if (!gl) return false;
    try {
      this.gl = gl;
      this.item = new Prog(gl, VERT_ITEM, FRAG_ITEM);
      this.backdrop = new Prog(gl, VERT_FULL, FRAG_BACKDROP);
      this.blit = new Prog(gl, VERT_FULL, FRAG_BLIT);
    } catch (err) {
      console.error('Liquid UI : échec de compilation WebGL', err);
      this.gl = null;
      return false;
    }
    this.backTex = null;
    this.backFbo = null;
    this.imgTex = null;
    this.imgVersion = -1;
    this.pathTex.clear();
    this.emptyPath = null;
    this.backSize = [0, 0];
    return true;
  }

  setTop(top: number) {
    this.top = top;
    if (this.wrapper) this.canvas.style.top = `${top}px`;
    this.needFull = true;
    this.backDirty = true;
  }

  /** Redimensionne ; renvoie true si la taille a changé (le canvas est alors vidé). */
  resize(w: number, h: number, dpr: number) {
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return false;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.needFull = true;
    this.backDirty = true;
    return true;
  }

  private texture(): WebGLTexture {
    const gl = this.gl as WebGL2RenderingContext;
    const t = gl.createTexture();
    if (!t) throw new Error('createTexture');
    return t;
  }

  private ensureBackdropTarget(scale: number) {
    const gl = this.gl as WebGL2RenderingContext;
    const w = Math.max(8, Math.min(2048, Math.round(this.cssW * scale)));
    const h = Math.max(8, Math.min(2048, Math.round(this.cssH * scale)));
    if (this.backTex && this.backSize[0] === w && this.backSize[1] === h) return;
    if (this.backTex) gl.deleteTexture(this.backTex);
    if (this.backFbo) gl.deleteFramebuffer(this.backFbo);
    this.backTex = this.texture();
    gl.bindTexture(gl.TEXTURE_2D, this.backTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.backFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.backFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.backTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.backSize = [w, h];
  }

  /** Reconstruit la texture de fond : ancrée au document (`originY`), en tuiles miroir. */
  renderBackdrop(
    theme: ResolvedTheme,
    dark: number,
    spec: BackdropSpec,
    media: HTMLImageElement | HTMLVideoElement | null,
    mediaVersion: number,
    geo: { originY: number; tileH: number; docH: number; bgKind: ResolvedTheme['bgKind'] },
  ) {
    const gl = this.gl;
    if (!gl || this.lost || this.cssW === 0) return;
    const isMedia = spec.kind === 'image' || spec.kind === 'video';
    this.ensureBackdropTarget(isMedia ? 1 : 0.5);
    if (isMedia && media && (this.imgVersion !== mediaVersion || spec.kind === 'video')) {
      try {
        if (!this.imgTex) this.imgTex = this.texture();
        gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.imgVersion = mediaVersion;
      } catch {
        /* image non lisible (CORS) : repli sur l'environnement */
      }
    }
    // 0 : fond de la couleur du thème ; 3 : uni (noir / blanc cassé ou couleur personnalisée).
    const mode = spec.kind === 'gradient' ? 1 : isMedia && this.imgTex && media ? 2 : geo.bgKind === 'theme' ? 0 : 3;
    const p = this.backdrop;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.backFbo);
    gl.viewport(0, 0, this.backSize[0], this.backSize[1]);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    p.use();
    p.set('uVp', this.cssW, this.cssH);
    p.set('uOriginY', geo.originY);
    p.set('uTileH', geo.tileH);
    p.set('uDocH', geo.docH);
    p.set('uTime', 0);
    p.set('uAmb', 0);
    p.seti('uMode', mode);
    p.set('uDark', dark);
    p.set('uBg', ...theme.bg);
    p.set('uBg2', ...theme.bg2);
    p.set('uGlueC', ...theme.glue);
    p.set('uGlowC', ...theme.glow);
    p.set('uGlassC', ...theme.glass);
    const c1 = parseColor(spec.from ?? '') ?? theme.bg2;
    const c2 = parseColor(spec.to ?? '') ?? theme.glue;
    p.set('uC1', ...c1);
    p.set('uC2', ...c2);
    p.set('uAngle', ((spec.angle ?? 160) * Math.PI) / 180 - Math.PI / 2);
    const asp = media instanceof HTMLVideoElement ? media.videoWidth / Math.max(1, media.videoHeight) : media instanceof HTMLImageElement ? media.naturalWidth / Math.max(1, media.naturalHeight) : 1;
    p.set('uImgAspect', asp || 1);
    p.seti('uImg', 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.backOrigin = geo.originY;
    this.backDirty = false;
  }

  private pathTexture(d: string): WebGLTexture {
    const gl = this.gl as WebGL2RenderingContext;
    const hit = this.pathTex.get(d);
    if (hit) return hit;
    const field = pathField(d);
    const t = this.texture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, PATH_RES, PATH_RES, 0, gl.RED, gl.UNSIGNED_BYTE, field ?? new Uint8Array(PATH_RES * PATH_RES).fill(128));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.pathTex.set(d, t);
    return t;
  }

  /**
   * Dessine la zone `region` (null = tout) : efface, remet le fond, puis redessine chaque élément qui la touche.
   * Le reste du canvas n'est pas touché (mise à jour partielle).
   */
  draw(
    list: Entry[],
    region: Rect | null,
    g: Globals,
    theme: ResolvedTheme,
    dark: number,
    time: number,
    showBackdrop: boolean,
  ) {
    const gl = this.gl;
    if (!gl || this.lost || !this.backTex) return;
    const full: Rect = { x: 0, y: 0, w: this.cssW, h: this.cssH };
    const R = region ?? full;
    const d = this.dpr;
    const dev = (r: Rect) => {
      const x0 = Math.max(0, Math.floor(r.x * d));
      const y1 = Math.min(this.canvas.height, Math.ceil((r.y + r.h) * d));
      const x1 = Math.min(this.canvas.width, Math.ceil((r.x + r.w) * d));
      const y0 = Math.max(0, Math.floor(r.y * d));
      return { x: x0, y: this.canvas.height - y1, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.SCISSOR_TEST);
    const rs = dev(R);
    if (rs.w === 0 || rs.h === 0) return;
    gl.scissor(rs.x, rs.y, rs.w, rs.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    if (showBackdrop && this.name === 'page') {
      this.blit.use();
      this.blit.seti('uTex', 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.backTex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    const p = this.item;
    p.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    p.set('uVp', this.cssW, this.cssH);
    p.set('uTime', time);
    p.set('uAmb', g.ambient);
    p.seti('uEnv', ENV_INDEX[g.light.environment]);
    p.set('uDark', dark);
    p.set('uBg', ...theme.bg);
    p.set('uBg2', ...theme.bg2);
    p.set('uGlassC', ...theme.glass);
    p.set('uGlowC', ...theme.glow);
    p.set('uGlueC', ...theme.glue);
    p.seti('uBack', 0);
    p.seti('uPath', 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex);

    const blobs = new Float32Array(MAX_BLOBS * 3);
    const nbData = new Float32Array(8);
    for (const { item: it, f, colors, b } of list) {
      if (!hits(b, R)) continue;
      const x0 = Math.max(0, b.x);
      const y0 = Math.max(0, b.y);
      const x1 = Math.min(this.cssW, b.x + b.w);
      const y1 = Math.min(this.cssH, b.y + b.h);
      if (x1 <= x0 || y1 <= y0) continue;
      const sc = dev({ x: Math.max(x0, R.x), y: Math.max(y0, R.y), w: Math.min(x1, R.x + R.w) - Math.max(x0, R.x), h: Math.min(y1, R.y + R.h) - Math.max(y0, R.y) });
      if (sc.w === 0 || sc.h === 0) continue;
      gl.scissor(sc.x, sc.y, sc.w, sc.h);
      const s = f.shape;
      p.set('uBounds', x0, y0, x1 - x0, y1 - y0);
      p.set('uBox', f.box.x + f.box.w / 2, f.box.y + f.box.h / 2, s.w, s.h);
      p.set('uRad', s.r[0], s.r[1], s.r[2], s.r[3]);
      p.set('uEll', s.ell);
      const usePath = s.path > 0.001 && s.pathData;
      p.set('uPathMix', usePath ? s.path : 0);
      if (usePath) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.pathTexture(s.pathData as string));
        gl.activeTexture(gl.TEXTURE0);
      } else if (!this.emptyPath) {
        gl.activeTexture(gl.TEXTURE2);
        this.emptyPath = this.texture();
        gl.bindTexture(gl.TEXTURE_2D, this.emptyPath);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([128]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.activeTexture(gl.TEXTURE0);
      }
      const nb = Math.min(f.blobs?.length ?? 0, MAX_BLOBS);
      blobs.fill(0);
      for (let i = 0; i < nb; i++) {
        const bl = (f.blobs as Blob[])[i];
        blobs[i * 3] = bl.x;
        blobs[i * 3 + 1] = bl.y;
        blobs[i * 3 + 2] = bl.r;
      }
      p.setv3('uBlob', blobs);
      p.seti('uNBlob', nb);
      p.set('uK', Math.max(0.5, f.smooth ?? 12));
      const nbrs = f.neighbors ?? [];
      const nn = Math.min(nbrs.length, 2);
      p.seti('uNNbr', nn);
      nbData.fill(0);
      for (let i = 0; i < nn; i++) {
        nbData[i * 4] = nbrs[i].cx;
        nbData[i * 4 + 1] = nbrs[i].cy;
        nbData[i * 4 + 2] = nbrs[i].w;
        nbData[i * 4 + 3] = nbrs[i].h;
      }
      p.setv4('uNbr', nbData);
      p.set('uNbrR', nbrs[0]?.r ?? 0, nbrs[1]?.r ?? 0);
      p.set('uKN', Math.max(0.5, (f.mat.glue - 0.5) * 68));
      p.set('uGlue', ...colors.glue);
      p.set('uGlass', ...colors.glass);
      p.set('uGlow', ...colors.glow);
      const m = f.mat;
      p.set('uMatA', m.glue, m.glow, m.refraction, m.dispersion);
      p.set('uMatB', m.specular, m.fresnel, m.thickness, m.grain);
      p.set('uMatC', m.frost, m.iridescence, f.alpha ?? 1, f.variant ?? 1);
      p.set('uMatD', m.brightness, 0, 0, 0);
      p.set('uSeed', it.seed);
      const pt = f.pointer;
      p.set('uPtr', pt?.x ?? -9999, pt?.y ?? -9999, pt?.dent ?? 0, pt?.press ?? 0);
      const rp = f.ripple;
      p.set('uRip', rp?.x ?? 0, rp?.y ?? 0, rp?.t ?? 0, rp?.amp ?? 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
}

const eqRgb = (a: RGB, b: RGB, e = 0.004) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e && Math.abs(a[2] - b[2]) < e;

function smoothTheme(cur: ResolvedTheme, target: ResolvedTheme, k: number): { theme: ResolvedTheme; moving: boolean } {
  const mix = (a: RGB, b: RGB) => (eqRgb(a, b) ? b : mixRgb(a, b, k));
  const next: ResolvedTheme = {
    ...target,
    base: mix(cur.base, target.base),
    bg: mix(cur.bg, target.bg),
    bg2: mix(cur.bg2, target.bg2),
    surface: mix(cur.surface, target.surface),
    ink: mix(cur.ink, target.ink),
    inkSoft: mix(cur.inkSoft, target.inkSoft),
    glue: mix(cur.glue, target.glue),
    glass: mix(cur.glass, target.glass),
    glow: mix(cur.glow, target.glow),
    palette: target.palette,
  };
  const moving = ['bg', 'bg2', 'glue', 'glass', 'glow'].some((key) => !eqRgb(next[key as 'bg'], target[key as 'bg']));
  return { theme: next, moving };
}

/** Limite la résolution pour rester sous les plafonds des navigateurs (surtout iOS : ≈ 16 Mpx par canvas). */
function capDpr(dpr: number, w: number, h: number) {
  const side = 8192 / Math.max(w, h, 1);
  const area = Math.sqrt(8e6 / Math.max(w * h, 1));
  return Math.max(1, Math.min(dpr, side, area));
}

export class Stage {
  supported = true;
  private layers: Partial<Record<LayerName, Layer>> = {};
  private raf = 0;
  private lastRenderT = 0;
  private dirty = false;
  private busyPrev = false;
  private visiblePrev = false;
  private ambientInterval = 33;
  private globals: Globals | null = null;
  private themeCur: ResolvedTheme | null = null;
  private darkCur = 1;
  private backdropSpec: BackdropSpec = { kind: 'environment' };
  private showBackdrop = false;
  private backdropDirty = true;
  private media: HTMLImageElement | HTMLVideoElement | null = null;
  private mediaVersion = 0;
  private itemColors = new Map<StageItem, { glue: RGB; glass: RGB; glow: RGB }>();
  private dprScale = 1;
  private slow = 0;
  private fast = 0;
  private lit = false;
  backdropOwner = false;

  constructor() {
    window.addEventListener('resize', this.invalidate, { passive: true });
    window.addEventListener('lq-invalidate', this.invalidate);
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.invalidate();
    });
  }

  /** Demande une image. */
  invalidate = () => {
    this.dirty = true;
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * Défilement du document : la bande de la page défile avec le contenu (compositeur), sans aucune image à dessiner.
   * On ne redessine que pour la recentrer, ou pour la couche fixe quand un overlay est ouvert.
   */
  private onScroll = (e: Event) => {
    const t = e.target;
    if (t === document || t === window || t === document.documentElement) {
      if (this.stripNeedsMove() || (this.layers.top?.items.size ?? 0) > 0) this.invalidate();
    } else this.invalidate(); // défilement interne (tiroir, panneau) : les positions ont changé
  };

  private stripOk(layer: Layer, sy: number, vh: number, docH: number) {
    const H = Math.min(docH, Math.ceil(vh * 2.6));
    if (layer.cssH !== H) return false;
    const top = layer.top;
    const topOk = top <= 0 || sy - top >= vh * 0.25;
    const botOk = top + H >= docH - 0.5 || sy + vh <= top + H - vh * 0.25;
    return topOk && botOk && sy >= top && sy + vh <= top + H;
  }

  private stripNeedsMove() {
    const page = this.layers.page;
    if (!page || page.cssH === 0) return false;
    const vh = window.innerHeight;
    const docH = Math.max(document.documentElement.scrollHeight, vh);
    return !this.stripOk(page, window.scrollY, vh, docH);
  }

  private layer(name: LayerName): Layer | null {
    if (!this.supported) return null;
    let l = this.layers[name];
    if (!l) {
      l = new Layer(
        name,
        () => {
          this.backdropDirty = true;
          this.invalidate();
        },
        () => {
          // Contexte perdu : le repli CSS reprend la main tant que le rendu GL est indisponible.
          this.lit = false;
          document.documentElement.removeAttribute('data-lq-gl');
        },
      );
      if (this.globals && !this.globals.enabled) l.setHidden(true);
      if (!l.init()) {
        l.wrapper?.remove();
        l.canvas.remove();
        this.supported = false;
        return null;
      }
      this.layers[name] = l;
      this.backdropDirty = true;
    }
    return l;
  }

  register(item: StageItem): () => void {
    const l = this.layer(item.layer);
    if (!l) return () => undefined;
    l.items.add(item);
    this.invalidate();
    return () => {
      l.items.delete(item);
      this.itemColors.delete(item);
      this.invalidate();
    };
  }

  setGlobals(g: Globals) {
    const prev = this.globals;
    this.globals = g;
    if (!prev || prev.enabled !== g.enabled) {
      for (const l of Object.values(this.layers)) l?.setHidden(!g.enabled);
      if (!g.enabled) {
        this.lit = false;
        document.documentElement.removeAttribute('data-lq-gl');
      }
    }
    if (prev && prev.bgKind !== g.bgKind) this.backdropDirty = true;
    if (!prev || prev.theme !== g.theme || prev.light.environment !== g.light.environment) this.backdropDirty = true;
    this.invalidate();
  }

  setBackdrop(spec: BackdropSpec, show: boolean) {
    const prev = this.backdropSpec;
    this.backdropSpec = spec;
    this.showBackdrop = show;
    this.backdropDirty = true;
    this.layer('page');
    if ((spec.kind === 'image' || spec.kind === 'video') && spec.src && (prev.src !== spec.src || prev.kind !== spec.kind)) {
      this.media = null;
      if (spec.kind === 'image') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.media = img;
          this.mediaVersion++;
          this.backdropDirty = true;
          this.invalidate();
        };
        img.src = spec.src;
      } else {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.src = spec.src;
        v.onloadeddata = () => {
          this.media = v;
          this.mediaVersion++;
          void v.play().catch(() => undefined);
          this.invalidate();
        };
      }
    }
    this.invalidate();
  }

  private tick = (t: number) => {
    this.raf = 0;
    if (document.hidden) return;
    const ambient = (this.globals?.ambient ?? 0) > 0 && this.visiblePrev;
    // Mouvement ambiant : image cadencée (≈ 30 i/s) ; les animations en cours et les événements gardent la pleine cadence.
    if (!this.dirty && !this.busyPrev && ambient && t - this.lastRenderT < this.ambientInterval - 3) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const gap = this.lastRenderT ? t - this.lastRenderT : 16;
    const dt = Math.min(0.05, gap > 120 ? 0.016 : gap / 1000);
    const ambientOnly = !this.dirty && !this.busyPrev;
    this.dirty = false;
    this.lastRenderT = t;
    const r = this.render(t, dt, gap, ambientOnly);
    this.busyPrev = r.busy;
    this.visiblePrev = r.visible;
    if (r.busy || this.dirty || ((this.globals?.ambient ?? 0) > 0 && r.visible)) {
      if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    } else this.lastRenderT = 0;
  };

  private render(t: number, dt: number, gap: number, ambientOnly: boolean): { busy: boolean; visible: boolean } {
    const g = this.globals;
    if (!g || !g.enabled) return { busy: false, visible: false };
    let busy = false;
    let visible = false;

    // Thème animé (≈ 400 ms) et mode clair/sombre lissé.
    if (!this.themeCur) this.themeCur = g.theme;
    const k = 1 - Math.exp(-dt / 0.11);
    const sm = smoothTheme(this.themeCur, g.theme, k);
    if (sm.moving) {
      busy = true;
      this.backdropDirty = true;
    }
    this.themeCur = sm.theme;
    const darkT = g.theme.mode === 'dark' ? 1 : 0;
    if (Math.abs(this.darkCur - darkT) > 0.003) {
      this.darkCur += (darkT - this.darkCur) * k;
      busy = true;
      this.backdropDirty = true;
    } else this.darkCur = darkT;
    if (this.backdropSpec.kind === 'video' && this.media) {
      this.backdropDirty = true;
      busy = true;
    }

    // Résolution adaptative : baisse par paliers si le rythme chute, remonte quand c'est stable.
    const maxDpr = Math.max(1, Math.min(g.quality.maxDpr, window.devicePixelRatio || 1));
    const expected = ambientOnly ? this.ambientInterval : 16.7;
    if (g.quality.adaptive && gap < 250) {
      if (gap > expected * 1.7) {
        this.slow++;
        this.fast = 0;
      } else if (gap < expected * 1.2) {
        this.fast++;
        this.slow = Math.max(0, this.slow - 1);
      }
      if (this.slow > 14) {
        this.slow = 0;
        if (this.dprScale > 1 / maxDpr + 0.01) this.dprScale = Math.max(1 / maxDpr, this.dprScale - 0.2);
        else this.ambientInterval = Math.min(66, this.ambientInterval + 12); // dernier recours : ambiant plus lent
      }
      if (this.fast > 120 && this.dprScale < 1) {
        this.dprScale = Math.min(1, this.dprScale + 0.2);
        this.fast = 0;
      }
    }
    const dpr0 = Math.max(1, maxDpr * this.dprScale);
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const sy = window.scrollY;
    const ambient = g.ambient;

    for (const name of ['page', 'top'] as LayerName[]) {
      const layer = this.layers[name];
      if (!layer || !layer.gl || layer.lost) continue;

      // Géométrie : la bande de la page (≈ 3 écrans) vit dans le document ; la couche fixe couvre l'écran.
      let H = vh;
      let docH = vh;
      let top = 0;
      if (name === 'page') {
        docH = Math.max(document.documentElement.scrollHeight, vh);
        H = Math.min(docH, Math.ceil(vh * 2.6));
        top = layer.top;
        if (!this.stripOk(layer, sy, vh, docH)) top = Math.min(Math.max(Math.round(sy - vh * 0.8), 0), docH - H);
      }
      layer.resize(vw, H, capDpr(dpr0, vw, H));
      if (name === 'page' && top !== layer.top) layer.setTop(top);
      const shift = name === 'page' ? sy - layer.top : 0; // viewport → repère local
      const vpLocal: Rect = { x: 0, y: shift, w: vw, h: vh };

      // Fond ancré au document (page : position de la bande ; couche fixe : position du défilement).
      const originY = name === 'page' ? layer.top : sy;
      const needsBackdrop = layer.items.size > 0 || (name === 'page' && this.showBackdrop);
      if (needsBackdrop && (layer.backDirty || this.backdropDirty || layer.backOrigin !== originY || !layer.ready)) {
        layer.renderBackdrop(this.themeCur, this.darkCur, this.backdropSpec, this.media, this.mediaVersion, {
          originY,
          tileH: Math.max(vh, 640),
          docH,
          bgKind: g.bgKind,
        });
        layer.needFull = true;
      }
      if (!layer.ready) continue;

      const entries: Entry[] = [];
      const sorted = [...layer.items].sort((a, b) => a.z - b.z);
      for (const item of sorted) {
        if (!item.active) continue;
        let f = item.frame(t, dt);
        if (!f) continue;
        if (f.busy) busy = true;
        if (shift !== 0) f = shiftFrame(f, shift);
        const b0 = frameBounds(f);
        if (b0.x > vw || b0.x + b0.w < 0 || b0.y > layer.cssH || b0.y + b0.h < 0) continue; // hors de la bande
        // Couleurs lissées par élément (changement de thème ou de tint à chaud).
        const target = f.colors;
        const cur = this.itemColors.get(item);
        let colors = target;
        if (cur) {
          const kk = 1 - Math.exp(-dt / 0.11);
          colors = {
            glue: eqRgb(cur.glue, target.glue) ? target.glue : mixRgb(cur.glue, target.glue, kk),
            glass: eqRgb(cur.glass, target.glass) ? target.glass : mixRgb(cur.glass, target.glass, kk),
            glow: eqRgb(cur.glow, target.glow) ? target.glow : mixRgb(cur.glow, target.glow, kk),
          };
          if (colors.glue !== target.glue || colors.glass !== target.glass || colors.glow !== target.glow) busy = true;
        }
        this.itemColors.set(item, colors);
        entries.push({ item, f, colors, b: b0, sig: '' });
      }

      // Fusion de matière : deux surfaces à fort `glue`, voisines et disjointes, partagent leur contour.
      for (const a of entries) {
        if (a.f.mat.glue <= 0.5) continue;
        const reach = (a.f.mat.glue - 0.5) * 80;
        const near: NonNullable<ItemFrame['neighbors']> = [];
        for (const e of entries) {
          const bf = e.f;
          if (e === a || bf.mat.glue <= 0.5) continue;
          const gx = Math.max(0, Math.max(a.f.box.x, bf.box.x) - Math.min(a.f.box.x + a.f.box.w, bf.box.x + bf.box.w));
          const gy = Math.max(0, Math.max(a.f.box.y, bf.box.y) - Math.min(a.f.box.y + a.f.box.h, bf.box.y + bf.box.h));
          if (gx === 0 && gy === 0) continue; // jamais un parent avec son contenu
          if (Math.hypot(gx, gy) < reach && near.length < 2) {
            near.push({ cx: bf.box.x + bf.box.w / 2, cy: bf.box.y + bf.box.h / 2, w: bf.box.w, h: bf.box.h, r: Math.max(0, bf.shape.r[0]) });
          }
        }
        if (near.length) a.f.neighbors = near;
      }

      // Empreintes : seuls les éléments dont l'image change sont redessinés (avec leurs voisins qui les touchent).
      for (const e of entries) {
        e.b = frameBounds(e.f);
        const inView = hits(e.b, vpLocal);
        if (inView) visible = true;
        e.sig = frameSig(e.f, e.colors, ambient > 0 && inView ? Math.floor(t / 33) : 0);
      }

      let region: Rect | null = null;
      let skip = false;
      if (layer.needFull) region = null;
      else {
        let D: Rect | null = null;
        const add = (r: Rect) => {
          D = D ? unionRect(D, r) : r;
        };
        const cur = new Set<StageItem>();
        for (const e of entries) {
          cur.add(e.item);
          const p = layer.prev.get(e.item);
          if (!p || p.sig !== e.sig) {
            add(e.b);
            if (p) add(p.b);
          }
        }
        for (const [item, p] of layer.prev) if (!cur.has(item)) add(p.b);
        if (!D) skip = true;
        else {
          // Fermeture : tout élément qui touche la zone est redessiné en entier (pas de couture visible).
          for (let it = 0; it < 4; it++) {
            let grown = false;
            for (const e of entries) {
              if (hits(D, e.b) && !holds(D, e.b)) {
                D = unionRect(D, e.b);
                grown = true;
              }
            }
            if (!grown) break;
          }
          region = D;
        }
      }
      if (!skip) layer.draw(entries, region, g, this.themeCur, this.darkCur, t / 1000, this.showBackdrop);
      layer.needFull = false;
      layer.prev = new Map(entries.map((e) => [e.item, { sig: e.sig, b: e.b }]));
    }
    this.backdropDirty = false;

    if (!this.lit && Object.values(this.layers).some((l) => l?.gl && !l.lost)) {
      this.lit = true;
      document.documentElement.setAttribute('data-lq-gl', '1');
    }
    return { busy, visible };
  }
}

let itemSeq = 1;
let stage: Stage | null = null;
/** Singleton client. Renvoie null côté serveur ou si WebGL2 est indisponible. */
export function getStage(): Stage | null {
  if (typeof window === 'undefined') return null;
  if (!stage) stage = new Stage();
  return stage.supported ? stage : null;
}

/* ------------------------------------------------------------------ */
/* Hooks                                                                */
/* ------------------------------------------------------------------ */

/** Couche et z hérités : tout ce qui vit dans un overlay (popup, tiroir, toast) dessine sa matière au-dessus de celui-ci. */
const StageLayerContext = createContext<{ layer: LayerName; z: number }>({ layer: 'page', z: 0 });
export function StageLayer({ layer, z, children }: { layer: LayerName; z: number; children?: ReactNode }) {
  return <StageLayerContext.Provider value={{ layer, z }}>{children}</StageLayerContext.Provider>;
}

/** Synchronise le thème et la lumière du provider courant avec la scène (si aucun Backdrop ne le fait). */
function useStageGlobals(force: boolean) {
  const { config, theme, reducedMotion } = useUIContext();
  // Seule exception volontaire : `motion.respectReducedMotion` (désactivé par défaut) coupe le mouvement ambiant.
  const ambient = reducedMotion && config.motion.respectReducedMotion ? 0 : config.motion.ambient;
  const enabled = config.enabled;
  useEffect(() => {
    const s = getStage();
    if (!s) return;
    if (force) s.backdropOwner = true;
    if (force || !s.backdropOwner) s.setGlobals({ theme, light: config.light, quality: config.quality, ambient, enabled, bgKind: theme.bgKind });
  }, [config.light, config.quality, theme, force, ambient, enabled]);
}

/**
 * Enregistre un élément auprès de la scène. `frame` est relu à chaque image (positions, état) ;
 * l'élément n'est considéré que s'il intersecte le viewport élargi (IntersectionObserver).
 */
export function useStageItem(opts: {
  ref?: RefObject<Element | null>;
  layer?: LayerName;
  z?: number;
  frame: (now: number, dt: number) => ItemFrame | null;
}) {
  const inherited = useContext(StageLayerContext);
  const { ref } = opts;
  const layer = opts.layer ?? inherited.layer;
  const z = (opts.z ?? 0) + (opts.layer ? 0 : inherited.z);
  const frameRef = useRef(opts.frame);
  useLayoutEffect(() => {
    frameRef.current = opts.frame;
  });
  const { config } = useUIContext();
  const margin = config.quality.margin;
  useStageGlobals(false);

  useEffect(() => {
    const s = getStage();
    if (!s) return;
    // Tri : `z` explicite d'abord, puis profondeur DOM (un enfant se dessine au-dessus de son parent).
    const el0 = ref?.current;
    let depth = 0;
    for (let n: Element | null | undefined = el0; n; n = n.parentElement) depth++;
    const item: StageItem = { seed: (itemSeq++ * 0.6180339887) % 1, layer, z: z * 1000 + depth, active: !ref, frame: (n, d) => frameRef.current(n, d) };
    const off = s.register(item);
    const el = ref?.current;
    let io: IntersectionObserver | undefined;
    let ro: ResizeObserver | undefined;
    if (el) {
      io = new IntersectionObserver(
        (es) => {
          item.active = es[es.length - 1].isIntersecting;
          s.invalidate();
        },
        { rootMargin: `${Math.max(margin, Math.round(window.innerHeight * 1.2))}px` },
      );
      io.observe(el);
      ro = new ResizeObserver(() => s.invalidate());
      ro.observe(el);
    }
    return () => {
      io?.disconnect();
      ro?.disconnect();
      off();
    };
  }, [ref, layer, z, margin]);

  return { invalidate: () => getStage()?.invalidate() };
}

/** Fond dessiné par le kit : le verre le réfracte. Rendu CSS de repli côté serveur et sans WebGL2. */
export function Backdrop({
  kind = 'environment',
  src,
  from,
  to,
  angle,
}: {
  kind?: BackdropSpec['kind'];
  src?: string;
  from?: Color;
  to?: Color;
  angle?: number;
}) {
  useStageGlobals(true);
  const { config } = useUIContext();
  useEffect(() => {
    getStage()?.setBackdrop({ kind, src, from, to, angle }, true);
    return () => getStage()?.setBackdrop({ kind: 'environment' }, false);
  }, [kind, src, from, to, angle]);
  return <div className="lq-backdrop" aria-hidden="true" data-kind={kind} data-bg={config.theme.background} style={kind === 'gradient' && from && to ? { background: `linear-gradient(${angle ?? 160}deg, ${from}, ${to})` } : undefined} />;
}
