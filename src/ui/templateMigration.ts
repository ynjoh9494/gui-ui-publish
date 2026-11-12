import { TEMPLATE_MIGRATION_COPY as COPY } from '../core/templateMigrationCopy.ts';
import type { TemplateMigrationCandidate } from '../core/templateMigration.ts';
import type { ToMain, ToUi } from '../core/wire.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export class TemplateMigrationDialog {
  private templateId = '';
  private candidates: TemplateMigrationCandidate[] | null = null;
  private selected = new Set<string>();
  private failures = new Map<string, string>();
  private running = false;
  private open = false;
  private overlay: HTMLElement;
  private send: (m: ToMain) => void;
  private updated: (ids: string[]) => void;
  constructor(overlay: HTMLElement, send: (m: ToMain) => void, updated: (ids: string[]) => void) { this.overlay = overlay; this.send = send; this.updated = updated; }
  action(action: string, el: HTMLElement): boolean {
    if (!action.startsWith('template-migration-')) return false;
    if (this.running) return true;
    if (action === 'template-migration-find') {
      this.open = true; this.candidates = null; this.failures.clear(); this.selected.clear(); this.render();
      this.send({ type: 'findTemplateMigrations' });
    } else if (action === 'template-migration-close') this.close();
    else if (action === 'template-migration-toggle') {
      const id = el.dataset.id!;
      if ((el as HTMLInputElement).checked) this.selected.add(id); else this.selected.delete(id);
      const button = this.overlay.querySelector<HTMLButtonElement>('[data-action="template-migration-submit"]');
      if (button) { button.disabled = !this.selected.size; button.textContent = `${COPY.templateMigrationSelected} (${this.selected.size})`; }
    } else if (action === 'template-migration-submit' && this.selected.size) {
      this.running = true; this.failures.clear(); this.render();
      this.send({ type: 'migrateFlipbookTemplates', ids: [...this.selected], templateId: this.templateId });
    }
    return true;
  }
  message(msg: ToUi) {
    if (!this.open) return;
    if (msg.type === 'templateMigrations') {
      this.templateId = msg.templateId; this.candidates = msg.candidates; this.selected.clear(); this.render();
    } else if (msg.type === 'templateMigrationsDone') {
      this.running = false;
      const ids = msg.result.converted.map(c => c.id);
      this.updated(ids);
      const done = new Set(ids);
      this.candidates = (this.candidates ?? []).filter(c => !done.has(c.id));
      for (const id of ids) this.selected.delete(id);
      this.failures = new Map(msg.result.failed.map(f => [f.id, f.message]));
      if (this.candidates.length) this.render(); else this.close();
    } else if (msg.type === 'error' && (this.running || this.candidates === null)) {
      this.running = false; this.candidates ??= []; this.failures.set('', msg.message); this.render();
    }
  }
  close(): boolean {
    if (!this.open || this.running) return false;
    this.open = false; this.render(); return true;
  }
  private render() {
    const focusInside = this.overlay.contains(document.activeElement);
    const wasHidden = this.overlay.hidden;
    this.overlay.hidden = !this.open;
    if (!this.open) { this.overlay.innerHTML = ''; return; }
    this.overlay.innerHTML = `<div class="dialog bulk-dialog" role="dialog" aria-modal="true" aria-label="${COPY.templateMigrationTitle}">
      <h2>${COPY.templateMigrationTitle}</h2>
      <div class="bulk-screen-list create-screen-list">${this.candidates === null ? `<p role="status">${COPY.templateMigrationScanning}</p>` :
      this.candidates.map(c => `<label class="create-screen-option"><input type="checkbox" data-action="template-migration-toggle" data-id="${esc(c.id)}" ${this.selected.has(c.id) ? 'checked' : ''} ${this.running ? 'disabled' : ''}>${c.screenId ? `<span class="id-tag">${esc(c.screenId)}</span>` : ''}<span class="name">${esc(c.title)}</span>${!c.templateId ? `<span class="note">${COPY.templateMigrationUnknown}</span>` : ''}</label>${this.failures.has(c.id) ? `<p class="bad" role="alert">${esc(this.failures.get(c.id)!)}</p>` : ''}`).join('') || `<p>${COPY.templateMigrationEmpty}</p>`}</div>
      ${this.failures.has('') ? `<p class="bad" role="alert">${esc(this.failures.get('')!)}</p>` : ''}
      <div class="dialog-actions"><button data-action="template-migration-close" ${this.running ? 'disabled' : ''}>${COPY.templateMigrationClose}</button>
      <button class="primary" data-action="template-migration-submit" ${!this.selected.size || this.running ? 'disabled' : ''}>${this.running ? COPY.templateMigrationRunning : `${COPY.templateMigrationSelected} (${this.selected.size})`}</button></div></div>`;
    if (wasHidden || focusInside) this.overlay.querySelector<HTMLButtonElement>('[data-action=template-migration-close]')?.focus();
  }
}
