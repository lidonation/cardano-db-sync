/** A Docusaurus version name must be exactly one safe path segment. */
export function versionSegment(version: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
    throw new Error(`Invalid documentation version: ${version}`);
  }
  return version;
}

/** The base URL includes the active locale and ends in a slash. */
export function bundlePath(baseUrl: string, version: string): string {
  return `${baseUrl}pagefind/${versionSegment(version)}/`;
}
