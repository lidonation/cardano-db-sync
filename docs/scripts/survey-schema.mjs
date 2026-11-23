#!/usr/bin/env node
/** B24 static custom-method artifact. Run after editing the source; tests enforce exact bytes. */
import {readFile, writeFile} from 'node:fs/promises';
import {URL} from 'node:url';
for (const [sourceName, outputName] of [
  ['free-text-schema.json', 'free-text-v1.json'],
  ['example-presentation.json', 'example-presentation.json'],
]) {
  const source = new URL(`../src/survey/${sourceName}`, import.meta.url);
  const target = new URL(`../static/survey/${outputName}`, import.meta.url);
  await writeFile(target, JSON.stringify(JSON.parse(await readFile(source, 'utf8'))) + '\n');
}
