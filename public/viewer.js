// 공유 뷰어: 남이 공유한 콘텐츠이므로 조각 HTML 은 반드시 DOMPurify 를 거치고(D17), 페이지 CSP 가 스크립트·원격 요청을 막는다.
/* global DOMPurify */
const app = document.getElementById('app');
const id = location.pathname.split('/').pop();
const ASSET_RE = /wc-asset:([0-9a-f]{64})/g;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});
const PURIFY = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'script'],
  ALLOW_DATA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/|#)/i,
};

async function main() {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`);
  if (!res.ok) {
    app.innerHTML = `<p class="status">${res.status === 404 ? '없거나 기간이 끝난 공유 링크입니다.' : '불러오지 못했습니다.'}</p>`;
    return;
  }
  const pkg = await res.json();
  document.documentElement.dataset.theme = pkg.theme || 'light';
  document.title = `${pkg.title} — Web Collage`;
  const asset = (aid) => {
    const a = pkg.assets[aid];
    return a ? `data:${a.mime};base64,${a.data}` : '';
  };
  const withAssets = (text) => (text || '').replace(ASSET_RE, (_m, aid) => asset(aid));

  // 웹폰트 (Shadow DOM 안의 @font-face 는 무시되므로 문서에)
  const fonts = document.createElement('style');
  fonts.textContent = Object.values(pkg.clips)
    .flatMap((c) => c.fontFaces || [])
    .map(withAssets)
    .join('\n');
  document.head.appendChild(fonts);

  app.innerHTML = '';
  const header = document.createElement('header');
  header.innerHTML = `<h1>${esc(pkg.title)}</h1><p>Web Collage 로 만든 읽기 전용 콜라주 · ${new Date(pkg.createdAt).toLocaleDateString('ko-KR')} 공유 · ${new Date(pkg.expiresAt).toLocaleDateString('ko-KR')} 까지 · 각 조각의 출처는 아래에 표시됩니다</p>`;
  app.appendChild(header);
  app.appendChild(renderBox(pkg.root, 0));
  const footer = document.createElement('footer');
  footer.textContent = '조각의 저작권은 각 출처에 있습니다.';
  app.appendChild(footer);

  function renderBox(b, depth) {
    const kids = document.createElement('div');
    kids.className = `kids dir-${b.direction === 'row' ? 'row' : 'column'}`;
    for (const c of b.children) kids.appendChild(c.kind === 'box' ? renderBox(c, depth + 1) : renderBlock(c));
    if (depth === 0) return kids;
    const sec = document.createElement('section');
    sec.className = 'box';
    if (b.title) {
      const h = document.createElement('h2');
      h.textContent = b.title;
      sec.appendChild(h);
    }
    sec.appendChild(kids);
    return sec;
  }

  function renderBlock(n) {
    const fig = document.createElement('figure');
    fig.className = 'block';
    if (n.type === 'note') {
      const d = document.createElement('div');
      d.className = 'note';
      d.textContent = n.note || '';
      fig.appendChild(d);
      return fig;
    }
    const clip = pkg.clips[n.clipId];
    if (!clip) return fig;
    const hostEl = document.createElement('div');
    hostEl.className = 'clip';
    const sr = hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    const bg = n.bg !== false && clip.bgCss ? clip.bgCss : '';
    style.textContent = `:host{all:initial;display:block;overflow:${n.display === 'original' ? 'auto' : 'hidden'}} .wrap{width:${clip.width ? clip.width + 'px' : 'auto'};${withAssets(bg)}} ${withAssets(clip.css)}`;
    sr.appendChild(style);
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = DOMPurify.sanitize(withAssets(clip.defs) + withAssets(clip.html), PURIFY);
    sr.appendChild(wrap);
    fig.appendChild(hostEl);
    if (n.display !== 'original' && clip.width) {
      new ResizeObserver(() => {
        const w = hostEl.clientWidth;
        wrap.style.zoom = String(clip.width > w ? w / clip.width : 1);
      }).observe(hostEl);
    }
    const src = clip.source || {};
    if (/^https?:/i.test(src.url || '')) {
      const cap = document.createElement('figcaption');
      cap.innerHTML = `출처: <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title || host(src.url))}</a> · ${esc(host(src.url))}`;
      fig.appendChild(cap);
    }
    return fig;
  }
}

main().catch((e) => {
  app.innerHTML = '<p class="status">표시하지 못했습니다.</p>';
  console.error(e);
});
