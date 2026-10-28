/** Seul point d'import public du kit : `import { … } from '@/components/ui'`. */

// core
export { UIProvider, useUIConfig, DEFAULT_CONFIG } from './core/config';
export type { UIConfig, DeepPartial, Color, Radius, Tint, AppearName, HapticName, SoundName } from './core/config';
export { Backdrop } from './core/stage';
export { useFeedback } from './core/feedback';

// surfaces
export { Surface } from './surfaces/surfaces';
export type { SurfaceProps, MatterProps } from './surfaces/surfaces';

// overlays
export { Popup, Alert, Loader, useToast } from './overlays/overlays';
export type { PopupProps, AlertProps, AlertAction, AlertTone, LoaderProps, ToastOptions } from './overlays/overlays';
export { Drawer, useDrawer } from './overlays/drawer';
export type { DrawerProps } from './overlays/drawer';

// controls
export { Button, Switch, Slider, TextField, Tabs, Menu, Tooltip } from './controls/controls';
export type { ButtonProps, SwitchProps, SliderProps, TextFieldProps, TabsProps, TabItem, MenuProps, MenuItem, TooltipProps } from './controls/controls';

// data
export { Chart, Diagram } from './data/data';
export type { ChartProps, ChartRow, ChartSeries, DiagramProps, DiagramNode, DiagramLink } from './data/data';
