import { COPY } from '../core/copy.ts';

class TextReadError extends Error {}

// Figma can throw inside a node getter or a range API without identifying the
// layer. Keep the first failing layer when higher-level readers catch it again.
export function readingText<T>(node: BaseNode, part: string, read: () => T): T {
  try { return read(); }
  catch (error) {
    if (error instanceof TextReadError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const failure = new TextReadError(`${COPY.textReadFailed} · ${part} · ${node.name} (${node.id}): ${detail}`);
    if (error instanceof Error && error.stack) failure.stack += `\n${error.stack}`;
    throw failure;
  }
}

export function textCharacters(node: TextNode): string {
  return readingText(node, COPY.textReadCharacters, () => {
    const value = node.characters;
    if (typeof value !== 'string') throw new Error(COPY.textReadCharactersMissing);
    return value;
  });
}
