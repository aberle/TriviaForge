/**
 * On a phone-width screen, the admin Quiz Management tab's "Create / Select Quiz" panel used to
 * take up most (or all) of the view, leaving no usable room for the Questions panel once a quiz was
 * selected. It's now a collapsible drawer: closed by default once a quiz is picked (the questions get
 * the full screen), reachable again via a toggle button, and dismissible by tapping its backdrop.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

const TITLE = `Mobile Layout ${Date.now().toString(36)}`;

// The drawer is `position: fixed`; reading its bounding-rect left edge (on-screen vs. slid off to
// the left) is more robust than comparing the CSS transform string across browsers.
const drawerLeft = (page) => page.eval(`document.querySelector('.quiz-sidebar').getBoundingClientRect().left`);

await runSuite(
  'admin mobile layout',
  { quiz: { title: TITLE, questions: [Q.mc('Q1', ['a', 'b'], 0)] } },
  async ({ ok, section, env }) => {
    const admin = await env.adminPage('/admin', { width: 390, height: 844, mobile: true });
    await admin.waitFor(`document.querySelector('.admin-page')`);
    await sleep(400);

    section('Before a quiz is selected, the drawer starts open so there is something to pick from');
    const initial = await admin.eval(`(() => {
      const toggle = document.querySelector('.btn-mobile-quiz-toggle');
      const sidebar = document.querySelector('.quiz-sidebar');
      const cs = sidebar ? getComputedStyle(sidebar) : null;
      return {
        toggleVisible: toggle ? getComputedStyle(toggle).display !== 'none' : false,
        sidebarIsFixedDrawer: cs?.position === 'fixed',
        hasBackdrop: !!document.querySelector('.mobile-sidebar-backdrop'),
      };
    })()`);
    ok('a toggle button is visible on mobile', initial.toggleVisible, JSON.stringify(initial));
    ok('the sidebar becomes a fixed-position drawer on mobile', initial.sidebarIsFixedDrawer, JSON.stringify(initial));
    ok('a backdrop is present while the drawer is open', initial.hasBackdrop, JSON.stringify(initial));
    ok('the drawer starts open (on-screen)', (await drawerLeft(admin)) > -5);

    section('Selecting a quiz auto-closes the drawer and hands the full width to the questions panel');
    await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)})).click(); true`);
    await sleep(500);
    ok('the drawer closes (off-screen) once a quiz is picked', (await drawerLeft(admin)) < -100);
    const widths = await admin.eval(`(() => {
      const questions = document.querySelector('.questions-sidebar');
      return { questionsWidth: questions.getBoundingClientRect().width, viewportWidth: innerWidth };
    })()`);
    ok('the questions panel takes (close to) the full viewport width', widths.questionsWidth > widths.viewportWidth * 0.9, JSON.stringify(widths));
    const overflow = await admin.eval(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 2`);
    ok('selecting a quiz on mobile causes no horizontal page overflow', !overflow);

    section('The "+ New Question" / shuffle button row has breathing room below the separator above it');
    // .questions-sidebar grows a border-top on narrow screens (QuestionsList.vue); without a matching
    // top padding, the button row sits with zero gap right against that line.
    const headerGap = await admin.eval(`(() => {
      const sidebar = document.querySelector('.questions-sidebar');
      const header = document.querySelector('.questions-list-header');
      return header.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    })()`);
    ok('there is a visible gap between the border above and the button row below it', headerGap >= 12, headerGap);

    section('The toggle reopens the drawer; a backdrop tap closes it again');
    await admin.eval(`document.querySelector('.btn-mobile-quiz-toggle').click(); true`);
    await sleep(400);
    ok('the toggle reopens the drawer', (await drawerLeft(admin)) > -5);
    await admin.eval(`document.querySelector('.mobile-sidebar-backdrop').click(); true`);
    await sleep(400);
    ok('tapping the backdrop closes the drawer', (await drawerLeft(admin)) < -100);

    section('On a desktop-width screen, the drawer mechanism is inert and the layout is unchanged');
    const desktop = await env.adminPage('/admin', { width: 1400, height: 900 });
    await desktop.waitFor(`document.querySelector('.admin-page')`);
    const desktopState = await desktop.eval(`(() => {
      const toggle = document.querySelector('.btn-mobile-quiz-toggle');
      const sidebar = document.querySelector('.quiz-sidebar');
      return {
        toggleHidden: !toggle || getComputedStyle(toggle).display === 'none',
        sidebarPosition: getComputedStyle(sidebar).position,
      };
    })()`);
    ok('the mobile toggle button is hidden on desktop', desktopState.toggleHidden, JSON.stringify(desktopState));
    ok('the sidebar stays in normal flow (not a fixed drawer) on desktop', desktopState.sidebarPosition !== 'fixed', JSON.stringify(desktopState));

    section('A long quiz name never makes the "Questions" header wrap across many lines');
    // The quiz's full name is already shown (and truncates on its own) in the mobile drawer toggle
    // button right above; repeating it in the Questions panel's own "Questions -- <name>" heading,
    // squeezed next to "+ New Question" and the shuffle buttons, used to wrap across many short lines.
    const LONG_TITLE = 'This Is A Really Long Quiz Title That Should Not Wrap Awkwardly On A Narrow Phone Screen';
    const longQuiz = await env.createQuiz({ title: LONG_TITLE, questions: [Q.mc('Q1', ['a', 'b'], 0)] });
    await admin.goto(`${BASE}/admin`);
    await admin.waitFor(`[...document.querySelectorAll('.quiz-item')].some(q => q.innerText.includes(${JSON.stringify(LONG_TITLE.slice(0, 20))}))`, { timeout: 8000 });
    await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(LONG_TITLE.slice(0, 20))})).click(); true`);
    await admin.waitFor(`!!document.querySelector('.questions-list-header h2')`);
    await sleep(400);
    const headerInfo = await admin.eval(`(() => {
      const h2 = document.querySelector('.questions-list-header h2');
      const toggle = document.querySelector('.btn-mobile-quiz-toggle span');
      const r = h2.getBoundingClientRect();
      return { height: r.height, text: h2.innerText, toggleShowsName: toggle?.innerText.includes(${JSON.stringify(LONG_TITLE.slice(0, 15))}) };
    })()`);
    ok('the header stays a single line tall, even with a very long quiz name', headerInfo.height < 34, JSON.stringify(headerInfo));
    ok('...because the redundant name is dropped there on mobile (it just says "Questions")', headerInfo.text === 'Questions', headerInfo.text);
    ok('...and the full name is still visible, in the drawer toggle button above, so nothing is lost', headerInfo.toggleShowsName, JSON.stringify(headerInfo));

    section('Adding a round never clips the questions panel\'s content below the bottom of the screen');
    // The mobile toggle button sits above the questions panel in normal document flow; the panel must
    // actually SHRINK to the space left under it, not keep claiming its old (pre-toggle-button) full
    // height and silently overflow past the screen's edge -- which is exactly what used to make
    // "Add Round" vanish once a quiz had enough rounds for a newly-added (auto-expanded) one to push
    // the panel's real content height past the bottom.
    const roundsQuiz = await env.createQuiz({
      title: `Mobile Rounds ${TITLE}`,
      rounds: [{ title: 'Round A' }, { title: 'Round B' }, { title: 'Round C' }],
      questions: [Q.mc('A question one here', ['x', 'y'], 0, 0)],
    });
    await admin.goto(`${BASE}/admin`);
    await admin.waitFor(`[...document.querySelectorAll('.quiz-item')].some(q => q.innerText.includes(${JSON.stringify(`Mobile Rounds ${TITLE}`)}))`, { timeout: 8000 });
    await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(`Mobile Rounds ${TITLE}`)})).click(); true`);
    await admin.waitFor(`document.querySelectorAll('.round-header').length === 3`);
    await sleep(400);
    await admin.eval(`document.querySelector('.btn-add-round').click(); true`); // the 4th round auto-expands
    await sleep(400);

    const panelBottom = await admin.eval(`document.querySelector('.questions-sidebar').getBoundingClientRect().bottom`);
    ok('the questions panel\'s own box stays within the screen, not overflowing past it', panelBottom <= 844 + 2, panelBottom);

    await admin.eval(`(() => { const l = document.querySelector('.questions-list'); l.scrollTop = l.scrollHeight; return true; })()`);
    await sleep(300);
    const addRoundRect = await admin.eval(`(() => { const r = document.querySelector('.btn-add-round').getBoundingClientRect(); return { bottom: r.bottom, visible: r.top >= 0 && r.bottom <= window.innerHeight }; })()`);
    ok('...and scrolling the panel actually reaches the "Add Round" button (it is not stuck off-screen)', addRoundRect.visible, JSON.stringify(addRoundRect));

    ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
