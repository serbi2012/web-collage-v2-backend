// 실행: npm start
// 환경변수
//   PORT              (기본 8080)
//   PUBLIC_URL        공유 링크에 쓸 바깥 주소 (기본 http://localhost:PORT)
//   DATA_DIR          파일 저장소 폴더 (기본 ./data)
//   MONGODB_URI       있으면 MongoDB 저장소 (DB 이름 MONGODB_DB, 기본 web-collage)
//   ALLOWED_ORIGINS   올리기·지우기를 허락할 출처 (쉼표 구분, 예: chrome-extension://<웹스토어 id>). 비우면 모든 크롬 익스텐션
//   SHARE_DAYS        기본 보관 일수 (기본 30, 최대 90)
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { fileStore, mongoStore } from './store.js';

const port = Number(process.env.PORT || 8080);
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
const store = process.env.MONGODB_URI ? await mongoStore(process.env.MONGODB_URI, process.env.MONGODB_DB) : fileStore(process.env.DATA_DIR || './data');
await store.init();

const app = createApp({
  store,
  publicUrl,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  defaultDays: Number(process.env.SHARE_DAYS || 30),
});
const server = createServer(app).listen(port, () => console.log(`Web Collage 공유 서버: ${publicUrl} (저장소: ${store.kind})`));

// 만료된 공유 정리 (한 시간마다)
const timer = setInterval(() => store.purgeExpired().catch((e) => console.error('purge', e)), 60 * 60 * 1000);
const stop = async () => {
  clearInterval(timer);
  server.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
