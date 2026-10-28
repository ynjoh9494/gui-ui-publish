import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIGEST_GROUPS, decodeDigest, digestFingerprint, digestOf, encodeDigest, explainChange, propGroup, type ChangeReason, type DigestGroup } from '../src/core/changeDigest.ts';
import { fingerprint, type NodeSnapshot } from '../src/core/fingerprint.ts';
import { TEXT, TEXT_SEGMENT, VISUAL } from '../src/figma/snapshot.ts';

// 결정적 난수(테스트가 매번 같은 트리를 만든다)
function rng(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

const solid = (r: number, extra: Record<string, unknown> = {}) => ({ type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r, g: 0.5, b: 0.5 }, ...extra });

function leaf(rand: () => number, name: string, i: number): NodeSnapshot {
  const base = { visible: true, opacity: 1, blendMode: 'PASS_THROUGH', x: Math.round(rand() * 1800), y: Math.round(rand() * 1000), width: 40 + Math.round(rand() * 200), height: 20 + Math.round(rand() * 80), rotation: 0 };
  if (i % 3 === 0) {
    const characters = `글자 ${name}`;
    return { type: 'TEXT', name, props: { ...base, fills: [solid(0.1)], characters, textAlignHorizontal: 'LEFT', textAutoResize: 'WIDTH_AND_HEIGHT',
      segments: [{ characters, start: 0, end: characters.length, fontName: { family: 'Pretendard', style: 'Regular' }, fontSize: 24, fills: [solid(0.1)] }] } };
  }
  if (i % 3 === 1) return { type: 'VECTOR', name, props: { ...base, fills: [solid(0.3)], strokes: [], strokeWeight: 1, vectorPaths: [{ windingRule: 'NONZERO', data: `M0 0L${i} ${i}Z` }] } };
  return { type: 'RECTANGLE', name, props: { ...base, fills: [solid(rand()), solid(0.9, { visible: false })], strokes: [], strokeWeight: 1, effects: [], cornerRadius: 8 } };
}

// 그룹 100개 × 레이어 10개 + 그룹·루트 = 1,111레이어. 그룹 안에는 같은 이름의 레이어도 둔다.
function screen(seed = 1, groups = 100, perGroup = 10): NodeSnapshot {
  const rand = rng(seed);
  const children: NodeSnapshot[] = [];
  for (let g = 0; g < groups; g++) {
    const kids = Array.from({ length: perGroup }, (_, i) => leaf(rand, i < 2 ? 'Item' : `Layer ${i}`, g * perGroup + i));
    children.push({ type: 'FRAME', name: `Group ${g}`, props: { visible: true, opacity: 1, x: g * 10, y: 0, width: 1920, height: 100, fills: [], clipsContent: true,
      variables: { [`VariableID:${g}`]: { r: 0.1, g: 0.2, b: 0.3, a: 1 } } }, children: kids });
  }
  return { type: 'FRAME', name: 'Screen', props: { visible: true, opacity: 1, x: 5000, y: 0, width: 1920, height: 1080, fills: [solid(1)], clipsContent: true }, children };
}

const clone = (node: NodeSnapshot): NodeSnapshot => structuredClone(node);
const at = (root: NodeSnapshot, ...indexes: number[]) => indexes.reduce((n, i) => n.children![i], root);

function explain(before: NodeSnapshot, after: NodeSnapshot): ChangeReason {
  const baseFp = fingerprint(before);
  const stored = encodeDigest(digestOf(before, baseFp));
  const afterFp = fingerprint(after);
  assert.notEqual(afterFp, baseFp, '변경한 화면의 지문은 달라야 한다');
  return explainChange(stored, baseFp, digestOf(after, afterFp));
}

const pathsOf = (reason: ChangeReason, group: DigestGroup) => reason.groups.find(g => g.group === group)?.layers.map(l => l.layer.path.join('/')) ?? [];

