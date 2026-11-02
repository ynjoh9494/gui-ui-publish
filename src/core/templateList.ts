import { COPY } from './copy.ts';
import { isFallbackItem, type TemplateItem } from './templateParts.ts';
import type { ProjectConfig } from './types.ts';

// 템플릿 목록(2026-11-02 사용자 결정): 템플릿을 목록 하나로 두고 그중 하나를 대표로 지정한다. 새 플립북은 대표 템플릿으로 만들고,
// 나머지는 이미 있는 플립북을 반영할 때만 쓴다(figma/flipbook.ts deliveryKit). 반영은 대표, 그다음 목록 위의 템플릿부터 본다.
// 저장은 대표(templateNodeId·templateName)와 나머지(previousTemplates, 위부터) 그대로다.

export interface PickedTemplate { id: string; name: string }
// 목록 한 줄. 대표가 맨 위이고 그 아래가 반영할 때 확인하는 순서다.
export interface TemplateEntry { nodeId: string; name: string; representative: boolean }

export function templateEntries(project: ProjectConfig): TemplateEntry[] {
  return [
    ...(project.templateNodeId ? [{ nodeId: project.templateNodeId, name: project.templateName ?? '', representative: true }] : []),
    ...project.previousTemplates.map(t => ({ nodeId: t.nodeId, name: t.name, representative: false })),
  ];
}

// 대표를 바꾼다. 바뀌기 전 대표는 나머지 맨 위에 남기고, 새 대표는 나머지에서 뺀다.
export function setCurrentTemplate(project: ProjectConfig, template: PickedTemplate): ProjectConfig {
  const demoted = project.templateNodeId && project.templateNodeId !== template.id
    ? [{ nodeId: project.templateNodeId, name: project.templateName ?? '' }] : [];
  const seen = new Set([template.id]);
  const previousTemplates = [...demoted, ...project.previousTemplates].filter(t => !seen.has(t.nodeId) && !!seen.add(t.nodeId));
  return { ...project, templateNodeId: template.id, templateName: template.name, previousTemplates };
}

// 목록에 있는 템플릿을 대표로 지정한다.
export function setRepresentativeTemplate(project: ProjectConfig, nodeId: string): ProjectConfig {
  if (nodeId === project.templateNodeId) return project;
  const entry = project.previousTemplates.find(t => t.nodeId === nodeId);
  if (!entry) throw new Error(COPY.templateNotListed);
  return setCurrentTemplate(project, { id: entry.nodeId, name: entry.name });
}

// 캔버스에서 고른 템플릿을 목록에 더한다. 대표가 없으면 대표로, 있으면 대표 바로 아래에 둔다.
// 이미 있으면 대표 바로 아래로 옮기고 이름을 새로 적는다.
export function addTemplate(project: ProjectConfig, template: PickedTemplate): ProjectConfig {
  if (!project.templateNodeId) return setCurrentTemplate(project, template);
  if (template.id === project.templateNodeId) throw new Error(COPY.templateAddIsRepresentative);
  const rest = project.previousTemplates.filter(t => t.nodeId !== template.id);
  return { ...project, previousTemplates: [{ nodeId: template.id, name: template.name }, ...rest] };
}

// 목록에서 뺀다. 대표는 뺄 수 없다(새 플립북을 만들 템플릿이 없어지지 않게).
export function removeTemplate(project: ProjectConfig, nodeId: string): ProjectConfig {
  if (nodeId === project.templateNodeId) throw new Error(COPY.templateRemoveRepresentative);
  return { ...project, previousTemplates: project.previousTemplates.filter(t => t.nodeId !== nodeId) };
}

// 항목을 연결하거나 보여 줄 템플릿. 목록에 있어야 하고, 대표가 아닌 템플릿은 반영에 쓰는 항목만 다룬다.
export function templateForItem(project: ProjectConfig, templateId: string, key: TemplateItem): string {
  const entry = templateEntries(project).find(t => t.nodeId === templateId);
  if (!entry) throw new Error(project.templateNodeId ? COPY.templateNotListed : COPY.controller053);
  if (!entry.representative && !isFallbackItem(key)) throw new Error(COPY.templateItemNotUsed);
  return entry.nodeId;
}

// 템플릿 노드(대표·나머지). 플립북으로 등록하지 않는다.
export function templateNodeIds(project: ProjectConfig): Set<string> {
  return new Set(templateEntries(project).map(t => t.nodeId));
}
