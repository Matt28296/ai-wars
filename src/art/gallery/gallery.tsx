import '../../styles/tokens.css';
import { Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { MOODS, PORTRAIT_COMMANDERS, Portrait, type Mood } from '../Portrait';

const params = new URLSearchParams(location.search);
const section = params.get('s') ?? 'all';
const size = Number(params.get('size') ?? 128);
const only = params.get('only');

function Portraits() {
  return (
    <section>
      <h2 className="headline">Portraits</h2>
      <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(${MOODS.length}, ${size}px)`, gap: 8, alignItems: 'center' }}>
        <div />
        {MOODS.map((m) => <div key={m} className="label" style={{ color: 'var(--ink-muted)' }}>{m}</div>)}
        {PORTRAIT_COMMANDERS.filter((c) => !only || only.split(',').includes(c)).map((c) => (
          <Fragment key={c}>
            <div className="label">{c}</div>
            {MOODS.map((m) => <Portrait key={c + m} commander={c} mood={m} size={size} />)}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function App() {
  return (
    <div style={{ padding: 16, background: 'var(--void)', color: 'var(--ink)', minHeight: '100vh', fontFamily: 'var(--font-sans)' }}>
      {(section === 'all' || section === 'portraits') && <Portraits />}
      {section === 'one' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(params.get('m') ?? 'neutral').split(',').map((m) => <Portrait key={m} commander={params.get('c') ?? 'ren'} mood={m as Mood} size={size} />)}
        </div>
      )}
    </div>
  );
}

document.body.style.margin = '0';
createRoot(document.getElementById('root')!).render(<App />);
