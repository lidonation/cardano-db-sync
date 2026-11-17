/** Offline schema.org application-profile validator: every emitted type and nested structure.
 * No remote validator/network is needed in CI; unknown types fail closed. */
import {URL} from 'node:url';
import {load} from 'cheerio';
import {faqPageProblems} from './faq-jsonld.mjs';
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const TYPES = new Set([
  'TechArticle',
  'HowTo',
  'Dataset',
  'FAQPage',
  'DataFeed',
  'WebApplication',
  'SoftwareSourceCode',
  'WebPage',
  'BreadcrumbList',
]);
const absoluteUrl = (value) => {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
};
const date = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** Validate the supported schema.org subset, not merely JSON syntax. */
export function jsonLdProblems(data) {
  if (!object(data)) return ['JSON-LD must be an object'];
  const problems = [];
  const check = (valid, message) => {
    if (!valid) problems.push(message);
  };
  const field = (node, key, at = key) =>
    check(nonEmpty(node?.[key]), `${at} must be non-empty text`);
  const url = (value, at) =>
    check(absoluteUrl(value), `${at} must be an absolute HTTP(S) URL without credentials`);
  const list = (value, at, visit, allowEmpty = false) => {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      problems.push(`${at} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
      return;
    }
    value.forEach((node, i) => {
      if (!object(node)) problems.push(`${at}[${i}] must be an object`);
      else visit(node, `${at}[${i}]`, i);
    });
  };
  check(data['@context'] === 'https://schema.org', '@context must be https://schema.org');
  check(TYPES.has(data['@type']), 'unsupported @type');
  const type = data['@type'];
  if (type === 'BreadcrumbList') {
    list(data.itemListElement, 'itemListElement', (item, at, i) => {
      check(item['@type'] === 'ListItem', `${at} must be ListItem`);
      check(item.position === i + 1, `${at}.position must be sequential`);
      field(item, 'name', `${at}.name`);
      url(item.item, `${at}.item URL`);
    });
  } else if (type === 'FAQPage') {
    list(data.mainEntity, 'mainEntity', (question, at) => {
      check(question['@type'] === 'Question', `${at} must be Question`);
      field(question, 'name', `${at}.name`);
      check(question.acceptedAnswer?.['@type'] === 'Answer', `${at}.acceptedAnswer must be Answer`);
      field(question.acceptedAnswer, 'text', `${at}.acceptedAnswer.text`);
    });
  } else {
    field(data, 'name');
    field(data, 'description');
    url(data.url, 'url');
    if (type === 'TechArticle') field(data, 'headline');
    if (type === 'HowTo')
      list(data.step, 'step', (step, at) => {
        check(step['@type'] === 'HowToStep', `${at} must be HowToStep`);
        field(step, 'name', `${at}.name`);
        field(step, 'text', `${at}.text`);
      });
    if (type === 'Dataset')
      list(data.variableMeasured, 'variableMeasured', (variable, at) => {
        check(variable['@type'] === 'PropertyValue', `${at} must be PropertyValue`);
        field(variable, 'name', `${at}.name`);
      });
    if (type === 'SoftwareSourceCode') {
      url(data.codeRepository, 'codeRepository');
      field(data, 'programmingLanguage');
    }
    if (type === 'WebApplication') {
      field(data, 'applicationCategory');
      field(data, 'operatingSystem');
    }
    if (type === 'DataFeed' && data.dataFeedElement !== undefined)
      list(
        data.dataFeedElement,
        'dataFeedElement',
        (entry, at) => {
          check(entry['@type'] === 'DataFeedItem', `${at} must be DataFeedItem`);
          check(date(entry.dateCreated), `${at}.dateCreated must be an ISO date`);
          check(entry.item?.['@type'] === 'CreativeWork', `${at}.item must be CreativeWork`);
          field(entry.item, 'name', `${at}.item.name`);
          url(entry.item?.url, `${at}.item.url`);
        },
        true,
      );
  }
  if (data.version !== undefined) field(data, 'version');
  if (data.dateModified !== undefined)
    check(date(data.dateModified), 'dateModified must be an ISO date');
  return problems;
}

/** Every public content page has one content entity and one derived breadcrumb, with real copy. */
export function metadataProblems(html, expectedType) {
  const $ = load(html);
  const problems = [];
  const entities = [];
  $('script[type="application/ld+json"]').each((i, node) => {
    try {
      const data = JSON.parse($(node).text());
      entities.push(data);
      problems.push(...jsonLdProblems(data).map((error) => `JSON-LD[${i}]: ${error}`));
    } catch {
      problems.push(`JSON-LD[${i}]: invalid JSON`);
    }
  });
  const content = entities.filter((data) => data?.['@type'] !== 'BreadcrumbList');
  if (content.length !== 1)
    problems.push(`expected one content JSON-LD entity, got ${content.length}`);
  if (entities.filter((data) => data?.['@type'] === 'BreadcrumbList').length !== 1)
    problems.push('expected one BreadcrumbList');
  const entity = content[0];
  if (expectedType && entity?.['@type'] !== expectedType)
    problems.push(`expected content @type ${expectedType}`);
  if (!$('title').text().trim()) problems.push('missing title');
  const description = $('meta[name="description"]').attr('content');
  if (!nonEmpty(description)) problems.push('missing description');
  if ($('main h1').length !== 1) problems.push('CONTENT-4: expected exactly one h1');
  if (entity?.['@type'] === 'FAQPage') problems.push(...faqPageProblems(html));
  else if (entity) {
    if (entity.description !== description)
      problems.push('JSON-LD description differs from visible page metadata');
    if (!$('title').text().includes(entity.name)) problems.push('JSON-LD name differs from title');
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical && entity.url !== canonical) problems.push('JSON-LD URL differs from canonical');
  }
  return problems;
}