test('변경 근거: 저장 형식은 화면당 3KB 이하이고 그대로 되읽힌다', () => {
  const root = screen();
  const fp = fingerprint(root);
  const text = encodeDigest(digestOf(root, fp));
  assert.ok(text.length <= 3000, `근거 기록 ${text.length}자`);
  assert.equal(digestFingerprint(text), fp);
  const decoded = decodeDigest(text)!;
  assert.equal(encodeDigest(decoded), text);
  assert.equal(digestFingerprint('{"v":0,"fp":"x","t":""}'), null);
});

test('변경 근거: 레이어 이름·ID를 붙여도 지문은 그대로다', () => {
  const root = screen();
  const unnamed = clone(root);
  const strip = (n: NodeSnapshot) => { delete n.name; delete n.id; n.children?.forEach(strip); };
  strip(unnamed);
  assert.equal(fingerprint(root), fingerprint(unnamed));
});

test('변경 근거: 수집 속성은 모두 묶음 표에 있다', () => {
  for (const key of [...VISUAL, ...TEXT, 'segments', 'variables']) assert.notEqual(propGroup(key), 'other', key);
  // 글자 구간 속성은 segments 하나로 들어온다.
  assert.ok(TEXT_SEGMENT.length > 0);
});

test('변경 근거: 0.3px 이동은 「1px 이내」, 보이는 값 변경 없음', () => {
  const before = screen();
  const after = clone(before);
  at(after, 3, 5).props.x = (at(before, 3, 5).props.x as number) + 0.3;
  const reason = explain(before, after);
  assert.equal(reason.status, 'complete');
  assert.equal(reason.visible, false);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen]), [['geometry', true]]);
  assert.deepEqual(pathsOf(reason, 'geometry'), ['Group 3/Layer 5']);
});

test('변경 근거: 숨긴 칠과 같은 값의 다른 변수 연결은 보이는 값이 같다', () => {
  const before = screen();
  const after = clone(before);
  // 숨긴 칠의 색만 바꾼다.
  (at(after, 0, 2).props.fills as Record<string, unknown>[])[1].color = { r: 0, g: 0, b: 0 };
  // 값이 같은 다른 변수로 다시 연결한다(칠의 별칭 ID와 해석 값 목록의 ID가 바뀐다).
  const group = at(after, 7);
  group.props.variables = { 'VariableID:other': { r: 0.1, g: 0.2, b: 0.3, a: 1 } };
  group.props.fills = [solid(0.4, { boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:other' } } })];
  const beforeGroup = at(before, 7);
  beforeGroup.props.fills = [solid(0.4, { boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:7' } } })];
  const reason = explain(before, after);
  assert.equal(reason.status, 'complete');
  assert.equal(reason.visible, false);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen]), [['paint', true], ['variables', true]]);
  assert.deepEqual(pathsOf(reason, 'paint'), ['Group 0/Layer 2', 'Group 7']);
});

test('변경 근거: 인스턴스 분리는 레이어 종류만 다르다', () => {
  const before = screen();
  at(before, 4).type = 'INSTANCE';
  const after = clone(before);
  at(after, 4).type = 'FRAME';
  const reason = explain(before, after);
  assert.equal(reason.visible, false);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen]), [['structure', true]]);
});

test('변경 근거: 텍스트 내용과 보이는 칠 변경은 보이는 값이 바뀐 것으로 본다', () => {
  const before = screen();
  const after = clone(before);
  const text = at(after, 2, 4);
  text.props.characters = '바뀐 글자';
  (text.props.segments as Record<string, unknown>[])[0] = { ...(text.props.segments as Record<string, unknown>[])[0], characters: '바뀐 글자', end: 5 };
  (at(after, 9, 2).props.fills as Record<string, unknown>[])[0].color = { r: 1, g: 0, b: 0 };
  const reason = explain(before, after);
  assert.equal(reason.status, 'complete');
  assert.equal(reason.visible, true);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen]), [['paint', false], ['text', null]]);
  assert.deepEqual(pathsOf(reason, 'text'), ['Group 2/Layer 4']);
});

