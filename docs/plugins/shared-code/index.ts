import type {Plugin} from '@docusaurus/types';

/** Site modules shared by two routes should not be copied into each page bundle.
 * Keep async loading and leave Docusaurus' single stylesheet and vendor grouping intact. */
export default function sharedCode(): Plugin {
  return {
    name: 'dbsync-shared-code',
    configureWebpack(_config, isServer) {
      return isServer
        ? {}
        : {
            optimization: {
              splitChunks: {
                cacheGroups: {
                  siteShared: {
                    name: 'site-shared',
                    test: /[/\\]src[/\\]/,
                    chunks: 'async',
                    minChunks: 2,
                    minSize: 0,
                    enforce: true,
                    priority: 45,
                  },
                },
              },
            },
          };
    },
  };
}
