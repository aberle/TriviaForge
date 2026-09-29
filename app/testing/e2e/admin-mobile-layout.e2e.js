/**
 * On a phone-width screen, the admin Quiz Management tab's "Create / Select Quiz" panel used to
 * take up most (or all) of the view, leaving no usable room for the Questions panel once a quiz was
 * selected. It's now a collapsible drawer: closed by default once a quiz is picked (the questions get
 * the full screen), reachable again via a toggle button, and dismissible by tapping its backdrop.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

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

    ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
