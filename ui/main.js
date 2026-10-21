// 화면: 한 기기 돌려하기 + 온라인 판(각자 기기, 링크 초대). 규칙은 전부 engine/에 있고,
// 여기서는 상태를 그리고 행동을 엔진에 넘기기만 한다. 상태가 바뀔 때마다 화면 전체를 다시 그린다.
// 온라인 판의 원본은 저장소의 판 파일(씨앗 + 행동 목록)이고, 화면 상태는 그것을 다시 돌려(replay) 만든다.

                                                                                                                
import { RESOURCES, ROWS, TOKENS } from '../engine/types.js';
import { canPlay, createGame, partnerOf, preview, replay, rowLevel, step } from '../engine/engine.js';
import { missing } from '../engine/auto.js';
                                                
import { DropboxStore, LocalStore, newGameId } from './net.js';
import { DROPBOX_APP_KEY } from './config.js';

// 1편과 같은 출처에 올라가도 겹치지 않도록 저장 키에 게임 이름과 판 번호를 넣는다.
const SAVE_KEY = 'shelter-boardgame.v0.1.save';
const SEASONS = ['봄', '여름', '가을', '겨울'];
const RES_NAME                      = { food: '사료', med: '약', heart: '마음', fund: '후원금' };
const RES_ICON                      = { food: 'icon-food', med: 'icon-med', heart: 'icon-heart', fund: 'icon-fund' };
const SEASON_ICON = ['icon-spring', 'icon-summer', 'icon-autumn', 'icon-winter'];
const ROW_NAME                      = { rescue: '구조', care: '돌봄', adopt: '입양' };
const TAG_NAME                         = { young: '아기', shy: '수줍음', senior: '노령', hurt: '몸이 불편함' };
const DEFAULT_NAMES                   = ['햇살 보호소', '달빛 보호소'];

            
                                                                       
                                              
                                       
                   
                   
                    
                                  
                                                                           
                                                    

// 온라인 판: 저장소·판 ID·내 자리·판 파일과 그 버전.
                                                                                                                                           
const SEATS_KEY = 'shelter-boardgame.seats';

let db    ;
let cfg        ;
let game                   = null;
// 되돌리기: 행동 직전 상태들. 씨앗이 상태 안에 있어서, 되돌린 뒤 같은 행동을 하면 같은 결과가 나온다(다시 굴리기 아님).
let history              = [];
const HISTORY_MAX = 20;
let names           = [...DEFAULT_NAMES];
let online                = null;
let rulesVersion = '';
let store               = null;          // 처음 화면에서 쓸 온라인 저장소(없으면 온라인 꺼짐)
let onlineList                                                            = null;
let onlineError = '';
let selectedHand                = null;
let modal               = null;
let toast = '';
let toastTimer = 0;

const app = document.getElementById('app') ;

// ---------- 시작 ----------

async function boot()                {
  const get = async (f        ) => (await fetch(`data/${f}.json`)).json();
  const [help, children, events, goals, config] = await Promise.all(
    ['help', 'children', 'events', 'goals', 'config'].map(get),
  );
  const byId = (list                  ) => Object.fromEntries(list.map((x) => [x.id, x]));
  db = { help: byId(help), children: byId(children), events: byId(events), goals: byId(goals) }      ;
  cfg = config.normal          ;
  rulesVersion = (await get('version')).rules;
  const saved = load();
  if (saved) names = saved.names;
  // 온라인 저장소: 주소에 ?store=local 이면 시험용 브라우저 저장소, 아니면 앱 키가 있을 때 드롭박스.
  const params = new URLSearchParams(location.search);
  if (params.get('store') === 'local') store = new LocalStore();
  else if (DROPBOX_APP_KEY) store = new DropboxStore(DROPBOX_APP_KEY);
  if (store instanceof DropboxStore) {
    try { await store.finishLogin(); } catch (e) { onlineError = (e         ).message; }
  }
  render();
  await openFromHash();
  if (!game) refreshOnlineList();
}

function load()                                                                     {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.game?.status === 'playing' ? data : null;
  } catch {
    return null;
  }
}

function save()       {
  if (online) return; // 온라인 판은 저장소의 판 파일이 원본이다.
  try {
    if (game) localStorage.setItem(SAVE_KEY, JSON.stringify({ game, names, history }));
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등)에서도 게임은 계속된다.
  }
}

function newGame()       {
  const n1 = (document.getElementById('name1')                           )?.value.trim();
  const n2 = (document.getElementById('name2')                           )?.value.trim();
  names = [n1 || DEFAULT_NAMES[0], n2 || DEFAULT_NAMES[1]];
  const seed = Math.floor(Math.random() * 2 ** 31);
  game = createGame(db, cfg, seed, { log: true });
  history = [];
  selectedHand = null;
  modal = { kind: 'season', lines: game.log .slice() };
  save();
  render();
}

// ---------- 행동 ----------

function doAction(a        )       {
  if (!game) return;
  if (online) { onlineAct(a); return; }
  const before = game;
  let next           ;
  try {
    next = step(db, before, a);
  } catch (e) {
    showToast(`할 수 없어요: ${(e         ).message}`);
    return;
  }
  history = [...history, before].slice(-HISTORY_MAX);
  game = next;
  selectedHand = null;
  modal = null;
  save();
  announce(before, next);
  render();
}

