export interface TemplateMigrationItem { id: string; nodeId: string; pageId: string; title: string; rev: number; screenId?: string }
export interface TemplateMigrationCandidate extends TemplateMigrationItem { templateId: string | null }
export interface TemplateMigrationResult { converted: { id: string; nodeId: string; pageId: string }[]; failed: { id: string; message: string }[] }

export function sortTemplateMigrations(items: readonly TemplateMigrationCandidate[]): TemplateMigrationCandidate[] {
  return [...items].sort((a, b) => a.screenId && b.screenId
    ? a.screenId.localeCompare(b.screenId, 'en', { numeric: true, sensitivity: 'base' })
    : a.screenId ? -1 : b.screenId ? 1 : 0);
}
