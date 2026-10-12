#!/usr/bin/env node

import { main } from "../src/cli.mjs";

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Temple error: ${message}`);
  process.exitCode = 1;
}
