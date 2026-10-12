import routes from '@generated/routes';
import useBaseUrl from '@docusaurus/useBaseUrl';

import {SURFACES, routeExists, routePaths, type Surface} from '../data/surfaces';

const PATHS = routePaths(routes);

/**
 * The path of a surface when this build serves it, else `undefined`: a page renders a surface's
 * link only once the surface exists, so nothing links to a page that is not there yet.
 */
export default function useSurface(): (surface: Surface) => string | undefined {
  const baseUrl = useBaseUrl('/');
  return (surface) =>
    routeExists(PATHS, baseUrl, SURFACES[surface]) ? SURFACES[surface] : undefined;
}
