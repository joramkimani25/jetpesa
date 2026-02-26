/**
 * CashPoa Unified Local Dev Server
 * ─────────────────────────────────────────────────────────────────
 *  Port 3000  →  Player app   (cashpoa.com/)
 *  Port 3001  →  Admin panel  (cashpoa.com admin/cashpoa.com/)
 *
 *  Both servers share ONE game loop and ONE SSE broadcast set.
 *  Admin Supabase calls are intercepted by a tiny fetch-patcher
 *  script injected into every admin HTML page and served locally.
 *
 *  Run: node server.js
 */

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─── MegaPay Config ───────────────────────────────────────────────────────────
const MEGAPAY_API_KEY = process.env.MEGAPAY_API_KEY || 'MGPYstmtnwjI';
const MEGAPAY_EMAIL   = process.env.MEGAPAY_EMAIL   || 'jramtech25@gmail.com';
const MEGAPAY_STK_URL = 'https://megapay.co.ke/backend/v1/initiatestk';
const MEGAPAY_STATUS_URL = 'https://megapay.co.ke/backend/v1/transactionstatus';

const MODE        = process.env.MODE || 'both'; // 'player' | 'admin' | 'both'
const PLAYER_PORT = process.env.PORT || 3000;
const ADMIN_PORT  = MODE === 'admin' ? (process.env.PORT || 3001) : 3001;
const PLAYER_DIR  = path.join(__dirname, 'cashpoa.com');
const ADMIN_DIR   = path.join(__dirname, 'cashpoa.com admin', 'cashpoa.com');

// ─── MIME Types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.webp': 'image/webp',
};

// ─── Game Config ──────────────────────────────────────────────────────────────
const CRASH_POOL = [
  2.31, 1.74, 4.12, 23.75, 2.88, 19.11, 1.52, 25.66, 3.41,
  26.7, 1.98, 25.05, 6.77, 20.91, 2.14, 17.4, 42.93, 3.65,
  24.35, 1.88, 18.5, 5.22, 31.2, 2.07, 27.8, 1.63, 22.1,
  8.14, 35.6, 2.55, 19.9, 3.9, 28.3, 1.77, 15.8, 7.3,
  44.1, 2.2, 21.7, 4.5, 17.8, 1.91, 33.4, 3.1, 26.1,
  2.44, 38.9, 5.8, 24.8, 1.55,
];
let queueIdx = 0;

const DOMAIN_ID  = 'ef4fa632-149c-4556-a356-cd762746d350';
const ALGORITHM  = 'greedy_1.05';
const WAIT_MS    = 8000;   // 8 s countdown
const CRASH_PAUSE= 5000;   // 5 s after crash
const TICK_MS    = 100;    // 100 ms tick rate

// Multiplier formula: m(t) = round(100 * (1 + 0.0055 * t^2.2)) / 100  (t in seconds)
function getMultiplierAtTime(seconds) {
  return Math.round(100 * (1 + 0.0055 * Math.pow(seconds, 2.2))) / 100;
}

function nextCrashPoint() {
  const cp = CRASH_POOL[queueIdx % CRASH_POOL.length];
  queueIdx++;
  return parseFloat(cp.toFixed(2));
}

function peekQueue(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    multiplier: CRASH_POOL[(queueIdx + i) % CRASH_POOL.length],
    status: 'pending',
    created_at: new Date().toISOString(),
    domain_id: DOMAIN_ID,
    server_seed: null,
    hash: null,
  }));
}

// ─── History ──────────────────────────────────────────────────────────────────
const history = [
  47.32, 23.53, 34.1, 29.14, 26.48, 28.12, 29.92,
  16.8, 42.2, 24.6, 21.9, 21.22, 19.46, 39.22,
].map(multiplier => ({
  id: crypto.randomUUID(),
  multiplier,
  timestamp: new Date(Date.now() - Math.random() * 120 * 60000).toISOString(),
  hash: null,
  server_seed: crypto.randomUUID(),
}));

// ─── Game State ───────────────────────────────────────────────────────────────
let game = {
  roundId:       crypto.randomUUID(),
  status:        'waiting',   // 'waiting' | 'flying' | 'crashed'
  multiplier:    1,
  startTime:     null,
  crashPoint:    nextCrashPoint(),
  nextEventTime: Date.now() + WAIT_MS,
};

