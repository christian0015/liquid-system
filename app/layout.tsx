import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { UIProvider, Backdrop } from '@/components/ui';
import '@/components/ui/core/ui.css';
import './globals.css';

// Typographie choisie pour le sujet : une grotesque nette pour l'interface, une mono pour les chiffres de rendu.
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Lumen — console de rendu',
  description: 'Démonstration du kit Liquid UI : verre à dispersion, gluant et glow.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050507',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <UIProvider config={{ theme: { base: '#2f4b8a', accent: '#ff9a4d' } }}>
          <Backdrop />
          {children}
        </UIProvider>
      </body>
    </html>
  );
}
