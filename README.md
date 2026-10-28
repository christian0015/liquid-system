# Liquid UI — kit UI premium pour Next.js

Ce fichier a deux rôles : c'est la **spécification de construction** (pour Claude Code) et la **documentation d'usage** (pour réutiliser le kit dans n'importe quel projet). Il est la source de vérité. Claude Code le met à jour dans la même modification que tout changement de composant, de prop ou de config.

---

## 0. Règles de travail pour Claude Code

1. **Tout construire en une seule passe**, complet et fonctionnel. Pas de v1/v2, pas de TODO, pas de composant « à venir ».
2. **Projet Next.js** (dernière version stable, App Router, TypeScript strict). Dépendances d'exécution : `next`, `react`, `react-dom` uniquement. Toute autre dépendance doit être justifiée dans ce README. Pas de three.js, pas de bibliothèque d'animation, pas de bibliothèque de style.
3. **Peu de fichiers.** Un dossier par catégorie/famille de composants (jamais par composant). Dans un dossier, le minimum de fichiers ; on regroupe les composants d'une même famille dans un même fichier tant qu'il reste lisible (repère : environ 500 lignes). On ne scinde qu'au-delà, et on le justifie dans l'arbre de la section 6. Aucun fichier inexpliqué.
4. **Le lexique des props est unique** (section 5.2). Une même fonction porte le même nom partout. Interdit : deux noms différents pour la même chose sur deux composants.
5. **Toutes les props sont optionnelles**, avec une valeur par défaut, souvent héritée de la config globale.
6. **Claude Code peut et doit ajouter** les paramètres et effets qui servent la qualité visuelle (la liste de ce README est un minimum, pas une limite). Tout ajout suit le lexique et est documenté ici.
7. **Vérifier avant de livrer** : `build` et `lint` passent, aucune erreur console, rendu contrôlé en 390 px et 1440 px, thème clair et sombre, `prefers-reduced-motion`, WebGL2 indisponible (repli), clavier. Détail en section 12.
8. Le design de l'app de démo suit une intention précise (section 10), pas les défauts génériques d'un template.

---

## 1. Vision

Un système d'interface **fermé** : le projet n'utilise que ces composants (alertes, popups, surfaces, tiroirs, notifications, chargements, contrôles, diagrammes). Il ne s'agit pas d'un thème mais d'un système de **formes et d'interactions** fluides, avec une sensation de shader.

Idée centrale : une fluidité **omni-forme**. Le liquide se mute et prend toutes les formes.

Ressenti visé : un Windows 12 boosté. Verre dépoli, reflets, interactions sensibles (visuelles, haptiques et sonores).

Trois matières signatures, qui s'adaptent à la charte de chaque projet :

| Matière | Description |
|---|---|
| **Gluant** | Liquide brillant et collant : fusion entre formes, cous de matière, résidus, tension de surface. |
| **Glow** | Halo lumineux autour des formes, diffusion douce, accent de couleur. |
| **Verre à dispersion** | Verre dépoli qui réfracte la lumière, avec franges chromatiques, reflets spéculaires, épaisseur, grain et micro-rayures. |

Référence visuelle (image d'inspiration) : un verre sombre en forme de lentille, avec réfraction forte, franges RGB sur les bords, reflets nets en bandes, rayures et poussière. Ce rendu vient surtout de l'**environnement lumineux** reflété par le verre (section 8).

---

## 2. Couleurs et thème

- Couleurs **100 % custom**, n'importe quelle couleur CSS, modifiables **à chaud** (sans remontage, transition douce de l'ordre de 400 ms).
- Un thème est défini par une couleur de base (`theme.base`). Le mode **clair ou sombre est déduit de sa luminance** (`theme.mode: 'auto'` par défaut, forçable). Le fond du kit, l'environnement lumineux et les couleurs de texte (contraste minimum 4,5:1 calculé automatiquement) suivent.
- Trois **rôles de couleur** traversent les trois matières :
  - `glue` : teinte du gluant,
  - `glass` : teinte de la dispersion du verre,
  - `glow` : accent du halo.
  Par défaut, les trois sont **dérivés de la couleur de base** (et d'un accent facultatif). Chacun est surchargeable globalement, par sous-arbre, ou par composant via la prop `tint`.
- Config **globale** (par défaut du projet) et **surcharge locale** : `UIProvider` imbriqués fusionnent leurs configs, les props de composant ont le dernier mot.

---

## 3. Animation signature : le popup liquide

Déclenchée par `Popup` (et réutilisée par `Alert`, `Menu`, `Toast`, `Drawer` selon `appear`) quand un `origin` (le bouton déclencheur) est fourni.

1. **Émergence** : le popup sort du bouton comme un liquide brillant et gluant (un blob avec un cou de matière qui le relie au bouton, reflet de surface).
2. **Transformation visible** : la forme **se transforme réellement** (interpolation de formes, pas un fondu enchaîné) jusqu'à épouser la forme du div cible : dimensions, rayons convexes **et concaves**. Le contenu apparaît quand la forme atteint environ 80 %.
3. **Résidu** : une partie du gluant **reste au bouton** (goutte ou filament). Elle **remonte vers le popup** en suivant une trajectoire courbe, puis **fusionne** (ondulation de surface à l'impact).

La fermeture fait le chemin inverse (le popup se rétracte dans son origine). Durées et amplitudes bornées par `fluidity` (section 5.1).

### 3.1 Coins concaves (« rayon négatif »)

- `radius` accepte un nombre ou 4 valeurs `[tl, tr, br, bl]`, en pixels. **Positif = convexe** (arrondi classique). **Négatif = concave** (coin creusé vers l'intérieur, comme une bouchée lissée).
- Le passage convexe ↔ concave est **animable** (ressort, traversée par 0 = coin vif).
- **Omni-forme** : `shape` vaut `'rect'` (défaut, rayons signés, ce qui couvre aussi pilule et cercle), `'ellipse'`, ou `{ path }` (chemin SVG quelconque, converti une fois en champ de distance puis mis en cache). Toute forme peut se transformer en toute autre par interpolation.
- La géométrie vit dans **un seul module** (`core/shape.ts`) qui alimente à la fois le shader, le `clip-path` CSS (qui découpe le contenu DOM aux mêmes contours, y compris aux coins concaves) et le repli sans WebGL.

### 3.2 Apparition randomisée

`appear="random"` tire parmi un **jeu défini** d'apparitions cohérentes, sans jamais répéter deux fois la même d'affilée. Jeu minimal : `ooze` (sort de l'origine, exige `origin`), `unfold`, `bloom`, `drip`, `ripple`, `melt`. Sans `origin`, `ooze` est exclu du tirage. Claude Code peut ajouter des apparitions. Défaut global : `motion.appear`.

---

## 4. Composants

Organisation en familles (justification des dossiers en section 6). Toutes les props du lexique (5.2) s'appliquent quand elles ont un sens. Les props ci-dessous sont celles propres au composant.

### surfaces
- **`Surface`** : le « div » du kit, base de toute matière (verre, gluant, glow). Props : `as`, `variant` (`flat | raised | inset`). Tous les autres composants sont construits sur cette surface.

### overlays
- **`Popup`** : contenu flottant qui sort d'un `origin`. Props : `origin`, `target` (optionnel : élément existant dont il prend la forme), `open`, `onOpenChange`, `appear`.
- **`Alert`** : dialogue modal de confirmation ou d'erreur, avec focus piégé. Props : `tone` (`info | success | warning | danger`), `title`, `actions`.
- **`Toast`** (notification) : gouttes empilées sur un bord de l'écran, disparition automatique. API impérative : `const toast = useToast(); toast({ title, tone, duration })`.
- **`Loader`** : chargement liquide. Props : `kind` (`blob | bar`), `progress` (0–1, absent = indéterminé).
- **`Drawer`** : tiroir **à tirer**, 4 côtés, avec points d'ancrage (snap). Il s'ouvre souvent **automatiquement après une action** (exemple : les commentaires TikTok). Il monte, s'ancre au premier palier, et l'utilisateur peut l'**élever encore** jusqu'aux paliers suivants.
  - `side` (`top | right | bottom | left`), `snap` (liste de pourcentages), `snapIndex` / `defaultSnapIndex`, `onSnapChange`, `dismissible`.
  - **Les pourcentages de `snap` portent sur l'axe de tirage** : hauteur pour `top` / `bottom`, largeur pour `left` / `right`. Exemple : `snap={[35, 70, 95]}`.
  - Gestes : poignée de tirage, élan (vitesse de relâchement → palier le plus proche), élasticité aux limites, arbitrage entre défilement interne et tirage (le contenu défile quand le tiroir est au dernier palier).
  - Ouverture par action : `const drawer = useDrawer(); drawer.open({ snapIndex: 0 })`.

### controls
- **`Button`** (origine naturelle du gluant), **`Switch`**, **`Slider`**, **`TextField`**, **`Tabs`**, **`Menu`** (s'ouvre avec le mécanisme du `Popup`), **`Tooltip`** (petite goutte). Claude Code peut compléter la base si un contrôle manque à l'app de démo.

### data
- **`Chart`** : `type` (`line | area | bar | donut`), `data`. Les séries héritent des couleurs du thème (palette dérivée de `theme.base`, ou fournie). Le glow peut s'appliquer aux traits.
- **`Diagram`** : nœuds et liens (flux, pipeline). Mêmes règles de couleur.

### core (exporté)
- **`UIProvider`**, **`useUIConfig`**, **`Backdrop`** (fond dessiné par le kit : `environment | gradient | image | video`).

### 4.1 Comportement liquide par composant

**Tous les composants interactifs reposent sur le gluant** (via `Surface`, avec la prop `glue` de 0 à 1). Les diagrammes sont l'exception : la lisibilité de la donnée prime, ils héritent des couleurs et du glow, pas du gluant. Chaque composant a un comportement liquide défini ; Claude Code peut l'enrichir.

| Composant | Comportement liquide |
|---|---|
| `Surface` | Au toucher ou au survol, la surface se creuse sous le pointeur et se referme (déformation élastique). Deux surfaces proches peuvent fusionner leur matière (`glue` élevé). |
| `Button` | À l'appui, déformation élastique et goutte qui suit le doigt ; au relâchement, retour avec rebond. Sert d'origine (`origin`) aux popups. |
| `Switch` | Le pouce est une goutte qui s'étire et fusionne avec la piste pendant le changement d'état. |
| `Slider` | Le pouce est une goutte ; la piste forme un cou de matière vers lui pendant le glissement. |
| `TextField` | Au focus, la bordure et le glow se propagent comme un liquide autour du champ. |
| `Tabs` | L'indicateur est une goutte qui s'étire d'un onglet à l'autre, puis se rétracte. |
| `Menu`, `Tooltip` | Sortent de leur déclencheur avec le mécanisme du popup (le tooltip en petite goutte). |
| `Popup`, `Alert` | Animation signature complète (section 3). |
| `Toast` | Gouttes qui sortent d'un bord, s'étirent et fusionnent quand elles s'empilent. |
| `Loader` | Blob ou barre liquide, fusion et séparation continues. |
| `Drawer` | Bord en ménisque qui se tend pendant le tirage ; à la fermeture, la matière se détache de la poignée puis se résorbe. |
| `Chart`, `Diagram` | Pas de gluant. Les changements de données se font par interpolation de formes (barres, courbes, parts) ; couleurs et glow hérités du thème. |

---

## 5. Configuration

### 5.1 Config globale

Fournie à `UIProvider`, modifiable à chaud avec `useUIConfig()`. Tout est optionnel.

```ts
type UIConfig = {
  theme: {
    base: Color;                              // n'importe quelle couleur CSS
    mode: 'auto' | 'light' | 'dark';          // 'auto' = déduit de la luminance de base
    accent?: Color;
    glue?: Color; glass?: Color; glow?: Color; // surcharge des rôles (sinon dérivés)
  };
  fluidity: { min: number; max: number };     // vitesses min et max, en multiplicateurs de la durée de référence
  material: {
    glue: number; glow: number; reactive: number; // 0–1
    radius: number | [number, number, number, number]; // négatif = concave
  };
  light: {                                    // déformation de la lumière (section 8)
    refraction: number; dispersion: number; specular: number;
    fresnel: number; thickness: number; grain: number; frost: number;
    environment: 'studio' | 'soft' | 'neon' | 'custom';
  };
  motion: { appear: AppearName | 'random'; respectReducedMotion: boolean };
  quality: { maxDpr: number; margin: number; adaptive: boolean }; // margin en px autour du viewport
  haptics: { enabled: boolean; intensity: number };               // désactivé par défaut
  audioUi: { enabled: boolean; volume: number };                  // désactivé par défaut
};
```

- **Fluidité réglable** : `fluidity.min` est la vitesse la plus lente autorisée, `fluidity.max` la plus rapide. La prop `speed` (0–1) choisit une valeur dans cette plage. Les animations utilisent des **ressorts** (raideur/amortissement dérivés de la vitesse) plutôt que des durées fixes, pour un rendu vivant.
- Changement à chaud : `setConfig({ theme: { base: '#...' } })`. Les uniformes shader se mettent à jour sans remontage ; la transition est animée.

### 5.2 Lexique unique des props

Ces noms sont réservés. Même nom = même sens sur tous les composants. Toutes optionnelles.

| Prop | Type | Sens |
|---|---|---|
| `tint` | `Color \| { glue?, glass?, glow? }` | Couleur(s) du composant. Défaut : thème. |
| `glue` | `number` 0–1 | Viscosité et fusion du gluant. |
| `glow` | `number \| boolean` | Intensité du halo. |
| `dispersion` | `number` 0–1 | Dispersion chromatique du verre. |
| `refraction` | `number` 0–1 | Déformation de la lumière. |
| `specular`, `fresnel`, `grain`, `frost` | `number` 0–1 | Paramètres de lumière (section 8). |
| `thickness` | `number` (px) | Épaisseur du verre. |
| `shape` | `'rect' \| 'ellipse' \| { path: string }` | Forme de base (défaut `'rect'`). |
| `radius` | `number \| [tl,tr,br,bl]` | Rayons en px. Négatif = concave. |
| `speed` | `number` 0–1 | Position dans la plage `fluidity`. |
| `reactive` | `number` 0–1 | Sensibilité de la matière au pointeur ou au doigt : reflets et glow qui suivent, déformation au toucher. Défaut global : `material.reactive`. |
| `appear` | `AppearName \| AppearName[] \| 'random'` | Mode d'apparition. |
| `origin` | `RefObject \| DOMRect \| {x,y}` | D'où sort l'élément. |
| `target` | `RefObject` | Élément dont on prend la forme. |
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` | Côté d'ancrage. |
| `snap` | `number[]` | Paliers en % de l'axe de tirage. |
| `open`, `defaultOpen`, `onOpenChange` | | État d'ouverture (contrôlé ou non). |
| `size` | `'sm' \| 'md' \| 'lg'` | Taille. |
| `disabled` | `boolean` | Désactivé. |
| `haptics` | `boolean \| HapticName` | Choisit ou coupe le retour haptique **de ce composant**. N'a d'effet que si `haptics.enabled` est vrai globalement. |
| `audioUi` | `boolean \| SoundName` | Idem pour le son. |
| `className`, `style` | | Standard. |

Une nouvelle prop doit d'abord vérifier qu'aucun nom du lexique ne couvre déjà le besoin.

---

## 6. Architecture

```
/
├─ README.md                      # ce fichier
├─ package.json  tsconfig.json  next.config.ts
├─ components/ui/
│  ├─ index.ts                    # seul point d'import public : tout est exporté d'ici
│  ├─ core/                       # moteur : tout ce que les composants partagent
│  │  ├─ config.tsx               # types UIConfig + défauts, UIProvider, useUIConfig, dérivation du thème (luminance, rôles, contraste)
│  │  ├─ stage.tsx                # canvas WebGL2 partagé, Backdrop, registre des formes, boucle de rendu, culling, DPR adaptatif
│  │  ├─ shaders.ts               # GLSL : SDF, gluant, glow, verre, environnement lumineux
│  │  ├─ shape.ts                 # géométrie unique : rayons signés, interpolation de formes, clip-path, repli CSS
│  │  ├─ motion.ts                # ressorts, plage fluidity, jeu d'apparitions et tirage aléatoire
│  │  ├─ feedback.ts              # haptics + audioUi (sons synthétisés)
│  │  └─ ui.css                   # variables CSS et styles de repli
│  ├─ surfaces/surfaces.tsx       # Surface
│  ├─ overlays/
│  │  ├─ overlays.tsx             # Popup, Alert, Toast, Loader (même cycle ouverture/fermeture/morph)
│  │  └─ drawer.tsx               # Drawer (logique de gestes et de paliers distincte)
│  ├─ controls/controls.tsx       # Button, Switch, Slider, TextField, Tabs, Menu, Tooltip
│  └─ data/data.tsx               # Chart, Diagram
└─ app/                           # app de démo (section 10)
   ├─ layout.tsx  page.tsx  globals.css
   └─ preferences/page.tsx
```

Justification des dossiers : `core` = ce qui n'est pas un composant ; `surfaces` = la base de toute matière ; `overlays` = tout ce qui apparaît, s'ancre et disparaît au-dessus de la page ; `controls` = ce avec quoi on agit (le bouton est l'origine du gluant) ; `data` = ce qui dessine de la donnée. Claude Code **met à jour cet arbre et ces justifications** si la structure change, et ne crée un nouveau dossier ou fichier que pour une contrainte réelle.

Règles :
- `shape.ts`, `motion.ts` et la dérivation du thème dans `config.tsx` sont du **TypeScript pur** (sans API DOM), pour faciliter un futur portage React Native.
- Tous les composants sont des composants client (`'use client'`). Le rendu serveur produit d'abord la **version CSS de repli** de chaque surface, que le canvas remplace en fondu au montage (pas de saut visuel, pas d'erreur d'hydratation).
- Aucun style inline répétitif : variables CSS dans `ui.css`.

---

## 7. Moteur de rendu et performance

**Principe : un seul canvas WebGL2 partagé** (position fixe, derrière le contenu des surfaces, au-dessus du fond de page). Toute la matière (gluant, glow, verre) y est dessinée ; le texte et les contrôles restent du **vrai DOM** par-dessus (sélectionnables, accessibles, indexables). Le fond de page est le `Backdrop` du kit : le verre réfracte ce fond et l'environnement lumineux du kit, pas le texte DOM situé derrière lui.

Chaque composant s'enregistre auprès du `Stage` avec sa forme et ses paramètres matière. **Pas de déformation du DOM** : on n'applique aucun filtre de déformation sur le texte ou les éléments du DOM.

**Performance sans réduire l'impact visuel** :
- **Rendu à la demande** : aucune image dessinée tant que rien ne bouge (0 coût au repos). Pause quand l'onglet est caché.
- **Calcul ciblé** : seules les formes qui intersectent le viewport **élargi de `quality.margin`** sont dessinées. Chaque forme est dessinée dans sa zone englobante + marge, pas en plein écran.
- **Caches** : programmes shader compilés une fois ; géométries et cartes dérivées d'une forme mises en cache selon une clé de géométrie ; texture d'environnement reconstruite uniquement au changement de thème ou de `light.environment` ; uniformes mis à jour seulement si leur valeur change ; fonctions de calcul pures mémoïsées.
- **Résolution adaptative** : `quality.maxDpr` (2 par défaut) ; si le temps d'image dépasse le budget sur plusieurs images, la résolution baisse par paliers puis remonte quand c'est stable. **Aucun effet n'est coupé automatiquement.**
- `IntersectionObserver` pour l'enregistrement, `ResizeObserver` pour les formes. Perte de contexte WebGL gérée.
- **Synchronisation canvas/DOM** : les éléments fixes (`Popup`, `Alert`, `Toast`, `Drawer`, `Tooltip`) n'ont aucun décalage de scroll. Pour les surfaces dans un contenu qui défile, les positions sont relues à chaque image et le décalage de scroll est lu dans la même image que le dessin. Documenter dans ce README tout écart résiduel observé sur mobile.
- **Repli sans WebGL2** : rendu CSS (flou dépoli `backdrop-filter`, ombres, `clip-path` issu de `shape.ts`), sans erreur.

---

## 8. Déformation de la lumière

Paramètres du verre (config globale `light` et props du lexique) :

| Paramètre | Effet |
|---|---|
| `refraction` | Courbure de la lumière traversant le verre (selon l'épaisseur et le profil du bord). |
| `dispersion` | Séparation chromatique par canal (franges RGB sur les bords). |
| `specular` | Reflets nets en bandes, issus de l'environnement. |
| `fresnel` | Renforcement des reflets aux angles rasants. |
| `thickness` | Épaisseur : pilote l'intensité de la déformation au bord. |
| `grain` | Micro-rayures et poussière (texture de normales procédurale). |
| `frost` | Dépoli (flou) derrière le verre. |
| `environment` | Environnement lumineux **procédural** (bandes de studio, doux, néon), teinté par le thème. C'est lui qui donne les reflets de l'image de référence. |

Claude Code peut ajouter d'autres paramètres (aberration anamorphique, caustiques, iridescence…) en suivant le lexique.

---

## 9. Retour sensoriel

Deux options de config, **désactivées par défaut**. Un interrupteur global coupé coupe tout, quelle que soit la prop d'un composant.

### `haptics` (vibrations de l'appareil)
- Android : `navigator.vibrate()`. iPhone : Safari ignore cette API ; on utilise le détournement d'un `<input type="checkbox" switch>` masqué dont on déclenche le clic (comportement non standard, à encadrer par détection de fonctionnalité et `try/catch`). Sur ordinateur : aucune action, aucune erreur.
- Sur iPhone, le retour est une suite de tics simples ; l'intensité fine n'est pas contrôlable. Doit être déclenché dans un geste utilisateur.
- Motifs nommés : `tick`, `soft`, `confirm`, `warn`. Association aux événements (détachement du gluant, fusion, snap du tiroir, ouverture, alerte, validation). `intensity` règle la durée et la force quand c'est possible.

### `audioUi` (sons fx doux de motion design)
- Sons **synthétisés** avec la Web Audio API (oscillateurs, bruit filtré, enveloppes), sans fichier audio, courts (environ 300 ms maximum), doux (filtre passe-bas, gain bas), avec une légère variation aléatoire de hauteur.
- Le contexte audio est créé et activé au **premier geste utilisateur** (les navigateurs bloquent l'audio avant). Initialisation paresseuse : si l'option est désactivée, aucun code audio ne s'exécute.
- `volume` global. Limitation de cadence pour éviter la saturation. Sons nommés : `pop`, `ooze`, `merge`, `snap`, `tick`, `soft-alert`, `confirm`.
- Chaque composant peut choisir ou couper son son via la prop `audioUi`.

---

## 10. App de démonstration (`app/`)

But : **valider** le kit. Chaque composant exporté y apparaît au moins une fois, dans un contexte qui a du sens pour ce style.

**Concept proposé** : la console d'un studio de rendu et d'effets visuels. Le sujet porte naturellement le verre, la lumière et le liquide (projets, files de rendu, pipeline). Claude Code peut proposer un concept meilleur et le documenter ici.

Contenu minimum :
- **`/` (console)** : grille de projets (`Surface`), file de rendu avec `Loader` et `Toast` à la fin d'un rendu, pipeline en `Diagram`, courbes d'activité en `Chart`, `Menu` et `Popup` ouverts depuis des `Button` (animation signature), `Alert` de confirmation (suppression d'un projet), `Drawer` de commentaires ouvert par une action (bas, paliers 35/70/95 %), `Tabs`, `Switch`, `Slider`, `TextField`, `Tooltip`.
- **`/preferences`** : éditeur en direct de la config (sélecteur de couleur de thème à chaud, curseurs `fluidity.min` / `fluidity.max`, paramètres de lumière, `glue`, `glow`, rayon avec démonstration convexe ↔ concave, `quality`), interrupteurs et réglages `haptics` (intensité) et `audioUi` (volume), bouton de réinitialisation. **`haptics` et `audioUi` y sont désactivés par défaut.**

Principes de design de la démo : une seule chose mémorable (l'animation signature du popup liquide), le reste sobre ; typographie choisie délibérément via `next/font` (pas la valeur par défaut du template) ; textes d'interface courts, à la voix active, en français, avec une action nommée de la même façon dans tout le parcours ; pas de grille de cartes identiques sans hiérarchie, pas de décoration qui ne sert pas le sujet. Le thème doit rester fonctionnel avec n'importe quelle couleur de base (tester une base claire et une base sombre).

---

## 11. Utilisation dans un projet

1. Copier le dossier `components/ui` dans le projet (ou partir de ce projet Next zippé, sans `.next` ni `node_modules`).
2. Envelopper l'app :

```tsx
// app/layout.tsx
import { UIProvider, Backdrop } from '@/components/ui';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <UIProvider config={{ theme: { base: '#3a2cff' } }}>
          <Backdrop />   {/* fond dessiné par le kit : le verre le réfracte */}
          {children}
        </UIProvider>
      </body>
    </html>
  );
}
```

3. Utiliser les composants. Tout est optionnel :

```tsx
'use client';
import { useRef, useState } from 'react';
import { Button, Popup, Surface, Drawer, useToast, useDrawer } from '@/components/ui';

export function Example() {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const drawer = useDrawer();

  return (
    <>
      <Button ref={btn} onClick={() => setOpen(true)}>Options</Button>
      <Popup origin={btn} open={open} onOpenChange={setOpen} appear="random" radius={[28, 28, -18, 28]}>
        <Surface glow={0.6} dispersion={0.4}>Contenu</Surface>
      </Popup>

      <Button onClick={() => toast({ title: 'Rendu terminé', tone: 'success' })}>Notifier</Button>
      <Button onClick={() => drawer.open({ snapIndex: 0 })}>Commentaires</Button>
      <Drawer side="bottom" snap={[35, 70, 95]}>…</Drawer>
    </>
  );
}
```

4. Changer le thème à chaud :

```tsx
const [config, setConfig] = useUIConfig();
setConfig({ theme: { base: '#ffb36b' } });                 // le mode clair/sombre se recalcule
setConfig({ fluidity: { min: 0.6, max: 1.4 } });
setConfig({ haptics: { enabled: true, intensity: 0.5 } });
```

5. Adapter à la charte d'un projet : définir `theme.base` (et éventuellement `accent`, `glue`, `glass`, `glow`), puis les valeurs par défaut de `material` et `light`. Aucun composant à modifier.

Cette section est la **référence d'usage** : Claude Code la complète avec la liste finale des composants, de leurs props propres et des exemples, et la garde à jour.

---

## 12. Critères de validation avant livraison

- [ ] `build` et `lint` passent, TypeScript strict sans `any` (hors typages WebGL justifiés).
- [ ] Aucune erreur ni avertissement console, aucun décalage de mise en page au chargement, aucune erreur d'hydratation.
- [ ] Animation signature complète : émergence, transformation visible, résidu qui remonte et fusionne ; ouverture et fermeture.
- [ ] Coins concaves : animation convexe ↔ concave fluide ; le contenu DOM est bien découpé au contour.
- [ ] `fluidity.min` et `fluidity.max` produisent une différence visible ; thème modifiable à chaud ; base claire et base sombre lisibles (contraste).
- [ ] Au repos, aucune image n'est dessinée ; hors viewport + marge, rien n'est dessiné.
- [ ] Repli correct sans WebGL2 ; `prefers-reduced-motion` respecté ; clavier et focus visibles ; rôles ARIA, focus piégé dans `Alert`, fermeture avec Échap.
- [ ] `haptics` et `audioUi` désactivés par défaut, fonctionnels une fois activés, sans erreur sur ordinateur.
- [ ] Chaque composant exporté est utilisé dans l'app de démo ; lexique des props respecté partout.
- [ ] Nombre de fichiers minimal et arbre de la section 6 à jour.

---

## 13. Livraison et maintenance

- Livrable : le **projet Next complet zippé, sans `.next` ni `node_modules`**, avec ce README (la doc d'usage). C'est ce zip qu'on donne à un nouveau projet.
- Commande de référence : `zip -r liquid-ui.zip . -x ".next/*" "node_modules/*" ".git/*"`.
- À chaque modification de composant, de prop, de config ou de structure, **mettre à jour ce README dans le même changement** (sections 4, 5, 6, 11 en priorité) et ajouter une ligne au journal ci-dessous.

### Hors périmètre

- Pas de version React Native pour l'instant (elle viendra après le web ; d'où le cœur en TypeScript pur).
- Pas de PWA dans le kit : c'est un sujet propre à chaque projet.
- Pas de réfraction du contenu DOM ni de déformation du texte.

### Journal des changements

- Version initiale : kit complet (core, surfaces, overlays, controls, data), app de démo, `haptics` et `audioUi`.
- Ajouts avant construction : comportement liquide défini pour chaque composant (4.1), `shape` (omni-forme), `reactive` (interactions sensibles).

---

## Variante « Prisme »

Copie de la v2 avec un autre rendu de matière. Le moteur (bande de canvas dans le document, redessin partiel, mouvement ambiant) est inchangé.

- **Fond d'application** : noir (thème sombre) ou blanc cassé (thème clair), uni, selon `theme.mode`. Le fond uni ne donne rien à réfracter : l'aspect vient de la lumière de l'environnement.
- **Lentille de verre** : intérieur clair, bords réfractifs avec dispersion prononcée (trois indices de réfraction), bandes lumineuses franches, comme une lentille de banc d'optique. Sur fond clair, le verre filtre la lumière au lieu de l'ajouter.
- **Huile sur l'eau** : un film mince visqueux (bandes d'interférence) dérive lentement à l'intérieur ; les bordures restent fixes. Réglage : `light.iridescence` (0 = aucun film) et `motion.ambient` (vitesse/présence du mouvement).
- **Couleurs** : les bandes de lumière, les franges et le film d'huile sont dérivés de la couleur du thème (`theme.base`, `theme.accent`, `glue`, `glass`, `glow`) : un thème personnalisé recolore tout.
- Défauts changés : `dispersion: 1`, `refraction: 0.8`, `iridescence: 0.55`, `frost: 0.15`, `thickness: 16`, `glow: 0.12`.

## Notes d'implémentation (v2, valables pour cette variante)

### Lancer le projet

```bash
npm install
npm run dev      # http://localhost:3000 — console de rendu ; /preferences — éditeur de config en direct
npm run build
```

### Architecture de rendu (changements de la v2)

- **Plus de décalage entre le texte et la matière.** La couche `page` est une bande de canvas (≈ 3 écrans de haut) posée **dans le document** : elle défile avec le contenu à la vitesse du compositeur, donc sans aucun retard. Elle est recentrée quand l'écran approche de ses bords. Le fond est lui aussi ancré au document (il défile avec la page, en tuiles miroir).
- **Deux canvas restent nécessaires** : la bande de la page (sous le contenu) et une couche fixe pour la matière des overlays (popup, tiroir, toast), qui doit passer au-dessus du texte de la page. Le contenu d'un overlay est fixe lui aussi : matière et texte bougent dans la même image.
- **Redessin partiel** : seuls les éléments dont l'image change sont redessinés (empreinte par élément, rectangle sale, `preserveDrawingBuffer`).
- **Mouvement ambiant** (`motion.ambient`, 0–1, défaut 0.55) : l'environnement lumineux tourne lentement, la lumière du gloss dérive, un écoulement visqueux module l'intérieur. **Les bordures ne bougent pas.** Image cadencée à ≈ 30 i/s, uniquement pour ce qui est à l'écran ; coupé en mouvement réduit et quand l'onglet est caché. `ambient: 0` rend le kit totalement inactif au repos (zéro image).
- **Matière** : verre optique (réfraction du fond et de l'environnement vu à travers le chanfrein, dispersion par canal), gluant visqueux (relief en coussin, teinte plus dense au centre, deux lobes de gloss), profil de relief à courbure continue (plus de trait intérieur le long des bords).
- **Coin concave** : le disque retiré a maintenant des raccords arrondis (plus de pointes) ; le contour DOM suit exactement le même tracé. La démo n'en utilise plus ; `/preferences` permet de le régler.
- **Animation du popup** : le déclencheur « se lève » avec sa propre forme, un filament fin le relie au corps puis se rétracte, une petite goutte remonte et fusionne avec une ondulation légère. Ressort plus doux (≈ 0,6 s).

### Vérifié

- Bundle complet (esbuild) sans erreur ni avertissement ; contrôle TypeScript strict de notre code avec des types React minimaux.
- Rendu WebGL2 réel dans Chromium (rendu logiciel SwiftShader).
- Bande dans le document : le canvas se déplace exactement avec le défilement ; aucun dessin pendant un défilement qui reste dans la bande ; recentrage correct après un grand défilement.
- Mouvement ambiant : l'intérieur des surfaces change dans le temps, le fond et le contour extérieur restent identiques.
- Repli sans WebGL2 : page complète en CSS, sans erreur. Mouvement réduit : tout s'arrête net. Thèmes clair et sombre lisibles.

### Non vérifié (à faire chez vous)

- `next build` et `npm run lint` : pas de réseau dans l'environnement de construction, donc pas de `npm install`. Les types de Next et de `@types/react` n'ont pas été contrôlés.
- **Fluidité réelle** : tout a été testé en rendu logiciel (≈ 1 à 30 s par image selon la scène). La forme de l'animation du popup a été vue image par image, pas son rythme. Le coût par image sur GPU réel, iPhone et Android (résolution adaptative, ambiant à 30 i/s) reste à mesurer.
- Haptique et sons sur appareil réel.
- Polices `next/font/google` : téléchargées au premier build (réseau requis).
- Défilement horizontal du document, éléments `position: fixed` ou `sticky` dans la page : non gérés par la bande (utiliser un overlay).

### Écarts avec la spécification

- Deux canvas (voir plus haut). `useToast` monte son hôte tout seul. La fusion de matière ne concerne que des surfaces voisines et disjointes, continue à partir de `glue = 0.5`.
- Ajouts à la config : `light.iridescence`, `material.radius` (négatif = coin concave), `motion.ambient`.
- Props hors lexique : `value/onValueChange` (Slider, Tabs), `checked/onCheckedChange` (Switch), `open/onOpenChange` (Popup, Alert, Drawer, Menu), `items` (Menu, Tabs), `onFrame` (avancé).

### Dépannage

- Pas de verre : `data-lq-gl` sur `<html>` présent = WebGL2 actif ; absent = repli CSS.
- Trop gourmand : baisser `motion.ambient` (ou 0), `quality.maxDpr`, ou laisser `quality.adaptive` à `true`.
- Aucun son : l'audio exige un geste utilisateur, et `audioUi.enabled` vaut `false` par défaut.
- Aucune vibration sur iPhone : `navigator.vibrate` n'existe pas sur Safari ; le kit tente un détournement non standard qui peut ne pas fonctionner selon la version d'iOS.
