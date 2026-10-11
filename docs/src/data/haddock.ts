/**
 * The committed Haddock annotations artifact — the data layer B07 extracts
 * from the Haskell sources (CON-1).
 *
 * The artifact is produced by `docs/extractor` (`extract-haddock`, driven by
 * the `extract-haddock` workflow) and committed under `generated/`. Nothing
 * here reads the Haskell tree at build time: `npm run build` succeeds on a
 * machine with no GHC or cabal present, because this file consumes a
 * committed JSON document and nothing else.
 *
 * Regenerate after touching Haskell documentation in `cardano-db/src` (or the
 * extractor) by running the workflow, or locally:
 *
 *     cd docs/extractor && cabal run extract-haddock -- \
 *       --repo-root ../.. --out ../generated/haddock-annotations.json --input ../../cardano-db/src
 *
 * The shape mirrors `HaddockExtract.Model`; `check:annotations` verifies the
 * committed file against the same rules.
 */
import artifact from '../../generated/haddock-annotations.json';

/** What kind of declaration an annotation documents. */
export type AnnotationKind =
  | 'data'
  | 'newtype'
  | 'type-synonym'
  | 'type-family'
  | 'data-family'
  | 'class'
  | 'function'
  | 'binding'
  | 'signature'
  | 'instance'
  | 'foreign'
  | 'class-method'
  | 'section'
  | 'named';

/** Where the annotation sat relative to the declaration. */
export type AnnotationPosition = 'before' | 'after' | 'section' | 'named';

/** A documented record field, carried by its constructor. */
export interface AnnotationField {
  name: string;
  doc: string;
}

/** A documented data (or GADT) constructor. */
export interface AnnotationConstructor {
  name: string;
  doc: string;
  fields: AnnotationField[];
}

/** One Haddock annotation, attached to the declaration it documents. */
export interface Annotation {
  name: string;
  kind: AnnotationKind;
  line: number;
  doc: string;
  position: AnnotationPosition;
  constructors?: AnnotationConstructor[];
  sectionLevel?: number;
}

/** Everything extracted from one Haskell file. */
export interface AnnotatedModule {
  path: string;
  module: string | null;
  header: string | null;
  cpp?: boolean;
  annotations: Annotation[];
}

/** The committed artifact. */
export interface AnnotationArtifact {
  schemaVersion: number;
  files: AnnotatedModule[];
}

/** The schema version this module understands; `check:annotations` enforces it. */
export const ANNOTATION_SCHEMA_VERSION = 1;

/** The committed artifact, typed. */
const typedArtifact = artifact as AnnotationArtifact;

/**
 * The annotations, keyed by repository-relative module path.
 *
 * Unknown schema versions are rejected here rather than at each consumer: a
 * future extractor must not change meaning under the same version number.
 */
export function loadAnnotations(): AnnotationArtifact {
  if (typedArtifact.schemaVersion !== ANNOTATION_SCHEMA_VERSION) {
    throw new Error(
      `haddock-annotations.json is schema version ${typedArtifact.schemaVersion}; ` +
        `this build understands ${ANNOTATION_SCHEMA_VERSION}. Regenerate it with the extractor.`,
    );
  }
  return typedArtifact;
}

/** The module annotations for a repository-relative path, if present. */
export function findModule(modulePath: string): AnnotatedModule | undefined {
  return loadAnnotations().files.find((file) => file.path === modulePath);
}

/** One declaration's annotation inside a module, if present. */
export function findAnnotation(
  modulePath: string,
  declarationName: string,
): Annotation | undefined {
  return findModule(modulePath)?.annotations.find(
    (annotation) => annotation.name === declarationName,
  );
}

/** The first module that documents this declaration name, if any. */
export function findDeclarationByName(declarationName: string): Annotation | undefined {
  for (const file of loadAnnotations().files) {
    const found = file.annotations.find((annotation) => annotation.name === declarationName);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Every annotation of one kind, across the tree, in artifact order. */
export function annotationsOfKind(kind: AnnotationKind): Annotation[] {
  return loadAnnotations().files.flatMap((file) => file.annotations.filter((a) => a.kind === kind));
}
