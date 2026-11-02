import { COPY } from './copy.ts';
import type { ProjectConfig } from './types.ts';

// 템플릿 목록(2026-11-02 사용자 결정): 새 플립북은 현재 템플릿 하나로 만들고, 이전 템플릿은 반영할 때만 쓴다.
// 이전 버전 템플릿으로 만든 플립북은 그 템플릿으로 반영한다(figma/flipbook.ts deliveryKit). 목록 위의 템플릿부터 본다.

export interface PickedTemplate { id: string; name: string }

// 현재 템플릿을 바꾼다. 바뀌기 전 템플릿은 이전 템플릿 맨 위에 남기고, 새 현재 템플릿은 이전 목록에서 뺀다.
export function setCurrentTemplate(project: ProjectConfig, template: PickedTemplate): ProjectConfig {
  const demoted = project.templateNodeId && project.templateNodeId !== template.id
    ? [{ nodeId: project.templateNodeId, name: project.templateName ?? '' }] : [];
  const seen = new Set([template.id]);
  const previousTemplates = [...demoted, ...project.previousTemplates].filter(t => !seen.has(t.nodeId) && !!seen.add(t.nodeId));
  return { ...project, templateNodeId: template.id, templateName: template.name, previousTemplates };
}

// 캔버스에서 고른 템플릿을 이전 템플릿 맨 위에 더한다. 이미 있으면 맨 위로 옮기고 이름을 새로 적는다.
export function addPreviousTemplate(project: ProjectConfig, template: PickedTemplate): ProjectConfig {
  if (template.id === project.templateNodeId) throw new Error(COPY.templatePreviousIsCurrent);
  const rest = project.previousTemplates.filter(t => t.nodeId !== template.id);
  return { ...project, previousTemplates: [{ nodeId: template.id, name: template.name }, ...rest] };
}

export function removePreviousTemplate(project: ProjectConfig, nodeId: string): ProjectConfig {
  return { ...project, previousTemplates: project.previousTemplates.filter(t => t.nodeId !== nodeId) };
}

// 템플릿 노드(현재·이전). 플립북으로 등록하지 않는다.
export function templateNodeIds(project: ProjectConfig): Set<string> {
  return new Set([...(project.templateNodeId ? [project.templateNodeId] : []), ...project.previousTemplates.map(t => t.nodeId)]);
}
