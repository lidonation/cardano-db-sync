import config from '../../../docusaurus.config';
import routeManifestPlugin from '../../../plugins/route-manifest';
import type * as Preset from '@docusaurus/preset-classic';

// Override only the content source in this isolated test build; public builds use the real docs.
const [preset, options] = config.presets![0] as [string, Preset.Options];
export default {
  ...config,
  // This disposable content set must not retire routes in the published manifest.
  plugins: config.plugins?.filter((plugin) => plugin !== routeManifestPlugin),
  presets: [[preset, {...options, docs: {...(options.docs || {}), path: 'test/fixtures/prism/docs'}}]],
};
