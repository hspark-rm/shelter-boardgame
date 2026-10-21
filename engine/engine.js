// 규칙 엔진: 순수 상태 기계. step(db, 상태, 행동) → 새 상태. 입력 상태는 바꾸지 않는다.
// 같은 상태 + 같은 행동 → 같은 결과(난수 씨앗이 상태 안에 있다). 규칙 설명은 rules/RULES.md.

             
                                                                                                 
                    
import { RESOURCES, ROWS, TOKENS } from './types.js';
import { shuffleWith } from './rng.js';
import * as auto from './auto.js';

const SEASONS = ['봄', '여름', '가을', '겨울'];

                                                                            

// ---------- 시작 ----------

export function createGame(db    , config        , seed        , opts                                      = {})            {
  const seats = opts.players ?? 2;
  if (seats < 2 || seats > 4) throw new Error('자리는 2~4개');
  const s            = {
    rng: seed | 0,
    config,
    season: 0,
    current: 0,
    firstPlayer: 0,
    players: Array.from({ length: seats }, () => newPlayer(config)),
    waiting: [],
    waitingCap: config.waitingCap,
    waitingCapSeasonMod: 0,
    sent: 0,
    sentLimit: config.sentLimit,
    helpDeck: [], market: [], childDeck: [], childOut: [], eventDeck: [], goalDeck: [],
    event: null, goal: null,
    seasonMods: { feedMult: 1, adoptFund: 0, arrivalEveryMod: 0 },
    seasonStats: { adopted: 0, adoptedTags: {} },
    adoptedTotal: 0,
    goalsMet: [],
    mainActions: 0,
    turnsThisSeason: 0,
    freeActions: 0,
    nextUid: 1,
    status: 'playing',
    log: opts.log ? [] : null,
  };
  s.helpDeck = shuffleWith(s, Object.keys(db.help));
  s.childDeck = shuffleWith(s, Object.keys(db.children));
  s.eventDeck = shuffleWith(s, Object.keys(db.events));
  s.goalDeck = shuffleWith(s, Object.keys(db.goals));
  refillMarket(s);
  for (let pi = 0; pi < seats; pi++) for (let k = 0; k < config.startHand; k++) drawHelp(db, s, pi, 'deck');
  seasonStart(db, s);
  return s;
}

function newPlayer(c        )              {
  return {
    res: { ...c.startRes },
    hand: [],
    rows: { rescue: [], care: [], adopt: [] },
    shelter: [],
    shelterCap: c.shelterCap,
    actionsLeft: 0,
    helpUsed: false,
    giveUsed: false,
    entrustUsed: false,
    adopted: [],
  };
}

// ---------- 공개 함수 ----------

export function step(db    , state           , action        )            {
  const s = structuredClone(state);
  applyAction(db, s, action);
  if (isMain(action)) endTurn(db, s);
  return s;
}

// 봇용: 행동만 적용하고 차례 넘김(도착·계절 끝)은 하지 않는다.
export function preview(db    , state           , action        )            {
  const s = structuredClone(state);
  applyAction(db, s, action);
  return s;
}

// 행동 목록을 처음부터 다시 돌려 상태를 만든다(온라인 판: 파일에는 씨앗과 행동만 있다).
export function replay(db    , config        , seed        , actions          , opts                                      = {})            {
  let s = createGame(db, config, seed, opts);
  for (const a of actions) s = step(db, s, a);
  return s;
}

// 동료 자리: to가 올바르면 그 자리, 아니면 다음 자리(2인이면 상대).
export function partnerOf(s           , pi        , to         )         {
  const n = s.players.length;
  if (typeof to === 'number' && to >= 0 && to < n && to !== pi) return to;
  return (pi + 1) % n;
}

export function isMain(a        )          {
  return a.type === 'play' || a.type === 'activate' || a.type === 'help';
}

// 지금 차례인 사람이 일손을 써서 할 수 있는 행동 목록.
export function legalMainActions(db    , s           )           {
  if (s.status !== 'playing') return [];
  const pi = s.current;
  const p = s.players[pi];
  const out           = [];
  for (const id of p.hand) if (canPlay(db, s, pi, id)) out.push({ type: 'play', card: id });
  for (const row of ROWS) out.push({ type: 'activate', row });
  if (!p.helpUsed) {
    // 2인이면 대상 자리를 적지 않는다(다음 자리 = 상대). 3인 이상이면 동료마다 따로.
    const others = s.players.length > 2 ? s.players.map((_, j) => j).filter((j) => j !== pi) : [undefined];
    for (const to of others) for (const row of ROWS) out.push(to === undefined ? { type: 'help', row } : { type: 'help', row, to });
  }
  return out;
}

