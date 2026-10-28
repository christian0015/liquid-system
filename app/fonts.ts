import {
  Cormorant_Garamond,
  Dancing_Script,
  DM_Sans,
  Fraunces,
  Great_Vibes,
  Inter,
  Instrument_Sans,
  Instrument_Serif,
  JetBrains_Mono,
  Manrope,
  Outfit,
  Parisienne,
  Pinyon_Script,
  Plus_Jakarta_Sans,
  Playfair_Display,
} from 'next/font/google';

// Les polices secondaires ne sont pas préchargées : le navigateur ne les télécharge que si on les choisit.
const playfair = Playfair_Display({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-playfair', display: 'swap', preload: false });
const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['400', '500', '600', '700'], style: ['normal', 'italic'], variable: '--font-cormorant', display: 'swap', preload: false });
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument-serif', display: 'swap', preload: false });
const fraunces = Fraunces({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-fraunces', display: 'swap', preload: false });
const dancing = Dancing_Script({ subsets: ['latin'], variable: '--font-dancing', display: 'swap', preload: false });
const parisienne = Parisienne({ subsets: ['latin'], weight: '400', variable: '--font-parisienne', display: 'swap' });
const greatVibes = Great_Vibes({ subsets: ['latin'], weight: '400', variable: '--font-great-vibes', display: 'swap', preload: false });
const pinyon = Pinyon_Script({ subsets: ['latin'], weight: '400', variable: '--font-pinyon', display: 'swap', preload: false });

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap', preload: false });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap', preload: false });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap', preload: false });
const instrumentSans = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument-sans', display: 'swap', preload: false });
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap', preload: false });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

/** À poser sur `<html>` : déclare toutes les variables CSS de polices. */
export const fontVariables = [
  playfair, cormorant, instrumentSerif, fraunces, dancing, parisienne, greatVibes, pinyon,
  inter, manrope, dmSans, jakarta, instrumentSans, outfit, mono,
].map((f) => f.variable).join(' ');

export type TitleFont = { key: string; label: string; family: string; style: 'normal' | 'italic'; weight: number; scale: number };
export type BodyFont = { key: string; label: string; family: string; weight: number };

/** Titres : écritures calligraphiques (italiques de texte et scripts). `scale` compense leur petit œil. */
export const TITLE_FONTS: TitleFont[] = [
  { key: 'parisienne', label: 'Parisienne', family: 'var(--font-parisienne), "Brush Script MT", cursive', style: 'normal', weight: 400, scale: 1.25 },
  { key: 'great-vibes', label: 'Great Vibes', family: 'var(--font-great-vibes), "Brush Script MT", cursive', style: 'normal', weight: 400, scale: 1.35 },
  { key: 'pinyon', label: 'Pinyon Script', family: 'var(--font-pinyon), "Brush Script MT", cursive', style: 'normal', weight: 400, scale: 1.3 },
  { key: 'dancing', label: 'Dancing Script', family: 'var(--font-dancing), "Brush Script MT", cursive', style: 'normal', weight: 600, scale: 1.15 },
  { key: 'playfair', label: 'Playfair Display italique', family: 'var(--font-playfair), "Playfair Display", Georgia, serif', style: 'italic', weight: 500, scale: 1 },
  { key: 'cormorant', label: 'Cormorant italique', family: 'var(--font-cormorant), "Cormorant Garamond", Georgia, serif', style: 'italic', weight: 500, scale: 1.12 },
  { key: 'instrument-serif', label: 'Instrument Serif italique', family: 'var(--font-instrument-serif), Georgia, serif', style: 'italic', weight: 400, scale: 1.1 },
  { key: 'fraunces', label: 'Fraunces italique', family: 'var(--font-fraunces), Georgia, serif', style: 'italic', weight: 500, scale: 1 },
];

/** Texte courant : sans-serif nette, graisse « medium ». */
export const BODY_FONTS: BodyFont[] = [
  { key: 'inter', label: 'Inter', family: 'var(--font-inter), Inter, system-ui, sans-serif', weight: 500 },
  { key: 'manrope', label: 'Manrope', family: 'var(--font-manrope), Manrope, system-ui, sans-serif', weight: 500 },
  { key: 'dm-sans', label: 'DM Sans', family: 'var(--font-dm-sans), "DM Sans", system-ui, sans-serif', weight: 500 },
  { key: 'jakarta', label: 'Plus Jakarta Sans', family: 'var(--font-jakarta), "Plus Jakarta Sans", system-ui, sans-serif', weight: 500 },
  { key: 'instrument-sans', label: 'Instrument Sans', family: 'var(--font-instrument-sans), "Instrument Sans", system-ui, sans-serif', weight: 500 },
  { key: 'outfit', label: 'Outfit', family: 'var(--font-outfit), Outfit, system-ui, sans-serif', weight: 500 },
];

export const DEFAULT_TITLE = TITLE_FONTS[0];
export const DEFAULT_BODY = BODY_FONTS[0];
