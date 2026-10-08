// Every battle-screen timing in one table (docs/research/quality-bar.md: "sit in one timings.ts table").
// ms unless noted. 1 GBA frame ≈ 16.7 ms.
export const T = {
  // cursor (QB 2.1–2.3)
  cursorStep: 55,          // visual ease tile→tile; logical position updates instantly
  cursorBob: 600,          // bracket breathe loop (CSS)
  repeatDelay: 220,        // held direction: first repeat
  repeatInterval: 67,      // then every 4 frames
  repeatFast: 33,          // after repeatFastAfter, every 2 frames
  repeatFastAfter: 1000,
  sfxCursorMin: 50,        // cursor tick rate limit

  // ranges & menus (QB 4.1, 11.1)
  rangeRipple: 150,        // move range ripples out from the unit
  rangeRippleStep: 22,     // per tile of distance
  menuOpen: 120,

  // movement (QB 5.1)
  movePerTile: 75,
  movePerTileFast: 40,
  cancelSnap: 0,           // cancel returns the unit instantly

  // panels (QB 3.2)
  panelSwap: 80,

  // turn banner (QB 8.1 / README: sweep in 300 ms, hold ~1.2 s → we use the QB's tighter 1.1 s total)
  bannerIn: 220,
  bannerHold: 760,
  bannerOut: 200,

  // power activation (QB 7.1)
  powerDim: 150,
  powerBandIn: 200,
  powerPortrait: 250,
  powerTotal: 2200,
  powerBandOut: 200,
  powerEffect: 700,

  // battle cut-in (QB 6.3)
  cutOpen: 250,
  cutBeat: 250,
  cutFire: 700,
  cutImpact: 400,
  cutHpTick: 60,           // per displayed HP
  cutHold: 300,
  cutClose: 250,
  cutSkipClose: 150,
  mapExchange: 400,        // cut-ins off: on-map flash + explosion + floating number

  // capture (QB 9.1)
  captureIntro: 300,
  captureTick: 50,         // per capture point
  captureStamp: 800,

  // destruction (QB 6.7)
  explosion: 520,
  shake: 150,

  // misc map effects
  build: 300,
  popup: 700,
  trapBounce: 150,
  trapHold: 500,
  toast: 1600,

  // AI playback (QB 12.1–12.2)
  aiFocus: 150,            // cursor rests on the acting unit
  aiPan: 250,
  aiPause: 200,
  aiPauseFast: 60,
  aiThinkingPulse: 300,

  // idle animation (QB 5.4, 5.5)
  idleFrame: 280,
  statusCycle: 500,
  waterFrame: 420,
} as const;