// 상태가 바뀐 뒤 알림: 판이 끝났으면 끝 화면, 계절이 바뀌었으면 계절 창, 아니면 바뀐 내용 알림.
function announce(before           , after           )       {
  if (after.status !== 'playing') {
    modal = { kind: 'end' };
  } else if (after.season !== before.season) {
    modal = { kind: 'season', lines: after.log .slice(before.log .length) };
  } else {
    const shown = changeLines(before, after).slice(-5);
    if (after.current !== before.current) {
      shown.push(online && after.current === online.seat ? '내 차례예요' : `이제 ${names[after.current]} 차례예요`);
    }
    if (shown.length) showToast(shown.join('\n'));
  }
}

// 행동 전후 비교: 엔진 기록(데려옴·입양·도착 등) + 기록에 없는 자원 변화·토큰 올리기.
function changeLines(before           , after           )           {
  const out = after.log .slice(before.log .length).map(named)
    .filter((l) => !/줄 작동$|카드 놓기:|건네기 \{|맡기기 →|도움: 동료/.test(l));
  for (let pi = 0; pi < after.players.length; pi++) {
    const a = before.players[pi];
    const b = after.players[pi];
    const res = RESOURCES.filter((r) => b.res[r] !== a.res[r])
      .map((r) => `${RES_NAME[r]} ${b.res[r] > a.res[r] ? '+' : ''}${b.res[r] - a.res[r]}`);
    if (res.length) out.push(`${names[pi]}: ${res.join(', ')}`);
    for (const c of b.shelter) {
      const old = before.players.flatMap((q) => q.shelter).find((x) => x.uid === c.uid);
      if (!old) continue;
      const add = TOKENS.filter((t) => c.placed[t] > old.placed[t]).map((t) => `${RES_NAME[t]} ${c.placed[t] - old.placed[t]}`);
      if (add.length) out.push(`${db.children[c.card].name}에게 ${add.join(' · ')} 올림${TOKENS.every((t) => missing(db, c)[t] === 0) ? ' → 준비됨' : ''}`);
    }
  }
  return out;
}

function named(line        )         {
  return line.trim().replace(/P([1-4])/g, (_, n) => names[Number(n) - 1] ?? `P${n}`);
}

function undo()       {
  if (online) { onlineUndo(); return; }
  const prev = history[history.length - 1];
  if (!game || !prev) return;
  const undone = prev.log .length < game.log .length ? named(game.log [prev.log .length]) : '';
  history = history.slice(0, -1);
  game = prev;
  selectedHand = null;
  modal = null;
  save();
  showToast(`되돌렸어요${undone ? `: ${undone}` : ''}`);
}

function showToast(msg        )       {
  toast = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast = ''; render(); }, 4200);
}

// 이 행동에서 '사료·약·마음 중 고르기'가 몇 번 나오는지(카드의 gainAny + 돌봄 줄 기본 행동).
function gainSlots(a        )         {
  if (!game || (a.type !== 'activate' && a.type !== 'help')) return 0;
  const owner = a.type === 'activate' ? game.current : partnerOf(game, game.current, a.to);
  const cards = game.players[owner].rows[a.row];
  let n = 0;
  for (const id of cards) for (const o of db.help[id].onActivate ?? []) if (o.op === 'gainAny') n += o.n;
  if (a.row === 'care') n += game.config.careBaseGain + rowLevel(game, cards.length);
  return n;
}

function withPicks(a        , gains          )         {
  if ((a.type === 'activate' || a.type === 'help') && gains.length) {
    // 'auto'는 엔진이 추천 선택으로 바꾼다.
    return { ...a, picks: { gain: gains            } };
  }
  return a;
}

function openConfirm(a        , title        )       {
  modal = { kind: 'confirm', action: a, title, gains: Array(gainSlots(a)).fill('auto') };
  render();
}

// ---------- 그리기 도우미 ----------

function esc(s        )         {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] );
}

const img = (art                    , cls = '') => (art ? `<img class="${cls}" src="art/${art}.webp" alt="">` : '');
const ri = (r     ) => img(RES_ICON[r], 'ri');

function costHtml(c          )         {
  const parts = RESOURCES.filter((r) => c.cost[r]).map((r) => `${ri(r)}${c.cost[r]}`);
  return parts.join(' ') || '무료';
}

function cardHtml(id        , opts                                                                               = {})         {
  const c = db.help[id];
  const cls = ['card', c.row, opts.mini ? 'mini' : '', opts.selectable ? 'selectable' : '', opts.selected ? 'selected' : '', opts.cant ? 'cant' : ''].join(' ');
  const act = opts.selectable ? `data-act="sel-hand" data-id="${id}"` : '';
  return `<div class="${cls}" ${act} title="${esc(c.flavor ?? '')}">
    ${opts.mini
      ? `<div class="mhead">${img(c.art, 'mimg')}<div class="cname">${esc(c.name)}</div></div>`
      : `${img(c.art, 'cart')}<span class="ccost">${costHtml(c)}</span><div class="chead"><span class="cname">${esc(c.name)}</span></div>`}
    <div class="ctext">${esc(c.text)}</div>
  </div>`;
}

function pipsHtml(c                    , card        )         {
  const needs = db.children[card].needs;
  let out = '';
  for (const t of TOKENS) {
    const n = needs[t] ?? 0;
    const placed = c ? c.placed[t] : 0;
    for (let k = 0; k < n; k++) out += `<span class="pip ${t} ${k < placed ? 'on' : ''}" title="${RES_NAME[t]}"></span>`;
  }
  return `<div class="pips">${out}</div>`;
}

