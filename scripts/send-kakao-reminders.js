#!/usr/bin/env node
/*
 * data/schedule.json 에서 알림 시각(remindAt, 한국시간)이 된 일정을 찾아
 * 카카오톡 "나에게 보내기"(나와의 채팅)로 전송합니다.
 * 보낸 알림은 data/sent.json 에 기록해 중복 전송을 막습니다. (워크플로가 커밋)
 *
 * 환경변수
 *   KAKAO_REST_API_KEY   카카오 디벨로퍼스 앱의 REST API 키 (필수)
 *   KAKAO_REFRESH_TOKEN  최초 1회 발급받은 리프레시 토큰 (필수)
 *   KAKAO_CLIENT_SECRET  앱에서 Client Secret 을 켠 경우에만
 *   CALENDAR_URL         메시지 버튼이 열 주소 (예: GitHub Pages 주소)
 *   DRY_RUN=1            실제 전송 없이 메시지만 출력
 *   NOW=YYYY-MM-DDTHH:MM 기준 시각(한국시간) 강제 지정 (테스트용)
 *
 * Node 18+ (내장 fetch) 필요.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('../js/holidays.js');

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const DATA_FILE = path.join(__dirname, '..', 'data', 'schedule.json');
const SENT_FILE = path.join(__dirname, '..', 'data', 'sent.json');
const DEFAULT_REMIND_TIME = '08:00';
const CATCH_UP_HOURS = 12; // 실행이 늦어지거나 빠져도 이 시간 안의 알림은 보냄
const KEEP_SENT_DAYS = 60;
const MAX_TEXT = 200; // 카카오 텍스트 템플릿 최대 길이

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }

/** 한국 시간 기준 현재 시각 'YYYY-MM-DDTHH:MM' */
function nowKST() {
  if (process.env.NOW) return process.env.NOW;
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16);
}

/** 'YYYY-MM-DDTHH:MM' 에 시간(h) 더하기 */
function addHours(at, h) {
  return new Date(Date.parse(at + ':00Z') + h * 3600 * 1000).toISOString().slice(0, 16);
}

/** 일정의 알림 시각 (예전 데이터: remind 일수만 있으면 그날 08:00) */
function remindAtOf(it) {
  if (typeof it.remindAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(it.remindAt)) return it.remindAt;
  if (it.remindAt === '') return '';
  const n = Number(it.remind);
  if (!Number.isInteger(n) || n < 0) return '';
  const d = parse(it.date);
  d.setUTCDate(d.getUTCDate() - n);
  return `${ymd(d)}T${it.remindTime || DEFAULT_REMIND_TIME}`;
}

function sentKey(it, at) { return `${it.id}|${at}`; }

function label(dateStr) {
  const d = parse(dateStr);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})`;
}

function relDay(n) {
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n === 2) return '모레';
  return n > 0 ? `${n}일 후` : `${-n}일 지남`;
}

/** 지금 보낼 알림 목록: 알림 시각 ≤ 지금, 최근 CATCH_UP_HOURS 이내, 미완료, 미전송 */
function dueItems(items, now, sent) {
  const from = addHours(now, -CATCH_UP_HOURS);
  return items
    .filter((it) => it && it.id && it.date && !it.done)
    .map((it) => ({ ...it, at: remindAtOf(it) }))
    .filter((it) => it.at && it.at <= now && it.at > from && !sent[sentKey(it, it.at)])
    .map((it) => ({ ...it, left: diffDays(now.slice(0, 10), it.date) }))
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

function buildLines(items) {
  return items.map((it) => {
    const icon = it.type === 'todo' ? '✅' : '📌';
    const hol = H.holidayNames(it.date);
    const when = `${label(it.date)}${it.time ? ' ' + it.time : ''}`;
    return `${icon} [${relDay(it.left)}] ${when} ${it.title}${hol.length ? ` (${hol[0]})` : ''}`;
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

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** 오래된 전송 기록 정리 */
function pruneSent(sent, now) {
  const limit = addHours(now, -24 * KEEP_SENT_DAYS);
  const out = {};
  for (const [k, v] of Object.entries(sent)) if (k.split('|')[1] > limit) out[k] = v;
  return out;
}

async function main() {
  const now = nowKST();
  const data = loadJSON(DATA_FILE, null);
  if (!data) { console.log('data/schedule.json 없음 — 종료'); return; }
  let sent = loadJSON(SENT_FILE, {});
  const items = dueItems(Array.isArray(data.items) ? data.items : [], now, sent);

  console.log(`기준 ${now} (KST) · 알림 대상 ${items.length}건`);
  if (!items.length) return;

  const header = `🔔 일정 알림 · ${label(now.slice(0, 10))}`;
  const messages = chunk(header, buildLines(items));

  if (process.env.DRY_RUN) { messages.forEach((m) => console.log('---\n' + m)); return; }

  for (const k of ['KAKAO_REST_API_KEY', 'KAKAO_REFRESH_TOKEN']) {
    if (!process.env[k]) throw new Error(`${k} 환경변수가 없습니다.`);
  }
  const token = await refreshAccessToken();
  for (const m of messages) await sendMemo(token, m);

  const sentAt = new Date().toISOString();
  for (const it of items) sent[sentKey(it, it.at)] = sentAt;
  sent = pruneSent(sent, now);
  fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2) + '\n');
  console.log(`카카오톡 메시지 ${messages.length}개 전송 완료`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { dueItems, buildLines, chunk, remindAtOf };
