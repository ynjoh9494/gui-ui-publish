import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const output = 'tmp/template-migration-release-check';
execFileSync(process.execPath, ['build.mjs'], { env: { ...process.env, PLUGIN_VERSION: 'v0.0.0', PLUGIN_BUILD_DIR: output }, stdio: 'pipe' });
for (const file of ['code.js', 'ui.html', 'preview.html']) {
  const artifact = readFileSync(`${output}/${file}`, 'utf8');
  for (const marker of ['Template migration staging', 'templateMigrationCopyMismatch', 'template-migration-find', 'template-migration-overlay', 'TemplateMigrationController', 'TemplateMigrationDialog'])
    assert.equal(artifact.includes(marker), false, `${file} must not contain ${marker}`);
}
console.log('Release artifacts exclude template migration implementation, UI and copy.');
