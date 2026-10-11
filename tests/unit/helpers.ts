import { readFileSync } from 'node:fs';

export const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
