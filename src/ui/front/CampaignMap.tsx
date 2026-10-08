// The campaign map (G9): the four acts side by side (stacked on a phone), each mission a card with its order, title, place, summary, the
// portraits of its sides, and its sight and sky. Act IV is drawn darker: it belongs to the Hollow Choir. Nothing is locked yet.
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { FACTIONS } from '../../data';
import { Sigil } from '../watch/kit';
import { campaignModel } from './campaign';
import type { MissionCard, TeamGroup } from './campaign';
import { useDocumentTitle } from './hooks';
import { Portrait } from './Portrait';
import { hrefs } from './router';

function Sides({ groups }: { groups: TeamGroup[] }): ReactElement {
  return (
    <div className="awf-sides">
      {groups.map((g, i) => (
        <div key={g.team} className="awf-side-group" role="group" aria-label={g.yours ? 'Your side' : 'Opposing side'}>
          {i > 0 && <span className="awf-vs label" aria-hidden>vs</span>}
          <ul className="awf-faces">
            {g.sides.map((s) => (
              <li key={s.slot} title={`${s.person.name} (${s.person.faction ? FACTIONS[s.person.faction].name : 'unmarked'})`}>
                <Portrait person={s.person} size={34} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MissionCardView({ card }: { card: MissionCard }): ReactElement {
  const foes = card.groups.filter((g) => !g.yours).flatMap((g) => g.sides.map((s) => s.person.name));
  return (
    <a className="awf-card awf-cut" href={hrefs.briefing(card.id)} data-mission={card.id}>
      <span className="awf-card-head">
        <span className="awf-card-no stat-sm" aria-label={`Mission ${Number(card.number)}`}>{card.number}</span>
        <span className="awf-card-title heading">{card.title}</span>
      </span>
      <span className="awf-card-where caption">{card.location}</span>
      <span className="awf-card-summary body-sm">{card.summary}</span>
      <Sides groups={card.groups} />
      <span className="awf-card-foes caption">Against {foes.join(', ')}</span>
      <span className="awf-card-chips">
        <span className="awf-card-goal"><span className="awf-pill awf-pill--goal caption">{card.goal}</span></span>
        <span className="awf-card-conds">
          <span className="awf-pill caption">{card.fogLabel}</span>
          <span className={card.weatherLabel === 'Ion storm' ? 'awf-pill awf-pill--warn caption' : 'awf-pill caption'}>{card.weatherLabel}</span>
        </span>
      </span>
    </a>
  );
}

export function CampaignMap(): ReactElement {
  const acts = useMemo(campaignModel, []);
  useDocumentTitle('Campaign · Ascendant Wars');
  return (
    <main className="awf-root awf-campaign" data-screen="campaign">
      <header className="awf-topbar">
        <a className="awf-back label" href={hrefs.title}>Title</a>
        <div className="awf-topbar-title">
          <p className="awf-kicker label">Campaign</p>
          <h1 className="awf-h1">Fourteen missions, four acts</h1>
        </div>
        <p className="awf-note caption">Every mission is open. Progress tracking comes with accounts.</p>
      </header>
      <div className="awf-acts">
        {acts.map((a) => (
          <section key={a.act} className={a.dark ? 'awf-act awf-act--dark' : 'awf-act'} data-act={a.act} data-mark={a.mark} aria-labelledby={`awf-act-${a.act}`}>
            <header className="awf-act-head">
              <p className="awf-act-no label"><Sigil faction={a.mark} size={22} tone="ink" />Act {a.numeral}</p>
              <h2 className="awf-act-title headline" id={`awf-act-${a.act}`}>{a.title}</h2>
              <p className="awf-act-tag body-sm">{a.tagline}</p>
            </header>
            <ol className="awf-cards">
              {a.cards.map((c) => <li key={c.id}><MissionCardView card={c} /></li>)}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
