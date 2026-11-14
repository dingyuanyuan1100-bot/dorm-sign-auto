import json, io, sys
path = sys.argv[1]
root = None
for line in io.open(path, encoding='utf-8'):
    d = json.loads(line)
    if isinstance(d, dict) and 'children' in d:
        root = d

def rgba(f):
    if not f: return ''
    if f.get('type') == 'SOLID':
        c = f['color']
        return '#%02X%02X%02X' % (round(c['r']*255), round(c['g']*255), round(c['b']*255))
    if f.get('type') in ('GRADIENT_LINEAR', 'GRADIENT_RADIAL'):
        return 'GRAD:' + ','.join('#%02X%02X%02X' % (round(s['color']['r']*255), round(s['color']['g']*255), round(s['color']['b']*255)) for s in f.get('stops', []))
    return f.get('type','')

def walk(n, ox, oy, depth=0):
    if not isinstance(n, dict): return
    x = ox + n.get('x', 0); y = oy + n.get('y', 0)
    t = n.get('type')
    pad = '  ' * depth
    fills = n.get('fills') or []
    fill = rgba(fills[0]) if fills else ''
    stroke = ''
    if n.get('strokes'):
        stroke = ' stroke=' + rgba(n['strokes'][0]) + ' w=' + str(n['strokes'][0].get('weight', 1))
    r = n.get('cornerRadius')
    rs = f" r={r}" if r else ""
    fx = ''
    if n.get('effects'):
        fx = ' FX[' + ','.join(e.get('type','') for e in n['effects']) + ']'
    if t == 'TEXT':
        fn = n.get('fontName', {})
        lh = n.get('lineHeight', {}) or {}
        ls = n.get('letterSpacing')
        al = n.get('textAlign','')
        print(f"{pad}[{n['id']}] TXT {x:.0f},{y:.0f} {n.get('width')}x{n.get('height')} | {fn.get('family')} {fn.get('style')} {n.get('fontSize')} lh={lh.get('value','AUTO')} ls={ls} al={al} {fill} | {n.get('characters')!r}")
    else:
        print(f"{pad}[{n['id']}] {t} {x:.0f},{y:.0f} {n.get('width')}x{n.get('height')}{rs} {fill}{stroke}{fx} | {n.get('name','')[:34]}")
    for c in n.get('children', []) or []:
        walk(c, x, y, depth+1)

walk(root, 0, 0)