// ─── Domain Settings (admin-editable at runtime) ──────────────────────────────
let domainSettings = {
  id: DOMAIN_ID,
  domain: 'cashpoa.com',
  brand_name: 'CashPoa',
  signal_url: 'sig',
  primary_color: '#000000',
  logo_url: '',
  payment_option: 'megapay',
  payment_option_config: { email: 'joeljujuu@gmail.com', api_key: 'MGPYPHcAsN7R' },
  enabledGameKeys: ['aviator'],
  enabled_game_keys: ['aviator'],
  min_crash_point: 15,
  max_crash_point: 50,
  instant_crash_pct: 33,
  platform_fee_balance: 0,
  is_active: true,
  spin_config: {
    mode: 'balanced', max_win: 1000,
    segments: [
      { color: '#ff0000', label: '0x',  value: 0,  weight: 50 },
      { color: '#00ff00', label: '2x',  value: 2,  weight: 30 },
      { color: '#0000ff', label: '5x',  value: 5,  weight: 15 },
      { color: '#ffff00', label: '10x', value: 10, weight: 5  },
    ],
    win_chance: 45,
  },
  crash_algorithm_id: 'afc653b0-29a9-4bc8-a424-e60191853f4c',
  game_mode_id: null,
  theme_id: null,
  organization_id: '7cff2a41-55ab-4e14-bbfb-ea0c977e2fe6',
  payment_settings: null,
  created_at: '2026-01-22T18:50:15.448743+00:00',
  updated_at: new Date().toISOString(),
};

const gameModes = [{
  id: '570b6b6e-b372-475a-9f6c-dbd64fcc96cf',
  key: 'impossible',
  name: 'House Always Wins',
  description: 'If there is one bet, the plane crashes at 1.00. If there is more than 1 bet, the first user to attempt a cashout crashes the plane for everyone.',
  win_chance: '0%',
  is_default: true,
  created_at: '2026-01-17T01:12:13.609288+00:00',
}];

const themes = [
  { id: '0faf5cab-9720-4d0b-9d51-dcc79702a984', key: 'aviator',    name: 'Classic Aviator', description: 'The classic plane theme',                      assets: { type: 'plane', background: 'space' },    created_at: '2026-01-17T01:00:47.201052+00:00' },
  { id: '71816169-71df-4c6f-93ef-133c2358ad8d', key: 'motorcycle', name: 'Neon Rider',      description: 'Futuristic motorcycle climbing a mountain', assets: { type: 'bike',  background: 'mountain' }, created_at: '2026-01-17T01:00:47.201052+00:00' },
  { id: '02baacf3-8de3-430c-b7d3-332e21f9e89e', key: 'desert',     name: 'Desert Rally',    description: null,                                        assets: { primaryColor: '#eab308', backgroundImage: '/images/desert-bg.png' }, created_at: '2026-01-17T09:37:45.68303+00:00' },
];

// ─── SSE Clients ──────────────────────────────────────────────────────────────
const clients = new Set();

function sendSSE(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  catch { clients.delete(res); }
}

function broadcast(event, data) {
  for (const c of clients) sendSSE(c, event, data);
}

// ─── Mock Users ───────────────────────────────────────────────────────────────
const users = new Map();

function makeUser(phone, username) {
  const id    = crypto.randomUUID();
  const token = 'mock_' + crypto.randomBytes(16).toString('hex');
  const user  = {
    id, username: username || `user_${phone.slice(-4)}`,
    phone, email: null,
    balance: 5000,
    referralCode: 'CASH' + Math.random().toString(36).substring(2, 6).toUpperCase(),
    accessToken: token,
    refreshToken: 'refresh_' + crypto.randomBytes(8).toString('hex'),
  };
  users.set(token, user);
  return user;
}

function getUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  return users.get(token) || null;
}

// ─── Pending Deposits (keyed by transaction_request_id) ──────────────────────
// Stores { userId, amount, token } until MegaPay webhook confirms payment
const pendingDeposits = new Map();

// ─── Game Loop ────────────────────────────────────────────────────────────────
function startWaiting() {
  const cp  = nextCrashPoint();
  const rid = crypto.randomUUID();
  const nextTime = Date.now() + WAIT_MS;

  game = { roundId: rid, status: 'waiting', multiplier: 1,
           startTime: null, crashPoint: cp, nextEventTime: nextTime };

  broadcast('round_start', {
    roundId: rid, nextEventTime: nextTime,
    predeterminedTarget: cp, queue: peekQueue(), algorithmKey: ALGORITHM,
  });
  broadcast('heartbeat', { status: 'WAITING', nextEventTime: nextTime });
  console.log(`\n[WAIT]   ${rid.slice(0, 8)} | crash @ ${cp}x | fly in ${WAIT_MS / 1000}s`);
  setTimeout(startFlying, WAIT_MS);
}

