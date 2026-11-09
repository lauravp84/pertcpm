/* Motor de cálculo PERT/CPM do site GEO PERT/CPM. Funções puras, sem DOM. */
(function(){
const RF=['r','r2','r3'];
const num=s=>(s===''||s==null)?NaN:Number(String(s).replace(',','.'));
const MAPT={FS:'TI',SS:'II',FF:'TT',SF:'IT'};
function parseP(s){const out=[],bad=[];String(s||'').toUpperCase().split(/[,;]+/).forEach(tok=>{tok=tok.trim();if(!tok)return;let parts=[tok];
  if(/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(tok))parts=tok.split('-');else if(!tok.includes('(')&&/\s/.test(tok))parts=tok.split(/\s+/);
  parts.forEach(t=>{const m=t.match(/^([A-Z0-9]+)\s*(?:\(\s*(TI|II|TT|IT|FS|SS|FF|SF)?\s*([+-]\s*\d+(?:[.,]\d+)?)?\s*\))?$/);if(!m){bad.push(t);return}
    out.push({p:m[1],t:MAPT[m[2]]||m[2]||'TI',lag:m[3]?Number(m[3].replace(/\s/g,'').replace(',','.')):0})})});return{links:out,bad}}
const linkTxt=l=>l.p+(l.t!=='TI'||l.lag?'('+(l.t!=='TI'?l.t:'')+(l.lag?(l.lag>0?'+':'')+String(l.lag).replace('.',','):'')+')':'');
const fwdV=(t,lag,ps,pd,d)=>t==='TI'?ps+pd+lag:t==='II'?ps+lag:t==='TT'?ps+pd+lag-d:ps+lag-d;
const bwdV=(t,lag,ss,sd,d)=>t==='TI'?ss-lag-d:t==='II'?ss-lag:t==='TT'?ss+sd-lag-d:ss+sd-lag;
function build(acts,mode,E){
  const list=acts.filter(a=>(a.c||'').trim()),errors=[],pert=mode==='PERT';
  const nodes=list.map(a=>{const o=num(a.o),m=num(a.m),p=num(a.pe),pp=parseP(a.p);
    return{c:a.c.trim().toUpperCase(),n:a.n||'',d:pert?(o+4*m+p)/6:num(a.d),o,m,p,v:pert?Math.pow((p-o)/6,2):0,links:pp.links,bad:pp.bad,preds:[...new Set(pp.links.map(l=>l.p))],raw:a}});
  const map={};nodes.forEach(x=>{if(map[x.c])errors.push(E.dup(x.c));map[x.c]=x});
  nodes.forEach(x=>{if(pert){if(!(x.o>=0&&x.m>=x.o&&x.p>=x.m))errors.push(E.omp(x.c))}else if(!(x.d>=0))errors.push(E.dur(x.c));
    x.bad.forEach(b=>errors.push(E.bad(b,x.c)));x.preds.forEach(p=>{if(p===x.c)errors.push(E.self(x.c));else if(!map[p])errors.push(E.miss(p,x.c))})});
  if(!nodes.length)errors.push(E.empty());
  if(errors.length)return{errors,nodes:[],map:{}};
  const out={};nodes.forEach(x=>{x.succ=[];out[x.c]=[]});nodes.forEach(x=>{x.preds.forEach(p=>map[p].succ.push(x.c));x.links.forEach(l=>out[l.p].push({s:x.c,t:l.t,lag:l.lag}))});
  const indeg={},order=[];nodes.forEach(x=>indeg[x.c]=x.preds.length);const q=nodes.filter(x=>!indeg[x.c]).map(x=>x.c);
  while(q.length){const c=q.shift();order.push(c);map[c].succ.forEach(s=>{if(--indeg[s]===0)q.push(s)})}
  if(order.length<nodes.length)return{errors:[E.cycle()],nodes:[],map:{}};
  order.forEach(c=>{const x=map[c];x.lvl=x.preds.length?Math.max(...x.preds.map(p=>map[p].lvl))+1:0});
  const paths=[];const dfs=(c,seq)=>{if(paths.length>=80)return;const s2=[...seq,c];if(!map[c].succ.length)paths.push(s2);else map[c].succ.forEach(s=>dfs(s,s2))};
  nodes.filter(x=>!x.preds.length).forEach(x=>dfs(x.c,[]));
  const R={errors:[],nodes,map,order,paths,out,pdm:nodes.some(x=>x.links.some(l=>l.t!=='TI'||l.lag))};
  const D={};nodes.forEach(x=>D[x.c]=x.d);const r=cpm(R,D);R.dur=r.dur;nodes.forEach(x=>Object.assign(x,r.s[x.c]));return R}
function cpm(R,D){const s={};R.order.forEach(c=>{const x=R.map[c];let es=0;x.links.forEach(l=>{const v=fwdV(l.t,l.lag,s[l.p].es,D[l.p],D[c]);if(v>es)es=v});s[c]={es,ef:es+D[c]}});
  const dur=Math.max(...R.order.map(c=>s[c].ef));
  [...R.order].reverse().forEach(c=>{let lf=dur;R.out[c].forEach(o=>{const v=bwdV(o.t,o.lag,s[o.s].ls,D[o.s],D[c])+D[c];if(v<lf)lf=v});Object.assign(s[c],{lf,ls:lf-D[c]});
    s[c].slack=Math.round((s[c].ls-s[c].es)*1e6)/1e6;s[c].crit=Math.abs(s[c].slack)<1e-9});
  return{dur,s}}
function fwdOnly(R,D){const s={};let mx=0;R.order.forEach(c=>{const x=R.map[c];let es=0;x.links.forEach(l=>{const v=fwdV(l.t,l.lag,s[l.p],D[l.p],D[c]);if(v>es)es=v});s[c]=es;if(es+D[c]>mx)mx=es+D[c]});return mx}
function crash(R,ci){const dn={},dc={},slope={};
  R.nodes.forEach(x=>{dn[x.c]=x.d;const c=num(x.raw.dc);dc[x.c]=Number.isFinite(c)?Math.max(0,Math.min(c,x.d)):x.d;const cn=num(x.raw.cn)||0,cc=num(x.raw.cc)||0;slope[x.c]=dn[x.c]>dc[x.c]+1e-9?(cc-cn)/(dn[x.c]-dc[x.c]):Infinity});
  const cur={...dn};let direct=R.nodes.reduce((s,x)=>s+(num(x.raw.cn)||0),0);let r=cpm(R,cur);const rows=[{dur:r.dur,direct,cut:[]}];
  for(let it=0;it<80;it++){let best=null;
    if(!R.pdm){const lens=R.paths.map(p=>p.reduce((s,c)=>s+cur[c],0));const crit=R.paths.filter((p,i)=>lens[i]>=r.dur-1e-9);
      const cand=[...new Set(crit.flat())].filter(c=>cur[c]>dc[c]+1e-9&&Number.isFinite(slope[c]));if(!cand.length||cand.length>14)break;
      for(let m=1;m<(1<<cand.length);m++){const S=cand.filter((_,i)=>m>>i&1);if(!crit.every(p=>p.some(c=>S.includes(c))))continue;const cost=S.reduce((s,c)=>s+slope[c],0);if(!best||cost<best.cost-1e-9)best={S,cost}}}
    else{const cand=R.order.filter(c=>r.s[c].crit&&cur[c]>dc[c]+1e-9&&Number.isFinite(slope[c])).sort((a,b)=>slope[a]-slope[b]).slice(0,10);const combos=[];
      const rec=(i,S)=>{if(S.length)combos.push(S);if(S.length===3)return;for(let j=i;j<cand.length;j++)rec(j+1,[...S,cand[j]])};rec(0,[]);
      combos.forEach(S=>{const cost=S.reduce((s,c)=>s+slope[c],0);if(best&&cost>=best.cost-1e-9)return;const dl=Math.min(1,...S.map(c=>cur[c]-dc[c])),D2={...cur};S.forEach(c=>D2[c]-=dl);if(cpm(R,D2).dur<r.dur-1e-9)best={S,cost}})}
    if(!best)break;const delta=Math.min(1,...best.S.map(c=>cur[c]-dc[c]));best.S.forEach(c=>cur[c]-=delta);direct+=best.cost*delta;r=cpm(R,cur);
    rows.push({dur:r.dur,direct,cut:best.S,delta})}
  rows.forEach(x=>{x.ind=x.dur*ci;x.total=x.direct+x.ind});const opt=rows.reduce((a,b)=>b.total<a.total-1e-9?b:a);return{rows,opt,slope,dc}}
const rk=(R,c,k)=>num(R.map[c].raw[RF[k]])||0;
function usage(R,st,D,k,H){const u=Array(H).fill(0);R.nodes.forEach(x=>{const r=rk(R,x.c,k);if(!r)return;for(let t=0;t<H;t++){const m=t+.5;if(m>st[x.c]&&m<st[x.c]+D[x.c])u[t]+=r}});return u}
const activeRes=R=>[0,1,2].filter(k=>R.nodes.some(x=>rk(R,x.c,k)>0));
function level(R){const D={},st={};R.nodes.forEach(x=>{D[x.c]=x.d;st[x.c]=x.es});const H=Math.max(1,Math.ceil(R.dur)),ks=activeRes(R);
  const score=()=>ks.reduce((s,k)=>{const u=usage(R,st,D,k,H);return s+Math.max(...u)*1e4+u.reduce((a,b)=>a+b*b,0)},0);
  for(let pass=0;pass<3;pass++)R.order.forEach(c=>{const x=R.map[c];if(x.crit)return;let lo=0;x.links.forEach(l=>{const v=fwdV(l.t,l.lag,st[l.p],D[l.p],D[c]);if(v>lo)lo=v});
    let hi=x.ls;R.out[c].forEach(o=>{const v=bwdV(o.t,o.lag,st[o.s],D[o.s],D[c]);if(v<hi)hi=v});let best=st[c],bv=Infinity;
    for(let s=lo;s<=hi+1e-9;s+=1){st[c]=s;const v=score();if(v<bv-1e-9){bv=v;best=s}}st[c]=best});
  return st}
function sgs(R,D,lims){const r=cpm(R,D),st={},done=[],act=[0,1,2].filter(k=>Number.isFinite(lims[k]));const skipped=new Set();
  while(done.length<R.nodes.length){const el=R.order.filter(c=>!done.includes(c)&&R.map[c].preds.every(p=>done.includes(p)));el.sort((a,b)=>r.s[a].ls-r.s[b].ls||r.s[a].es-r.s[b].es);
    const c=el[0],x=R.map[c],d=D[c];let t0=0;x.links.forEach(l=>{const v=fwdV(l.t,l.lag,st[l.p],D[l.p],d);if(v>t0)t0=v});
    const ks=act.filter(k=>{const q=rk(R,c,k);if(q>lims[k])skipped.add(c);return q>0&&q<=lims[k]});
    const fits=t=>ks.every(k=>{const pts=[t,...done.map(y=>st[y]).filter(q=>q>t+1e-9&&q<t+d-1e-9)];return pts.every(q=>{let u=rk(R,c,k);done.forEach(y=>{if(st[y]<=q+1e-9&&q<st[y]+D[y]-1e-9)u+=rk(R,y,k)});return u<=lims[k]+1e-9})});
    const cands=[t0,...done.map(y=>st[y]+D[y]).filter(f=>f>t0)].sort((a,b)=>a-b);let s=cands.find(fits);if(s==null)s=Math.max(t0,...done.map(y=>st[y]+D[y]));st[c]=s;done.push(c)}
  return{st,dur:Math.max(...R.order.map(c=>st[c]+D[c])),skipped:[...skipped]}}
function ccpm(R,cut,lims){const f=Math.min(.9,Math.max(0,cut/100)),D={};R.nodes.forEach(x=>D[x.c]=x.d*(1-f));const r=cpm(R,D),useRes=!!lims;let st={},mk,cp,resLinks=[];
  if(useRes){const g=sgs(R,D,lims);st=g.st;mk=g.dur}else{R.order.forEach(c=>st[c]=r.s[c].es);mk=r.dur}
  const fin=c=>st[c]+D[c];
  if(!useRes&&!R.pdm){const lens=R.paths.map(p=>p.reduce((s,c)=>s+D[c],0));cp=R.paths[lens.indexOf(Math.max(...lens))]}
  else{let x=R.order.reduce((a,b)=>fin(b)>fin(a)?b:a);cp=[x];const shares=(a,b)=>[0,1,2].some(k=>rk(R,a,k)>0&&rk(R,b,k)>0);
    for(let g=0;g<300&&st[x]>1e-9;g++){const X=R.map[x];let y=X.preds.find(p=>!cp.includes(p)&&(useRes?Math.abs(fin(p)-st[x])<1e-6||Math.abs(st[p]-st[x])<1e-6&&X.links.some(l=>l.p===p&&l.t==='II'):r.s[p].crit));
      if(!y&&useRes){y=R.order.find(q=>!cp.includes(q)&&Math.abs(fin(q)-st[x])<1e-6&&shares(q,x));if(y)resLinks.push(y+' → '+x)}
      if(!y)break;cp.unshift(y);x=y}}
  const inC=new Set(cp),cutOf=c=>R.map[c].d*f,pb=.5*cp.reduce((s,c)=>s+cutOf(c),0),feeds=[],feedOf={};
  R.nodes.forEach(x=>{if(inC.has(x.c))return;const js=x.succ.filter(k=>inC.has(k));if(!js.length)return;const seq=[x.c];let cur=x;
    for(let g=0;g<100;g++){const ps=cur.preds.filter(p=>!inC.has(p)&&!seq.includes(p));if(!ps.length)break;cur=R.map[ps.reduce((a,b)=>fin(b)>fin(a)?b:a)];seq.unshift(cur.c)}
    const fb=.5*seq.reduce((s,c)=>s+cutOf(c),0);const into=js.reduce((a,b)=>st[b]<st[a]?b:a);feeds.push({at:x.c,into,seq,fb});seq.forEach(c=>{if(feedOf[c]==null)feedOf[c]=fb})});
  if(!useRes)R.nodes.forEach(x=>{if(!inC.has(x.c))st[x.c]=Math.max(r.s[x.c].es,r.s[x.c].ls-(feedOf[x.c]||0))});
  return{D,cp,inC,pb,feeds,len:mk,total:mk+pb,st,resLinks,cutSum:cp.reduce((s,c)=>s+cutOf(c),0)}}
const Phi=z=>{const t=1/(1+.2316419*Math.abs(z)),d=.3989423*Math.exp(-z*z/2),p=d*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>0?1-p:p};
const nrm=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
function gam(a){if(a<1)return gam(a+1)*Math.pow(Math.random(),1/a);const d=a-1/3,c=1/Math.sqrt(9*d);for(;;){let x,v;do{x=nrm();v=1+c*x}while(v<=0);v=v*v*v;const u=Math.random();if(u<1-.0331*x*x*x*x||Math.log(u)<.5*x*x+d*(1-v+Math.log(v)))return d*v}}
const sBeta=(o,m,p)=>{if(p<=o)return m;const a=1+4*(m-o)/(p-o),b=1+4*(p-m)/(p-o),x=gam(a),y=gam(b);return o+(p-o)*x/(x+y)};
const sTri=(o,m,p)=>{if(p<=o)return m;const u=Math.random(),F=(m-o)/(p-o);return u<F?o+Math.sqrt(u*(p-o)*(m-o)):p-Math.sqrt((1-u)*(p-o)*(p-m))};
function monteCarlo(R,n,dist){const smp=dist==='tri'?sTri:sBeta,out=[];for(let k=0;k<n;k++){const D={};R.nodes.forEach(x=>D[x.c]=smp(x.o,x.m,x.p));out.push(fwdOnly(R,D))}return out.sort((a,b)=>a-b)}
function addUnits(start,n,unit,util,loc){const d=new Date(start+'T12:00:00');if(isNaN(d))return'—';const k=Math.ceil(n-1e-9);
  if(unit==='semanas')d.setDate(d.getDate()+7*k);else if(unit==='meses')d.setMonth(d.getMonth()+k);else if(util){let i=0;while(i<k){d.setDate(d.getDate()+1);const w=d.getDay();if(w&&w<6)i++}}else d.setDate(d.getDate()+k);
  return d.toLocaleDateString(loc||'pt-BR')}
function genPractice(){const codes='ABCDEF'.split(''),acts=[];for(let i=0;i<6;i++){let p=[];if(i===1)p=['A'];else if(i>1){const k=Math.random()<.45?2:1,pool=codes.slice(0,i);while(p.length<k){const c=pool[Math.floor(Math.random()*pool.length)];if(!p.includes(c))p.push(c)}p.sort()}
  acts.push({c:codes[i],d:String(1+Math.floor(Math.random()*8)),p:p.join(', ')})}return acts}
window.PERTENG={RF,num,parseP,linkTxt,build,cpm,fwdOnly,crash,usage,activeRes,level,sgs,ccpm,Phi,monteCarlo,addUnits,genPractice};
})();
