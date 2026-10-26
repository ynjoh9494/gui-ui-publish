import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { COPY } from '../src/core/copy.ts';
import { pdfFileName } from '../src/core/pdf.ts';
import { exportPdfPages, pdfSelection } from '../src/figma/pdf.ts';
import { mergePdfPages } from '../src/ui/pdfView.ts';

class Node {
  visible = true;
  parent: Node | null = null;
  children: Node[] = [];
  x = 0;
  y = 0;
  width = 1000;
  height = 800;
  // 내보낼 때 보이던 레이어 이름. 실패를 흉내 내려면 fail을 켠다.
  exported: string[] | null = null;
  fail = false;
  type: string;
  name: string;
  constructor(type: string, name: string, children: Node[] = []) {
    this.type = type;
    this.name = name;
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  get absoluteBoundingBox() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  at(x: number, y: number, height = 800) { this.x = x; this.y = y; this.height = height; return this; }
  async exportAsync(settings: { format: string }) {
    assert.equal(settings.format, 'PDF');
    if (this.fail) throw new Error('export failed');
    const visible: string[] = [];
    const walk = (node: Node) => { for (const child of node.children) if (child.visible) { visible.push(child.name); walk(child); } };
    walk(this);
    this.exported = visible;
    return new TextEncoder().encode(this.name);
  }
}

// 템플릿처럼 UI Title·Update History List가 있고, GUI 영역 안 복사본에도 같은 이름의 레이어가 있는 플립북
function flipbook(name: string) {
  return new Node('FRAME', name, [
    new Node('INSTANCE', 'UI Title'),
    new Node('FRAME', 'GUI Image Slot', [new Node('FRAME', 'copy', [new Node('INSTANCE', 'UI Title')])]),
    new Node('FRAME', 'Description'),
    new Node('INSTANCE', 'Update History List'),
  ]);
}

const setup = (selection: Node[]) => { (globalThis as any).figma = { currentPage: { name: 'Page', selection } }; };
const progress = async () => {};

test('PDF 저장은 고른 프레임을 왼쪽 위에서 오른쪽 아래 순서로 내보내고, 프레임이 아닌 레이어는 빼고 센다', async () => {
  const frames = [
    flipbook('row2-left').at(0, 1200),
    flipbook('row1-right').at(2400, 30),
    new Node('TEXT', 'note'),
    flipbook('row1-left').at(1200, 0),
    flipbook('row2-right').at(1200, 1150),
  ];
  setup(frames);
  assert.deepEqual(pdfSelection(), { frames: 4, others: 1 });
  const pages = await exportPdfPages(progress);
  assert.deepEqual(pages.map(p => p.name), ['row1-left', 'row1-right', 'row2-left', 'row2-right']);
});

test('UI Title·Update History List는 내보내는 동안만 숨기고, GUI 영역 안 복사본과 원래 숨긴 레이어는 그대로 둔다', async () => {
  const frame = flipbook('fb');
  const history = frame.children[3];
  history.visible = false;
  setup([frame]);
  await exportPdfPages(progress);
  assert.deepEqual(frame.exported, ['GUI Image Slot', 'copy', 'UI Title', 'Description']);
  assert.equal(frame.children[0].visible, true);
  assert.equal(history.visible, false);
});

test('두 요소가 없는 프레임도 그대로 내보내고, 내보내기에 실패해도 숨긴 요소를 되돌린다', async () => {
  const plain = new Node('FRAME', 'plain', [new Node('TEXT', 'body')]);
  const broken = flipbook('broken');
  broken.fail = true;
  setup([plain]);
  assert.deepEqual((await exportPdfPages(progress)).map(p => p.name), ['plain']);
  assert.deepEqual(plain.exported, ['body']);
  setup([broken]);
  await assert.rejects(exportPdfPages(progress), /export failed/);
  assert.ok(broken.children.every(child => child.visible));
  setup([new Node('TEXT', 'note')]);
  await assert.rejects(exportPdfPages(progress), new Error(COPY.pdf004));
});

test('파일 이름은 페이지 이름에서 쓸 수 없는 글자를 바꾼다', () => {
  assert.equal(pdfFileName('UI Flipbook / EPG: v2'), 'UI Flipbook _ EPG_ v2.pdf');
  assert.equal(pdfFileName(' .. '), 'flipbook.pdf');
});

test('내보낸 쪽을 순서대로 한 PDF로 합친다', async () => {
  const page = async (width: number) => {
    const doc = await PDFDocument.create();
    doc.addPage([width, 100]);
    return { name: String(width), bytes: await doc.save() };
  };
  const merged = await PDFDocument.load(await mergePdfPages([await page(300), await page(200), await page(100)]));
  assert.deepEqual(merged.getPages().map(p => p.getWidth()), [300, 200, 100]);
  const single = await page(50);
  assert.equal(await mergePdfPages([single]), single.bytes);
});
