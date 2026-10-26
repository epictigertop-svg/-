// app.js — 화면 구성과 사용자 입력
(function () {
  'use strict';
  const { GENRES, SFX } = window.Music;
  const { TRANSITIONS, EFFECTS, RECOMMEND } = window.FX;
  const $ = (s) => document.querySelector(s);

  const SFX_ICONS = { whoosh: '💨', subdrop: '🔊', shutter: '📷', reverse: '🌊', impact: '💥', riser: '📈' };
  const MODE_LABEL = { photo: '🌟 인물 편집', highlight: '🎮 하이라이트 편집' };

  const state = {
    mode: null,
    items: [],          // 인물 편집 소스
    sources: [],        // 하이라이트 편집 소스
    activeSrc: 0,
    pendingIn: null,
    music: { kind: 'genre', genreId: 'kpop' },
    transitions: new Set(), fx: new Set(), sfx: new Set(),
    expanded: {},
    cutSpeed: 'one', length: 'auto', sfxDensity: 'bar', fit: 'cover', structure: 'compile', leadIn: 1.5, zoomFit: 1.25,
    musicVol: 0.85, sfxVol: 0.6, origVol: 0.5, quality: 1080, intensity: 'normal',
    tl: null, buffer: null,
  };

  const renderer = new Engine.Renderer($('#out'));
  const vm = new Engine.VideoManager();
  const player = new Engine.Player(renderer, vm);
  let uid = 0;

  // ───────── 공통 도우미 ─────────
  function toast(msg, ms = 2400) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }
  const fmt = (s, dec) => {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${(dec ? r.toFixed(1) : Math.floor(r).toString()).padStart(dec ? 4 : 2, '0')}`;
  };
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
  const genre = () => GENRES.find((g) => g.id === state.music.genreId) || GENRES[0];
  const genreKey = () => (state.music.kind === 'user' ? 'user' : state.music.genreId);
  const bpm = () => (state.music.kind === 'user' ? state.music.bpm : genre().bpm);
  const recs = () => RECOMMEND[state.mode][genreKey()];

  // ───────── 유형 선택 ─────────
  document.querySelectorAll('.mode-card[data-mode]').forEach((b) => b.addEventListener('click', () => enterMode(b.dataset.mode)));
  $('#backBtn').addEventListener('click', goHome);
  $('#homeLink').addEventListener('click', (e) => { e.preventDefault(); goHome(); });

  function goHome() {
    player.pause();
    $('#editor').hidden = true;
    $('#home').hidden = false;
    window.scrollTo(0, 0);
  }

  function enterMode(mode) {
    if (state.mode !== mode) {
      state.mode = mode;
      state.music = state.music.kind === 'user' ? state.music : { kind: 'genre', genreId: RECOMMEND.music[mode][0] };
      state.fit = mode === 'highlight' ? 'blur' : 'cover';
      $('#fit').value = state.fit;
      state.expanded = {};
      applyRecommend(false);
    }
    $('#home').hidden = true;
    $('#editor').hidden = false;
    $('#modeLabel').textContent = MODE_LABEL[mode];
    document.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== mode; });
    $('#trHint').textContent = mode === 'photo' ? '여러 개 고르면 컷마다 그중 하나만 무작위로 써요. (세부 설정의 "편집 강도"로 전환 빈도 조절)' : '하이라이트 클립 사이에 고른 것 중 하나씩 무작위로 써요.';
    $('#fxHint').textContent = mode === 'photo' ? '줌 펀치·플래시처럼 비트에 터지는 효과는 한 박자에 하나씩만 번갈아 나오고, 글로우·그레인 같은 색감 효과는 계속 깔려요.' : '하이라이트 구간에서만 터져요.';
    window.scrollTo(0, 0);
    renderAllGroups();
    rebuild();
    setTimeout(() => Music.warmup(RECOMMEND.music[mode]), 1500);
  }

  function applyRecommend(notify = true) {
    const r = recs();
    state.transitions = new Set(r.tr.slice(0, 3));
    state.fx = new Set(r.fx.slice(0, 3));
    state.sfx = new Set(r.sfx.slice(0, state.mode === 'highlight' ? 2 : 0)); // 인물 편집은 효과음 없이 시작
    if (state.mode === 'photo' && r.cut) { state.cutSpeed = r.cut; $('#cutSpeed').value = r.cut; }
    if (notify) toast('🎯 음악에 어울리는 전환·효과·효과음을 추천해서 골라 뒀어요');
  }

  // ───────── 옵션 그룹 (추천 3~4개 + 더보기) ─────────
  function renderGroup(el, key, items, recIds, isSel, onClick) {
    const rec = recIds.map((id) => items.find((x) => x.id === id)).filter(Boolean);
    const rest = items.filter((x) => !recIds.includes(x.id));
    const open = state.expanded[key];
    el.innerHTML = '';
    const make = (it, isRec) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + (isSel(it.id) ? ' sel' : '');
      b.innerHTML = `<span class="on">${it.icon || ''} ${it.name}${isRec ? ' <span class="rec">추천</span>' : ''}</span>${it.desc ? `<span class="ds">${it.desc}</span>` : ''}`;
      b.addEventListener('click', () => onClick(it.id));
      el.appendChild(b);
    };
    rec.forEach((it) => make(it, true));
    // 추천 밖에서 고른 항목은 접혀 있어도 보이게
    rest.forEach((it) => { if (open || isSel(it.id)) make(it, false); });
    const hiddenCount = rest.filter((it) => !isSel(it.id)).length;
    if (rest.length && (hiddenCount || open)) {
      const m = document.createElement('button');
      m.type = 'button';
      m.className = 'more';
      m.textContent = open ? '접기 ▲' : `더보기 +${hiddenCount} ▼`;
      m.addEventListener('click', () => { state.expanded[key] = !open; renderAllGroups(); });
      el.appendChild(m);
    }
  }

  function renderAllGroups() {
    if (!state.mode) return;
    const r = recs();
    const genres = GENRES.map((g) => ({ id: g.id, icon: g.emoji, name: g.name, desc: `${g.desc} · ${g.bpm} BPM` }));
    renderGroup($('#musicGroup'), 'music', genres, RECOMMEND.music[state.mode],
      (id) => state.music.kind === 'genre' && state.music.genreId === id,
      (id) => {
        if (state.music.kind === 'genre' && state.music.genreId === id) return;
        state.music = { kind: 'genre', genreId: id };
        applyRecommend();
        renderSongs();
        renderUserMusic();
        renderAllGroups();
        rebuild();
      });
    renderGroup($('#trGroup'), 'tr', TRANSITIONS, r.tr, (id) => state.transitions.has(id), (id) => toggle(state.transitions, id, 1));
    const fxItems = EFFECTS.filter((e) => e.modes.includes(state.mode));
    renderGroup($('#fxGroup'), 'fx', fxItems, r.fx, (id) => state.fx.has(id), (id) => toggle(state.fx, id, 0));
    const sfxItems = SFX.map((s) => ({ ...s, icon: SFX_ICONS[s.id] }));
    renderGroup($('#sfxGroup'), 'sfx', sfxItems, r.sfx, (id) => state.sfx.has(id), (id) => {
      const on = !state.sfx.has(id);
      toggle(state.sfx, id, 0);
      if (on) { player.ac.resume().then(() => Music.previewSfx(player.ac, id)); }
    });
  }

  function toggle(set, id, min) {
    if (set.has(id)) {
      if (set.size <= min) { toast('최소 하나는 골라 주세요'); return; }
      set.delete(id);
    } else set.add(id);
    renderAllGroups();
    rebuild();
  }

  // ───────── 인물 편집: 사진/클립 ─────────
  setupDrop($('#photoDrop'), $('#photoInput'), addPhotoFiles);

  function setupDrop(zone, input, handler) {
    input.addEventListener('change', () => { handler([...input.files]); input.value = ''; });
    zone.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); zone.classList.add('over'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); handler([...e.dataTransfer.files]); });
  }

  function loadImage(url) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
  }
  function loadVideoMeta(url) {
    return new Promise((res, rej) => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.src = url;
      v.onloadedmetadata = () => res({ duration: v.duration, w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => rej(new Error('영상을 읽을 수 없어요'));
    });
  }

  async function addPhotoFiles(files) {
    const list = files.filter((f) => /^(image|video)\//.test(f.type));
    if (!list.length) return toast('사진이나 영상 파일을 올려 주세요');
    setStatus(`불러오는 중… (${list.length}개)`);
    for (const f of list) {
      const url = URL.createObjectURL(f);
      try {
        if (f.type.startsWith('image/')) {
          const im = await loadImage(url);
          // 1080x1920 화면을 줌 효과(최대 약 1.35배)까지 해도 선명하도록 필요한 만큼만 남기고 줄임
          const nw = im.naturalWidth, nh = im.naturalHeight;
          const s = Math.min(1, Math.max((1080 * 1.35) / nw, (1920 * 1.35) / nh), 3200 / Math.max(nw, nh));
          const c = document.createElement('canvas');
          c.width = Math.round(nw * s); c.height = Math.round(nh * s);
          const cx = c.getContext('2d');
          cx.imageSmoothingEnabled = true;
          cx.imageSmoothingQuality = 'high';
          cx.drawImage(im, 0, 0, c.width, c.height);
          state.items.push({ id: ++uid, kind: 'image', name: f.name, url, canvas: c, w: c.width, h: c.height, focus: { x: 0.5, y: 0.38 } });
        } else {
          const m = await loadVideoMeta(url);
          if (!isFinite(m.duration)) throw new Error('길이를 알 수 없는 영상');
          state.items.push({ id: ++uid, kind: 'video', name: f.name, url, duration: m.duration, w: m.w, h: m.h, start: 0, focus: { x: 0.5, y: 0.4 } });
        }
      } catch (e) {
        toast(`${f.name}: 불러오지 못했어요`);
      }
    }
    setStatus('');
    renderThumbs();
    rebuild();
  }

  let dragId = null;
  function renderThumbs() {
    const box = $('#thumbs');
    box.innerHTML = '';
    $('#photoTools').hidden = !state.items.length;
    const nImg = state.items.filter((i) => i.kind === 'image').length;
    $('#photoCount').textContent = `사진 ${nImg}장 · 영상 ${state.items.length - nImg}개`;
    state.items.forEach((it, idx) => {
      const card = document.createElement('div');
      card.className = 'thumb';
      card.draggable = true;
      const media = it.kind === 'image' ? `<img src="${it.url}" alt="">` : `<video src="${it.url}#t=${(it.start || 0) + 0.1}" muted playsinline preload="metadata"></video>`;
      card.innerHTML = `<div class="tframe">${media}<span class="tnum">${idx + 1}</span>${it.kind === 'video' ? `<span class="tvid">🎬 ${it.duration.toFixed(1)}s</span>` : ''}<i class="focus-dot"></i></div>
        <div class="tbar"><button data-a="l" title="앞으로">◀</button><button data-a="r" title="뒤로">▶</button><button data-a="x" title="삭제">✕</button></div>
        ${it.kind === 'video' ? `<label class="tstart">시작 <b>${(it.start || 0).toFixed(1)}s</b><input type="range" min="0" max="${Math.max(0, it.duration - 0.5).toFixed(1)}" step="0.1" value="${it.start || 0}"></label>` : ''}`;
      const frame = card.querySelector('.tframe'), dot = card.querySelector('.focus-dot');
      const rect = () => {
        const fw = frame.clientWidth, fh = frame.clientHeight, s = Math.min(fw / it.w, fh / it.h);
        const rw = it.w * s, rh = it.h * s;
        return { x: (fw - rw) / 2, y: (fh - rh) / 2, w: rw, h: rh };
      };
      const place = () => { const r = rect(); dot.style.left = r.x + it.focus.x * r.w + 'px'; dot.style.top = r.y + it.focus.y * r.h + 'px'; };
      requestAnimationFrame(place);
      frame.addEventListener('click', (e) => {
        const b = frame.getBoundingClientRect(), r = rect();
        it.focus = { x: Math.min(1, Math.max(0, (e.clientX - b.left - r.x) / r.w)), y: Math.min(1, Math.max(0, (e.clientY - b.top - r.y) / r.h)) };
        place();
        rebuild();
      });
      card.querySelector('[data-a=l]').addEventListener('click', () => move(idx, idx - 1));
      card.querySelector('[data-a=r]').addEventListener('click', () => move(idx, idx + 1));
      card.querySelector('[data-a=x]').addEventListener('click', () => { state.items.splice(idx, 1); renderThumbs(); rebuild(); });
      const rg = card.querySelector('.tstart input');
      if (rg) {
        rg.addEventListener('input', () => { it.start = Number(rg.value); card.querySelector('.tstart b').textContent = it.start.toFixed(1) + 's'; });
        rg.addEventListener('change', () => { card.querySelector('video').currentTime = it.start + 0.1; rebuild(); });
      }
      card.addEventListener('dragstart', (e) => { dragId = it.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(it.id)); });
      card.addEventListener('dragend', () => { dragId = null; card.classList.remove('dragging'); });
      card.addEventListener('dragover', (e) => { if (dragId !== null) { e.preventDefault(); card.classList.add('drop-target'); } });
      card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
      card.addEventListener('drop', (e) => {
        if (dragId === null) return;
        e.preventDefault(); e.stopPropagation();
        card.classList.remove('drop-target');
        const from = state.items.findIndex((x) => x.id === dragId);
        if (from >= 0) move(from, idx);
      });
      box.appendChild(card);
    });
  }

  function move(from, to) {
    if (to < 0 || to >= state.items.length) return;
    const [x] = state.items.splice(from, 1);
    state.items.splice(to, 0, x);
    renderThumbs();
    rebuild();
  }
  $('#shuffleBtn').addEventListener('click', () => {
    for (let i = state.items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [state.items[i], state.items[j]] = [state.items[j], state.items[i]]; }
    renderThumbs(); rebuild();
  });
  $('#clearBtn').addEventListener('click', () => { state.items = []; renderThumbs(); rebuild(); });

  // ───────── 하이라이트 편집 ─────────
  const mv = $('#markVideo');
  setupDrop($('#hlDrop'), $('#hlInput'), addHlFiles);

  async function addHlFiles(files) {
    const list = files.filter((f) => f.type.startsWith('video/'));
    if (!list.length) return toast('영상 파일을 올려 주세요');
    for (const f of list) {
      const url = URL.createObjectURL(f);
      try {
        const m = await loadVideoMeta(url);
        if (!isFinite(m.duration)) throw new Error();
        state.sources.push({ id: ++uid, kind: 'video', name: f.name, url, duration: m.duration, w: m.w, h: m.h, highlights: [], focus: { x: 0.5, y: 0.5 } });
      } catch (e) { toast(`${f.name}: 불러오지 못했어요`); }
    }
    if (state.activeSrc >= state.sources.length) state.activeSrc = 0;
    selectSource(state.sources.length - list.length >= 0 ? Math.max(0, state.sources.length - list.length) : 0);
    rebuild();
  }

  function selectSource(i) {
    state.activeSrc = i;
    state.pendingIn = null;
    const s = state.sources[i];
    $('#marker').hidden = !s;
    if (s && mv.dataset.id !== String(s.id)) { mv.src = s.url; mv.dataset.id = s.id; }
    renderSources();
  }

  function renderSources() {
    const tabs = $('#srcTabs');
    tabs.innerHTML = '';
    state.sources.forEach((s, i) => {
      const t = document.createElement('div');
      t.className = 'src-tab' + (i === state.activeSrc ? ' active' : '');
      t.innerHTML = `<span>🎬</span><span class="nm"></span><span class="cnt">${s.highlights.length}</span><button class="x" title="삭제">✕</button>`;
      t.querySelector('.nm').textContent = s.name;
      t.addEventListener('click', (e) => { if (!e.target.classList.contains('x')) selectSource(i); });
      t.querySelector('.x').addEventListener('click', () => {
        state.sources.splice(i, 1);
        if (mv.dataset.id === String(s.id)) { mv.removeAttribute('src'); mv.dataset.id = ''; mv.load(); }
        selectSource(Math.min(state.activeSrc, state.sources.length - 1));
        rebuild();
      });
      tabs.appendChild(t);
    });
    renderHlBar();
    renderHlList();
  }

  function renderHlBar() {
    const s = state.sources[state.activeSrc], bar = $('#hlbar');
    bar.querySelectorAll('.rng, .pending').forEach((x) => x.remove());
    if (!s) return;
    s.highlights.forEach((h) => {
      const d = document.createElement('div');
      d.className = 'rng';
      d.style.left = (h.a / s.duration) * 100 + '%';
      d.style.width = ((h.b - h.a) / s.duration) * 100 + '%';
      bar.appendChild(d);
    });
    if (state.pendingIn !== null) {
      const p = document.createElement('div');
      p.className = 'pending';
      p.style.left = (state.pendingIn / s.duration) * 100 + '%';
      bar.appendChild(p);
    }
    $('#markIn').classList.toggle('armed', state.pendingIn !== null);
  }

  function renderHlList() {
    const s = state.sources[state.activeSrc], box = $('#hlList');
    box.innerHTML = '';
    if (!s) return;
    s.highlights.forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'hl-item';
      row.innerHTML = `<span class="no">#${i + 1}</span><span class="tm">${fmt(h.a, 1)} → ${fmt(h.b, 1)} <small>(${(h.b - h.a).toFixed(1)}초)</small></span>
        <button data-a="p" title="구간 재생">▶</button><button data-a="m" title="시작 0.5초 앞으로">−</button><button data-a="pl" title="끝 0.5초 늘리기">＋</button><button data-a="x" title="삭제">✕</button>`;
      row.querySelector('[data-a=p]').addEventListener('click', () => playRange(h));
      row.querySelector('[data-a=m]').addEventListener('click', () => { h.a = Math.max(0, h.a - 0.5); hlChanged(); });
      row.querySelector('[data-a=pl]').addEventListener('click', () => { h.b = Math.min(s.duration, h.b + 0.5); hlChanged(); });
      row.querySelector('[data-a=x]').addEventListener('click', () => { s.highlights.splice(i, 1); hlChanged(); });
      box.appendChild(row);
    });
  }

  let rangeStop = null;
  function playRange(h) {
    mv.currentTime = h.a;
    mv.play();
    rangeStop = h.b;
  }
  mv.addEventListener('timeupdate', () => {
    if (rangeStop !== null && mv.currentTime >= rangeStop) { mv.pause(); rangeStop = null; }
  });
  (function headLoop() {
    const s = state.sources[state.activeSrc];
    if (s && !$('#marker').hidden) $('#playhead').style.left = (mv.currentTime / s.duration) * 100 + '%';
    requestAnimationFrame(headLoop);
  })();
  $('#hlbar').addEventListener('click', (e) => {
    const s = state.sources[state.activeSrc];
    if (!s) return;
    const b = e.currentTarget.getBoundingClientRect();
    mv.currentTime = ((e.clientX - b.left) / b.width) * s.duration;
  });

  function addHighlight(a, b) {
    const s = state.sources[state.activeSrc];
    if (!s) return;
    a = Math.max(0, a); b = Math.min(s.duration, b);
    if (b - a < 0.3) return toast('구간이 너무 짧아요 (0.3초 이상)');
    s.highlights.push({ a, b });
    s.highlights.sort((x, y) => x.a - y.a);
    state.pendingIn = null;
    hlChanged();
    toast(`⚡ 하이라이트 추가! ${fmt(a, 1)} → ${fmt(b, 1)}`);
  }
  function hlChanged() { renderSources(); rebuild(); }

  $('#markIn').addEventListener('click', () => { state.pendingIn = mv.currentTime; renderHlBar(); toast(`시작점 ${fmt(mv.currentTime, 1)} — 이제 끝점을 찍어 주세요`); });
  $('#markOut').addEventListener('click', () => {
    if (state.pendingIn === null) return addHighlight(mv.currentTime - 2.5, mv.currentTime);
    const a = Math.min(state.pendingIn, mv.currentTime), b = Math.max(state.pendingIn, mv.currentTime);
    addHighlight(a, b);
  });
  $('#markQuick').addEventListener('click', () => addHighlight(mv.currentTime - 2, mv.currentTime + 1));

  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
    if ($('#editor').hidden) return;
    const k = e.key.toLowerCase();
    if (state.mode === 'highlight' && !$('#marker').hidden) {
      if (k === 'i') { $('#markIn').click(); return; }
      if (k === 'o') { $('#markOut').click(); return; }
      if (k === 'h') { $('#markQuick').click(); return; }
    }
    if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); togglePlay(); }
  });

  // ───────── 내 노래 (브라우저에 저장) ─────────
  const songDB = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('beatcut', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('songs', mode), st = t.objectStore('songs');
        const out = fn(st);
        t.oncomplete = () => res(out && out.result);
        t.onerror = () => rej(t.error);
      });
    };
    return {
      all: () => tx('readonly', (st) => st.getAll()).catch(() => []),
      put: (song) => tx('readwrite', (st) => st.put(song)).catch(() => {}),
      del: (id) => tx('readwrite', (st) => st.delete(id)).catch(() => {}),
    };
  })();
  let songs = [];
  const decoded = new Map();
  songDB.all().then((list) => { songs = (list || []).sort((a, b) => b.added - a.added); renderSongs(); });

  setupDrop($('#songDrop'), $('#musicInput'), addSongs);

  async function decodeSong(song) {
    if (!decoded.has(song.id)) decoded.set(song.id, player.ac.decodeAudioData(await song.blob.arrayBuffer()));
    return decoded.get(song.id);
  }

  async function addSongs(files) {
    const list = files.filter((f) => /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|wav|aac|ogg|flac|mp4|mov|webm)$/i.test(f.name));
    if (!list.length) return toast('노래 파일(mp3, m4a, wav)이나 영상 파일을 넣어 주세요');
    let last = null;
    for (const f of list) {
      setStatus(`🎵 "${f.name}" 분석 중…`);
      try {
        const id = 's' + Date.now() + Math.random().toString(36).slice(2, 6);
        const song = { id, name: f.name.replace(/\.[^.]+$/, ''), blob: f, added: Date.now() };
        decoded.delete(id);
        const buf = await decodeSong(song);
        if (buf.duration < 3) throw new Error('short');
        const beat = Music.detectBeat(buf);
        song.bpm = beat.bpm; song.offset = beat.offset;
        song.hook = Music.findHook(buf, beat.bpm, beat.offset);
        song.duration = buf.duration;
        songs.unshift(song);
        songDB.put(song);
        last = song;
      } catch (err) {
        toast(`"${f.name}" 에서 소리를 읽을 수 없어요 (mp3, m4a, wav 권장)`, 3500);
      }
    }
    setStatus('');
    renderSongs();
    if (last) selectSong(last.id, true);
  }

  async function selectSong(id, fresh) {
    const song = songs.find((x) => x.id === id);
    if (!song) return;
    setStatus('🎵 노래 불러오는 중…');
    try {
      const buf = await decodeSong(song);
      state.music = { kind: 'user', songId: id, name: song.name, buffer: buf, bpm: song.bpm, offset: song.offset, userStart: song.hook, start: 0, hook: song.hook };
      snapStart();
      applyRecommend(false);
      toast(fresh ? `🎵 BPM ${song.bpm} · 🔥 ${fmt(song.hook)} 후렴부터 박자에 맞춰 컷해요` : `🎵 "${song.name}" 선택`, 3200);
      renderSongs(); renderUserMusic(); renderAllGroups(); rebuild();
    } catch (e) {
      toast('노래를 불러오지 못했어요');
    }
    setStatus('');
  }

  function renderSongs() {
    const box = $('#songList');
    box.innerHTML = '';
    songs.forEach((song) => {
      const b = document.createElement('button');
      b.type = 'button';
      const sel = state.music.kind === 'user' && state.music.songId === song.id;
      b.className = 'opt' + (sel ? ' sel' : '');
      b.innerHTML = `<span class="on">🎵 <span class="nm"></span></span><span class="ds">${song.bpm} BPM · ${fmt(song.duration)}</span><span class="del" title="삭제">삭제</span>`;
      b.querySelector('.nm').textContent = song.name;
      b.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          songs = songs.filter((x) => x.id !== song.id);
          songDB.del(song.id);
          decoded.delete(song.id);
          if (sel) $('#umRemove').click(); else renderSongs();
          return;
        }
        if (!sel) selectSong(song.id);
      });
      box.appendChild(b);
    });
  }

  function snapStart() {
    const m = state.music, period = 60 / m.bpm;
    const k = Math.round((m.userStart - m.offset) / period);
    m.start = Math.max(0, m.offset + k * period);
    if (m.start < m.userStart - period) m.start += period;
  }

  function renderUserMusic() {
    const m = state.music, box = $('#userMusicBox');
    box.hidden = m.kind !== 'user';
    if (m.kind !== 'user') return;
    $('#umName').textContent = m.name;
    $('#umBpm').value = m.bpm;
    const st = $('#umStart');
    st.max = Math.max(0, m.buffer.duration - 5).toFixed(1);
    st.value = m.userStart;
    $('#umStartLbl').textContent = fmt(m.start, 1);
  }
  $('#umBpm').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (v >= 50 && v <= 220) { state.music.bpm = v; snapStart(); renderUserMusic(); rebuild(); }
  });
  $('#umStart').addEventListener('input', (e) => { state.music.userStart = Number(e.target.value); snapStart(); $('#umStartLbl').textContent = fmt(state.music.start, 1); });
  $('#umStart').addEventListener('change', () => rebuild());
  $('#umRemove').addEventListener('click', () => {
    state.music = { kind: 'genre', genreId: RECOMMEND.music[state.mode][0] };
    applyRecommend(false);
    renderSongs(); renderUserMusic(); renderAllGroups(); rebuild();
  });
  const jumpTo = (t) => { state.music.userStart = t; snapStart(); renderUserMusic(); rebuild(); };
  $('#umHook').addEventListener('click', () => jumpTo(state.music.hook || 0));
  $('#umHead').addEventListener('click', () => jumpTo(0));

  // ───────── 세부 설정 ─────────
  const bindSel = (id, key, num) => $('#' + id).addEventListener('change', (e) => { state[key] = num ? Number(e.target.value) : e.target.value; rebuild(); });
  bindSel('cutSpeed', 'cutSpeed'); bindSel('length', 'length'); bindSel('sfxDensity', 'sfxDensity');
  bindSel('structure', 'structure'); bindSel('fit', 'fit'); bindSel('intensity', 'intensity');
  const bindRange = (id, key, lbl, f) => {
    const el = $('#' + id);
    const show = () => { if (lbl) $('#' + lbl).textContent = f(state[key]); };
    el.addEventListener('input', () => { state[key] = Number(el.value); show(); if (id === 'zoomFit' || id === 'origVol') rebuild(true); });
    el.addEventListener('change', () => rebuild());
    show();
  };
  bindRange('leadIn', 'leadIn', 'leadLbl', (v) => `${v}초`);
  bindRange('zoomFit', 'zoomFit', 'zoomLbl', (v) => `${Math.round(v * 100)}%`);
  bindRange('musicVol', 'musicVol');
  bindRange('sfxVol', 'sfxVol');
  bindRange('origVol', 'origVol');
  // 미리보기는 가볍게 720p 로, 내보낼 때만 고른 화질로 그립니다
  $('#quality').addEventListener('change', (e) => { state.quality = Number(e.target.value); });

  // ───────── 타임라인 · 오디오 ─────────
  function engineState() {
    const m = state.music;
    return {
      mode: state.mode, items: state.items, sources: state.sources, bpm: bpm(),
      fx: state.fx, transitions: state.transitions, sfx: state.sfx,
      cutSpeed: state.cutSpeed, length: state.length, intensity: state.intensity, sfxDensity: state.sfxDensity, fit: state.fit,
      structure: state.structure, leadIn: state.leadIn, zoomFit: state.zoomFit,
      musicMax: m.kind === 'user' ? m.buffer.duration - m.start : Infinity,
    };
  }

  function rebuild(visualOnly) {
    if (!state.mode) return;
    const st = engineState();
    const tl = state.mode === 'photo' ? Engine.buildPhoto(st) : Engine.buildHighlight(st);
    state.tl = tl;
    player.setTimeline(tl, st);
    vm.connectAudio(player.ac, player.master, state.mode === 'highlight' ? state.origVol : 0);
    const has = !!tl;
    $('#emptyMsg').hidden = has;
    $('#exportBtn').disabled = !has;
    $('#bigPlay').hidden = !has;
    if (!has) { player.pause(); updateTime(0); }
    else updateTime(player.time());
    if (state.mode === 'highlight' && has && !tl.groups.length && state.sources.length) setStatus('💡 하이라이트 구간을 추가하면 그 부분에 효과가 들어가요');
    else if (!audioBusy) setStatus('');
    if (!visualOnly) scheduleAudio();
  }

  let audioBusy = false, audioKey = '', audioPromise = Promise.resolve();
  const scheduleAudio = debounce(() => { audioPromise = renderAudio(); }, 250);
  async function renderAudio() {
    const tl = state.tl;
    if (!tl) return;
    const m = state.music;
    const opts = {
      duration: tl.duration, musicVol: state.musicVol, sfxVol: state.sfxVol, sfxEvents: tl.sfx,
      genreId: m.kind === 'genre' ? m.genreId : null, bpm: bpm(),
      userBuffer: m.kind === 'user' ? m.buffer : null, musicStart: m.kind === 'user' ? m.start : 0,
    };
    const key = JSON.stringify({ ...opts, userBuffer: m.kind === 'user' ? m.name + m.buffer.length : null });
    if (key === audioKey) return;
    audioBusy = true;
    setStatus('🎶 음악 만드는 중…');
    try {
      const buf = await Music.renderMix(opts);
      if (state.tl !== tl) return; // 그 사이 바뀜
      audioKey = key;
      player.setAudio(buf);
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('음악을 만들지 못했어요');
    } finally { audioBusy = false; }
  }
  async function audioReady() {
    for (let i = 0; i < 20; i++) {
      await audioPromise;
      await new Promise((r) => setTimeout(r, 300));
      if (!audioBusy) return;
    }
  }

  function setStatus(s) { $('#status').textContent = s; }

  // ───────── 재생 ─────────
  function updateTime(t) {
    const d = state.tl ? state.tl.duration : 0;
    $('#timeLbl').textContent = `${fmt(t)} / ${fmt(d)}`;
    if (!seeking) $('#seek').value = d ? Math.round((t / d) * 1000) : 0;
  }
  player.onTick = updateTime;
  player.onEnd = () => setPlaying(false);
  let seeking = false;
  $('#seek').addEventListener('input', (e) => { seeking = true; if (state.tl) player.seek((e.target.value / 1000) * state.tl.duration); });
  $('#seek').addEventListener('change', () => { seeking = false; });

  function setPlaying(on) {
    $('#playBtn').textContent = on ? '❚❚' : '▶';
    $('#bigPlay').textContent = on ? '❚❚' : '▶';
    $('#stage').classList.toggle('playing', on);
  }
  async function togglePlay() {
    if (!state.tl || exporting) return;
    if (player.playing) { player.pause(); setPlaying(false); return; }
    if (audioBusy) setStatus('🎶 음악 준비 중… 잠시만요');
    mv.pause();
    await player.play();
    setPlaying(true);
  }
  $('#playBtn').addEventListener('click', togglePlay);
  $('#bigPlay').addEventListener('click', togglePlay);
  $('#out').addEventListener('click', togglePlay);

  // ───────── 내보내기 ─────────
  let exporting = false;
  $('#exportBtn').addEventListener('click', async () => {
    if (!state.tl || exporting) return;
    exporting = true;
    $('#exportBtn').disabled = true;
    $('#resultBox').hidden = true;
    $('#exportBox').hidden = false;
    setPlaying(true);
    try {
      setStatus('🎶 음악 준비 중…');
      await audioReady();
      setStatus('');
      const W = state.quality, H = Math.round((W * 16) / 9), fps = 30;
      const bitrate = W >= 1080 ? 16e6 : 8e6;
      const onProgress = (p) => { $('#exportBar').style.width = p * 100 + '%'; $('#exportLbl').textContent = `${hq ? '고화질 렌더링' : '녹화'} 중… ${Math.round(p * 100)}%`; };
      const codecs = await Engine.pickCodecs(W, H, fps, bitrate);
      const hq = !!codecs;
      $('#exportNote').textContent = hq ? '한 프레임씩 고화질로 만들고 있어요. 이 화면을 켜 두면 가장 빨라요.' : '실시간으로 녹화돼요. 끝날 때까지 이 탭을 열어 두세요.';
      let res;
      if (hq) {
        res = await Engine.exportHQ(player, { W, H, fps, bitrate, codecs, origVol: state.mode === 'highlight' ? state.origVol : 0, onProgress });
      } else {
        renderer.setSize(W, H);
        try { res = await Engine.exportVideo(player, { fps, bitrate: bitrate * 1.4, onProgress }); }
        finally { renderer.setSize(720, 1280); player.draw(); }
      }
      const url = URL.createObjectURL(res.blob);
      $('#resultVideo').src = url;
      const a = $('#dlLink');
      a.href = url;
      a.download = `beatcut_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${res.ext}`;
      $('#resultNote').textContent = res.ext === 'mp4'
        ? `MP4 · ${(res.blob.size / 1048576).toFixed(1)}MB — 바로 릴스·틱톡에 올릴 수 있어요.`
        : `WebM · ${(res.blob.size / 1048576).toFixed(1)}MB — 이 브라우저는 MP4 녹화를 지원하지 않아요. 업로드가 안 되면 최신 크롬/사파리에서 다시 만들거나 MP4로 변환해 주세요.`;
      $('#resultBox').hidden = false;
      toast('✅ 영상이 완성됐어요!');
    } catch (e) {
      if (e.message !== 'cancelled') { console.error(e); toast('영상 만들기에 실패했어요: ' + e.message, 4000); }
    } finally {
      exporting = false;
      $('#exportBox').hidden = true;
      $('#exportBtn').disabled = !state.tl;
      setPlaying(false);
      player.onTick = updateTime;
      player.onEnd = () => setPlaying(false);
    }
  });
  $('#cancelExport').addEventListener('click', () => { if (Engine.exportHQ.cancel) Engine.exportHQ.cancel(); if (Engine.exportVideo.cancel) Engine.exportVideo.cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && exporting) toast('⚠️ 영상을 만드는 동안 이 화면을 켜 두세요. 다른 탭에 있으면 느려지거나 끊길 수 있어요', 5000); });

  renderer.frame(null, 0, { fx: new Set() }, vm);
  window.__beatcut = { state, player, rebuild, enterMode, addPhotoFiles, addHlFiles, addHighlight };
})();
