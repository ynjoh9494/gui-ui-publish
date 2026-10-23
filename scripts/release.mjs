// 팀 배포. 버전 태그(v1.2.3)를 push하면 GitHub Actions(.github/workflows/release.yml)가 이 스크립트로 검사·빌드하고,
// manifest.json·dist(code.js, ui.html)·사용 안내를 zip 하나로 묶어 GitHub Release에 올린다.
// 팀원은 항상 https://github.com/{REPO}/releases/latest/download/GUIUIPublish.zip 으로 최신본을 받는다.
// 사용: npm run release                     검사 후 다음 패치 버전 태그를 만들어 push(첫 배포는 1.0.0)
//       npm run release -- 1.2.0            버전 지정
//       npm run release -- --notes "설명"   릴리스 설명(태그 메시지로 남아 Release 본문에 들어간다)
//       npm run release -- --notes-file notes.md   여러 줄 설명은 파일로 넘긴다(Windows의 npm은 인자의 첫 줄만 넘긴다)
//       npm run release -- --dry-run        zip만 만들고 올리지 않음(커밋 안 된 변경도 허용)
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

const REPO = process.env.GITHUB_REPOSITORY ?? 'ynjoh9494/gui-ui-publish';
const ASSET = 'GUIUIPublish.zip';
const GUIDE = 'GUIUIPublish-Guide.html';
const OUT = `dist/${ASSET}`;
const LATEST = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const inActions = process.env.GITHUB_ACTIONS === 'true';
const valueOf = flag => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
const valueAt = new Set(['--notes', '--notes-file'].map(flag => args.indexOf(flag)).filter(at => at >= 0).map(at => at + 1));
const versionArg = args.find((a, i) => !a.startsWith('--') && !valueAt.has(i));

// stdio: 'inherit'로 실행하면 출력을 돌려받지 않아 null이다.
const run = (file, list, options = {}) => (execFileSync(file, list, { encoding: 'utf8', ...options }) ?? '').trim();
const fail = message => { console.error(`\n배포 중단: ${message}`); process.exit(1); };
const check = () => execSync('npm run check', { stdio: 'inherit' });
const notesArg = notes();

// 릴리스 설명. 파일은 UTF-8로 읽고 줄바꿈을 LF로 맞춘다.
function notes() {
  const file = valueOf('--notes-file');
  if (file === undefined) return valueOf('--notes');
  try { return readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim(); }
  catch { fail(`설명 파일을 읽지 못했습니다: ${file}`); }
}

if (inActions) await publish();
else if (dryRun) { check(); build(versionArg ? `v${versionArg.replace(/^v/, '')}` : 'v0.0.0-dev'); }
else pushTag();

// 로컬: main이 원격과 같고 깨끗한지 확인하고, 검사를 통과하면 태그를 만들어 push한다.
function pushTag() {
  if (run('git', ['status', '--porcelain'])) fail('커밋하지 않은 변경이 있습니다. 커밋한 뒤 배포하세요.');
  if (run('git', ['branch', '--show-current']) !== 'main') fail('main 브랜치에서 배포하세요.');
  run('git', ['fetch', '--quiet', '--tags', 'origin', 'main']);
  if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) fail('main을 먼저 push하세요(로컬과 origin/main이 다릅니다).');
  let version = versionArg?.replace(/^v/, '');
  if (!version) {
    const m = run('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n')[0].match(/^v(\d+)\.(\d+)\.(\d+)$/);
    version = m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0';
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`버전은 1.2.3 형식이어야 합니다: ${version}`);
  const tag = `v${version}`;
  if (run('git', ['tag', '--list', tag])) fail(`${tag} 태그가 이미 있습니다.`);
  check();
  run('git', ['tag', '-a', tag, '-m', notesArg ?? `GUI·UI Publish ${tag}`]);
  run('git', ['push', 'origin', tag], { stdio: 'inherit' });
  console.log(`\n${tag} 태그를 push했습니다. GitHub Actions가 빌드해 Release에 올립니다.\n진행: https://github.com/${REPO}/actions\n최신 버전 링크: ${LATEST}`);
}

