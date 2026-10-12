import React from 'react';

import ThemeSwitcher from '@site/src/components/ThemeSwitcher';

/**
 * THM-1 (B30) — Docusaurus' colour-mode toggle, replaced by the four-palette switcher.
 *
 * Docusaurus renders this component in the navbar when `colorMode.disableSwitch` is
 * false. The props (`value`, `onChange`, the three-state light/dark/system model) belong
 * to that model and are intentionally ignored: the switcher owns the four palettes,
 * writes both `data-theme` and `data-dbs-palette`, and persists both, so the announced
 * state is never an ambiguous light/dark alone (A11Y-29).
 */
export default function ColorModeToggle(): React.JSX.Element {
  return <ThemeSwitcher />;
}
