/* global module */
// Docusaurus loads its TS configuration through jiti, which rewrites dynamic imports to require.
// This native CommonJS bridge keeps the import-only Pagefind Node API on Node's ESM loader.
module.exports = () => import('pagefind');
