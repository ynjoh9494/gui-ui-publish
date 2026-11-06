import { FLOW_REPAIR_COPY as COPY } from '../core/flowRepairCopy.ts';
import type { FlowRepairCandidate } from '../core/flowRepair.ts';
import type { ToMain, ToUi } from '../core/wire.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export class FlowRepairDialog {
  private open = false;
  private running = false;
  private token = '';
  private candidates: FlowRepairCandidate[] | null = null;
  private assigned = new Map<string, string>();
  private failures = new Map<string, string>();
  private overlay: HTMLElement;
  private send: (m: ToMain) => void;
  private picker: (field: string, uid: string | undefined, disabled: boolean) => string;
  constructor(overlay: HTMLElement, send: (m: ToMain) => void, picker: (field: string, uid: string | undefined, disabled: boolean) => string) {
    this.overlay = overlay; this.send = send; this.picker = picker;
  }
  action(action: string, el: HTMLElement): boolean {
    if (action === 'pick' && el.dataset.field?.startsWith('flow-repair:')) {
      if (!this.running) {
        this.assigned.set(el.dataset.field.slice('flow-repair:'.length), el.dataset.value!);
        const field = el.dataset.field;
        this.render();
        [...this.overlay.querySelectorAll<HTMLElement>('summary')].find(s => s.dataset.requiredField === field)?.focus();
      }
      return true;
    }
    if (!action.startsWith('flow-repair-')) return false;
    if (this.running) return true;
    if (action === 'flow-repair-find') {
      this.open = true; this.candidates = null; this.assigned.clear(); this.failures.clear(); this.render();
      this.send({ type: 'findFlowRepairs' });
    } else if (action === 'flow-repair-close') this.close();
    else if (action === 'flow-repair-submit' && this.candidates?.length && this.candidates.every(c => this.assigned.get(c.nodeId))) {
      this.running = true; this.failures.clear(); this.render();
      this.send({ type: 'restoreFlowImages', token: this.token, assignments: this.candidates.map(c => ({ nodeId: c.nodeId, uid: this.assigned.get(c.nodeId)! })) });
    }
    return true;
  }
  message(msg: ToUi) {
    if (!this.open) return;
    if (msg.type === 'flowRepairCandidates') {
      this.token = msg.token; this.candidates = msg.candidates; this.assigned.clear();
      for (const c of msg.candidates) if (c.assignedUid) this.assigned.set(c.nodeId, c.assignedUid);
      this.render();
    } else if (msg.type === 'flowRepairDone') {
      this.running = false;
      this.candidates = (this.candidates ?? []).filter(c => !msg.result.restored.includes(c.nodeId));
      this.failures = new Map(msg.result.failed.map(f => [f.nodeId, f.message]));
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
    const wasHidden = this.overlay.hidden;
    const focusInside = this.overlay.contains(document.activeElement);
    this.overlay.hidden = !this.open;
    if (!this.open) { this.overlay.innerHTML = ''; return; }
    const ready = !!this.candidates?.length && this.candidates.every(c => this.assigned.get(c.nodeId));
    this.overlay.innerHTML = `<div class="dialog bulk-dialog" role="dialog" aria-modal="true" aria-label="${COPY.title}">
      <h2>${COPY.title}</h2><p class="note">${COPY.hint}</p><p class="note">${COPY.grouping}</p>
      <div class="bulk-screen-list create-screen-list">${this.candidates === null ? `<p role="status">${COPY.scanning}</p>` : this.candidates.map((c, i) =>
        `<section class="managed-page-card"><h4 class="inline"><b>${i + 1}. ${esc(c.name)}</b><span class="note">${c.assignedUid ? COPY.auto : COPY.manual}</span></h4>${this.picker(`flow-repair:${c.nodeId}`, this.assigned.get(c.nodeId), this.running)}${this.failures.has(c.nodeId) ? `<p class="bad" role="alert">${esc(this.failures.get(c.nodeId)!)}</p>` : ''}</section>`).join('') || `<p>${COPY.empty}</p>`}</div>
      ${this.failures.has('') ? `<p class="bad" role="alert">${esc(this.failures.get('')!)}</p>` : ''}
      <div class="dialog-actions"><button data-action="flow-repair-close" ${this.running ? 'disabled' : ''}>${COPY.close}</button><button data-action="flow-repair-find" ${this.running ? 'disabled' : ''}>${COPY.find}</button>
      <button class="primary" data-action="flow-repair-submit" ${!ready || this.running ? 'disabled' : ''}>${this.running ? COPY.running : COPY.submit}</button></div></div>`;
    if (wasHidden || focusInside || document.activeElement === document.body) this.overlay.querySelector<HTMLButtonElement>('[data-action=flow-repair-close]')?.focus();
  }
}