// 사용 안내에 버전·날짜·링크를 채우고 release/screens의 그림을 HTML 안에 넣어 zip을 만든다.
function build(tag) {
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const guide = readFileSync('release/guide.html', 'utf8')
    .replaceAll('{{VERSION}}', tag)
    .replaceAll('{{DATE}}', date)
    .replaceAll('{{DOWNLOAD_URL}}', LATEST)
    .replaceAll('{{REPO_URL}}', `https://github.com/${REPO}/releases/latest`)
    .replace(/src="(screens\/[\w-]+\.png)"/g, (_, file) => `src="data:image/png;base64,${readFileSync(`release/${file}`).toString('base64')}"`);
  // 맨 위에 폴더를 두지 않는다. Windows·macOS 압축 풀기가 zip 이름으로 폴더를 만들어 준다.
  writeFileSync(OUT, zip([
    ['manifest.json', readFileSync('manifest.json')],
    ['dist/code.js', readFileSync('dist/code.js')],
    ['dist/ui.html', readFileSync('dist/ui.html')],
    [GUIDE, Buffer.from(guide, 'utf8')],
  ]));
  console.log(`\n${OUT} (${tag})`);
}

// GitHub Actions: 태그의 커밋으로 검사·빌드하고, 초안 Release에 zip을 올린 뒤 공개한다.
// 업로드가 실패하면 초안을 지워 빈 릴리스가 최신이 되지 않게 한다.
async function publish() {
  const tag = process.env.GITHUB_REF_NAME;
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) fail(`버전 태그(v1.2.3)에서만 배포합니다: ${tag}`);
  const api = async (method, url, body, headers = {}) => {
    const res = await fetch(url.startsWith('https://') ? url : `https://api.github.com${url}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'guiuipublish-release', ...headers },
      body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  if (await api('GET', `/repos/${REPO}/releases/tags/${tag}`)) fail(`${tag} 릴리스가 이미 있습니다.`);
  check();
  build(tag);
  // 주석 태그면 태그 메시지를 릴리스 설명으로 쓴다.
  const ref = await api('GET', `/repos/${REPO}/git/ref/tags/${tag}`);
  const message = ref?.object.type === 'tag' ? (await api('GET', `/repos/${REPO}/git/tags/${ref.object.sha}`)).message.trim() : '';
  const notes = message && message !== `GUI·UI Publish ${tag}` ? `${message}\n\n` : '';
  const body = `${notes}설치·업데이트 방법은 zip 안의 ${GUIDE}를 확인하세요.\n\n커밋 ${process.env.GITHUB_SHA.slice(0, 7)}`;
  const release = await api('POST', `/repos/${REPO}/releases`, { tag_name: tag, name: `GUI·UI Publish ${tag}`, body, draft: true });
  try {
    await api('POST', `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${ASSET}`, readFileSync(OUT), { 'Content-Type': 'application/zip' });
    const published = await api('PATCH', `/repos/${REPO}/releases/${release.id}`, { draft: false, make_latest: 'true' });
    console.log(`\n배포 완료: ${published.html_url}\n최신 버전 링크: ${LATEST}`);
  } catch (error) {
    await api('DELETE', `/repos/${REPO}/releases/${release.id}`).catch(() => {});
    fail(error.message);
  }
}

// 최소 zip 작성기(deflate, UTF-8 파일 이름). 외부 의존성 없이 Windows·macOS 기본 압축 풀기와 호환된다.
function zip(entries) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const file = Buffer.from(name, 'utf8');
    const body = deflateRawSync(data, { level: 9 });
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(day, 12);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(file.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    head.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    parts.push(head, file, body);
    central.push(entry, file);
    offset += head.length + file.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
