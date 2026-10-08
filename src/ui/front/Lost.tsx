// The "nothing here" card: an address that leads nowhere, a mission that does not exist, a screen that threw. Always the way out.
import type { ReactElement } from 'react';
import { hrefs } from './router';

export function Lost({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <main className="awf-root awf-lost" data-screen="lost">
      <section className="awf-loadcard awf-cut">
        <p className="awf-kicker label">Nothing here</p>
        <h1 className="awf-loadcard-h">{title}</h1>
        <p className="awf-loadcard-p body-sm">{body}</p>
        <p className="awf-loadcard-actions">
          <a className="awf-back label" href={hrefs.title}>Title</a>
          <a className="awf-back label" href={hrefs.campaign}>Campaign</a>
        </p>
      </section>
    </main>
  );
}
