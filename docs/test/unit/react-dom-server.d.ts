/**
 * react-dom ships no TypeScript declarations in this tree (only `@types/react` is
 * installed, and node_modules is shared so adding `@types/react-dom` is out of scope).
 * This ambient declaration covers the one server renderer the dashboard unit test uses.
 * Remove it if `@types/react-dom` is ever added.
 */
declare module 'react-dom/server' {
  import type {ReactNode} from 'react';
  export function renderToStaticMarkup(element: ReactNode): string;
}
