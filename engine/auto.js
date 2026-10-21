// 기본 선택. 행동에 하위 선택(Picks)이 비어 있으면 엔진이 이 함수들로 고른다.
// 봇도 같은 함수를 쓰고, 화면에서는 '추천 선택'으로 보여 줄 수 있다.

                                                                    
import { TOKENS } from './types.js';

export function missing(db    , c             )                        {
  const needs = db.children[c.card].needs;
  const m = { food: 0, med: 0, heart: 0 };
  for (const t of TOKENS) m[t] = Math.max(0, (needs[t] ?? 0) - c.placed[t]);
  return m;
}

export function remaining(db    , c             )         {
  const m = missing(db, c);
  return m.food + m.med + m.heart;
}

export function needsTotal(db    , card        )         {
  const n = db.children[card].needs;
  return (n.food ?? 0) + (n.med ?? 0) + (n.heart ?? 0);
}

// 내 보호소 아이들에게 모자란 토큰 - 이미 가진 자원. 가장 모자란 종류를 받는다.
export function deficit(db    , s           , pi        )                        {
  const p = s.players[pi];
  const d = { food: 0, med: 0, heart: 0 };
  for (const c of p.shelter) {
    const m = missing(db, c);
    for (const t of TOKENS) d[t] += m[t];
  }
  for (const t of TOKENS) d[t] -= p.res[t];
  return d;
}

export function gainToken(db    , s           , pi        )        {
  const d = deficit(db, s, pi);
  // 같으면 마음 > 약 > 사료 순. 모자란 게 없으면 계절 끝 먹이용 사료.
  let best        = 'food';
  let bestV = 0;
  for (const t of ['heart', 'med', 'food']           ) {
    if (d[t] > bestV) { best = t; bestV = d[t]; }
  }
  return best;
}

// 도움 카드: 공개 카드 중 값이 가장 큰 것, 없으면 덱.
export function drawPick(db    , s           , _pi        )                  {
  let best = -1;
  let bestV = -Infinity;
  s.market.forEach((id, i) => {
    const v = cardWorth(db, id);
    if (v > bestV) { bestV = v; best = i; }
  });
  return best >= 0 ? best : 'deck';
}

// 카드 하나의 대략적 값(비용 대비 효과). 봇과 기본 선택이 함께 쓴다.
export function cardWorth(db    , id        )         {
  const c = db.help[id];
  const cost = Object.values(c.cost).reduce((a, b) => a + (b ?? 0), 0);
  return opPower(c.onActivate ?? []) * 4 + opPower(c.onPlace ?? []) - cost;
}

export function opPower(ops                             )         {
  let v = 0;
  for (const o of ops) {
    switch (o.op) {
      case 'gain': case 'partnerGain': v += 1.2 * o.n; break;
      case 'gainAny': case 'partnerGainAny': v += 1.5 * o.n; break;
      case 'draw': v += 1.2 * o.n; break;
      case 'token': v += 2 * o.n; break;
      case 'tokenAny': v += 2.4 * o.n; break;
      case 'rescue': v += 2 * o.n; break;
      case 'adopt': v += 3 * o.n; break;
      case 'adoptLoose': v += 2 * o.n; break;
      case 'shelterCap': v += 4 * o.n; break;
      case 'waitingCap': v += 6 * o.n; break;
      case 'sentLimit': v += 10 * o.n; break;
    }
  }
  return v;
}

// 데려오기: 가장 오래 기다린 아이.
export function rescuePick(s           )                {
  return s.waiting.length ? s.waiting[0].uid : null;
}

// 입양: 준비된 아이 중 필요치가 큰(보상이 큰) 아이.
export function adoptPick(db    , ready               )                {
  if (!ready.length) return null;
  let best = ready[0];
  for (const c of ready) if (needsTotal(db, c.card) > needsTotal(db, best.card)) best = c;
  return best.uid;
}

// 특정 토큰 올리기: 그 토큰이 모자란 아이 중 준비까지 가장 가까운 아이.
export function tokenTarget(db    , s           , pi        , res       )                {
  let best                     = null;
  for (const c of s.players[pi].shelter) {
    if (missing(db, c)[res] <= 0) continue;
    if (!best || remaining(db, c) < remaining(db, best)) best = c;
  }
  return best ? best.uid : null;
}

// 아무 토큰 올리기: 준비까지 가장 가까운 아이, 그 아이에게 가장 많이 모자란 종류.
export function tokenAnyTarget(db    , s           , pi        )                                     {
  let best                     = null;
  for (const c of s.players[pi].shelter) {
    const r = remaining(db, c);
    if (r <= 0) continue;
    if (!best || r < remaining(db, best)) best = c;
  }
  if (!best) return null;
  const m = missing(db, best);
  let res        = 'heart';
  for (const t of TOKENS) if (m[t] > m[res]) res = t;
  return { uid: best.uid, res };
}

// 돌봄 줄 끝의 토큰 올리기. 1) 다 채울 수 있는 아이부터 채운다 2) 남은 자원을 가까운 아이에게 나눠 올린다.
// 계절 끝이 가까우면 먹이용 사료를 남긴다.
export function allocate(db    , s           , pi        )                                           {
  const p = s.players[pi];
  const avail = { food: p.res.food, med: p.res.med, heart: p.res.heart };
  if (p.actionsLeft <= 2) avail.food = Math.max(0, avail.food - p.shelter.length * s.seasonMods.feedMult);
  const out                                           = [];
  const kids = p.shelter.slice().sort((a, b) => remaining(db, a) - remaining(db, b));
  const done = new Set        ();
  for (const c of kids) {
    const m = missing(db, c);
    if (remaining(db, c) === 0) continue;
    if (TOKENS.every((t) => avail[t] >= m[t])) {
      for (const t of TOKENS) if (m[t] > 0) { out.push({ uid: c.uid, res: t, n: m[t] }); avail[t] -= m[t]; }
      done.add(c.uid);
    }
  }
  for (const c of kids) {
    if (done.has(c.uid)) continue;
    const m = missing(db, c);
    for (const t of TOKENS) {
      const n = Math.min(m[t], avail[t]);
      if (n > 0) { out.push({ uid: c.uid, res: t, n }); avail[t] -= n; }
    }
  }
  return out;
}
