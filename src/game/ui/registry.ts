// The list of menus by name. Kept in its own module so that menu files can register themselves at load.
import type { UI } from '../scenes/UI.ts';
import type { Menu } from './menu.ts';

type Maker = (ui: UI, arg?: string) => Menu | null;
const makers = new Map<string, Maker>();

export function register(name: string, make: Maker): void {
  makers.set(name, make);
}
export function makeOverlay(ui: UI, name: string, arg?: string): Menu | null {
  const make = makers.get(name);
  return make ? make(ui, arg) : null;
}
export function hasOverlay(name: string): boolean {
  return makers.has(name);
}
