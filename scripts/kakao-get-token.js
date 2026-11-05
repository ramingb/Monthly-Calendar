#!/usr/bin/env node
/*
 * 카카오 인가 코드로 토큰을 발급받아 리프레시 토큰을 출력합니다. (최초 1회)
 *
 * 사용법:
 *   node scripts/kakao-get-token.js <REST_API_KEY> <인가코드> [REDIRECT_URI] [CLIENT_SECRET]
 *
 * 인가 코드는 브라우저에서 아래 주소로 접속해 동의한 뒤,
 * 리다이렉트된 주소의 ?code=... 값을 복사하면 됩니다.
 *   https://kauth.kakao.com/oauth/authorize?client_id=<REST_API_KEY>&redirect_uri=<REDIRECT_URI>&response_type=code&scope=talk_message
 */
'use strict';

const [restKey, code, redirectUri = 'https://localhost', clientSecret] = process.argv.slice(2);

if (!restKey || !code) {
  console.error('사용법: node scripts/kakao-get-token.js <REST_API_KEY> <인가코드> [REDIRECT_URI] [CLIENT_SECRET]');
  console.error('\n인가 코드 받는 주소:');
  console.error(`https://kauth.kakao.com/oauth/authorize?client_id=${restKey || '<REST_API_KEY>'}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=talk_message`);
  process.exit(1);
}

(async () => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: restKey,
    redirect_uri: redirectUri,
    code,
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) {
    console.error('발급 실패:', json);
    process.exit(1);
  }
  const days = Math.round(json.refresh_token_expires_in / 86400);
  console.log('\n✅ 발급 완료! 아래 값을 GitHub 저장소 Secrets 의 KAKAO_REFRESH_TOKEN 으로 등록하세요.\n');
  console.log(json.refresh_token);
  console.log(`\n(리프레시 토큰 유효기간: 약 ${days}일)`);
})();
