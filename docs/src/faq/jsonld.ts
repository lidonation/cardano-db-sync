import type {FaqSection} from './questions';

/** The schema.org FAQPage for a set of FAQ sections (META-2): one Question per visible entry. */
export function faqPageJsonLd(sections: readonly FaqSection[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: sections.flatMap((section) =>
      section.items.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {'@type': 'Answer', text: item.answer},
      })),
    ),
  };
}

/**
 * JSON for a `<script type="application/ld+json">` body. `<` is escaped so no answer text can
 * close the script element early.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
