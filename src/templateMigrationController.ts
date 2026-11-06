import { TEMPLATE_MIGRATION_ENABLED } from './core/templateMigration.ts';
import { COPY } from './core/copy.ts';
import { keys, type Store } from './core/store.ts';
import type { TemplateMigrationCandidate, TemplateMigrationResult } from './core/templateMigration.ts';
import type { Host } from './host.ts';

export class TemplateMigrationController {
  private scan: { templateId: string; candidates: TemplateMigrationCandidate[] } | null = null;
  private host: Host;
  private store: Store;
  constructor(host: Host, store: Store) { this.host = host; this.store = store; }
  async find(found: Map<string, string>): Promise<void> {
    this.scan = null;
    this.store.reload();
    const { project, flipbooks } = this.store.state;
    if (!project.templateNodeId) throw new Error(COPY.controller053);
    const items = [...flipbooks.values()].filter(f => f.status === 'active' && found.has(f.id) && !!f.pageId)
      .map(f => ({ id: f.id, title: f.title, rev: f.rev, nodeId: found.get(f.id)!, pageId: f.pageId! }));
    const candidates = await this.host.findTemplateMigrations?.(items, project.templateNodeId) ?? [];
    this.scan = { templateId: project.templateNodeId, candidates };
    this.host.post({ type: 'templateMigrations', ...this.scan });
  }
  async convert(ids: string[], templateId: string): Promise<TemplateMigrationResult> {
    if (!TEMPLATE_MIGRATION_ENABLED) throw new Error(COPY.templateMigrationPaused);
    const scan = this.scan;
    this.store.reload();
    if (!scan || scan.templateId !== templateId || this.store.state.project.templateNodeId !== templateId)
      throw new Error(COPY.templateMigrationChanged);
    const result: TemplateMigrationResult = { converted: [], failed: [] };
    const byId = new Map(scan.candidates.map(c => [c.id, c]));
    for (const id of new Set(ids)) {
      const item = byId.get(id);
      if (!item) continue;
      try {
        this.store.reload();
        const fb = this.store.state.flipbooks.get(id);
        if (this.store.state.project.templateNodeId !== templateId || fb?.status !== 'active' || fb.rev !== item.rev || fb.pageId !== item.pageId)
          throw new Error(COPY.templateMigrationChanged);
        if (!this.host.migrateFlipbookTemplate) throw new Error(COPY.templateMigrationUnsupported);
        const converted = await this.host.migrateFlipbookTemplate(item, templateId, () => {
          this.store.reload();
          const latest = this.store.state.flipbooks.get(id);
          return this.store.state.project.templateNodeId === templateId && latest?.status === 'active' && latest.rev === item.rev && latest.pageId === item.pageId;
        });
        // Reload after asynchronous node work; keep unrelated edits from other users.
        this.store.reload();
        const latest = this.store.state.flipbooks.get(id);
        if (latest?.status === 'active' && !latest.tracked) this.store.put(keys.flipbook(id), { ...latest, rev: latest.rev + 1, tracked: true });
        this.store.audit(this.host.actor, 'flipbook.templateMigration', id, item.templateId, templateId);
        result.converted.push({ id, ...converted });
      } catch (error) { result.failed.push({ id, message: error instanceof Error ? error.message : String(error) }); }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const done = new Set(result.converted.map(c => c.id));
    scan.candidates = scan.candidates.filter(c => !done.has(c.id));
    if (result.converted.length) this.host.post({ type: 'notice', message: `${COPY.templateMigrationDone} ${result.converted.map(c => this.store.state.flipbooks.get(c.id)?.title ?? c.id).join(', ')}` });
    this.host.post({ type: 'templateMigrationsDone', result });
    return result;
  }
}
