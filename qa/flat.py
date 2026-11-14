import json, io, sys
path=sys.argv[1]; only=sys.argv[2] if len(sys.argv)>2 else None
root=None
for line in io.open(path,encoding='utf-8'):
    d=json.loads(line)
    if 'children' in d: root=d
def walk(n,ox,oy,depth=0):
    x=ox+n.get('x',0); y=oy+n.get('y',0)
    t=n.get('characters')
    if t and (only is None or only in n.get('name','')+t):
        fn=n.get('fontName',{}) or {}
        lh=n.get('lineHeight',{}) or {}
        print(f"{x:>6.1f} {y:>6.1f} {n.get('width'):>6} {n.get('height'):>5} | {fn.get('family',''):<20}{fn.get('style',''):<10} {n.get('fontSize')} lh={lh.get('value','AUTO')} | {t[:46]!r}")
    elif only is None and n.get('type') in ('RECTANGLE','FRAME') and depth<=3:
        f=(n.get('fills') or [{}])[0]
        c=f.get('color')
        col='' if not c else '#%02X%02X%02X'%(round(c['r']*255),round(c['g']*255),round(c['b']*255))
        print(f"{x:>6.1f} {y:>6.1f} {n.get('width'):>6} {n.get('height'):>5} | BOX r={n.get('cornerRadius')} {col} {n.get('name','')[:24]}")
    for c in n.get('children',[]) or []:
        walk(c,x,y,depth+1)
walk(root,0,0)
