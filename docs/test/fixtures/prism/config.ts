import config from '../../../docusaurus.config';
import routeManifestPlugin, {recoveryMetadataPlugin} from '../../../plugins/route-manifest';
import type * as Preset from '@docusaurus/preset-classic';

// Override only the content source in this isolated test build; public builds use the real docs.
const [preset, options] = config.presets![0] as [string, Preset.Options];
export default {
  ...config,
  // This disposable content set must not retire routes in the published manifest.
  plugins: config.plugins?.map((plugin) => plugin === routeManifestPlugin ? recoveryMetadataPlugin : plugin),
  presets: [[preset, {...options, docs: {...(options.docs || {}), path: process.env.DBS_PRISM_DOCS ?? 'test/fixtures/prism/docs'}}]],
};
