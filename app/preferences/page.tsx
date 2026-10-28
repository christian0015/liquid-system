'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Slider, Surface, Switch, Tabs, useFeedback, useToast, useUIConfig, type AppearName, type SoundName } from '@/components/ui';
import { BODY_FONTS, TITLE_FONTS } from '../fonts';
import { ColorField } from './color-field';

const PRESETS = [
  { name: 'Acier', base: '#2f4b8a' },
  { name: 'Indigo', base: '#3a2cff' },
  { name: 'Nuit', base: '#0b1020' },
  { name: 'Rose', base: '#ff3d7f' },
  { name: 'Menthe', base: '#12b886' },
  { name: 'Ambre', base: '#ffb36b' },
  { name: 'Sable', base: '#f3e7d1' },
  { name: 'Ciel', base: '#cfe6ff' },
];
const SOUNDS: SoundName[] = ['pop', 'ooze', 'merge', 'snap', 'tick', 'soft-alert', 'confirm'];
const SOUND_LABEL: Record<SoundName, string> = { pop: 'Pop', ooze: 'Suintement', merge: 'Fusion', snap: 'Claquement', tick: 'Tic', 'soft-alert': 'Alerte douce', confirm: 'Confirmation' };
const APPEARS: (AppearName | 'random')[] = ['random', 'ooze', 'unfold', 'bloom', 'drip', 'ripple', 'melt'];
const APPEAR_LABEL: Record<string, string> = { random: 'Aléatoire', ooze: 'Suintement', unfold: 'Dépli', bloom: 'Éclosion', drip: 'Coulée', ripple: 'Ondée', melt: 'Fonte' };
const BG_LABEL = { theme: 'Couleur du thème', neutral: 'Noir / blanc cassé', custom: 'Personnalisé' } as const;

