/**
 * On a phone-width screen, the presenter's "Create Room" sidebar used to take up way too much of the
 * screen, pushing the actual game view (and connected players) down the page. It's now a collapsible
 * drawer: open by default, auto-closes once a room goes live (the game gets the full screen), reopens
 * via a toggle button, closes on a backdrop tap, and is inert (normal layout) at desktop widths.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

const TITLE = `Presenter Mobile Layout ${Date.now().toString(36)}`;

const drawerLeft = (page) => page.eval(`document.querySelector('.presenter-sidebar').getBoundingClientRect().left`);

await runSuite(
  'presenter mobile layout',
  { quiz: { title: TITLE, questions: [Q.mc('Q1', ['a', 'b'], 0)] } },
  async ({ ok, section, env }) => {
    const presenter = await env.adminPage('/presenter', { width: 390, height: 844, mobile: true });
    await presenter.waitFor(`document.querySelector('.presenter-page')`);
    await sleep(500);

    section('Before any room is live, the drawer starts open so there is something to act on');
    const initial = await presenter.eval(`(() => {
      const toggle = document.querySelector('.btn-mobile-sidebar-toggle');
      const sidebar = document.querySelector('.presenter-sidebar');
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
    ok('the drawer starts open (on-screen)', (await drawerLeft(presenter)) > -5);

    // Regression: .presenter-container switched to a single-column CSS grid on mobile, which (with no
    // quiz/room selected, so no room card below to share height with) left just one "auto" row for the
    // toggle button, the game view and the players list each. With no grid-template-rows set, leftover
    // container height gets distributed across those "auto" rows (the default of align-content behaves
    // like "stretch" here) -- stretching the toggle button itself to a few hundred pixels tall instead
    // of hugging its label. Flex-column (like the admin drawer's toggle) sizes it to its content.
    const toggleHeight = await presenter.eval(`document.querySelector('.btn-mobile-sidebar-toggle').getBoundingClientRect().height`);
    ok('the toggle button is a normal, compact height (not stretched to fill leftover space)', toggleHeight < 60, `${toggleHeight}px`);

    section('Making a room live auto-closes the drawer and hands the full width to the game view');
    await presenter.eval(`(() => {
      const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes(${JSON.stringify(TITLE)})));
      const opt = [...select.options].find(o => o.textContent.includes(${JSON.stringify(TITLE)}));
      select.value = opt.value;
      select.dispatchEvent(new Event('change'));
      return true;
    })()`);
    await sleep(300);
    await presenter.eval(`[...document.querySelectorAll('.presenter-sidebar button')].find(b => b.textContent.trim() === 'Make Live').click(); true`);
    await sleep(1000);
    ok('the drawer closes (off-screen) once a room goes live', (await drawerLeft(presenter)) < -100);
    const toggleLabel = await presenter.eval(`document.querySelector('.btn-mobile-sidebar-toggle span').textContent`);
    ok('the toggle now shows the live room code', /Room \d+/.test(toggleLabel), toggleLabel);
    const overflow = await presenter.eval(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 2`);
    ok('going live on mobile causes no horizontal page overflow', !overflow);

    section('The toggle reopens the drawer; a backdrop tap closes it again');
    await presenter.eval(`document.querySelector('.btn-mobile-sidebar-toggle').click(); true`);
    await sleep(400);
    ok('the toggle reopens the drawer', (await drawerLeft(presenter)) > -5);
    await presenter.eval(`document.querySelector('.mobile-sidebar-backdrop').click(); true`);
    await sleep(400);
    ok('tapping the backdrop closes the drawer', (await drawerLeft(presenter)) < -100);

    section('On a desktop-width screen, the drawer mechanism is inert and the layout is unchanged');
    const desktop = await env.adminPage('/presenter', { width: 1400, height: 900 });
    await desktop.waitFor(`document.querySelector('.presenter-page')`);
    const desktopState = await desktop.eval(`(() => {
      const toggle = document.querySelector('.btn-mobile-sidebar-toggle');
      const sidebar = document.querySelector('.presenter-sidebar');
      return {
        toggleHidden: !toggle || getComputedStyle(toggle).display === 'none',
        sidebarPosition: getComputedStyle(sidebar).position,
      };
    })()`);
    ok('the mobile toggle button is hidden on desktop', desktopState.toggleHidden, JSON.stringify(desktopState));
    ok('the sidebar stays in normal flow (not a fixed drawer) on desktop', desktopState.sidebarPosition !== 'fixed', JSON.stringify(desktopState));

    // Close the room this suite made live: it wasn't opened through env.newRoom(), so env's own
    // cleanup doesn't know about it. Doing it through the drawer UI also checks that a room card
    // inside the (reopened) mobile drawer is still fully usable.
    section('The room this suite made live can still be closed from the reopened drawer');
    await presenter.eval(`document.querySelector('.btn-mobile-sidebar-toggle').click(); true`);
    await sleep(400);
    const closed = await presenter.eval(`(() => {
      const card = [...document.querySelectorAll('.roomCard')].find(c => c.textContent.includes(${JSON.stringify(TITLE)}));
      const btn = card?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    ok('found and closed this suite\'s room from the drawer', closed);

    ok('no uncaught errors', presenter.realErrors().length === 0, presenter.realErrors().join(' | '));
  }
);
