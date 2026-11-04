/**
 * Leaving the page. A reload or close the player did not mean (F5, Ctrl+R, a stray swipe or tab close) asks first
 * while the game holds unsaved progress (game-view.ts `beforeunload`); a reload or navigation OpenSinnoh does itself
 * (EXIT, the clear's reset, an update, a reimport, the crash screen's reload) goes through `leavePage` and is not asked.
 */
let leaving = false;

/** OpenSinnoh leaves the page on purpose: no question. */
export function leavePage(go: () => void): void {
  leaving = true;
  go();
}

export const leavingOnPurpose = (): boolean => leaving;
