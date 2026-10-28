import type { Metadata, Viewport } from 'next';
import { UIProvider, Backdrop } from '@/components/ui';
import '@/components/ui/core/ui.css';
import './globals.css';
import { DEFAULT_BODY, DEFAULT_TITLE, fontVariables } from './fonts';

export const metadata: Metadata = {
  title: 'Lumen — console de rendu',
  description: 'Démonstration du kit Liquid UI : verre à dispersion, gluant et huile sur l’eau.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0d12',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={fontVariables}>
      <body>
        <UIProvider
          config={{
            theme: { base: '#2f4b8a' },
            typography: {
              title: DEFAULT_TITLE.family,
              titleStyle: DEFAULT_TITLE.style,
              titleWeight: DEFAULT_TITLE.weight,
              titleScale: DEFAULT_TITLE.scale,
              body: DEFAULT_BODY.family,
              bodyWeight: DEFAULT_BODY.weight,
            },
          }}
        >
          <Backdrop />
          {children}
        </UIProvider>
      </body>
    </html>
  );
}