export function canPlay(db    , s           , pi        , id        )          {
  const p = s.players[pi];
  const c = db.help[id];
  if (!p.hand.includes(id)) return false;
  if (p.rows[c.row].length >= s.config.rowMax) return false;
  return RESOURCES.every((r) => p.res[r] >= (c.cost[r] ?? 0));
}

// ---------- 행동 적용 ----------

function applyAction(db    , s           , a        )       {
  if (s.status !== 'playing') throw new Error('게임이 끝났습니다');
  const pi = s.current;
  const p = s.players[pi];
  if (isMain(a) && p.actionsLeft <= 0) throw new Error('일손이 없습니다');
  switch (a.type) {
    case 'play': {
      if (!canPlay(db, s, pi, a.card)) throw new Error(`놓을 수 없는 카드: ${a.card}`);
      const c = db.help[a.card];
      for (const r of RESOURCES) p.res[r] -= c.cost[r] ?? 0;
      p.hand.splice(p.hand.indexOf(a.card), 1);
      p.rows[c.row].push(a.card);
      log(s, `P${pi + 1} 카드 놓기: ${c.name}(${rowName(c.row)})`);
      runOps(db, s, pi, c.onPlace ?? [], newCtx({}));
      s.mainActions++;
      return;
    }
    case 'activate': {
      log(s, `P${pi + 1} ${rowName(a.row)} 줄 작동`);
      runRow(db, s, pi, p.rows[a.row], a.row, newCtx(a.picks ?? {}));
      s.mainActions++;
      return;
    }
    case 'help': {
      // 도움: 동료 판의 줄 하나를 통째로(카드 + 줄 성장까지 포함한 기본 행동) 내 것처럼 작동한다.
      if (p.helpUsed) throw new Error('이번 계절 도움 행동을 이미 썼습니다');
      if (!ROWS.includes(a.row)) throw new Error(`없는 줄: ${a.row}`);
      p.helpUsed = true;
      log(s, `P${pi + 1} 도움: P${partnerOf(s, pi, a.to) + 1}의 ${rowName(a.row)} 줄 작동`);
      runRow(db, s, pi, s.players[partnerOf(s, pi, a.to)].rows[a.row], a.row, newCtx(a.picks ?? {}));
      s.mainActions++;
      return;
    }
    case 'give': {
      if (p.giveUsed) throw new Error('이번 차례 건네기를 이미 썼습니다');
      let total = 0;
      for (const r of RESOURCES) {
        const n = a.res[r] ?? 0;
        if (n < 0 || n > p.res[r]) throw new Error('건넬 자원이 모자랍니다');
        total += n;
      }
      if (total < 1 || total > s.config.giveMax) throw new Error(`건네기는 1~${s.config.giveMax}개`);
      for (const r of RESOURCES) {
        const n = a.res[r] ?? 0;
        p.res[r] -= n;
        addRes(s, partnerOf(s, pi, a.to), r, n);
      }
      p.giveUsed = true;
      s.freeActions++;
      log(s, `P${pi + 1} 건네기 → P${partnerOf(s, pi, a.to) + 1} ${JSON.stringify(a.res)}`);
      return;
    }
    case 'entrust': {
      if (p.entrustUsed) throw new Error('이번 차례 맡기기를 이미 썼습니다');
      const to = partnerOf(s, pi, a.to);
      const q = s.players[to];
      const i = p.shelter.findIndex((c) => c.uid === a.uid);
      if (i < 0) throw new Error('내 보호소에 없는 아이입니다');
      if (q.shelter.length >= q.shelterCap) throw new Error('동료 보호소에 빈칸이 없습니다');
      q.shelter.push(p.shelter.splice(i, 1)[0]);
      p.entrustUsed = true;
      s.freeActions++;
      log(s, `P${pi + 1} 맡기기 → P${to + 1}`);
      return;
    }
  }
}

// 줄 작동: 카드는 오른쪽(나중에 놓은 것)에서 왼쪽으로, 마지막에 줄 머리의 기본 행동.
// cards는 내 줄 또는(도움 행동일 때) 동료의 줄. 결과는 pi가 받는다.
function runRow(db    , s           , pi        , cards          , row     , ctx     )       {
  for (let i = cards.length - 1; i >= 0; i--) runOps(db, s, pi, db.help[cards[i]].onActivate ?? [], ctx);
  const grow = rowLevel(s, cards.length);
  if (row === 'rescue') ctx.rescue += 1 + grow;
  if (row === 'adopt') ctx.adopt += 1 + grow;
  if (row === 'care') {
    for (let k = 0; k < s.config.careBaseGain + grow; k++) addRes(s, pi, pickGain(db, s, pi, ctx), 1);
    allocateTokens(db, s, pi, ctx.picks.allocate);
  }
  finishRescueAdopt(db, s, pi, ctx);
}

