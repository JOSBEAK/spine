// A paper page turn. The sheet folds along a line, the way paper does when you lift its corner:
//   - the part still lying flat stays put (clipped at the fold),
//   - the lifted part shows the sheet's other side, reflected across the fold,
//   - the fold casts a shadow on the page underneath, and the lifted flap catches the light.
// Everything is 2D geometry on two copies of the page, so it stays smooth even for long chapters.
//
// Coordinates are the spread's own pixels. The sheet's hinge (the spine) is the vertical line x = xs,
// and the sheet lies on side s (+1: to the right of the spine, -1: to the left).
// The corner C = (xs + s*W, y0) is the one being lifted (y0 = 0 for the top corner, H for the bottom).
// Moving the corner to P folds the sheet along the perpendicular bisector of C and P.

const dot = (a, b) => a.x * b.x + a.y * b.y;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Clip a convex polygon to the half-plane f(p) >= 0, where f is affine. */
function clipPoly(pts, f) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
}
const polyCSS = pts => (pts.length < 3 ? 'polygon(0 0,0 0,0 0)' : `polygon(${pts.map(p => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(',')})`);
const rect = (W, H) => [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];

/**
 * host: the spread element. o: { W, H, xs, s, y0, front, fl, back, bl, single }
 *   front/back: page HTML; fl/bl: x of the front page at rest, and of the back page once turned.
 */
export function makeCurl(host, o) {
  const { W, H, xs, s } = o;
  let y0 = o.y0;
  const el = document.createElement('div');
  el.className = 'curl';
  const ul = s > 0 ? xs : xs - W; // where the turning sheet lies, which is also the page it uncovers
  el.innerHTML = `<div class="curl-cast" style="left:${ul}px;width:${W}px"><i></i></div>
    <div class="curl-front" style="left:${o.fl}px">${o.front}<i class="curl-crease"></i></div>
    <div class="curl-flap"><div class="curl-back">${o.back}</div><div class="curl-light"><i></i></div></div>`;
  host.appendChild(el);
  const front = el.querySelector('.curl-front'), crease = el.querySelector('.curl-crease');
  const flap = el.querySelector('.curl-flap'), back = el.querySelector('.curl-back');
  const light = el.querySelector('.curl-light'), lightBar = light.firstElementChild;
  const cast = el.querySelector('.curl-cast'), castBar = cast.firstElementChild;
  const L = 3 * Math.hypot(W, H);
  // a long thin bar laid along the fold line; its gradient runs away from the fold in direction `ang`
  const bar = (node, M, ang, width, ox = 0) => {
    const st = node.style;
    st.left = `${(M.x - ox).toFixed(2)}px`; st.top = `${(M.y - L / 2).toFixed(2)}px`;
    st.width = `${width.toFixed(1)}px`; st.height = `${L}px`; st.transform = `rotate(${ang}rad)`;
  };

  const api = {
    el, P: null,
    get C() { return { x: xs + s * W, y: y0 }; },
    get E() { return { x: xs - s * W, y: y0 }; },
    setCorner(y) { y0 = y; },
    /** A corner can't leave the sheet: it stays within reach of both ends of the spine. */
    constrain(P) {
      const a = { x: xs, y: y0 }, b = { x: xs, y: H - y0 }, D = Math.hypot(W, H);
      let q = { ...P };
      let d = Math.hypot(q.x - a.x, q.y - a.y);
      if (d > W) q = { x: a.x + (q.x - a.x) * W / d, y: a.y + (q.y - a.y) * W / d };
      d = Math.hypot(q.x - b.x, q.y - b.y);
      if (d > D) q = { x: b.x + (q.x - b.x) * D / d, y: b.y + (q.y - b.y) * D / d };
      return q;
    },
    /** 0 while the sheet lies flat, 1 once it has turned all the way over. */
    progress(P = api.P) { return clamp((s * (api.C.x - P.x)) / (2 * W), 0, 1); },
    set(P) {
      P = api.constrain(P);
      api.P = P;
      const C = api.C;
      const d = { x: P.x - C.x, y: P.y - C.y }, len = Math.hypot(d.x, d.y);
      if (len < 0.75) { front.style.clipPath = 'none'; flap.style.visibility = cast.style.visibility = 'hidden'; crease.style.opacity = 0; return; }
      flap.style.visibility = cast.style.visibility = '';
      const n = { x: d.x / len, y: d.y / len }, M = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
      const side = p => (p.x - M.x) * n.x + (p.y - M.y) * n.y; // > 0: still lying flat; < 0: lifted

      // the part still lying flat (front page coordinates)
      front.style.clipPath = polyCSS(clipPoly(rect(W, H), v => side({ x: v.x + o.fl, y: v.y })));

      // the lifted flap: the back page, mirrored across the spine and then across the fold
      const k = 2 * dot(M, n);
      const A = [[1 - 2 * n.x * n.x, -2 * n.x * n.y], [-2 * n.x * n.y, 1 - 2 * n.y * n.y]];
      const tx = 2 * xs - o.bl;
      const m = { a: -A[0][0], b: -A[1][0], c: A[0][1], d: A[1][1], e: A[0][0] * tx + k * n.x, f: A[1][0] * tx + k * n.y };
      back.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
      const toSheet = u => ({ x: tx - u.x, y: u.y });
      const local = clipPoly(rect(W, H), u => -side(toSheet(u)));
      back.style.clipPath = polyCSS(local);
      const world = local.map(u => ({ x: m.a * u.x + m.c * u.y + m.e, y: m.b * u.x + m.d * u.y + m.f }));
      light.style.clipPath = polyCSS(world);

      const t = api.progress(P), lift = Math.sin(Math.PI * t);
      const ang = Math.atan2(n.y, n.x);
      // light and shade across the flap: a dark crease at the fold, a soft sheen, then the flat far edge
      const fw = Math.max(30, len / 2);
      bar(lightBar, M, ang, fw, 0);
      lightBar.style.opacity = 0.55 + 0.45 * Math.min(1, len / (W * 0.4));
      // a faint crease on the part that's still flat, right where the paper starts to bend
      bar(crease, M, ang, Math.min(60, 12 + len * 0.12), o.fl);
      crease.style.opacity = Math.min(1, len / 40) * (1 - t * 0.6);
      // the shadow the lifted flap throws on the page underneath
      bar(castBar, M, ang + Math.PI, Math.min(110, 24 + len * 0.35), ul);
      castBar.style.opacity = Math.min(1, len / 30) * (0.5 + 0.5 * lift);
      // a single page has nothing to land on: it fades as it passes the spine
      flap.style.opacity = o.single ? 1 - clamp((t - 0.7) / 0.3, 0, 1) : 1;
      flap.style.setProperty('--lift', lift.toFixed(3));
    },
    /** Glide the corner to `to`, along an arc that lifts the paper as it travels. */
    go(to, { ms, ease = easeInOut } = {}) {
      const from = api.P || api.C;
      const span = Math.abs(to.x - from.x) / (2 * W);
      const dur = ms ?? 240 + 580 * span;
      const up = y0 > H / 2 ? -1 : 1;
      const arc = W * 0.36 * span;
      return new Promise(res => {
        const t0 = performance.now();
        const step = now => {
          if (!el.isConnected) return res(false);
          const e = ease(clamp((now - t0) / dur, 0, 1));
          api.set({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e + up * arc * Math.sin(Math.PI * e) });
          if (e < 1) requestAnimationFrame(step); else res(true);
        };
        requestAnimationFrame(step);
      });
    },
    destroy() { el.remove(); },
  };
  return api;
}

export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOut = t => 1 - (1 - t) ** 3;
