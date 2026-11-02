import type { TemplateLinks } from '../core/templateParts.ts';
import { loadPages, pageFlipbooks, TEMPLATE_KEY } from './flipbook.ts';
import { importNamedFrame, importNamedTemplate, linksOf, NS, templateFrame } from './template.ts';

// 이전 형식 플립북 변환(2026-11-02 사용자 결정: 이름 규칙을 없애고, 기존 플립북은 플립북 상세에서 고른 플립북만 바꾼다).
// 고른 이전 형식 플립북(연결 기록이 없는 플립북 프레임)에 이름으로 찾은 칸의 역할 표식과 연결 기록을 단다. 템플릿 목록의 이전 형식 템플릿도
// 이때 표식으로 바꾼다(플립북을 만든 템플릿의 연결 기록을 이어받기 위해). 화면에 보이는 레이어는 바꾸지 않는다.
// GUI Image Slot 안에 이미 넣어 둔 GUI 복사본은 그대로 두고, 변환한 뒤 Controller가 추적 GUI로 기록한다(추적 GUI로 바꾸기).

export interface LegacyConvertInput {
  // 바꿀 플립북이 있는 페이지
  pageIds: string[];
  // 바꿀 플립북. 캔버스에서 복제한 플립북 프레임은 바꾸지 않는다.
  flipbookIds: string[];
  // 템플릿 목록(대표가 맨 위)
  templateIds: string[];
}

// flipbooks: 찾은 플립북 ID(이번에 바꿨거나 이미 표식 형식인 플립북). 없는 ID는 프레임을 찾지 못한 플립북이다.
export interface LegacyConvertResult { flipbooks: string[] }

export async function convertLegacyFlipbooks(input: LegacyConvertInput, ns = NS): Promise<LegacyConvertResult> {
  // 템플릿: 목록 순서대로 보고 이전 형식이면 표식으로 바꾼다. 지웠거나 읽지 못하는 템플릿은 건너뛴다.
  const templates: { id: string; links: TemplateLinks; named: boolean }[] = [];
  for (const id of input.templateIds) {
    let frame: FrameNode;
    try { frame = await templateFrame(id); } catch { continue; }
    const before = linksOf(frame, ns);
    templates.push({ id: frame.id, links: before ?? await importNamedTemplate(frame, ns), named: !before });
  }
  // 플립북을 만든 템플릿: 적어 둔 템플릿, 이력 행 컴포넌트가 같은 템플릿, 이력 행이 없으면 첫 이전 형식 템플릿 순서로 고른다
  // (지금까지 이전 형식 플립북을 반영할 때 고르던 순서와 같다). 맞는 템플릿이 없으면 플립북의 이력 행 컴포넌트만 연결 기록에 둔다.
  const wanted = new Set(input.flipbookIds);
  const flipbooks: string[] = [];
  for (const page of await loadPages(input.pageIds)) {
    for (const [flipbookId, frame] of pageFlipbooks(ns, page)) {
      if (!wanted.has(flipbookId)) continue;
      flipbooks.push(flipbookId);
      if (linksOf(frame, ns)) continue;
      const recorded = frame.getSharedPluginData(ns, TEMPLATE_KEY);
      let picked = null as string | null;
      await importNamedFrame(frame, rows => {
        const from = templates.find(t => t.id === recorded)
          ?? templates.find(t => !!t.links.components.row && rows.some(r => r.id === t.links.components.row))
          ?? (rows.length ? undefined : templates.find(t => t.named));
        picked = from?.id ?? null;
        return from?.links ?? null;
      }, ns);
      if (picked) frame.setSharedPluginData(ns, TEMPLATE_KEY, picked);
    }
  }
  return { flipbooks };
}