test('변경 근거: 레이어 추가·삭제·이름 변경', () => {
  const before = screen();
  const after = clone(before);
  at(after, 1).children!.push({ ...leaf(rng(9), 'Badge', 2), name: 'Badge' });
  at(after, 5).children!.splice(4, 1);
  at(after, 8, 4).name = 'Renamed';
  // 이름만 바꾸면 지문이 같으므로 다른 변경을 하나 더한다.
  at(after, 9, 3).props.y = (at(before, 9, 3).props.y as number) + 0.2;
  const reason = explain(before, after);
  assert.equal(reason.status, 'complete');
  assert.deepEqual(reason.added.map(l => l.path.join('/')), ['Group 1/Badge']);
  assert.equal(reason.removed, 1);
  assert.deepEqual(reason.renamed.map(l => l.path.join('/')), ['Group 8/Renamed']);
  assert.deepEqual(pathsOf(reason, 'structure'), ['Group 1', 'Group 5', 'Group 8']);
  assert.deepEqual(pathsOf(reason, 'geometry'), ['Group 9/Layer 3']);
  assert.equal(reason.visible, true);
});

test('변경 근거: 이름이 글자를 따라 바뀌는 텍스트는 글자를 고쳐도 같은 레이어의 텍스트 내용 변경이다', () => {
  // 메뉴 버튼의 「APPS」를 「APP」으로 고치면 Figma가 레이어 이름도 「APP」으로 바꾼다.
  const label = (characters: string, width: number): NodeSnapshot => ({
    type: 'TEXT', name: characters, autoName: true, props: { visible: true, x: 40, y: 8, width, height: 24, characters, fills: [solid(1)],
      segments: [{ characters, start: 0, end: characters.length, fontName: { family: 'Pretendard', style: 'Bold' }, fontSize: 24, fills: [solid(1)] }] },
  });
  const button = (text: NodeSnapshot): NodeSnapshot => ({ type: 'FRAME', name: 'Main menu', props: { x: 0, y: 0, width: 300, height: 80 }, children: [
    { type: 'FRAME', name: 'icon+title', props: { x: 20, y: 20, width: 200, height: 40 }, children: [
      { type: 'VECTOR', name: 'icon', autoName: false, props: { x: 0, y: 8, width: 24, height: 24, fills: [solid(1)] } },
      text,
      { type: 'TEXT', name: 'Badge', props: { x: 160, y: 8, width: 20, height: 24, characters: 'N' } },
    ] },
  ] });
  const reason = explain(button(label('APPS', 72)), button(label('APP', 54)));
  assert.equal(reason.status, 'complete');
  assert.deepEqual([reason.added, reason.renamed, reason.removed], [[], [], 0]);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen]), [['geometry', false], ['text', null]]);
  assert.deepEqual(pathsOf(reason, 'text'), ['icon+title/APP']);
});

test('변경 근거: 차이가 많으면 일부 레이어만 풀고 묶음 판정은 정확하다', () => {
  const before = screen();
  const after = clone(before);
  for (let g = 0; g < 100; g++) at(after, g, 6).props.x = (at(before, g, 6).props.x as number) + 0.2;
  const reason = explain(before, after);
  assert.equal(reason.status, 'partial');
  assert.equal(reason.visible, false);
  assert.deepEqual(reason.groups.map(g => [g.group, g.sameOnScreen]), [['geometry', true]]);
  assert.ok(pathsOf(reason, 'geometry').length < 100);
});

test('변경 근거: 근거 기록이 없거나 다른 지문의 것이면 알 수 없다', () => {
  const before = screen(), after = clone(before);
  at(after, 0, 0).props.opacity = 0.5;
  const current = digestOf(after, fingerprint(after));
  assert.equal(explainChange(null, fingerprint(before), current).status, 'no-record');
  assert.equal(explainChange(encodeDigest(digestOf(before, 'other')), fingerprint(before), current).status, 'no-record');
});

