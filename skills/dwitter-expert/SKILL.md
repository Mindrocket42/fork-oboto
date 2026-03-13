---
name: dwitter-expert
description: Expert knowledge for creating, analyzing, and optimizing Dwitter (dwitter.net) visual JavaScript demos in 140 characters
tags: [javascript, creative-coding, code-golf, canvas, demoscene]
---

# Dwitter Expert Skill

## What is Dwitter?
A social platform for creating visual JavaScript demos in **140 characters or fewer**.
- Canvas: 1920×1080 HTML5 canvas
- Function: `u(t)` called every frame at 60fps
- `t` = elapsed time in seconds
- Built-in shortcuts: `c` (canvas), `x` (2D context), `S` (Math.sin), `C` (Math.cos), `T` (Math.tan), `R(r,g,b,a)` (rgba color helper)
- `frame` variable available (integer frame count)

## Dwitter API (No Auth Required)
```
GET https://www.dwitter.net/api/dweets/?limit=100    # list dweets (max 100 per page)
    &offset=200                                       # pagination
    &author=username                                  # filter by author
    &remix_of=123                                     # remixes of dweet 123
GET https://www.dwitter.net/api/dweets/123            # single dweet
GET https://www.dwitter.net/api/users/username         # user info
```
Response: `{count, next, previous, results: [{id, code, posted, author:{username}, link, awesome_count, remix_of}]}`
Total dweets: ~25,457. Use for studying patterns, finding inspiration, analyzing techniques.

## Top Authors
- **KilledByAPixel** (1,480 dweets) — Master of Unicode packing, 3D effects, creative concepts
- **cantelope** (260 dweets) — 3D math expert, clearRect techniques, highest-rated readable dweets
- **lionleaf** (59 dweets) — Platform creator, clean readable code

## Highest-Rated Readable Dweet Patterns (by awesome_count)

### 1. 3D Torus (37 awesome) — cantelope d/24332
```js
for(x.fillRect(0,0,w=2e3,w),h=i=540;i--;)x.clearRect(960+(S(p=i/35+S(t/2)*60)*S(q=(i/57|0)*h))/(Z=C(p)*S(q)+2+S(t))*h,h+C(q)/Z*h,s=20/Z,s)
```

### 2. Rotating Spiral (25 awesome) — lionleaf d/8651
```js
c.width|=0
with(x)for(translate(900,500),i=9*t;i-->0;fill())fillStyle='hsl('+9*i+',99%,50%)',fillRect(5*i,0,a=40*S(i*.9)+60,a),rotate(-3.88)
```

### 3. Zooming Squares (23 awesome) — lionleaf d/18570
```js
c.width=2e3;x.lineWidth=9;for(i=0;s=300,a=s/(s-(t+i*s/400)%s),i<400;i++){x.strokeRect(999-a*(1+S(t))/2,500-a*(1+C(t*2))/2,a,a)}
```

### 4. Starfield Tunnel (24 awesome) — cantelope d/28251
```js
for(x.fillRect(0,0,i=c.width|=h=540,i*=9);i--;x.clearRect(960+(i**.9%1-.5)*S(t/2)*l/Z*h,h+(i**2.1%1-.5)*l/Z*h,s=l/Z,s))Z=(l=99)-(i+t*30)%98
```

### 5. Rotating 3D Sphere (22 awesome) — KilledByAPixel d/34411
```js
for(r=500,i=1e4;i--;x.fillRect(960+r*X,540+r*Y,9,9))Z=i**.9%1,W=1-Z*Z,X=W*S(a=i*t),Y=W*C(a),x.fillStyle=R(v=(S(t)*Z-C(t)*X-Y/2)*400,v/2,30)
```

### 6. Scrolling Cityscape (22 awesome) — KilledByAPixel d/34603
```js
for(c.width=A=99;A;R+=.1)(t+R*A/50-R^R)%5||x.fillRect(A--,28-22/R,R/5,44/R,R=1)
```

### 7. Piano Keys (19 awesome) — KilledByAPixel d/34900
```js
c.width|=w=99
for(i=13;i--;)for(j=12;j--;)x.fillRect(i&&(2*i-4+j%2+(j%4<3?j%4:1)*t/3%2)*w,j*w,i?w:3e3,i?w:5)
```

