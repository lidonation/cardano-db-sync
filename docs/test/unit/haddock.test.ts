import {describe, expect, it} from 'vitest';

import {
  ANNOTATION_SCHEMA_VERSION,
  annotationsOfKind,
  findAnnotation,
  findDeclarationByName,
  findModule,
  loadAnnotations,
} from '../../src/data/haddock';

/**
 * The committed artifact produced by the `extract-haddock` extractor (B07).
 *
 * These tests exercise the access layer only — structural validation of the
 * artifact lives in `scripts/check-annotations.mjs` and the extraction rules
 * are pinned by the extractor's golden test.
 */
describe('haddock annotations data layer', () => {
  it('loads the committed artifact at the supported schema version', () => {
    const artifact = loadAnnotations();
    expect(artifact.schemaVersion).toBe(ANNOTATION_SCHEMA_VERSION);
    expect(artifact.files.length).toBeGreaterThan(0);
  });

  it('finds a module by its repository-relative path', () => {
    const first = loadAnnotations().files[0];
    expect(findModule(first.path)).toBe(first);
    expect(findModule('cardano-db/src/No/Such/Module.hs')).toBeUndefined();
  });

  it('finds a declaration inside a module, and nothing when absent', () => {
    const documented = loadAnnotations().files.find((file) => file.annotations.length > 0);
    expect(documented).toBeDefined();
    const annotated = documented?.annotations.find((annotation) => annotation.name !== '');
    expect(annotated).toBeDefined();
    expect(findAnnotation(documented?.path ?? '', annotated?.name ?? '')).toEqual(annotated);
    expect(findAnnotation(documented?.path ?? '', 'Not_A_Name')).toBeUndefined();
  });

  it('finds the first module documenting a declaration name', () => {
    const sample = loadAnnotations()
      .files.flatMap((file) => file.annotations)
      .find((annotation) => annotation.name !== '' && annotation.kind !== 'section');
    expect(sample).toBeDefined();
    const found = findDeclarationByName(sample?.name ?? '');
    expect(found).toBeDefined();
    expect(found?.name).toBe(sample?.name);
    expect(findDeclarationByName('Definitely_Not_Documented')).toBeUndefined();
  });

  it('collects annotations of one kind across the tree', () => {
    const classes = annotationsOfKind('class');
    for (const annotation of classes) {
      expect(annotation.kind).toBe('class');
    }
    expect(classes.length).toBeGreaterThan(0);
  });
});