// 레이어·묶음마다 속성 하나를 바꾸는 방법. 보이는 값이 같은 변경과 다른 변경을 함께 둔다.
const MUTATIONS: { group: DigestGroup; apply: (n: NodeSnapshot) => boolean }[] = [
  { group: 'display', apply: n => { n.props.opacity = 0.42; return true; } },
  { group: 'geometry', apply: n => { n.props.width = (n.props.width as number) + 17; return true; } },
  { group: 'geometry', apply: n => { n.props.y = (n.props.y as number) + 0.25; return true; } },
  { group: 'paint', apply: n => { const f = n.props.fills as Record<string, unknown>[] | undefined; if (!f?.length) return false; f[0] = { ...f[0], color: { r: 0.01, g: 0.02, b: 0.03 } }; return true; } },
  { group: 'shape', apply: n => { if (n.type !== 'RECTANGLE') return false; n.props.cornerRadius = 3; return true; } },
  { group: 'text', apply: n => { if (n.type !== 'TEXT') return false; n.props.characters = `${n.props.characters}!`; return true; } },
  { group: 'textStyle', apply: n => { if (n.type !== 'TEXT') return false; n.props.textAlignHorizontal = 'CENTER'; return true; } },
];

test('변경 근거: 무작위로 바꾼 레이어·묶음을 정확히 찾는다', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rand = rng(seed * 7919);
    const before = screen(seed);
    const after = clone(before);
    const expected = new Set<string>();
    const count = 1 + Math.floor(rand() * 15);
    for (let n = 0; n < count; n++) {
      const g = Math.floor(rand() * 100), i = Math.floor(rand() * 10);
      const m = MUTATIONS[Math.floor(rand() * MUTATIONS.length)];
      const node = at(after, g, i);
      if (m.apply(node)) expected.add(`${m.group}:${[`Group ${g}`, ...[node.name === 'Item' && i === 1 ? 'Item (2)' : node.name!]].join('/')}`);
    }
    if (fingerprint(before) === fingerprint(after)) continue;
    const reason = explain(before, after);
    assert.equal(reason.status, 'complete', `seed ${seed}: ${count}건`);
    const found = new Set(reason.groups.flatMap(g => g.layers.map(l => `${g.group}:${l.layer.path.join('/')}`)));
    assert.deepEqual([...found].sort(), [...expected].sort(), `seed ${seed}`);
  }
});

test('변경 근거: 지문이 다르면 근거에도 차이가 있다(무작위 속성 변형)', () => {
  const rand = rng(42);
  const keys = [...VISUAL, ...TEXT];
  for (let n = 0; n < 200; n++) {
    const before = screen(n % 5 + 1, 10, 5);
    const after = clone(before);
    const node = at(after, Math.floor(rand() * 10), Math.floor(rand() * 5));
    const key = keys[Math.floor(rand() * keys.length)];
    node.props[key] = n % 2 ? `changed-${n}` : rand();
    if (fingerprint(before) === fingerprint(after)) continue;
    const reason = explain(before, after);
    assert.ok(reason.status === 'complete' && (reason.groups.length || reason.added.length || reason.removed), `${key}: ${reason.status}`);
    assert.ok(reason.groups.some(g => g.group === propGroup(key)), key);
  }
});

test('변경 근거: 1,111레이어 화면의 근거 계산 시간', () => {
  const root = screen();
  const fp = fingerprint(root);
  const runs = 5;
  const start = performance.now();
  for (let i = 0; i < runs; i++) digestOf(root, fp);
  const digestMs = (performance.now() - start) / runs;
  const fpStart = performance.now();
  for (let i = 0; i < runs; i++) fingerprint(root);
  const fingerprintMs = (performance.now() - fpStart) / runs;
  console.log(`근거 계산 ${digestMs.toFixed(1)}ms, 지문 계산 ${fingerprintMs.toFixed(1)}ms (1,111레이어, Node)`);
  assert.ok(DIGEST_GROUPS.length <= 10);
});
