// 온라인 판 저장소. 판 파일(씨앗 + 행동 목록) 하나를 읽고, 버전을 지정해 쓰고, 바뀌면 알려 준다.
// 같은 약속(Store)을 두 가지로 구현한다:
//   LocalStore   — 브라우저 저장소. 같은 브라우저의 두 탭을 두 기기처럼 시험할 때(?store=local).
//   DropboxStore — 드롭박스 앱 전용 폴더(/games/<판ID>.json). 로그인은 PKCE(비밀키 없음).
// 4인 판에서 다른 저장소로 옮길 때도 Store만 새로 구현하면 된다.

                                                         

                           
            
             
                  
                       
                 
               
                            
                                                                
 

                                                                                   

                        
                            
                                                                    
                                                    
                                                                            
                                                      
                                         
                                                      
 

const PREFIX = 'shelter-boardgame.';

export function newGameId()         {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, (x) => abc[x % abc.length]).join('');
}

// ---------- 시험용: 브라우저 저장소 ----------

export class LocalStore                  {
  kind = 'local'         ;
          key(id        ) { return `${PREFIX}net.${id}`; }

  async load(id        ) {
    const raw = localStorage.getItem(this.key(id));
    if (!raw) return null;
    const { file, rev } = JSON.parse(raw);
    return { file, rev: String(rev) };
  }

  async save(id        , file          , rev               )                      {
    const cur = await this.load(id);
    if ((rev === null && cur) || (rev !== null && (!cur || cur.rev !== rev))) return { ok: false, conflict: true };
    const next = String((cur ? Number(cur.rev) : 0) + 1);
    localStorage.setItem(this.key(id), JSON.stringify({ file, rev: next, modified: new Date().toISOString() }));
    return { ok: true, rev: next };
  }

  async list() {
    const out                                     = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ;
      if (!k.startsWith(`${PREFIX}net.`)) continue;
      try { out.push({ id: k.slice(`${PREFIX}net.`.length), modified: JSON.parse(localStorage.getItem(k) ).modified ?? '' }); } catch { /* 깨진 항목은 건너뜀 */ }
    }
    return out.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  watch(id        , onChange            ) {
    // 다른 탭이 쓰면 storage 사건이 온다. 같은 탭은 직접 다시 그린다.
    const h = (e              ) => { if (e.key === this.key(id)) onChange(); };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }
}

// ---------- 드롭박스 ----------

                                                                 
const TOKEN_KEY = `${PREFIX}dropbox`;
const PKCE_KEY = `${PREFIX}dropbox.pkce`;

