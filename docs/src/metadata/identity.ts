import {SURFACES} from '../data/surfaces';
import type {ContentType} from './types';

export function contentType(route: string, doc: boolean, id = ''): ContentType {
  if (doc && id === 'guides/index') return 'WebPage';
  if (doc) return id === 'guides' || id.startsWith('guides/') ? 'HowTo' : 'TechArticle';
  if (route === '/') return 'SoftwareSourceCode';
  if (route === SURFACES.faq) return 'FAQPage';
  if (route === SURFACES.updates) return 'DataFeed';
  if (route === SURFACES.config) return 'WebApplication';
  if (route.startsWith(`${SURFACES.schema}/`)) return 'Dataset';
  return 'WebPage';
}
