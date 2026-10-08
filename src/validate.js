// 공유 패키지 형식 검사. 크기·개수·형식이 이상하면 거부한다 (보안: 서버는 받은 HTML 을 실행하지 않고 그대로 보관하며,
// 뷰어가 DOMPurify + CSP 로 렌더한다 — 프론트 docs/DECISIONS.md D17).

export const LIMITS = {
  bodyBytes: 25 * 1024 * 1024,
  clips: 300,
  assets: 600,
  clipHtml: 4 * 1024 * 1024,
  title: 200,
  depth: 6,
  nodes: 2000,
};

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isId = (v) => typeof v === 'string' && /^[\w-]{1,80}$/.test(v);
const isAssetId = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

export class ValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.status = 400;
  }
}

function fail(msg) {
  throw new ValidationError(msg);
}

function checkTree(node, depth, counter) {
  if (++counter.n > LIMITS.nodes) fail('too many nodes');
  if (depth > LIMITS.depth) fail('tree too deep');
  if (!node || typeof node !== 'object') fail('bad node');
  if (!isId(node.id)) fail('bad node id');
  if (node.kind === 'box') {
    if (node.title !== undefined && !isStr(node.title, LIMITS.title)) fail('bad box title');
    if (node.direction !== 'row' && node.direction !== 'column') fail('bad direction');
    if (!Array.isArray(node.children)) fail('bad children');
    node.children.forEach((c) => checkTree(c, depth + 1, counter));
  } else if (node.kind === 'block') {
    if (node.type !== 'clip' && node.type !== 'note') fail('bad block type');
    if (node.clipId !== undefined && !isId(node.clipId)) fail('bad clip id');
    if (node.note !== undefined && !isStr(node.note, 100_000)) fail('bad note');
  } else fail('bad node kind');
}

/** @returns {{ title: string, theme: string, root: object, clips: Record<string, object>, assets: Record<string, {mime: string, data: string}> }} */
export function validatePackage(p) {
  if (!p || typeof p !== 'object' || p.v !== 1) fail('bad package version');
  if (!isStr(p.title, LIMITS.title)) fail('bad title');
  if (!['light', 'dark', 'sepia'].includes(p.theme)) fail('bad theme');
  checkTree(p.root, 0, { n: 0 });
  if (p.root.kind !== 'box') fail('root must be a box');
  if (!p.clips || typeof p.clips !== 'object') fail('bad clips');
  const clipIds = Object.keys(p.clips);
  if (clipIds.length > LIMITS.clips) fail('too many clips');
  for (const id of clipIds) {
    const c = p.clips[id];
    if (!isId(id) || !c || typeof c !== 'object') fail('bad clip');
    if (!isStr(c.html, LIMITS.clipHtml) || !isStr(c.css || '', LIMITS.clipHtml) || !isStr(c.defs || '', LIMITS.clipHtml)) fail('bad clip html');
    if (typeof c.width !== 'number' || typeof c.height !== 'number') fail('bad clip size');
    if (!Array.isArray(c.fontFaces) || c.fontFaces.some((f) => !isStr(f, 100_000))) fail('bad font faces');
    if (!c.source || typeof c.source !== 'object' || !isStr(c.source.url || '', 8192) || !isStr(c.source.title || '', 2000)) fail('bad source');
  }
  if (!p.assets || typeof p.assets !== 'object') fail('bad assets');
  const assetIds = Object.keys(p.assets);
  if (assetIds.length > LIMITS.assets) fail('too many assets');
  for (const id of assetIds) {
    const a = p.assets[id];
    if (!isAssetId(id) || !a || !isStr(a.mime, 100) || typeof a.data !== 'string') fail('bad asset');
    // 이미지·폰트만 (뷰어 CSP 도 data:/blob: 만 허용)
    if (!/^(image\/|font\/|application\/(font|x-font|octet-stream|vnd\.ms-fontobject))/i.test(a.mime)) fail('bad asset mime');
    if (!/^[A-Za-z0-9+/=]*$/.test(a.data)) fail('bad asset data');
  }
  return { title: p.title, theme: p.theme, root: p.root, clips: p.clips, assets: p.assets };
}
