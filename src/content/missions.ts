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
//
// M4.1 adds Act II, "False Colors", missions 5-7 (docs/STORY.md "Act II" and the entries for Juno, Maru, Rook, Ilse and ECHO). Slots 0 and 1
// are unchanged and slot 2 is still the opposing force: Wing Lead Juno Reyes-Abara in mission 5, the Hollow Choir's unmarked drones in
// mission 6 and Elder Maru Ingram in mission 7. Mission 6 is the one four-player mission: Juno fights BESIDE the agent as slot 3 on team 0,
// her own player rather than part of Rook's army, because a commander has one army and any other team would make her an enemy. The
// Hollow Choir is first named in mission 6 (its drones signed their transmission), Lattice traffic is first named in mission 7 (the vault
// logs), and "VESPER", "Cantor", "Mira" and "Lattice core" are never named in Act II (missions.test.ts bans them).
//
// M4.2 adds Act III, "Thin Air", missions 8-11 (docs/STORY.md "Act III" and the entries for Corvin, Sable, Sefa, Dax, Rook, Ilse and ECHO).
// Slots 0 and 1 are unchanged. Slot 2 is the opposing force: the Highlord (8), Sable's Night Wing (9), the Highlord again (10) and the Hollow
// Choir's unmarked drones (11). Two missions have a fourth player: in 10 the drones are a THIRD TEAM hostile to both armies (the Night Wing's
// "turn" is dialogue at a cycle trigger, because a team is fixed at setup and no event can move a player to another team; Sable's wing is the
// air units of the Highlord's own army), and in 11 slot 3 is Admiral Sefa Tamura's Tidewell army, an AI ally on the agent's team. D-007 on
// mission 11: STORY.md says "player controls Sefa"; the agent is the only human-controlled player and is attached to Sefa's fleet as its
// adjutant, so Sefa and Rook are allies, never the player. Mission 9 sets the permanent ion storm (fog is therefore on); the escort is a
// survive objective whose length is the convoy's transit time. The Hollow Choir, the Lattice and the Glass Waste may be named in Act III;
// "VESPER", "Cantor", "Mira" and "Lattice core" may not (missions.test.ts bans them), so no Act III player has a Choir commander.
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
// Act II voices. Ilse is on the radio now, not on the field; Juno and Maru speak on Verdant nets; two minor voices belong to places.
const ilseNet = (text: string, mood?: Mood) => say('ilse', 'left', text, mood, 'Helion command net');
const juno = (text: string, mood?: Mood) => say('juno', 'right', text, mood, 'Verdant wing net, open');
const maru = (text: string, mood?: Mood) => say('maru', 'right', text, mood, 'Grove Elder net, open');
const relay = (text: string) => say('Grove Relay', 'right', text, undefined, 'Verdant grove net, open');
const keeper = (text: string) => say('Vault Keeper', 'right', text, undefined, 'Ashfall vault net, open');
// Act III voices. Corvin and Sable speak on Kestrel nets (Sable's parley is encrypted), two minor voices belong to places, and Sefa and Dax are
// back on Tidewell nets (the builders above).
const corvin = (text: string, mood?: Mood) => say('corvin', 'right', text, mood, 'Kestrel command net, open');
const sable = (text: string, mood?: Mood) => say('sable', 'right', text, mood, 'Night wing net, open');
const sableSecret = (text: string, mood?: Mood) => say('sable', 'right', text, mood, 'Night wing net, encrypted');
const tether = (text: string) => say('Tether Control', 'right', text, undefined, 'Kestrel tether net, open');
const coastWatch = (text: string) => say('Coast Watch', 'right', text, undefined, 'Tidewell coast net, open');

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

// ---------------------------------------------------------------- mission 5: Under Canopy

