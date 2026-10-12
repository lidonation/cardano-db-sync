import type {PropSidebarItem} from '@docusaurus/plugin-content-docs';

/**
 * The section the current page belongs to, for the "On this section" disclosure: the top-level
 * category holding the active page, or the whole sidebar when it has no categories (or the page is
 * not under one). Pure, so it is unit-tested without a build.
 */
export function currentSection(
  items: readonly PropSidebarItem[],
  isActive: (item: PropSidebarItem) => boolean,
): {readonly label: string | null; readonly items: readonly PropSidebarItem[]} {
  for (const item of items) {
    if (item.type === 'category' && isActive(item)) {
      return {label: item.label, items: item.items};
    }
  }
  return {label: null, items};
}
