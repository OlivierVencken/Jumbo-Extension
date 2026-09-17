import { readFile } from 'node:fs/promises';

const metadata = await readFile(new URL('../src/metadata.txt', import.meta.url), 'utf8');
const version = metadata.match(/^\/\/ @version\s+(\S+)\s*$/m)?.[1];
if (!/^\d+\.\d+\.\d+$/.test(version || '') || process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Release tag must match the stable metadata version: v${version}`);
}
