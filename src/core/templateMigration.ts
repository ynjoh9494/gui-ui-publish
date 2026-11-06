// Keep canvas conversion blocked until instance-slot recovery passes in Figma.
export const TEMPLATE_MIGRATION_ENABLED: boolean = false;
export interface TemplateMigrationItem { id: string; nodeId: string; pageId: string; title: string; rev: number }
export interface TemplateMigrationCandidate extends TemplateMigrationItem { templateId: string | null }
export interface TemplateMigrationResult { converted: { id: string; nodeId: string; pageId: string }[]; failed: { id: string; message: string }[] }
