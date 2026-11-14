const fs=require('fs');
const {decode,encodeRGB}=require('./img.cjs');
const names=['login','home','tasks','locations','logs','me'];
const S=0.5;
// 尺寸从第一张图读，兼容 780x1688 / 824x1830
const probe=decode(`qa/app/login.png`);
const W=Math.round(probe.w*S), H=Math.round(probe.h*S), GAP=12, PAD=12;
const COLS=3, ROWS=2;
const OW=PAD*2+COLS*W+(COLS-1)*GAP, OH=PAD*2+ROWS*H+(ROWS-1)*GAP;
const out=Buffer.alloc(OW*OH*3,232);
const put=(x,y,c)=>{if(x<0||y<0||x>=OW||y>=OH)return;const d=(y*OW+x)*3;out[d]=c[0];out[d+1]=c[1];out[d+2]=c[2];};
names.forEach((n,i)=>{
  const img=decode(`qa/app/${n}.png`);
  const cx=PAD+(i%COLS)*(W+GAP), cy=PAD+Math.floor(i/COLS)*(H+GAP);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    // 2x2 平均降采样
    const sx=x*2, sy=y*2;
    let r=0,g=0,b=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const c=img.rgb(Math.min(img.w-1,sx+dx),Math.min(img.h-1,sy+dy));r+=c[0];g+=c[1];b+=c[2];}
    put(cx+x,cy+y,[r/4,g/4,b/4]);
  }
});
fs.writeFileSync('qa/overview.png',encodeRGB(OW,OH,out));
console.log(`overview ${OW}x${OH}`);
