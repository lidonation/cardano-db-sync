import path from 'node:path';

import type {LoadContext, Plugin} from '@docusaurus/types';

/** The classic theme's client module loads Prism on every page, even without code blocks. */
export default function lazyPrism(context: LoadContext): Plugin {
  return {
    name: 'dbsync-lazy-prism',
    configureWebpack(_config, _isServer, {currentBundler}) {
      return {
        plugins: [
          new currentBundler.instance.NormalModuleReplacementPlugin(
            /@docusaurus[\\/]theme-classic[\\/]lib[\\/]prism-include-languages$/,
            path.resolve(context.siteDir, 'plugins/lazy-prism/empty.js'),
          ),
        ],
      };
    },
  };
}
