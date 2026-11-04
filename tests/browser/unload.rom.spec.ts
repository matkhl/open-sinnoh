/**
 * A reload the player did not mean (OPENSINNOH_NDS_ROM; desktop): with unsaved progress the browser asks first
 * (game-view.ts `beforeunload`, leave.ts), and the suspend point is written while it asks, so a reload that goes
 * ahead still CONTINUEs where the player stood. Within seconds of starting play there is nothing to ask about.
 * Leaving after all (the question accepted) reloads into the game where the player stood.
 */
import { expect, test, type Page } from '@playwright/test';
import { romContext, resetRomDevice } from './rom-context.ts';
import { saveSlot } from './save.ts';

test.skip(!process.env.OPENSINNOH_NDS_ROM, 'OPENSINNOH_NDS_ROM is not set');

const slot = (page: Page, key: string) =>
  page.evaluate(
    (key) =>
      new Promise<string | undefined>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('saves').objectStore('saves').get(key);
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result as string | undefined);
          };
        };
      }),
    key,
  );

test('a reload with unsaved progress asks first and keeps the suspend point', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'the browser question is the same everywhere');
  test.setTimeout(240_000);
  const context = await romContext(browser, info.project.use);
  const page = await context.newPage();
  await resetRomDevice(page);
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(async () => {
    const g = window.openSinnohGame!;
    const state = g.snapshot().state;
    state.player = { ...state.player, zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN' as typeof state.player.zone, x: 116, z: 886, y: 0, facing: 'down' };
    state.objects = [];
    state.follower = null;
    state.partyFollower = null;
    await g.load(JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }), 'arrival');
    g.advance(120);
  });
  await saveSlot(page);
  // `?ask-leave`: test builds ask only when told to (production always does).
  await page.goto('/?continue&time=12:00&ask-leave');
  await page.waitForFunction(() => !!window.openSinnohApp && !document.querySelector('.at-title') && window.openSinnohApp.loop.ticks > 30, undefined, { timeout: 60_000 });
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  // Just started: a reload goes ahead without a question (and the page comes back to the game).
  await page.keyboard.press('ArrowLeft');
  await page.reload();
  await page.waitForFunction(() => !!window.openSinnohApp && !document.querySelector('.at-title') && window.openSinnohApp.loop.ticks > 30, undefined, { timeout: 60_000 });
  expect(dialogs).toEqual([]);
  // Turn around, then play on past the grace (10 seconds of play ticks: the loop's own count includes the title's).
  const start = await page.evaluate(() => window.openSinnohApp!.game.state.tick);
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction((start) => window.openSinnohApp!.game.state.tick > start + 330 && window.openSinnohApp!.game.canSave(), start, { timeout: 120_000 });
  const stood = await page.evaluate(() => window.openSinnohApp!.game.state.player);
  // The player's reload: asked, and staying keeps the game running; the suspend point is in.
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs, { timeout: 15_000 }).toEqual(['beforeunload']);
  expect(page.isClosed()).toBe(false);
  await expect.poll(async () => (await slot(page, 'suspend')) !== undefined).toBe(true);
  expect((JSON.parse((await slot(page, 'suspend'))!) as { state: { player: typeof stood } }).state.player).toEqual(stood);
  // The player leaves after all: the reload goes ahead, and CONTINUE puts them where they stood.
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await page.waitForFunction(() => !!window.openSinnohApp && !document.querySelector('.at-title') && window.openSinnohApp.loop.ticks > 30, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.openSinnohApp!.game.state.player)).toEqual(stood);
  await page.close();
  await context.close();
});
