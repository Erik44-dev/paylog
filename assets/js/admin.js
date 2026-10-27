/* PAYLOG admin — GitHub Contents API client (no dependencies) */
(function () {
  'use strict';

  const API = 'https://api.github.com';
  const LS_KEY = 'paylog.gh.creds';

  const state = {
    creds: null,
    posts: { updated: '', posts: [] },
    site: {},
    postsSha: null,
    siteSha: null,
    editingId: null,
    dirty: false,
    query: ''
  };

  const $ = (id) => document.getElementById(id);

  /* ---------- helpers ---------- */

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, isErr ? 5200 : 3200);
  }

  function status(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  const enc = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };

  const dec = (b64) => {
    const bin = atob(String(b64).replace(/\n/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya'
  };

  function slugify(str) {
    return String(str || '')
      .toLowerCase()
      .split('')
      .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70);
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + (iso.length <= 10 ? 'T12:00:00' : ''));
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  /* ---------- github ---------- */

  class GH {
    constructor(creds) { this.c = creds; }

    async req(path, opts = {}) {
      const res = await fetch(API + path, {
        ...opts,
        headers: {
          Authorization: `token ${this.c.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        }
      });
      if (res.status === 204) return null;
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      if (!res.ok) {
        const err = new Error((data && data.message) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    }

    me() { return this.req('/user'); }

    repo() { return this.req(`/repos/${this.c.owner}/${this.c.repo}`); }

    async getFile(path) {
      const data = await this.req(
        `/repos/${this.c.owner}/${this.c.repo}/contents/${path}?ref=${encodeURIComponent(this.c.branch)}`
      );
      return { sha: data.sha, text: dec(data.content) };
    }

    async putFile(path, text, message, sha) {
      const body = { message, content: enc(text), branch: this.c.branch };
      if (sha) body.sha = sha;
      return this.req(`/repos/${this.c.owner}/${this.c.repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
    }

    async putBinary(path, base64, message) {
      return this.req(`/repos/${this.c.owner}/${this.c.repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content: base64, branch: this.c.branch })
      });
    }
  }

  let gh = null;

  function humanError(err) {
    if (!err) return 'Неизвестная ошибка';
    if (err.status === 401) return 'Токен неверный или истёк — создай новый.';
    if (err.status === 403) return 'Нет прав на запись. Токену нужен доступ Contents: Read and write.';
    if (err.status === 404) return 'Репозиторий или файл не найден. Проверь логин, имя репозитория и ветку.';
    if (err.status === 409) return 'Конфликт версий — кто-то сохранил файл одновременно. Нажми «Обновить» и сохрани снова.';
    if (err.status === 422) return 'GitHub отклонил запрос — проверь имя репозитория и ветку.';
    return err.message || String(err);
  }

  /* ---------- auth ---------- */

  function saveCreds(c) { localStorage.setItem(LS_KEY, JSON.stringify(c)); }
  function clearCreds() { localStorage.removeItem(LS_KEY); }
  function loadCreds() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function showLogin() {
    $('loginView').classList.remove('hidden');
    $('appView').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    status($('loginStatus'), '');
  }

  function showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('logoutBtn').classList.remove('hidden');
  }

  /* ---------- tabs ---------- */

  function selectTab(name) {
    const map = { list: 'panelList', settings: 'panelSettings', help: 'panelHelp', editor: 'panelEditor' };
    Object.values(map).forEach((id) => $(id).classList.add('hidden'));
    $(map[name]).classList.remove('hidden');

    document.querySelectorAll('.adm-tab').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.tab === name));
    });
  }

  /* ---------- data ---------- */

  async function loadAll(silent) {
    if (!silent) status($('listStatus'), 'Загружаю из GitHub…');
    try {
      const [postsFile, siteFile] = await Promise.all([
        gh.getFile('data/posts.json'),
        gh.getFile('data/site.json')
      ]);
      state.postsSha = postsFile.sha;
      state.siteSha = siteFile.sha;
      const parsed = JSON.parse(postsFile.text);
      state.posts = { updated: parsed.updated || '', posts: Array.isArray(parsed.posts) ? parsed.posts : [] };
      state.site = JSON.parse(siteFile.text);
      renderList();
      fillSettings();
      renderStats();
      fillCategoryList();
      status($('listStatus'), `Загружено ${state.posts.posts.length} статей · ${new Date().toLocaleTimeString('ru-RU')}`);
    } catch (err) {
      status($('listStatus'), humanError(err), 'err');
      toast(humanError(err), true);
    }
  }

  function renderStats() {
    const all = state.posts.posts;
    const pub = all.filter((p) => p.published !== false).length;
    $('dashStats').innerHTML = `<span><b>${all.length}</b> всего</span>
      <span><b>${pub}</b> опубл.</span>
      <span><b>${all.length - pub}</b> черновиков</span>`;
  }

  function fillCategoryList() {
    const cats = Array.from(new Set(state.posts.posts.map((p) => p.category).filter(Boolean)));
    $('catList').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
  }

  function renderList() {
    const box = $('postList');
    const q = state.query.trim().toLowerCase();
    const list = state.posts.posts
      .filter((p) => !q || (p.title || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    if (!list.length) {
      box.innerHTML = `<div class="empty" style="margin-top:20px"><strong>${state.posts.posts.length ? 'Ничего не нашлось' : 'Статей пока нет'}</strong>
        ${state.posts.posts.length ? 'Измени поисковый запрос.' : 'Нажми «+ Новая статья», чтобы создать первую.'}</div>`;
      return;
    }

    box.innerHTML = list.map((p) => `
      <div class="pitem">
        <div class="pitem__t">
          <span class="pitem__title">${esc(p.title || 'Без названия')}</span>
          <span class="pitem__meta">
            <span class="${p.published === false ? 'draft' : 'live'}">${p.published === false ? 'черновик' : 'на сайте'}</span>
            <span>${esc(p.category || 'без категории')}</span>
            <span>${fmtDate(p.date)}</span>
            ${p.featured ? '<span style="color:var(--accent)">★ главная</span>' : ''}
          </span>
        </div>
        <div class="pitem__act">
          <button class="iconbtn" type="button" data-act="edit" data-id="${esc(p.id)}" aria-label="Редактировать">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="iconbtn" type="button" data-act="view" data-id="${esc(p.id)}" aria-label="Открыть на сайте">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
          </button>
          <button class="iconbtn iconbtn--danger" type="button" data-act="del" data-id="${esc(p.id)}" aria-label="Удалить">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = state.posts.posts.find((x) => x.id === btn.dataset.id);
        if (!p) return;
        if (btn.dataset.act === 'edit') openEditor(p);
        if (btn.dataset.act === 'view') window.open(`post.html?slug=${encodeURIComponent(p.slug)}`, '_blank', 'noopener');
        if (btn.dataset.act === 'del') removePost(p);
      });
    });
  }

  /* ---------- editor ---------- */

  function coverPreview(url) {
    const box = $('coverPreview');
    box.innerHTML = url
      ? `<img src="${esc(url)}" alt="">`
      : 'Нет обложки';
  }

  function openEditor(post) {
    const p = post || {
      id: 'p' + Date.now(),
      slug: '', title: '', category: '', cover: '', video: '', excerpt: '',
      body: '', ref: '', refNote: '', payout: '', difficulty: 'Легко',
      time: '', tags: [], date: today(), published: true, featured: false
    };

    state.editingId = post ? p.id : null;
    state.dirty = false;

    $('editorTitle').textContent = post ? 'Редактирование' : 'Новая статья';
    $('editorChip').textContent = post ? (p.published === false ? 'черновик' : 'на сайте') : 'новая';
    $('fTitle').value = p.title || '';
    $('fSlug').value = p.slug || '';
    $('fCategory').value = p.category || '';
    $('fCover').value = p.cover || '';
    $('fVideo').value = p.video || '';
    $('fDate').value = p.date || today();
    $('fExcerpt').value = p.excerpt || '';
    $('fBody').value = p.body || '';
    $('fRef').value = p.ref || '';
    $('fRefNote').value = p.refNote || '';
    $('fPayout').value = p.payout || '';
    $('fDifficulty').value = p.difficulty || 'Легко';
    $('fTime').value = p.time || '';
    $('fTags').value = (p.tags || []).join(', ');
    $('fPublished').checked = p.published !== false;
    $('fFeatured').checked = !!p.featured;
    coverPreview(p.cover || '');
    status($('saveStatus'), '');
    status($('uploadStatus'), '');
    $('deleteBtn').classList.toggle('hidden', !post);

    selectTab('editor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('fTitle').focus({ preventScroll: true }), 200);
  }

  function collectForm() {
    return {
      id: state.editingId || 'p' + Date.now(),
      title: $('fTitle').value.trim(),
      slug: ($('fSlug').value.trim() || slugify($('fTitle').value)),
      category: $('fCategory').value.trim(),
      cover: $('fCover').value.trim(),
      video: $('fVideo').value.trim(),
      excerpt: $('fExcerpt').value.trim(),
      body: $('fBody').value.replace(/\r\n/g, '\n').trim(),
      ref: $('fRef').value.trim(),
      refNote: $('fRefNote').value.trim(),
      payout: $('fPayout').value.trim(),
      difficulty: $('fDifficulty').value,
      time: $('fTime').value.trim(),
      tags: $('fTags').value.split(',').map((t) => t.trim()).filter(Boolean),
      date: $('fDate').value || today(),
      published: $('fPublished').checked,
      featured: $('fFeatured').checked
    };
  }

  function validate(p) {
    if (!p.title) return 'Добавь заголовок.';
    if (p.title.length < 8) return 'Заголовок слишком короткий — минимум 8 символов.';
    if (!p.slug) return 'Не получился slug — впиши латиницей вручную.';
    if (!p.excerpt) return 'Добавь краткое описание (1–2 предложения).';
    if (!p.body || p.body.length < 60) return 'Текст статьи слишком короткий — минимум абзац.';
    const dup = state.posts.posts.find((x) => x.slug === p.slug && x.id !== p.id);
    if (dup) return `Slug «${p.slug}» уже занят другой статьёй.`;
    return '';
  }

  async function savePost(e) {
    e.preventDefault();
    const p = collectForm();
    const bad = validate(p);
    if (bad) { status($('saveStatus'), bad, 'err'); toast(bad, true); return; }

    const btn = $('saveBtn');
    btn.disabled = true;
    status($('saveStatus'), 'Сохраняю в GitHub…');

    const list = state.posts.posts.slice();
    const idx = list.findIndex((x) => x.id === p.id);
    if (idx >= 0) list[idx] = p; else list.unshift(p);

    if (p.featured) {
      state.posts.posts.forEach((x) => { if (x.id !== p.id) x.featured = false; });
      const target = idx >= 0 ? list[idx] : list[0];
      target.featured = true;
    } else if (idx >= 0) {
      list[idx].featured = false;
    }

    const payload = {
      updated: today(),
      posts: list.map((x) => ({ ...x, featured: !!x.featured }))
    };

    try {
      const res = await gh.putFile(
        'data/posts.json',
        JSON.stringify(payload, null, 2) + '\n',
        `${p.published === false ? 'draft' : 'post'}: ${p.title}`,
        state.postsSha
      );
      state.postsSha = res.content.sha;
      state.posts = payload;
      state.dirty = false;

      renderList();
      renderStats();
      fillCategoryList();
      status($('saveStatus'), 'Сохранено. Сайт обновится через 30–90 секунд.', 'ok');
      toast('Сохранено — GitHub коммитнул изменения');
      setTimeout(() => selectTab('list'), 900);
    } catch (err) {
      const msg = humanError(err);
      status($('saveStatus'), msg, 'err');
      toast(msg, true);
      if (err.status === 409) {
        await loadAll(true);
        status($('saveStatus'), 'Конфликт. Файл перечитан — сохрани ещё раз.', 'err');
      }
    } finally {
      btn.disabled = false;
    }
  }

  async function removePost(p) {
    if (!confirm(`Удалить «${p.title}»? Это коммит в репозиторий, откатить можно через историю GitHub.`)) return;
    const payload = {
      updated: today(),
      posts: state.posts.posts.filter((x) => x.id !== p.id)
    };
    try {
      const res = await gh.putFile(
        'data/posts.json',
        JSON.stringify(payload, null, 2) + '\n',
        `delete: ${p.title}`,
        state.postsSha
      );
      state.postsSha = res.content.sha;
      state.posts = payload;
      renderList();
      renderStats();
      toast('Статья удалена');
    } catch (err) {
      toast(humanError(err), true);
    }
  }

  /* ---------- cover upload ---------- */

  async function uploadCover(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      status($('uploadStatus'), 'Файл больше 4 МБ — сожми картинку.', 'err');
      return;
    }
    status($('uploadStatus'), 'Загружаю картинку…');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = String(reader.result).split(',')[1];
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const base = slugify($('fSlug').value || $('fTitle').value || 'cover') || 'cover';
        const path = `assets/uploads/${base}-${Date.now()}.${ext}`;
        await gh.putBinary(path, b64, `upload: ${path}`);
        $('fCover').value = path;
        coverPreview(path);
        status($('uploadStatus'), 'Загружено ✓ — не забудь сохранить статью', 'ok');
        state.dirty = true;
      } catch (err) {
        status($('uploadStatus'), humanError(err), 'err');
      }
    };
    reader.onerror = () => status($('uploadStatus'), 'Не удалось прочитать файл', 'err');
    reader.readAsDataURL(file);
  }

  /* ---------- site settings ---------- */

  function fillSettings() {
    const s = state.site || {};
    $('sTitle').value = s.title || '';
    $('sTagline').value = s.tagline || '';
    $('sDesc').value = s.description || '';
    $('sHeroTitle').value = s.heroTitle || '';
    $('sHeroAccent').value = s.heroAccent || '';
    $('sHeroSub').value = s.heroSub || '';
    $('sTelegram').value = s.telegram || '';
    $('sTelegramLabel').value = s.telegramLabel || '';
    $('sEmail').value = s.email || '';
    $('sDisclaimer').value = s.disclaimer || '';
  }

  async function saveSite(e) {
    e.preventDefault();
    const s = {
      ...state.site,
      title: $('sTitle').value.trim() || 'PAYLOG',
      tagline: $('sTagline').value.trim(),
      description: $('sDesc').value.trim(),
      heroTitle: $('sHeroTitle').value.trim(),
      heroAccent: $('sHeroAccent').value.trim(),
      heroSub: $('sHeroSub').value.trim(),
      telegram: $('sTelegram').value.trim(),
      telegramLabel: $('sTelegramLabel').value.trim(),
      email: $('sEmail').value.trim(),
      disclaimer: $('sDisclaimer').value.trim(),
      updated: today()
    };

    const btn = $('saveSiteBtn');
    btn.disabled = true;
    status($('siteStatus'), 'Сохраняю…');
    try {
      const res = await gh.putFile(
        'data/site.json',
        JSON.stringify(s, null, 2) + '\n',
        'admin: site settings',
        state.siteSha
      );
      state.siteSha = res.content.sha;
      state.site = s;
      status($('siteStatus'), 'Сохранено. Обновится через 30–90 секунд.', 'ok');
      toast('Настройки сохранены');
    } catch (err) {
      status($('siteStatus'), humanError(err), 'err');
      toast(humanError(err), true);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- login ---------- */

  async function doLogin(e) {
    e.preventDefault();
    const creds = {
      owner: $('ghOwner').value.trim(),
      repo: $('ghRepo').value.trim(),
      token: $('ghToken').value.trim(),
      branch: $('ghBranch').value.trim() || 'main'
    };
    if (!creds.owner || !creds.repo || !creds.token) {
      status($('loginStatus'), 'Заполни все поля.', 'err');
      return;
    }

    const btn = $('loginBtn');
    btn.disabled = true;
    status($('loginStatus'), 'Проверяю токен…');

    try {
      const probe = new GH(creds);
      await probe.me();
      const repo = await probe.repo();
      if (!repo.permissions || !repo.permissions.push) {
        throw Object.assign(new Error('Токену не хватает прав на запись в этот репозиторий.'), { status: 403 });
      }
      gh = probe;
      state.creds = creds;
      saveCreds(creds);
      showApp();
      await loadAll();
      toast('Вход выполнен');
    } catch (err) {
      status($('loginStatus'), humanError(err), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- boot ---------- */

  function wire() {
    $('loginForm').addEventListener('submit', doLogin);
    $('postForm').addEventListener('submit', savePost);
    $('siteForm').addEventListener('submit', saveSite);

    $('logoutBtn').addEventListener('click', () => {
      if (!confirm('Выйти и стереть токен с этого устройства?')) return;
      clearCreds();
      gh = null;
      state.creds = null;
      showLogin();
      toast('Токен удалён с устройства');
    });

    $('newPostBtn').addEventListener('click', () => openEditor(null));
    $('cancelBtn').addEventListener('click', () => {
      if (state.dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
      state.dirty = false;
      selectTab('list');
    });

    $('deleteBtn').addEventListener('click', () => {
      const p = state.posts.posts.find((x) => x.id === state.editingId);
      if (p) removePost(p).then(() => selectTab('list'));
    });

    $('refreshBtn').addEventListener('click', () => loadAll());
    $('admSearch').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });

    $('coverFile').addEventListener('change', (e) => uploadCover(e.target.files[0]));
    $('fCover').addEventListener('input', (e) => { coverPreview(e.target.value.trim()); state.dirty = true; });

    $('fTitle').addEventListener('input', () => {
      state.dirty = true;
      if (!state.editingId && !$('fSlug').dataset.touched) {
        $('fSlug').value = slugify($('fTitle').value);
      }
    });
    $('fSlug').addEventListener('input', (e) => { e.target.dataset.touched = '1'; state.dirty = true; });

    $('postForm').addEventListener('input', () => { state.dirty = true; });

    document.querySelectorAll('.adm-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'settings') { selectTab('settings'); return; }
        if (tab.dataset.tab === 'help') { selectTab('help'); return; }
        if (!$('panelEditor').classList.contains('hidden') && state.dirty) {
          if (!confirm('Несохранённые изменения будут потеряны. Выйти?')) return;
          state.dirty = false;
        }
        selectTab('list');
      });
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('panelEditor').classList.contains('hidden')) {
        e.preventDefault();
        $('postForm').requestSubmit();
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    wire();
    const creds = loadCreds();
    if (!creds) { showLogin(); return; }

    $('ghOwner').value = creds.owner || '';
    $('ghRepo').value = creds.repo || '';
    $('ghBranch').value = creds.branch || 'main';

    gh = new GH(creds);
    state.creds = creds;
    showApp();
    await loadAll();
  });
})();
