/** Only HTML emitted by reviewed CommonMark guides is reconstructed in the browser. */
export const GUIDE_TAGS = new Set(
  'a aside code div h1 h2 h3 h4 h5 h6 header hr li ol p pre strong em table tbody td th thead tr ul br blockquote del'.split(
    ' ',
  ),
);
export const GUIDE_ATTRS = new Set(
  'aria-label class data-kind href id lang rel tabindex target title translate'.split(' '),
);