function startFlying() {
  const { roundId, crashPoint } = game;
  const startTime = Date.now();

  game.status     = 'flying';
  game.startTime  = startTime;
  game.multiplier = 1;
  game.nextEventTime = null;

  broadcast('fly', { roundId, startTime, target: crashPoint, algorithmKey: ALGORITHM });
  console.log(`[FLY]    ${roundId.slice(0, 8)} | target: ${crashPoint}x`);

  const timer = setInterval(() => {
    if (game.status !== 'flying' || game.roundId !== roundId) { clearInterval(timer); return; }
    const elapsed = (Date.now() - startTime) / 1000;
    const mult    = getMultiplierAtTime(elapsed);
    game.multiplier = mult;
    broadcast('tick', { roundId, multiplier: mult, elapsed: Date.now() - startTime, target: crashPoint, timestamp: Date.now() });
    if (mult >= crashPoint) { clearInterval(timer); doCrash(roundId, Math.min(mult, crashPoint)); }
  }, TICK_MS);
}

function doCrash(roundId, finalMult) {
  game.status     = 'crashed';
  game.multiplier = finalMult;
  const nextTime  = Date.now() + CRASH_PAUSE;
  game.nextEventTime = nextTime;

  history.unshift({ id: roundId, multiplier: finalMult,
                    timestamp: new Date().toISOString(),
                    hash: null, server_seed: crypto.randomUUID() });
  if (history.length > 20) history.pop();

  broadcast('crash', { roundId, multiplier: finalMult, nextEventTime: nextTime });
  console.log(`[CRASH]  ${roundId.slice(0, 8)} @ ${finalMult.toFixed(2)}x`);
  setTimeout(startWaiting, CRASH_PAUSE);
}

