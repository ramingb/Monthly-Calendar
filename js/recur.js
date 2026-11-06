/*
 * 반복 일정 계산 (브라우저 / Node 공용)
 *
 * 일정 필드
 *   repeat      '' | 'weekly' | 'monthly' | 'yearly'
 *   repeatUntil 'YYYY-MM-DD' (선택) — 이 날짜까지만 반복
 *   skipDates   ['YYYY-MM-DD'] — "이 날짜만 삭제"한 회차
 *   doneDates   { 'YYYY-MM-DD': true } — 회차별 완료 체크
 *
 * 매월 31일처럼 그 달에 없는 날짜는 그 달의 마지막 날로, 매년 2월 29일은 평년엔 2월 28일로 맞춥니다.
 */
(function (root) {
  'use strict';

  var LABEL = { weekly: '매주', monthly: '매월', yearly: '매년' };
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }

  /** base 날짜에서 n개월 뒤 (일자는 그 달 마지막 날을 넘지 않게) */
  function addMonths(base, n) {
    var b = parse(base);
    var y = b.getUTCFullYear(), m = b.getUTCMonth() + n, day = b.getUTCDate();
    var first = new Date(Date.UTC(y, m, 1));
    var last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, last));
    return ymd(first);
  }

  function endOf(it) { return it.endDate && it.endDate > it.date ? it.endDate : it.date; }
  function duration(it) { return diffDays(it.date, endOf(it)); } // 여러 날 일정의 (일수 - 1)
  function isRepeating(it) { return !!LABEL[it.repeat]; }

  /** k번째 회차의 시작일 */
  function nth(it, k) {
    if (it.repeat === 'weekly') return addDays(it.date, 7 * k);
    if (it.repeat === 'monthly') return addMonths(it.date, k);
    return addMonths(it.date, 12 * k);
  }

  /** [from, to] 기간과 겹치는 회차 시작일 목록 */
  function occurrenceStarts(it, from, to) {
    if (!isRepeating(it)) return it.date <= to && endOf(it) >= from ? [it.date] : [];
    var dur = duration(it);
    var skip = {};
    (it.skipDates || []).forEach(function (s) { skip[s] = true; });
    var until = it.repeatUntil || '9999-12-31';
    // 첫 후보 회차 번호를 대략 계산 (조금 앞에서 시작해 정확히 거름)
    var k = 0;
    var gap = diffDays(it.date, from) - dur;
    if (gap > 0) {
      if (it.repeat === 'weekly') k = Math.floor(gap / 7);
      else if (it.repeat === 'monthly') k = Math.max(0, Math.floor(gap / 31) - 1);
      else k = Math.max(0, Math.floor(gap / 366) - 1);
    }
    var out = [];
    for (var guard = 0; guard < 2000; guard++, k++) {
      var s = nth(it, k);
      if (s > to || s > until) break;
      if (addDays(s, dur) >= from && !skip[s]) out.push(s);
    }
    return out;
  }

  /** 회차의 알림 시각: 첫 회차의 알림 시각을 회차만큼 옮김 */
  function remindAtFor(baseRemindAt, baseDate, occDate) {
    if (!baseRemindAt) return '';
    return addDays(baseRemindAt.slice(0, 10), diffDays(baseDate, occDate)) + baseRemindAt.slice(10);
  }

  /** "매월 10일" 같은 설명 */
  function describe(it) {
    if (!isRepeating(it)) return '';
    var d = parse(it.date);
    var txt;
    if (it.repeat === 'weekly') txt = '매주 ' + WEEK[d.getUTCDay()] + '요일';
    else if (it.repeat === 'monthly') txt = '매월 ' + d.getUTCDate() + '일';
    else txt = '매년 ' + (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일';
    if (it.repeatUntil) {
      var u = parse(it.repeatUntil);
      txt += ' (' + u.getUTCFullYear() + '.' + (u.getUTCMonth() + 1) + '.' + u.getUTCDate() + '까지)';
    }
    return txt;
  }

  var api = {
    LABEL: LABEL,
    isRepeating: isRepeating,
    occurrenceStarts: occurrenceStarts,
    remindAtFor: remindAtFor,
    describe: describe,
    addDays: addDays,
    diffDays: diffDays
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Recur = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
