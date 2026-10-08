import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const ASSET = 'a'.repeat(64);
let server, base, dir, store;

const pkg = (over = {}) => ({
  v: 1,
  title: '공유 테스트',
  theme: 'light',
  root: { kind: 'box', id: 'root', direction: 'column', children: [{ kind: 'box', id: 'b1', title: 'Box 1', direction: 'column', children: [{ kind: 'block', id: 'k1', type: 'clip', clipId: 'c1', display: 'fit' }] }] },
  clips: { c1: { html: '<div data-wc-root><img src="wc-asset:' + ASSET + '"></div>', css: '', defs: '', width: 300, height: 100, fontFaces: [], source: { url: 'https://example.com/', title: 'Ex' } } },
  assets: { [ASSET]: { mime: 'image/png', data: 'iVBORw0KGgo=' } },
  ...over,
});

const post = (body, origin = EXT) =>
  fetch(`${base}/api/shares`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wc-share-'));
  store = fileStore(dir);
  await store.init();
  const app = createApp({ store, publicUrl: 'http://share.test', rate: { max: 5, windowMs: 60_000 } });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

test('올리기 → 읽기 → 지우기', async () => {
  const r = await post(pkg());
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), EXT);
  const { id, url, deleteToken, expiresAt } = await r.json();
  assert.match(id, /^[\w-]{22}$/);
  assert.equal(url, `http://share.test/s/${id}`);
  assert.ok(expiresAt > Date.now() + 29 * 86400_000);

  const g = await fetch(`${base}/api/shares/${id}`);
  assert.equal(g.status, 200);
  const got = await g.json();
  assert.equal(got.title, '공유 테스트');
  assert.equal(got.deleteHash, undefined, '지우기 토큰 해시는 내보내지 않음');

  assert.equal((await fetch(`${base}/api/shares/${id}`, { method: 'DELETE', headers: { origin: EXT, authorization: 'Bearer wrong' } })).status, 403);
  assert.equal((await fetch(`${base}/api/shares/${id}`, { method: 'DELETE', headers: { origin: EXT, authorization: `Bearer ${deleteToken}` } })).status, 204);
  assert.equal((await fetch(`${base}/api/shares/${id}`)).status, 404);
});

test('익스텐션이 아닌 출처는 올릴 수 없음', async () => {
  assert.equal((await post(pkg(), 'https://evil.test')).status, 403);
});

test('형식 검사: 잘못된 패키지·에셋 거부', async () => {
  assert.equal((await post({ ...pkg(), v: 2 })).status, 400);
  assert.equal((await post(pkg({ assets: { [ASSET]: { mime: 'text/html', data: 'PHNjcmlwdD4=' } } }))).status, 400);
  assert.equal((await post(pkg({ assets: { 'not-a-hash': { mime: 'image/png', data: '' } } }))).status, 400);
  assert.equal((await post(pkg({ theme: 'neon' }))).status, 400);
});

test('뷰어는 CSP 로 스크립트·원격 요청을 막는다', async () => {
  const r = await fetch(`${base}/s/anything`);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /img-src data: blob:/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(await r.text(), /purify\.min\.js/);
  assert.equal((await fetch(`${base}/static/purify.min.js`)).status, 200);
});

test('만료된 공유는 보이지 않고 정리된다', async () => {
  const id = 'expiredexpiredexpired0';
  await store.put({ id, createdAt: 0, expiresAt: Date.now() - 1, deleteHash: 'x', pkg: pkg() });
  assert.equal((await fetch(`${base}/api/shares/${id}`)).status, 404);
  assert.ok((await store.purgeExpired()) >= 1);
  assert.equal(await store.get(id), null);
});

test('요청 횟수 제한', async () => {
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await post({ bad: true })).status;
  assert.equal(last, 429);
});
