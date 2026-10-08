// Web Collage v2 공유 서버 (PLAN M6: 읽기 전용 공유 링크)
//  POST   /api/shares          콜라주 사본 올리기 → { id, url, deleteToken, expiresAt }   (익스텐션에서만)
//  GET    /api/shares/:id      사본 JSON (뷰어가 읽음)
//  DELETE /api/shares/:id      공유 중지 (Authorization: Bearer <deleteToken>)
//  GET    /s/:id               정적 뷰어 (DOMPurify + Shadow DOM + CSP 로 렌더)
//
// v1 에서 버린 것: 모든 접속자에게 콘텐츠를 뿌리던 socket.io 브로드캐스트, 500MB 요청, CORS 전체 허용, 인증 없는 생성·조회 남발.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { LIMITS, ValidationError, validatePackage } from './validate.js';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const newId = () => randomBytes(16).toString('base64url'); // 추측 불가 (128bit)

/** 아주 단순한 IP 별 토큰 버킷 (프로세스 메모리). 배포 시 앞단 프록시의 제한을 함께 쓸 것 */
function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'x';
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'too many requests' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

/**
 * @param {{ store: ReturnType<import('./store.js').fileStore>, publicUrl: string, allowedOrigins?: string[], defaultDays?: number, maxDays?: number, rate?: {max: number, windowMs: number} }} opts
 */
export function createApp(opts) {
  const { store, publicUrl } = opts;
  const defaultDays = opts.defaultDays ?? 30;
  const maxDays = opts.maxDays ?? 90;
  // 기본: 크롬 익스텐션 출처만 올리기·지우기 허용. ALLOWED_ORIGINS 로 특정 익스텐션 id 만 허용하도록 좁힐 것
  const allowed = opts.allowedOrigins?.length ? opts.allowedOrigins : null;
  const originOk = (o) => !!o && (allowed ? allowed.includes(o) : /^chrome-extension:\/\/[a-p]{32}$/.test(o));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // CORS: 쓰기(POST/DELETE)는 익스텐션 출처만
  app.use('/api', (req, res, next) => {
    const o = req.headers.origin;
    if (o && originOk(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(o && originOk(o) ? 204 : 403);
    if ((req.method === 'POST' || req.method === 'DELETE') && o && !originOk(o)) return res.status(403).json({ error: 'origin not allowed' });
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true, store: store.kind }));

  app.post(
    '/api/shares',
    rateLimiter(opts.rate || { max: 30, windowMs: 60 * 60 * 1000 }),
    express.json({ limit: LIMITS.bodyBytes }),
    async (req, res, next) => {
      try {
        const pkg = validatePackage(req.body);
        const days = Math.min(maxDays, Math.max(1, Number(req.body.days) || defaultDays));
        const id = newId();
        const deleteToken = randomBytes(24).toString('base64url');
        const now = Date.now();
        const doc = { id, createdAt: now, expiresAt: now + days * DAY, deleteHash: sha256(deleteToken), pkg };
        await store.put(doc);
        res.status(201).json({ id, url: `${publicUrl}/s/${id}`, deleteToken, expiresAt: doc.expiresAt });
      } catch (e) {
        next(e);
      }
    },
  );

  app.get('/api/shares/:id', async (req, res, next) => {
    try {
      const doc = await store.get(req.params.id);
      if (!doc || doc.expiresAt <= Date.now()) return res.status(404).json({ error: 'not found' });
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.json({ id: doc.id, createdAt: doc.createdAt, expiresAt: doc.expiresAt, ...doc.pkg });
    } catch (e) {
      next(e);
    }
  });

  app.delete('/api/shares/:id', async (req, res, next) => {
    try {
      const doc = await store.get(req.params.id);
      if (!doc) return res.status(404).json({ error: 'not found' });
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || '';
      const a = Buffer.from(sha256(token));
      const b = Buffer.from(doc.deleteHash);
      if (!token || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: 'bad token' });
      await store.del(doc.id);
      res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  });

  // ---------------------------------------------------------------- 뷰어 (정적)
  const viewerCsp = [
    "default-src 'none'",
    "script-src 'self'", // 인라인 스크립트 금지 — 조각 HTML 은 DOMPurify 를 거쳐도 실행될 수 없다
    "style-src 'self' 'unsafe-inline'", // 조각 스타일은 인라인으로 굳힌 값
    'img-src data: blob:', // 에셋은 패키지 안 → 원격 이미지 요청(추적 픽셀) 불가
    'font-src data: blob:',
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  const staticDir = join(HERE, '..', 'public');
  app.get('/s/:id', (_req, res) => {
    res.setHeader('Content-Security-Policy', viewerCsp);
    res.sendFile(join(staticDir, 'viewer.html'));
  });
  app.get('/static/purify.min.js', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(require.resolve('dompurify/dist/purify.min.js'));
  });
  app.use('/static', express.static(staticDir, { maxAge: '1h', index: false }));
  app.get('/', (_req, res) => res.type('text/plain; charset=utf-8').send('Web Collage 공유 서버'));

  app.use((err, _req, res, _next) => {
    const status = err instanceof ValidationError ? 400 : err.type === 'entity.too.large' ? 413 : err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });
  return app;
}
