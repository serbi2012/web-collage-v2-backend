# Web Collage v2 — 공유 서버

[Web Collage v2](https://github.com/serbi2012/web-collage-v2-frontend) 의 **읽기 전용 공유 링크** 서버 (PLAN M6).
콜라주 본체는 익스텐션 안(IndexedDB)에 있고, 사용자가 "공유"를 누른 콜라주의 **사본만** 여기에 올라옵니다.

## API
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/shares` | 콜라주 사본 올리기 (크롬 익스텐션 출처만) → `{ id, url, deleteToken, expiresAt }` |
| GET | `/api/shares/:id` | 사본 JSON |
| DELETE | `/api/shares/:id` | 공유 중지 (`Authorization: Bearer <deleteToken>`) |
| GET | `/s/:id` | 정적 뷰어 (DOMPurify + Shadow DOM + 엄격한 CSP) |

## 보안
- 링크 id 128비트 무작위, 지우기 토큰은 해시만 저장, 기본 30일(최대 90일) 뒤 자동 삭제
- 올리기·지우기는 `chrome-extension://` 출처만 (`ALLOWED_ORIGINS` 로 웹스토어 id 하나로 좁힐 것), IP 별 요청 횟수 제한
- 요청 25MB 제한, 패키지 형식 검사(이미지·폰트 에셋만)
- 뷰어 CSP: 인라인 스크립트 금지, 이미지·폰트는 `data:`/`blob:` 만 → 원격 추적 요청 불가
- v1 의 전체 브로드캐스트 소켓(남의 콜라주가 모든 접속자에게 전송되던 문제)은 제거

## 실행
```bash
npm install
npm start            # http://localhost:8080 , 파일 저장소 ./data
npm test
```
환경변수: `PORT`, `PUBLIC_URL`, `DATA_DIR`, `MONGODB_URI`(있으면 MongoDB, TTL 인덱스로 만료 삭제), `MONGODB_DB`, `ALLOWED_ORIGINS`, `SHARE_DAYS`.

배포처(Cloudflare·Fly.io·Render 등)와 비용·약관은 소유자 결정 사항입니다 (PLAN M6 완료 기준).