export default function Preferences() {
  const router = useRouter();
  const toast = useToast();
  const [config, setConfig, reset] = useUIConfig();
  const { haptic, sound } = useFeedback();
  const [radius, setRadius] = useState(config.material.radius as number);
  const [animating, setAnimating] = useState(false);
  const raf = useRef(0);

  // Démonstration convexe ↔ concave : le rayon oscille en passant par 0 (coin vif).
  useEffect(() => {
    if (!animating) return;
    const t0 = performance.now();
    const tick = (t: number) => {
      setRadius(Math.round(Math.sin(((t - t0) / 1000) * 1.7) * 40 + 6));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [animating]);

  const num = (v: number, d = 2) => Number(v.toFixed(d));
  const L = config.light;
  const M = config.material;
  const T = config.typography;
  const bg = config.theme.background;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); router.push('/'); }} aria-label="Lumen, accueil">
          <span className="brand-mark" aria-hidden="true" />
          Lumen
        </a>
        <nav className="nav" aria-label="Navigation principale">
          <Button size="sm" variant="flat" as="a" href="/" onClick={(e) => { e.preventDefault(); router.push('/'); }}>
            Console
          </Button>
        </nav>
      </header>

      <section className="hero" aria-labelledby="titre">
        <div>
          <h1 id="titre">Préférences</h1>
          <p>Chaque réglage s’applique en direct à toute l’interface.</p>
        </div>
        <div className="hero-actions">
          <Switch label="Système liquide" checked={config.enabled} onCheckedChange={(v) => setConfig({ enabled: v })} />
          <Button
            variant="flat"
            onClick={() => {
              reset();
              setRadius(47);
              toast({ title: 'Réglages réinitialisés', tone: 'info' });
            }}
          >
            Réinitialiser les réglages
          </Button>
        </div>
      </section>

      <div className="prefs">
        <Surface className="panel" glow={0.2} radius={30}>
          <h2>Couleur</h2>
          <div className="swatches" role="group" aria-label="Thèmes prédéfinis">
            {PRESETS.map((p) => (
              <button key={p.name} type="button" className="swatch" aria-label={p.name} aria-pressed={config.theme.base.toLowerCase() === p.base} style={{ background: p.base }} onClick={() => setConfig({ theme: { base: p.base } })} />
            ))}
          </div>
          <ColorField label="Couleur de base" value={config.theme.base} onChange={(v) => setConfig({ theme: { base: v } })} derived />
          <Tabs
            label="Mode du texte"
            size="sm"
            items={[
              { value: 'auto', label: 'Auto' },
              { value: 'light', label: 'Clair' },
              { value: 'dark', label: 'Sombre' },
            ]}
            value={config.theme.mode}
            onValueChange={(v) => setConfig({ theme: { mode: v as 'auto' | 'light' | 'dark' } })}
          />
          <p className="sub">Auto : le mode se déduit de la luminance de la base (ou du fond personnalisé). Le contraste du texte est recalculé à chaque changement.</p>

          <h2 style={{ marginTop: 8 }}>Arrière-plan</h2>
          <Tabs
            label="Type d’arrière-plan"
            size="sm"
            items={(Object.keys(BG_LABEL) as (keyof typeof BG_LABEL)[]).map((k) => ({ value: k, label: BG_LABEL[k] }))}
            value={bg}
            onValueChange={(v) => setConfig({ theme: { background: v as 'theme' | 'neutral' | 'custom', ...(v === 'custom' && !config.theme.backgroundColor ? { backgroundColor: '#14161c' } : {}) } })}
          />
          {bg === 'custom' && <ColorField label="Couleur de l’arrière-plan" value={config.theme.backgroundColor ?? '#14161c'} onChange={(v) => setConfig({ theme: { backgroundColor: v } })} />}
          <p className="sub">
            {bg === 'theme' && 'Le fond reprend la couleur du thème (lueurs et faisceaux compris).'}
            {bg === 'neutral' && 'Noir en thème sombre, blanc cassé en thème clair.'}
            {bg === 'custom' && 'Le fond est la couleur choisie ; le texte s’adapte à sa luminosité.'}
          </p>
        </Surface>

        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <h2>Typographie</h2>
          <span className="lq-label">Titres</span>
          <div className="fp" role="group" aria-label="Police des titres">
            {TITLE_FONTS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="fp-opt"
                aria-pressed={T.title === f.family}
                style={{ fontFamily: f.family, fontStyle: f.style, fontWeight: f.weight }}
                onClick={() => setConfig({ typography: { title: f.family, titleStyle: f.style, titleWeight: f.weight, titleScale: f.scale } })}
              >
                {f.label.replace(/ italique$/, '')}
                <small>{f.style === 'italic' ? 'italique' : 'manuscrite'}</small>
              </button>
            ))}
          </div>
          <span className="lq-label">Texte courant</span>
          <div className="fp" role="group" aria-label="Police du texte">
            {BODY_FONTS.map((f) => (
              <button key={f.key} type="button" className="fp-opt" aria-pressed={T.body === f.family} style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: 16 }} onClick={() => setConfig({ typography: { body: f.family, bodyWeight: f.weight } })}>
                {f.label}
              </button>
            ))}
          </div>
          <Slider label="Taille des titres" min={0.8} max={1.8} step={0.05} value={T.titleScale} onValueChange={(v) => setConfig({ typography: { titleScale: num(v) } })} />
          <Slider label="Graisse du texte" min={400} max={700} step={100} value={T.bodyWeight} onValueChange={(v) => setConfig({ typography: { bodyWeight: v } })} />
          <div className="type-preview" aria-hidden="true">
            <span className="tp-title">Console de rendu</span>
            <span>Suivez la file, validez les versions et lancez un rendu depuis une seule surface.</span>
          </div>
        </Surface>

        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <h2>Fluidité</h2>
          <Slider label="Vitesse minimale" min={0.3} max={2} step={0.05} value={config.fluidity.min} onValueChange={(v) => setConfig({ fluidity: { min: v, max: Math.max(v, config.fluidity.max) } })} />
          <Slider label="Vitesse maximale" min={0.3} max={2} step={0.05} value={config.fluidity.max} onValueChange={(v) => setConfig({ fluidity: { max: v, min: Math.min(v, config.fluidity.min) } })} />
          <Tabs
            label="Apparition"
            size="sm"
            items={APPEARS.map((a) => ({ value: a, label: APPEAR_LABEL[a] }))}
            value={config.motion.appear}
            onValueChange={(v) => setConfig({ motion: { appear: v as AppearName | 'random' } })}
          />
          <Slider label="Mouvement de la matière au repos" value={config.motion.ambient} onValueChange={(v) => setConfig({ motion: { ambient: num(v) } })} />
        </Surface>

        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <h2>Matière</h2>
          <Slider label="Gluant (viscosité, relief)" value={M.glue} onValueChange={(v) => setConfig({ material: { glue: num(v) } })} />
          <Slider label="Luminosité" value={M.brightness} onValueChange={(v) => setConfig({ material: { brightness: num(v) } })} />
          <Slider label="Glow" value={M.glow} onValueChange={(v) => setConfig({ material: { glow: num(v) } })} />
          <Slider label="Réactivité" value={M.reactive} onValueChange={(v) => setConfig({ material: { reactive: num(v) } })} />
          <div className="radius-stage">
            <Surface className="radius-demo" radius={radius} glow={0.2}>
              Rayon {radius} px {radius < 0 ? '(concave)' : radius === 0 ? '(vif)' : '(convexe)'}
            </Surface>
          </div>
          <Slider label="Rayon" min={-48} max={64} step={1} value={radius} onValueChange={(v) => { setAnimating(false); setRadius(v); setConfig({ material: { radius: v } }); }} />
          <div className="inline">
            <Button size="sm" variant="flat" onClick={() => setAnimating((a) => !a)} aria-pressed={animating}>
              {animating ? 'Arrêter l’animation' : 'Animer convexe ↔ concave'}
            </Button>
          </div>
        </Surface>

        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <h2>Lumière</h2>
          <Slider label="Réfraction" value={L.refraction} onValueChange={(v) => setConfig({ light: { refraction: num(v) } })} />
          <Slider label="Dispersion" value={L.dispersion} onValueChange={(v) => setConfig({ light: { dispersion: num(v) } })} />
          <Slider label="Reflets" value={L.specular} onValueChange={(v) => setConfig({ light: { specular: num(v) } })} />
          <Slider label="Fresnel" value={L.fresnel} onValueChange={(v) => setConfig({ light: { fresnel: num(v) } })} />
          <Slider label="Épaisseur (px)" min={2} max={40} step={1} value={L.thickness} onValueChange={(v) => setConfig({ light: { thickness: v } })} />
          <Slider label="Grain" value={L.grain} onValueChange={(v) => setConfig({ light: { grain: num(v) } })} />
          <Slider label="Dépoli" value={L.frost} onValueChange={(v) => setConfig({ light: { frost: num(v) } })} />
          <Slider label="Huile sur l’eau (irisation)" value={L.iridescence} onValueChange={(v) => setConfig({ light: { iridescence: num(v) } })} />
          <Tabs
            label="Environnement lumineux"
            size="sm"
            items={[
              { value: 'studio', label: 'Studio' },
              { value: 'soft', label: 'Doux' },
              { value: 'neon', label: 'Néon' },
              { value: 'custom', label: 'Teinté' },
            ]}
            value={L.environment}
            onValueChange={(v) => setConfig({ light: { environment: v as 'studio' | 'soft' | 'neon' | 'custom' } })}
          />
        </Surface>

        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <h2>Performance</h2>
          <Slider label="Résolution maximale (DPR)" min={1} max={3} step={0.25} value={config.quality.maxDpr} onValueChange={(v) => setConfig({ quality: { maxDpr: v } })} />
          <Slider label="Marge autour de l’écran (px)" min={0} max={600} step={20} value={config.quality.margin} onValueChange={(v) => setConfig({ quality: { margin: v } })} />
          <p className="sub">Le système liquide reste appliqué en permanence. Seul l’interrupteur « Système liquide » le coupe.</p>
        </Surface>

        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <h2>Retour sensoriel</h2>
          <div className="form-row">
            <div>
              <b>Haptique</b>
              <p className="sub">Vibrations de l’appareil. Désactivé par défaut.</p>
            </div>
            <Switch checked={config.haptics.enabled} onCheckedChange={(v) => setConfig({ haptics: { enabled: v } })} aria-label="Activer l’haptique" />
          </div>
          <Slider label="Intensité" value={config.haptics.intensity} onValueChange={(v) => setConfig({ haptics: { intensity: num(v) } })} disabled={!config.haptics.enabled} />
          <div className="inline">
            <Button size="sm" variant="flat" disabled={!config.haptics.enabled} onClick={() => haptic('confirm')}>
              Tester la vibration
            </Button>
          </div>
          <div className="form-row" style={{ marginTop: 6 }}>
            <div>
              <b>Sons</b>
              <p className="sub">Sons synthétisés, doux. Désactivé par défaut.</p>
            </div>
            <Switch checked={config.audioUi.enabled} onCheckedChange={(v) => setConfig({ audioUi: { enabled: v } })} aria-label="Activer les sons" />
          </div>
          <Slider label="Volume" value={config.audioUi.volume} onValueChange={(v) => setConfig({ audioUi: { volume: num(v) } })} disabled={!config.audioUi.enabled} />
          <div className="inline">
            {SOUNDS.map((s) => (
              <Button key={s} size="sm" variant="flat" disabled={!config.audioUi.enabled} onClick={() => sound(s)}>
                {SOUND_LABEL[s]}
              </Button>
            ))}
          </div>
        </Surface>
      </div>
    </main>
  );
}