// 줄 성장: 카드가 rowGrowth장 늘 때마다 기본 행동 +1.
export function rowLevel(s           , cards        )         {
  return s.config.rowGrowth > 0 ? Math.floor(cards / s.config.rowGrowth) : 0;
}

function newCtx(picks       )      {
  return { rescue: 0, adopt: 0, loose: 0, picks: structuredClone(picks) };
}

function runOps(db    , s           , pi        , ops      , ctx     )       {
  for (const o of ops) {
    if (s.status !== 'playing') return;
    switch (o.op) {
      case 'gain': addRes(s, pi, o.res, o.n); break;
      case 'gainAny': for (let k = 0; k < o.n; k++) addRes(s, pi, pickGain(db, s, pi, ctx), 1); break;
      case 'partnerGain': addRes(s, partnerOf(s, pi, ctx.picks.partner), o.res, o.n); break;
      case 'partnerGainAny': {
        const q = partnerOf(s, pi, ctx.picks.partner);
        for (let k = 0; k < o.n; k++) addRes(s, q, auto.gainToken(db, s, q), 1);
        break;
      }
      case 'draw': for (let k = 0; k < o.n; k++) drawHelp(db, s, pi, pickDraw(db, s, pi, ctx)); break;
      case 'rescue': ctx.rescue += o.n; break;
      case 'adopt': ctx.adopt += o.n; break;
      case 'adoptLoose': ctx.loose += o.n; break;
      case 'token': for (let k = 0; k < o.n; k++) placeToken(db, s, pi, o.res, ctx); break;
      case 'tokenAny': for (let k = 0; k < o.n; k++) placeAnyToken(db, s, pi, ctx); break;
      case 'shelterCap': s.players[pi].shelterCap += o.n; break;
      case 'waitingCap': s.waitingCap += o.n; break;
      case 'sentLimit': s.sentLimit += o.n; break;
      case 'gainAll': for (let q = 0; q < s.players.length; q++) addRes(s, q, o.res, o.n); break;
      case 'gainAnyAll': for (let q = 0; q < s.players.length; q++) for (let k = 0; k < o.n; k++) addRes(s, q, auto.gainToken(db, s, q), 1); break;
      case 'drawAll': for (let q = 0; q < s.players.length; q++) for (let k = 0; k < o.n; k++) drawHelp(db, s, q, 'deck'); break;
      case 'arrive': for (let k = 0; k < o.n; k++) arrive(db, s); break;
      case 'feedMult': s.seasonMods.feedMult = o.n; break;
      case 'adoptFund': s.seasonMods.adoptFund += o.n; break;
      case 'waitingCapSeason': s.waitingCapSeasonMod += o.n; break;
      case 'arrivalEverySeason': s.seasonMods.arrivalEveryMod += o.n; break;
    }
  }
}

// ---------- 하위 선택 ----------

function pickGain(db    , s           , pi        , ctx     )        {
  const t = ctx.picks.gain?.shift();
  return t && TOKENS.includes(t) ? t : auto.gainToken(db, s, pi);
}

function pickDraw(db    , s           , pi        , ctx     )                  {
  const d = ctx.picks.draw?.shift();
  if (d === 'deck' || (typeof d === 'number' && d >= 0 && d < s.market.length)) return d;
  return auto.drawPick(db, s, pi);
}

function placeToken(db    , s           , pi        , res       , ctx     )       {
  const shelter = s.players[pi].shelter;
  const want = ctx.picks.target?.shift();
  let c = shelter.find((x) => x.uid === want && auto.missing(db, x)[res] > 0);
  if (!c) {
    const uid = auto.tokenTarget(db, s, pi, res);
    c = shelter.find((x) => x.uid === uid);
  }
  // 올릴 아이가 없으면 그 자원을 내가 받는다.
  if (c) c.placed[res]++;
  else addRes(s, pi, res, 1);
}

