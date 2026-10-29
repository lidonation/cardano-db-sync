import config from '../../../docusaurus.config';
import type * as Preset from '@docusaurus/preset-classic';

// Override only the content source in this isolated test build; public builds use the real docs.
const [preset, options] = config.presets![0] as [string, Preset.Options];
export default {
  ...config,
  presets: [[preset, {...options, docs: {...(options.docs || {}), path: 'test/fixtures/prism/docs'}}]],
};
