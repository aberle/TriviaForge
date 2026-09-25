/**
 * Joining a room: display names are unique per room, a player who has already joined keeps their
 * name (and the form locks it), QR links only auto-join rooms already joined, and guest-only mode
 * (GUEST_ONLY_MODE=true) removes usernames and accounts.
 *
 * The guest-only checks adapt to the server: run this suite against a server started with
 * GUEST_ONLY_MODE=true and again without it to cover both.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

const TAKEN = /already taken/i;

await runSuite(
  'join and identity',
  { quiz: { rounds: [{ title: 'R', timeLimitSeconds: null }], questions: [Q.mc('Capital of France?', ['Paris', 'Rome'], 0, 0)] } },
  async ({ ok, section, env }) => {
    const roomA = env.room;

    // A socket-level "device": joins with its own PlayerID and logs what it hears
    const device = (id) => env.bot(id);
    const join = async (d, room, username, displayName, extra = {}) => {
      const since = d.mark();
      d.emit('joinRoom', { roomCode: room, username, displayName, playerID: d.playerID, ...extra });
      await sleep(700);
      const got = d.log.slice(since);
      return { error: got.find((x) => x.event === 'roomError')?.payload, joined: got.some((x) => x.event === 'playerListUpdate'), got };
    };
    const lookup = async (d, room, username) => {
      const since = d.mark();
      d.emit('lookupRoomIdentity', { roomCode: room, username });
      await sleep(400);
      return d.log.slice(since).find((x) => x.event === 'roomIdentity')?.payload;
    };
    const leave = async (page) => {
      await page.clickText('Leave Room');
      await sleep(500);
      await page.eval(`[...document.querySelectorAll('button.btn-danger')].filter(b => b.innerText.includes('Leave Room')).pop().click(); true`);
      await sleep(1500);
    };
    const nameField = (page) => page.eval(`({ value: document.querySelector('#playerDisplayName')?.value, readOnly: document.querySelector('#playerDisplayName')?.readOnly, hint: document.querySelector('.form-hint:last-of-type')?.innerText ?? '' })`);

    section('Display names are unique within a room');
    const a = device('dev-a');
    let r = await join(a, roomA, 'ann_user', 'Ann');
    ok('the first device joins as "Ann"', r.joined && !r.error);
    const b = device('dev-b');
    r = await join(b, roomA, 'bob_user', 'Ann');
    ok('a different device using "Ann" is refused, with a clear message', !r.joined && TAKEN.test(r.error || ''), r.error);
    r = await join(b, roomA, 'bob_user', '  aNN ');
    ok('...also when the capitalization or surrounding spaces differ', !r.joined && TAKEN.test(r.error || ''));
    ok('the room still has just one Ann', JSON.stringify(await env.players(roomA)) === JSON.stringify(['Ann']));
    r = await join(b, roomA, 'bob_user', 'Bob');
    ok('the same device can join with a different name', r.joined && !r.error);
    const c = device('dev-c');
    const d = device('dev-d');
    const marks = [c.mark(), d.mark()];
    c.emit('joinRoom', { roomCode: roomA, username: 'c_user', displayName: 'Cy', playerID: c.playerID });
    d.emit('joinRoom', { roomCode: roomA, username: 'd_user', displayName: 'Cy', playerID: d.playerID });
    await sleep(1500);
    const refused = [c, d].filter((x, i) => x.log.slice(marks[i]).some((e) => e.event === 'roomError' && TAKEN.test(e.payload)));
    ok('two devices joining "Cy" at the same instant: exactly one gets in', refused.length === 1 && (await env.players(roomA)).filter((n) => n === 'Cy').length === 1);
    const display = device('dev-display');
    r = await join(display, roomA, 'Display', 'Spectator Display', { isSpectator: true });
    ok('the display page can still join', r.joined && !r.error);

    section('A player who has already joined keeps their name');
    a.close();
    await sleep(300);
    const a2 = device('dev-a'); // the same device again
    const before = a2.mark();
    r = await join(a2, roomA, 'ann_user', 'Annie'); // tries to rejoin under another name
    ok('rejoining under a different name keeps the original one', JSON.stringify(await env.players(roomA)).includes('"Ann"') && !JSON.stringify(await env.players(roomA)).includes('Annie'));
    ok('...and the player is told the name they are known by', a2.all('roomInfo', before)[0]?.displayName === 'Ann');
    ok('the identity lookup returns their name for that room', (await lookup(a2, roomA, 'ann_user'))?.displayName === 'Ann');
    ok('...and nothing for another device', (await lookup(device('dev-stranger'), roomA, 'nobody'))?.displayName === null);
    const roomB = await env.newRoom();
    ok('...and nothing for a room never joined', (await lookup(a2, roomB, 'ann_user'))?.displayName === null);
    if (!env.guestOnly) {
      const phone = device('dev-a-phone');
      r = await join(phone, roomA, 'ann_user', 'Ann');
      ok('the same ACCOUNT on a second device still takes over its own seat', r.joined && !r.error);
      phone.close();
    }

    section('The join form');
    const p = await env.open(`${BASE}/player`); // desktop layout: the Leave button is in the sidebar
    await env.joinForm(p, roomB, 'Zed');
    await p.waitText('Waiting for Question');
    await p.goto(await p.eval('location.href')); // a refresh saves the room for rejoin
    await p.waitText('Waiting for Question', { timeout: 15000 });
    await leave(p);
    ok('leaving a room forgets it for refresh-rejoin (a refresh shows the landing page)', await (async () => {
      await p.goto(`${BASE}/player`);
      await sleep(2000);
      return (await p.visible('.join-section')) && !(await p.has('Waiting for Question'));
    })());

    await p.fill('#playerDisplayName', 'Someone');
    await p.fill('#roomCodeManual', roomB);
    await sleep(1000);
    let f = await nameField(p);
    ok('typing a room already joined fills in the old display name', f.value === 'Zed', JSON.stringify(f));
    ok('...and locks the field with an explanation', f.readOnly === true && /can't be changed/i.test(f.hint), JSON.stringify(f));
    await p.fill('#roomCodeManual', roomA); // a room this browser never joined (the bots did)
    await sleep(1000);
    f = await nameField(p);
    ok('typing a room never joined unlocks it and restores what was typed', f.readOnly === false && f.value === 'Someone', JSON.stringify(f));
    await p.fill('#roomCodeManual', roomB);
    await sleep(1000);
    ok('...and typing the joined room again locks it again', (await nameField(p)).readOnly === true);
    await p.clickText('Join Room');
    await p.waitText('Waiting for Question');
    ok('joining the locked room works, as the original name', JSON.stringify(await env.players(roomB)) === JSON.stringify(['Zed']));
    await leave(p);
    await p.closeTab(); // the same device must not stay connected in another tab

    section('QR links (?room=)');
    const qrJoined = await env.open(`${BASE}/player?room=${roomB}`, { width: 390, height: 844, mobile: true });
    let reached = true;
    try {
      await qrJoined.waitText('Waiting for Question', { timeout: 10000 });
    } catch {
      reached = false;
    }
    ok('a QR link to a room already joined goes straight back in, no prompt', reached);
    ok('...as the same player, not a new one', JSON.stringify(await env.players(roomB)) === JSON.stringify(['Zed']));
    await qrJoined.closeTab();

    const roomC = await env.newRoom();
    const qrNew = await env.open(`${BASE}/player?room=${roomC}`, { width: 390, height: 844, mobile: true });
    await sleep(3000);
    f = await nameField(qrNew);
    ok('a QR link to a room never joined still asks for a display name (blank, editable)', (await qrNew.visible('.join-section')) && f.value === '' && f.readOnly === false && !(await qrNew.has('Waiting for Question')), JSON.stringify(f));
    ok('...with the room code filled in', (await qrNew.eval(`document.querySelector('#roomCodeManual').value`)) === roomC);
    const codeField = () => qrNew.eval(`(() => { const e = document.querySelector('#roomCodeManual'); return { readOnly: e.readOnly, focused: document.activeElement === e, hint: /Change room code/.test(document.body.innerText) }; })()`);
    let cf = await codeField();
    ok("the room code from a QR link can't be typed over, and a small link offers to change it", cf.readOnly === true && cf.hint === true, JSON.stringify(cf));
    await qrNew.clickText('Change room code', 'button.link-btn');
    await sleep(300);
    cf = await codeField();
    ok('using the link unlocks the field and puts the cursor in it', cf.readOnly === false && cf.focused === true && cf.hint === false, JSON.stringify(cf));
    await qrNew.fill('#roomCodeManual', '4321');
    ok('and a different code can then be typed', (await qrNew.eval(`document.querySelector('#roomCodeManual').value`)) === '4321');
    await qrNew.closeTab();

    const plain = await env.open(`${BASE}/player`, { width: 390, height: 844, mobile: true });
    await plain.waitFor(`!!document.querySelector('#roomCodeManual')`);
    ok('opening the player page without a link leaves the room code editable, with no link', await plain.eval(`(() => { const e = document.querySelector('#roomCodeManual'); return e.readOnly === false && !/Change room code/.test(document.body.innerText); })()`));
    await plain.closeTab();

    section('A device that just left a room is not dragged back into it by a link to another room');
    const roomD = await env.newRoom();
    const first = await env.open(`${BASE}/player`, { width: 390, height: 844, mobile: true });
    await env.joinForm(first, roomD, 'Dan');
    await first.waitText('Waiting for Question');
    await first.closeTab(); // closing saves the room for rejoin
    const roomE = await env.newRoom();
    const other = await env.open(`${BASE}/player?room=${roomE}`, { width: 390, height: 844, mobile: true });
    await sleep(2500);
    ok('opening a link to another room shows that room (not the old one)', (await other.eval(`document.querySelector('#roomCodeManual')?.value`)) === roomE && !(await other.has('Waiting for Question')));
    await other.closeTab();

    section(env.guestOnly ? 'Guest-only mode (server has GUEST_ONLY_MODE=true)' : 'Normal mode (username + display name)');
    const roomF = await env.newRoom();
    const form = await env.open(`${BASE}/player`, { width: 390, height: 844, mobile: true });
    await form.waitFor(`!!document.querySelector('#playerDisplayName')`);
    await sleep(600);
    const fields = await form.eval(`({ username: !!document.querySelector('#playerUsername'), savedUser: !!document.querySelector('.username-display-section'), manage: [...document.querySelectorAll('button')].some(b => b.innerText.includes('Manage Account')), banner: document.body.innerText.toLowerCase().includes('guest-only game') })`);
    if (env.guestOnly) {
      ok('the join form has no username field, no Manage Account, and no banner', !fields.username && !fields.savedUser && !fields.manage && !fields.banner, JSON.stringify(fields));
      await env.joinForm(form, roomF, 'Gus');
      await form.waitText('Waiting for Question');
      ok('a player joins with only a display name, and no account is saved on the device', (await form.eval(`localStorage.getItem('playerUsername')`)) === null);
      const names = await new Promise((resolve) => {
        const bot = env.bot();
        bot.socket.on('roomRestored', (u) => { resolve(u.players.map((x) => `${x.name}:${x.username}`)); bot.close(); });
        bot.emit('viewRoom', { roomCode: roomF, userId: 1, isRootAdmin: true });
      });
      ok("the server's identity for them is anonymous (guest_…)", names.length === 1 && names[0].startsWith('Gus:guest_'), JSON.stringify(names));
      await form.goto(await form.eval('location.href'));
      await form.waitText('Waiting for Question', { timeout: 15000 });
      ok('a refresh rejoins as the same single player', (await env.players(roomF)).length === 1);
      const evil = env.bot('evil-device-e2e');
      const seen = await new Promise((resolve) => {
        evil.socket.on('playerListUpdate', (l) => { const x = l.players.find((q) => q.name === 'Rita'); if (x) resolve(x); });
        evil.emit('joinRoom', { roomCode: roomF, username: 'admin', displayName: 'Rita', playerID: evil.playerID });
      });
      ok('an account or admin username sent by a client is ignored', seen.username.startsWith('guest_') && seen.username !== 'admin', seen.username);
    } else {
      ok('the join form asks for (or shows the saved) username and offers Manage Account, with no guest banner', (fields.username || fields.savedUser) && fields.manage && !fields.banner, JSON.stringify(fields));
      await env.joinForm(form, roomF, 'Reg');
      await form.waitText('Waiting for Question');
      ok('a player joins with a username and display name', JSON.stringify(await env.players(roomF)) === JSON.stringify(['Reg']));
    }
    ok('no uncaught errors on the join pages', form.realErrors().length === 0, form.realErrors().join(' | '));
  }
);
