#!/usr/bin/env node
/*
 * data/schedule.json 에서 오늘 알림 대상인 일정을 찾아
 * 카카오톡 "나에게 보내기"(나와의 채팅)로 전송합니다.
 *
 * 환경변수
 *   KAKAO_REST_API_KEY   카카오 디벨로퍼스 앱의 REST API 키 (필수)
 *   KAKAO_REFRESH_TOKEN  최초 1회 발급받은 리프레시 토큰 (필수)
 *   KAKAO_CLIENT_SECRET  앱에서 Client Secret 을 켠 경우에만
 *   CALENDAR_URL         메시지 버튼이 열 주소 (예: GitHub Pages 주소)
 *   DRY_RUN=1            실제 전송 없이 메시지만 출력
 *   TODAY=YYYY-MM-DD     기준 날짜 강제 지정 (테스트용)
 *
 * Node 18+ (내장 fetch) 필요.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('../js/holidays.js');

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const DATA_FILE = path.join(__dirname, '..', 'data', 'schedule.json');
const MAX_TEXT = 200; // 카카오 텍스트 템플릿 최대 길이

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }

/** 한국 시간 기준 오늘 날짜 */
function todayKST() {
  if (process.env.TODAY) return process.env.TODAY;
  return ymd(new Date(Date.now() + 9 * 3600 * 1000));
}

function label(dateStr) {
  const d = parse(dateStr);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})`;
}

function dday(n) { return n === 0 ? '오늘' : n === 1 ? '내일' : `D-${n}`; }

/** 오늘 알림을 보낼 일정 목록 */
function dueItems(items, today) {
  return items
    .filter((it) => !it.done && Number.isInteger(it.remind) && it.remind >= 0)
    .map((it) => ({ ...it, left: diffDays(today, it.date) }))
    .filter((it) => it.left === it.remind)
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

function buildLines(items) {
  return items.map((it) => {
    const icon = it.type === 'todo' ? '✅' : '📌';
    const hol = H.holidayNames(it.date);
    const when = `${label(it.date)}${it.time ? ' ' + it.time : ''}`;
    return `${icon} [${dday(it.left)}] ${when} ${it.title}${hol.length ? ` (${hol[0]})` : ''}`;
  });
}

/** 200자 제한에 맞춰 여러 메시지로 분할 */
function chunk(header, lines) {
  const out = [];
  let cur = header;
  for (const raw of lines) {
    const line = raw.length > MAX_TEXT - header.length - 2 ? raw.slice(0, MAX_TEXT - header.length - 3) + '…' : raw;
    if ((cur + '\n' + line).length > MAX_TEXT) { out.push(cur); cur = header; }
    cur += '\n' + line;
  }
  if (cur !== header) out.push(cur);
  return out;
}

async function refreshAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.KAKAO_REST_API_KEY,
    refresh_token: process.env.KAKAO_REFRESH_TOKEN,
  });
  if (process.env.KAKAO_CLIENT_SECRET) body.set('client_secret', process.env.KAKAO_CLIENT_SECRET);
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(json)}`);
  if (json.refresh_token) {
    // 리프레시 토큰 만료가 1개월 미만이면 새 토큰이 발급됨 → 시크릿 교체 필요
    console.log('::warning::카카오 리프레시 토큰이 갱신되었습니다. README 안내에 따라 KAKAO_REFRESH_TOKEN 시크릿을 교체하세요.');
    console.log(`::add-mask::${json.refresh_token}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '⚠️ 카카오 리프레시 토큰이 곧 만료됩니다. `node scripts/kakao-get-token.js` 로 새 토큰을 발급해 시크릿을 교체하세요.\n');
    }
  }
  return json.access_token;
}

async function sendMemo(accessToken, text) {
  const url = process.env.CALENDAR_URL || 'https://github.com';
  const template = {
    object_type: 'text',
    text,
    link: { web_url: url, mobile_web_url: url },
    button_title: '캘린더 열기',
  };
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.result_code !== 0) throw new Error(`메시지 전송 실패: ${res.status} ${JSON.stringify(json)}`);
}

async function main() {
  const today = todayKST();
  if (!fs.existsSync(DATA_FILE)) { console.log('data/schedule.json 없음 — 종료'); return; }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const items = dueItems(Array.isArray(data.items) ? data.items : [], today);

  console.log(`기준일 ${today} · 알림 대상 ${items.length}건`);
  if (!items.length) return;

  const header = `🗓 ${label(today)} 일정 알림`;
  const messages = chunk(header, buildLines(items));

  if (process.env.DRY_RUN) { messages.forEach((m) => console.log('---\n' + m)); return; }

  for (const k of ['KAKAO_REST_API_KEY', 'KAKAO_REFRESH_TOKEN']) {
    if (!process.env[k]) throw new Error(`${k} 환경변수가 없습니다.`);
  }
  const token = await refreshAccessToken();
  for (const m of messages) await sendMemo(token, m);
  console.log(`카카오톡 메시지 ${messages.length}개 전송 완료`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { dueItems, buildLines, chunk };
