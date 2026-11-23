#!/usr/bin/env node
/** B24 static custom-method artifact. Run after editing the source; tests enforce exact bytes. */
import {readFile, writeFile} from 'node:fs/promises';
import {URL} from 'node:url';
const source = new URL('../src/survey/free-text-schema.json', import.meta.url);
const target = new URL('../static/survey/free-text-v1.json', import.meta.url);
await writeFile(target, JSON.stringify(JSON.parse(await readFile(source, 'utf8'))) + '\n');
