export interface TemplateMigrationItem { id: string; nodeId: string; pageId: string; title: string; rev: number }
export interface TemplateMigrationCandidate extends TemplateMigrationItem { templateId: string | null }
export interface TemplateMigrationResult { converted: { id: string; nodeId: string; pageId: string }[]; failed: { id: string; message: string }[] }
