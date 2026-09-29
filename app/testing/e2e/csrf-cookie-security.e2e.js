/**
 * The CSRF cookie's `Secure` flag must reflect whether THIS request actually arrived over HTTPS, not
 * a static setting. This app is deployed over plain http://<LAN-IP>:3000 with no built-in HTTPS (see
 * README); a `Secure` cookie is silently refused by the browser on any insecure origin other than
 * localhost, so a phone hitting the server's LAN address (which can't use "localhost") would never
 * actually store the CSRF cookie at all -- every quiz/question edit would then fail CSRF validation
 * unconditionally. Testing from a desktop against http://localhost kept working (localhost is always
 * treated as a secure context), which is exactly why this shipped unnoticed.
 *
 * `app.set('trust proxy', 1)` makes Express honor an X-Forwarded-Proto header from the immediate
 * peer, so sending it ourselves is a reliable, hardware-independent way to simulate "this connection
 * is actually secure" without needing a real TLS-terminating proxy or a real non-localhost network
 * path -- and it exercises the exact mechanism the fix relies on (`req.secure`), rather than a static
 * NODE_ENV check that a shared dev/test server (normally run with NODE_ENV=development, see
 * ../README.md) would never have caught regressing back to.
 */

import { runSuite, sleep } from './lib/harness.js';
import { BASE } from './lib/config.js';

const parseSetCookie = (header) => {
  const [pair, ...attrs] = header.split(';').map((s) => s.trim());
  const [name, value] = pair.split('=');
  return { name, value, attrs: attrs.map((a) => a.toLowerCase()) };
};

await runSuite(
  'csrf cookie security',
  { quiz: { title: `CSRF Cookie ${Date.now().toString(36)}`, questions: [] }, chrome: false },
  async ({ ok, section, env }) => {
    const authHeader = { Authorization: `Bearer ${env.login.token}` };

    section('A plain (non-HTTPS) request gets a non-Secure cookie, so the browser will store it');
    const plainRes = await fetch(`${BASE}/api/csrf-token`, { headers: authHeader });
    const plainSetCookie = plainRes.headers.getSetCookie().find((c) => c.startsWith('x-csrf-token='));
    const plainCookie = parseSetCookie(plainSetCookie);
    ok('the cookie is set at all', !!plainSetCookie, plainSetCookie);
    ok('it is NOT marked Secure', !plainCookie.attrs.includes('secure'), plainSetCookie);
    ok('it is still HttpOnly and SameSite=Lax', plainCookie.attrs.includes('httponly') && plainCookie.attrs.includes('samesite=lax'), plainSetCookie);

    section('A request forwarded as HTTPS gets a Secure cookie (the flag tracks the real connection)');
    const httpsRes = await fetch(`${BASE}/api/csrf-token`, { headers: { ...authHeader, 'X-Forwarded-Proto': 'https' } });
    const httpsSetCookie = httpsRes.headers.getSetCookie().find((c) => c.startsWith('x-csrf-token='));
    const httpsCookie = parseSetCookie(httpsSetCookie);
    ok('this one IS marked Secure', httpsCookie.attrs.includes('secure'), httpsSetCookie);

    section('The non-Secure token/cookie pair from a plain request actually authorizes a real mutation');
    const { csrfToken } = await plainRes.json();
    const putRes = await fetch(`${BASE}/api/quizzes/${env.quiz.id}`, {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, Cookie: `${plainCookie.name}=${plainCookie.value}` },
      body: JSON.stringify({ title: env.quiz.title, description: 'updated by the csrf-cookie-security suite' }),
    });
    ok('the PUT succeeds (this is exactly the request a phone on plain HTTP sends)', putRes.ok, `${putRes.status} ${await putRes.text().catch(() => '')}`);

    section("A mismatched token still gets rejected (the fix didn't weaken validation)");
    await sleep(50);
    const otherTokenRes = await fetch(`${BASE}/api/csrf-token`, { headers: authHeader });
    const { csrfToken: otherToken } = await otherTokenRes.json();
    const badRes = await fetch(`${BASE}/api/quizzes/${env.quiz.id}`, {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json', 'x-csrf-token': otherToken, Cookie: `${plainCookie.name}=${plainCookie.value}` },
      body: JSON.stringify({ title: env.quiz.title }),
    });
    ok('a header token that does not match the cookie is refused (403)', badRes.status === 403, String(badRes.status));
  }
);