startWaiting();
setInterval(() => broadcast('heartbeat', { status: game.status.toUpperCase(), nextEventTime: game.nextEventTime }), 10000);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readBody(req, cb) {
  let raw = '';
  req.on('data', d => raw += d);
  req.on('end', () => { try { cb(JSON.parse(raw || '{}')); } catch { cb({}); } });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function gameStatePayload() {
  return {
    serverTime: new Date().toISOString(),
    round: {
      id: game.roundId,
      crash_multiplier: game.status === 'crashed' ? game.multiplier : null,
      status: game.status,
      started_at: game.startTime ? new Date(game.startTime).toISOString() : null,
      crashed_at: null,
      created_at: new Date().toISOString(),
      is_demo: false, user_id: null, server_seed: null,
      client_seed: 'worker_v1', domain_id: DOMAIN_ID, hash: null,
    },
    currentMultiplier: game.multiplier,
    startTime: game.startTime,
    history,
    queue: peekQueue(),
    nextEventTime: game.nextEventTime,
    nextEventType: game.status === 'waiting' ? 'FLY' : 'COUNTDOWN',
    target: game.crashPoint,
    predeterminedTarget: game.crashPoint,
    betCount: 0,
    algorithmKey: ALGORITHM,
    maxCrashPoint: domainSettings.max_crash_point,
  };
}

// ─── Shared API handler (used by both servers) ────────────────────────────────
function handleAPI(pathname, req, res) {
  if (pathname === '/api/health') {
    res.writeHead(200); res.end('OK'); return true;
  }

  if (pathname === '/api/game/state') {
    json(res, gameStatePayload()); return true;
  }

  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    clients.add(res);
    sendSSE(res, 'heartbeat', { status: game.status.toUpperCase(), nextEventTime: game.nextEventTime });
    req.on('close', () => clients.delete(res));
    req.on('error', () => clients.delete(res));
    return true;
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    readBody(req, body => {
      const user = makeUser(body.phone || '254700000000', body.username || null);
      json(res, { user: { id: user.id, username: user.username, phone: user.phone, email: null, referralCode: user.referralCode }, wallet: { balance: user.balance }, session: { accessToken: user.accessToken, refreshToken: user.refreshToken } });
    }); return true;
  }

  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    readBody(req, body => {
      const user = makeUser(body.phone || '254700000000', body.username || null);
      json(res, { user: { id: user.id, username: user.username, phone: user.phone, email: null, referralCode: user.referralCode }, wallet: { balance: user.balance }, session: { accessToken: user.accessToken, refreshToken: user.refreshToken } });
    }); return true;
  }

  if (pathname === '/api/auth/me') {
    const user = getUser(req);
    if (!user) { json(res, { error: 'Unauthorized' }, 401); return true; }
    json(res, { user: { id: user.id, username: user.username, phone: user.phone, email: null, referralCode: user.referralCode }, wallet: { balance: user.balance } });
    return true;
  }

  if (pathname === '/api/game/bet' && req.method === 'POST') {
    readBody(req, body => {
      const user   = getUser(req);
      const amount = Math.max(10, parseFloat(body.amount) || 10);
      if (user) user.balance = Math.max(0, user.balance - amount);
      json(res, { success: true, bet: { id: crypto.randomUUID(), amount, roundId: game.roundId }, newBalance: user ? user.balance : 5000 });
      broadcast('bet_placed', { roundId: game.roundId });
    }); return true;
  }

  if (pathname === '/api/game/cashout' && req.method === 'POST') {
    readBody(req, body => {
      const user   = getUser(req);
      const mult   = parseFloat(body.multiplier) || 1;
      const amount = parseFloat(body.amount) || 10;
      const payout = parseFloat((amount * mult).toFixed(2));
      if (user) user.balance += payout;
      json(res, { success: true, payout, newBalance: user ? user.balance : 5000 });
    }); return true;
  }

  if (pathname === '/api/referral/settings') {
    json(res, { referrer_bonus: 500, referee_bonus: 0, bonus_trigger: 'first_deposit', is_active: true, banner_text: 'Refer & Earn', banner_description: 'Get bonus when your friend makes their first deposit!' });
    return true;
  }

  if (pathname === '/api/mpesa/stkpush' && req.method === 'POST') {
    readBody(req, body => {
      const user   = getUser(req);
      const amount = Math.max(1, parseFloat(body.amount) || 100);
      // Normalize phone: accept 07xx, 2547xx, +2547xx
      let phone = String(body.phone || (user && user.phone) || '').replace(/\s+/g, '');
      if (phone.startsWith('+')) phone = phone.slice(1);
      if (phone.startsWith('0'))  phone = '254' + phone.slice(1);

      if (!phone || phone.length < 12) {
        json(res, { success: false, message: 'Valid phone number required' }, 400);
        return;
      }

      const reference = 'DEP' + Date.now();
      const payload   = JSON.stringify({
        api_key:   MEGAPAY_API_KEY,
        email:     MEGAPAY_EMAIL,
        amount:    String(amount),
        msisdn:    phone,
        reference,
      });

      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };

      const mpReq = https.request(MEGAPAY_STK_URL, options, mpRes => {
        let raw = '';
        mpRes.on('data', d => raw += d);
        mpRes.on('end', () => {
          let result;
          try { result = JSON.parse(raw); } catch { result = {}; }
          console.log('[MegaPay STK]', result);

          if (result.success === '200' || result.success === 200) {
            // Store pending deposit so webhook can credit the user
            if (user) {
              pendingDeposits.set(result.transaction_request_id, {
                userId: user.id,
                token:  user.accessToken,
                amount,
              });
            }
            json(res, {
              success:              true,
              message:              `STK Push sent to ${phone}. Enter your M-Pesa PIN to complete.`,
              transaction_request_id: result.transaction_request_id,
              CheckoutRequestID:    result.transaction_request_id,
            });
          } else {
            json(res, { success: false, message: result.message || result.massage || 'Failed to initiate STK push. Try again.' }, 502);
          }
        });
      });

      mpReq.on('error', err => {
        console.error('[MegaPay STK error]', err.message);
        json(res, { success: false, message: 'Could not reach MegaPay. Please try again.' }, 502);
      });
      mpReq.write(payload);
      mpReq.end();
    }); return true;
  }

  // ── MegaPay Webhook (set this URL in your MegaPay dashboard) ───────────────
  // URL: https://cashpoa-production.up.railway.app/api/mpesa/webhook
  if (pathname === '/api/mpesa/webhook' && req.method === 'POST') {
    readBody(req, body => {
      console.log('[MegaPay Webhook]', JSON.stringify(body));
      const code = parseInt(body.ResponseCode);
      if (code === 0) {
        // Successful payment — find the pending deposit and credit user
        const pending = pendingDeposits.get(body.TransactionID) ||
                        pendingDeposits.get(body.CheckoutRequestID);
        if (pending) {
          const user = users.get(pending.token);
          if (user) {
            user.balance += pending.amount;
            console.log(`[MegaPay] Credited KES ${pending.amount} to ${user.username} | new balance: ${user.balance}`);
          }
          pendingDeposits.delete(body.TransactionID);
          pendingDeposits.delete(body.CheckoutRequestID);
        }
      } else {
        console.log(`[MegaPay] Payment failed: ${body.ResponseDescription} (code ${code})`);
        pendingDeposits.delete(body.TransactionID);
      }
      // Always respond 200 to acknowledge
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'received' }));
    }); return true;
  }

  // ── MegaPay Transaction Status Poll ────────────────────────────────────────
  if (pathname === '/api/mpesa/status' && req.method === 'POST') {
    readBody(req, body => {
      if (!body.transaction_request_id) {
        json(res, { success: false, message: 'transaction_request_id required' }, 400);
        return;
      }
      const payload = JSON.stringify({
        api_key:                MEGAPAY_API_KEY,
        email:                  MEGAPAY_EMAIL,
        transaction_request_id: body.transaction_request_id,
      });
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };
      const mpReq = https.request(MEGAPAY_STATUS_URL, options, mpRes => {
        let raw = '';
        mpRes.on('data', d => raw += d);
        mpRes.on('end', () => {
          let result;
          try { result = JSON.parse(raw); } catch { result = {}; }
          console.log('[MegaPay Status]', result);
          // If completed and not yet credited via webhook, credit now
          if (result.TransactionStatus === 'Completed' && result.TransactionCode === '0') {
            const pending = pendingDeposits.get(body.transaction_request_id);
            if (pending) {
              const user = users.get(pending.token);
              if (user) {
                user.balance += pending.amount;
                console.log(`[MegaPay Status] Credited KES ${pending.amount} to ${user.username}`);
                result._credited = true;
                result._newBalance = user.balance;
              }
              pendingDeposits.delete(body.transaction_request_id);
            }
          }
          json(res, result);
        });
      });
      mpReq.on('error', err => {
        json(res, { success: false, message: 'Could not reach MegaPay.' }, 502);
      });
      mpReq.write(payload);
      mpReq.end();
    }); return true;
  }

  if (pathname === '/api/wallet/withdraw' && req.method === 'POST') {
    readBody(req, body => {
      const amount = parseFloat(body.amount) || 100;
      const user   = getUser(req);
      if (user) user.balance = Math.max(0, user.balance - amount);
      json(res, { success: true, message: `Demo: KES ${amount} withdrawal queued`, newBalance: user ? user.balance : 0 });
    }); return true;
  }

  if (pathname === '/api/broadcast' && req.method === 'POST') {
    readBody(req, body => {
      if (body.event && body.data) broadcast(body.event, body.data);
      json(res, { ok: true });
    }); return true;
  }

  // ── Admin-only: force a crash at a specific multiplier ─────────────────────
  if (pathname === '/api/admin/force-crash' && req.method === 'POST') {
    readBody(req, body => {
      const at = parseFloat(body.at) || 1.5;
      if (game.status === 'flying') {
        doCrash(game.roundId, at);
        json(res, { ok: true, crashed_at: at });
      } else {
        json(res, { ok: false, error: `Game is not flying (current: ${game.status})` }, 400);
      }
    }); return true;
  }

  // ── Admin-only: replace crash pool ─────────────────────────────────────────
  if (pathname === '/api/admin/crash-pool' && req.method === 'POST') {
    readBody(req, body => {
      if (Array.isArray(body.pool) && body.pool.length > 0) {
        CRASH_POOL.length = 0;
        body.pool.forEach(x => CRASH_POOL.push(parseFloat(x)));
        queueIdx = 0;
        console.log('[Admin] Crash pool updated:', CRASH_POOL.slice(0, 5), '...');
        json(res, { ok: true, pool: CRASH_POOL });
      } else {
        json(res, { ok: false, error: 'Provide { pool: [number, ...] }' }, 400);
      }
    }); return true;
  }

  return false; // not handled
}

