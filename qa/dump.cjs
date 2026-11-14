const fs=require('fs');
const hex=c=>{const f=v=>Math.round(v*255).toString(16).padStart(2,'0');return '#'+(f(c.r)+f(c.g)+f(c.b)).toUpperCase();};
function walk(n,d,out){
  const ind='  '.repeat(d);
  const fill=n.fills&&n.fills[0]&&n.fills[0].type==='SOLID'?hex(n.fills[0].color):(n.fills&&n.fills.length?'[grad]':'');
  const stroke=n.strokes&&n.strokes[0]&&n.strokes[0].type==='SOLID'?hex(n.strokes[0].color):'';
  let s=`${ind}${n.name} <${n.type}> ${Math.round(n.x)},${Math.round(n.y)} ${Math.round(n.width)}x${Math.round(n.height)}`;
  if(n.cornerRadius)s+=` r${n.cornerRadius}`;
  if(fill)s+=` fill=${fill}`;
  if(stroke)s+=` stroke=${stroke}${n.strokeWeight?('/'+n.strokeWeight):''}`;
  if(n.opacity!==undefined&&n.opacity!==1)s+=` op=${n.opacity}`;
  if(n.type==='TEXT')s+=` "${n.characters}" ${n.fontSize}px ${n.fontName?n.fontName.family+'/'+n.fontName.style:''} ${n.textAlignHorizontal||''}`;
  out.push(s);
  (Array.isArray(n.children)?n.children:[]).forEach(c=>walk(c,d+1,out));
}
for(const f of ['home','tasks','log']){
  const lines=fs.readFileSync(f+'.jsonl','utf8').trim().split('\n');
  const root=JSON.parse(lines[1]);
  const out=[`\n===== ${f} : ${root.name} ${root.width}x${root.height} =====`];
  walk(root,0,out);
  console.log(out.join('\n'));
}
