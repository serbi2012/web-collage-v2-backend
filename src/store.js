// 저장소: 기본은 파일(설정 없이 바로 실행), MONGODB_URI 가 있으면 MongoDB (v1 과 같은 DB 를 계속 쓸 수 있게).
// 어느 쪽이든 문서 = { id, createdAt, expiresAt, deleteHash, pkg } 하나.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function fileStore(dir) {
  const path = (id) => join(dir, `${id}.json`);
  return {
    kind: 'file',
    async init() {
      await mkdir(dir, { recursive: true });
    },
    async put(doc) {
      await writeFile(path(doc.id), JSON.stringify(doc));
    },
    async get(id) {
      try {
        return JSON.parse(await readFile(path(id), 'utf8'));
      } catch {
        return null;
      }
    },
    async del(id) {
      await rm(path(id), { force: true });
    },
    async purgeExpired(now = Date.now()) {
      let n = 0;
      for (const f of await readdir(dir).catch(() => [])) {
        if (!f.endsWith('.json')) continue;
        const id = f.slice(0, -5);
        const doc = await this.get(id);
        if (!doc || doc.expiresAt <= now) {
          await this.del(id);
          n++;
        }
      }
      return n;
    },
    async close() {},
  };
}

export async function mongoStore(uri, dbName = 'web-collage') {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);
  const col = () => client.db(dbName).collection('shares');
  return {
    kind: 'mongo',
    async init() {
      await client.connect();
      // 만료 문서는 MongoDB TTL 인덱스가 지운다
      await col().createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
    },
    async put(doc) {
      await col().insertOne({ _id: doc.id, ...doc, expiresAtDate: new Date(doc.expiresAt) });
    },
    async get(id) {
      const d = await col().findOne({ _id: id });
      if (!d) return null;
      const { _id, expiresAtDate, ...rest } = d;
      return rest;
    },
    async del(id) {
      await col().deleteOne({ _id: id });
    },
    async purgeExpired(now = Date.now()) {
      const r = await col().deleteMany({ expiresAt: { $lte: now } });
      return r.deletedCount;
    },
    async close() {
      await client.close();
    },
  };
}
