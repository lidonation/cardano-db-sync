import type {Plugin} from '@docusaurus/types';

/** Site modules shared by two routes should not be copied into each page bundle.
 * Keep async loading and leave Docusaurus' single stylesheet and vendor grouping intact. */
export default function sharedCode(): Plugin {
  return {
    name: 'dbsync-shared-code',
    configureWebpack(config, isServer) {
      // B21 adds metadata without raising the locked payload caps. Keep Terser's safe
      // ECMA-5 settings; extra fixed-point passes remove bytes, not compatibility guards.
      if (!isServer)
        for (const minimizer of config.optimization?.minimizer ?? []) {
          if (!minimizer || typeof minimizer !== 'object') continue;
          const options = (
            minimizer as {
              options?: {
                minimizer?: {options?: {compress?: {ecma?: number; passes?: number} | false}};
              };
            }
          ).options?.minimizer?.options;
          if (options?.compress && options.compress.ecma === 5) options.compress.passes = 3;
        }
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
