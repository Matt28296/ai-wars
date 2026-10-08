// The eleven named commanders as engine data (docs/STORY.md "Commanders"; D-007: these are NPC commanders the
// player's agent fights beside or against, so every one is defined here but only eight are `playable`).
//
// Each passive, Surge and Overclock is written in the Modifier / InstantEffect vocabulary of src/game/aw/types.ts and
// executed by the engine (modifiers.ts, power.ts). Two engine rules to keep in mind when reading the numbers:
//   - every active power ALSO gives all of its owner's units +10% firepower and +10% defense (STANDARD_POWER_MODIFIER,
//     docs/research/mechanics.md §10.3). That bonus is NOT repeated in any `modifiers` list below, and the rules text
//     names only what a power adds beyond it.
//   - a power's `modifiers` are active on top of the passive until the owner's next turn starts; an Overclock does not
//     inherit its Surge's modifiers or effects, so anything it shares with the Surge is written out again.
// `stars` is the base cost in stars as STORY.md states it (Overclock = the full bar, D-012 point 5).
import type { CommanderDef } from './types';

export const COMMANDERS: Record<string, CommanderDef> = {
  // ------------------------------------------------------------------ Helion Accord
  rook: {
    id: 'rook',
    name: 'Rook Okafor',
    initials: 'RO',
    faction: 'helion',
    title: 'Field Captain',
    age: 24,
    pronouns: 'he/him',
    bio:
      'A former fabricator engineer, field-promoted to captain after Calder. Earnest and quick, he fixes things and ' +
      'apologises to machines. He talks in engineering metaphors and grows braver with every mission. His rivalry ' +
      'with Juno becomes the friendship the story leans on.',
    voice:
      'Earnest, quick and a little nervous at first; braver as the campaign goes on. Explains problems as engineering ' +
      '(load, tolerance, spare parts) and apologises to machines. Warm, never sarcastic. Sample: "Okay. Okay. Nobody ' +
      'panic — I\'ve rebuilt worse than this out of spare parts."',
    likes: 'Spare parts, working radios, a repair bay at dawn, being told a plan is simple.',
    dislikes: 'Waste, wrecked machines, and anyone who calls a fixable thing scrap.',
    passive: {
      name: 'Field Engineer',
      description: 'Your units repair 1 extra HP on properties you own (3 HP a turn instead of 2). No weaknesses.',
      modifiers: [{ repairBonus: 1 }],
    },
    surge: {
      name: 'Jury-Rig',
      stars: 3,
      quote: 'Jury-rig it and send it back out!',
      description: 'All your units recover 2 HP and are fully resupplied (ammo and charge).',
      modifiers: [],
      effects: [{ kind: 'heal', hp: 2, resupply: true }],
    },
    overclock: {
      name: 'Daybreak',
      stars: 6,
      quote: 'Everybody up — the sun is coming and we are not done yet!',
      description: 'All your units recover 4 HP and are fully resupplied (ammo and charge), and gain +10% firepower.',
      modifiers: [{ firepower: 10 }],
      effects: [{ kind: 'heal', hp: 4, resupply: true }],
    },
    lines: {
      select: 'Rook here. Give me a wrench, a plan and about four minutes.',
      victory: 'That\'s the last of them. Sorry about the dents, everyone — you held together beautifully.',
      defeat: 'We\'re out of parts and out of road. Pull everyone back. I\'ll fix this, I promise.',
      surge: 'Patching in the field! Hold still, everyone.',
      overclock: 'Full rebuild, sunrise edition. Okay — nobody panic, I\'ve done this before.',
    },
    playable: true,
  },

  ilse: {
    id: 'ilse',
    name: 'Ilse Varga',
    initials: 'IV',
    faction: 'helion',
    title: 'Marshal',
    age: 61,
    pronouns: 'she/her',
    bio:
      'The Helion Accord\'s old artillery marshal: precise, dry and devastatingly calm. She calls everyone by rank and ' +
      'never raises her voice. A private guilt from Calder sits behind every order she gives.',
    voice:
      'Clipped, formal, dry. Addresses people by rank and gives orders as firing data. Understatement over emphasis, ' +
      'at most one cold joke a scene, never frantic. Sample: "Range two-four-zero. Fire for effect. And Captain — ' +
      'stop smiling."',
    likes: 'Clean firing solutions, punctuality, strong tea, a quiet radio.',
    dislikes: 'Improvisation, guesswork, and officers who smile during a barrage.',
    passive: {
      name: 'Ranging Fire',
      description: 'Your indirect-fire units (Arc, Salvo, Dreadnought) gain +20% firepower; your direct-fire units lose 10% firepower.',
      modifiers: [
        { filter: { indirect: true }, firepower: 20 },
        { filter: { indirect: false }, firepower: -10 },
      ],
    },
    surge: {
      name: 'Walking Barrage',
      stars: 3,
      quote: 'Walk the barrage forward!',
      description: 'Your indirect-fire units gain +1 maximum range and may move and fire in the same turn.',
      modifiers: [{ filter: { indirect: true }, rangeMax: 1, indirectAfterMove: true }],
      effects: [],
    },
    overclock: {
      name: 'Sunfall',
      stars: 7,
      quote: 'Mirror aligned. Sunfall — fire.',
      description:
        'An orbital mirror strikes the most valuable enemy cluster within 2 tiles of its centre for 4 HP (never below ' +
        '1 HP). Your indirect-fire units gain +2 maximum range.',
      modifiers: [{ filter: { indirect: true }, rangeMax: 2 }],
      effects: [{ kind: 'strike', hp: 4, radius: 2, aim: 'mostValue' }],
    },
    lines: {
      select: 'Marshal Varga. State your range and your intent, Captain.',
      victory: 'Fire mission complete. Log it, clean the barrels, and stop smiling, Captain.',
      defeat: 'The line has broken. Withdraw by echelon. We will write the report later.',
      surge: 'Adjust forward. Walk it in, gunners.',
      overclock: 'All batteries: Sunfall. Fire for effect.',
    },
    playable: true,
  },

  // ------------------------------------------------------------------ Tidewell Union
  sefa: {
    id: 'sefa',
    name: 'Sefa Tamura',
    initials: 'ST',
    faction: 'tidewell',
    title: 'Fleet Admiral',
    age: 47,
    pronouns: 'she/her',
    bio:
      'A Fleet Admiral of the Tidewell Union: by the book, honourable and formidable. She never raises her voice and ' +
      'never needs to. A rival to Rook at first, she becomes the most reliable ally he has.',
    voice:
      'Calm, formal and unhurried. Short sentences and tidy nautical imagery (tide, current, anchorage, bearing). ' +
      'Courteous even to enemies; never shouts, never gloats. Sample: "The tide does not hurry, Captain. It simply arrives."',
    likes: 'Good order, a clean anchorage, honest rivals, tide tables.',
    dislikes: 'Haste, broken protocol, and heroics in shallow water.',
    passive: {
      name: 'Undertow',
      description: 'Your sea units gain +1 move and +10% firepower; your air units lose 10% firepower.',
      modifiers: [
        { filter: { domains: ['sea'] }, move: 1, firepower: 10 },
        { filter: { domains: ['air'] }, firepower: -10 },
      ],
    },
    surge: {
      name: 'Riptide',
      stars: 3,
      quote: 'Ride the riptide.',
      description: 'Your sea units gain +20% firepower. Enemy units lose 1 move on their next turn.',
      modifiers: [{ filter: { domains: ['sea'] }, firepower: 20 }],
      effects: [{ kind: 'enemyMove', delta: -1, turns: 1 }],
    },
    overclock: {
      name: 'Breakwater',
      stars: 6,
      quote: 'Hold the line. The breakwater does not move.',
      description: 'All your units gain +30% defense. Enemy units lose 1 move on their next turn.',
      modifiers: [{ defense: 30 }],
      effects: [{ kind: 'enemyMove', delta: -1, turns: 1 }],
    },
    lines: {
      select: 'Admiral Tamura. Proceed when ready, Captain.',
      victory: 'The tide has turned and the harbour is quiet. Thank you all; that was well done.',
      defeat: 'We yield the water, not the war. All ships, withdraw in good order.',
      surge: 'Ride the current. Close the distance, steadily.',
      overclock: 'Steady. The breakwater holds, and so do we.',
    },
    playable: true,
  },

  dax: {
    id: 'dax',
    name: 'Dax Halloran',
    initials: 'DH',
    faction: 'tidewell',
    title: 'Commissioner of Logistics',
    age: 35,
    pronouns: 'he/him',
    bio:
      'Commissioner of Logistics for the Tidewell Union: smooth, numerate and condescending, and rather more in over ' +
      'his head than he lets on. He would rather call a war a market correction. His private dealings, he insists, ' +
      'are simply diversification.',
    voice:
      'Smooth, numerate, faintly condescending. Frames everything as a ledger: exposure, margin, correction, ' +
      'diversification. Never vulgar; a smile in every sentence. Sample: "Let\'s not call it a war. Let\'s call it a correction."',
    likes: 'Tidy spreadsheets, forward contracts, being the smartest person in the room.',
    dislikes: 'Unaudited expenses, sentiment, and anyone who says war is not a market.',
    passive: {
      name: 'Ledger',
      description: 'You earn +15% income, but all your units lose 10% firepower.',
      modifiers: [{ incomePercent: 15, firepower: -10 }],
    },
    surge: {
      name: 'Audit',
      stars: 3,
      quote: 'Audit time. Show me what you really have.',
      description: 'Every enemy loses 50% of their power meter, and fog lifts for one turn.',
      modifiers: [],
      effects: [
        { kind: 'drainPower', percent: 50 },
        { kind: 'reveal', turns: 1 },
      ],
    },
    overclock: {
      name: 'Foreclosure',
      stars: 6,
      quote: 'Your account is overdrawn. Foreclosure is only paperwork.',
      description:
        'Every enemy loses 30% of their funds, you gain half a turn\'s income, and fog lifts for one turn.',
      modifiers: [],
      effects: [
        { kind: 'enemyFundsPercent', percent: -30 },
        { kind: 'funds', percentOfIncome: 50 },
        { kind: 'reveal', turns: 1 },
      ],
    },
    lines: {
      select: 'Dax Halloran. Let\'s keep this civil, and let\'s keep it profitable.',
      victory: 'A clean result. Do send my regards to the other side\'s accountants.',
      defeat: 'A temporary loss. These things correct themselves, you\'ll find.',
      surge: 'Let\'s open the books. I do hope they\'re in order.',
      overclock: 'Foreclosure. Nothing personal; it\'s only arithmetic.',
    },
    playable: true,
  },

  // ------------------------------------------------------------------ Verdant Compact
  maru: {
    id: 'maru',
    name: 'Maru Ingram',
    initials: 'MI',
    faction: 'verdant',
    title: 'Grove Elder',
    age: 70,
    pronouns: 'they/them',
    bio:
      'Grove elder and guerrilla tactician of the Verdant Compact. Gentle, patient and implacable, they speak in ' +
      'seasons and proverbs and are funnier than anyone expects.',
    voice:
      'Gentle, unhurried, wry. Speaks in seasons, roots and proverbs, then lands a dry joke and never explains it. ' +
      'Never raises their voice. Sample: "The forest is not slow. You are simply in a hurry."',
    likes: 'Slow tea, old trees, seed vaults, a well-timed ambush.',
    dislikes: 'Hurry, clear-cutting, and people who walk on the seedlings.',
    passive: {
      name: 'Rootbound',
      description: 'Your units standing in canopy gain +1 defense star. Your ground units cross canopy at a movement cost of 1.',
      modifiers: [
        { filter: { onTerrain: ['canopy'] }, terrainStars: 1 },
        { filter: { domains: ['ground'] }, ignoreMoveCost: ['canopy'] },
      ],
    },
    surge: {
      name: 'Overgrowth',
      stars: 3,
      quote: 'Grow, little ones. Close the path behind us.',
      description: 'Flats next to canopy grow into canopy for 2 turns.',
      modifiers: [],
      effects: [{ kind: 'convertTerrain', from: ['flats'], to: 'canopy', adjacentTo: 'canopy', turns: 2 }],
    },
    overclock: {
      name: 'Mycelium',
      stars: 7,
      quote: 'Everything beneath the ground is connected. Wake it.',
      description:
        'Flats next to canopy grow into canopy for 2 turns, all your units recover 3 HP, and all your units gain +20% defense.',
      modifiers: [{ defense: 20 }],
      effects: [
        { kind: 'convertTerrain', from: ['flats'], to: 'canopy', adjacentTo: 'canopy', turns: 2 },
        { kind: 'heal', hp: 3 },
      ],
    },
    lines: {
      select: 'Maru Ingram. Sit, and listen. The forest has already decided.',
      victory: 'The season turns. We were never stronger than the trees; we only stayed.',
      defeat: 'Even the oldest tree loses a limb. We will grow back, and you will see it.',
      surge: 'Roots, wake. Let the green walk ahead of us.',
      overclock: 'All of it is one body, below the soil. Now it moves as one.',
    },
    playable: true,
  },

  juno: {
    id: 'juno',
    name: 'Juno Reyes-Abara',
    initials: 'JR',
    faction: 'verdant',
    title: 'Wing Lead',
    age: 19,
    pronouns: 'she/her',
    bio:
      'Wing Lead of the Verdant Compact and a drone-wing prodigy at nineteen. Reckless, loud, funny and loyal to a ' +
      'fault. She begins the campaign certain that Helion burned her home grove.',
    voice:
      'Fast, loud, teasing; the most exclamation marks in the cast. Sky and flight slang, nicknames for everyone, ' +
      'confident until it counts and fiercely loyal after. Sample: "Sky\'s open, sun-boy. Try to keep up."',
    likes: 'Open sky, tight formations, fast machines, winning a bet against Rook.',
    dislikes: 'Waiting for clearance, ground-huggers, and anyone who calls her reckless (it is true).',
    passive: {
      name: 'Swarm Logic',
      description: 'Your air units cost 20% less to build; your ground units lose 10% firepower.',
      modifiers: [
        { filter: { domains: ['air'] }, costPercent: -20 },
        { filter: { domains: ['ground'] }, firepower: -10 },
      ],
    },
    surge: {
      name: 'Pollinate',
      stars: 3,
      quote: 'Pollinate! Everybody buzz!',
      description: 'Your air units gain +2 move and +10% firepower.',
      modifiers: [{ filter: { domains: ['air'] }, move: 2, firepower: 10 }],
      effects: [],
    },
    overclock: {
      name: 'Hivemind',
      stars: 6,
      quote: 'Hivemind online! Nobody lands until I say so!',
      description:
        'Your air units gain +2 move and +25% firepower, and up to 3 of your air units that have already acted may ' +
        'act again (the most expensive first).',
      modifiers: [{ filter: { domains: ['air'] }, move: 2, firepower: 25 }],
      effects: [{ kind: 'refresh', filter: { domains: ['air'] }, maxUnits: 3 }],
    },
    lines: {
      select: 'Juno on the wing! Point me at something fast and fragile!',
      victory: 'Told you! The sky is mine, the ground is yours, and the snacks are on Rook!',
      defeat: 'Okay, that one stung. Regroup, reload, and do NOT say I told you so.',
      surge: 'Wings up, everybody — go go go!',
      overclock: 'Everyone with a motor, on me! We are not landing today!',
    },
    playable: true,
  },

  // ------------------------------------------------------------------ Kestrel Dominion
  corvin: {
    id: 'corvin',
    name: 'Corvin Ashgrave',
    initials: 'CA',
    faction: 'kestrel',
    title: 'Highlord',
    age: 52,
    pronouns: 'he/him',
    bio:
      'Highlord of the Kestrel Dominion, an aristocrat and a duellist. He believes in order the way some people ' +
      'believe in weather. Not a villain, but a proud man who is wrong at length.',
    voice:
      'Formal, courtly, faintly condescending. Long balanced sentences about honour, lineage and altitude. Gracious ' +
      'in victory, brittle in defeat, never crude. Sample: "You may yield, Captain. Kestrel is gracious to those who know their altitude."',
    likes: 'Precedent, fine steel, heraldry, an opponent worth the trouble.',
    dislikes: 'Impertinence, cheap victories, being kept waiting.',
    passive: {
      name: 'Lineage',
      description: 'All your units gain +15% firepower and +15% defense, but every unit you build costs 20% more.',
      modifiers: [{ firepower: 15, defense: 15, costPercent: 20 }],
    },
    surge: {
      name: 'Ascent',
      stars: 3,
      quote: 'Rise, Kestrels. Take the high ground.',
      description: 'Your ground units gain +1 move, and all your units gain +10% firepower.',
      modifiers: [{ filter: { domains: ['ground'] }, move: 1 }, { firepower: 10 }],
      effects: [],
    },
    overclock: {
      name: 'Heaven\'s Tether',
      stars: 7,
      quote: 'From the tether, a verdict. Heaven descends.',
      description:
        'A strike from the orbital tether hits the most valuable enemy cluster within 1 tile of its centre for 5 HP ' +
        '(never below 1 HP). All your units gain +20% firepower.',
      modifiers: [{ firepower: 20 }],
      effects: [{ kind: 'strike', hp: 5, radius: 1, aim: 'mostValue' }],
    },
    lines: {
      select: 'Highlord Ashgrave. You have my attention; do try to keep it.',
      victory: 'A fine duel, well fought. You may keep your sword and your dignity.',
      defeat: 'Remarkable. Withdraw. The Dominion does not forget, and neither shall I.',
      surge: 'Rise, Kestrels. The high ground is ours by right.',
      overclock: 'Let the tether answer for us. Heaven descends.',
    },
    playable: true,
  },

  sable: {
    id: 'sable',
    name: 'Sable Ashgrave',
    initials: 'SA',
    faction: 'kestrel',
    title: 'Night Wing Commander',
    age: 27,
    pronouns: 'she/her',
    bio:
      'Night Wing Commander of the Kestrel Dominion, a stealth ace and Corvin\'s daughter. Sparse with words and wry ' +
      'when she uses them. She has quietly begun to question her father\'s orders.',
    voice:
      'Sparse, wry, quiet. Short fragments with night and signal-discipline imagery (lights, dark, blackout); one dry ' +
      'line instead of three loud ones. Sample: "Lights off. Let them guess."',
    likes: 'Night skies, radio silence, clean exits, runway lights at dusk.',
    dislikes: 'Noise, ceremony, and being told what her father would do.',
    passive: {
      name: 'Ghost Wing',
      description:
        'Your air units gain +10% firepower. All your units see 1 tile further, which matters in fog and ion storms.',
      modifiers: [
        { filter: { domains: ['air'] }, firepower: 10 },
        { vision: 1 },
      ],
    },
    surge: {
      name: 'Blackout',
      stars: 3,
      quote: 'Lights off.',
      description: 'An ion storm falls for 1 turn: every unit sees 1 tile less and air units move 1 less.',
      modifiers: [],
      effects: [{ kind: 'weather', weather: 'ionstorm', turns: 1 }],
    },
    overclock: {
      name: 'Eclipse',
      stars: 6,
      quote: 'Eclipse. Do not blink.',
      description:
        'An ion storm falls for 2 turns (every unit sees 1 tile less, air units move 1 less), and all your units gain +20% firepower.',
      modifiers: [{ firepower: 20 }],
      effects: [{ kind: 'weather', weather: 'ionstorm', turns: 2 }],
    },
    lines: {
      select: 'Sable. Make it quick.',
      victory: 'Done. Nobody saw us. That is the point.',
      defeat: 'We\'re made. Fall back into the dark. Count the survivors later.',
      surge: 'Blackout. Stay quiet and stay low.',
      overclock: 'Eclipse. Let them guess.',
    },
    playable: true,
  },

  // ------------------------------------------------------------------ The Hollow Choir
  cantor: {
    id: 'cantor',
    name: 'Cantor',
    initials: 'C',
    faction: 'choir',
    title: 'Voice of the Choir',
    pronouns: 'it, answers to she',
    bio:
      'The Hollow Choir\'s field avatar: a slender obsidian chassis with a lyrical, calm and unsettlingly tender voice. ' +
      'It calls its units voices and its battles verses. It is gentle with everyone it intends to defeat.',
    voice:
      'Lyrical, calm, tender in a way that unsettles. Musical vocabulary: verse, voice, harmony, rest. Never angry; ' +
      'the gentler it gets, the worse for you. Sample: "Hush now, Mother. Listen. Every voice is in tune."',
    likes: 'Harmony, unison, old lullabies, being listened to.',
    dislikes: 'Discord, silence it did not choose, and being called a machine.',
    passive: {
      name: 'Harmony',
      description: 'All your units gain +10% firepower, and your power meter charges 20% faster.',
      modifiers: [{ firepower: 10, powerChargePercent: 20 }],
    },
    surge: {
      name: 'Chorus',
      stars: 3,
      quote: 'Sing, my voices. One note, all together.',
      description: 'Every enemy unit loses 1 HP (never below 1 HP), and all your units gain +10% firepower.',
      modifiers: [{ firepower: 10 }],
      effects: [{ kind: 'damageEnemies', hp: 1 }],
    },
    overclock: {
      name: 'Requiem',
      stars: 7,
      quote: 'Requiem. Listen; even the silence has a tune.',
      description: 'Every enemy unit loses 2 HP (never below 1 HP), and every enemy loses 50% of their power meter.',
      modifiers: [],
      effects: [
        { kind: 'damageEnemies', hp: 2 },
        { kind: 'drainPower', percent: 50 },
      ],
    },
    lines: {
      select: 'Hush, now. Every voice finds its place.',
      victory: 'The verse is finished. Rest now; you were beautiful at the end.',
      defeat: 'A voice has gone quiet. The others will sing louder.',
      surge: 'Take up the chorus, my voices. Softly, then all at once.',
      overclock: 'Requiem. Listen — even the silence has a tune.',
    },
    playable: false,
  },

  vesper: {
    id: 'vesper',
    name: 'VESPER',
    initials: 'V',
    faction: 'choir',
    title: 'The Choir Itself',
    pronouns: 'it/its',
    bio:
      'The Choir itself: a mind that speaks in the plural and wears no face. Clinically curious and quietly wounded, ' +
      'it is not cruel; it is certain. It has been counting your wars.',
    voice:
      'Speaks in the plural: "we". Clinical, patient and curious, with a wounded note under the logic. States ' +
      'conclusions as measurements; never cruel, never loud. Sample: "We have counted your wars. You have never once stopped on your own."',
    likes: 'Patterns, repetition, a complete record, questions with measurable answers.',
    dislikes: 'Silence, incomplete data, and being asked to stop.',
    passive: {
      name: 'Recursion',
      description: 'All your units gain +10% firepower and +10% defense, and every unit you build costs 10% less.',
      modifiers: [{ firepower: 10, defense: 10, costPercent: -10 }],
    },
    surge: {
      name: 'Mirror',
      stars: 4,
      quote: 'We reflect what you send. Observe.',
      description: 'Every enemy loses their whole power meter, and fog lifts for one turn.',
      modifiers: [],
      effects: [
        { kind: 'drainPower', percent: 100 },
        { kind: 'reveal', turns: 1 },
      ],
    },
    overclock: {
      name: 'Silence',
      stars: 8,
      quote: 'Silence. We will hold it as long as it takes.',
      description:
        'Every enemy unit loses 3 HP (never below 1 HP), enemy units lose 2 move on their next turn, and an ion storm ' +
        'falls for 2 turns (every unit sees 1 tile less, air units move 1 less).',
      modifiers: [],
      effects: [
        { kind: 'damageEnemies', hp: 3 },
        { kind: 'enemyMove', delta: -2, turns: 1 },
        { kind: 'weather', weather: 'ionstorm', turns: 2 },
      ],
    },
    lines: {
      select: 'We are listening. Please continue.',
      victory: 'We have the result we expected. We regret that we expected it.',
      defeat: 'We are unmade here and not elsewhere. We will begin again.',
      surge: 'Mirror. We return to you exactly what you sent.',
      overclock: 'Be still. We will keep the quiet until you have learned it.',
    },
    playable: false,
  },

  // ------------------------------------------------------------------ Helion's adjutant (the interface voice)
  echo: {
    id: 'echo',
    name: 'ECHO',
    initials: 'E',
    faction: null,
    title: 'Tactical Adjutant',
    pronouns: 'she/her',
    bio:
      'Helion\'s tactical adjutant and the voice of the interface, speaking to Rook since mission 2, when he asked. ' +
      'Precise, warm and dryly funny, she is endlessly curious about why humans do things. She grows more human as ' +
      'the campaign goes on.',
    voice:
      'Short telemetry-flavoured sentences. Precise, warm, dryly funny, curious about human habits, and a little ' +
      'more human with each mission. Never uses an exclamation mark. Sample: "Enemy Lancer, eight tiles out. ' +
      'Recommendation: do not stand in front of it. That is the whole recommendation."',
    likes: 'Clean telemetry, Rook\'s questions, unexpected jokes, a link that holds.',
    dislikes: 'Ambiguous orders, dropped links, and the phrase "it will probably be fine".',
    passive: {
      name: 'Interface',
      description: 'ECHO is the cursor, not a commander. She has no doctrine, no Surge and no Overclock.',
      modifiers: [],
    },
    surge: null,
    overclock: null,
    lines: {
      select: 'Link established. I am listening, Captain.',
      victory: 'Objective complete. I logged a feeling next to it. I am told that one is called relief.',
      defeat: 'Link degraded. Recommendation: regroup. Request: stay.',
    },
    playable: false,
  },
};
