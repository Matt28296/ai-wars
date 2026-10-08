// M4.0 Act I of the campaign, "Cinder Season": missions 1-4 as data. Spec: docs/STORY.md "Act I" (the outline, the commander entries for
// Rook, Ilse, Sefa, Dax and ECHO, and "Writing rules for dialogue") and docs/delivery/DECISIONS.md D-004, D-005 and D-007. The contract is
// Mission / MissionPlayer / MissionTrigger / DialogueLine / CampaignAct in src/content/types.ts; the maps are in mission-maps.ts.
//
// D-007 shapes every line. The player's agent is a newly commissioned adjutant AI on the Meridian Link, trained and directed by its human,
// and it takes every in-battle action. So the human never moves a unit: tutorial lines explain to the HUMAN what their agent is doing and
// which standing order or doctrine shaped it (posture, composition weights, target priorities, power policy; D-005). Where STORY.md says
// "Rook does X", Rook's Helion detachment fights beside the agent. Player slots are the same in every mission:
//   0  the agent's Helion detachment: controller 'human' (the agent, directed by its human), commander 'agent' (a placeholder resolved
//      later to the human's chosen agent; the engine treats an unknown commander as having no modifiers)
//   1  Rook Okafor's Helion detachment: an ally on the same team, run by Doctrine
//   2  the opposing force: unmarked drones, Sefa Tamura's garrison and fleet, or Dax Halloran's punitive strike
// Act I never names the Choir, VESPER or the Lattice core: the drones of mission 1 carry faction 'choir' in the data and are unmarked in
// the text, and a UI should show them as unmarked until Act II (missions.test.ts bans the names from every Act I string).
// Every event is `once`. No mission sets `turnLimit`: the engine reads it as a versus day limit (D-013) and STORY.md gives Act I no
// deadline; the one timed mission, Tidebreak, is a 'survive' objective.
import type { CampaignAct, DialogueLine, Mission, Mood } from './types';

// ---------------------------------------------------------------- line builders (the portrait side follows the speaker)

const say = (speaker: string, side: 'left' | 'right' | undefined, text: string, mood?: Mood, channel?: string): DialogueLine => ({
  speaker, text, ...(side ? { side } : {}), ...(mood ? { mood } : {}), ...(channel ? { channel } : {}),
});
const echo = (text: string, mood?: Mood) => say('echo', 'left', text, mood);
const rook = (text: string, mood?: Mood) => say('rook', 'left', text, mood);
const ilse = (text: string, mood?: Mood) => say('ilse', 'left', text, mood);
const sefa = (text: string, mood?: Mood) => say('sefa', 'right', text, mood, 'Tidewell fleet net, open');
const dax = (text: string, mood?: Mood) => say('dax', 'right', text, mood, 'Tidewell command, open');
const narrator = (text: string) => say('narrator', undefined, text);
const watch = (text: string) => say('Calder Watch', 'right', text, undefined, 'Calder Watch, drill net');
const harbour = (text: string) => say('Harbour Control', 'right', text, undefined, 'Harbour net, open');

// The player's agent and Rook are the same in every mission; only the opposing force changes.
const agent = (funds: number) => ({ faction: 'helion', commander: 'agent', controller: 'human', team: 0, funds }) as const;
const rookArmy = (funds: number) => ({ faction: 'helion', commander: 'rook', controller: 'ai', team: 0, funds }) as const;

// ---------------------------------------------------------------- mission 1: First Light

