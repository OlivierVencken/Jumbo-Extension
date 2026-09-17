import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('production build is reproducible and contains the userscript header without runtime imports', () => {
  const previous = read('dist/jumbo-checklist.user.js');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
  const source = read('dist/jumbo-checklist.user.js');
  assert.equal(source, previous);
  assert.ok(source.startsWith(read('src/metadata.txt').trimEnd() + '\n'));
  const metadata = read('dist/jumbo-checklist.meta.js');
  assert.equal(metadata, read('src/metadata.txt').trimEnd() + '\n');
  assert.match(metadata, /@updateURL\s+https:\/\/github\.com\/OlivierVencken\/Jumbo-Extension\/releases\/latest\/download\/jumbo-checklist\.meta\.js/);
  assert.match(metadata, /@downloadURL\s+https:\/\/github\.com\/OlivierVencken\/Jumbo-Extension\/releases\/latest\/download\/jumbo-checklist\.user\.js/);
  assert.equal((source.match(/==UserScript==/g) || []).length, 1);
  assert.doesNotMatch(source, /sourceMappingURL|\brequire\s*\(|\bimport\s*\(/);
  assert.doesNotThrow(() => new Script(source));
});

test('development bundle includes source maps and runs without a module loader', () => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--dev'], { cwd: root, stdio: 'pipe' });
  const source = read('dist/jumbo-checklist.dev.user.js');
  const devMetadata = read('src/metadata.txt').trimEnd().replace(/^\/\/ @(?:updateURL|downloadURL)[^\r\n]*\r?\n/gm, '');
  assert.ok(source.startsWith(devMetadata + '\n'));
  assert.doesNotMatch(source, /@(?:updateURL|downloadURL)/);
  assert.match(source, /sourceMappingURL=data:application\/json/);
  const encodedMap = source.match(/sourceMappingURL=data:application\/json;base64,(\S+)/)[1];
  const map = JSON.parse(Buffer.from(encodedMap, 'base64').toString('utf8'));
  const headerLines = devMetadata.split('\n').length + 1;
  assert.ok(map.mappings.startsWith(';'.repeat(headerLines)));
  assert.ok(map.sources.some(path => path.endsWith('ui.mjs')));
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://product.jumbo.com/', runScripts: 'outside-only' });
  try {
    dom.window.eval(source);
    const host = dom.window.document.querySelector('#ov-vulcheck');
    assert.ok(host.shadowRoot.querySelector('style').textContent.includes('.launch'));
    assert.ok(host.shadowRoot.querySelector('.launch'));
  } finally { dom.window.close(); }
});

test('release refuses mismatched tags and accepts the metadata version', () => {
  const version = read('src/metadata.txt').match(/^\/\/ @version\s+(\S+)/m)[1];
  const check = tag => execFileSync(process.execPath, ['scripts/check-release.mjs'], {
    cwd: root, stdio: 'pipe', env: { ...process.env, GITHUB_REF_NAME: tag },
  });
  assert.doesNotThrow(() => check(`v${version}`));
  for (const tag of ['v0.0.0', `v${version}-beta`, 'main', '']) assert.throws(() => check(tag));
});
