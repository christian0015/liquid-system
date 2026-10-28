'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui';

const HEX6 = /^#[0-9a-f]{6}$/i;
let probe: CanvasRenderingContext2D | null | undefined;

/** Convertit n'importe quelle couleur CSS en `#rrggbb` (null si invalide). */
export function toHex6(input: string): string | null {
  const v = input.trim();
  if (HEX6.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  if (typeof document === 'undefined' || !v) return null;
  if (probe === undefined) probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  probe.fillStyle = '#010203';
  probe.fillStyle = v;
  const a = probe.fillStyle;
  probe.fillStyle = '#fdfcfb';
  probe.fillStyle = v;
  if (a !== probe.fillStyle) return null; // couleur invalide
  return HEX6.test(a) ? a.toLowerCase() : null;
}

const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

function hslOf([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const DERIVED: [string, string][] = [
  ['Fond', '--lq-bg'],
  ['Texte', '--lq-ink'],
  ['Gluant', '--lq-glue'],
  ['Verre', '--lq-glass'],
  ['Glow', '--lq-glow'],
];

/**
 * Sélecteur de couleur : pastille en relief, valeurs HEX / RGB / HSL, contraste du texte blanc et noir sur cette couleur
 * (niveau WCAG), champ libre (toute couleur CSS) et, au besoin, les couleurs que le thème en déduit.
 */
export function ColorField({ label, value, onChange, derived = false }: { label: string; value: string; onChange: (v: string) => void; derived?: boolean }) {
  const hex = toHex6(value);
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value);
  }
  const rgb = hex ? rgbOf(hex) : null;
  const hsl = rgb ? hslOf(rgb) : null;
  const L = rgb ? lum(rgb) : 0;
  const cw = ratio(L, 1);
  const cb = ratio(L, 0);
  const level = (r: number) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA grand texte' : 'insuffisant');

  return (
    <div className="cf">
      <span className="lq-label">{label}</span>
      <label className="cf-card" style={{ '--c': hex ?? '#808080' } as React.CSSProperties}>
        <input className="cf-picker" type="color" aria-label={`${label} : ouvrir le sélecteur`} value={hex ?? '#808080'} onChange={(e) => onChange(e.target.value)} />
        <span className="cf-chip" aria-hidden="true">
          <span className="cf-gloss" />
        </span>
        <span className="cf-info">
          <b className="mono cf-hex">{hex ? hex.toUpperCase() : 'Couleur invalide'}</b>
          {rgb && <span className="mono">rgb({rgb.join(', ')})</span>}
          {hsl && <span className="mono">hsl({hsl[0]}°, {hsl[1]} %, {hsl[2]} %)</span>}
          {rgb && (
            <span className="cf-contrast">
              <span>
                <i style={{ background: hex ?? undefined, color: '#fff' }}>Aa</i>
                {cw.toFixed(1)}:1 · {level(cw)}
              </span>
              <span>
                <i style={{ background: hex ?? undefined, color: '#000' }}>Aa</i>
                {cb.toFixed(1)}:1 · {level(cb)}
              </span>
            </span>
          )}
        </span>
      </label>
      <TextField
        size="sm"
        aria-label={`${label} (toute couleur CSS)`}
        value={text}
        placeholder="#2f4b8a, rgb(…), hsl(…), nom CSS"
        error={text.trim() && !toHex6(text) ? 'Couleur CSS non reconnue.' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (toHex6(e.target.value)) onChange(e.target.value);
        }}
      />
      {derived && (
        <div className="cf-derived" role="list" aria-label="Couleurs déduites du thème">
          {DERIVED.map(([name, v]) => (
            <span className="cf-d" role="listitem" key={v}>
              <i style={{ background: `var(${v})` }} aria-hidden="true" />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
