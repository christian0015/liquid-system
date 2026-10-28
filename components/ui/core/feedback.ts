'use client';

import { useCallback } from 'react';
import { useUIConfig, type HapticName, type SoundName, type UIConfig } from './config';

/** Retour tactile et sonore. Désactivé par défaut (voir `haptics.enabled` et `audioUi.enabled`). */

const PATTERNS: Record<HapticName, number[]> = {
  tick: [6],
  soft: [14],
  confirm: [10, 40, 18],
  warn: [24, 50, 24, 50, 30],
};

/** iPhone : Safari ignore `navigator.vibrate`. Détournement (non standard) d'un `<input type="checkbox" switch>` masqué. */
let iosSwitch: HTMLInputElement | null = null;
function iosTick() {
  try {
    if (!iosSwitch) {
      const supportsSwitch = typeof CSS !== 'undefined' && CSS.supports?.('-webkit-touch-callout', 'none') && /iP(hone|ad|od)/.test(navigator.userAgent);
      if (!supportsSwitch) return false;
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.appendChild(input);
      document.body.appendChild(label);
      iosSwitch = input;
    }
    iosSwitch.click();
    return true;
  } catch {
    return false;
  }
}

/** Android : motif de vibration. iPhone : suite de tics (l'intensité fine n'est pas contrôlable). À appeler dans un geste utilisateur. */
export function playHaptic(name: HapticName, cfg: UIConfig['haptics']) {
  if (!cfg.enabled || typeof navigator === 'undefined') return;
  try {
    if (typeof navigator.vibrate === 'function') {
      const k = Math.max(0.2, Math.min(1.5, cfg.intensity * 2));
      // Les pauses (indices impairs) restent telles quelles : seule la durée des impulsions suit l'intensité.
      navigator.vibrate(PATTERNS[name].map((v, i) => (i % 2 === 0 ? Math.max(1, Math.round(v * k)) : v)));
    } else {
      const ticks = Math.max(1, Math.round(PATTERNS[name].filter((_, i) => i % 2 === 0).length * (0.5 + cfg.intensity)));
      for (let i = 0; i < ticks; i++) window.setTimeout(iosTick, i * 70);
    }
  } catch {
    /* aucun retour haptique disponible : sans effet, sans erreur */
  }
}

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

/** Oscillateur à enveloppe rapide, glissando de `f0` vers `f1`. */
function toneRaw(c: AudioContext, out: AudioNode, o: { type?: OscillatorType; f0: number; f1?: number; t0?: number; dur: number; gain: number }) {
  const t = c.currentTime + (o.t0 ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

const lastPlayed = new Map<SoundName, number>();

export function playSound(name: SoundName, cfg: UIConfig['audioUi']) {
  if (!cfg.enabled) return; // option coupée : aucun code audio n'est exécuté
  // Limitation de cadence : pas de saturation si un composant déclenche en rafale.
  const nowMs = performance.now();
  if (nowMs - (lastPlayed.get(name) ?? -1e9) < 70) return;
  lastPlayed.set(name, nowMs);
  const c = audio();
  if (!c) return;
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, cfg.volume)) * 0.6;
  // Doux : passe-bas sur toute la sortie + légère variation aléatoire de hauteur.
  const soft = c.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 5200;
  master.connect(soft).connect(c.destination);
  const detune = 1 + (Math.random() - 0.5) * 0.08;
  const tone = (cc: AudioContext, out: AudioNode, o: Parameters<typeof toneRaw>[2]) =>
    toneRaw(cc, out, { ...o, f0: o.f0 * detune, f1: o.f1 ? o.f1 * detune : undefined });

  switch (name) {
    case 'pop':
      tone(c, master, { f0: 620, f1: 190, dur: 0.1, gain: 0.7 });
      break;
    case 'ooze': {
      tone(c, master, { f0: 170, f1: 85, dur: 0.28, gain: 0.5 });
      const n = noise(c);
      const f = c.createBiquadFilter();
      const g = c.createGain();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, c.currentTime);
      f.frequency.exponentialRampToValueAtTime(160, c.currentTime + 0.26);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.28);
      n.connect(f).connect(g).connect(master);
      n.start();
      n.stop(c.currentTime + 0.3);
      break;
    }
    case 'merge':
      tone(c, master, { f0: 300, f1: 340, dur: 0.18, gain: 0.45 });
      tone(c, master, { f0: 390, f1: 345, dur: 0.18, gain: 0.35 });
      break;
    case 'snap': {
      tone(c, master, { type: 'triangle', f0: 980, f1: 420, dur: 0.05, gain: 0.5 });
      const n = noise(c);
      const f = c.createBiquadFilter();
      const g = c.createGain();
      f.type = 'highpass';
      f.frequency.value = 2400;
      g.gain.setValueAtTime(0.3, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.03);
      n.connect(f).connect(g).connect(master);
      n.start();
      n.stop(c.currentTime + 0.04);
      break;
    }
    case 'tick':
      tone(c, master, { f0: 1900, dur: 0.025, gain: 0.25 });
      break;
    case 'soft-alert':
      tone(c, master, { type: 'triangle', f0: 440, dur: 0.16, gain: 0.45 });
      tone(c, master, { type: 'triangle', f0: 330, t0: 0.12, dur: 0.22, gain: 0.45 });
      break;
    case 'confirm':
      tone(c, master, { f0: 440, dur: 0.12, gain: 0.45 });
      tone(c, master, { f0: 660, t0: 0.09, dur: 0.2, gain: 0.45 });
      break;
  }
}

/**
 * `{ haptic, sound }` liés à la config courante. Les props `haptics` et `audioUi` d'un composant (`false` = couper,
 * un nom = remplacer le motif ou le son par défaut) s'appliquent par-dessus ; l'interrupteur global coupé coupe tout.
 */
export function useFeedback(props?: { haptics?: boolean | HapticName; audioUi?: boolean | SoundName }) {
  const [config] = useUIConfig();
  const hp = props?.haptics;
  const ap = props?.audioUi;
  const haptic = useCallback(
    (n: HapticName) => {
      if (hp === false) return;
      playHaptic(typeof hp === 'string' ? hp : n, config.haptics);
    },
    [config.haptics, hp],
  );
  const sound = useCallback(
    (n: SoundName) => {
      if (ap === false) return;
      playSound(typeof ap === 'string' ? ap : n, config.audioUi);
    },
    [config.audioUi, ap],
  );
  return { haptic, sound };
}