function placeAnyToken(db    , s           , pi        , ctx     )       {
  const shelter = s.players[pi].shelter;
  const want = ctx.picks.target?.shift();
  const chosen = shelter.find((x) => x.uid === want && auto.remaining(db, x) > 0);
  if (chosen) {
    const m = auto.missing(db, chosen);
    const res = TOKENS.reduce((a, t) => (m[t] > m[a] ? t : a), 'heart'         );
    chosen.placed[res]++;
    return;
  }
  const t = auto.tokenAnyTarget(db, s, pi);
  if (t) shelter.find((x) => x.uid === t.uid) .placed[t.res]++;
  else addRes(s, pi, auto.gainToken(db, s, pi), 1);
}

function allocateTokens(db    , s           , pi        , plan                                           )       {
  const p = s.players[pi];
  const list = plan ?? auto.allocate(db, s, pi);
  for (const { uid, res, n } of list) {
    const c = p.shelter.find((x) => x.uid === uid);
    if (!c) continue;
    const k = Math.min(n, p.res[res], auto.missing(db, c)[res]);
    if (k <= 0) continue;
    p.res[res] -= k;
    c.placed[res] += k;
  }
}

// ---------- 데려오기 · 입양 ----------

function finishRescueAdopt(db    , s           , pi        , ctx     )       {
  const p = s.players[pi];
  for (let k = 0; k < ctx.rescue; k++) {
    if (!s.waiting.length || p.shelter.length >= p.shelterCap) break;
    const want = ctx.picks.rescue?.shift();
    let i = s.waiting.findIndex((c) => c.uid === want);
    if (i < 0) i = s.waiting.findIndex((c) => c.uid === auto.rescuePick(s));
    const c = s.waiting.splice(i, 1)[0];
    p.shelter.push(c);
    log(s, `  데려옴: ${db.children[c.card].name}`);
  }
  for (let k = 0; k < ctx.adopt; k++) {
    const ready = p.shelter.filter((c) => auto.remaining(db, c) <= ctx.loose);
    if (!ready.length) break;
    const want = ctx.picks.adopt?.shift();
    const uid = ready.some((c) => c.uid === want) ? want  : auto.adoptPick(db, ready) ;
    adopt(db, s, pi, uid);
  }
}

function adopt(db    , s           , pi        , uid        )       {
  const p = s.players[pi];
  const i = p.shelter.findIndex((c) => c.uid === uid);
  const c = p.shelter.splice(i, 1)[0];
  const card = db.children[c.card];
  p.adopted.push(c.card);
  s.childOut.push(c.card);
  s.adoptedTotal++;
  s.seasonStats.adopted++;
  for (const t of card.tags) s.seasonStats.adoptedTags[t] = (s.seasonStats.adoptedTags[t] ?? 0) + 1;
  log(s, `  입양: ${card.name} (누적 ${s.adoptedTotal})`);
  runOps(db, s, pi, card.reward, newCtx({}));
  if (s.seasonMods.adoptFund) addRes(s, pi, 'fund', s.seasonMods.adoptFund);
}

// ---------- 카드 · 자원 ----------

function addRes(s           , pi        , r     , n        )       {
  const p = s.players[pi];
  p.res[r] = Math.min(s.config.resCap, p.res[r] + n);
}

function drawHelp(db    , s           , pi        , from                 )       {
  const p = s.players[pi];
  if (p.hand.length >= s.config.handCap) return;
  let id                    ;
  if (from !== 'deck' && from < s.market.length) {
    id = s.market.splice(from, 1)[0];
    refillMarket(s);
  } else {
    id = s.helpDeck.shift();
  }
  if (id) { p.hand.push(id); log(s, `  P${pi + 1} 카드 받음: ${db.help[id].name}`); }
}

function refillMarket(s           )       {
  while (s.market.length < s.config.marketSize && s.helpDeck.length) s.market.push(s.helpDeck.shift() );
}

// ---------- 아이 도착 ----------

function arrive(db    , s           )       {
  if (s.status !== 'playing') return;
  if (!s.childDeck.length) {
    // 아이 카드가 다 나가면 입양·이웃 보호소로 간 카드를 섞어 다시 쓴다(새 아이로 본다).
    s.childDeck = shuffleWith(s, s.childOut);
    s.childOut = [];
  }
  const card = s.childDeck.shift();
  if (!card) return;
  const c              = { uid: s.nextUid++, card, placed: { food: 0, med: 0, heart: 0 } };
  const cap = s.waitingCap + s.waitingCapSeasonMod;
  if (s.waiting.length < cap) {
    s.waiting.push(c);
    log(s, `  도착: ${db.children[card].name} (기다리는 아이 ${s.waiting.length}/${cap})`);
  } else {
    s.sent++;
    s.childOut.push(card);
    log(s, `  칸이 꽉 차 ${db.children[card].name}은(는) 이웃 보호소로 (보낸 아이 ${s.sent}/${s.sentLimit})`);
    if (s.sent > s.sentLimit) lose(s, '이웃 보호소 한도 초과');
  }
}

