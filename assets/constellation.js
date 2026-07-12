/* Shared full-page service constellation background (homelab-related pages).
   Same nodes/edges as the homepage hero stage, drawn on a fixed viewport canvas. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cv = document.getElementById('page-constellation');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const NODES = [
    {x:.50,y:.50,r:5,label:'N5HQ',hub:true},
    {x:.16,y:.30,r:3,label:'UniFi'},   {x:.30,y:.16,r:3,label:'Docker'},
    {x:.52,y:.12,r:3,label:'Grafana'}, {x:.72,y:.18,r:3,label:'Immich'},
    {x:.86,y:.34,r:3,label:'Home Assistant'},
    {x:.88,y:.62,r:3,label:'Prometheus'}, {x:.74,y:.82,r:3,label:'Loki'},
    {x:.50,y:.88,r:3,label:'Uptime Kuma'}, {x:.26,y:.82,r:3,label:'Tailscale'},
    {x:.12,y:.62,r:3,label:'Nginx'}
  ];
  const EDGES = NODES.slice(1).map((_,i)=>[0,i+1]).concat([[1,2],[3,4],[5,6],[7,8],[9,10]]);
  let W,H,DPR,t0=performance.now();
  const fit = () => {
    DPR = Math.min(devicePixelRatio||1,2);
    W = innerWidth; H = innerHeight;
    cv.width = W*DPR; cv.height = H*DPR;
    ctx.setTransform(DPR,0,0,DPR,0,0);
  };
  fit(); addEventListener('resize', fit);
  const P = n => ({x:n.x*W, y:n.y*H});
  const draw = now => {
    const t = (now-t0)/1000;
    ctx.clearRect(0,0,W,H);
    ctx.font = '10px ui-monospace,Menlo,monospace';
    EDGES.forEach(([a,b],i) => {
      const A=P(NODES[a]), B=P(NODES[b]);
      ctx.strokeStyle='rgba(255,255,255,.06)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke();
      const ph=(t*.14+i*.19)%1;
      const px=A.x+(B.x-A.x)*ph, py=A.y+(B.y-A.y)*ph;
      ctx.fillStyle='rgba(154,120,255,.7)';
      ctx.beginPath(); ctx.arc(px,py,1.4,0,7); ctx.fill();
    });
    NODES.forEach((n,i) => {
      const p=P(n), bob=reduce?0:Math.sin(t*.7+i*1.7)*2;
      const g=ctx.createRadialGradient(p.x,p.y+bob,0,p.x,p.y+bob,n.r*4.5);
      g.addColorStop(0,n.hub?'rgba(154,120,255,.85)':'rgba(120,220,160,.55)');
      g.addColorStop(1,'transparent');
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(p.x,p.y+bob,n.r*4.5,0,7); ctx.fill();
      ctx.fillStyle=n.hub?'#cbbdf2':'#9fe8bc';
      ctx.beginPath(); ctx.arc(p.x,p.y+bob,n.r,0,7); ctx.fill();
      ctx.fillStyle='rgba(139,137,150,.75)';
      ctx.textAlign = p.x>W*.66?'right':(p.x<W*.33?'left':'center');
      ctx.fillText(n.label, p.x, p.y+bob-n.r-7);
    });
    if (!reduce && !document.hidden) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden && !reduce){ t0=performance.now()-2000; requestAnimationFrame(draw); }
  });
})();
