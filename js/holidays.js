/*
 * 대한민국 공휴일 계산 모듈 (브라우저 / Node 공용)
 *
 * - 양력 고정 공휴일 + 음력 공휴일(설날·부처님오신날·추석) + 대체공휴일 + 임시공휴일
 * - 대체공휴일 규칙 (「관공서의 공휴일에 관한 규정」)
 *   · 설날·추석 연휴: 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 비공휴일
 *   · 삼일절·어린이날·광복절·개천절·한글날·부처님오신날·성탄절:
 *     토/일요일 또는 다른 공휴일과 겹치면 다음 첫 비공휴일
 *   · 신정·현충일·제헌절: 대체공휴일 없음
 * - 음력 공휴일 날짜는 LUNAR 표에 내장 (필요 시 연도 추가)
 */
(function (root) {
  'use strict';

  // 음력 공휴일의 양력 날짜 (설날 당일, 부처님오신날, 추석 당일)
  var LUNAR = {
    2024: { seollal: '2024-02-10', buddha: '2024-05-15', chuseok: '2024-09-17' },
    2025: { seollal: '2025-01-29', buddha: '2025-05-05', chuseok: '2025-10-06' },
    2026: { seollal: '2026-02-17', buddha: '2026-05-24', chuseok: '2026-09-25' },
    2027: { seollal: '2027-02-07', buddha: '2027-05-13', chuseok: '2027-09-15' },
    2028: { seollal: '2028-01-27', buddha: '2028-05-02', chuseok: '2028-10-03' },
    2029: { seollal: '2029-02-13', buddha: '2029-05-20', chuseok: '2029-09-22' },
    2030: { seollal: '2030-02-03', buddha: '2030-05-09', chuseok: '2030-09-12' }
  };

  // 임시공휴일·선거일 등 (대체공휴일 대상 아님)
  var SPECIAL = {
    '2024-04-10': '제22대 국회의원선거',
    '2024-10-01': '국군의 날(임시공휴일)',
    '2025-01-27': '임시공휴일',
    '2025-06-03': '제21대 대통령선거',
    '2026-06-03': '제9회 전국동시지방선거'
  };

  // 공휴일은 아니지만 달력에 표시할 기념일
  var OBSERVANCES = {
    '05-01': '노동절',
    '05-08': '어버이날',
    '05-15': '스승의 날',
    '10-01': '국군의 날'
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { return parse(s).getDay(); }

  var cache = {};

  /** 해당 연도의 공휴일 맵 반환: { 'YYYY-MM-DD': ['이름', ...] } */
  function getHolidays(year) {
    if (cache[year]) return cache[year];

    var map = {};          // date -> [names]
    var groups = [];       // 대체공휴일 판정 단위
    function add(date, name) { (map[date] = map[date] || []).push(name); }

    // 양력 고정 공휴일 [월-일, 이름, 대체규칙: null | 'weekend']
    var fixed = [
      ['01-01', '신정', null],
      ['03-01', '삼일절', year >= 2022 ? 'weekend' : null],
      ['05-05', '어린이날', 'weekend'],
      ['06-06', '현충일', null],
      ['08-15', '광복절', year >= 2021 ? 'weekend' : null],
      ['10-03', '개천절', year >= 2021 ? 'weekend' : null],
      ['10-09', '한글날', year >= 2021 ? 'weekend' : null],
      ['12-25', '성탄절', year >= 2023 ? 'weekend' : null]
    ];
    if (year >= 2026) fixed.push(['07-17', '제헌절', null]);

    fixed.forEach(function (f) {
      var date = year + '-' + f[0];
      add(date, f[1]);
      groups.push({ name: f[1], dates: [date], rule: f[2] });
    });

    var lunar = LUNAR[year];
    if (lunar) {
      var s = lunar.seollal;
      add(addDays(s, -1), '설날 연휴'); add(s, '설날'); add(addDays(s, 1), '설날 연휴');
      groups.push({ name: '설날', dates: [addDays(s, -1), s, addDays(s, 1)], rule: 'sunday' });

      add(lunar.buddha, '부처님오신날');
      groups.push({ name: '부처님오신날', dates: [lunar.buddha], rule: year >= 2023 ? 'weekend' : null });

      var c = lunar.chuseok;
      add(addDays(c, -1), '추석 연휴'); add(c, '추석'); add(addDays(c, 1), '추석 연휴');
      groups.push({ name: '추석', dates: [addDays(c, -1), c, addDays(c, 1)], rule: 'sunday' });
    }

    Object.keys(SPECIAL).forEach(function (date) {
      if (+date.slice(0, 4) === year) add(date, SPECIAL[date]);
    });

    // 대체공휴일 계산 — 같은 날짜에서 중복 발생하지 않도록 날짜 단위로 트리거를 모음
    var triggers = []; // { date, after, name }
    var seen = {};
    groups.forEach(function (g) {
      if (!g.rule) return;
      g.dates.forEach(function (date) {
        var wd = dow(date);
        var isTrigger =
          (g.rule === 'weekend' && (wd === 0 || wd === 6)) ||
          (g.rule === 'sunday' && wd === 0) ||
          map[date].length > 1; // 다른 공휴일과 겹침
        if (isTrigger && !seen[date]) {
          seen[date] = true;
          triggers.push({ date: date, after: g.dates[g.dates.length - 1], name: g.name });
        }
      });
    });
    triggers.sort(function (a, b) { return a.after < b.after ? -1 : a.after > b.after ? 1 : 0; });

    triggers.forEach(function (t) {
      var d = addDays(t.after, 1);
      while (dow(d) === 0 || dow(d) === 6 || map[d]) d = addDays(d, 1);
      add(d, '대체공휴일');
    });

    cache[year] = map;
    return map;
  }

  /** 특정 날짜의 공휴일 이름 배열 (없으면 빈 배열) */
  function holidayNames(dateStr) {
    var m = getHolidays(+dateStr.slice(0, 4));
    return m[dateStr] ? m[dateStr].slice() : [];
  }

  /** 공휴일이 아닌 기념일 이름 (없으면 null) */
  function observance(dateStr) {
    return OBSERVANCES[dateStr.slice(5)] || null;
  }

  var api = {
    getHolidays: getHolidays,
    holidayNames: holidayNames,
    observance: observance,
    lunarYears: Object.keys(LUNAR).map(Number)
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KoreanHolidays = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
