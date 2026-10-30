import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
// @ts-expect-error The activation CLI is a native Node ESM module.
import { activateBuild } from '../scripts/activate-build.mjs';

test('검사 빌드는 실행 파일을 갱신하지 않으며, 명시적 전환은 완전한 빌드만 백업 후 적용한다', async () => {
  const parent = resolve('tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'build-safety-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'code.js'), 'running build');
  const staged = join(root, 'tmp', 'build');
  await mkdir(staged, { recursive: true });
  const files = ['code.js', 'ui.html', 'preview.html'];
  const hashes: Record<string, string> = {};
  for (const file of files) {
    await writeFile(join(staged, file), `new ${file}`);
    hashes[file] = createHash('sha256').update(`new ${file}`).digest('hex');
  }
  await writeFile(join(staged, 'build.json'), JSON.stringify({ builtAt: 'test', hashes }));
  await assert.rejects(activateBuild(root, false), /plugin-closed/);
  assert.equal(await readFile(join(root, 'dist', 'code.js'), 'utf8'), 'running build');
  await writeFile(join(staged, 'ui.html'), 'interrupted build');
  await assert.rejects(activateBuild(root, true), /불완전/);
  assert.equal(await readFile(join(root, 'dist', 'code.js'), 'utf8'), 'running build');
  await writeFile(join(staged, 'ui.html'), 'new ui.html');
  const result = await activateBuild(root, true);
  assert.equal(await readFile(join(root, 'dist', 'code.js'), 'utf8'), 'new code.js');
  assert.equal(await readFile(join(result.backup, 'code.js'), 'utf8'), 'running build');
});
