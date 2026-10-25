#!/usr/bin/env node
// astro-split-build [--config <file>]
//
// Loads the config module (default: split-build.config.js in the current
// directory), whose default export is the splitBuild() options object, and
// runs it. Exit 0 on success, 1 on any failure.

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { splitBuild } from './index.js';

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const configPath = resolve(configIndex === -1 ? 'split-build.config.js' : args[configIndex + 1] ?? '');

try {
  const { default: config } = await import(pathToFileURL(configPath).href);
  const result = await splitBuild(config);
  console.log(`\n🎉 Split build completed in ${result.totalSeconds.toFixed(1)}s`);
} catch (err) {
  console.error(`❌ ${err?.message || err}`);
  process.exit(1);
}
