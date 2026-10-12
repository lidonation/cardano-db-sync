import React from 'react';

import {useColorMode} from '@docusaurus/theme-common';

import ThemeSwitcher from '@site/src/components/ThemeSwitcher';

/**
 * THM-1 (B30) — Docusaurus' colour-mode toggle, replaced by the four-palette switcher.
 *
 * Docusaurus renders this component in the navbar when `colorMode.disableSwitch` is
 * false. Palette choices also update the framework provider, which drives Prism
 * and the OS-preference listener. The palette attribute remains the four-state source.
 */
export default function ColorModeToggle(): React.JSX.Element {
  const {setColorMode} = useColorMode();
  return <ThemeSwitcher onChangeTheme={setColorMode} />;
}
