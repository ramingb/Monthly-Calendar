(function () {
  'use strict';

  var STORE_KEY = 'monthly-calendar:data:v1';
  var SETTINGS_KEY = 'monthly-calendar:settings:v1';
  var DATA_PATH = 'data/schedule.json';
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  var H = window.KoreanHolidays;

  // ── 유틸 ──────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function $(id) { return document.getElementById(id); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtDate(s) { var d = parse(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEK[d.getDay()] + ')'; }
  function fmtTime(t) {
    if (!t) return '';
    var h = +t.slice(0, 2), m = t.slice(3, 5);
    return (h < 12 ? '오전 ' : '오후 ') + (h % 12 === 0 ? 12 : h % 12) + ':' + m;
  }
  function sortItems(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    var at = a.time || '99:99', bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  // ── 카톡 알림 시각 ────────────────────────────────────
  var DEFAULT_REMIND_TIME = '08:00';

  /** 일정의 알림 시각 'YYYY-MM-DDTHH:MM' (없으면 '') — 예전 데이터(remind 일수만 있음)도 지원 */
  function remindAtOf(it) {
    if (it.remindAt) return it.remindAt;
    var n = parseInt(it.remind, 10);
    if (isNaN(n) || n < 0) return '';
    var d = parse(it.date); d.setDate(d.getDate() - n);
    return ymd(d) + 'T' + (it.remindTime || DEFAULT_REMIND_TIME);
  }

  /** 폼 값으로 알림 시각 계산 */
  function computeRemindAt(remind, date, remindDate, remindTime) {
    var time = remindTime || DEFAULT_REMIND_TIME;
    if (remind === 'custom') return remindDate ? remindDate + 'T' + time : '';
    var n = parseInt(remind, 10);
    if (isNaN(n) || n < 0 || !date) return '';
    var d = parse(date); d.setDate(d.getDate() - n);
    return ymd(d) + 'T' + time;
  }

  function nowLocal() { var d = new Date(); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function fmtRemind(at) {
    var d = parse(at.slice(0, 10));
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEK[d.getDay()] + ') ' + fmtTime(at.slice(11, 16));
  }

  // ── 저장소 (localStorage) ─────────────────────────────
  function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }

  function loadData() {
    try {
      var raw = JSON.parse(safeGet(STORE_KEY) || 'null');
      if (raw && Array.isArray(raw.items)) return raw;
    } catch (e) { /* 손상된 데이터는 무시 */ }
    return { version: 1, updatedAt: 0, items: [] };
  }
  function loadSettings() {
    try { return JSON.parse(safeGet(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  var data = loadData();
  var settings = loadSettings();

  function persist() {
    data.updatedAt = Date.now();
    if (!safeSet(STORE_KEY, JSON.stringify(data))) toast('브라우저 저장소에 저장하지 못했어요.');
    scheduleSync();
  }

  // ── 상태 ──────────────────────────────────────────────
  var today = ymd(new Date());
  var view = new Date(); view.setDate(1);
  var selected = today;
  var editingId = null;

  // ── 달력 렌더링 ───────────────────────────────────────
  function itemsByDate() {
    var map = {};
    data.items.forEach(function (it) { (map[it.date] = map[it.date] || []).push(it); });
    Object.keys(map).forEach(function (k) { map[k].sort(sortItems); });
    return map;
  }

  function renderCalendar() {
    var y = view.getFullYear(), m = view.getMonth();
    $('monthTitle').textContent = y + '년 ' + (m + 1) + '월';

    var first = new Date(y, m, 1);
    var start = new Date(y, m, 1 - first.getDay()); // 일요일 시작
    var lastDay = new Date(y, m + 1, 0).getDate();
    var weeks = Math.ceil((first.getDay() + lastDay) / 7);
    var byDate = itemsByDate();
    var grid = $('grid');
    grid.textContent = '';

    for (var i = 0; i < weeks * 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var ds = ymd(d);
      var hol = H.holidayNames(ds);
      var obs = H.observance(ds);
      var cell = el('button', 'cell');
      cell.type = 'button';
      cell.dataset.date = ds;
      if (d.getMonth() !== m) cell.classList.add('other');
      if (d.getDay() === 0) cell.classList.add('sun');
      if (d.getDay() === 6) cell.classList.add('sat');
      if (hol.length) cell.classList.add('holiday');
      if (ds === today) cell.classList.add('today');
      if (ds === selected) cell.classList.add('selected');

      var head = el('div', 'cell-head');
      head.appendChild(el('span', 'daynum', d.getDate()));
      if (hol.length) head.appendChild(el('span', 'hname', hol.join(' · ')));
      else if (obs) head.appendChild(el('span', 'oname', obs));
      cell.appendChild(head);

      var list = byDate[ds] || [];
      var label = fmtDate(ds) + (hol.length ? ', ' + hol.join(', ') : '') + (list.length ? ', 일정 ' + list.length + '개' : '');
      cell.setAttribute('aria-label', label);

      var MAX = 3;
      list.slice(0, MAX).forEach(function (it) {
        var chip = el('div', 'chip ' + it.type + (it.done ? ' done' : ''),
          (it.time ? it.time + ' ' : '') + it.title);
        chip.title = it.title;
        cell.appendChild(chip);
      });
      if (list.length > MAX) cell.appendChild(el('div', 'more', '+' + (list.length - MAX) + '개 더'));

      grid.appendChild(cell);
    }
    renderLists();
  }

  // ── 사이드 패널 ───────────────────────────────────────
  function renderPanel() {
    $('panelDate').textContent = parse(selected).getFullYear() + '년 ' + fmtDate(selected);
    var hol = H.holidayNames(selected);
    var obs = H.observance(selected);
    $('panelHoliday').textContent = hol.length ? '🎌 ' + hol.join(' · ') : (obs || '');
    $('panelHoliday').style.color = hol.length ? '' : 'var(--muted)';

    var list = data.items.filter(function (it) { return it.date === selected; }).sort(sortItems);
    var ul = $('itemList');
    ul.textContent = '';
    $('emptyMsg').hidden = list.length > 0;

    list.forEach(function (it) {
      var li = el('li', 'item ' + it.type + (it.done ? ' done' : ''));
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!it.done;
      cb.setAttribute('aria-label', it.title + ' 완료');
      cb.addEventListener('change', function () { toggleDone(it.id); });
      li.appendChild(cb);

      var body = el('div', 'item-body');
      body.appendChild(el('div', 'item-title', it.title));
      var meta = el('div', 'item-meta');
      meta.appendChild(el('span', null, it.type === 'appt' ? '약속' : '할 일'));
      if (it.time) meta.appendChild(el('span', null, fmtTime(it.time)));
      var ra = remindAtOf(it);
      if (ra) meta.appendChild(el('span', null, '💬 ' + fmtRemind(ra) + ' 알림'));
      body.appendChild(meta);
      if (it.memo) body.appendChild(el('div', 'item-memo', it.memo));
      li.appendChild(body);

      var acts = el('div', 'item-actions');
      var eb = el('button', null, '수정'); eb.type = 'button';
      eb.addEventListener('click', function () { startEdit(it.id); });
      var db = el('button', null, '삭제'); db.type = 'button';
      db.addEventListener('click', function () { removeItem(it.id); });
      acts.appendChild(eb); acts.appendChild(db);
      li.appendChild(acts);

      ul.appendChild(li);
    });

    if (!editingId) { $('addForm').elements.date.value = selected; updateRemindUI(); }
    renderUpcoming();
  }

  function renderUpcoming() {
    var end = parse(today); end.setDate(end.getDate() + 7);
    var endS = ymd(end);
    var list = data.items.filter(function (it) { return it.date >= today && it.date < endS; }).sort(sortItems);
    var ul = $('upcomingList');
    ul.textContent = '';
    if (!list.length) { ul.appendChild(el('li', 'empty', '예정된 일정이 없어요.')); return; }
    list.forEach(function (it) {
      var li = el('li');
      var dd = parse(it.date);
      li.appendChild(el('span', 'd', (dd.getMonth() + 1) + '/' + dd.getDate() + '(' + WEEK[dd.getDay()] + ')' + (it.time ? ' ' + it.time : '')));
      li.appendChild(el('span', it.done ? 'done' : null, (it.type === 'appt' ? '📌 ' : '✅ ') + it.title));
      li.addEventListener('click', function () { select(it.date, true); });
      ul.appendChild(li);
    });
  }

  // ── 달력 하단: 이번 달 / 다음 달 목록 ─────────────────
  function renderMonthList(year, month, titleEl, listEl) {
    var prefix = year + '-' + pad(month + 1) + '-';
    var items = data.items.filter(function (it) { return it.date.indexOf(prefix) === 0; }).sort(sortItems);
    var doneCount = items.filter(function (it) { return it.done; }).length;

    titleEl.textContent = '';
    titleEl.appendChild(document.createTextNode((year !== view.getFullYear() ? year + '년 ' : '') + (month + 1) + '월 일정'));
    if (items.length) titleEl.appendChild(el('small', null, '완료 ' + doneCount + ' / ' + items.length));

    // 공휴일도 목록에 함께 표시
    var hols = H.getHolidays(year);
    var rows = items.map(function (it) { return { date: it.date, item: it }; });
    Object.keys(hols).forEach(function (d) {
      if (d.indexOf(prefix) === 0) rows.push({ date: d, hol: hols[d].join(' · ') });
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.hol ? -1 : b.hol ? 1 : 0;
    });

    listEl.textContent = '';
    if (!items.length) {
      listEl.appendChild(el('li', 'mempty', '등록된 일정이 없어요.'));
    }
    var lastDate = null;
    rows.forEach(function (r) {
      var d = parse(r.date);
      var li = el('li', 'mrow' + (r.hol ? ' hol' : '') + (r.item && r.item.done ? ' done' : '') + (r.date === lastDate ? ' cont' : ''));
      var dateCls = 'mdate' + (H.holidayNames(r.date).length ? ' holiday' : d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '');
      li.appendChild(el('span', dateCls, r.date === lastDate ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' (' + WEEK[d.getDay()] + ')'));
      lastDate = r.date;

      var body = el('span', 'mbody');
      if (r.hol) {
        body.appendChild(el('span', 'mtitle', '🎌 ' + r.hol));
      } else {
        var it = r.item;
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!it.done;
        cb.setAttribute('aria-label', it.title + ' 완료');
        cb.addEventListener('change', function () { toggleDone(it.id); });
        li.insertBefore(cb, li.firstChild);
        body.appendChild(el('span', 'mbar ' + it.type));
        if (it.time) body.appendChild(el('span', 'mtime', it.time));
        var t = el('span', 'mtitle', it.title);
        t.title = it.title;
        body.appendChild(t);
        if (remindAtOf(it) && !it.done) {
          var bell = el('span', 'mbell', '🔔');
          bell.title = fmtRemind(remindAtOf(it)) + ' 카톡 알림';
          body.appendChild(bell);
        }
      }
      body.addEventListener('click', function () {
        select(r.date, true);
        if (window.matchMedia('(max-width: 900px)').matches) $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(body);
      if (r.hol) li.insertBefore(el('span', 'mbar'), li.firstChild).style.width = '16px';
      listEl.appendChild(li);
    });
  }

  function renderLists() {
    var y = view.getFullYear(), m = view.getMonth();
    var next = new Date(y, m + 1, 1);
    renderMonthList(y, m, $('listTitleThis'), $('listThis'));
    renderMonthList(next.getFullYear(), next.getMonth(), $('listTitleNext'), $('listNext'));
  }

  function render() { renderCalendar(); renderPanel(); }

  function select(ds, moveView) {
    selected = ds;
    if (moveView) { var d = parse(ds); view = new Date(d.getFullYear(), d.getMonth(), 1); }
    render();
  }

  // ── 알림 입력 UI ─────────────────────────────────────
  function updateRemindUI() {
    var f = $('addForm').elements;
    var v = f.remind.value;
    var off = v === '-1';
    $('remindDateField').hidden = v !== 'custom';
    $('remindTimeField').hidden = off;
    if (v === 'custom' && !f.remindDate.value) f.remindDate.value = f.date.value || selected;
    var at = off ? '' : computeRemindAt(v, f.date.value, f.remindDate.value, f.remindTime.value);
    var p = $('remindPreview');
    p.classList.remove('past');
    if (!at) { p.textContent = ''; return; }
    if (at <= nowLocal()) {
      p.classList.add('past');
      p.textContent = '⚠︎ ' + fmtRemind(at) + ' — 이미 지난 시각이에요';
    } else {
      p.textContent = '🔔 ' + fmtRemind(at) + '에 카톡으로 알려드려요';
    }
  }
  ['remind', 'date', 'remindDate', 'remindTime'].forEach(function (name) {
    $('addForm').elements[name].addEventListener('input', updateRemindUI);
    $('addForm').elements[name].addEventListener('change', updateRemindUI);
  });

  // ── CRUD ─────────────────────────────────────────────
  function findItem(id) { return data.items.filter(function (it) { return it.id === id; })[0]; }

  function toggleDone(id) {
    var it = findItem(id);
    if (!it) return;
    it.done = !it.done;
    it.updatedAt = Date.now();
    persist(); render();
  }

  function removeItem(id) {
    var it = findItem(id);
    if (!it || !confirm('"' + it.title + '" 일정을 삭제할까요?')) return;
    data.items = data.items.filter(function (x) { return x.id !== id; });
    if (editingId === id) resetForm();
    persist(); render();
    toast('삭제했어요.');
  }

  function startEdit(id) {
    var it = findItem(id);
    if (!it) return;
    editingId = id;
    var f = $('addForm').elements;
    f.type.value = it.type;
    f.title.value = it.title;
    f.date.value = it.date;
    f.time.value = it.time || '';
    var ra = remindAtOf(it);
    f.remind.value = ra ? String(it.remind) : '-1';
    if (f.remind.selectedIndex < 0) f.remind.value = '-1';
    f.remindTime.value = ra ? ra.slice(11, 16) : DEFAULT_REMIND_TIME;
    f.remindDate.value = ra ? ra.slice(0, 10) : '';
    f.memo.value = it.memo || '';
    updateRemindUI();
    $('formTitle').textContent = '일정 수정';
    $('submitBtn').textContent = '저장';
    $('cancelEdit').hidden = false;
    f.title.focus();
  }

  function resetForm() {
    editingId = null;
    var form = $('addForm');
    form.reset();
    form.elements.date.value = selected;
    updateRemindUI();
    $('formTitle').textContent = '일정 추가';
    $('submitBtn').textContent = '추가';
    $('cancelEdit').hidden = true;
  }

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target.elements;
    var title = f.title.value.trim();
    if (!title || !f.date.value) return;
    var remind = f.remind.value === 'custom' ? 'custom' : parseInt(f.remind.value, 10);
    var remindAt = computeRemindAt(f.remind.value, f.date.value, f.remindDate.value, f.remindTime.value);
    if (remind === 'custom' && !remindAt) { toast('알림 날짜를 선택해 주세요.'); f.remindDate.focus(); return; }
    var values = {
      type: f.type.value,
      title: title,
      date: f.date.value,
      time: f.time.value || '',
      remind: remindAt ? remind : -1,
      remindAt: remindAt,
      memo: f.memo.value.trim(),
      updatedAt: Date.now()
    };
    var msg;
    if (editingId) {
      var it = findItem(editingId);
      if (it) Object.keys(values).forEach(function (k) { it[k] = values[k]; });
      msg = '수정했어요.';
    } else {
      values.id = uid();
      values.done = false;
      values.createdAt = Date.now();
      data.items.push(values);
      msg = '추가했어요.';
    }
    var targetDate = values.date;
    if (remindAt && remindAt <= nowLocal()) msg += ' (알림 시각이 이미 지나서 카톡은 보내지 않아요)';
    resetForm();
    persist();
    select(targetDate, true);
    toast(msg);
  });
  $('cancelEdit').addEventListener('click', resetForm);

  // ── 내비게이션 ───────────────────────────────────────
  $('grid').addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    var ds = cell.dataset.date;
    select(ds, cell.classList.contains('other'));
    if (window.matchMedia('(max-width: 900px)').matches) $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  function shiftMonth(n) { view = new Date(view.getFullYear(), view.getMonth() + n, 1); renderCalendar(); }
  $('prevBtn').addEventListener('click', function () { shiftMonth(-1); });
  $('nextBtn').addEventListener('click', function () { shiftMonth(1); });
  $('todayBtn').addEventListener('click', function () { today = ymd(new Date()); select(today, true); });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select, dialog')) return;
    if (e.key === 'ArrowLeft') shiftMonth(-1);
    if (e.key === 'ArrowRight') shiftMonth(1);
  });

  // 다른 탭에서 수정된 경우 동기화
  window.addEventListener('storage', function (e) {
    if (e.key === STORE_KEY) { data = loadData(); render(); }
  });

  // ── 토스트 ───────────────────────────────────────────
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ── GitHub 동기화 (카톡 알림용) ──────────────────────
  function syncEnabled() { return settings.repo && settings.token; }
  function setSyncStatus(text) {
    var s = $('syncStatus');
    s.hidden = !syncEnabled();
    s.textContent = text;
  }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(b64.replace(/\n/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function ghRequest(method, body) {
    var url = 'https://api.github.com/repos/' + settings.repo + '/contents/' + DATA_PATH +
      (method === 'GET' ? '?ref=' + encodeURIComponent(settings.branch || 'main') : '');
    return fetch(url, {
      method: method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + settings.token,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
  }

  function ghGet() {
    return ghRequest('GET').then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('GitHub ' + res.status);
      return res.json();
    });
  }

  function pushToGitHub() {
    if (!syncEnabled()) return Promise.resolve();
    setSyncStatus('동기화 중…');
    return ghGet().then(function (file) {
      var payload = { version: 1, updatedAt: data.updatedAt, items: data.items };
      return ghRequest('PUT', {
        message: 'chore: 일정 업데이트',
        content: b64encode(JSON.stringify(payload, null, 2) + '\n'),
        branch: settings.branch || 'main',
        sha: file ? file.sha : undefined
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('GitHub ' + res.status);
      setSyncStatus('☁︎ 동기화됨');
    }).catch(function (err) {
      setSyncStatus('⚠︎ 동기화 실패');
      console.error(err);
      throw err;
    });
  }

  // auto=true: 시작 시 자동 동기화 (더 최근에 수정된 쪽이 이김)
  // auto=false: 사용자가 직접 "불러오기" — 저장소 내용으로 교체
  function pullFromGitHub(auto) {
    if (!syncEnabled()) { toast('저장소와 토큰을 먼저 입력해 주세요.'); return Promise.resolve(); }
    setSyncStatus('불러오는 중…');
    return ghGet().then(function (file) {
      if (!file) {
        if (auto && data.items.length) return pushToGitHub();
        if (!auto) toast('저장소에 아직 일정 파일이 없어요.');
        setSyncStatus('☁︎ 연결됨');
        return;
      }
      var remote = JSON.parse(b64decode(file.content));
      if (!remote || !Array.isArray(remote.items)) throw new Error('잘못된 파일 형식');
      if (auto && (data.updatedAt || 0) > (remote.updatedAt || 0)) return pushToGitHub();
      if (!auto && data.items.length && !confirm('이 브라우저의 일정을 저장소 내용(' + remote.items.length + '개)으로 바꿀까요?')) {
        setSyncStatus('☁︎ 연결됨');
        return;
      }
      data = { version: 1, updatedAt: remote.updatedAt || Date.now(), items: remote.items };
      safeSet(STORE_KEY, JSON.stringify(data));
      render();
      setSyncStatus('☁︎ 동기화됨');
      if (!auto) toast('GitHub에서 ' + remote.items.length + '개 일정을 불러왔어요.');
    }).catch(function (err) {
      setSyncStatus('⚠︎ 동기화 실패');
      toast('동기화 실패: ' + err.message);
    });
  }

  // 같은 id는 최근 수정본 우선으로 병합
  function mergeItems(local, remote) {
    var map = {};
    local.items.forEach(function (it) { map[it.id] = it; });
    remote.items.forEach(function (it) {
      if (!map[it.id] || (it.updatedAt || 0) > (map[it.id].updatedAt || 0)) map[it.id] = it;
    });
    return { version: 1, updatedAt: Date.now(), items: Object.keys(map).map(function (k) { return map[k]; }) };
  }

  var syncTimer;
  function scheduleSync() {
    if (!syncEnabled()) return;
    setSyncStatus('변경됨…');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { pushToGitHub().catch(function () {}); }, 1500);
  }

  // ── 설정 다이얼로그 ──────────────────────────────────
  var dlg = $('settings');
  $('settingsBtn').addEventListener('click', function () {
    var f = $('settingsForm').elements;
    f.repo.value = settings.repo || '';
    f.branch.value = settings.branch || '';
    f.token.value = settings.token || '';
    dlg.showModal();
  });
  dlg.addEventListener('close', function () {
    if (dlg.returnValue !== 'save') return;
    var f = $('settingsForm').elements;
    settings = {
      repo: f.repo.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''),
      branch: f.branch.value.trim() || 'main',
      token: f.token.value.trim()
    };
    safeSet(SETTINGS_KEY, JSON.stringify(settings));
    setSyncStatus(syncEnabled() ? '☁︎ 연결됨' : '');
    toast('설정을 저장했어요.');
  });
  function readFormSettings() {
    var f = $('settingsForm').elements;
    settings = {
      repo: f.repo.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''),
      branch: f.branch.value.trim() || 'main',
      token: f.token.value.trim()
    };
    safeSet(SETTINGS_KEY, JSON.stringify(settings));
  }
  $('pullBtn').addEventListener('click', function () { readFormSettings(); pullFromGitHub(false); });
  $('pushBtn').addEventListener('click', function () {
    readFormSettings();
    if (!syncEnabled()) { toast('저장소와 토큰을 먼저 입력해 주세요.'); return; }
    pushToGitHub().then(function () { toast('GitHub에 업로드했어요.'); }, function (err) { toast('업로드 실패: ' + err.message); });
  });

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ version: 1, updatedAt: data.updatedAt, items: data.items }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'schedule.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('importFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.text().then(function (txt) {
      var remote = JSON.parse(txt);
      if (!remote || !Array.isArray(remote.items)) throw new Error('잘못된 파일 형식');
      data = mergeItems(data, remote);
      persist(); render();
      toast(remote.items.length + '개 일정을 가져왔어요.');
    }).catch(function (err) { toast('가져오기 실패: ' + err.message); });
    e.target.value = '';
  });

  // ── 시작 ─────────────────────────────────────────────
  render();
  if (syncEnabled()) { setSyncStatus('☁︎ 연결됨'); pullFromGitHub(true); }
})();
