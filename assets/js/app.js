/* PAYLOG — public site logic (home + article), no dependencies */
(function () {
  'use strict';

  /* ---------------- utils ---------------- */

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.length <= 10 ? 'T12:00:00' : ''));
    if (isNaN(d)) return '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  async function loadJSON(path) {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function safeUrl(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (/^(https?:|mailto:)/i.test(s)) return s;
    return '';
  }

  /* markdown-lite: ##, ###, lists, quotes, bold, links, code */
  function md(src) {
    const lines = esc(src || '').replace(/\r\n/g, '\n').split('\n');
    let out = '';
    let list = null; // 'ul' | 'ol'
    const closeList = () => { if (list) { out += `</${list}>`; list = null; } };

    const inline = (t) => t
      .replace(/\[([^\]]+)\]\((?:javascript|data|vbscript):[^)]*\)/gi, '$1')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^()\s]+)\)/g, (m, label, url) =>
        safeUrl(url).replace(/&amp;/g, '&')
          ? `<a href="${safeUrl(url)}" target="_blank" rel="noopener nofollow">${label}</a>`
          : label);

    for (const raw of lines) {
      const line = raw.trim();

      if (!line) { closeList(); continue; }
      if (/^---+$/.test(line)) { closeList(); out += '<hr>'; continue; }

      if (line.startsWith('### ')) { closeList(); out += `<h3>${inline(line.slice(4))}</h3>`; continue; }
      if (line.startsWith('## ')) { closeList(); out += `<h2>${inline(line.slice(3))}</h2>`; continue; }
      if (line.startsWith('&gt; ')) { closeList(); out += `<blockquote>${inline(line.slice(5))}</blockquote>`; continue; }

      if (/^[-*]\s+/.test(line)) {
        if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; }
        out += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`;
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; }
        out += `<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`;
        continue;
      }
      closeList();
      out += `<p>${inline(line)}</p>`;
    }
    closeList();
    return out;
  }

  /* ---------------- video ---------------- */

  function parseVideo(url) {
    const u = safeUrl(url);
    if (!u) return null;
    let m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
    if (m) return { type: 'youtube', id: m[1] };
    m = u.match(/vk(?:video)?\.(?:com|ru)\/.*?(?:video|clip)(-?\d+)_(\d+)/i);
    if (m) return { type: 'vk', oid: m[1], id: m[2] };
    m = u.match(/rutube\.ru\/(?:video|play\/embed)\/(\w+)/i);
    if (m) return { type: 'rutube', id: m[1] };
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) return { type: 'file', src: u };
    return { type: 'link', src: u };
  }

  function videoBlock(url) {
    const v = parseVideo(url);
    if (!v) {
      return `<div class="video video--empty">
        <div>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg>
          <span>Видео-разбор скоро</span>
        </div>
      </div>`;
    }

    if (v.type === 'youtube') {
      const poster = `https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg`;
      return `<div class="video" data-embed="${esc(v.id)}" data-kind="youtube">
        <button class="video__poster" type="button" aria-label="Включить видео">
          <img src="${poster}" alt="" loading="lazy" width="1280" height="720">
          <span class="video__play" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </span>
          <span class="video__label">Видео-разбор</span>
        </button>
      </div>`;
    }

    if (v.type === 'vk') {
      return `<div class="video"><iframe src="https://vk.com/video_ext.php?oid=${esc(v.oid)}&id=${esc(v.id)}&hd=2" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen title="Видео"></iframe></div>`;
    }
    if (v.type === 'rutube') {
      return `<div class="video"><iframe src="https://rutube.ru/play/embed/${esc(v.id)}" allow="autoplay; encrypted-media" allowfullscreen title="Видео"></iframe></div>`;
    }
    if (v.type === 'file') {
      return `<div class="video"><video controls playsinline preload="metadata" style="width:100%;height:100%;object-fit:contain"><source src="${esc(v.src)}"></video></div>`;
    }
    return `<a class="btn" href="${esc(v.src)}" target="_blank" rel="noopener">Смотреть видео</a>`;
  }

  function wireVideo(root) {
    const box = root.querySelector('.video[data-embed]');
    if (!box) return;
    const btn = box.querySelector('.video__poster');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const id = box.dataset.embed;
      box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0"
        title="Видео-разбор" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen></iframe>`;
    });
  }

  /* ---------------- reveal on scroll ---------------- */

  let io = null;
  function observeReveals(scope) {
    if (!('IntersectionObserver' in window)) {
      scope.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
      return;
    }
    if (!io) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    }
    scope.querySelectorAll('.reveal:not(.in)').forEach((el, i) => {
      el.style.transitionDelay = Math.min(i * 70, 280) + 'ms';
      io.observe(el);
    });
  }

  /* ---------------- site settings ---------------- */

  function applySite(site) {
    const name = site.title || 'PAYLOG';
    document.title = `${name} — ${site.tagline || 'заработок на сайтах и приложениях'}`;
    const b = document.getElementById('brandName');
    if (b) b.textContent = name;
    const word = document.querySelector('.foot__word');
    if (word) word.textContent = name;

    const ht = document.getElementById('heroTitle');
    if (ht && site.heroTitle) ht.textContent = site.heroTitle;
    const ha = document.getElementById('heroAccent');
    if (ha && site.heroAccent) ha.textContent = ' ' + site.heroAccent;
    const hs = document.getElementById('heroSub');
    if (hs && site.heroSub) hs.textContent = site.heroSub;

    const tag = document.getElementById('footTag');
    if (tag && site.tagline) tag.textContent = site.tagline;

    const rule = document.getElementById('honestRule');
    if (rule && site.disclaimer) rule.textContent = site.disclaimer;

    const desc = document.querySelector('meta[name="description"]');
    if (desc && site.description) desc.setAttribute('content', site.description);

    const links = document.getElementById('footLinks');
    if (links) {
      const items = [];
      if (site.telegram) items.push(`<li><a href="${esc(safeUrl(site.telegram))}" target="_blank" rel="noopener">${esc(site.telegramLabel || 'Телеграм')}</a></li>`);
      if (site.email) items.push(`<li><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></li>`);
      if (!items.length) items.push('<li><span class="muted">Скоро</span></li>');
      links.innerHTML = items.join('');
    }
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
  }

  /* ---------------- home ---------------- */

  const state = { cat: 'Все', q: '', posts: [] };

  function postHref(p) { return `post.html?slug=${encodeURIComponent(p.slug)}`; }

  function featuredCard(p) {
    return `<a class="featured reveal" href="${postHref(p)}">
      <div class="featured__media">
        <img src="${esc(p.cover || 'https://picsum.photos/seed/paylog/1200/750')}" alt="Обложка: ${esc(p.title)}" loading="lazy" width="1200" height="750">
      </div>
      <div class="featured__body">
        <div class="rowline">
          <span class="chip chip--accent">${esc(p.category || 'Разбор')}</span>
          <span class="chip mono">${esc(p.payout || '')}</span>
        </div>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.excerpt || '')}</p>
        <div class="featured__foot">
          <span class="mono muted" style="font-size:.78rem">${fmtDate(p.date)}</span>
          <span class="btn btn--sm" style="pointer-events:none">Читать разбор
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
          </span>
        </div>
      </div>
    </a>`;
  }

  function row(p, i) {
    const num = String(i + 1).padStart(2, '0');
    return `<a class="row reveal" href="${postHref(p)}">
      <span class="row__num">${num}</span>
      <span class="row__main">
        <span class="row__title">${esc(p.title)}</span>
        <span class="row__desc">${esc(p.excerpt || '')}</span>
        <span class="row__meta">
          <span>${esc(p.category || '')}</span>
          <span>·</span>
          <span>${esc(p.difficulty || '')}</span>
          <span>·</span>
          <span>${esc(p.time || '')}</span>
        </span>
      </span>
      <span class="row__paycell">${esc(p.payout || '')}</span>
      <span class="row__date">${fmtDate(p.date)}</span>
    </a>`;
  }

  function renderFilters(posts) {
    const box = document.getElementById('filters');
    if (!box) return;
    const cats = ['Все', ...Array.from(new Set(posts.map((p) => p.category).filter(Boolean)))];
    box.innerHTML = cats.map((c) =>
      `<button class="fbtn" type="button" data-cat="${esc(c)}" aria-pressed="${c === state.cat}">${esc(c)}</button>`
    ).join('');
    box.querySelectorAll('.fbtn').forEach((b) => {
      b.addEventListener('click', () => {
        state.cat = b.dataset.cat;
        box.querySelectorAll('.fbtn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderList();
      });
    });
  }

  function currentList() {
    const q = state.q.trim().toLowerCase();
    return state.posts.filter((p) => {
      const okCat = state.cat === 'Все' || p.category === state.cat;
      if (!okCat) return false;
      if (!q) return true;
      const hay = [p.title, p.excerpt, p.category, (p.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderList() {
    const box = document.getElementById('ledger');
    const chip = document.getElementById('countChip');
    if (!box) return;
    const list = currentList();
    if (chip) chip.textContent = `${list.length} ${list.length === 1 ? 'разбор' : list.length < 5 ? 'разбора' : 'разборов'}`;

    if (!list.length) {
      box.className = '';
      box.innerHTML = `<div class="empty">
        <strong>Ничего не нашлось</strong>
        Попробуй другой запрос или сбрось фильтр категории.
      </div>`;
      return;
    }
    box.className = 'ledger';
    box.innerHTML = list.map(row).join('');
    observeReveals(box);
  }

  async function initHome() {
    const heroDate = document.getElementById('heroDate');
    if (heroDate) heroDate.textContent = fmtDate(new Date().toISOString().slice(0, 10));

    let site = {};
    try { site = await loadJSON('data/site.json'); } catch (e) { /* optional */ }
    applySite(site);

    const ticker = document.getElementById('ticker');
    if (ticker) {
      const words = ['опросы', 'кэшбэк', 'приложения', 'микрозадания', 'задания', 'вывод на карту', 'без вложений', 'с телефона', 'честные суммы', 'без опыта'];
      const html = words.map((w) => `<span>${esc(w)}</span>`).join('');
      ticker.innerHTML = html + html;
    }

    let data;
    try {
      data = await loadJSON('data/posts.json');
    } catch (err) {
      const box = document.getElementById('ledger');
      box.className = '';
      box.innerHTML = `<div class="empty"><strong>Не удалось загрузить статьи</strong>
        Проверь соединение и обнови страницу.</div>`;
      return;
    }

    state.posts = (data.posts || [])
      .filter((p) => p.published !== false)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const sp = document.getElementById('statPosts');
    if (sp) sp.textContent = state.posts.length;
    const sc = document.getElementById('statCats');
    if (sc) sc.textContent = new Set(state.posts.map((p) => p.category).filter(Boolean)).size;

    const feat = document.getElementById('featured');
    const featured = state.posts.find((p) => p.featured) || state.posts[0];
    const featSec = document.getElementById('featuredSec');
    if (feat && featured) {
      feat.innerHTML = featuredCard(featured);
      observeReveals(feat);
    } else if (featSec) {
      featSec.remove();
    }

    renderFilters(state.posts);
    renderList();

    const q = document.getElementById('q');
    if (q) {
      q.addEventListener('input', () => { state.q = q.value; renderList(); });
    }
  }

  /* ---------------- article ---------------- */

  function relatedBlock(current, all) {
    const rel = all.filter((p) => p.slug !== current.slug)
      .sort((a, b) => (b.category === current.category) - (a.category === current.category))
      .slice(0, 3);
    if (!rel.length) return '';
    return `<section class="related">
      <p class="overline">Читать дальше</p>
      <div class="related__list">
        ${rel.map((p, i) => row(p, i)).join('')}
      </div>
    </section>`;
  }

  async function initPost() {
    const params = new URLSearchParams(location.search);
    const slug = params.get('slug') || '';
    const root = document.getElementById('article');

    let site = {};
    try { site = await loadJSON('data/site.json'); } catch (e) {}
    applySite(site);

    let data;
    try {
      data = await loadJSON('data/posts.json');
    } catch (err) {
      root.innerHTML = `<div class="empty"><strong>Не удалось загрузить статью</strong>Обнови страницу через минуту.</div>`;
      return;
    }

    const all = (data.posts || []).filter((p) => p.published !== false);
    const p = all.find((x) => x.slug === slug);

    if (!p) {
      root.innerHTML = `<div class="empty" style="margin-top:40px">
        <strong>Статья не найдена</strong>
        Возможно, ссылка устарела. <a href="index.html" style="color:var(--accent)">Вернуться к разборам</a>
      </div>`;
      return;
    }

    document.title = `${p.title} — ${site.title || 'PAYLOG'}`;
    document.querySelector('meta[name="description"]')
      ?.setAttribute('content', p.excerpt || '');

    const ref = safeUrl(p.ref);
    const tags = (p.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('');

    root.innerHTML = `
      <nav class="crumbs" aria-label="Хлебные крошки">
        <a href="index.html">Главная</a><span>/</span>
        <a href="index.html#posts">${esc(p.category || 'Разборы')}</a><span>/</span>
        <span style="color:var(--text-2)">${esc(String(p.title).slice(0, 40))}…</span>
      </nav>

      <header class="post__head">
        <div class="rowline" style="margin-bottom:16px">
          <span class="chip chip--accent">${esc(p.category || 'Разбор')}</span>
          <span class="mono muted" style="font-size:.76rem">${fmtDate(p.date)}</span>
        </div>
        <h1 class="post__title">${esc(p.title)}</h1>
        <p class="post__lead">${esc(p.excerpt || '')}</p>
      </header>

      <dl class="metrics">
        <div class="metric metric--accent"><dt>Выходит</dt><dd>${esc(p.payout || '—')}</dd></div>
        <div class="metric"><dt>Сложность</dt><dd>${esc(p.difficulty || '—')}</dd></div>
        <div class="metric"><dt>Время</dt><dd>${esc(p.time || '—')}</dd></div>
        <div class="metric"><dt>Вложения</dt><dd>0 ₽</dd></div>
      </dl>

      <div class="post__layout">
        <div>
          ${p.cover ? `<div class="video" style="aspect-ratio:16/9;margin-bottom:24px"><img src="${esc(p.cover)}" alt="Обложка: ${esc(p.title)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" width="1200" height="750"></div>` : ''}
          ${videoBlock(p.video)}
          <article class="prose">${md(p.body)}</article>

          ${ref ? `<div class="refcard">
            <span class="refcard__tag">Партнёрская ссылка</span>
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>
              Начать здесь
            </h3>
            <p>Регистрируйся по ссылке — для тебя это бесплатно, а блог получает небольшую комиссию от платформы.</p>
            <a class="btn btn--primary" href="${esc(ref)}" target="_blank" rel="noopener sponsored">Перейти и зарегистрироваться</a>
            ${p.refNote ? `<div class="refcard__note">${esc(p.refNote)}</div>` : ''}
          </div>` : ''}

          ${tags ? `<div class="tagrow" style="margin-top:26px">${tags}</div>` : ''}
        </div>

        <aside class="post__aside">
          <div class="aside-card">
            <h4>Коротко</h4>
            <p><b style="color:var(--text-1)">Выплата:</b> ${esc(p.payout || '—')}</p>
            <p><b style="color:var(--text-1)">Сложность:</b> ${esc(p.difficulty || '—')}</p>
            <p><b style="color:var(--text-1)">Время:</b> ${esc(p.time || '—')}</p>
            <p><b style="color:var(--text-1)">Вложения:</b> 0 ₽</p>
          </div>
          <div class="aside-card">
            <h4>Правило безопасности</h4>
            <p>Никогда не плати за доступ к «работе» и не вводи seed-фразу от кошелька. Легальная платформа платит тебе, а не наоборот.</p>
          </div>
          ${ref ? `<div class="aside-card"><h4>Ссылка</h4><a class="btn btn--sm btn--primary" href="${esc(ref)}" target="_blank" rel="noopener sponsored">Перейти на платформу</a></div>` : ''}
        </aside>
      </div>

      ${relatedBlock(p, all)}
    `;

    wireVideo(root);
    observeReveals(root);
  }

  /* ---------------- boot ---------------- */

  document.addEventListener('DOMContentLoaded', () => {
    observeReveals(document);
    if (document.getElementById('article')) initPost();
    else initHome();
  });
})();
