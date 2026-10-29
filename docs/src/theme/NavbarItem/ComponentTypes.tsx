import DefaultNavbarItem from '@theme/NavbarItem/DefaultNavbarItem';
import DropdownNavbarItem from '@theme/NavbarItem/DropdownNavbarItem';
import LocaleDropdownNavbarItem from '@theme/NavbarItem/LocaleDropdownNavbarItem';
import DocsVersionDropdownNavbarItem from '@theme/NavbarItem/DocsVersionDropdownNavbarItem';

/**
 * The custom navbar renders section links, repository and search itself. Only the two
 * selectors use the stock dispatcher; their children use default links or dropdowns.
 * Do not eagerly ship the unused stock doc, sidebar, HTML and search implementations.
 */
export default {
  default: DefaultNavbarItem,
  dropdown: DropdownNavbarItem,
  localeDropdown: LocaleDropdownNavbarItem,
  docsVersionDropdown: DocsVersionDropdownNavbarItem,
};
