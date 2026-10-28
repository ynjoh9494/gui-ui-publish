import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonical, fingerprint, legacyFingerprint, type NodeSnapshot } from '../src/core/fingerprint.ts';

// 2026-10-28까지 쓰던 canonical(). 지금 구현은 이것과 한 글자도 다르면 안 된다(이미 저장된 지문과 비교하므로).
const GEOMETRY = new Set(['x', 'y', 'width', 'height', 'rotation']);
function normalizeNumber(n: number, scale = 10000): number {
  if (!Number.isFinite(n)) return n;
  const rounded = Math.round(n * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function reference(value: unknown, geometry = false, key = ''): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return JSON.stringify(normalizeNumber(value, geometry && GEOMETRY.has(key) ? 100 : 10000));
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(v => reference(v, geometry)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as object).sort()
      .filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${reference((value as Record<string, unknown>)[k], geometry, k)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function rng(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
const SPECIALS: unknown[] = [0, -0, 1e21, 1e-7, -1e-7, 0.1 + 0.2, NaN, Infinity, -Infinity, 123.456789, -5.00004, 2.5e-5, Number.MAX_VALUE, Number.MIN_VALUE,
  '', 'a"b', 'line\nbreak', '\u0000\u001f', '한글', '\ud800', 'x\\y', true, false, null, undefined, [], {}, [undefined], [1, , 3], Symbol('s'), BigInt(10), () => 1];
const KEYS = ['x', 'y', 'width', 'height', 'rotation', 'r', 'g', 'b', 'a', 'fills', 'Z', 'aa', '10', '2', 'é', 'key"q', ''];
function randomValue(rand: () => number, depth: number): unknown {
  const r = rand();
  if (depth > 3 || r < 0.45) return SPECIALS[Math.floor(rand() * SPECIALS.length)];
  if (r < 0.6) return rand() * 3000 - 1000;
  if (r < 0.8) return Array.from({ length: Math.floor(rand() * 4) }, () => randomValue(rand, depth + 1));
  const out: Record<string, unknown> = {};
  for (let i = Math.floor(rand() * 5); i > 0; i--) out[KEYS[Math.floor(rand() * KEYS.length)]] = randomValue(rand, depth + 1);
  return out;
}

test('지문 정규화: 빠른 구현은 이전 구현과 결과가 같다(특수한 수·문자열·빈 칸·키 순서 포함)', () => {
  const rand = rng(7);
  for (let i = 0; i < 5000; i++) {
    const value = randomValue(rand, 0);
    for (const geometry of [false, true]) for (const key of ['', 'x', 'width', 'r']) assert.equal(canonical(value, geometry, key), reference(value, geometry, key));
  }
});

const solid = (r: number, extra: Record<string, unknown> = {}) => ({ type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r, g: 0.5, b: 0.5 }, ...extra });

test('지문: 고정한 화면의 지문은 바뀌지 않는다(바뀌면 저장된 비교 기준이 모두 변경 감지된다)', () => {
  const screen: NodeSnapshot = {
    type: 'FRAME', props: { visible: true, opacity: 1, x: 5000.123, y: -0, width: 1920.00004, height: 1080, rotation: 0, fills: [solid(1), solid(0.25, { visible: false, opacity: 0.333333333 })], clipsContent: true, effects: [] },
    children: [
      { type: 'TEXT', props: { visible: true, x: 10.004999, y: 20.5, width: 300, height: 40, characters: '홈 "Home"\n', textAutoResize: 'WIDTH_AND_HEIGHT', fills: [solid(0.1)],
        segments: [{ characters: '홈 "Home"\n', start: 0, end: 10, fontName: { family: 'Pretendard', style: 'Bold' }, fontSize: 24, letterSpacing: { unit: 'PERCENT', value: -1.5 }, lineHeight: { unit: 'AUTO' }, fills: [solid(0.1)] }],
        variables: { 'VariableID:1:2': { r: 0.1, g: 0.2, b: 0.3, a: 1 } } } },
      { type: 'VECTOR', props: { visible: true, x: 1e-7, y: 1e21, width: 0.1 + 0.2, height: 12, strokes: [solid(0)], strokeWeight: 1.5, dashPattern: [], vectorPaths: [{ windingRule: 'NONZERO', data: 'M0 0L10 10Z' }], arcData: undefined } },
      { type: 'GROUP', props: { visible: false } },
      { type: 'INSTANCE', props: { visible: true, x: 0, y: 0, width: 48, height: 48, cornerRadius: 'mixed', topLeftRadius: 4 }, children: [] },
    ],
  };
  assert.equal(fingerprint(screen), '2b91cf5dacc837ff5ded8304c0848f18ab1341207496fa0061b5fdfee1a19868');
  assert.equal(legacyFingerprint(screen), 'a3b96ac2c08f9345105a50bb0266172580e6ad5557f85331965c348679306f98');
});
