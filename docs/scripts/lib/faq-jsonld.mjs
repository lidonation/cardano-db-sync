/**
 * META-2 / META-10 for the FAQ page (B44-c): the page carries exactly one JSON-LD block, it is a
 * schema.org FAQPage, and every Question in it is one the page shows, with the answer it shows.
 * The general per-content-type validator is B21's; this holds the FAQ's promise until then.
 *
 * Pure: given the page's HTML, returns readable problems; an empty array means the page is sound.
 */

import {load} from 'cheerio';

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Every reason the page's FAQPage structured data is invalid or does not match the page.
 *
 * @param {string} html the built page
 * @returns {string[]}
 */
export function faqPageProblems(html) {
  const $ = load(html);
  const blocks = $('script[type="application/ld+json"]')
    .map((_, node) => $(node).text())
    .get();
  if (blocks.length !== 1) {
    return [`expected exactly one JSON-LD block, found ${blocks.length} (META-2)`];
  }
  let data;
  try {
    data = JSON.parse(blocks[0]);
  } catch (error) {
    return [`JSON-LD is not valid JSON: ${error.message}`];
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return ['JSON-LD must be an object'];
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
  // Closed details are user-expandable content. Hidden nodes and non-FAQ text do not count.
  $('script, style, template, [hidden], [aria-hidden="true"]').remove();
  const shown = new Map();
  $('main details').each((_, node) => {
    const detail = $(node);
    const name = normalize(detail.children('summary').text());
    const answer = normalize(detail.children('p').first().text());
    if (!name || !answer) problems.push('visible FAQ entry must have a question and answer');
    if (shown.has(name)) problems.push(`duplicate visible question "${name}"`);
    shown.set(name, answer);
  });
  const seen = new Set();
  data.mainEntity.forEach((question, index) => {
    const at = `mainEntity[${index}]`;
    if (question?.['@type'] !== 'Question') problems.push(`${at}: @type must be Question`);
    if (!nonEmpty(question?.name)) {
      problems.push(`${at}: name must be a non-empty string`);
      return;
    }
    const name = normalize(question.name);
    if (seen.has(name)) problems.push(`${at}: duplicate question "${question.name}"`);
    seen.add(name);
    const answer = question.acceptedAnswer;
    if (answer?.['@type'] !== 'Answer' || !nonEmpty(answer?.text)) {
      problems.push(`${at}: acceptedAnswer must be an Answer with non-empty text`);
      return;
    }
    if (!shown.has(name)) {
      problems.push(`${at}: "${question.name}" is not on the page`);
    } else if (shown.get(name) !== normalize(answer.text)) {
      problems.push(`${at}: the answer to "${question.name}" does not match its visible answer`);
    }
  });
  for (const name of shown.keys()) {
    if (!seen.has(name)) problems.push(`visible question "${name}" is missing from JSON-LD`);
  }
  return problems;
}