function kidHtml(c             , opts                                             = {})         {
  const k = db.children[c.card];
  const rem = opts.inShelter ? TOKENS.reduce((a, t) => a + missing(db, c)[t], 0) : -1;
  const tags = k.tags.map((t) => TAG_NAME[t] ?? t).join(' · ');
  return `<div class="kid ${rem === 0 ? 'ready' : ''}" title="${esc(k.text)}">
    ${img(k.art, 'kimg')}
    <div class="kname">${esc(k.name)}</div>
    <div class="tags">${esc(tags)}</div>
    ${pipsHtml(opts.inShelter ? c : null, c.card)}
    ${rem === 0 ? '<span class="ready-badge">준비됨</span>' : ''}
    ${opts.entrust ? `<button class="small" data-act="entrust" data-uid="${c.uid}" title="올린 토큰째 동료 보호소로 옮겨요(일손 없음)">맡기기</button>` : ''}
  </div>`;
}

function baseText(row     , level        )         {
  if (row === 'rescue') return `기본: 데려오기 ${1 + level}`;
  if (row === 'care') return `기본: 자원 ${(game?.config ?? cfg).careBaseGain + level} + 토큰 올리기`;
  return `기본: 입양 ${1 + level}`;
}

// ---------- 화면 ----------

function render()       {
  if (!db) return;
  app.innerHTML = (game ? gameHtml(game) : titleHtml()) + modalHtml() + (toast ? `<div class="toast">${esc(toast)}</div>` : '');
}

function titleHtml()         {
  const saved = load();
  return `<div class="title">
    ${img('title-hero', 'hero')}
    <h1>작은 발자국 보호소</h1>
    <div class="sub">함께 돌보는 사계절 · 시험판 v0.1</div>
    <label>첫 번째 보호소 이름 <input id="name1" maxlength="12" value="${esc(names[0])}"></label>
    <label>두 번째 보호소 이름 <input id="name2" maxlength="12" value="${esc(names[1])}"></label>
    <div class="buttons">
      <button class="primary" data-act="new">새로 시작</button>
      ${saved ? `<button data-act="continue">이어 하기 (${SEASONS[saved.game.season]}, 입양 ${saved.game.adoptedTotal})</button>` : ''}
    </div>
    ${onlinePanelHtml()}
    ${howtoHtml()}
  </div>`;
}

function onlinePanelHtml()         {
  if (!store) return `<div class="online-box"><b>온라인 판</b> <small>준비 중이에요(드롭박스 앱 키가 들어가면 켜져요)</small></div>`;
  const isDbx = store instanceof DropboxStore;
  if (isDbx && !(store                ).connected()) {
    return `<div class="online-box"><b>온라인 판</b> <small>각자 기기에서 링크로 함께 해요</small>
      ${onlineError ? `<div class="err">${esc(onlineError)}</div>` : ''}
      <div class="buttons"><button data-act="dbx-login">드롭박스 연결</button></div></div>`;
  }
  const list = onlineList === null ? '<div class="note">판 목록을 불러오는 중…</div>'
    : onlineList.length ? onlineList.map((g) => `<div class="glist"><span>${esc(g.label ?? g.id)}</span><small>${esc(fmtTime(g.modified))}</small>
        <button class="small" data-act="open-online" data-id="${g.id}">열기</button></div>`).join('')
    : '<div class="note">진행 중인 판이 없어요</div>';
  return `<div class="online-box"><b>온라인 판</b> <small>${isDbx ? '드롭박스 연결됨' : '시험용(이 브라우저 안)'} · 각자 기기에서 링크로 함께 해요</small>
    ${onlineError ? `<div class="err">${esc(onlineError)}</div>` : ''}
    <div class="buttons"><button class="primary" data-act="new-online">온라인 새 판 만들기</button>
      ${isDbx ? '<button class="small" data-act="dbx-logout">연결 끊기</button>' : ''}</div>
    ${list}</div>`;
}

