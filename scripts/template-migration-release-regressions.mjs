import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const output = 'tmp/template-migration-release-check';
execFileSync(process.execPath, ['build.mjs'], { env: { ...process.env, PLUGIN_VERSION: 'v0.0.0', PLUGIN_BUILD_DIR: output }, stdio: 'pipe' });
for (const file of ['code.js', 'ui.html', 'preview.html']) {
  const artifact = readFileSync(`${output}/${file}`, 'utf8');
  for (const marker of ['Template migration staging', 'templateMigrationCopyMismatch', 'templateMigrationSourceAmbiguous', 'function migrationSource(', 'template-migration-find', 'template-migration-overlay', 'TemplateMigrationController', 'TemplateMigrationDialog'])
    assert.equal(artifact.includes(marker), false, `${file} must not contain ${marker}`);
  for (const marker of ['FlowRepairController', 'FlowRepairDialog', 'flow-repair-overlay', 'flow-repair-find', 'flowRepairCells', 'function restoreFlowImage(', '플로우 연결 복구', '선택한 이미지 확인'])
    assert.equal(artifact.includes(marker), false, `${file} must not contain ${marker}`);
}
console.log('Release artifacts exclude template migration implementation, UI and copy.');
