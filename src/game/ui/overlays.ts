// Which menu opens for which name. The rules ask for menus by name ("craft", "mail", ...); keys open the rest.
// Each file in ./menus registers the names it handles (see registry.ts), so adding a menu never means editing this file.
import type { Menu } from './menu.ts';

export type Overlay = Menu;
export { hasOverlay, makeOverlay, register } from './registry.ts';

import.meta.glob('./menus/*.ts', { eager: true });
