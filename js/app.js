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
      if (raw && Array.isArray(raw.items)) {
        if (!Array.isArray(raw.categories)) raw.categories = [];
        return raw;
      }
    } catch (e) { /* 손상된 데이터는 무시 */ }
    return { version: 1, updatedAt: 0, items: [], categories: [] };
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

  // ── 카테고리 ─────────────────────────────────────────
  var SWATCHES = ['#e5484d', '#f76b15', '#f5a524', '#30a46c', '#12a594', '#0090ff',
    '#2f6fed', '#7c5cff', '#d6409f', '#8d6e63', '#607d8b', '#1d2230'];

  function catById(id) {
    if (!id) return null;
    for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i];
    return null;
  }
  /** 선택 가능한(삭제되지 않은) 카테고리 */
  function activeCats() { return data.categories.filter(function (c) { return !c.deleted; }); }
  /** 일정 색상 (카테고리 색 → 없으면 null = 종류 기본색) — 삭제된 카테고리도 기존 일정엔 계속 표시 */
  function colorOf(it) { var c = catById(it.categoryId); return c ? c.color : null; }
  function hexAlpha(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  /** 요소에 카테고리 색 적용 (kind: 'chip' | 'border' | 'bg') */
  function paint(node, it, kind) {
    var c = colorOf(it);
    if (!c) return;
    node.style.setProperty('--cat', c);
    node.style.setProperty('--cat-soft', hexAlpha(c, .16));
    node.classList.add('has-cat');
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
        var cat = catById(it.categoryId);
        chip.title = (cat ? '[' + cat.name + '] ' : '') + it.title;
        paint(chip, it);
        cell.appendChild(chip);
      });
      if (list.length > MAX) cell.appendChild(el('div', 'more', '+' + (list.length - MAX) + '개 더'));

      grid.appendChild(cell);
    }
    renderLists();
    renderLegend();
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
      paint(li, it);
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
      var icat = catById(it.categoryId);
      if (icat) {
        var tag = el('span', 'cat-tag', icat.name);
        tag.style.setProperty('--cat', icat.color);
        tag.style.setProperty('--cat-soft', hexAlpha(icat.color, .16));
        meta.appendChild(tag);
      }
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
      var dot = el('i', 'cat-dot sm ' + it.type);
      paint(dot, it);
      li.appendChild(dot);
      li.appendChild(el('span', it.done ? 'done' : null, it.title));
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
        var bar = el('span', 'mbar ' + it.type);
        paint(bar, it);
        body.appendChild(bar);
        var lcat = catById(it.categoryId);
        if (lcat) {
          var ltag = el('span', 'cat-tag', lcat.name);
          ltag.style.setProperty('--cat', lcat.color);
          ltag.style.setProperty('--cat-soft', hexAlpha(lcat.color, .16));
          body.appendChild(ltag);
        }
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

  function render() { fillCategorySelect($('catValue').value); renderCalendar(); renderPanel(); }

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

  // ── 카테고리 UI ──────────────────────────────────────
  function fillCategorySelect(selectedId) {
    var box = $('catPicker');
    var cur = catById(selectedId) ? selectedId : '';
    // 삭제된 카테고리는 새로 고를 수 없지만, 그 카테고리 일정을 수정 중이면 그대로 보여줌
    if (cur && catById(cur).deleted && !(editingId && (findItem(editingId) || {}).categoryId === cur)) cur = '';
    $('catValue').value = cur;
    box.textContent = '';

    function chip(id, name, color, extraCls) {
      var b = el('button', 'cat-chip' + (extraCls ? ' ' + extraCls : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === cur));
      if (id === cur) b.classList.add('on');
      if (color) {
        b.style.setProperty('--cat', color);
        b.style.setProperty('--cat-soft', hexAlpha(color, .16));
        b.appendChild(el('i', 'cat-dot sm has-cat'));
      }
      b.appendChild(document.createTextNode(name));
      b.addEventListener('click', function () { fillCategorySelect(id); });
      box.appendChild(b);
    }
    chip('', '없음', null, 'none');
    activeCats().forEach(function (c) { chip(c.id, c.name, c.color); });
    var curCat = catById(cur);
    if (curCat && curCat.deleted) chip(curCat.id, curCat.name + ' (삭제됨)', curCat.color, 'deleted');

    var add = el('button', 'cat-chip add', '＋ 새 카테고리');
    add.type = 'button';
    add.addEventListener('click', function () { catReturnSelect = true; openCategories(true); });
    box.appendChild(add);
  }
  var catReturnSelect = false;
  $('catManageBtn').addEventListener('click', function () { catReturnSelect = false; openCategories(false); });

  function renderLegend() {
    var lg = $('legend');
    lg.textContent = '';
    function item(color, cls, name) {
      var s = el('span');
      var d = el('i', 'dot' + (cls ? ' ' + cls : ''));
      if (color) d.style.background = color;
      s.appendChild(d); s.appendChild(document.createTextNode(name));
      lg.appendChild(s);
    }
    var act = activeCats();
    act.forEach(function (c) { item(c.color, null, c.name); });
    if (!act.length) { item(null, 'appt', '약속'); item(null, 'todo', '할 일'); }
    item(null, 'holiday', '공휴일');
    var b = el('button', 'btn ghost small', act.length ? '카테고리 관리' : '＋ 카테고리 만들기');
    b.type = 'button';
    b.addEventListener('click', function () { catReturnSelect = false; openCategories(false); });
    lg.appendChild(b);
  }

  function renderCatList() {
    var ul = $('catList');
    ul.textContent = '';
    var act = activeCats();
    if (!act.length) { ul.appendChild(el('li', 'mempty', '아직 카테고리가 없어요. 아래에서 만들어 보세요.')); return; }
    act.forEach(function (c) {
      var li = el('li', 'cat-row');
      var color = document.createElement('input');
      color.type = 'color'; color.value = c.color; color.setAttribute('aria-label', c.name + ' 색상');
      color.addEventListener('input', function () { c.color = color.value; render(); fillCategorySelect($('catValue').value); });
      color.addEventListener('change', function () { persist(); });
      var name = document.createElement('input');
      name.type = 'text'; name.value = c.name; name.maxLength = 20; name.setAttribute('aria-label', '카테고리 이름');
      name.addEventListener('change', function () {
        var v = name.value.trim();
        if (!v) { name.value = c.name; return; }
        c.name = v; persist(); render(); fillCategorySelect($('catValue').value);
      });
      var count = data.items.filter(function (it) { return it.categoryId === c.id; }).length;
      var cnt = el('span', 'cat-count', count + '개');
      var del = el('button', 'btn ghost small danger', '삭제'); del.type = 'button';
      del.addEventListener('click', function () {
        if (!confirm('"' + c.name + '" 카테고리를 삭제할까요?\n일정 추가 목록에서는 사라지고, ' +
          (count ? '이미 등록된 일정 ' + count + '개는 달력에 카테고리 그대로 남아요.' : '등록된 일정은 없어요.'))) return;
        if (count) { c.deleted = true; c.deletedAt = Date.now(); }  // 기존 일정 표시용으로 보관
        else data.categories = data.categories.filter(function (x) { return x.id !== c.id; });
        persist(); render(); renderCatList(); fillCategorySelect($('catValue').value);
      });
      li.appendChild(color); li.appendChild(name); li.appendChild(cnt); li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function nextSwatch() {
    var used = activeCats().map(function (c) { return c.color.toLowerCase(); });
    for (var i = 0; i < SWATCHES.length; i++) if (used.indexOf(SWATCHES[i]) < 0) return SWATCHES[i];
    return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  }

  function renderSwatches() {
    var box = $('swatches');
    box.textContent = '';
    SWATCHES.forEach(function (hex) {
      var b = el('button', 'swatch'); b.type = 'button';
      b.style.background = hex; b.setAttribute('aria-label', hex);
      if ($('newCatColor').value.toLowerCase() === hex) b.classList.add('on');
      b.addEventListener('click', function () { $('newCatColor').value = hex; renderSwatches(); });
      box.appendChild(b);
    });
  }
  $('newCatColor').addEventListener('input', renderSwatches);

  function openCategories(focusNew) {
    renderCatList();
    $('newCatColor').value = nextSwatch();
    $('newCatName').value = '';
    renderSwatches();
    $('catDialog').showModal();
    if (focusNew) $('newCatName').focus();
  }

  function addCategory() {
    var name = $('newCatName').value.trim();
    if (!name) { toast('카테고리 이름을 입력해 주세요.'); $('newCatName').focus(); return; }
    var c = { id: 'c' + uid(), name: name, color: $('newCatColor').value };
    data.categories.push(c);
    persist(); render(); renderCatList();
    $('newCatName').value = '';
    $('newCatColor').value = nextSwatch();
    renderSwatches();
    if (catReturnSelect) {
      fillCategorySelect(c.id);
      catReturnSelect = false;
      $('catDialog').close();
      toast('"' + c.name + '" 카테고리를 만들었어요.');
    } else {
      fillCategorySelect($('catValue').value);
      $('newCatName').focus();
    }
  }
  $('addCatBtn').addEventListener('click', addCategory);
  $('newCatName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
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
    fillCategorySelect(catById(it.categoryId) ? it.categoryId : '');
    updateRemindUI();
    $('formTitle').textContent = '일정 수정';
    $('submitBtn').textContent = '저장';
    $('cancelEdit').hidden = false;
    f.title.focus();
  }

  function resetForm() {
    editingId = null;
    var form = $('addForm');
    var keepCat = form.elements.category.value;
    form.reset();
    var kc = catById(keepCat);
    fillCategorySelect(kc && !kc.deleted ? keepCat : '');
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
      categoryId: catById(f.category.value) ? f.category.value : '',
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
      var payload = { version: 1, updatedAt: data.updatedAt, categories: data.categories, items: data.items };
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
      data = { version: 1, updatedAt: remote.updatedAt || Date.now(), items: remote.items,
        categories: Array.isArray(remote.categories) ? remote.categories : [] };
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
    var cats = {};
    (local.categories || []).forEach(function (c) { cats[c.id] = c; });
    (remote.categories || []).forEach(function (c) { if (!cats[c.id] || (c.deleted && !cats[c.id].deleted)) cats[c.id] = c; });
    return { version: 1, updatedAt: Date.now(), items: Object.keys(map).map(function (k) { return map[k]; }),
      categories: Object.keys(cats).map(function (k) { return cats[k]; }) };
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
    var blob = new Blob([JSON.stringify({ version: 1, updatedAt: data.updatedAt, categories: data.categories, items: data.items }, null, 2)], { type: 'application/json' });
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
  fillCategorySelect('');
  render();
  if (syncEnabled()) { setSyncStatus('☁︎ 연결됨'); pullFromGitHub(true); }
})();
