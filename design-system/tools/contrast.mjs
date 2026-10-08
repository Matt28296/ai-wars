import { colors, themes } from './tokens.src.mjs';
const get = (n, t) => { const tok = colors.find(x => x.name === n); if (!tok) throw new Error(n); const v = tok.value; return typeof v === 'string' ? v : (v[t] ?? v.dark); };
const lum = hex => { const h = hex.replace('#','').slice(0,6); const [r,g,b] = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)/255).map(v => v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4); return 0.2126*r+0.7152*g+0.0722*b; };
const ratio = (a,b) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
const grounds = ['void','panel','panel-raised'];
const pairs = [];
for (const fg of ['ink','ink-muted','signal','warn','danger','helion-ink','tidewell-ink','verdant-ink','kestrel-ink','choir-ink']) for (const g of grounds) pairs.push([fg,g,4.5]);
pairs.push(['ink','signal-soft',4.5],['signal','signal-soft',4.5],['on-signal','signal',4.5]);
for (const g of grounds) pairs.push(['line-strong',g,3],['signal',g,3]);
for (const f of ['helion','tidewell','verdant','kestrel']) pairs.push(['on-'+f,f,4.5]);
pairs.push(['on-choir','choir',3],['map-ink','map-shade',4.5]);
// faction fills vs map-shade outline should be visible (3:1) — except choir which is rimmed
for (const f of ['helion','tidewell','verdant','kestrel']) pairs.push([f,'map-shade',3]);
let bad = 0;
for (const t of themes.map(t=>t.id)) for (const [a,b,min] of pairs) { const r = ratio(get(a,t),get(b,t)); if (r < min) { bad++; console.log('FAIL', t, a, 'on', b, r.toFixed(2), '<', min); } }
// lightness ladder of faction fills
for (const f of ['kestrel','helion','verdant','tidewell','choir']) console.log(f, lum(get(f,'dark')).toFixed(3));
console.log('ok/danger check — signal vs danger dark', ratio(get('signal','dark'),get('danger','dark')).toFixed(2), 'light', ratio(get('signal','light'),get('danger','light')).toFixed(2));
console.log(bad ? bad+' failing pairs' : 'all pairs pass');
