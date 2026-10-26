import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { COPY } from '../src/core/copy.ts';
import { PDF_IMAGE_SCALE, pdfFileName } from '../src/core/pdf.ts';
import { exportPdfPages, pdfSelection } from '../src/figma/pdf.ts';
import { buildPdf } from '../src/ui/pdfView.ts';

class Node {
  visible = true;
  parent: Node | null = null;
  children: Node[] = [];
  x = 0;
  y = 0;
  width = 1000;
  baseHeight = 800;
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
  // 오토 레이아웃처럼 숨긴 자식(UI Title·이력 각 100)만큼 높이가 준다.
  get height() { return this.baseHeight - this.children.filter(c => !c.visible && c.name !== 'Description').length * 100; }
  get absoluteBoundingBox() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  at(x: number, y: number, height = 800) { this.x = x; this.y = y; this.baseHeight = height; return this; }
  async exportAsync(settings: { format: string; constraint?: { type: string; value: number } }) {
    assert.deepEqual(settings, { format: 'JPG', constraint: { type: 'SCALE', value: PDF_IMAGE_SCALE } });
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
const progress = async () => true;

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
  assert.deepEqual(pages?.map(p => p.name), ['row1-left', 'row1-right', 'row2-left', 'row2-right']);
});

test('UI Title·Update History List는 내보내는 동안만 숨기고, 쪽 크기는 숨긴 뒤의 프레임 크기다', async () => {
  const frame = flipbook('fb');
  const history = frame.children[3];
  history.visible = false;
  setup([frame]);
  const pages = await exportPdfPages(progress);
  assert.deepEqual(frame.exported, ['GUI Image Slot', 'copy', 'UI Title', 'Description']);
  assert.deepEqual(pages?.map(p => [p.width, p.height]), [[1000, 600]]);
  assert.equal(frame.children[0].visible, true);
  assert.equal(history.visible, false, '원래 숨겨 둔 요소는 그대로 둔다');
});

test('두 요소가 없는 프레임도 그대로 내보내고, 내보내기에 실패해도 숨긴 요소를 되돌린다', async () => {
  const plain = new Node('FRAME', 'plain', [new Node('TEXT', 'body')]);
  const broken = flipbook('broken');
  broken.fail = true;
  setup([plain]);
  assert.deepEqual((await exportPdfPages(progress))?.map(p => p.name), ['plain']);
  assert.deepEqual(plain.exported, ['body']);
  setup([broken]);
  await assert.rejects(exportPdfPages(progress), /export failed/);
  assert.ok(broken.children.every(child => child.visible));
  setup([new Node('TEXT', 'note')]);
  await assert.rejects(exportPdfPages(progress), new Error(COPY.pdf004));
});

test('취소하면 다음 프레임을 내보내지 않고 null을 돌려주며, 캔버스는 원래대로다', async () => {
  const frames = [flipbook('a').at(0, 0), flipbook('b').at(1200, 0), flipbook('c').at(2400, 0)];
  setup(frames);
  const asked: number[] = [];
  const pages = await exportPdfPages(async done => { asked.push(done); return done < 1; });
  assert.equal(pages, null);
  assert.deepEqual(asked, [0, 1]);
  assert.deepEqual(frames.map(f => !!f.exported), [true, false, false]);
  assert.ok(frames.every(f => f.children.every(child => child.visible)));
});

test('파일 이름은 페이지 이름에서 쓸 수 없는 글자를 바꾼다', () => {
  assert.equal(pdfFileName('UI Flipbook / EPG: v2'), 'UI Flipbook _ EPG_ v2.pdf');
  assert.equal(pdfFileName(' .. '), 'flipbook.pdf');
});

// 실제 Figma가 4×3 프레임을 2배 JPG로 내보낸 파일(8×6px)
const FIGMA_JPG = Buffer.from('/9j/4AAQSkZJRgABAgEAkACQAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAGAAgDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4Sr/d0/zxAP/Z', 'base64');

test('받은 JPG를 순서대로 한 쪽에 한 장씩, 프레임 크기의 쪽으로 묶고 취소하면 만들지 않는다', async () => {
  const bytes = new Uint8Array(FIGMA_JPG);
  const pages = [{ name: 'a', bytes, width: 4, height: 3 }, { name: 'b', bytes, width: 400, height: 300 }];
  const doc = await PDFDocument.load((await buildPdf(pages))!);
  assert.deepEqual(doc.getPages().map(p => [p.getWidth(), p.getHeight()]), [[4, 3], [400, 300]]);
  let calls = 0;
  assert.equal(await buildPdf(pages, () => ++calls > 1), null);
});