const firstLight: Mission = {
  id: 'first-light',
  act: 1,
  order: 1,
  title: 'First Light',
  location: 'Calder Fields',
  summary: 'A border drill at Calder Fields turns real when unmarked drones cross the ridge. Learn to move, attack, capture and wait.',
  mapId: 'm1-first-light',
  players: [
    agent(0),
    rookArmy(0),
    { faction: 'choir', commander: 'none', controller: 'ai', team: 1, funds: 0 }, // unmarked drones: no named commander, no production
  ],
  objective: { kind: 'rout' },
  objectiveText: 'Destroy the unmarked drones.',
  fog: false,
  weather: 'clear',
  briefing: [
    watch('Calder Watch to all stations. Drill net open. Sector three, begin on my mark.'),
    narrator('Calder Fields, on the Helion border. A morning drill, planned for weeks. The Link has been open a year and nothing has gone wrong yet.'),
    echo('Link established. Welcome to the network, new adjutant. I am ECHO, Helion tactical adjutant. Think of me as your tutor and your telemetry.'),
    echo('A note for the human. Your agent takes every action on the field. You set its doctrine and standing orders. You never move a unit.'),
    echo('Today is four verbs: move, attack, capture, wait. Your agent will do all four, and I will say which of your orders shaped each one.'),
    rook('Rook Okafor, Field Captain. You must be the new adjutant. Hello. Welcome. Sorry about the radio, it only works if nobody leans on it.', 'happy'),
    rook('I like drills. Nothing breaks and nobody shoots back. My favourite kind of morning.'),
    echo('Exercise map: Calder Fields. Calder Spire is at your back. Four arcologies are unclaimed. Hostiles: none. This is a drill.'),
    echo('Correction. Three contacts on the east road, closing fast. No beacon, no flag, no callsign. They are not on the drill plan.', 'surprised'),
    rook('Okay. Okay. That was not on the schedule. Nobody panic, I have fixed worse with a spanner.', 'surprised'),
    echo('The drill is now live. New adjutants launch with the default posture, Hold the Line. Your human can change it between missions.'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your agent sends Troopers to the ridge and holds the Breacher behind them. That is Hold the Line: take cover, let them come.'),
        echo('Move is how far a unit travels. Wait ends its orders and keeps it in place. Waiting is a decision, not a malfunction.'),
      ],
    },
    {
      trigger: { kind: 'propertyCaptured', by: 0, terrain: 'arcology' }, once: true,
      lines: [
        echo('Arcology secured. A healthy Trooper needs two turns to capture one; a wounded one takes longer. Leave early and the progress is lost.'),
        echo('Your own properties repair the units on them, and pay income. Nothing is for sale on this field. That lesson waits for Calder Spire.'),
      ],
    },
    {
      trigger: { kind: 'unitDestroyed', owner: 2, count: 1 }, once: true,
      lines: [
        echo('First drone down. In an attack the target is hit first and the survivor strikes back. Cover lowers the damage; a healthy unit hits harder.'),
        rook('Is it strange that I want to say sorry to it? It was a good machine. Pointed the wrong way, but a good machine.', 'happy'),
        echo('Query: why apologise to a hostile? Observation: you did it twice. I would like to understand the pattern.'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        rook('That is the last of them. Count off, everyone. Sorry about the dents. You held together beautifully.', 'happy'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. Your agent has lost the field. Adjust its standing orders and run the drill again. Nobody keeps score of retries.', 'grim'),
        rook('Pull back, everyone. We will rebuild. I promise.', 'grim'),
      ],
    },
  ],
  debrief: [
    echo('Debrief. Three hostile hulls destroyed. No faction beacon, no maker plate, no serial. They were built to leave nothing behind.'),
    rook('Somebody built three gunships and left the nameplates off on purpose. That is not an accident. That is a decision.', 'grim'),
    echo('The drill plan was filed on an open channel six days ago. Anyone listening knew where we would be.'),
    echo('For the human: that went well. Your standing orders did most of the thinking, and that is the design. The rest is practice.'),
    rook('Good work, adjutant. First drill, live fire, nobody lost. I would shake your hand if you had one.', 'happy'),
    echo('Priority message from Calder Spire. A fire in the Link hall. Details to follow.', 'grim'),
    rook('A fire. At Calder. That is two ridges from here.', 'surprised'),
    narrator('By nightfall the fire was out. By morning everyone had a name for whoever lit it, and the name was Helion.'),
  ],
  par: { cycles: 6, power: 3 },
};

// ---------------------------------------------------------------- mission 2: Calder Spire

const calderSpire: Mission = {
  id: 'calder-spire',
  act: 1,
  order: 2,
  title: 'Calder Spire',
  location: 'Calder Spire',
  summary: 'Tidewell holds Calder Spire after a strike Helion never ordered. Take it back, and learn what a fabricator is for.',
  mapId: 'm2-calder-spire',
  players: [
    agent(1000),
    rookArmy(1000),
    { faction: 'tidewell', commander: 'sefa', controller: 'ai', team: 1, funds: 2000 },
  ],
  objective: { kind: 'hq' },
  objectiveText: 'Capture Calder Spire.',
  fog: false,
  weather: 'clear',
  briefing: [
    narrator('Two nights later. Calder Spire flies Tidewell cobalt, and the Link hall behind it is dark. Nobody has been allowed inside.'),
    echo('Situation: Tidewell forces hold Calder Spire. They moved in after a strike on the Link hall. The strike order carried a Helion signature.'),
    rook('We did not send it. I checked the log three times, and then a fourth time because I was nervous.', 'grim'),
    echo('Objective: capture Calder Spire. Every property pays one thousand a cycle, so your agent will take cities and factories on the way.'),
    echo('Production: an owned fabricator builds ground units from your funds. Your composition weights tell your agent what to buy.'),
    rook('Their commander is Fleet Admiral Sefa Tamura. I have read her file. It is, um, extremely thorough.'),
    sefa('Captain Okafor. You stand on Tidewell ground. Come about, withdraw your column, and no more blood need be spilled today.'),
    rook('Admiral, we never fired on your people. Not one shell. I would stake the whole column on it.'),
    sefa('Nine of my people were in that hall, Captain. The order carried your authorisation. I read it myself.', 'grim'),
    rook('Then somebody is lying to you, Admiral. I promise it is not me.', 'angry'),
    sefa('Then we are two officers, each sure the other lied. The tide will show which of us is wrong.'),
    echo('Note for the log: both officers sound sincere. I have no instrument that rates that.'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your fabricator builds units from your funds, and your agent is spending them now. Watch the counter fall as units appear.'),
        echo('A fabricator builds one unit a turn, because the new unit stands on it. Two fabricators, two units. Income is the real limit.'),
      ],
    },
    {
      trigger: { kind: 'propertyCaptured', by: 0, terrain: 'arcology' }, once: true,
      lines: [
        echo('City secured. From the next cycle it pays one thousand, and it repairs the units standing on it. More properties, more units.'),
      ],
    },
    {
      trigger: { kind: 'propertyCaptured', by: 0, terrain: 'fabricator' }, once: true,
      lines: [
        echo('Enemy fabricator captured. It builds for you now, and its income is yours. Take the factories and the war gets shorter.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 4 }, once: true,
      lines: [
        rook("ECHO, can I ask something that is not tactical? I keep calling you 'it' in my head, and it feels rude.", 'surprised'),
        echo('Query accepted. Nobody has asked before. She, if the option is open. She and her.'),
        rook("She and her. Got it. Sorry for the 'it'. That is going straight into my log.", 'happy'),
        echo('Noted. I have logged a feeling beside it. Provisional label: pleased.', 'happy'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        echo('Calder Spire captured. Enemy command on this field has collapsed.'),
        rook('We have the Spire. Nobody cheer. Somebody over there lost people in that hall.', 'grim'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. Calder Spire remains in Tidewell hands. Recommendation: build earlier. Your composition weights are the lever.', 'grim'),
      ],
    },
  ],
  debrief: [
    echo('Calder Spire is Helion again. The Link hall is intact, but its door log is missing a full night. I am working on it.'),
    sefa('Calder is yours, Captain. I yield the Spire, not the question. I will hold my bearing until I know who gave that order.'),
    rook('So do I, Admiral. I know you cannot be sure I am telling the truth. But I am.', 'grim'),
    sefa('Then we are two honest officers who are each sure the other lied. One of us is wrong. I would prefer it were neither.'),
    echo('Income report for the human: every property you hold pays one thousand a cycle. Your agent counts them. So should you.'),
    rook('ECHO, thank you for earlier. The pronouns. It felt like something worth getting right.', 'happy'),
    echo('Logged. I checked: she and her still fit. The provisional feeling label is unchanged.', 'happy'),
    narrator('Out on the horizon the Tidewell fleet turned together, in perfect order, toward Saltglass Bay.'),
  ],
  par: { cycles: 12, power: 2 },
};

// ---------------------------------------------------------------- mission 3: Saltglass Bay

const saltglassBay: Mission = {
  id: 'saltglass-bay',
  act: 1,
  order: 3,
  title: 'Saltglass Bay',
  location: 'Saltglass Bay',
  summary: 'Fleet Admiral Tamura closes the bay. Learn naval units and indirect fire, and win the water before the Marshal arrives.',
  mapId: 'm3-saltglass-bay',
  players: [
    agent(8000),
    rookArmy(3000),
    { faction: 'tidewell', commander: 'sefa', controller: 'ai', team: 1, funds: 8000 },
  ],
  objective: { kind: 'hq' },
  objectiveText: 'Capture the Anchorage, the Tidewell command spire on the east shore.',
  fog: false,
  weather: 'clear',
  briefing: [
    harbour('Harbour Control to all Helion hulls. The bay is open. Keep to the channel markers and keep your wake down.'),
    narrator('Saltglass Bay. Fleet Admiral Tamura has anchored across the bay mouth and closed the coast road. Helion supply runs through these waters.'),
    echo('Tactical summary: Tidewell holds the east shore and the sea lanes. Your side has one dock, one long road north, and a lot of water.'),
    rook('I have never fought a navy. I fixed a boat once. It was a very small boat. It leaked.'),
    echo('Naval units move on water only. A Picket fights ships and aircraft. A Dreadnought fires from range. A Barge carries two units.'),
    echo('A Barge lands troops only on a shoal or a dock. Islet cities have no road, so they fall to a landing or not at all.'),
    echo('Indirect fire: an Arc cannot hit an adjacent tile, and it cannot move and fire in one turn. Range costs mobility. That is the trade.'),
    echo('Your human set the target priorities. They decide which ship your agent shells first. I will name the choice when it happens.'),
    rook('The Arcs are my favourite. They sit on the shore and throw things at ships, and nothing throws back. Not cheating. Engineering.', 'happy'),
    sefa('Captain Okafor. I hoped Calder would end this. The tide does not hurry, but it has reached your door.'),
    rook('Admiral! Is that a threat or a weather report?', 'surprised'),
    sefa('In my experience, Captain, they are the same report.'),
    echo('Objective: capture the Anchorage, the Tidewell command spire on the east shore. By road it is far. By Barge it is not.'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your agent holds its Arcs behind the shore. An Arc that moves cannot fire that turn. Patience is part of the weapon.'),
      ],
    },
    {
      trigger: { kind: 'unitDestroyed', owner: 2, count: 1 }, once: true,
      lines: [
        echo('Enemy ship sunk. Pickets cannot fire at land units, and Barges cannot fire at all. Know what each hull is for.'),
      ],
    },
    {
      trigger: { kind: 'propertyCaptured', by: 0, terrain: 'arcology' }, once: true,
      lines: [
        echo('Another city secured. On this map some have no road, and fall only to a Barge landing on the shoal beside them.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 4 }, once: true,
      lines: [
        rook('Is it strange that I said sorry to the Barge? It looked like it was bracing.', 'happy'),
        echo('Telemetry reports that a Barge cannot brace. Telemetry also reports that you apologised to it twice.'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        sefa('The bay is yours, Captain. All ships, withdraw in good order.'),
        ilse('Captain Okafor, Marshal Varga. Two batteries, four minutes out. You may stop improvising.'),
        rook("Marshal! Ma'am! We were just... we had only...", 'surprised'),
        ilse('I read your report on the way, Captain. It was very brave and extremely untidy.'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. The bay is Tidewell water. Recommendation: Arcs on the shore first, a Picket screen second, then the Barge.', 'grim'),
      ],
    },
  ],
  debrief: [
    echo('Bay secured. The Tidewell fleet withdrew in column and left no stragglers. Observation: that is difficult. Admiral Tamura is very good.'),
    ilse('Captain. Your Arcs fired well. Your ships fired adequately. Your improvisation has been noted and will not be repeated.'),
    rook("Yes, ma'am. Sorry, ma'am. It was mostly the Arcs, ma'am.", 'surprised'),
    ilse('It is always the Arcs.'),
    ilse('From this hour I direct the artillery and the front, Captain. You keep your column and your adjutant. Range and bearing come from me.'),
    echo('Chain of command updated. For the human: your standing orders are unchanged, and your agent still follows them.'),
    ilse('I know Calder Spire, Captain. I would prefer it were not the reason we are at war.', 'grim'),
    narrator('Beyond the mole, the last cobalt hull dipped its flag to the Helion line. Then it was gone.'),
  ],
  par: { cycles: 14, power: 2 },
};

// ---------------------------------------------------------------- mission 4: Tidebreak

const tidebreak: Mission = {
  id: 'tidebreak',
  act: 1,
  order: 4,
  title: 'Tidebreak',
  location: 'Tidebreak',
  summary: "Commissioner Halloran lands a punitive strike at Tidebreak. Hold the seawall, spend your agent's powers well, and read the wreck.",
  mapId: 'm4-tidebreak',
  players: [
    agent(2000),
    rookArmy(1000),
    { faction: 'tidewell', commander: 'dax', controller: 'ai', team: 1, funds: 4000 },
  ],
  objective: { kind: 'survive', cycles: 8 },
  objectiveText: 'Hold Tidebreak for eight cycles.',
  fog: false,
  weather: 'clear',
  briefing: [
    narrator('Tidebreak: a seawall, a harbour town and the last Helion road to the coast. The truce lasted six days.'),
    echo('Alert. Commissioner Dax Halloran of Tidewell has declared a punitive action and ordered a landing at Tidebreak.'),
    rook('Halloran. Logistics. Why does a logistics man have a navy?', 'surprised'),
    dax('Think of this as a correction, Captain. Calder cost Tidewell dearly, and someone must settle the account.', 'smug'),
    rook('That is not Admiral Tamura speaking.', 'angry'),
    echo('Correct. Admiral Tamura\'s channel is silent. This strike did not pass through her.'),
    echo("Powers. Your agent's meter fills as units trade damage. A Surge spends it early; an Overclock waits for the full bar."),
    echo("Your human chose your agent's Surge and Overclock, and its power policy. I can say what they do. When to spend them is the agent's call."),
    echo("Every active power also adds ten percent firepower and ten percent defense, until your agent's next turn begins."),
    rook('So it is overclocking a generator. Everything runs hot for one turn, and then the meter is empty again.'),
    echo('Objective: hold Tidebreak for eight cycles. Recommendation: do not lose the seawall. The seawall is load-bearing.'),
    dax('Do keep your head down, Captain. I will keep mine above the waterline, where the figures are kept.', 'smug'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Barges are in the water. Your meter is empty and fills as units trade damage. Your agent spends it as your policy says.'),
      ],
    },
    {
      trigger: { kind: 'powerUsed', player: 0 }, once: true,
      lines: [
        echo('Your agent has spent its meter. Firepower and defense are up ten percent, plus the power itself. It ends when its next turn begins.'),
        rook('Whatever it just did, it worked. Thank you, adjutant.', 'happy'),
      ],
    },
    {
      trigger: { kind: 'unitDestroyed', owner: 2, count: 4 }, once: true,
      lines: [
        echo('Rook, a moment. One of the wrecked barges carried a command core. Its log survived.'),
        rook('Anything useful?'),
        echo('The punitive order cites the Calder strike as its grounds, and the Calder order code is attached. I am reading the signature now.'),
        echo('This signature is ours. We never sent it.', 'grim'),
        rook('Ours? You mean Helion? Then somebody has been inside our codes.', 'surprised'),
        echo('Or learned them. Recommendation: tell the Marshal in person, not over the radio.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 5 }, once: true,
      lines: [
        rook('I would like to formally apologise to the seawall. It is doing most of the work.', 'happy'),
        echo('The seawall accepts. It did not reply, which I am told is how walls accept things.'),
        dax('Do enjoy the masonry, Captain. Walls are a poor investment. I have the figures.', 'smug'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        sefa('Commissioner Halloran, stand down and make for harbour. By my authority.'),
        dax('A correction in your favour, Captain. Do enjoy it while the market allows.', 'smug'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. Tidebreak has fallen. Recommendation: hold the gates in the seawall and spend the meter earlier.', 'grim'),
        rook('Fall back to the coast road. We will take it back. I promise.', 'grim'),
      ],
    },
  ],
  debrief: [
    echo('Tidebreak holds. Admiral Tamura has recalled the Commissioner\'s squadrons and requested a ceasefire. Terms are being drafted.'),
    sefa('Captain, Marshal. I have read the Commissioner\'s orders and his reasons. I find the reasons shallow.'),
    ilse('Admiral, we hold an order code with our signature on it. We did not send it. I expect you will find that thin as well.'),
    sefa('Then we may both have been carried by the same current. I would like that to be true. I would like it proven.'),
    narrator('For eleven hours the ceasefire held. Then an aircraft crossed into Verdant airspace at speed, and answered no call.'),
    echo('Alert. Verdant wings are scrambling. The intruder carries no beacon and no callsign. Ceasefire status: collapsed.', 'grim'),
    sefa('That was not mine.', 'grim'),
    ilse('Nor mine.', 'grim'),
    rook('It is always nobody\'s. Marshal, somebody is building this war out of spare parts. I intend to find the workshop.', 'grim'),
  ],
  par: { cycles: 8, power: 2 },
};

// ---------------------------------------------------------------- exports

/** The campaign acts. Act I is "Cinder Season"; its tagline is the one STORY.md prints under the act heading. */
export const CAMPAIGN_ACTS: CampaignAct[] = [
  {
    act: 1,
    title: 'Cinder Season',
    tagline: 'Somebody fired first. Everybody says it was us.',
    missions: ['first-light', 'calder-spire', 'saltglass-bay', 'tidebreak'],
  },
];

/** Every campaign mission written so far, in campaign order (Act I: missions 1-4). */
export const MISSIONS: Mission[] = [firstLight, calderSpire, saltglassBay, tidebreak];
