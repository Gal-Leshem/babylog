import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';

/**
 * (owner bug) A sheet drawn inside a tab's scrolling area (`.main`) was covered by the tab bar on the iPhone: there
 * `-webkit-overflow-scrolling: touch` makes the scrolling area its own stacking layer, so no z-index inside it can rise above
 * the tab bar (Chromium ignores the property, so tests did not see it). Sheets opened from inside a screen are therefore drawn
 * in a layer of their own directly under <body>, like the forms that App draws.
 */
export function overlay(children: ComponentChildren): ComponentChildren {
  if (typeof document === 'undefined') return children;
  let host = document.getElementById('overlays');
  if (!host) {
    host = document.createElement('div');
    host.id = 'overlays';
    document.body.appendChild(host);
  }
  return createPortal(children as preact.VNode, host);
}
