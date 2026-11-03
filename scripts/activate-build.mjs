import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function activateBuild(root) {
  const repo = resolve(root);
  const staged = join(repo, 'tmp', 'build'), live = join(repo, 'dist');
  const metadata = JSON.parse(await readFile(join(staged, 'build.json'), 'utf8'));
  const files = ['code.js', 'ui.html', 'preview.html'];
  const contents = await Promise.all(files.map(file => readFile(join(staged, file))));
  files.forEach((file, i) => {
    if (createHash('sha256').update(contents[i]).digest('hex') !== metadata.hashes?.[file])
      throw new Error(`검사 빌드가 불완전하거나 변경되었습니다: ${file}. 먼저 npm run check를 실행하세요.`);
  });
  const id = randomUUID();
  const prepared = join(repo, 'tmp', `activate-${id}`), backup = join(repo, 'tmp', `dist-backup-${id}`);
  // Every move is between these fixed descendants of the explicitly supplied
  // repository. Existing live files remain in a backup; nothing is deleted.
  await mkdir(prepared, { recursive: true });
  await Promise.all(files.map((file, i) => writeFile(join(prepared, file), contents[i])));
  const exists = await stat(live).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
  if (exists) await rename(live, backup);
  try { await rename(prepared, live); }
  catch (error) { if (exists) await rename(backup, live); throw error; }
  return { builtAt: metadata.builtAt, backup: exists ? backup : null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = await activateBuild(root);
  console.log(`Activated build ${result.builtAt}. Backup: ${result.backup ?? '(first build)'}`);
}
