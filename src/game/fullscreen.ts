// A refused full screen request must not become an uncaught error.
// Chrome refuses one now and then (the window is not in front, another change of screen is under way) by rejecting the
// promise of requestFullscreen with "not granted". Phaser 3.90 does not keep that promise (it listens for the
// fullscreenerror event instead), so the refusal surfaced as an uncaught page error: the 30 minute soak of 20 Nov 2026
// stopped on it. Leaving full screen has the same shape. Nothing else changes: the caller still gets the same promise.

/** Wrap a function that may return a promise so that a rejection always has a handler. */
export function quiet<A extends unknown[], R>(fn: (this: unknown, ...a: A) => R): (this: unknown, ...a: A) => R {
  return function (this: unknown, ...a: A): R {
    const p = fn.apply(this, a);
    (p as unknown as Promise<unknown> | undefined)?.catch?.(() => undefined);
    return p;
  };
}

/** Call once at start-up, before the game is made. */
export function calmFullscreen(): void {
  const el = Element.prototype as Element & { requestFullscreen?: Element['requestFullscreen'] };
  if (typeof el.requestFullscreen === 'function') el.requestFullscreen = quiet(el.requestFullscreen);
  const doc = Document.prototype as Document & { exitFullscreen?: Document['exitFullscreen'] };
  if (typeof doc.exitFullscreen === 'function') doc.exitFullscreen = quiet(doc.exitFullscreen);
}