// ─── Mock Supabase REST endpoints (admin panel) ───────────────────────────────
function handleSupabase(pathname, req, res) {
  if (pathname === '/rest/v1/domain_settings') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      json(res, [domainSettings]); return true;
    }
    if (req.method === 'PATCH' || req.method === 'PUT') {
      readBody(req, body => {
        Object.assign(domainSettings, body, { updated_at: new Date().toISOString() });
        console.log('[Admin] domain_settings updated:', Object.keys(body).join(', '));
        json(res, [domainSettings]);
      }); return true;
    }
  }

  if (pathname === '/rest/v1/game_modes') {
    json(res, gameModes); return true;
  }

  if (pathname === '/rest/v1/themes') {
    json(res, themes); return true;
  }

  // Supabase auth stub (admin panel may call /auth/v1/*)
  if (pathname.startsWith('/auth/v1/')) {
    json(res, { access_token: 'mock_admin_' + Date.now(), token_type: 'bearer',
                user: { id: 'admin-001', email: 'admin@cashpoa.com', role: 'admin' } });
    return true;
  }

  return false;
}

// ─── Fetch-interceptor injected into every admin HTML page ───────────────────
// Rewrites browser calls to xckttcubxhxnueeggzvm.supabase.co → admin server
const ADMIN_PUBLIC_URL = process.env.ADMIN_PUBLIC_URL || `http://localhost:${ADMIN_PORT}`;
const FETCH_INTERCEPTOR = `<script>
/* CashPoa: proxy Supabase → admin server */
(function(){
  var H='xckttcubxhxnueeggzvm.supabase.co';
  var L='${ADMIN_PUBLIC_URL}';
  var _f=window.fetch.bind(window);
  window.fetch=function(i,o){
    var u=(i instanceof Request)?i.url:String(i);
    if(u.indexOf(H)!==-1){
      var p=new URL(u);
      var loc=L+p.pathname+p.search;
      i=(i instanceof Request)?new Request(loc,{method:i.method,headers:i.headers,body:i.body,mode:'cors',credentials:'omit'}):loc;
    }
    return _f(i,o);
  };
  var _x=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(){
    var a=Array.prototype.slice.call(arguments);
    if(typeof a[1]==='string'&&a[1].indexOf(H)!==-1){
      var p=new URL(a[1]);a[1]=L+p.pathname+p.search;
    }
    return _x.apply(this,a);
  };
})();
</script>`;

