/**
 * META-2 / META-10 for the FAQ page (B44-c): the page carries exactly one JSON-LD block, it is a
 * schema.org FAQPage, and every Question in it is one the page shows, with the answer it shows.
 * The general per-content-type validator is B21's; this holds the FAQ's promise until then.
 *
 * Pure: given the page's HTML, returns readable problems; an empty array means the page is sound.
 */

const LD_JSON = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

/** Decode the HTML entities React writes into text nodes. */
function decode(text) {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Visible text of the page: tags stripped, entities decoded, whitespace collapsed. */
function visibleText(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decode(body).replace(/\s+/g, ' ');
}

/**
 * Every reason the page's FAQPage structured data is invalid or does not match the page.
 *
 * @param {string} html the built page
 * @returns {string[]}
 */
export function faqPageProblems(html) {
  const blocks = [...html.matchAll(LD_JSON)].map((match) => match[1]);
  if (blocks.length !== 1) {
    return [`expected exactly one JSON-LD block, found ${blocks.length} (META-2)`];
  }
  let data;
  try {
    data = JSON.parse(blocks[0]);
  } catch (error) {
    return [`JSON-LD is not valid JSON: ${error.message}`];
  }
  const problems = [];
  if (data['@context'] !== 'https://schema.org') {
    problems.push(`@context must be https://schema.org, got ${JSON.stringify(data['@context'])}`);
  }
  if (data['@type'] !== 'FAQPage') {
    problems.push(`@type must be FAQPage, got ${JSON.stringify(data['@type'])}`);
  }
  if (!Array.isArray(data.mainEntity) || data.mainEntity.length === 0) {
    problems.push('mainEntity must be a non-empty array of Question');
    return problems;
  }
  const text = visibleText(html);
  const seen = new Set();
  data.mainEntity.forEach((question, index) => {
    const at = `mainEntity[${index}]`;
    if (question?.['@type'] !== 'Question') problems.push(`${at}: @type must be Question`);
    if (!nonEmpty(question?.name)) {
      problems.push(`${at}: name must be a non-empty string`);
      return;
    }
    if (seen.has(question.name)) problems.push(`${at}: duplicate question "${question.name}"`);
    seen.add(question.name);
    const answer = question.acceptedAnswer;
    if (answer?.['@type'] !== 'Answer' || !nonEmpty(answer?.text)) {
      problems.push(`${at}: acceptedAnswer must be an Answer with non-empty text`);
      return;
    }
    if (!text.includes(question.name))
      problems.push(`${at}: "${question.name}" is not on the page`);
    if (!text.includes(answer.text)) {
      problems.push(`${at}: the answer to "${question.name}" is not on the page`);
    }
  });
  return problems;
}
