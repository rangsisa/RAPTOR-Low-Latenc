const F0=20,F1=20000,MA=[20,40,80,100,200,300,400,500,600,700,800,900,1000,2000,3000,4000,5000,6000,7000,8000,9000,10000,15000],MI=[];
const S={phase:1,mag:1,wrap:0,sync:1,v0:F0,v1:F1,cursor:null,owner:null,band:null};const G=[];const lg=x=>Math.log(x)/Math.LN10;
const MOTION={
  amp:0,
  phase:0,
  raf:0,
  last:0,
  reduce:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false
};
function displayWobble(f,isPhase){
  if(MOTION.amp<=0) return 0;
  const t=lg(f/F0);
  if(isPhase){
    return MOTION.amp*(2.0*Math.sin(t*11.5+MOTION.phase)+.72*Math.sin(t*23.2-MOTION.phase*.55));
  }
  return MOTION.amp*(.105*Math.sin(t*10.8+MOTION.phase)+.04*Math.sin(t*21.6-MOTION.phase*.6));
}
function triggerDisplayMotion(strength=.7){
  if(MOTION.reduce) return;
  MOTION.amp=Math.max(MOTION.amp,Math.max(0,Math.min(1,strength)));
  if(MOTION.raf) return;
  MOTION.last=performance.now();
  const tick=now=>{
    const dt=Math.min(34,Math.max(8,now-MOTION.last));
    MOTION.last=now;
    MOTION.phase+=dt*.0115;
    MOTION.amp*=Math.pow(.90,dt/16.67);
    if(MOTION.amp<.025) MOTION.amp=0;
    all();
    if(MOTION.amp>0){
      MOTION.raf=requestAnimationFrame(tick);
    }else{
      MOTION.raf=0;
      all();
    }
  };
  MOTION.raf=requestAnimationFrame(tick);
}
function xf(f,L,R){let a=lg(S.v0),b=lg(S.v1);return L+(lg(f)-a)/(b-a)*(R-L)}function fx(x,L,R){let a=lg(S.v0),b=lg(S.v1);return 10**(a+(x-L)/(R-L)*(b-a))}
function ff(f){if(f>=1000){let k=f/1000;return(k<10?k.toFixed(2):k.toFixed(1)).replace(/\.?0+$/,'')+' kHz'}return(f<100?f.toFixed(1):f.toFixed(0)).replace(/\.0$/,'')+' Hz'}
function pu(f){let x=lg(f/20);return 205-133*x-53*Math.sin(x*2.15)-22*Math.sin(x*5.9)}function wp(v){return((v+180)%360+360)%360-180}function ph(f){return wp(pu(f))}function mg(f){let x=lg(f);return 3.1*Math.exp(-Math.pow((x-lg(92))/.19,2))-5*Math.exp(-Math.pow((x-lg(315))/.13,2))+1.9*Math.exp(-Math.pow((x-lg(1250))/.25,2))-3.3*Math.exp(-Math.pow((x-lg(7600))/.18,2))+.65*Math.sin((x-1.2)*18)+.28*Math.sin((x-1.1)*36)}
function wraps(){let o=[],pf=F0,pv=pu(pf),pb=Math.floor((pv+180)/360);for(let i=1;i<=7000;i++){let f=F0*(F1/F0)**(i/7000),v=pu(f),b=Math.floor((v+180)/360);if(b!==pb){let bd=b<pb?pb*360-180:b*360-180,t=(bd-pv)/(v-pv),cf=Math.exp(Math.log(pf)+(Math.log(f)-Math.log(pf))*Math.max(0,Math.min(1,t)));o.push({f:cf,d:v<pv?'down':'up'})}pf=f;pv=v;pb=b}return o}const WR=wraps();
function all(){G.forEach(g=>g.draw())}function setC(f,o){S.cursor=Math.max(S.v0,Math.min(S.v1,f));S.owner=o;all()}function clr(o){if(S.owner===o){S.cursor=null;S.owner=null;all()}}function fitAll(){S.v0=F0;S.v1=F1;all()}
function graph(c,b,p,r,k){const x=c.getContext('2d'),isP=k==='phase',ymin=isP?-180:-40,ymax=isP?180:40,MY=isP?[-180,-90,0,90,180]:[-40,-20,0,20,40],mY=isP?[-135,-45,45,135]:[-30,-10,10,30];let drag=0,mode=null,sx=0,sv0=0,sv1=0,bs=null;const val=f=>isP?ph(f):mg(f),enabled=()=>isP?S.phase:S.mag,yp=(v,T,B)=>B-(v-ymin)/(ymax-ymin)*(B-T),dims=()=>({L:5,R:c.clientWidth-5,T:5,B:c.clientHeight-5});
const head=c.closest('.matching-card')?.querySelector('.matching-head');let mouseReadout=head?.querySelector('.matching-pointer-readout');if(head&&!mouseReadout){mouseReadout=document.createElement('div');mouseReadout.className='matching-pointer-readout';r.insertAdjacentElement('afterend',mouseReadout)}const resetMouseReadout=()=>{if(mouseReadout)mouseReadout.textContent=isP?'— Hz · —°':'— Hz · — dB'};const showMouseReadout=e=>{if(!mouseReadout)return;let q=c.getBoundingClientRect(),{L,R,T,B}=dims(),xx=Math.max(L,Math.min(R,e.clientX-q.left)),yy=Math.max(T,Math.min(B,e.clientY-q.top)),f=fx(xx,L,R),ratio=Math.max(0,Math.min(1,(yy-T)/Math.max(1,B-T))),v=ymax-ratio*(ymax-ymin);mouseReadout.textContent=isP?ff(f)+' · '+v.toFixed(1)+'°':ff(f)+' · '+v.toFixed(2)+' dB'};resetMouseReadout();
function draw(){let d=Math.max(1,devicePixelRatio||1),w=c.clientWidth,h=c.clientHeight;c.width=Math.max(1,Math.round(w*d));c.height=Math.max(1,Math.round(h*d));x.setTransform(d,0,0,d,0,0);x.clearRect(0,0,w,h);let {L,R,T,B}=dims(),y0=yp(0,T,B);x.fillStyle='#fff';x.fillRect(0,0,w,h);
if(S.band){let a=Math.max(S.v0,Math.min(...S.band)),z=Math.min(S.v1,Math.max(...S.band));if(z>a){let xa=xf(a,L,R),xb=xf(z,L,R);x.fillStyle='rgba(232,111,23,.105)';x.fillRect(xa,T,xb-xa,B-T);x.strokeStyle='rgba(211,91,12,.72)';x.beginPath();x.moveTo(xa,T);x.lineTo(xa,B);x.moveTo(xb,T);x.lineTo(xb,B);x.stroke()}}
mY.forEach(v=>{let yy=yp(v,T,B);x.strokeStyle='#dbe5ec';x.beginPath();x.moveTo(L,yy+.5);x.lineTo(R,yy+.5);x.stroke()});MY.forEach(v=>{let yy=yp(v,T,B);x.strokeStyle='#b8c8d3';x.beginPath();x.moveTo(L,yy+.5);x.lineTo(R,yy+.5);x.stroke()});MI.filter(f=>f>=S.v0&&f<=S.v1).forEach(f=>{let xx=xf(f,L,R);x.strokeStyle='#e3e5e7';x.lineWidth=.6;x.beginPath();x.moveTo(xx+.5,T);x.lineTo(xx+.5,B);x.stroke()});MA.filter(f=>f>=S.v0&&f<=S.v1).forEach(f=>{let xx=xf(f,L,R);x.strokeStyle='#d1d5d8';x.lineWidth=.7;x.beginPath();x.moveTo(xx+.5,T);x.lineTo(xx+.5,B);x.stroke()});x.strokeStyle='#929faa';x.lineWidth=1.15;x.strokeRect(L+.5,T+.5,R-L-1,B-T-1);
x.font='8.5px Inter,system-ui';x.fillStyle='#56636f';x.textAlign='left';x.textBaseline='middle';MY.forEach(v=>x.fillText(isP?v+'°':v,L+5,yp(v,T,B)));x.font='7.5px Inter,system-ui';x.textAlign='center';x.textBaseline='bottom';MA.filter(f=>f>=S.v0&&f<=S.v1).forEach(f=>x.fillText(f>=1000?(f/1000)+'k':String(f),xf(f,L,R),B-4));x.strokeStyle='#7e8b97';x.lineWidth=1;x.beginPath();x.moveTo(L,y0+.5);x.lineTo(R,y0+.5);x.stroke();
if(isP&&S.wrap){x.save();x.strokeStyle='#82909b';x.lineWidth=.95;x.setLineDash([4,4]);WR.filter(q=>q.f>=S.v0&&q.f<=S.v1).forEach(q=>{let xx=xf(q.f,L,R);x.beginPath();x.moveTo(xx,T);x.lineTo(xx,B);x.stroke();x.setLineDash([]);x.fillStyle='#687580';x.font='8.5px Inter,system-ui';x.textAlign='center';x.textBaseline='top';x.fillText(q.d==='down'?'↓':'↑',xx,T+2);x.setLineDash([4,4])});x.restore()}
if(enabled()){let N=Math.max(700,Math.floor(R-L)*2);if(!isP){x.beginPath();let firstX=null,lastX=null;for(let i=0;i<=N;i++){let f=S.v0*(S.v1/S.v0)**(i/N),xx=xf(f,L,R),yy=yp(val(f)+displayWobble(f,isP),T,B);if(i===0){x.moveTo(xx,yy);firstX=xx}else x.lineTo(xx,yy);lastX=xx}if(firstX!==null&&lastX!==null){x.lineTo(lastX,B);x.lineTo(firstX,B);x.closePath();x.fillStyle='rgba(232,111,23,.12)';x.fill()}}x.strokeStyle=isP?'#1686d9':'#e86f17';x.lineWidth=1.55;x.lineJoin='round';x.lineCap='round';if(isP){let pv=null,px=null;x.beginPath();for(let i=0;i<=N;i++){let f=S.v0*(S.v1/S.v0)**(i/N),v=val(f),dv=v+displayWobble(f,isP),xx=xf(f,L,R),yy=yp(dv,T,B);if(pv===null){x.moveTo(xx,yy);pv=v;px=xx;continue}let delta=v-pv;if(Math.abs(delta)>180){let adjusted=v,boundary=180,opposite=-180;if(delta>180){adjusted=v-360;boundary=-180;opposite=180}else{adjusted=v+360;boundary=180;opposite=-180}let den=adjusted-pv,t=den===0?0:(boundary-pv)/den;t=Math.max(0,Math.min(1,t));let xc=px+(xx-px)*t;x.lineTo(xc,yp(boundary,T,B));x.stroke();x.beginPath();x.moveTo(xc,yp(opposite,T,B));x.lineTo(xx,yy)}else{x.lineTo(xx,yy)}pv=v;px=xx}x.stroke()}else{x.beginPath();for(let i=0;i<=N;i++){let f=S.v0*(S.v1/S.v0)**(i/N),xx=xf(f,L,R),yy=yp(val(f)+displayWobble(f,isP),T,B);i?x.lineTo(xx,yy):x.moveTo(xx,yy)}x.stroke()}}
let sc=S.cursor!==null&&(S.sync||S.owner===k);if(sc&&S.cursor>=S.v0&&S.cursor<=S.v1){let f=S.cursor,xx=xf(f,L,R),v=val(f),yy=yp(v,T,B);x.save();x.strokeStyle='#53616d';x.setLineDash([3,3]);x.beginPath();x.moveTo(xx,T);x.lineTo(xx,B);x.stroke();x.beginPath();x.moveTo(L,yy);x.lineTo(R,yy);x.stroke();x.restore();x.fillStyle=isP?'#1686d9':'#e86f17';x.beginPath();x.arc(xx,yy,2.8,0,Math.PI*2);x.fill();r.textContent=isP?ff(f)+' · '+v.toFixed(1)+'°':ff(f)+' · '+v.toFixed(2)+' dB';if(S.owner===k){b.style.display='block';b.innerHTML='<b>'+ff(f)+'</b><br>'+(isP?'Phase '+v.toFixed(1)+'°':'Magnitude '+v.toFixed(2)+' dB');let bw=b.offsetWidth||118,bh=b.offsetHeight||32,bx=xx+10,by=yy+10;if(bx+bw>w-5)bx=xx-bw-10;if(by+bh>h-5)by=yy-bh-10;b.style.left=Math.max(4,bx)+'px';b.style.top=Math.max(4,by)+'px'}else b.style.display='none'}else{b.style.display='none';r.textContent=isP?'— Hz · —°':'— Hz · — dB'}
if(S.band){let a=Math.min(...S.band),z=Math.max(...S.band);if(z>a){p.style.display='block';p.textContent='BAND '+ff(a)+' → '+ff(z)+' · '+(Math.log(z/a)/Math.LN2).toFixed(3)+' oct'}else p.style.display='none'}else if(mode==='pan'){p.style.display='block';p.textContent='PAN '+ff(S.v0)+' → '+ff(S.v1)}else p.style.display='none'}
c.addEventListener('pointermove',e=>{showMouseReadout(e);let q=c.getBoundingClientRect(),{L,R}=dims(),xx=e.clientX-q.left;if(drag&&mode==='pan'){let span=Math.log(sv1/sv0),shift=-(xx-sx)/(R-L)*span,mn=sv0*Math.exp(shift),mx=sv1*Math.exp(shift),ratio=mx/mn;if(mn<F0){mn=F0;mx=mn*ratio}if(mx>F1){mx=F1;mn=mx/ratio}S.v0=mn;S.v1=mx;all();return}let f=fx(Math.max(L,Math.min(R,xx)),L,R);if(drag&&mode==='band'){S.band=[bs,f];setC(f,k);return}setC(f,k)});c.addEventListener('pointerdown',e=>{let q=c.getBoundingClientRect(),{L,R}=dims(),xx=e.clientX-q.left;drag=1;sx=xx;sv0=S.v0;sv1=S.v1;if(e.shiftKey){mode='pan';c.style.cursor='grabbing'}else if(e.altKey){mode='band';bs=fx(Math.max(L,Math.min(R,xx)),L,R);S.band=[bs,bs]}else mode='probe';c.setPointerCapture(e.pointerId);draw()});c.addEventListener('pointerup',e=>{drag=0;mode=null;c.style.cursor='crosshair';if(c.hasPointerCapture(e.pointerId))c.releasePointerCapture(e.pointerId);all()});c.addEventListener('pointerleave',()=>{resetMouseReadout();if(!drag)clr(k)});c.addEventListener('dblclick',fitAll);new ResizeObserver(draw).observe(c);let api={draw};G.push(api);return api}
graph(phase,pb,pp,pr,'phase');graph(mag,mb,mp,mr,'mag');tp.onchange=e=>{S.phase=e.target.checked;all()};tm.onchange=e=>{S.mag=e.target.checked;all()};tw.onchange=e=>{S.wrap=e.target.checked;all()};ts.onchange=e=>{S.sync=e.target.checked;all()};if(fit)fit.onclick=fitAll;if(cb)cb.onclick=()=>{S.band=null;all()};

const matchingPage=phase?.closest('.matching-page')||document.querySelector('.page-view--matching .matching-page');
const matchingView=document.querySelector('.page-view--matching');
let scrollMotionTimer=0;
function onMatchingScroll(){
  triggerDisplayMotion(.48);
  clearTimeout(scrollMotionTimer);
  scrollMotionTimer=setTimeout(()=>triggerDisplayMotion(.28),90);
}
matchingPage?.addEventListener('scroll',onMatchingScroll,{passive:true});
matchingView?.addEventListener('scroll',onMatchingScroll,{passive:true});
window.addEventListener('scroll',()=>{
  if(!matchingView||!matchingView.hidden) onMatchingScroll();
},{passive:true});

if(matchingView){
  new MutationObserver(()=>{
    if(!matchingView.hidden) triggerDisplayMotion(.95);
  }).observe(matchingView,{attributes:true,attributeFilter:['hidden']});
}
requestAnimationFrame(()=>triggerDisplayMotion(.9));