### 8. XOR Pattern (19 awesome) — KilledByAPixel d/34900 style
```js
c.width|=0;for(i=240*135;i--;){X=i%240,Y=i/240|0
v=((X^Y)+~~(t*9))%128
x.fillStyle=`hsl(${X*2+t*60} 99%${30+v/2}%)`;x.fillRect(X*8,Y*8,8,8)}
```

### 9. Optical Illusion Rectangles (18 awesome) — KilledByAPixel d/33896
```js
for(c.width|=i=9;i--;)
x.rect(400+i*50+S(t)*300,400+S(i/2+t*9)*99*S(t)**9,450,200)
x.fill`evenodd`
```

### 10. Lissajous Curves (11 awesome) — KilledByAPixel d/34168
```js
for(c.width|=j=16;j--;)for(i=500;i--;)x.fillRect(293+j%4*450+99*C(i*(j/3+1|0)+t/3)*S(i+t),160+(j>>2)*250+99*C(i*(j%3+1)+t/5)*C(i+t/2),9,9)
```

## Critical Code Golf Techniques

### Character Saving (most impactful)
- `c.width|=0` clears canvas (instead of clearRect) — 12 chars saved
- `for(i=N;i--;)` reverse loop — saves `i=0;i<N;i++`
- Comma operator in for: `for(;cond;a++,b++)` — avoids semicolons
- `|0` instead of `Math.floor()` — 12 chars saved
- `~~v` double bitwise NOT = floor — 2 chars vs Math.floor
- `1e3` = 1000, `2e3` = 2000, `1e4` = 10000
- `with(x)` drops `x.` prefix on all canvas calls
- Template literals: `` `hsl(${v} 99%50%)` `` — no concatenation needed
- Arrow in fillRect args: `x.fillRect(x,y,w,h)` — abuse extra args ignored
- `x.fillStyle=R(r,g,b,a)` — built-in rgba helper

### Powerful Patterns
- **Particle system**: `for(i=N;i--;x.fillRect(expr,expr,s,s))` — draw in loop update
- **3D perspective**: `screenX = 960 + X/Z * 540` (center + world/depth * halfHeight)
- **Pseudo-random**: `i**.9%1` or `i**3.1%66` — deterministic random from index
- **Color cycling**: `` `hsl(${i*t} 99%${i}%)` `` — time-based hue, index-based lightness
- **Motion blur**: Don't clear canvas, use `x.fillRect(0,0,2e3,2e3)` with alpha: `R(0,0,0,.1)`
- **White-on-black 3D**: `fillRect` black, then `clearRect` to carve out shapes
- **Rotate + translate**: `with(x)` + `translate(960,540)` + `rotate(angle)` for kaleidoscopes
- **Torus math**: `p=azimuth, q=cross; X=S(p)*S(q), Y=C(q), Z=C(p)*S(q)+offset`
- **Sphere points**: `Z=i/N*2-1, r=sqrt(1-Z*Z), X=r*C(a), Y=r*S(a)`
- **Wave**: `S(i/freq + t*speed) * amplitude`
- **fillRect in loop condition**: `for(;cond;x.fillRect(...))` — saves a line

### Advanced Compression
- **Unicode packing** (KilledByAPixel's technique): `eval(unescape(escape\`...\`.replace(/u../g,'')))`
  - Packs 2 ASCII chars per Unicode char, effectively doubling capacity to ~280 chars
  - Used by top authors for complex demos that exceed 140 readable chars
- **charCodeAt bitmap**: Encode pixel data in string characters
- **Reuse variables**: `a=b=c=0` chained assignment
- **Abuse function args**: Extra args to fillRect are silently ignored — put side effects there

## Creating Outstanding Dweets — Strategy

1. **Pick a strong visual concept**: 3D shapes, particle effects, optical illusions, or recognizable objects
2. **Start with a working version** (even if over 140 chars)
3. **Golf ruthlessly**: Apply every char-saving trick above
4. **Optimize the math**: Find elegant formulas that produce complex visuals
5. **Test timing**: Use `t` creatively — `S(t)`, `t%period`, `t*speed`
6. **Color matters**: HSL with time-modulated hue creates instant visual appeal
7. **The best dweets find one elegant mathematical relationship** that produces unexpected complexity

## Quality Checklist
- [ ] Under 140 characters (count carefully, \r\n = 2 chars on dwitter)
- [ ] Visually interesting and animated
- [ ] Smooth animation (no flicker unless intentional)
- [ ] Works at 60fps without lag
- [ ] Uses canvas center (960, 540) as reference point
- [ ] Has color variation or interesting contrast
