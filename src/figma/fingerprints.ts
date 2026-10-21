import { COPY } from '../core/copy.ts';
import { fingerprint, legacyFingerprint } from '../core/fingerprint.ts';
import { screenTokens } from '../core/versionMatch.ts';
import type { FingerprintReader } from '../host.ts';
import { Snapshotter } from './snapshot.ts';

function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current as PageNode | null;
}

// 스캔 한 번의 변수 조회 캐시를 공유하고, 구형 비교 기준이 있는 화면만 두 번째 해시를 계산한다.
export function createFingerprintReader(sceneNode: (nodeId: string) => Promise<SceneNode | null>): FingerprintReader {
  const snapshotter = new Snapshotter();
  return {
    async fingerprint(nodeId, includeLegacy = true) {
      try {
        const node = await sceneNode(nodeId);
        if (!node) return { fingerprint: null, error: COPY.figmaHost005 };
        const snapshot = await snapshotter.snapshot(node);
        return {
          fingerprint: fingerprint(snapshot),
          ...(includeLegacy ? { legacyFingerprint: legacyFingerprint(snapshot) } : {}),
          error: null,
        };
      } catch (e) {
        return { fingerprint: null, error: `${COPY.figmaHost006} ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    async screenFeatures(nodeId, includeLegacy = true) {
      try {
        const node = await sceneNode(nodeId);
        if (!node) return { fingerprint: null, tokens: null, error: COPY.figmaHost005 };
        await pageOf(node)?.loadAsync();
        const snapshot = await snapshotter.snapshot(node);
        return {
          fingerprint: fingerprint(snapshot),
          ...(includeLegacy ? { legacyFingerprint: legacyFingerprint(snapshot) } : {}),
          tokens: screenTokens(snapshot), name: node.name, error: null,
        };
      } catch (e) {
        return { fingerprint: null, tokens: null, error: `${COPY.figmaHost006} ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}