function fmtTime(iso        )         {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function howtoHtml()         {
  return `<ul class="howto">
    <li>둘이 한 기기를 번갈아 쓰는 협력 게임이에요. 함께 이기고 함께 져요.</li>
    <li>겨울이 끝날 때 입양 보낸 아이가 <b>${cfg.target}마리</b> 이상이면 이겨요.</li>
    <li>동네의 기다리는 칸이 넘쳐 이웃 보호소로 보낸 아이가 <b>${cfg.sentLimit}마리</b>를 넘으면 져요.</li>
    <li>차례마다 일손 1로 <b>카드 놓기</b>·<b>줄 작동</b>·<b>도움</b>(계절에 1번, 동료 줄 통째로) 중 하나를 해요.</li>
    <li>줄을 작동하면 그 줄 카드가 오른쪽부터 움직이고, 마지막에 기본 행동을 해요. 카드가 2장·4장이면 기본 행동이 커져요.</li>
    <li>아이에게 토큰을 올리는 건 <b>돌봄 줄</b>에서 해요. 토큰을 다 채운 아이는 입양 줄에서 입양 보내요.</li>
    <li>건네기(자원 ${cfg.giveMax}개까지)와 맡기기(아이 1마리)는 일손 없이 차례마다 1번씩 할 수 있어요.</li>
  </ul>`;
}

function gameHtml(s           )         {
  return `<div class="game">${topbarHtml(s)}${waitBanner(s)}${townHtml(s)}<div class="boards">${s.players.map((_, i) => boardHtml(s, i)).join('')}</div></div>`;
}

// 지금 이 기기가 행동할 수 있는가(돌려하기는 늘, 온라인은 내 차례이고 저장 중이 아닐 때).
function canAct(s           )          {
  return s.status === 'playing' && (!online || (s.current === online.seat && !online.busy));
}

function waitBanner(s           )         {
  if (!online || s.status !== 'playing') return '';
  if (online.busy) return '<div class="wait">저장하는 중…</div>';
  if (s.current !== online.seat) return `<div class="wait">${esc(names[s.current])} 차례예요 — 상대가 두면 바로 바뀌어요</div>`;
  return '';
}

function topbarHtml(s           )         {
  const pct = Math.min(100, (s.adoptedTotal / s.config.target) * 100);
  let sent = '';
  for (let k = 0; k < s.sentLimit; k++) sent += `<i class="${k < s.sent ? 'on' : ''}"></i>`;
  return `<div class="topbar">
    <span class="season">${img(SEASON_ICON[s.season], 'sicon')}${SEASONS[s.season]} <small>(${s.season + 1}/4)</small></span>
    <span class="stat">입양 <b>${s.adoptedTotal}</b>/${s.config.target} <span class="bar"><i style="width:${pct}%"></i></span></span>
    <span class="stat sent" title="이 수를 넘으면 져요">${img('icon-neighbor', 'ri')}이웃 보호소 ${s.sent}/${s.sentLimit} ${sent}</span>
    <span class="spacer"></span>
    ${online ? `<span class="net ${online.trouble ? 'bad' : ''}" title="판 ${online.id}">${online.trouble ? '○ 다시 연결 중' : '● 온라인'} · 나: ${esc(names[online.seat])}</span>
      <button class="small" data-act="invite">초대 링크</button>` : ''}
    ${undoButton()}
    <button class="small" data-act="log">기록</button>
    <button class="small" data-act="menu">메뉴</button>
  </div>`;
}

function undoButton()         {
  if (online) {
    const last = online.file.actions[online.file.actions.length - 1];
    const ok = !!last && last.seat === online.seat && !online.busy;
    return `<button class="small" data-act="undo" ${ok ? '' : 'disabled'} title="내가 마지막에 한 행동만, 상대가 움직이기 전까지 되돌릴 수 있어요">되돌리기</button>`;
  }
  return `<button class="small" data-act="undo" ${history.length ? '' : 'disabled'} title="바로 전 행동을 취소해요(최근 ${HISTORY_MAX}개까지)">되돌리기${history.length ? ` (${history.length})` : ''}</button>`;
}

function townHtml(s           )         {
  const cap = s.waitingCap + s.waitingCapSeasonMod;
  const every = Math.max(1, s.config.arrivalEvery[s.season] + s.seasonMods.arrivalEveryMod);
  const nextIn = every - (s.turnsThisSeason % every);
  const ev = s.event ? db.events[s.event] : null;
  const goal = s.goal ? db.goals[s.goal] : null;
  const waiting = s.waiting.map((c) => kidHtml(c)).join('') || '<span class="note">기다리는 아이가 없어요</span>';
  return `<div class="town">
    <div>
      <h3>동네: 기다리는 아이 ${s.waiting.length}/${cap}</h3>
      <div class="waiting">${waiting}</div>
      <div class="note" title="두 사람이 쓴 일손을 합쳐 셉니다. 칸이 꽉 차 있으면 이웃 보호소로 가요.">다음 아이: 일손 ${nextIn}번 뒤 · 칸이 차면 이웃 보호소로</div>
    </div>
    <div>
      <h3>공개 카드</h3>
      <div class="market">${s.market.map((id) => cardHtml(id, { mini: false })).join('')}</div>
      <div class="note">'카드 받기' 효과로 가져와요 · 더미 ${s.helpDeck.length}장</div>
    </div>
    <div class="season-box">
      <h3>이번 계절</h3>
      <div class="ev">${ev ? img(ev.art, 'evimg') : ''}<div><b>사건</b> ${ev ? `${esc(ev.name)} — ${esc(ev.text)}` : '없음(봄은 잔잔해요)'}</div></div>
      <div class="ev">${goal ? img(goal.art, 'evimg') : ''}<div><b>목표</b> ${goal ? `${esc(goal.name)} — ${esc(goal.text)}` : '없음'}</div></div>
      <div class="legend"><span class="pip food on"></span>사료 <span class="pip med on"></span>약 <span class="pip heart on"></span>마음 · 빈 동그라미 = 아직 필요</div>
    </div>
  </div>`;
}

function boardHtml(s           , pi        )         {
  const p = s.players[pi];
  const isCur = s.current === pi;
  const act = canAct(s);
  const mine = isCur && act;               // 이 판에서 지금 단추를 누를 수 있는가
  const cur = s.players[s.current];
  const partner = s.players[partnerOf(s, pi)];
  const feed = p.shelter.length * s.seasonMods.feedMult;
  const res = RESOURCES.map((r) => `<span>${ri(r)}${RES_NAME[r]} <b>${p.res[r]}</b></span>`).join('');

  const rows = ROWS.map((row) => {
    const cards = p.rows[row];
    const lvl = rowLevel(s, cards.length);
    const slots = cards.map((id) => cardHtml(id, { mini: true })).join('')
      + Array(Math.max(0, s.config.rowMax - cards.length)).fill('<div class="slot-empty"></div>').join('');
    let btn = '';
    if (mine) btn = `<button class="primary" data-act="activate" data-row="${row}">작동</button>`;
    else if (act && !isCur && !cur.helpUsed) btn = `<button data-act="help" data-row="${row}" data-to="${pi}" title="계절에 1번, 이 줄을 내 것처럼 통째로 작동">도움</button>`;
    return `<div class="row ${row}">
      <div class="label">${img(`icon-row-${row}`, 'licon')}<span>${ROW_NAME[row]} 줄</span><small>${baseText(row, lvl)}</small></div>
      <div class="slots">${slots}</div>
      <div class="act">${btn}</div>
    </div>`;
  }).join('');

  const canEntrust = mine && !p.entrustUsed && partner.shelter.length < partner.shelterCap;
  const shelter = p.shelter.map((c) => kidHtml(c, { inShelter: true, entrust: canEntrust })).join('')
    || '<span class="note" style="font-family:var(--sans);font-size:12px">비어 있어요</span>';

  const hand = p.hand.map((id) => {
    if (!mine) return cardHtml(id);
    return cardHtml(id, { selectable: true, selected: selectedHand === id, cant: !canPlay(db, s, pi, id) });
  }).join('') || '<span class="note" style="font-family:var(--sans);font-size:12px">없음</span>';

  let handAct = '';
  if (mine && selectedHand && p.hand.includes(selectedHand)) {
    const ok = canPlay(db, s, pi, selectedHand);
    const c = db.help[selectedHand];
    handAct = ok
      ? `<button class="primary small" data-act="play" data-id="${selectedHand}">${esc(c.name)} 놓기 (일손 1)</button>`
      : `<small>${esc(c.name)}: ${p.rows[c.row].length >= s.config.rowMax ? '줄이 꽉 찼어요' : '자원이 모자라요'}</small>`;
  }

  const badges = [
    isCur ? '<span class="badge turn">지금 차례</span>' : '',
    online && online.seat === pi ? '<span class="badge me">나</span>' : '',
    `<span class="badge">${img('icon-action', 'bicon')}일손 ${p.actionsLeft}</span>`,
    `<span class="badge ${p.helpUsed ? 'off' : ''}">${img('icon-help', 'bicon')}도움 ${p.helpUsed ? '씀' : '1번 남음'}</span>`,
  ].join('');

  return `<div class="board ${isCur ? 'current' : ''}">
    <div class="head"><span class="name">${esc(names[pi])}</span>${badges}
      ${mine && !p.giveUsed ? '<button class="small" data-act="give-open">건네기</button>' : ''}</div>
    <div class="res">${res}</div>
    ${rows}
    <div class="sec-title">보호소 ${p.shelter.length}/${p.shelterCap}
      <small>계절 끝 먹이기: 사료 ${feed} 필요${feed > p.res.food ? ' — 모자라요!' : ''}</small></div>
    <div class="shelter">${shelter}</div>
    <div class="sec-title">손패 ${p.hand.length}/${s.config.handCap} ${handAct}</div>
    <div class="hand">${hand}</div>
  </div>`;
}

function modalHtml()         {
  if (!modal || (!game && !['menu', 'seat', 'notice'].includes(modal.kind))) return '';
  const s = game ;
  let body = '';
  switch (modal.kind) {
    case 'confirm': {
      const a = withPicks(modal.action, modal.gains);
      let lines           = [];
      try {
        lines = changeLines(s, preview(db, s, a));
      } catch (e) {
        lines = [`할 수 없어요: ${(e         ).message}`];
      }
      const gains = modal.gains.map((g, i) => `<label>${i + 1}번째
        <select data-act="gain" data-i="${i}">
          <option value="auto" ${g === 'auto' ? 'selected' : ''}>추천</option>
          ${TOKENS.map((t) => `<option value="${t}" ${g === t ? 'selected' : ''}>${RES_NAME[t]}</option>`).join('')}
        </select></label>`).join('');
      body = `<h2>${esc(modal.title)}</h2>
        ${gains ? `<div class="gain-row">받을 자원: ${gains}</div>` : ''}
        <div class="lines">${lines.map((l) => `<div>${esc(l)}</div>`).join('') || '<div>달라지는 것이 없어요</div>'}</div>
        <div class="note" style="font-family:var(--sans);font-size:12px;color:var(--ink2)">자원 변화는 아이에게 올린 토큰을 뺀 값이에요. 자원은 종류마다 ${s.config.resCap}까지만 가질 수 있어요. 데려올 아이·입양 보낼 아이·토큰 올리기는 추천대로 해요(시험판).</div>
        <div class="buttons"><button data-act="close">취소</button><button class="primary" data-act="confirm">이대로 하기</button></div>`;
      break;
    }
    case 'give': {
      const p = s.players[s.current];
      const give = modal.res;
      const total = RESOURCES.reduce((a, r) => a + give[r], 0);
      const rows = RESOURCES.map((r) => `<div class="give-row">${ri(r)}${RES_NAME[r]} (가진 것 ${p.res[r]})
        <button class="small" data-act="give-dec" data-res="${r}">-</button><span class="n">${give[r]}</span>
        <button class="small" data-act="give-inc" data-res="${r}" ${total >= s.config.giveMax || give[r] >= p.res[r] ? 'disabled' : ''}>+</button></div>`).join('');
      body = `<h2>${esc(names[partnerOf(s, s.current)])}에게 건네기</h2>
        <div style="font-family:var(--sans);font-size:14px">합쳐서 ${s.config.giveMax}개까지 건넬 수 있어요. 일손은 쓰지 않아요.</div>
        ${rows}
        <div class="buttons"><button data-act="close">취소</button><button class="primary" data-act="give-ok" ${total < 1 ? 'disabled' : ''}>건네기</button></div>`;
      break;
    }
    case 'season': {
      const ev = s.event ? db.events[s.event] : null;
      const goal = s.goal ? db.goals[s.goal] : null;
      const shown = modal.lines.map(named).filter((l) => l && !l.startsWith('===') && !l.startsWith('사건:') && !l.startsWith('계절 목표:') && !/카드 받음|줄 작동|카드 놓기/.test(l));
      body = `<h2>${img(SEASON_ICON[s.season], 'sicon')}${SEASONS[s.season]}이 왔어요</h2>
        ${shown.length ? `<div class="lines">${shown.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
        ${ev ? `<div class="bigcard">${img(ev.art, 'bigimg')}<div><div class="n">사건: ${esc(ev.name)}</div><div class="t">${esc(ev.text)}</div><div class="f">${esc(ev.flavor ?? '')}</div></div></div>` : '<div class="bigcard"><div class="t">봄에는 사건이 없어요. 판을 다질 시간이에요.</div></div>'}
        ${goal ? `<div class="bigcard">${img(goal.art, 'bigimg')}<div><div class="n">계절 목표: ${esc(goal.name)}</div><div class="t">${esc(goal.text)}</div></div></div>` : ''}
        <div style="font-family:var(--sans);font-size:14px">이번 계절 일손은 한 사람당 ${s.config.actions[s.season]}이에요. ${esc(names[s.current])}부터 시작해요.</div>
        <div class="buttons"><button class="primary" data-act="close">시작</button></div>`;
      break;
    }
    case 'end': {
      const won = s.status === 'won';
      const adopted = s.players.flatMap((p) => p.adopted);
      body = `<h2>${won ? '함께 해냈어요!' : '이번 사계절은 여기까지'}</h2>
        <div style="font-family:var(--sans);font-size:15px">
          입양 ${s.adoptedTotal}마리 (목표 ${s.config.target}) · 이웃 보호소로 보낸 아이 ${s.sent}마리<br>
          ${won ? '보호소들이 함께 사계절을 지켰어요.' : esc(s.lostReason ?? '')}
        </div>
        <div class="adopted-list">${adopted.map((id) => `<div>${img(db.children[id].art)}${esc(db.children[id].name)}</div>`).join('')}</div>
        <div class="buttons">${(online ? !undoButton().includes('disabled') : history.length) ? '<button data-act="undo">한 수 되돌리기</button>' : ''}<button data-act="log">기록 보기</button><button class="primary" data-act="to-title">처음 화면으로</button></div>`;
      break;
    }
    case 'log': {
      const lines = s.log .slice(-200).map((l) => (l.startsWith('===') ? `<div class="season">${esc(l.replace(/=/g, '').trim())}</div>` : `<div>${esc(named(l))}</div>`)).join('');
      body = `<h2>기록</h2><div class="logbox" id="logbox">${lines}</div>
        <div class="buttons"><button class="primary" data-act="close">닫기</button></div>`;
      break;
    }
    case 'menu': {
      body = `<h2>메뉴</h2>${howtoHtml()}
        <div class="buttons"><button data-act="to-title">처음 화면으로 (저장됨)</button><button class="primary" data-act="close">닫기</button></div>`;
      break;
    }
    case 'invite': {
      const link = (seat        ) => `${location.origin}${location.pathname}${location.search}#g=${modal .kind === 'invite' ? modal .id : ''}&s=${seat}`;
      const seats = online ? online.file.seats : [];
      body = `<h2>초대 링크</h2>
        <div style="font-size:14px">아래 링크를 메신저로 보내 주세요. 받은 사람은 그 보호소 자리로 들어와요.</div>
        ${seats.map((x, i) => i === online .seat ? '' : `<div class="linkrow"><b>${esc(x.name)}</b>
          <input readonly value="${esc(link(i))}"><button class="small" data-act="copy" data-text="${esc(link(i))}">복사</button></div>`).join('')}
        <div class="linkrow"><b>내 자리(${esc(seats[online .seat]?.name ?? '')})</b>
          <input readonly value="${esc(link(online .seat))}"><button class="small" data-act="copy" data-text="${esc(link(online .seat))}">복사</button></div>
        <div class="note" style="font-size:12px;color:var(--ink2)">내 자리 링크는 다른 기기에서 이어 할 때 써요. 드롭박스 판은 같은 드롭박스 계정에 연결된 기기에서만 열려요.</div>
        <div class="buttons"><button class="primary" data-act="close">닫기</button></div>`;
      break;
    }
    case 'seat': {
      const m = modal;
      body = `<h2>어느 보호소로 들어갈까요?</h2>
        <div style="font-size:14px">이 기기에서 맡을 보호소를 골라 주세요. 한 번 고르면 이 기기가 기억해요.</div>
        <div class="buttons" style="justify-content:flex-start">${m.file.seats.map((x, i) => `<button data-act="pick-seat" data-seat="${i}">${esc(x.name)}</button>`).join('')}</div>
        <div class="buttons"><button data-act="to-title">취소</button></div>`;
      break;
    }
    case 'notice': {
      body = `<h2>${esc(modal.title)}</h2><div style="font-size:14px">${esc(modal.text)}</div>
        <div class="buttons"><button class="primary" data-act="close">확인</button></div>`;
      break;
    }
  }
  return `<div class="modal-back"><div class="modal">${body}</div></div>`;
}

// ---------- 온라인 판 ----------

function seatMap()                         {
  try { return JSON.parse(localStorage.getItem(SEATS_KEY) ?? '{}'); } catch { return {}; }
}

function rememberSeat(id        , seat        )       {
  try { localStorage.setItem(SEATS_KEY, JSON.stringify({ ...seatMap(), [id]: seat })); } catch { /* 기억 못 해도 링크로 다시 고르면 됨 */ }
}

async function refreshOnlineList()                {
  if (!store || (store instanceof DropboxStore && !store.connected())) return;
  try {
    const list = await store.list();
    onlineList = list.slice(0, 8);
    render();
    // 이름은 판 파일 안에 있어 하나씩 읽는다(판이 몇 개뿐이라 충분히 빠르다).
    for (const g of onlineList) {
      const f = await store.load(g.id);
      if (f) g.label = `${f.file.seats.map((x) => x.name).join(' · ')}${seatMap()[g.id] !== undefined ? ` (나: ${f.file.seats[seatMap()[g.id]]?.name})` : ''}`;
    }
    if (!game) render();
  } catch (e) {
    onlineError = (e         ).message;
    if (!game) render();
  }
}

async function newOnlineGame()                {
  if (!store) return;
  const n1 = (document.getElementById('name1')                           )?.value.trim();
  const n2 = (document.getElementById('name2')                           )?.value.trim();
  const file           = {
    format: 1, id: newGameId(), created: new Date().toISOString(), rulesVersion, config: cfg,
    seed: Math.floor(Math.random() * 2 ** 31),
    seats: [{ name: n1 || DEFAULT_NAMES[0] }, { name: n2 || DEFAULT_NAMES[1] }],
    actions: [],
  };
  try {
    const r = await store.save(file.id, file, null);
    if (!r.ok) throw new Error('같은 판 번호가 이미 있어요. 다시 눌러 주세요.');
    rememberSeat(file.id, 0);
    startOnline(store, file.id, 0, file, r.rev);
    modal = { kind: 'invite', id: file.id };
    render();
  } catch (e) {
    onlineError = (e         ).message;
    render();
  }
}

// 주소의 #g=판ID&s=자리 로 판을 연다(초대 링크).
async function openFromHash()                {
  const h = new URLSearchParams(location.hash.slice(1));
  const id = h.get('g');
  if (!id || !store) return;
  if (store instanceof DropboxStore && !store.connected()) {
    modal = { kind: 'notice', title: '드롭박스 연결이 필요해요', text: "이 판은 드롭박스에 있어요. 처음 화면의 '드롭박스 연결'을 누르면 연결한 뒤 이 판으로 돌아와요." };
    render();
    return;
  }
  const s = h.get('s');
  await openOnline(store, id, s === null ? null : Number(s));
}

async function openOnline(st       , id        , seat               )                {
  try {
    const got = await st.load(id);
    if (!got) { modal = { kind: 'notice', title: '판을 찾을 수 없어요', text: `판 ${id}이(가) 없어요. 링크를 다시 확인해 주세요.` }; render(); return; }
    if (got.file.rulesVersion !== rulesVersion) {
      modal = { kind: 'notice', title: '규칙이 바뀐 판이에요', text: '이 판을 만든 뒤 카드나 규칙이 바뀌어서 이어 할 수 없어요. 새 판을 만들어 주세요.' };
      render();
      return;
    }
    const known = seat ?? seatMap()[id];
    if (known === undefined || known < 0 || known >= got.file.seats.length) {
      modal = { kind: 'seat', store: st, id, file: got.file, rev: got.rev };
      render();
      return;
    }
    rememberSeat(id, known);
    startOnline(st, id, known, got.file, got.rev);
  } catch (e) {
    modal = { kind: 'notice', title: '판을 열지 못했어요', text: (e         ).message };
    render();
  }
}

function build(file          )            {
  return replay(db, file.config, file.seed, file.actions.map((x) => x.a), { log: true, players: file.seats.length });
}

function startOnline(st       , id        , seat        , file          , rev        )       {
  if (online) online.stop();
  online = { store: st, id, seat, file, rev, busy: false, trouble: false, stop: () => {} };
  names = file.seats.map((x) => x.name);
  game = build(file);
  history = [];
  selectedHand = null;
  modal = file.actions.length === 0 ? { kind: 'season', lines: game.log .slice() } : game.status !== 'playing' ? { kind: 'end' } : null;
  window.history.replaceState(null, '', `${location.pathname}${location.search}#g=${id}&s=${seat}`);
  const o = online;
  o.stop = st.watch(id, () => { if (online === o) pull(); });
  render();
}

function leaveOnline()       {
  online?.stop();
  online = null;
  names = load()?.names ?? [...DEFAULT_NAMES];
  window.history.replaceState(null, '', `${location.pathname}${location.search}`);
}

// 저장소의 최신 판을 받아 화면을 맞춘다(상대가 움직였을 때).
async function pull()                {
  const o = online;
  if (!o || o.busy) return;
  try {
    const got = await o.store.load(o.id);
    if (online !== o || !got || got.rev === o.rev) { if (o.trouble) { o.trouble = false; render(); } return; }
    const before = game ;
    o.file = got.file;
    o.rev = got.rev;
    o.trouble = false;
    game = build(got.file);
    selectedHand = null;
    if (got.file.actions.length < before.mainActions + before.freeActions) {
      showToast('상대가 한 수를 되돌렸어요');
    } else if (modal?.kind !== 'invite') {
      announce(before, game);
    }
    render();
  } catch {
    o.trouble = true;
    render();
  }
}

async function onlineAct(a        )                {
  const o = online ;
  const before = game ;
  if (!canAct(before)) { showToast(`${names[before.current]} 차례예요`); render(); return; }
  let next           ;
  try {
    next = step(db, before, a);
  } catch (e) {
    showToast(`할 수 없어요: ${(e         ).message}`);
    return;
  }
  const file           = { ...o.file, actions: [...o.file.actions, { n: o.file.actions.length + 1, seat: o.seat, a, at: new Date().toISOString() }] };
  o.busy = true;
  modal = null;
  selectedHand = null;
  render();
  try {
    const r = await o.store.save(o.id, file, o.rev);
    o.busy = false;
    if (!r.ok) {
      showToast('그사이 판이 바뀌어서 다시 불러왔어요. 한 번 더 해 주세요.');
      await pull();
      render();
      return;
    }
    o.file = file;
    o.rev = r.rev;
    o.trouble = false;
    game = next;
    announce(before, next);
  } catch (e) {
    o.busy = false;
    o.trouble = true;
    showToast(`저장하지 못했어요: ${(e         ).message}`);
  }
  render();
}

async function onlineUndo()                {
  const o = online ;
  const last = o.file.actions[o.file.actions.length - 1];
  if (!last || last.seat !== o.seat || o.busy) return;
  const file           = { ...o.file, actions: o.file.actions.slice(0, -1) };
  o.busy = true;
  render();
  try {
    const r = await o.store.save(o.id, file, o.rev);
    o.busy = false;
    if (!r.ok) { showToast('상대가 이미 움직여서 되돌릴 수 없어요'); await pull(); render(); return; }
    o.file = file;
    o.rev = r.rev;
    game = build(file);
    modal = null;
    showToast('되돌렸어요');
  } catch (e) {
    o.busy = false;
    o.trouble = true;
    showToast(`되돌리지 못했어요: ${(e         ).message}`);
  }
  render();
}

// ---------- 입력 ----------

app.addEventListener('click', (e) => {
  const el = (e.target               ).closest('[data-act]')                      ;
  if (!el || el.tagName === 'SELECT') return;
  const act = el.dataset.act ;
  const s = game;
  switch (act) {
    case 'new': newGame(); return;
    case 'new-online': newOnlineGame(); return;
    case 'open-online': if (store) openOnline(store, el.dataset.id , null); return;
    case 'pick-seat': if (modal?.kind === 'seat') { const m = modal; rememberSeat(m.id, Number(el.dataset.seat)); startOnline(m.store, m.id, Number(el.dataset.seat), m.file, m.rev); } return;
    case 'invite': if (online) modal = { kind: 'invite', id: online.id }; break;
    case 'copy': navigator.clipboard?.writeText(el.dataset.text ).then(() => showToast('링크를 복사했어요')).catch(() => showToast('복사하지 못했어요. 길게 눌러 직접 복사해 주세요.')); return;
    case 'dbx-login': if (store instanceof DropboxStore) store.login(location.hash); return;
    case 'dbx-logout': if (store instanceof DropboxStore) { store.disconnect(); onlineList = null; } break;
    case 'continue': {
      const saved = load();
      if (saved) { game = saved.game; names = saved.names; history = saved.history ?? []; modal = null; }
      break;
    }
    case 'to-title':
      if (online) leaveOnline();
      else if (game && game.status === 'playing') save();
      game = null; modal = null; refreshOnlineList();
      break;
    case 'close':
      if (modal?.kind === 'log' && s && s.status !== 'playing') modal = { kind: 'end' };
      else modal = null;
      break;
    case 'log': modal = { kind: 'log' }; break;
    case 'undo': undo(); break;
    case 'menu': modal = { kind: 'menu' }; break;
    case 'sel-hand': selectedHand = selectedHand === el.dataset.id ? null : el.dataset.id ; break;
    case 'play': openConfirm({ type: 'play', card: el.dataset.id  }, `${db.help[el.dataset.id ].name} 놓기`); return;
    case 'activate': openConfirm({ type: 'activate', row: el.dataset.row        }, `${ROW_NAME[el.dataset.row       ]} 줄 작동`); return;
    case 'help': {
      // 2인이면 대상 자리를 적지 않는다(엔진이 상대로 정함). 3인 이상이면 누른 판의 자리.
      const to = Number(el.dataset.to);
      const a         = s .players.length > 2 ? { type: 'help', row: el.dataset.row       , to } : { type: 'help', row: el.dataset.row        };
      openConfirm(a, `도움: ${names[to]}의 ${ROW_NAME[el.dataset.row       ]} 줄 작동`);
      return;
    }
    case 'confirm': if (modal?.kind === 'confirm') doAction(withPicks(modal.action, modal.gains)); return;
    case 'give-open': modal = { kind: 'give', res: { food: 0, med: 0, heart: 0, fund: 0 } }; break;
    case 'give-inc': if (modal?.kind === 'give') modal.res[el.dataset.res       ]++; break;
    case 'give-dec': if (modal?.kind === 'give') modal.res[el.dataset.res       ] = Math.max(0, modal.res[el.dataset.res       ] - 1); break;
    case 'give-ok': if (modal?.kind === 'give') doAction({ type: 'give', res: { ...modal.res } }); return;
    case 'entrust': doAction({ type: 'entrust', uid: Number(el.dataset.uid) }); return;
  }
  render();
});

app.addEventListener('change', (e) => {
  const el = e.target                     ;
  if (el.dataset.act === 'gain' && modal?.kind === 'confirm') {
    modal.gains[Number(el.dataset.i)] = el.value;
    render();
  }
});

boot().catch((e) => {
  app.innerHTML = `<p class="loading">불러오지 못했어요: ${esc(String(e))}</p>`;
});
