const fs=require("fs");
const line=fs.readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean).pop();
const root=JSON.parse(line);
const out=[];
function hex(f){
  if(!f||!f.length)return "-";
  const c=f[0].color; if(!c)return f[0].type;
  const h=(v)=>Math.round(v*255).toString(16).padStart(2,"0").toUpperCase();
  return "#"+h(c.r)+h(c.g)+h(c.b)+(f[0].opacity!=null&&f[0].opacity<1?"*"+f[0].opacity:"");
}
function walk(n,ox,oy,depth){
  const x=ox+(typeof n.x==="number"?n.x:0);
  const y=oy+(typeof n.y==="number"?n.y:0);
  const w=n.width,h=n.height;
  let s=`${"  ".repeat(depth)}[${n.id}] ${n.type} ${n.name||""} @${x.toFixed(1)},${y.toFixed(1)} ${typeof w==="number"?w.toFixed(1):w}x${typeof h==="number"?h.toFixed(1):h}`;
  if(n.cornerRadius)s+=` r${n.cornerRadius}`;
  s+=` ${hex(n.fills)}`;
  if(n.strokes&&n.strokes.length)s+=` stroke:${hex(n.strokes)}/${n.strokeWeight}`;
  if(n.fontSize)s+=` ${n.fontSize}px ${n.fontName?n.fontName.family+" "+n.fontName.style:""}`;
  if(n.characters!=null)s+=` "${n.characters}"`;
  if(n.textAlignHorizontal)s+=` ${n.textAlignHorizontal}`;
  if(n.opacity!=null&&n.opacity<1)s+=` op${n.opacity}`;
  if(n.visible===false)s+=` HIDDEN`;
  out.push(s);
  if (Array.isArray(n.children)) n.children.forEach(c=>walk(c,x,y,depth+1));
}
walk(root,0,0,0);
console.log(out.join("\n"));
