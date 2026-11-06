import { describe, expect, it, vi } from 'vitest';
import type { SaveEnvelope } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';
import { createSuspend, SUSPEND_SLOT } from './suspend.ts';

/** A game whose state is its tick, saveable when `idle`. */
function fake() {
  const g = { tick: 0, idle: true };
  const game = { canSave: () => g.idle, save: () => ({ format: 'lantern-nds-save', version: 1, savedAt: 'x', state: { tick: g.tick } }) as unknown as SaveEnvelope } as unknown as Game;
  const slots = new Map<string, string>();
  let full = false;
  const store = {
    put: async (slot: string, save: SaveEnvelope) => {
      if (full) throw new Error('the disk is full');
      slots.set(slot, JSON.stringify(save));
    },
    get: async (slot: string) => slots.get(slot),
    remove: async (slot: string) => void slots.delete(slot),
  };
  let on = true;
  const suspend = createSuspend({ game: () => game, store, on: () => on });
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      g.tick++;
      suspend.tick();
    }
  };
  const stored = () => (slots.has(SUSPEND_SLOT) ? (JSON.parse(slots.get(SUSPEND_SLOT)!) as { state: { tick: number } }).state.tick : null);
  return { g, suspend, tick, stored, slots, off: () => (on = false), fill: (f: boolean) => (full = f) };
}
/** Lets the stores under way finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve));
const save = (tick: number) => JSON.stringify({ state: { tick } });

describe('the suspend point (OpenSinnoh)', () => {
  it('a hide keeps the game now when it can be saved, else its last idle moment', async () => {
    const f = fake();
    f.tick(100);
    await f.suspend.hide();
    expect(f.stored()).toBe(100);
    // Busy at the hide (a menu, a battle): the last idle moment, kept every 90 ticks.
    f.tick(30);
    f.g.idle = false;
    f.tick(200);
    await f.suspend.hide();
    expect(f.stored()).toBe(91);
  });

  it('stored while playing, at each idle moment: a sudden reload loses a few seconds at most', async () => {
    const f = fake();
    f.tick(1);
    await settle();
    expect(f.stored()).toBe(1);
    f.tick(90);
    await settle();
    expect(f.stored()).toBe(91);
    // One store at a time: the moment that comes while one is under way waits for the next.
    f.tick(180);
    await settle();
    expect(f.stored()).toBe(181);
    f.tick(90);
    await settle();
    expect(f.stored()).toBe(361);
    // Busy (a menu, a battle): the last idle moment stays.
    f.g.idle = false;
    f.tick(300);
    await settle();
    expect(f.stored()).toBe(361);
  });

  it('a store that fails is reported once until one succeeds again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fake();
    f.fill(true);
    for (let i = 0; i < 3; i++) {
      f.tick(90);
      await settle();
    }
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('suspend: not kept (the disk is full)');
    f.fill(false);
    f.tick(90);
    await settle();
    expect(f.stored()).toBe(271);
    f.fill(true);
    f.tick(90);
    await settle();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('CONTINUE takes it only when it is newer than the save, or there is no save; a load clears it', async () => {
    const f = fake();
    f.tick(50);
    await f.suspend.hide();
    expect(await f.suspend.pick(save(40))).toBe(f.slots.get(SUSPEND_SLOT));
    expect(await f.suspend.pick(save(60))).toBe(save(60));
    expect(await f.suspend.pick(undefined)).toBe(f.slots.get(SUSPEND_SLOT));
    await f.suspend.loaded();
    expect(f.stored()).toBeNull();
    expect(await f.suspend.pick(save(40))).toBe(save(40));
    expect(await f.suspend.pick(undefined)).toBeUndefined();
  });

  it('off in Options: nothing is kept', async () => {
    const f = fake();
    f.off();
    f.tick(100);
    await f.suspend.hide();
    expect(f.stored()).toBeNull();
  });
});