// ---------- 차례 · 계절 ----------

function endTurn(db    , s           )       {
  const cur = s.current;
  s.players[cur].actionsLeft--;
  // 도착: 이번 계절 일손 행동 수가 도착 간격의 배수가 될 때마다 1마리.
  s.turnsThisSeason++;
  const every = Math.max(1, s.config.arrivalEvery[s.season] + s.seasonMods.arrivalEveryMod);
  if (s.turnsThisSeason % every === 0) arrive(db, s);
  if (s.status !== 'playing') return;
  for (const p of s.players) { p.giveUsed = false; p.entrustUsed = false; }
  // 다음 자리부터 돌며 일손이 남은 자리에게 차례를 넘긴다(마지막에 자기 자신).
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (cur + k) % n;
    if (s.players[j].actionsLeft > 0) { s.current = j; return; }
  }
  seasonEnd(db, s);
}

function seasonStart(db    , s           )       {
  s.seasonMods = { feedMult: 1, adoptFund: 0, arrivalEveryMod: 0 };
  s.turnsThisSeason = 0;
  s.seasonStats = { adopted: 0, adoptedTags: {} };
  s.waitingCapSeasonMod = 0;
  for (const p of s.players) { p.helpUsed = false; p.actionsLeft = s.config.actions[s.season]; }
  s.current = s.firstPlayer;
  log(s, `=== ${SEASONS[s.season]} ===`);
  s.event = s.season >= s.config.eventFromSeason ? s.eventDeck.shift() ?? null : null;
  s.goal = s.goalDeck.shift() ?? null;
  if (s.event) { log(s, `사건: ${db.events[s.event].name}`); runOps(db, s, s.firstPlayer, db.events[s.event].effects, newCtx({})); }
  if (s.goal) log(s, `계절 목표: ${db.goals[s.goal].name}`);
  for (let k = 0; k < s.config.seasonStartArrivals[s.season]; k++) arrive(db, s);
  for (let pi = 0; pi < s.players.length; pi++) for (let k = 0; k < s.config.seasonDraw; k++) drawHelp(db, s, pi, 'deck');
}

function seasonEnd(db    , s           )       {
  if (s.goal) {
    const g = db.goals[s.goal];
    if (goalMet(s, g.check)) {
      s.goalsMet.push(g.id);
      log(s, `계절 목표 달성: ${g.name}`);
      runOps(db, s, s.firstPlayer, g.reward, newCtx({}));
    }
  }
  // 먹이기: 보호소 아이 1마리당 사료. 모자라면 그 아이의 토큰 1개가 내려간다(기운이 빠짐).
  for (const p of s.players) {
    for (const c of p.shelter) {
      for (let k = 0; k < s.seasonMods.feedMult; k++) {
        if (p.res.food > 0) { p.res.food--; continue; }
        const t = TOKENS.reduce((a, x) => (c.placed[x] > c.placed[a] ? x : a), 'heart'         );
        if (c.placed[t] > 0) { c.placed[t]--; log(s, `  ${db.children[c.card].name} 기운이 빠짐(사료 부족)`); }
      }
    }
  }
  if (s.season === 3) {
    if (s.adoptedTotal >= s.config.target) { s.status = 'won'; log(s, `승리: 입양 ${s.adoptedTotal}/${s.config.target}`); }
    else lose(s, `입양 목표 미달 (${s.adoptedTotal}/${s.config.target})`);
    return;
  }
  s.season++;
  s.firstPlayer = (s.firstPlayer + 1) % s.players.length;
  seasonStart(db, s);
}

function goalMet(s           , ch           )          {
  switch (ch.type) {
    case 'adoptedTagSeason': return ch.tags.reduce((a, t) => a + (s.seasonStats.adoptedTags[t] ?? 0), 0) >= ch.n;
    case 'adoptedSeason': return s.seasonStats.adopted >= ch.n;
    case 'allRowsFilled': return s.players.every((p) => ROWS.every((r) => p.rows[r].length > 0));
    case 'waitingAtMost': return s.waiting.length <= ch.n;
  }
}

function lose(s           , why        )       {
  s.status = 'lost';
  s.lostReason = why;
  log(s, `패배: ${why}`);
}

function log(s           , msg        )       {
  if (s.log) s.log.push(msg);
}

function rowName(r     )         {
  return r === 'rescue' ? '구조' : r === 'care' ? '돌봄' : '입양';
}
