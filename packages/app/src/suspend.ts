/**
 * The suspend point (OpenSinnoh, a Switch-style suspend; docs/decisions.md): phones kill hidden tabs, and a reload
 * or a crash can come without warning, so the game is kept in its own save slot, next to the real save the in-game
 * SAVE writes. The next CONTINUE loads it when it is newer than the save (more play ticks), and every load clears it,
 * so it is never a second save to go back to. It is stored at each idle moment (the field can be saved: no menu, no
 * battle), checked every IDLE_EVERY ticks, so a sudden reload loses a few seconds at most; and when the page hides,
 * the game then (when idle) or the last idle moment. Changeable in Options (DATA): `lantern-nds:suspend`, on by
 * default. Never in replays.
 */
import type { SaveEnvelope } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';

export const SUSPEND_SLOT = 'suspend';
const KEY = 'lantern-nds:suspend'; // pre-rename name, kept: players' stored data uses it
/** How often (ticks) the last idle moment is kept and stored: about every three seconds. */
const IDLE_EVERY = 90;

/** Whether the suspend point is on (device data: anything unreadable counts as on, the default). */
export function suspendOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Turns it on or off; returns the storage error, or null. */
export function setSuspendOn(on: boolean): string | null {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export interface SuspendStore {
  put(slot: string, save: SaveEnvelope): Promise<void>;
  get(slot: string): Promise<string | undefined>;
  remove(slot: string): Promise<void>;
}

export function createSuspend(deps: { game: () => Game; store: SuspendStore; on(): boolean }) {
  /** The last idle moment (an envelope), or null. */
  let idle: SaveEnvelope | null = null;
  let since = IDLE_EVERY;
  /** A store of the idle moment is under way (the next one waits for the moment after it). */
  let storing = false;
  /** The last store failed (reported once until one succeeds again). */
  let failing = false;
  return {
    /** Once a field tick, after it: keeps the last idle moment fresh, and stores it. */
    tick(): void {
      if (++since < IDLE_EVERY || !deps.game().canSave()) return;
      since = 0;
      idle = deps.game().save();
      if (storing || !deps.on()) return;
      storing = true;
      deps.store.put(SUSPEND_SLOT, idle).then(
        () => {
          storing = false;
          failing = false;
        },
        (e: Error) => {
          storing = false;
          if (!failing) console.error(`suspend: not kept (${e.message})`);
          failing = true;
        },
      );
    },
    /** The page hides: the suspend point is written (now when the field can be saved, else the last idle moment). */
    hide(): Promise<void> {
      if (!deps.on()) return Promise.resolve();
      const game = deps.game();
      const point = game.canSave() ? game.save() : idle;
      return point ? deps.store.put(SUSPEND_SLOT, point) : Promise.resolve();
    },
    /** A game was loaded or started: the old moment is gone, and the stored point is cleared. */
    loaded(): Promise<void> {
      idle = null;
      since = IDLE_EVERY;
      return deps.store.remove(SUSPEND_SLOT);
    },
    /**
     * What CONTINUE loads: the suspend point's JSON when there is no save or it is newer than the save (more play
     * ticks), else the save's; undefined when there is neither.
     */
    async pick(save: string | undefined): Promise<string | undefined> {
      const point = await deps.store.get(SUSPEND_SLOT);
      if (point === undefined || save === undefined) return point ?? save;
      return ticks(point) > ticks(save) ? point : save;
    },
  };
}

/** A save's play ticks (GameState.tick); -1 when unreadable (the other one wins, and its load reports any problem). */
function ticks(json: string): number {
  try {
    const t = (JSON.parse(json) as { state?: { tick?: unknown } }).state?.tick;
    return typeof t === 'number' ? t : -1;
  } catch {
    return -1;
  }
}