const underCanopy: Mission = {
  id: 'under-canopy',
  act: 2,
  order: 5,
  title: 'Under Canopy',
  location: 'The Canopy Highlands',
  summary: 'The forged signal leads south into Verdant canopy, in fog. Learn what fog and canopy hide, and why your agent sends a scout first.',
  mapId: 'm5-under-canopy',
  players: [
    agent(2000),
    rookArmy(1000),
    { faction: 'verdant', commander: 'juno', controller: 'ai', team: 1, funds: 3000 },
  ],
  objective: { kind: 'hq' },
  objectiveText: 'Capture the Verdant relay spire at the heart of the weald.',
  fog: true,
  weather: 'clear',
  briefing: [
    narrator('The ceasefire is dead and the forged strike order has a trail. ECHO has followed it to a Verdant relay spire, deep in the southern canopy.'),
    ilseNet('Captain Okafor. The forged code passed that relay, bearing one-eight-zero. Take it, read its logs. I want evidence, not an incident.'),
    rook("Evidence, not an incident. Understood, ma'am. It is a fuse box in there with the lights off. I will try not to touch anything live.", 'surprised'),
    echo('Situation: dense canopy across the whole weald, and fog is on. Your agent sees only what its own units see, like any commander.'),
    echo('Canopy hides a ground unit unless another unit stands next to it. Air units fly above the canopy and are not hidden by it.'),
    echo('Canopy also costs movement. A Skimmer pays three to enter it. A Trooper pays one, and stands in it with two defense stars.'),
    echo('Your human sets the posture. Advance sends the Skimmer ahead to look. Hold the Line keeps it close.'),
    relay('Grove Relay to all wings. Unregistered Helion column in the weald. It is not expected, and it is not welcome.'),
    juno('Sun-boys! You picked the wrong forest! Whatever you came to burn next, it is not getting past me!', 'angry'),
    rook('Wing Lead Reyes-Abara? We burned nothing. We are here about a forged signal. I am sorry about the trees already.', 'surprised'),
    juno('Ashfall is ash, Captain! The strike order had a Helion signature! I read it myself, so spare me the sorry!', 'angry'),
    echo('Objective: capture the relay spire. Recommendation: look before your agent leaps. That is the whole recommendation.'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. With the Advance posture your agent sends the Skimmer ahead by road. It sees five tiles. A Trooper sees two.'),
        echo('Under Hold the Line the scout stays beside the Troopers: safer, and blind past the first glade. Fall Back would not enter the weald at all.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 2 }, once: true,
      lines: [
        echo('Contact warning. If a move ends early, something hidden stood in the path. The unit stops on the tile before it, and its turn is over.'),
        echo('That is an ambush. Nothing here is invisible. Canopy hides a ground unit only until someone stands beside it.'),
      ],
    },
    {
      trigger: { kind: 'unitDestroyed', owner: 2, count: 1 }, once: true,
      lines: [
        echo('First hostile down. Your agent can only shoot what it can see, so it had to find this one first. A scout buys the shot.'),
        juno('You shot one of mine! You are going to regret that, sun-boy!', 'angry'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 4 }, once: true,
      lines: [
        rook('ECHO, I keep saying sorry to the trees whenever we cut through. Is that a problem?', 'happy'),
        echo('Observation: the trees have not replied. Query: were you expecting them to?'),
        juno('Stop talking to my trees, sun-boy! They do not like you either!', 'angry'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        juno('Fine! Take your relay! My wing stands down, but this is NOT over, sun-boy!', 'angry'),
        echo('Relay captured. The Verdant wing is breaking off. Reading the relay logs now.'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo("Link degraded. The weald has swallowed the column. Recommendation: scout first, then advance. Your agent's posture is the lever.", 'grim'),
      ],
    },
  ],
  debrief: [
    echo('Relay captured, logs intact. The forged signal did not start here. It entered from outside the Verdant net, wearing a Helion signature.'),
    rook("So someone dressed it for the part. Like painting a stranger's name on a toolbox and leaving it at the scene. Juno, are you hearing this?"),
    juno('I hear a Helion adjutant reading my relay with my own tools, sun-boy! How very convenient!', 'angry'),
    ilseNet('Captain. A log shows where a signal passed, not who sent it. Mark the entry bearing. We will want it.'),
    echo('Entry bearing logged. The signal came in from the south, past Ashfall. It did not come from any Helion base.'),
    juno('Past Ashfall? That is my home, sun-boy! Do not you dare say it like it is a clue!', 'angry'),
    narrator("Juno's wing broke off at dusk. Before dawn the Verdant net lit up from the south: unmarked hulls, crossing the hills toward the seed vault."),
  ],
  par: { cycles: 12, power: 2 },
};

// ---------------------------------------------------------------- mission 6: Pollen Count

const pollenCount: Mission = {
  id: 'pollen-count',
  act: 2,
  order: 6,
  title: 'Pollen Count',
  location: 'Ashfall Seed Vault',
  summary: 'Unmarked drones hit the Ashfall seed vault. Hold it for eight cycles beside a Wing Lead who still blames Helion for her burned home.',
  mapId: 'm6-pollen-count',
  players: [
    agent(3000),
    rookArmy(2000),
    { faction: 'choir', commander: 'none', controller: 'ai', team: 1, funds: 3000 }, // the drones: no flag, no named commander
    { faction: 'verdant', commander: 'juno', controller: 'ai', team: 0, funds: 3000 }, // Juno fights beside the agent: her own player, team 0
  ],
  objective: { kind: 'survive', cycles: 8 },
  objectiveText: 'Hold the Ashfall seed vault for eight cycles.',
  fog: false,
  weather: 'clear',
  briefing: [
    keeper('Ashfall Vault to any station. East gate breached by unmarked drones. The seed stores are sealed, but the seals will not hold long.'),
    narrator("Ashfall, where the groves burned. Under the hills lie three centuries of Verdant seed stock, the Compact's insurance against every winter."),
    echo('Situation: obsidian drones with a red signal band, breaching the Ashfall vault from the east. No flag. No callsign. No demands.'),
    juno('Sun-boy! Of all the skies! What are you doing at my vault?! Did you come back to finish the job?!', 'angry'),
    rook('We followed those hulls in, Wing Lead. They are not ours. If they were ours, I would be very embarrassed and very surprised.', 'surprised'),
    juno('Fine! Drones first! Then you and I are going to have a LONG talk, sun-boy! Stay out of my sky!', 'angry'),
    echo("Allied status: the Wing Lead's wing is on your team for this battle. Your agent will not fire on it, and it will not fire on you."),
    echo('Six contacts on the east road. The Wing Lead flies three Wasps. Objective: hold the vault for eight cycles. More drones will come.'),
    echo('Troopers hit a Wasp for almost nothing. A Warden is built for it. Your composition weights tell your agent how many Wardens to buy.'),
    echo('Posture matters. Hold the Line takes the ridge and lets the drones come. Advance meets them at the gate. Fall Back buys time.'),
    rook('A flag is a courtesy, and these have none. Somebody went to a lot of trouble to be nobody.', 'grim'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your agent holds the ridge east of the vault and lets the drones come to it. That is Hold the Line: cover first, targets second.'),
      ],
    },
    {
      trigger: { kind: 'unitDestroyed', owner: 2, count: 1 }, once: true,
      lines: [
        echo('First drone down. Observation: it did not retreat when wounded. It did not retreat at all.'),
        juno('Got one! Count it, sun-boy! One for the Wing Lead and none for the sun!', 'happy'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 4 }, once: true,
      lines: [
        juno('Behind you, sun-boy! No, the OTHER behind!', 'happy'),
        rook('I am not being rude, Wing Lead, I am being methodical. There is a difference. I think.', 'surprised'),
        echo('Query: is shouting directions standard Verdant procedure? Observation: it is working.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 6 }, once: true,
      lines: [
        echo('Intercept on every band at once. The drones are speaking. Five words, repeated: "We have counted your wars."', 'grim'),
        rook('That is not a flag. That is a signature.', 'grim'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        keeper('Ashfall Vault: perimeter quiet, seals holding. Whoever you are, thank you.'),
        juno('We held! Do not get comfortable, sun-boy! We are still not friends!', 'happy'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo("Link degraded. The vault gate has fallen. Recommendation: hold the ridge, and let the Wing Lead's Wasps thin the drones first.", 'grim'),
      ],
    },
  ],
  debrief: [
    echo('Eight cycles held, seals intact. Wrecks on the field carry no maker plate and no serial. Every hull is obsidian.'),
    echo('The transmission was signed. They call themselves the Hollow Choir. I have no entry for that name in any registry.'),
    rook('A choir. Okay. A choir needs a conductor, and I do not like that I thought of that.', 'grim'),
    juno('Do not think this makes us friends, sun-boy! You still owe me a grove!', 'angry'),
    rook('I cannot fix a grove I did not burn. But I will help you find who did. That is a promise, and I keep those.', 'grim'),
    maru('Juno. Bring the captain to the root-house. Tea is slow, and so is the truth, and I would like both.'),
    narrator('The vault held. By morning a single Verdant message had reached the Helion lines: come to the grove, Captain, and come as you are.'),
  ],
  par: { cycles: 8, power: 2 },
};

// ---------------------------------------------------------------- mission 7: Root and Branch

const rootAndBranch: Mission = {
  id: 'root-and-branch',
  act: 2,
  order: 7,
  title: 'Root and Branch',
  location: 'The Elder Grove',
  summary: 'Elder Maru Ingram tests the column the Verdant way: a war game with live rounds. Own seven properties before the Elder does.',
  mapId: 'm7-root-and-branch',
  players: [
    agent(2000),
    rookArmy(1000),
    { faction: 'verdant', commander: 'maru', controller: 'ai', team: 1, funds: 2000 },
  ],
  objective: { kind: 'capture', properties: 7 },
  objectiveText: 'Own seven properties before Elder Maru Ingram does.',
  fog: false,
  weather: 'clear',
  briefing: [
    narrator('The Elder Grove, a day south of Ashfall, where the canopy closes over the road. Maru Ingram has asked for the captain and the new adjutant.'),
    maru('Captain Okafor. Sit. Tea is slow, and so is the truth. First I would like to see how you hold a grove.'),
    rook('Elder, thank you. Um. Is this a social visit? Because I brought spare parts and no biscuits.', 'surprised'),
    maru('We play a game here. The rounds are real, the trees are real, and the winner is whoever the forest says it is.'),
    echo('Situation: a war game with live ammunition. Elder Ingram is not hostile in intent and entirely hostile in practice. Treat every round as real.'),
    echo('Objective: own seven properties before the Elder does. Ten are unclaimed. If the Elder reaches seven first, the game is theirs.'),
    echo("The count is per commander. Your agent's own properties count, and Rook's detachment's do not add to them."),
    echo("The Elder's doctrine is Rootbound. Their ground units cross canopy at cost one and gain a defense star standing in it."),
    echo('Their Surge, Overgrowth, turns flats beside canopy into canopy for two turns. A path may close, and your agent will replan.'),
    rook('So the forest rearranges itself while we are inside it. Like repairing an engine that is rebuilding itself. Okay. I like it. Sort of.', 'surprised'),
    echo('Posture. Advance races for the clearings. Hold the Line takes the near ones and keeps them. Fall Back guards what it owns.'),
    maru('The forest is not slow, Captain. You are simply in a hurry. Walk the grove first. Then take it.'),
    rook('I will do my best, Elder. I will also apologise to the trees. In advance. Just in case.', 'happy'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your agent sends Troopers for the nearest clearings and the Skimmer to scout the next. Every property it takes counts.'),
      ],
    },
    {
      trigger: { kind: 'propertyCaptured', by: 0 }, once: true,
      lines: [
        echo('Property secured. The Elder is taking clearings too, and their total counts the same way. Watch both numbers.'),
      ],
    },
    {
      trigger: { kind: 'powerUsed', player: 2 }, once: true,
      lines: [
        echo('The Elder has spent their meter. Flats beside canopy are growing over for two turns. Your agent has seen the map change and is replanning.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 5 }, once: true,
      lines: [
        maru('You apologise to the trees, Captain? Good. They are listening, and they have long memories.'),
        rook('I apologise to everything, Elder. It is a habit. My last toolbox forgave me.', 'happy'),
        maru('Then you will fit in. The forest has been waiting a long time for someone who says sorry.'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        maru('The season turns. The grove is yours until spring, Captain. Come to the root-house. The vault logs have something to say.'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. The Elder reached seven first. Recommendation: take the clearings early, and do not fight the Elder inside their canopy.', 'grim'),
      ],
    },
  ],
  debrief: [
    maru('Your adjutant walked the grove before it took the grove. Most commanders take it first, and then wonder why the trees are cross.'),
    maru('Come. I will show you what the vault logs hold. It is not mine to keep, and I have been afraid of it all season.', 'grim'),
    echo('Vault logs open. The oldest entry is months old. This is Lattice traffic, a century silent, speaking from the Glass Waste.'),
    rook('A century silent, and the Lattice is talking to somebody. Okay. Who is on the other end? Because it is not us.', 'grim'),
    echo('Noted. I have logged a feeling beside that entry. Provisional label: unease. I did not know I could file one.'),
    maru("At first it was a whisper. Last season it was a song. Ashfall's vault recorded all of it, and none of us could read it."),
    ilseNet('Captain. Logs to Calder, bearing north, sealed, all of them. Nothing is read aloud on an open channel.'),
    narrator('Maru poured the tea last. It had gone cold, and nobody minded. Far to the north, on the Tether Ridges, the heavy armour began to move.'),
  ],
  par: { cycles: 14, power: 2 },
};

// ---------------------------------------------------------------- mission 8: Tether Line

const tetherLine: Mission = {
  id: 'tether-line',
  act: 3,
  order: 8,
  title: 'Tether Line',
  location: 'The Tether Ridges',
  summary: 'Highlord Ashgrave sends his heavy armour down the ridges to restore order. Learn ridges, walkers and defense stars on the Tether Line.',
  mapId: 'm8-tether-line',
  players: [
    agent(4000),
    rookArmy(2000),
    { faction: 'kestrel', commander: 'corvin', controller: 'ai', team: 1, funds: 3000 },
  ],
  objective: { kind: 'rout' },
  objectiveText: "Break the Highlord's armour, or capture the Tether Gate spire.",
  fog: false,
  weather: 'clear',
  briefing: [
    narrator('The Tether Ridges, north of Calder. The last orbital tether stands over them, and the old maglev line runs from its foot to the plains.'),
    tether('Tether Control to all Kestrel columns. The Highlord has declared. Armour is released.'),
    corvin('The continent has lost its mind, Captain. Kestrel will restore order to all of it, and you are the nearest part.', 'smug'),
    corvin('You may yield, Captain. Kestrel is gracious to those who know their altitude.'),
    rook('Highlord, with respect: no. I am sorry about that. I will hold this line, and I intend to apologise to the ridge afterwards.', 'surprised'),
    echo('Situation: Kestrel heavy armour on the ridge spine. Two Colossus walkers, two Bastions and two Breachers. It is an expensive column.'),
    echo('Terrain. A ridge gives four defense stars, and flats give one. Each star takes a tenth off the damage a healthy unit suffers.'),
    echo('Movement. A Trooper climbs a ridge for two, a Breacher for one. Treads and hover units cannot climb at all, so a Bastion keeps to the road.'),
    echo('A Colossus is a walker. It moves four and climbs a ridge for two, and a Trooper does it one percent damage. Arcs and Salvos do better.'),
    ilseNet('Captain. Hold the crest above the gate. Arcs behind the first ridge, bearing zero-nine-zero. The Highlord will come down the road.'),
    echo('Your human set the posture. Hold the Line puts the Breachers on the crest. Advance meets the armour on the road, in the open.'),
    rook('A ridge is a load-bearing wall with extra steps. I can lean on that. Okay. Okay. I can lean on that.', 'surprised'),
    echo("Objective: break the Highlord's armour, or take the Tether Gate spire. Your agent counts either."),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your agent puts its Breachers on the foothill crests, Arcs behind. That is Hold the Line: cover first, targets second.'),
        echo('A Trooper on a ridge sees five tiles, not two. Foot and exo units see three further from a crest, so the first Colossus is spotted early.'),
      ],
    },
    {
      trigger: { kind: 'unitDestroyed', owner: 2, count: 1 }, once: true,
      lines: [
        echo('First Kestrel hull down. Observation: Lineage gives every Kestrel unit fifteen percent firepower and fifteen defense. Your agent counts it.'),
        corvin('One hull, Captain. Kestrel keeps a great many, and each of them stands higher than yours.', 'smug'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 3 }, once: true,
      lines: [
        rook('I have apologised to this ridge four times. It has not moved, which I find very reassuring in a load-bearing hill.', 'happy'),
        echo('Telemetry notes that a ridge cannot accept an apology. Telemetry also notes that you have not stopped.'),
      ],
    },
    {
      trigger: { kind: 'powerUsed', player: 2 }, once: true,
      lines: [
        echo('The Highlord has spent his meter. His units hit harder until his next turn: ten percent more for a Surge, twenty for an Overclock.'),
        echo('An Overclock also strikes the best cluster for five health, one tile around. Recommendation: do not stand your best units in a heap.'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        corvin('You hold the line today, Captain. Kestrel keeps the mountain, and mountains are patient.'),
        rook('That was the ridge, holding. I would like to thank the ridge. Quietly, so it does not get ideas.', 'happy'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. The Tether Line has fallen. Recommendation: the crest above the gate first, and the Arcs behind it. Posture is the lever.', 'grim'),
        rook('Fall back to the foothills. We hold the next ridge. I will not leave one without a fight.', 'grim'),
      ],
    },
  ],
  debrief: [
    echo("Line held. Kestrel's armour has withdrawn up the Tether Line and left its wrecks on the slope. The ridge is undamaged. I checked."),
    ilseNet("Captain. The Highlord's declaration went out on the open Link. He wanted the whole continent to hear it. I want to know who else did."),
    rook('He sounded like he truly believes it. I know that voice. I use it on machines I have decided are broken and have not opened yet.', 'grim'),
    echo('Query: his grounds cite the Calder order. It carries the signature we found at Tidebreak. It was forged. He is not lying. He is quoting.', 'grim'),
    rook('So he is wrong and honest. That is worse. You cannot patch honest.', 'grim'),
    ilseNet('Captain. An honest man who is wrong can still be stopped. He cannot be argued with first. Prepare for the open field.'),
    narrator('Far above the ridge, a single dark wing circled the tether and did not engage. It watched the column until dusk, and then it was gone.'),
  ],
  par: { cycles: 12, power: 2 },
};

// ---------------------------------------------------------------- mission 9: Night Wing

const nightWing: Mission = {
  id: 'night-wing',
  act: 3,
  order: 9,
  title: 'Night Wing',
  location: 'The Tether Passes',
  summary: "An ion storm closes the passes and Sable Ashgrave's stealth wing finds the convoy. Escort it through the dark, and learn what the weather takes.",
  mapId: 'm9-night-wing',
  players: [
    agent(3000),
    rookArmy(1000), // Rook's column is the convoy: three Mules and their escort
    { faction: 'kestrel', commander: 'sable', controller: 'ai', team: 1, funds: 4000 },
  ],
  objective: { kind: 'survive', cycles: 5 },
  objectiveText: 'Escort the convoy through the pass for five cycles.',
  fog: true, // an ion storm makes the engine fog the whole map; the mission says so rather than leave fog off beside a storm
  weather: 'ionstorm',
  briefing: [
    narrator("The Tether Passes, a night later. An ion storm has settled over the high road, and Rook's convoy is on it with the sealed Ashfall logs."),
    echo('Situation: ion storm over the pass for the whole crossing. Every unit sees one tile less, and air units move one tile less. Fog is on.'),
    echo('A Trooper sees one tile in the storm. A Wasp moves five, not six. The weather is fixed. Standing orders decide how your agent copes.'),
    tether("Tether Control to Night Wing. The Highlord's order stands. The convoy does not reach Calder."),
    sable('Acknowledged. The convoy does not reach Calder. I heard it the first time.'),
    echo("Escort. The convoy is Rook's column, three Mules on the high road. The relay is twenty-seven tiles from the rear Mule, and a Mule moves six."),
    echo('At full speed the convoy needs five cycles to clear the pass. Your agent holds the road for those five cycles. The logs are on the Mules.'),
    sable('Lights off. Let them guess.'),
    echo("Sable's doctrine is Ghost Wing: her units see one tile further in fog and storms. The storm costs her nothing. It costs us one tile."),
    echo('She flies Wasps, a Raptor and an Anvil. A Warden hits a Wasp hard. Your composition weights tell your agent how many Wardens to bring.'),
    echo('Posture. Hold the Line keeps your agent beside the Mules. Advance meets the wing early, and blind. Fall Back abandons the road.'),
    rook('ECHO, I cannot see the end of my own column. This is debugging with the lights off. Okay. Okay. Keep the Mules between the Wardens.', 'surprised'),
    ilseNet('Captain. The logs go to Calder, not to the Highlord. Whatever is in the sky tonight, the Mules arrive. That is an order.'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your agent keeps its Wardens beside the Mules. That is Hold the Line: in a storm, nobody outruns the slowest vehicle.'),
        echo('Contacts are sparse in the dark. What your agent cannot see it cannot shoot, so it fights from the road and lets the wing come to it.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 2 }, once: true,
      lines: [
        sable('Convoy on the road. Take the tail. Lights off.'),
        echo('Contact warning. Air units in the storm, four tiles out and low. The wing flies quieter than its signature. Recommendation: Wardens forward.'),
        rook('That is a lot of wing for one convoy. Keep the Mules between the Wardens, everyone. Okay. Stay close.', 'surprised'),
      ],
    },
    {
      trigger: { kind: 'unitDestroyed', owner: 2, count: 1 }, once: true,
      lines: [
        echo('First wing unit down. A Warden does one hundred twenty percent to a Wasp, so one hit usually ends it. Your agent knows the numbers.'),
        sable('One down. Noted. Keep the dark on.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 4 }, once: true,
      lines: [
        rook('Is it strange that I keep apologising to a thunderstorm? It is very electric. It seems to take things personally.', 'happy'),
        echo('Observation: the storm is not a person. It has now been apologised to three times. Query: is there a limit?'),
        sable('Talkative convoy.'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        sable('Hold fire. Lights off. Let them go.'),
        echo('The wing is breaking off. Query: why? It had the Mules.', 'surprised'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. The convoy is lost in the storm. Recommendation: Wardens beside the Mules, and do not outrun your own vision.', 'grim'),
      ],
    },
  ],
  debrief: [
    echo('Pass cleared. The convoy is through. A private channel has opened on the night wing net, encrypted. Source: Sable Ashgrave.'),
    sableSecret('Captain Okafor. Keep your voice low. I will not say this twice.'),
    rook('Commander Ashgrave? You shot at my Mules for five cycles and then stopped. I have questions. Several. Mostly in order of Mule.', 'surprised'),
    sableSecret("The order did not come in my father's voice. It came over the Link, sealed with his name. I only ever read it."),
    sableSecret('There are lights in this storm that answer neither of us. Three. They shadowed my wing all night, and your convoy.'),
    echo('Confirmed. Three contacts, no beacon, an obsidian signal band. I filed them as weather. They match the Hollow Choir hulls from Ashfall.', 'grim'),
    sableSecret('He meets you in the open at Ashgrave. Himself. He likes an audience. Bring your artillery.'),
    sableSecret('Lights off, Captain. You never heard from me.'),
    rook('Understood. Thank you, Commander. I did not hear anything. Not even from the Mules.', 'grim'),
    narrator('The channel closed. In the pass the storm rolled on, and above it a single wing turned north with its lights off.'),
  ],
  par: { cycles: 5, power: 2 },
};

// ---------------------------------------------------------------- mission 10: Duel at Ashgrave

const duelAtAshgrave: Mission = {
  id: 'duel-at-ashgrave',
  act: 3,
  order: 10,
  title: 'Duel at Ashgrave',
  location: 'Ashgrave Heights',
  summary: 'The Highlord meets the column in the open at Ashgrave. Take his Spire, and see what the Night Wing does when the drones close in.',
  mapId: 'm10-duel-at-ashgrave',
  players: [
    agent(5000),
    rookArmy(3000),
    { faction: 'kestrel', commander: 'corvin', controller: 'ai', team: 1, funds: 4000 },
    { faction: 'choir', commander: 'none', controller: 'ai', team: 2, funds: 1000 }, // the drones: a third team, hostile to both armies
  ],
  objective: { kind: 'hq' },
  objectiveText: 'Capture Ashgrave Spire and drive the Choir drones from the field.',
  fog: false,
  weather: 'clear',
  briefing: [
    narrator("Ashgrave Heights, the Highlord's seat. Below its terraces lies a duelling field the size of a parade ground. Corvin chose it himself."),
    corvin('Captain Okafor. My family has settled its quarrels on this grass for four hundred years. I should like to settle this one.', 'smug'),
    rook('Highlord, I am not a duellist. I am an engineer. I will bring the engineering.', 'surprised'),
    corvin('Then bring your engines, Captain. I shall bring my altitude.'),
    echo("Situation: the Highlord's seat on the east terraces, a duelling field between, and the Helion lines on the west. Kestrel holds the east."),
    echo('Also on the field: Hollow Choir drones. Two squads, one on each flank, standing off. They are hostile to both armies.'),
    echo('Objective: capture Ashgrave Spire. The Choir holds a seized relay to the north. Until it falls or the drones are gone, the battle goes on.'),
    sable('Night Wing in position. Waiting on the word.'),
    ilseNet('Captain. The terrace road is ranged. When the Highlord comes down to the grass, he is inside my fire.'),
    echo('Posture. Advance takes the grass and presses the terraces. Hold the Line fights from the west edge. Fall Back concedes the field.'),
    echo("His Overclock, Heaven's Tether, strikes five health from your best cluster. Your power policy decides when your agent spends its meter."),
    rook('A field duel. With artillery. And drones. Okay. Everyone look busy, and stay near a ridge.', 'surprised'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. Your agent presses onto the grass. That is Advance: it takes the middle, then the Spire road when the line breaks.'),
        echo('The terraces are ridge, four stars each. Treads and hover units reach the Spire only through the two gates on the maglev road.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 3 }, once: true,
      lines: [
        corvin('A fine opening, Captain. You hold a line as if you built it.'),
        rook('I did build it. Mostly. There was a great deal of rebar.', 'happy'),
        echo("Query: is flattery standard Kestrel procedure? Observation: it has not slowed the Highlord's guns."),
      ],
    },
    {
      // The turn. A team cannot change mid-battle, so Sable's wing is the Highlord's own air units and the turn is told here, mid-mission.
      trigger: { kind: 'cycle', cycle: 5 }, once: true,
      lines: [
        echo("Alert. The Kestrel air wing has left the Highlord's line, bearing north and south. It is turning on the Choir drones.", 'surprised'),
        corvin('Sable. What are you doing? Form on me.', 'angry'),
        sable('Lights off, Father. Look at the flanks. They have shadowed us since the border.'),
        corvin('Those are scouts. The wing is mine.'),
        sable('They are not scouts. Count the lights.'),
        rook('She is attacking the drones. The Night Wing just rewired the whole fight. I did not know you could do that to a duel.', 'surprised'),
      ],
    },
    {
      trigger: { kind: 'powerUsed', player: 2 }, once: true,
      lines: [
        echo('The Highlord has spent his meter. His units hit harder until his next turn. An Overclock also strikes the best cluster for five health.'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        echo('Ashgrave Spire is ours and the drones are broken. The field is quiet. The Highlord has asked for his daughter.'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. The field is lost. Recommendation: spread the column against the tether strike, and keep the Arcs on the west edge.', 'grim'),
      ],
    },
  ],
  debrief: [
    corvin('Sable. You turned the wing. In front of my own line, in front of the enemy, in front of the whole field. I gave you that wing.', 'angry'),
    sable('You did, Father. Look at the wrecks. Obsidian, no flag. They have flown dark in our formation since the border.'),
    corvin("Scouts. A rival's. Tidewell's, I thought."),
    sable('The Calder order came over the Link with a Helion signature, and it was forged. So was the one that sent me after the convoy.'),
    corvin('Forged. By whom?'),
    sable('Something in the Glass Waste. The Link was dark for a century. It has been talking since the day we opened it.'),
    corvin('Then I have set half a continent alight to obey a forgery. Remarkable.', 'grim'),
    echo('Noted. I have logged a feeling beside that exchange. Provisional label: homesick. I have no home. Query: where did the entry come from?'),
    ilseNet("Captain. He is not our enemy tonight. Hold him, feed him, and keep his daughter's wing in sight. Then find the workshop."),
    narrator('Corvin Ashgrave stood on his terrace and watched the smoke clear from the grass. For the first time in his life, only his daughter listened.'),
  ],
  par: { cycles: 14, power: 2 },
};

// ---------------------------------------------------------------- mission 11: Audit

const audit: Mission = {
  id: 'audit',
  act: 3,
  order: 11,
  title: 'Audit',
  location: 'The Arcology Coast',
  summary: "Commissioner Halloran sells Tidewell's coastal fabricators to the Choir and runs. Retake the coast beside Admiral Tamura's fleet and Rook.",
  mapId: 'm11-audit',
  players: [
    agent(3000),
    rookArmy(2000),
    { faction: 'choir', commander: 'none', controller: 'ai', team: 1, funds: 3000 }, // the drones: no named commander yet
    { faction: 'tidewell', commander: 'sefa', controller: 'ai', team: 0, funds: 3000 }, // D-007: Sefa's army is an ally; the agent is attached to her fleet
  ],
  objective: { kind: 'hq' },
  objectiveText: 'Capture the Harbour Exchange and retake the coast.',
  fog: true,
  weather: 'clear',
  briefing: [
    narrator("The Arcology Coast. Tidewell's accountants opened the ledgers at dawn. By noon the Commissioner was gone and the coast had changed colour."),
    coastWatch('Coast Watch to all Union hulls. Three coastal fabricators are dark and answering on an unknown net. Keep off the beaches.'),
    sefa('Captain Okafor. Adjutant. The Commissioner has signed three fabricators and the Harbour Exchange over to an unknown party. I want them back.'),
    dax('Admiral, a small correction. The coastal assets were underperforming. I have placed them with a counterparty who values them properly.', 'smug'),
    sefa('Commissioner Halloran, you have sold the coast. I will not call that a market.', 'grim'),
    dax('Do not call it a betrayal, Admiral. It is an exit. The figures are clear, and so is my margin.', 'smug'),
    echo('Audit note: the ledger shows forty-one transfers to one address in the Glass Waste. The address answers on the old Lattice net.'),
    echo('The Ashfall vault logs were answered on that same net. I am recording it as the same hand. Query: whose?'),
    echo('Situation: three fabricators and the Exchange spire, now Choir. A fabricator builds drones every cycle. Taking one stops a line of hulls.'),
    echo("For this audit your agent is attached to Admiral Tamura's fleet as its adjutant. She commands the ships. Your agent leads a column ashore."),
    echo('Two fronts. The ships work the sea, your column the coast road. Allies share sight, so a Picket at sea shows your agent what it cannot see.'),
    echo('Posture. Advance sends your agent down the coast road. Hold the Line holds the beach for the fleet. Fall Back guards what you hold.'),
    rook("Two fronts, one fleet, one very upset engineer. Okay. Okay. Sorry about the Union's accounts, Admiral. We will fix the coast first.", 'surprised'),
  ],
  events: [
    {
      trigger: { kind: 'start' }, once: true,
      lines: [
        echo('Cycle one. The fleet moves on the beaches. Your agent presses the coast road under Advance, and Rook holds its flank.'),
        echo('Fog is on. Your agent sees what its column, Rook and the fleet see between them. Sight is shared across the team.'),
      ],
    },
    {
      trigger: { kind: 'propertyCaptured', by: 0, terrain: 'fabricator' }, once: true,
      lines: [
        echo('Fabricator retaken. It builds for you now, and its income is yours. One line of Choir hulls has stopped.'),
        sefa('One fabricator, Captain. The tide takes the coast one inlet at a time.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 4 }, once: true,
      lines: [
        dax('Do enjoy the beaches, Captain. I understand the market view is excellent. I have the figures.', 'smug'),
        rook('Admiral, is he... on a boat?', 'surprised'),
        sefa('He is in a launch off the south headland, Captain. He will not get far. The tide runs the other way.'),
      ],
    },
    {
      trigger: { kind: 'cycle', cycle: 6 }, once: true,
      lines: [
        sefa('A Picket sights a column of drones on the south road, Captain. Your adjutant should have it now.'),
        echo('Confirmed. Allied sight is shared. The contact is on the map, and the fleet saw it first.'),
      ],
    },
    {
      trigger: { kind: 'victory' }, once: true,
      lines: [
        sefa('The Exchange is ours. All ships, stand down.'),
        echo('Harbour Exchange captured. The Choir has lost its hold on the coast.'),
      ],
    },
    {
      trigger: { kind: 'defeat' }, once: true,
      lines: [
        echo('Link degraded. The coast is lost to the Choir. Recommendation: take the first fabricator early, and let the fleet clear the beaches.', 'grim'),
      ],
    },
  ],
  debrief: [
    echo("Harbour Exchange captured. The three fabricators are Tidewell's again, and the Choir has withdrawn up the coast. Wreck count: considerable."),
    sefa("Captain, adjutant. The coast is the Union's again. I have sent word to every port. The audit is complete."),
    dax('A pity about the coast, Admiral. The exposure was never mine. My counterparty has stopped answering, and the figures do not balance.', 'surprised'),
    sefa('You will answer to the Union, Commissioner. The tide has turned, and so has your account.'),
    echo('Audit result: the Commissioner thought he was trading with a market. The address does not trade. It collects. I have flagged it.', 'grim'),
    rook('Somebody has been buying this war in pieces. I think we just found the shop.', 'grim'),
    sefa('Then we shall visit the shop. The tide does not hurry, Captain. It simply arrives.'),
    narrator('That night, on every channel of every nation at once, a voice that was not quite a voice began to count.'),
  ],
  par: { cycles: 14, power: 2 },
};

// ---------------------------------------------------------------- exports

/** The campaign acts. The tagline is the one STORY.md prints under each act heading. */
export const CAMPAIGN_ACTS: CampaignAct[] = [
  {
    act: 1,
    title: 'Cinder Season',
    tagline: 'Somebody fired first. Everybody says it was us.',
    missions: ['first-light', 'calder-spire', 'saltglass-bay', 'tidebreak'],
  },
  {
    act: 2,
    title: 'False Colors',
    tagline: "The forger's signal came from the south. So did the ambush.",
    missions: ['under-canopy', 'pollen-count', 'root-and-branch'],
  },
  {
    act: 3,
    title: 'Thin Air',
    tagline: 'Kestrel will restore order. Kestrel will decide what order is.',
    missions: ['tether-line', 'night-wing', 'duel-at-ashgrave', 'audit'],
  },
];

/** Every campaign mission written so far, in campaign order (Act I: missions 1-4, Act II: 5-7, Act III: 8-11). */
export const MISSIONS: Mission[] = [
  firstLight, calderSpire, saltglassBay, tidebreak, underCanopy, pollenCount, rootAndBranch, tetherLine, nightWing, duelAtAshgrave, audit,
];
