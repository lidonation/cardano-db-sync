/**
 * A11Y-18 — identifiers (`tx_out`, `consumed_by_tx_id`, config keys, `SMASH`) are English inside
 * translated prose. They are marked here, once, and every renderer that prints one spreads these
 * attributes: `lang` tells assistive tech the language, `translate="no"` keeps browser and
 * machine translation off them. Translators never have to remember to.
 */
export const IDENTIFIER_ATTRIBUTES = Object.freeze({lang: 'en', translate: 'no'} as const);
