// Geometry-cached refraction for Chromium's SVG backdrop-filter path. The
// product windows use Taylos's native material instead of this renderer effect.
(() => {
  const NS='http://www.w3.org/2000/svg', cache=new Map(), observed=new WeakSet();
  const svg=document.createElementNS(NS,'svg');
  svg.setAttribute('width','0');svg.setAttribute('height','0');
  svg.style.cssText='position:fixed;pointer-events:none';
  const defs=document.createElementNS(NS,'defs');svg.append(defs);document.body.append(svg);
  function lens(width,height,radius) {
    const w=Math.max(2,Math.round(width)),h=Math.max(2,Math.round(height));
    const r=Math.min(radius,w/2,h/2),key=[w,h,r].join('-');
    if(cache.has(key))return cache.get(key);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d'), map=ctx.createImageData(w,h);
    const rim=Math.min(14,r*.7), strength=Math.min(22,r*1.2);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      // Signed distance and normal of a rounded rectangle. Refraction lives
      // along the rim; the middle stays optically clear, not uniformly blurred.
      const px=x+.5-w/2,py=y+.5-h/2;
      const qx=Math.abs(px)-(w/2-r),qy=Math.abs(py)-(h/2-r);
      const ax=Math.max(qx,0),ay=Math.max(qy,0),len=Math.hypot(ax,ay);
      const d=len+Math.min(Math.max(qx,qy),0)-r;
      const nx=(len?ax/len:qx>qy?1:0)*Math.sign(px);
      const ny=(len?ay/len:qy>=qx?1:0)*Math.sign(py);
      const t=Math.max(0,Math.min(1,-d/rim));
      const bend=d<=0?Math.sin(t*Math.PI)*.47:0;
      const i=(y*w+x)*4;
      map.data[i]=Math.round(128+nx*bend*255);map.data[i+1]=Math.round(128+ny*bend*255);
      map.data[i+2]=128;map.data[i+3]=255;
    }
    ctx.putImageData(map,0,0);
    const id='taylos-lens-'+cache.size, filter=document.createElementNS(NS,'filter');
    for(const [k,v] of Object.entries({id,x:'0',y:'0',width:String(w),height:String(h),filterUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'}))filter.setAttribute(k,v);
    const img=document.createElementNS(NS,'feImage');
    img.setAttribute('href',canvas.toDataURL());img.setAttribute('width',String(w));img.setAttribute('height',String(h));img.setAttribute('result','displacement');
    const bend=document.createElementNS(NS,'feDisplacementMap');
    for(const [k,v] of Object.entries({in:'SourceGraphic',in2:'displacement',scale:String(strength),xChannelSelector:'R',yChannelSelector:'G'}))bend.setAttribute(k,v);
    filter.append(img,bend);defs.append(filter);cache.set(key,id);return id;
  }
  const resize=new ResizeObserver(entries=>entries.forEach(({target})=>{
    const r=target.getBoundingClientRect(),style=getComputedStyle(target);
    if(!r.width||!r.height)return;
    const id=lens(r.width,r.height,parseFloat(style.borderRadius)||18);
    target.style.setProperty('--lens-filter',`url(#${id})`);
    target.dataset.lens=id;
  }));
  function scan(){
    document.querySelectorAll('.phases,.phase-lens,.glass-toggle i,.tabs-lens,.glass-tabs,.apple-window,.restore-overlay').forEach(el=>{
      if(!observed.has(el)){observed.add(el);resize.observe(el);}
    });
  }
  new MutationObserver(scan).observe(document.querySelector('#prototype-root'),{childList:true,subtree:true});scan();
  window.taylosLens={cache, lens};
  // Twist the actual mark rather than regenerating it. Angular velocity rises
  // towards the centre and over time; the silhouette stays front-facing.
  const twist=document.createElementNS(NS,'filter');twist.id='mark-refraction';
  twist.setAttribute('color-interpolation-filters','sRGB');
  const texture=document.createElementNS(NS,'feImage');texture.setAttribute('result','twist');
  const displace=document.createElementNS(NS,'feDisplacementMap');
  for(const [key,value]of Object.entries({in:'SourceGraphic',in2:'twist',xChannelSelector:'R',yChannelSelector:'G',scale:'180'}))displace.setAttribute(key,value);
  twist.append(texture,displace);defs.append(twist);
  let introFrame=0;
  function animateMark(){
    cancelAnimationFrame(introFrame);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const img=document.querySelector('.launch-symbol');if(!img)return;
    const start=performance.now(),size=128,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(size,size);
    const tick=now=>{
      const progress=Math.max(0,Math.min(1,(now-start-2680)/700));
      if(progress>0){
        const angular=(Math.exp(progress*3)-1)*.08;
        for(let y=0;y<size;y++)for(let x=0;x<size;x++){
          const px=(x+.5)/size-.5,py=(y+.5)/size-.5,r=Math.hypot(px,py);
          const a=angular*Math.pow(Math.max(0,1-r*1.65),2);
          const dx=px*Math.cos(a)-py*Math.sin(a)-px,dy=px*Math.sin(a)+py*Math.cos(a)-py;
          const i=(y*size+x)*4;pixels.data[i]=128+dx*200;pixels.data[i+1]=128+dy*200;pixels.data[i+2]=128;pixels.data[i+3]=255;
        }
        ctx.putImageData(pixels,0,0);texture.setAttribute('href',canvas.toDataURL());img.style.filter='url(#mark-refraction)';
      }
      if(progress<1)introFrame=requestAnimationFrame(tick);else img.style.removeProperty('filter');
    };
    introFrame=requestAnimationFrame(tick);
  }
  window.addEventListener('taylos-intro',animateMark);
  if(document.documentElement.dataset.intro==='true')animateMark();
})();
