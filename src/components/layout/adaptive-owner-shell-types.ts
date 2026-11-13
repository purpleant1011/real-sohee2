/**
 * Adaptive Owner Shell Types & Responsive Layout Helpers (ANI-1240)
 * 
 * Defines layout modes and guarantees across 4 breakpoints:
 * 1. Desktop (>= 1440px): 3-Pane Full Layout (Nav 240px + Center 1fr + Dock 380px)
 * 2. Laptop (1024 ~ 1439px): Compact Nav (64px) + Collapsible Dock (360px)
 * 3. Tablet (768 ~ 1023px): Center-First + Sticky Action Rail + Dock Sheet
 * 4. Mobile (375 ~ 767px): Bottom Tab Bar + Full-width Cards + Floating Bottom Sheet
 * 
 * Accessibility Guarantee: Minimum 44x44px touch target.
 */

export type ViewportWidth = number;

export type ShellBreakpoint =
  | 'DESKTOP_3PANE'
  | 'LAPTOP_COMPACT'
  | 'TABLET_CENTER_FIRST'
  | 'MOBILE_BOTTOM_NAV';

export type NavMode =
  | 'EXPANDED_SIDEBAR'
  | 'COMPACT_ICON_RAIL'
  | 'BOTTOM_TAB_BAR';

export type DockMode =
  | 'PERSISTENT_RIGHT_PANE'
  | 'COLLAPSIBLE_DRAWER'
  | 'BOTTOM_SHEET'
  | 'FLOATING_BOTTOM_SHEET';

export interface AdaptiveShellLayout {
  breakpoint: ShellBreakpoint;
  navMode: NavMode;
  dockMode: DockMode;
  navWidthPx?: number;
  dockWidthPx?: number;
  hasStickyDecisionRail?: boolean;
  isFullWidthCards?: boolean;
}

/**
 * Resolves the optimal adaptive shell layout configuration for a given viewport width.
 */
export function resolveAdaptiveShellLayout(width: ViewportWidth): AdaptiveShellLayout {
  // 1. Desktop (>= 1440px): 3-Pane Full
  if (width >= 1440) {
    return {
      breakpoint: 'DESKTOP_3PANE',
      navMode: 'EXPANDED_SIDEBAR',
      dockMode: 'PERSISTENT_RIGHT_PANE',
      navWidthPx: 240,
      dockWidthPx: 380,
    };
  }

  // 2. Laptop (1024 ~ 1439px): Compact Nav + Collapsible Dock
  if (width >= 1024) {
    return {
      breakpoint: 'LAPTOP_COMPACT',
      navMode: 'COMPACT_ICON_RAIL',
      dockMode: 'COLLAPSIBLE_DRAWER',
      navWidthPx: 64,
      dockWidthPx: 360,
    };
  }

  // 3. Tablet (768 ~ 1023px): Center-First + Sticky Action Rail + Dock Sheet
  if (width >= 768) {
    return {
      breakpoint: 'TABLET_CENTER_FIRST',
      navMode: 'COMPACT_ICON_RAIL',
      dockMode: 'BOTTOM_SHEET',
      hasStickyDecisionRail: true,
    };
  }

  // 4. Mobile (375 ~ 767px): Bottom Nav + Full-width Cards + Floating Bottom Sheet
  return {
    breakpoint: 'MOBILE_BOTTOM_NAV',
    navMode: 'BOTTOM_TAB_BAR',
    dockMode: 'FLOATING_BOTTOM_SHEET',
    isFullWidthCards: true,
  };
}

/**
 * Validates whether an interactive element meets WCAG 44x44px minimum touch target size.
 */
export function validateTouchTargetSize(widthPx: number, heightPx: number): boolean {
  return widthPx >= 44 && heightPx >= 44;
}