// 드롭박스 등록 주소와 똑같아야 한다(index.html 없이, 끝에 /).
export function redirectUri()         {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function b64url(bytes            )         {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Dropbox-API-Arg 머리글은 ASCII만 받는다.
function apiArg(o         )         {
  return JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export class DropboxStore                  {
  kind = 'dropbox'         ;
          appKey        ;
  constructor(appKey        ) { this.appKey = appKey; }

  connected()          {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
  }

  disconnect()       {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
  }

  // 로그인 화면으로 보낸다. 돌아온 뒤 열 판(hash)을 기억해 둔다.
  async login(returnHash        )                {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnHash }));
    const q = new URLSearchParams({
      client_id: this.appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
      token_access_type: 'offline', redirect_uri: redirectUri(), state,
    });
    location.href = `https://www.dropbox.com/oauth2/authorize?${q}`;
  }

  // 로그인에서 돌아왔으면(?code=) 토큰으로 바꾸고, 주소를 정리한 뒤 원래 hash를 돌려준다.
  async finishLogin()                         {
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    if (!code) return null;
    const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null');
    sessionStorage.removeItem(PKCE_KEY);
    history.replaceState(null, '', redirectUri() + (saved?.returnHash ?? ''));
    if (!saved || saved.state !== q.get('state')) throw new Error('드롭박스 로그인 확인 값이 맞지 않아요. 다시 연결해 주세요.');
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: this.appKey, code_verifier: saved.verifier, redirect_uri: redirectUri() }),
    });
    if (!r.ok) throw new Error(`드롭박스 로그인 실패 (${r.status})`);
    const t = await r.json();
    this.saveTokens({ access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
    return saved.returnHash ?? '';
  }

          saveTokens(t        ) { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); }

          async token()                  {
    const t                = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null');
    if (!t) throw new Error('드롭박스에 연결되어 있지 않아요');
    if (Date.now() < t.exp) return t.access;
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.appKey }),
    });
    if (!r.ok) { this.disconnect(); throw new Error('드롭박스 연결이 끊겼어요. 다시 연결해 주세요.'); }
    const n = await r.json();
    this.saveTokens({ access: n.access_token, refresh: t.refresh, exp: Date.now() + (n.expires_in - 60) * 1000 });
    return n.access_token;
  }

          async rpc(path        , body         )                    {
    return fetch(`https://api.dropboxapi.com/2/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

          path(id        ) { return `/games/${id}.json`; }

  async load(id        ) {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Dropbox-API-Arg': apiArg({ path: this.path(id) }) },
    });
    if (r.status === 409) return null; // 파일 없음
    if (!r.ok) throw new Error(`판을 불러오지 못했어요 (${r.status})`);
    const file = JSON.parse(await r.text());
    // 버전은 응답 머리글에 있다. 머리글을 못 읽는 환경이면 메타데이터로 다시 묻는다.
    const meta = r.headers.get('Dropbox-API-Result');
    const rev = meta ? JSON.parse(meta).rev : (await (await this.rpc('files/get_metadata', { path: this.path(id) })).json()).rev;
    return { file, rev };
  }

  async save(id        , file          , rev               )                      {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': apiArg({ path: this.path(id), mode: rev ? { '.tag': 'update', update: rev } : 'add', autorename: false, mute: true }),
      },
      body: new TextEncoder().encode(JSON.stringify(file)),
    });
    if (r.status === 409) return { ok: false, conflict: true };
    if (!r.ok) throw new Error(`판을 저장하지 못했어요 (${r.status})`);
    return { ok: true, rev: (await r.json()).rev };
  }

  async list() {
    const r = await this.rpc('files/list_folder', { path: '/games' });
    if (r.status === 409) return []; // 폴더 없음 = 판 없음
    if (!r.ok) throw new Error(`판 목록을 불러오지 못했어요 (${r.status})`);
    const j = await r.json();
    return (j.entries                                                )
      .filter((e) => e.name.endsWith('.json'))
      .map((e) => ({ id: e.name.replace(/\.json$/, ''), modified: e.server_modified ?? '' }))
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  // 폴더 변경 알림(longpoll)으로 기다린다. 안 되면 5초마다 버전을 확인한다.
  watch(id        , onChange            ) {
    let stopped = false;
    const loop = async () => {
      let lastRev = '';
      while (!stopped) {
        try {
          const c = await this.rpc('files/list_folder/get_latest_cursor', { path: '/games' });
          if (!c.ok) throw new Error(String(c.status));
          const { cursor } = await c.json();
          const lp = await fetch('https://notify.dropboxapi.com/2/files/list_folder/longpoll', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor, timeout: 60 }),
          });
          if (!lp.ok) throw new Error(String(lp.status));
          const j = await lp.json();
          if (stopped) return;
          if (j.changes) onChange();
          if (j.backoff) await sleep(j.backoff * 1000);
        } catch {
          // 알림을 못 쓰면 버전 비교로 대신한다.
          if (stopped) return;
          try {
            const m = await this.rpc('files/get_metadata', { path: this.path(id) });
            if (m.ok) {
              const rev = (await m.json()).rev;
              if (lastRev && rev !== lastRev) onChange();
              lastRev = rev;
            }
          } catch { /* 연결이 잠시 끊김 — 다음 차례에 다시 */ }
          await sleep(5000);
        }
      }
    };
    loop();
    return () => { stopped = true; };
  }
}

function sleep(ms        ) { return new Promise((r) => setTimeout(r, ms)); }