// ─── Static file server ───────────────────────────────────────────────────────
function serveStatic(staticDir, pathname, res, isAdmin) {
  let filePath;

  if (pathname === '/' || pathname === '') {
    // Player root → aviator game; Admin root → sig (operator panel)
    filePath = path.join(staticDir, isAdmin ? 'sig.html' : 'aviator.html');
  } else {
    filePath = path.join(staticDir, pathname);
    // Security: block path traversal
    if (!filePath.startsWith(staticDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  }

  // Directory → try index.html inside
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Extension-less routes (e.g. /sig, /aviator) → try .html
  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    const withHtml = filePath + '.html';
    if (fs.existsSync(withHtml)) filePath = withHtml;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 – Not Found: ' + pathname);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    // Inject the Supabase proxy into every HTML page served by the admin server
    if (isAdmin && ext === '.html') {
      let html = data.toString('utf8');
      html = html.replace('<head>', '<head>' + FETCH_INTERCEPTOR);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(html);
    } else {
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    }
  });
}

// ─── Player server  (port 3000) ───────────────────────────────────────────────
const playerServer = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PLAYER_PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (handleAPI(pathname, req, res)) return;
  serveStatic(PLAYER_DIR, pathname, res, false);
});

// ─── Admin server  (port 3001) ────────────────────────────────────────────────
const adminServer = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${ADMIN_PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Prefer, x-client-info');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (handleAPI(pathname, req, res)) return;
  if (handleSupabase(pathname, req, res)) return;
  serveStatic(ADMIN_DIR, pathname, res, true);
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (MODE === 'player' || MODE === 'both') {
  playerServer.listen(PLAYER_PORT, () => {
    console.log(`🎮 Player App  → http://localhost:${PLAYER_PORT}`);
  });
}

if (MODE === 'admin' || MODE === 'both') {
  adminServer.listen(ADMIN_PORT, () => {
    console.log(`🛠️  Admin Panel → http://localhost:${ADMIN_PORT}`);
  });
}
