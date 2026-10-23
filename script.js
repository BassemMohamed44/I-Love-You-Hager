try { if (localStorage.getItem("loveSiteDarkMode") === "true") { document.body.classList.add("dark-mode"); } } catch (e) { }
    

/* =====================================================================
   LOGIC — no DOM here, so it can be tested in Node (tests/logic.test.mjs).
   - progress: what was discovered, visit days, last surprise (ids only, never the private text)
   - unlock conditions shared by planets and achievements
   - surprise picker: random, never repeats a recent one, prefers ones not shown yet
   ===================================================================== */
const LoveLogic = (() => {
    'use strict';

    const SET_KEYS = ['story', 'openWhen', 'stars', 'letter', 'surprise', 'challenge', 'game', 'planetSeen', 'adv', 'advDone', 'tod', 'mood'];
const TODS = ['dawn', 'morning', 'afternoon', 'evening', 'night'];
const MOOD_TTL = 6 * 60 * 60 * 1000;      // a chosen mood is remembered for 6 hours
    const RECENT_MAX = 8;
    const VISIT_GAP = 30 * 60 * 1000;      // reloads within 30 minutes are the same visit

    const pad = n => String(n).padStart(2, '0');
    function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

    /* ---------------- progress ---------------- */
    function emptyProgress() {
        const sets = {};
        SET_KEYS.forEach(k => { sets[k] = []; });
        return { v: 1, sets, days: [], visits: 0, lastVisitAt: 0, planets: [], earned: {}, hints: {}, live: { mood: '', moodAt: 0, last: {}, greet: null }, s: { recent: [], shown: {}, last: null, current: null } };
    }
    const strArr = (a, max) => Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, max || 500) : [];
    const num = (x, d) => (typeof x === 'number' && isFinite(x)) ? x : d;

    /* anything read from storage is untrusted: rebuild a clean object from it */
    function normalize(raw) {
        const p = emptyProgress();
        if (!raw || typeof raw !== 'object') return p;
        SET_KEYS.forEach(k => { p.sets[k] = strArr(raw.sets && raw.sets[k]); });
        p.days = strArr(raw.days, 800);
        p.visits = Math.max(0, Math.floor(num(raw.visits, 0)));
        p.lastVisitAt = num(raw.lastVisitAt, 0);
        p.planets = strArr(raw.planets);
        if (raw.earned && typeof raw.earned === 'object') {
            Object.keys(raw.earned).slice(0, 200).forEach(k => { if (typeof raw.earned[k] === 'number') p.earned[k] = raw.earned[k]; });
        }
        if (raw.hints && typeof raw.hints === 'object') {
            Object.keys(raw.hints).slice(0, 100).forEach(k => { const n = raw.hints[k]; if (typeof n === 'number' && isFinite(n)) p.hints[k] = Math.min(20, Math.max(0, Math.floor(n))); });
        }
        const lv = raw.live && typeof raw.live === 'object' ? raw.live : {};
        p.live.mood = typeof lv.mood === 'string' ? lv.mood.slice(0, 40) : '';
        p.live.moodAt = num(lv.moodAt, 0);
        if (lv.last && typeof lv.last === 'object') {
            Object.keys(lv.last).slice(0, 100).forEach(k => { const n = lv.last[k]; if (typeof n === 'number' && isFinite(n) && n >= 0) p.live.last[k] = Math.floor(n); });
        }
        if (lv.greet && typeof lv.greet === 'object' && typeof lv.greet.tod === 'string') {
            p.live.greet = { tod: lv.greet.tod, i: Math.max(0, Math.floor(num(lv.greet.i, 0))), v: Math.floor(num(lv.greet.v, 0)) };
        }
        const s = raw.s && typeof raw.s === 'object' ? raw.s : {};
        p.s.recent = strArr(s.recent, RECENT_MAX);
        if (s.shown && typeof s.shown === 'object') {
            Object.keys(s.shown).slice(0, 500).forEach(k => { if (typeof s.shown[k] === 'number') p.s.shown[k] = s.shown[k]; });
        }
        if (s.last && typeof s.last.id === 'string') p.s.last = { id: s.last.id, at: num(s.last.at, 0) };
        if (s.current && typeof s.current.id === 'string') p.s.current = { id: s.current.id, at: num(s.current.at, 0), opened: !!s.current.opened };
        return p;
    }

    const has = (p, kind, id) => p.sets[kind].indexOf(id) !== -1;
    function add(p, kind, id) { if (has(p, kind, id)) return false; p.sets[kind].push(id); return true; }

    /* a new visit = first one ever, or 30+ minutes since the last time the site was opened */
    function touchVisit(p, now) {
        now = now || Date.now();
        const isNew = !p.lastVisitAt || now - p.lastVisitAt > VISIT_GAP || p.lastVisitAt > now;
        if (isNew) p.visits++;
        p.lastVisitAt = now;
        const k = dayKey(new Date(now));
        if (p.days.indexOf(k) === -1) p.days.push(k);
        return isNew;
    }

    /* ---------------- unlock conditions ----------------
       { type: 'always' }
       { type: 'story' | 'openWhen' | 'stars' | 'surprise' | 'challenge', count: N | 'all' }
       { type: 'adv', count: N | 'all' }  stages solved in the secret adventure
       { type: 'advDone' }  the adventure's final surprise opened
       { type: 'tod', count: N }  different times of day visited (dawn/morning/afternoon/evening/night)
       { type: 'mood', count: N }  different moods tried
       { type: 'letter' }  { type: 'game', id: 'match' }
       { type: 'days', count: N }  { type: 'visits', count: N }
       { type: 'planets', count: N | 'all' }                                            */
    const COUNTED = ['story', 'openWhen', 'stars', 'surprise', 'challenge', 'adv', 'tod', 'mood'];
    const TYPES = COUNTED.concat(['always', 'letter', 'game', 'days', 'visits', 'planets', 'advDone']);

    /* ctx.valid[kind] = ids that exist right now (so removed content never counts) */
    function measure(u, p, ctx, extra) {
        const t = u && u.type;
        if (t === 'always') return { have: 1, need: 1 };
        if (COUNTED.indexOf(t) !== -1) {
            const valid = (ctx.valid && ctx.valid[t]) || [];
            const n = u.count === 'all' ? valid.length : Math.min(Math.max(1, Math.floor(+u.count) || 1), valid.length);
            const have = p.sets[t].filter(id => valid.indexOf(id) !== -1).length;
            return { have: Math.min(have, n), need: n };
        }
        if (t === 'advDone') return { have: has(p, 'advDone', 'finale') ? 1 : 0, need: 1 };
        if (t === 'letter') return { have: has(p, 'letter', 'letter') ? 1 : 0, need: 1 };
        if (t === 'game') return { have: has(p, 'game', u.id || 'match') ? 1 : 0, need: 1 };
        if (t === 'days' || t === 'visits') {
            const n = Math.max(1, Math.floor(+u.count) || 1);
            const v = t === 'days' ? p.days.length : p.visits;
            return { have: Math.min(v, n), need: n };
        }
        if (t === 'planets') {
            const total = extra.planetsTotal;
            const n = u.count === 'all' ? total : Math.min(Math.max(1, Math.floor(+u.count) || 1), total);
            return { have: Math.min(extra.planetsHave, n), need: n };
        }
        return { have: 0, need: 1, unknown: true };      // unknown type: never unlocks
    }

    /* items: [{ id, unlock }]. Planets may depend on other planets, so they are resolved to a fixed point.
       Achievements get opts.planetsHave / opts.planetsTotal instead. */
    function evaluate(items, p, ctx, opts) {
        opts = opts || {};
        const out = {};
        const planetList = !!opts.planetList;
        const total = planetList ? Math.max(0, items.length - 1) : (opts.planetsTotal || 0);
        const have0 = planetList ? 0 : (opts.planetsHave || 0);
        items.forEach(it => {
            const m = measure(it.unlock || { type: 'always' }, p, ctx, { planetsHave: have0, planetsTotal: total });
            out[it.id] = Object.assign(m, { unlocked: m.have >= m.need });
        });
        if (planetList) {
            for (let round = 0; round <= items.length; round++) {
                let changed = false;
                items.forEach(it => {
                    if (!it.unlock || it.unlock.type !== 'planets') return;
                    const h = items.filter(o => o.id !== it.id && out[o.id].unlocked).length;
                    const m = measure(it.unlock, p, ctx, { planetsHave: h, planetsTotal: total });
                    const unlocked = m.have >= m.need;
                    if (unlocked !== out[it.id].unlocked || m.have !== out[it.id].have) {
                        Object.assign(out[it.id], m, { unlocked });
                        changed = true;
                    }
                });
                if (!changed) break;
            }
        }
        return out;
    }

    /* readable condition, Egyptian Arabic */
    function cnt(n, one, two, many) { return n === 1 ? one : n === 2 ? two : n + ' ' + many; }
    function describe(u, n, forPlanet) {
        u = u || { type: 'always' };
        const all = u.count === 'all';
        switch (u.type) {
            case 'always': return 'مفتوح من أول زيارة';
            case 'story': return all ? 'افتحي كل ذكريات «حكايتنا»' : 'افتحي ' + cnt(n, 'ذكرى', 'ذكريتين', 'ذكريات') + ' من «حكايتنا»';
            case 'openWhen': return all ? 'افتحي كل رسايل «افتحيني لما…»' : 'افتحي ' + cnt(n, 'رسالة', 'رسالتين', 'رسايل') + ' من «افتحيني لما…»';
            case 'stars': return all ? 'اكتشفي كل نجوم «سماء النجوم»' : 'اكتشفي ' + cnt(n, 'نجمة', 'نجمتين', 'نجوم') + ' في «سماء النجوم»';
            case 'letter': return 'افتحي الظرف في «رسالة حب»';
            case 'days': return 'زوري الموقع في ' + (n === 2 ? 'يومين مختلفين' : n + (n <= 10 ? ' أيام مختلفة' : ' يوم مختلف'));
            case 'visits': return 'زوري الموقع ' + (n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n + (n <= 10 ? ' مرات' : ' مرة'));
            case 'surprise': return all ? 'افتحي كل مفاجآت الزيارة' : 'افتحي ' + cnt(n, 'مفاجأة', 'مفاجأتين', 'مفاجآت') + ' من مفاجآت الزيارة';
            case 'challenge': return all ? 'اقبلي كل التحديات' : 'اقبلي ' + cnt(n, 'تحدي', 'تحديين', 'تحديات') + ' من مفاجآت الزيارة';
            case 'adv': return all ? 'خلّصي مراحل المغامرة السرية كلها' : 'حلّي ' + cnt(n, 'مرحلة', 'مرحلتين', 'مراحل') + ' من المغامرة السرية';
            case 'advDone': return 'وصلي لمفاجأة المغامرة السرية الأخيرة';
            case 'tod': return 'زوري الموقع في ' + cnt(n, 'وقت', 'وقتين مختلفين', 'أوقات مختلفة') + ' من اليوم (صبح، نهار، غروب، ليل…)';
            case 'mood': return 'جرّبي ' + cnt(n, 'اختيار', 'اختيارين', 'اختيارات') + ' من «إنتي حاسّة بإيه؟»';
            case 'game': return 'اكسبي لعبة الذاكرة في «عالمنا»';
            case 'planets': return all ? (forPlanet ? 'افتحي كل الكواكب التانية' : 'افتحي كل الكواكب') : 'افتحي ' + cnt(n, 'كوكب', 'كوكبين', 'كواكب');
            default: return 'شرط غير معروف';
        }
    }

    /* ---------------- surprise picker ----------------
       list: [{ id, type }]   s: progress.s
       1) skip the last few shown (window grows with the list, max 5)
       2) prefer ones never shown (so the first N visits show every surprise once)
       3) prefer a different type from the previous one
       4) random among what is left                                               */
    function windowSize(n) { return n <= 1 ? 0 : Math.max(1, Math.min(5, Math.floor((n - 1) / 2))); }

    function pickSurprise(list, s, rnd) {
        rnd = rnd || Math.random;
        if (!list.length) return null;
        const w = windowSize(list.length);
        const recent = new Set(w > 0 ? s.recent.slice(-w) : []);
        const lastId = s.last && s.last.id;
        let pool = list.filter(x => !recent.has(x.id));
        if (!pool.length) pool = list.filter(x => x.id !== lastId);
        if (!pool.length) pool = list.slice();
        const fresh = pool.filter(x => !(s.shown[x.id] > 0));
        if (fresh.length) pool = fresh;
        const lastItem = lastId ? list.find(x => x.id === lastId) : null;
        if (lastItem) {
            const other = pool.filter(x => x.type !== lastItem.type);
            if (other.length) pool = other;
        }
        return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
    }

    function recordShown(s, id, now) {
        s.shown[id] = (s.shown[id] || 0) + 1;
        s.recent.push(id);
        while (s.recent.length > RECENT_MAX) s.recent.shift();
        s.last = { id, at: now };
    }

    /* the gift for this visit: same one after a reload, a new one on a new visit */
    function ensureSurprise(p, list, isNewVisit, now, rnd) {
        if (!list.length) { p.s.current = null; return null; }
        const cur = p.s.current;
        const same = cur && list.find(x => x.id === cur.id);
        if (same && !isNewVisit) return same;
        const item = pickSurprise(list, p.s, rnd);
        recordShown(p.s, item.id, now);
        p.s.current = { id: item.id, at: now, opened: false };
        return item;
    }


    /* ---------------- secret adventure: reading answers ----------------
       Arabic typing varies (أ/ا, ة/ه, ى/ي, tashkeel, "ال", Arabic digits, spaces, punctuation),
       so both sides are reduced to the same plain form before comparing. */
    function canon(str) {
        let s = String(str == null ? '' : str).normalize('NFKC').toLowerCase()
            .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
            .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
            .replace(/[ً-ٰٟـ]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
        return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
            .map(w => w.replace(/^ال(?=.{2,})/, '')).join('');
    }
    function answers(stage) {
        const a = stage && (Array.isArray(stage.answers) ? stage.answers : stage.answer != null ? [stage.answer] : []);
        return (a || []).map(canon).filter(Boolean);
    }
    function checkAnswer(stage, input) {
        const c = canon(input);
        return !!c && answers(stage).indexOf(c) !== -1;
    }
    /* hints are handed out one at a time and remembered: returns the new count */
    function useHint(p, stageId, total) {
        const n = p.hints[stageId] || 0;
        if (n >= total) return n;
        p.hints[stageId] = n + 1;
        return n + 1;
    }
    /* the stage the player is on: first unsolved, or -1 when all are solved */
    function currentStage(p, stages) {
        for (let i = 0; i < stages.length; i++) if (!has(p, 'adv', stages[i].id)) return i;
        return -1;
    }

    /* ---------------- live scene: time of day, mood, lines ---------------- */
    function partOfDay(date) {
        const h = (date || new Date()).getHours();
        return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 20 ? 'evening' : 'night';
    }
    /* a chosen mood counts for 6 hours (and never from the future) */
    function activeMood(p, now) {
        now = now || Date.now();
        const l = p.live;
        return l.mood && l.moodAt <= now && now - l.moodAt <= MOOD_TTL ? l.mood : '';
    }
    /* pick an index from a list of n lines without repeating the previous one for this key */
    function pickLine(p, key, n, rnd) {
        rnd = rnd || Math.random;
        if (n <= 0) return -1;
        const prev = p.live.last[key];
        let i = Math.min(n - 1, Math.floor(rnd() * n));
        if (n > 1 && i === prev) i = (i + 1 + Math.floor(rnd() * (n - 1))) % n;
        p.live.last[key] = i;
        return i;
    }
    /* the welcome line: the same one for the whole visit, a new one on a new visit or a new time of day */
    function greetingIndex(p, tod, n, rnd) {
        if (n <= 0) return -1;
        const g = p.live.greet;
        if (g && g.tod === tod && g.v === p.visits && g.i < n) return g.i;
        const i = pickLine(p, 'greet-' + tod, n, rnd);
        p.live.greet = { tod, i, v: p.visits };
        return i;
    }

    const api = { MOOD_TTL, TODS, canon, answers, checkAnswer, useHint, currentStage, partOfDay, activeMood, pickLine, greetingIndex, SET_KEYS, TYPES, VISIT_GAP, RECENT_MAX, dayKey, emptyProgress, normalize, has, add, touchVisit, measure, evaluate, describe, windowSize, pickSurprise, recordShown, ensureSurprise };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return api;
})();
    

/* =====================================================================
   CHAT — Firebase Realtime Database (same paths as before: /messages, /typing, /archiveLinks)
   New: sent/sending/failed states, offline banner, paging of old messages,
        safe image sending (/chatImages), random-message hook.
   ===================================================================== */
(() => {
    'use strict';

    const $ = (s, r = document) => r.querySelector(s);
    const NAME_1 = 'حبيبي', NAME_2 = 'بنوتي';
    const PAGE = 30;                       // messages per page
    const IMG_TEXT = '📷 صورة';              // fallback text so older clients (e.g. the Flutter app) still show something
    const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
    const FULL_MAX = 1280, FULL_BYTES = 420 * 1024, THUMB_MAX = 320, THUMB_BYTES = 40 * 1024;

    window.LoveApp = window.LoveApp || {};

    /* ---------- Firebase ---------- */
    const firebaseConfig = {
        apiKey: "AIzaSyBRkw4p3YW-MJ3TRfi26CvNM8TxouO1ZTQ",
        authDomain: "love-chat-58ac0.firebaseapp.com",
        databaseURL: "https://love-chat-58ac0-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "love-chat-58ac0",
        storageBucket: "love-chat-58ac0.firebasestorage.app",
        messagingSenderId: "1056484581987",
        appId: "1:1056484581987:web:9918f5fe99c28792e14e56"
    };
    let db = null, chatRef = null, typingRef = null, archiveLinksRef = null;
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        chatRef = db.ref('messages');
        typingRef = db.ref('typing');
        archiveLinksRef = db.ref('archiveLinks');
    } catch (e) { console.warn('Firebase unavailable', e); }

    /* ---------- elements ---------- */
    const overlay = $('#chat-overlay'), blocked = $('#chat-blocked-screen'), win = $('#chat-window');
    const scroll = $('#chat-scroll'), list = $('#chat-messages'), olderEl = $('#chat-older');
    const skeleton = $('#chat-skeleton'), emptyEl = $('#chat-empty'), jump = $('#jump-latest');
    const input = $('#chat-input'), sendBtn = $('#chat-send'), attachBtn = $('#attachBtn'), fileInput = $('#file-input');
    const banner = $('#conn-banner'), bannerText = $('#conn-text'), bannerRetry = $('#conn-retry');
    const statusEl = $('#chat-status'), typingEl = $('#typing-indicator');
    const replyBox = $('#reply-preview'), replyText = $('#reply-preview-text');
    const imgBox = $('#img-preview'), imgThumb = $('#img-preview-thumb'), imgInfo = $('#img-preview-info');
    const archiveWin = $('#archive-window'), archiveDetail = $('#archive-detail-window');
    const archiveListEl = $('#archive-list'), archiveMsgs = $('#archive-detail-messages');
    const backupBtn = $('#backupNowBtn');

    /* ---------- state ---------- */
    let myName = (() => { try { return localStorage.getItem('loveChatName'); } catch (_) { return null; } })() || null;
    const msgs = new Map();      // key -> message object
    const els = new Map();       // key -> row element (reused between renders)
    const pending = new Map();   // key -> { payload, image, state: 'sending' | 'failed' }
    const imgCache = new Map();  // key -> full data URL
    let oldestKey = null, hasMore = true, loadingOlder = false, initialLoaded = false, started = false;
    let loadToken = 0, liveQuery = null, unread = 0;
    let replyTarget = null, readyImage = null, imageBusy = false;
    let online = navigator.onLine !== false, fbUp = true, connTimer = null, bannerTimer = null, wasDown = false;

    /* =================================================================
       identity (unchanged behaviour)
       ================================================================= */
    window.maybeAskIdentity = function (v1, v2) {
        if (myName) return;
        const ov = $('#identity-overlay'), opts = $('#identity-options');
        opts.textContent = '';
        [[v1, NAME_1], [v2, NAME_2]].forEach(([d, n]) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'name-btn'; b.textContent = d + ' (' + n + ')';
            b.addEventListener('click', () => { myName = n; try { localStorage.setItem('loveChatName', n); } catch (_) { } ov.classList.remove('visible'); });
            opts.appendChild(b);
        });
        ov.classList.add('visible');
    };

    /* =================================================================
       open / close
       ================================================================= */
    function isUnlocked() { return window.__siteUnlocked === true; }
    function showChat() {
        if (!isUnlocked()) return;
        overlay.classList.add('visible');
        archiveWin.classList.remove('visible'); archiveDetail.classList.remove('visible');
        if (!myName) { blocked.classList.add('visible'); win.classList.remove('visible'); return; }
        blocked.classList.remove('visible'); win.classList.add('visible');
        if (!started) { started = true; startChat(); }
        else if (nearBottom()) scrollToBottom();
        if (!input.disabled) input.focus({ preventScroll: true });
    }
    function hideChat() {
        overlay.classList.remove('visible');
        archiveWin.classList.remove('visible'); archiveDetail.classList.remove('visible');
        lightboxClose(true);
    }
    $('#openChatBtn').addEventListener('click', e => { e.preventDefault(); showChat(); });
    $('#closeChatBtn').addEventListener('click', hideChat);
    overlay.addEventListener('click', e => { if (e.target === overlay) hideChat(); });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !overlay.classList.contains('visible')) return;
        if (document.querySelector('.modal.open')) return;
        if ($('#lightbox').classList.contains('show')) { lightboxClose(); return; }
        if (archiveDetail.classList.contains('visible')) { showArchiveList(); return; }
        if (archiveWin.classList.contains('visible')) { hideArchiveList(); return; }
        hideChat();
    });
    window.LoveApp.openChat = showChat;
    let pendingFill = null;     // text handed over while the chat is still loading for the first time
    function applyFill(text) {
        input.value = text;
        input.focus();
        input.dispatchEvent(new Event('input'));
        refreshSend();
    }
    window.LoveApp.fillInput = function (text) {
        showChat();
        if (!myName) return;
        text = String(text || '');
        if (input.disabled) { pendingFill = text; return; }      // filled as soon as the chat is ready
        applyFill(text);
    };
    $('#randomBtn').addEventListener('click', () => { if (window.LoveApp.randomMessage) window.LoveApp.randomMessage(); });

    /* =================================================================
       connection state
       ================================================================= */
    function upNow() { return online && fbUp; }
    function setBanner(kind, text, retry) {
        clearTimeout(bannerTimer);
        if (!kind) { banner.className = 'conn-banner'; return; }
        banner.className = 'conn-banner show ' + kind;
        bannerText.textContent = text;
        bannerRetry.hidden = !retry;
        bannerRetry.onclick = retry || null;
    }
    function updateConn() {
        clearTimeout(connTimer);
        if (upNow()) {
            statusEl.className = 'chat-status'; statusEl.textContent = 'متصل';
            if (wasDown) {
                wasDown = false;
                setBanner('ok', 'رجع الاتصال ✓');
                bannerTimer = setTimeout(() => setBanner(null), 2600);
            }
            refreshAllStates();
            return;
        }
        statusEl.className = 'chat-status ' + (online ? 'connecting' : 'offline');
        statusEl.textContent = online ? 'بيحاول يتصل…' : 'مفيش إنترنت';
        // wait a moment so short hiccups do not flash a banner
        connTimer = setTimeout(() => {
            if (upNow()) return;
            wasDown = true;
            setBanner('offline', online
                ? 'بنحاول نتصل بالسيرفر… الرسايل هتتبعت أول ما نتصل.'
                : 'مفيش إنترنت. الرسايل اللي بتكتبيها هتتبعت أول ما يرجع، بس ما تقفليش الصفحة.');
            refreshAllStates();
        }, online ? 3500 : 800);
    }
    window.addEventListener('online', () => { online = true; updateConn(); });
    window.addEventListener('offline', () => { online = false; updateConn(); });
    if (db) {
        db.ref('.info/connected').on('value', s => { fbUp = s.val() === true; updateConn(); });
    }
    window.addEventListener('beforeunload', e => {
        if (pending.size) { e.preventDefault(); e.returnValue = ''; }
        setTyping(false);
    });

    /* =================================================================
       start: first page, then live listener
       ================================================================= */
    function withTimeout(promise, ms) {
        return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('timeout')), ms);
            promise.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
        });
    }
    function setLoading(on) {
        skeleton.classList.toggle('show', on);
        input.disabled = on; attachBtn.disabled = on;
        if (on) emptyEl.style.display = 'none';
        refreshSend();
    }

    async function startChat() {
        if (!db) { setLoading(false); setBanner('error', 'مش قادرين نوصل لخدمة الشات. اتأكدي من الإنترنت وحدّثي الصفحة.', () => location.reload()); return; }
        const token = ++loadToken;
        setLoading(true); setBanner(null);
        try {
            const snap = await withTimeout(chatRef.orderByKey().limitToLast(PAGE).once('value'), 15000);
            if (token !== loadToken) return;
            const items = [];
            snap.forEach(c => { items.push([c.key, c.val()]); });
            items.forEach(([k, v]) => { if (v && typeof v === 'object') msgs.set(k, v); });
            hasMore = items.length >= PAGE;
            oldestKey = items.length ? items[0][0] : null;
            initialLoaded = true;
            setLoading(false);
            renderList({ bottom: true });
            if (pendingFill !== null) { const t = pendingFill; pendingFill = null; if (!input.disabled) applyFill(t); }
            attachLive(items.length ? items[items.length - 1][0] : null);
            listenTyping();
            if (!input.disabled && overlay.classList.contains('visible')) input.focus({ preventScroll: true });
        } catch (err) {
            if (token !== loadToken) return;
            console.warn(err);
            pendingFill = null;
            setLoading(false);
            input.disabled = true; attachBtn.disabled = true; refreshSend();
            setBanner('error', 'مش قادرين نحمّل الرسايل. اتأكدي من الإنترنت وجربي تاني.', () => startChat());
        }
    }

    function attachLive(lastKey) {
        if (liveQuery) { try { liveQuery.off(); } catch (_) { } }
        liveQuery = lastKey ? chatRef.orderByKey().startAt(lastKey) : chatRef.orderByKey();
        liveQuery.on('child_added', s => onChild(s.key, s.val()), err => liveError(err));
        liveQuery.on('child_removed', s => onRemoved(s.key), () => { });
    }
    function liveError(err) {
        console.warn(err);
        setBanner('error', 'مش قادرين نستقبل رسايل جديدة' + (err && err.code === 'PERMISSION_DENIED' ? ' (مفيش صلاحية).' : '.'), () => { setBanner(null); attachLive(newestKey()); });
    }
    function newestKey() { const ks = Array.from(msgs.keys()).sort(); return ks.length ? ks[ks.length - 1] : null; }

    function onChild(key, val) {
        if (!val || typeof val !== 'object') return;
        const known = msgs.has(key);
        msgs.set(key, Object.assign({}, msgs.get(key) || {}, val));
        if (known) { if (els.has(key)) refreshBubble(key); return; }
        const stick = nearBottom() || val.sender === myName;
        renderList({ bottom: stick });
        if (!stick) { unread++; updateJump(); }
        if (initialLoaded && myName && val.sender && val.sender !== myName && document.hidden && window.LoveApp && window.LoveApp.notifyNew) window.LoveApp.notifyNew(val);
    }
    function onRemoved(key) {
        if (pending.has(key)) return;          // a failed/in-flight local write: we keep it visible
        if (!msgs.has(key)) return;
        msgs.delete(key); els.delete(key);
        renderList({ keep: true });
    }

    /* ---------- older pages ---------- */
    async function loadOlder() {
        if (loadingOlder || !hasMore || !oldestKey || !initialLoaded) return;
        loadingOlder = true; renderOlderState('loading');
        try {
            const snap = await withTimeout(chatRef.orderByKey().endAt(oldestKey).limitToLast(PAGE + 1).once('value'), 12000);
            const items = [];
            snap.forEach(c => { if (c.key !== oldestKey) items.push([c.key, c.val()]); });
            items.forEach(([k, v]) => { if (v && typeof v === 'object') msgs.set(k, v); });
            hasMore = items.length >= PAGE;
            if (items.length) oldestKey = items[0][0];
            renderList({ anchor: true });
            renderOlderState(hasMore ? 'idle' : 'end');
        } catch (err) {
            console.warn(err);
            renderOlderState('error');
        } finally { loadingOlder = false; }
    }
    function renderOlderState(state) {
        olderEl.textContent = '';
        if (state === 'loading') {
            const sp = document.createElement('span'); sp.className = 'spinner';
            olderEl.append(sp, 'بنحمّل رسايل أقدم…');
        } else if (state === 'error') {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = 'مقدرناش نحمّل الأقدم، جربي تاني';
            b.addEventListener('click', loadOlder); olderEl.appendChild(b);
        } else if (state === 'end' && msgs.size) {
            olderEl.textContent = 'ده أول الحكاية 💕';
        }
    }

    /* =================================================================
       rendering
       ================================================================= */
    function nearBottom() { return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90; }
    function scrollToBottom() { scroll.scrollTop = scroll.scrollHeight; unread = 0; updateJump(); }
    function updateJump() {
        const away = !nearBottom();
        jump.classList.toggle('show', away && unread > 0);
    }
    function dayKey(t) { const d = new Date(t || 0); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
    function dayLabel(t) {
        const d = new Date(t), now = new Date();
        const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
        if (diff === 0) return 'النهارده';
        if (diff === 1) return 'امبارح';
        const o = { weekday: 'long', day: 'numeric', month: 'long' };
        if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
        return d.toLocaleDateString('ar-EG', o);
    }
    function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''; }

    function renderList(opt) {
        opt = opt || {};
        const prevH = scroll.scrollHeight, prevT = scroll.scrollTop;
        const keys = Array.from(msgs.keys()).sort();
        const frag = document.createDocumentFragment();
        let lastDay = null, prev = null;
        keys.forEach((k, i) => {
            const m = msgs.get(k), next = msgs.get(keys[i + 1]);
            const dk = dayKey(m.time);
            if (m.time && dk !== lastDay) {
                const sep = document.createElement('div'); sep.className = 'day-sep'; sep.textContent = dayLabel(m.time);
                frag.appendChild(sep); lastDay = dk; prev = null;
            }
            const row = getRow(k, m);
            const cont = prev && prev.sender === m.sender && Math.abs((m.time || 0) - (prev.time || 0)) < 5 * 60e3;
            const lastInGroup = !next || next.sender !== m.sender || dayKey(next.time) !== dk || Math.abs((next.time || 0) - (m.time || 0)) >= 5 * 60e3;
            row.classList.toggle('grp-cont', !!cont);
            row.classList.toggle('grp-last', lastInGroup);
            frag.appendChild(row);
            prev = m;
        });
        list.replaceChildren(frag);
        emptyEl.style.display = (!keys.length && initialLoaded) ? 'block' : 'none';
        if (opt.bottom) scrollToBottom();
        else if (opt.anchor) scroll.scrollTop = prevT + (scroll.scrollHeight - prevH);
        else scroll.scrollTop = prevT;
        if (!hasMore && keys.length && !loadingOlder) renderOlderState('end');
        updateJump();
    }

    function getRow(key, m) { let r = els.get(key); if (!r) { r = buildRow(key, m); els.set(key, r); } return r; }
    function refreshBubble(key) { const old = els.get(key); if (!old) return; const fresh = buildRow(key, msgs.get(key)); old.replaceWith(fresh); els.set(key, fresh); }

    function buildRow(key, m) {
        const mine = m.sender === myName;
        const row = document.createElement('div');
        row.className = 'msg-row ' + (mine ? 'mine' : 'theirs');
        row.dataset.key = key;

        const who = document.createElement('span'); who.className = 'msg-sender'; who.textContent = m.sender || ''; row.appendChild(who);

        const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
        bubble.addEventListener('click', () => setReplyTarget(key));

        if (m.replyTo) {
            const src = msgs.get(m.replyTo);
            const q = document.createElement('span'); q.className = 'msg-reply-quote';
            const qn = document.createElement('b'); qn.textContent = (src && src.sender) || m.replySender || '';
            q.append(qn, (src && src.text) || m.replyText || 'رسالة أقدم');
            q.addEventListener('click', e => { e.stopPropagation(); jumpTo(m.replyTo); });
            bubble.appendChild(q);
        }

        const isImg = m.type === 'image' && typeof m.thumb === 'string' && m.thumb.length < 90000 && IMG_RE.test(m.thumb);
        if (isImg) {
            const img = document.createElement('img'); img.className = 'msg-img'; img.src = m.thumb; img.alt = 'صورة';
            if (m.w && m.h) { img.width = m.w; img.height = m.h; img.style.aspectRatio = m.w + ' / ' + m.h; }
            img.addEventListener('click', e => { e.stopPropagation(); lightboxOpen(key); });
            bubble.appendChild(img);
        }
        if (!isImg || (m.text && m.text !== IMG_TEXT)) {
            const t = document.createElement('span'); t.className = 'msg-caption'; t.textContent = m.text || ''; bubble.appendChild(t);
        }

        const meta = document.createElement('span'); meta.className = 'msg-meta';
        const tm = document.createElement('span'); tm.textContent = fmtTime(m.time);
        meta.appendChild(tm);
        if (mine) { const st = document.createElement('span'); st.className = 'msg-state'; meta.appendChild(st); }
        bubble.appendChild(meta);
        row.appendChild(bubble);

        const act = document.createElement('div'); act.className = 'msg-failed-actions';
        const rt = document.createElement('button'); rt.type = 'button'; rt.textContent = 'إعادة الإرسال';
        rt.addEventListener('click', () => retrySend(key));
        const del = document.createElement('button'); del.type = 'button'; del.textContent = 'حذف';
        del.addEventListener('click', () => discardFailed(key));
        act.append(rt, del); row.appendChild(act);

        applyState(row, key);
        return row;
    }

    function applyState(row, key) {
        const st = row.querySelector('.msg-state'); if (!st) return;
        const p = pending.get(key);
        row.classList.toggle('failed', !!p && p.state === 'failed');
        if (!p) { st.className = 'msg-state sent'; st.textContent = '✓'; st.title = 'اتبعتت'; }
        else if (p.state === 'failed') { st.className = 'msg-state failed'; st.textContent = '⚠ ما اتبعتتش'; }
        else { st.className = 'msg-state sending'; st.textContent = upNow() ? '⏳ بتتبعت…' : '⏳ مستنية الإنترنت'; }
    }
    function updateState(key) {
        const r = els.get(key); if (!r) return;
        const stick = nearBottom();
        applyState(r, key);
        if (stick && nearBottom() === false) scrollToBottom();   // the failed row grows (retry buttons): keep it in view
        else if (stick) scrollToBottom();
    }
    function refreshAllStates() { pending.forEach((_, k) => updateState(k)); }

    function jumpTo(key) {
        const r = els.get(key);
        if (!r || !r.isConnected) return;
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
        r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1300);
    }

    let raf = 0;
    scroll.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            if (nearBottom()) unread = 0;
            updateJump();
            if (scroll.scrollTop < 80) loadOlder();
        });
    }, { passive: true });
    jump.addEventListener('click', () => { scrollToBottom(); });

    /* =================================================================
       sending (optimistic, with retry)
       ================================================================= */
    function refreshSend() {
        sendBtn.disabled = input.disabled || imageBusy || (!input.value.trim() && !readyImage);
    }
    input.addEventListener('input', refreshSend);

    function queueSend(key, payload, image) {
        msgs.set(key, payload);
        pending.set(key, { payload, image, state: 'sending' });
        if (image) imgCache.set(key, image.data);
        renderList({ bottom: true });
        doWrite(key);
    }
    function doWrite(key) {
        const p = pending.get(key); if (!p) return;
        p.state = 'sending'; updateState(key);
        let write;
        try {
            write = p.image
                ? db.ref().update({ ['messages/' + key]: p.payload, ['chatImages/' + key]: p.image })
                : chatRef.child(key).set(p.payload);
        } catch (e) { write = Promise.reject(e); }
        write.then(() => { pending.delete(key); updateState(key); })
            .catch(err => {
                console.warn('send failed', err);
                const q = pending.get(key);
                if (q) { q.state = 'failed'; q.code = err && err.code; updateState(key); }
            });
    }
    function retrySend(key) { if (pending.has(key)) doWrite(key); }
    function discardFailed(key) {
        pending.delete(key); msgs.delete(key); els.delete(key); imgCache.delete(key);
        renderList({ keep: true });
    }

    function sendMessage() {
        if (!myName || !initialLoaded || !db) return;
        const text = input.value.trim();
        if (!text && !readyImage) return;
        const key = chatRef.push().key;
        const payload = { sender: myName, text: text || IMG_TEXT, time: Date.now() };
        if (replyTarget) {
            payload.replyTo = replyTarget.key;
            payload.replySender = replyTarget.sender || '';
            payload.replyText = String(replyTarget.text || '').slice(0, 120);
        }
        let image = null;
        if (readyImage) {
            payload.type = 'image'; payload.imageKey = key;
            payload.thumb = readyImage.thumb; payload.w = readyImage.w; payload.h = readyImage.h;
            image = { data: readyImage.full, w: readyImage.w, h: readyImage.h, sender: myName, time: payload.time };
        }
        queueSend(key, payload, image);
        input.value = ''; clearReply(); clearImage();
        clearTimeout(typingTimer); setTyping(false);
        refreshSend();
        input.focus({ preventScroll: true });
    }
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendMessage(); } });

    /* ---------- replies ---------- */
    function setReplyTarget(key) {
        const t = msgs.get(key); if (!t) return;
        replyTarget = { key, sender: t.sender, text: t.type === 'image' && t.text === IMG_TEXT ? IMG_TEXT : t.text };
        replyText.textContent = (t.sender || '') + ': ' + (replyTarget.text || '');
        replyBox.classList.add('visible');
        input.focus({ preventScroll: true });
    }
    function clearReply() { replyTarget = null; replyBox.classList.remove('visible'); }
    $('#reply-preview-cancel').addEventListener('click', clearReply);

    /* =================================================================
       images: re-encoded in the browser (strips metadata / scripts, caps size)
       ================================================================= */
    function loadBitmap(file) {
        if (window.createImageBitmap) {
            return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => viaImg());
        }
        return viaImg();
        function viaImg() {
            return new Promise((res, rej) => {
                const url = URL.createObjectURL(file), im = new Image();
                im.onload = () => { URL.revokeObjectURL(url); res(im); };
                im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
                im.src = url;
            });
        }
    }
    function toBlob(canvas, q) { return new Promise(r => canvas.toBlob(r, 'image/jpeg', q)); }
    function blobToDataUrl(b) { return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); }); }
    async function encode(src, maxSide, maxBytes, qualities) {
        const sw = src.width, sh = src.height;
        let scale = Math.min(1, maxSide / Math.max(sw, sh));
        for (let round = 0; round < 4; round++) {
            const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h);
            for (const q of qualities) {
                const blob = await toBlob(c, q);
                if (blob && blob.size <= maxBytes) return { data: await blobToDataUrl(blob), w, h };
            }
            scale *= 0.75;
        }
        throw new Error('too-big');
    }
    async function prepareImage(file) {
        if (!file.type || !/^image\//.test(file.type)) throw new Error('type');
        if (file.size > 25 * 1024 * 1024) throw new Error('huge');
        const bmp = await loadBitmap(file);
        try {
            const full = await encode(bmp, FULL_MAX, FULL_BYTES, [.82, .72, .62, .5]);
            const thumb = await encode(bmp, THUMB_MAX, THUMB_BYTES, [.7, .6, .5]);
            return { full: full.data, thumb: thumb.data, w: full.w, h: full.h };
        } finally { if (bmp.close) bmp.close(); }
    }

    function clearImage() {
        readyImage = null; imageBusy = false;
        imgBox.classList.remove('show'); imgThumb.hidden = true; imgInfo.textContent = ''; imgInfo.className = 'info';
        fileInput.value = ''; refreshSend();
    }
    attachBtn.addEventListener('click', () => { if (!attachBtn.disabled) fileInput.click(); });
    $('#img-preview-remove').addEventListener('click', clearImage);
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        imageBusy = true; readyImage = null; refreshSend();
        imgBox.classList.add('show'); imgThumb.hidden = true; imgInfo.className = 'info';
        imgInfo.textContent = 'بنجهّز الصورة…';
        try {
            const r = await prepareImage(file);
            readyImage = r; imageBusy = false;
            imgThumb.src = r.thumb; imgThumb.hidden = false;
            imgInfo.textContent = 'جاهزة للإرسال (' + Math.round(r.full.length * 0.75 / 1024) + ' ك.ب). اكتبي تعليق لو حابة.';
        } catch (err) {
            console.warn(err);
            imageBusy = false; readyImage = null;
            imgInfo.className = 'info err';
            imgInfo.textContent = err.message === 'type' ? 'الملف ده مش صورة.'
                : err.message === 'huge' ? 'الصورة كبيرة قوي (أكتر من 25 ميجا).'
                    : err.message === 'too-big' ? 'مقدرناش نصغّر الصورة كفاية.'
                        : 'مقدرناش نقرا الصورة. جربي صيغة تانية (JPG أو PNG).';
        }
        fileInput.value = ''; refreshSend();
    });

    /* ---------- lightbox ---------- */
    const lb = $('#lightbox'), lbImg = $('#lb-img'), lbMsg = $('#lb-msg'), lbDl = $('#lb-download'), lbRetry = $('#lb-retry');
    let lbKey = null, lbFrom = null;
    async function lightboxOpen(key) {
        lbKey = key; lbFrom = document.activeElement;
        lb.classList.add('show'); lbImg.hidden = true; lbDl.hidden = true; lbRetry.hidden = true;
        lbMsg.textContent = ''; const sp = document.createElement('span'); sp.className = 'spinner'; lbMsg.append(sp, 'بنفتح الصورة…');
        $('#lb-close').focus();
        try {
            let data = imgCache.get(key);
            if (!data) {
                const s = await withTimeout(db.ref('chatImages/' + key + '/data').once('value'), 15000);
                data = s.val();
                if (typeof data !== 'string' || !IMG_RE.test(data)) throw new Error('missing');
                imgCache.set(key, data);
            }
            if (lbKey !== key) return;
            lbImg.src = data; lbImg.hidden = false; lbMsg.textContent = '';
            lbDl.href = data; lbDl.hidden = false;
        } catch (err) {
            if (lbKey !== key) return;
            lbMsg.textContent = err.message === 'missing' ? 'الصورة دي مش متاحة.' : 'مقدرناش نفتح الصورة. اتأكدي من الإنترنت.';
            lbRetry.hidden = err.message === 'missing';
        }
    }
    function lightboxClose(silent) {
        lb.classList.remove('show'); lbKey = null; lbImg.removeAttribute('src');
        if (!silent && lbFrom && lbFrom.focus) lbFrom.focus({ preventScroll: true });
    }
    $('#lb-close').addEventListener('click', () => lightboxClose());
    lbRetry.addEventListener('click', () => { if (lbKey) lightboxOpen(lbKey); });
    lb.addEventListener('click', e => { if (e.target === lb) lightboxClose(); });

    /* =================================================================
       typing indicator
       ================================================================= */
    let typingTimer = null, typingListening = false;
    function listenTyping() {
        if (typingListening || !typingRef) return; typingListening = true;
        typingRef.on('value', s => {
            const data = s.val() || {};
            const other = Object.keys(data).find(n => n !== myName && data[n] === true);
            if (other) { typingEl.textContent = other + (other === NAME_1 ? ' بيكتب…' : ' بتكتب…'); typingEl.classList.add('visible'); }
            else typingEl.classList.remove('visible');
        }, () => { });
    }
    function setTyping(v) { if (myName && typingRef && upNow()) { try { const r = typingRef.child(myName).set(v); if (r && r.catch) r.catch(() => { }); } catch (_) { } } }
    input.addEventListener('input', () => {
        if (!input.value) { clearTimeout(typingTimer); setTyping(false); return; }
        setTyping(true); clearTimeout(typingTimer); typingTimer = setTimeout(() => setTyping(false), 2000);
    });

    /* =================================================================
       emoji picker
       ================================================================= */
    const EMOJIS = ['❤️', '💕', '💖', '💗', '💘', '💝', '🥰', '😍', '😘', '🥹', '😂', '🤣', '😊', '😉', '😢', '😭', '🙈', '🤗', '😴', '🤔', '🔥', '✨', '🌹', '💐', '🌸', '🎉', '👏', '🙏', '💪', '👍'];
    const picker = $('#emoji-picker'), emojiBtn = $('#emojiToggleBtn');
    EMOJIS.forEach(e => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', e);
        b.addEventListener('click', () => { input.value += e; input.focus(); input.dispatchEvent(new Event('input')); });
        picker.appendChild(b);
    });
    emojiBtn.addEventListener('click', () => { picker.classList.toggle('visible'); emojiBtn.classList.toggle('active'); });

    /* =================================================================
       backup + archive (same behaviour as before)
       ================================================================= */
    backupBtn.addEventListener('click', () => {
        if (!myName || !db) return;
        backupBtn.disabled = true;
        chatRef.once('value').then(s => {
            const all = s.val() || {};
            const messages = Object.values(all).sort((a, b) => a.time - b.time).map(m => { const c = Object.assign({}, m); delete c.thumb; return c; });
            const blob = new Blob([JSON.stringify({ createdAt: Date.now(), takenBy: myName, messages }, null, 2)], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = 'love-chat-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
            URL.revokeObjectURL(a.href);
        }).catch(() => setBanner('error', 'مقدرناش ننزّل النسخة. جربي تاني.', null)).finally(() => { backupBtn.disabled = false; });
    });

    let archiveCache = [], archiveLoaded = false;
    function showArchiveList() {
        win.classList.remove('visible'); archiveDetail.classList.remove('visible'); archiveWin.classList.add('visible');
        if (!archiveLoaded && archiveLinksRef) {
            archiveLoaded = true;
            archiveLinksRef.on('value', s => {
                const d = s.val() || {};
                archiveCache = Object.entries(d).map(([key, v]) => ({ key, url: v.url, addedAt: v.addedAt || 0 })).sort((a, b) => a.addedAt - b.addedAt);
                if (archiveWin.classList.contains('visible')) renderArchive();
            }, () => { });
        }
        renderArchive();
    }
    function hideArchiveList() { archiveWin.classList.remove('visible'); win.classList.add('visible'); }
    function renderArchive() {
        archiveListEl.textContent = '';
        if (!archiveCache.length) { const p = document.createElement('p'); p.className = 'archive-empty'; p.textContent = 'لسه مفيش نسخ مضافة.'; archiveListEl.appendChild(p); return; }
        archiveCache.forEach((entry, idx) => {
            const item = document.createElement('div'); item.className = 'archive-item';
            const rm = document.createElement('span'); rm.className = 'archive-item-remove'; rm.textContent = '🗑'; rm.title = 'حذف';
            rm.addEventListener('click', e => { e.stopPropagation(); const r = archiveLinksRef.child(entry.key).remove(); if (r && r.catch) r.catch(() => { }); });
            const t = document.createElement('div'); t.className = 'archive-item-title'; t.textContent = 'نسخة ' + (idx + 1);
            const m = document.createElement('div'); m.className = 'archive-item-meta'; m.textContent = entry.url;
            item.append(rm, t, m);
            item.addEventListener('click', () => showArchiveDetail(entry.url, idx + 1));
            archiveListEl.appendChild(item);
        });
    }
    $('#archive-url-add').addEventListener('click', () => {
        const inp = $('#archive-url-input'), url = inp.value.trim();
        if (!url || !archiveLinksRef) return;
        const r = archiveLinksRef.push({ url, addedAt: Date.now(), addedBy: myName || '' }); if (r && r.catch) r.catch(() => { }); inp.value = '';
    });
    async function showArchiveDetail(url, num) {
        archiveWin.classList.remove('visible'); archiveDetail.classList.add('visible');
        $('#archive-detail-title').textContent = 'نسخة ' + num;
        archiveMsgs.textContent = '';
        const note = txt => { archiveMsgs.textContent = ''; const p = document.createElement('p'); p.className = 'archive-empty'; p.textContent = txt; archiveMsgs.appendChild(p); };
        note('بنحمّل…');
        try {
            const res = await fetch(url); if (!res.ok) throw new Error('fetch');
            const data = await res.json();
            const arr = Array.isArray(data) ? data : (data.messages || []);
            if (!arr.length) { note('الملف مفيهوش رسايل'); return; }
            archiveMsgs.textContent = '';
            arr.forEach(m => {
                const b = document.createElement('div'); b.className = 'msg-row ' + (m.sender === myName ? 'mine' : 'theirs'); b.style.marginTop = '8px';
                const who = document.createElement('span'); who.className = 'msg-sender'; who.textContent = m.sender || '';
                const bub = document.createElement('div'); bub.className = 'msg-bubble'; bub.textContent = m.text || '';
                b.append(who, bub); archiveMsgs.appendChild(b);
            });
        } catch (_) { note('مقدرتش أجيب الملف، تأكد إن الرابط شغال ومباشر لملف JSON'); }
    }
    $('#openArchiveBtn').addEventListener('click', showArchiveList);
    $('#closeArchiveBtn').addEventListener('click', hideArchiveList);
    $('#backToArchiveListBtn').addEventListener('click', showArchiveList);

    refreshSend();
})();
    

        /* =====================================================================
           COSMIC SITE — Phase 1
           1) starfield + glowing heart   2) sealed entry gate   3) memories world
           Private content (letter, memories, messages, stars) is NOT in this file:
           it is AES-GCM encrypted in SEALED and only opened by the two birth dates.
           ===================================================================== */
        (() => {
            'use strict';

            const $ = (s, r = document) => r.querySelector(s);
            const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const SEALED = {"v":1,"iter":250000,"salt":"D26WfmZZL4uQVzwlyLemng==","iv":"aWOtmB7yxMluMPeQ","ct":"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"};
            window.LoveApp = window.LoveApp || {};
            const L = LoveLogic;

            /* Focus an element that is still fading in (its container is `visibility: hidden` for a moment,
               and the browser refuses to focus it): try now, then again once it is visible. */
            function focusSoon(n) {
                if (!n) return;
                const opt = { preventScroll: true };
                const go = () => { if (n.isConnected && !n.closest('[inert]')) n.focus(opt); };
                go();
                if (document.activeElement === n) return;
                requestAnimationFrame(() => { go(); if (document.activeElement !== n) setTimeout(go, 150); });
            }

            function el(tag, cls, text) {
                const n = document.createElement(tag);
                if (cls) n.className = cls;
                if (text != null) n.textContent = text;
                return n;
            }

            /* ------------------------------------------------------------------
               1) Starfield + pointer reaction
               ------------------------------------------------------------------ */
            const canvas = $('#sky');
            const ctx = canvas.getContext('2d');
            let W = 0, H = 0, stars = [], shoot = null, nextShoot = 0;
            let visNow = 1, visTarget = 1;      // how many stars show: all at night, few at noon
            const ptr = { tx: 0, ty: 0, x: 0, y: 0, lx: innerWidth / 2, ly: innerHeight / 2 };

            function resize() {
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                W = window.innerWidth; H = window.innerHeight;
                canvas.width = Math.round(W * dpr);
                canvas.height = Math.round(H * dpr);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                const n = Math.max(90, Math.min(260, Math.round(W * H / 5200)));
                const tints = ['255,255,255', '255,255,255', '255,255,255', '255,196,228', '208,190,255'];
                stars = Array.from({ length: n }, () => ({
                    x: Math.random() * W, y: Math.random() * H,
                    z: .25 + Math.random() * .75,
                    r: .4 + Math.random() * 1.5,
                    ph: Math.random() * 6.28, sp: .5 + Math.random() * 1.5,
                    c: tints[(Math.random() * tints.length) | 0]
                }));
                if (reduce) drawStars(0);
            }

            function drawStars(t) {
                ctx.clearRect(0, 0, W, H);
                const ox = ptr.x * 16, oy = ptr.y * 12;
                for (const s of stars) {
                    let x = s.x + ox * s.z, y = s.y + oy * s.z;
                    x = ((x % W) + W) % W; y = ((y % H) + H) % H;
                    const tw = reduce ? .8 : .55 + .45 * Math.sin(t * s.sp + s.ph);
                    const a = Math.min(1, (.3 + .7 * s.z) * tw) * visNow;
                    ctx.fillStyle = 'rgba(' + s.c + ',' + a.toFixed(3) + ')';
                    ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill();
                    if (s.r > 1.25) {
                        ctx.fillStyle = 'rgba(' + s.c + ',' + (a * .16).toFixed(3) + ')';
                        ctx.beginPath(); ctx.arc(x, y, s.r * 3.2, 0, 6.2832); ctx.fill();
                    }
                }
                if (shoot) {
                    const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * .12, shoot.y - shoot.vy * .12);
                    g.addColorStop(0, 'rgba(255,255,255,' + shoot.a.toFixed(2) + ')');
                    g.addColorStop(1, 'rgba(255,255,255,0)');
                    ctx.strokeStyle = g; ctx.lineWidth = 1.6;
                    ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * .12, shoot.y - shoot.vy * .12); ctx.stroke();
                }
            }

            window.addEventListener('resize', (() => { let id; return () => { clearTimeout(id); id = setTimeout(resize, 150); }; })());
            ['pointermove', 'pointerdown'].forEach(ev => window.addEventListener(ev, e => {
                ptr.lx = e.clientX; ptr.ly = e.clientY;
                ptr.tx = (e.clientX / W - .5) * 2; ptr.ty = (e.clientY / H - .5) * 2;
            }, { passive: true }));

            const gateStage = $('#gate-heart-stage');
            const homeStage = $('#home-heart');
            let current = null;
            let drift = 0, last = performance.now();

            function reactHeart(st) {
                const r = st.getBoundingClientRect();
                const d = Math.hypot(ptr.lx - (r.left + r.width / 2), ptr.ly - (r.top + r.height / 2)) / (Math.min(W, H) * .6);
                const target = 1 - Math.min(1, d);
                st._g = (st._g == null ? .35 : st._g) + (target - (st._g == null ? .35 : st._g)) * .12;
                st.style.setProperty('--px', ptr.x.toFixed(3));
                st.style.setProperty('--py', ptr.y.toFixed(3));
                st.style.setProperty('--glow', st._g.toFixed(3));
            }

            function frame(now) {
                const dt = Math.min(.05, (now - last) / 1000); last = now;
                drift += dt;
                visNow += (visTarget - visNow) * Math.min(1, dt * 1.2);
                ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 4);
                ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 4);
                for (const s of stars) { s.x += 5 * s.z * dt; s.y -= 3 * s.z * dt; }
                if (!shoot && now > nextShoot) {
                    shoot = { x: Math.random() * W * .8, y: Math.random() * H * .35, vx: 420 + Math.random() * 200, vy: 180 + Math.random() * 120, a: 1 };
                    nextShoot = now + 9000 + Math.random() * 9000;
                } else if (shoot) {
                    shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt; shoot.a -= dt * .9;
                    if (shoot.a <= 0 || shoot.x > W + 80 || shoot.y > H + 80) shoot = null;
                }
                drawStars(drift);
                if (gateStage && gateStage.isConnected) reactHeart(gateStage);
                if (current === 'home') reactHeart(homeStage);
                requestAnimationFrame(frame);
            }

            resize();
            nextShoot = performance.now() + 5000;
            if (!reduce) requestAnimationFrame(frame);

            /* ------------------------------------------------------------------
               Live sky: the sky, the sun/moon and the stars follow the visitor's local time
               (and, once inside, the mood she picked). Styles live in live.css.
               ------------------------------------------------------------------ */
            const TOD_VIS = { dawn: .55, morning: .2, afternoon: .12, evening: .7, night: 1 };
            const TOD_NAME = { dawn: 'الفجر', morning: 'الصبح', afternoon: 'النهار', evening: 'الغروب', night: 'الليل' };
            const root = document.documentElement;
            let curTod = '';
            function applyTod(tod) {
                curTod = tod;
                root.dataset.tod = tod;
                visTarget = TOD_VIS[tod] != null ? TOD_VIS[tod] : 1;
                if (reduce) { visNow = visTarget; drawStars(0); }
            }
            function applyMoodScene(scene) {
                if (scene) root.dataset.mood = scene; else delete root.dataset.mood;
            }
            applyTod(L.partOfDay(new Date()));

            /* small particles used by the gate success + heart taps */
            function burst(x, y, n, chars) {
                chars = chars || ['💖', '💕', '✨', '💗', '🌟'];
                if (reduce) n = Math.min(n, 6);
                for (let i = 0; i < n; i++) {
                    const s = el('span', 'burst', chars[(Math.random() * chars.length) | 0]);
                    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
                    s.style.left = x + 'px'; s.style.top = y + 'px';
                    s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
                    s.style.setProperty('--dy', (Math.sin(a) * d - 30).toFixed(0) + 'px');
                    s.style.fontSize = (12 + Math.random() * 16).toFixed(0) + 'px';
                    document.body.appendChild(s);
                    setTimeout(() => s.remove(), 1100);
                }
            }

            /* ------------------------------------------------------------------
               2) Entry gate
               ------------------------------------------------------------------ */
            const gate = $('#gate'), gateForm = $('#gate-form'), gateCard = $('.gate-card');
            const in1 = $('#pw-in-1'), in2 = $('#pw-in-2');
            const gateBtn = $('#gate-submit'), gateMsg = $('#gate-msg');
            const app = $('#app');
            let busy = false, fails = 0, lockUntil = 0, unlocked = false;

            $$('.eye').forEach(btn => btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                const hidden = input.type === 'password';
                input.type = hidden ? 'text' : 'password';
                btn.firstElementChild.className = hidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
            }));

            function showMsg(text, kind) { gateMsg.textContent = text; gateMsg.className = 'gate-msg ' + (kind || ''); }
            function shake(input) {
                input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
                input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
            }
            function setBusy(b) { busy = b; gateBtn.disabled = b; gateBtn.textContent = b ? 'ثانية واحدة… 💫' : 'افتحي الحكاية'; }

            /* Accepts 5/3/2000, 05-03-2000, 2000/3/5, 532000, 05032000 and Arabic-Indic digits.
               Returns every valid d/m/yyyy reading (a 7-digit number can be read two ways). */
            function candidates(raw) {
                const s = String(raw).trim()
                    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660)
                    .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0);
                const out = new Set();
                const add = (d, m, y) => {
                    d = +d; m = +m; y = +y;
                    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) out.add(d + '/' + m + '/' + y);
                };
                const parts = s.split(/[\/\-.\s]+/).filter(Boolean);
                if (parts.length === 3 && parts.every(p => /^\d+$/.test(p))) {
                    if (parts[0].length === 4) add(parts[2], parts[1], parts[0]); else add(parts[0], parts[1], parts[2]);
                } else if (parts.length === 1 && /^\d{7,8}$/.test(parts[0])) {
                    const t = parts[0], y = t.slice(-4), rest = t.slice(0, -4);
                    if (rest.length === 4) add(rest.slice(0, 2), rest.slice(2), y);
                    else { add(rest.slice(0, 2), rest.slice(2), y); add(rest.slice(0, 1), rest.slice(1), y); }
                }
                return Array.from(out);
            }

            const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
            async function openSealed(c1, c2) {
                const enc = new TextEncoder();
                const base = await crypto.subtle.importKey('raw', enc.encode(c1 + '|' + c2), 'PBKDF2', false, ['deriveKey']);
                const key = await crypto.subtle.deriveKey(
                    { name: 'PBKDF2', salt: b64(SEALED.salt), iterations: SEALED.iter, hash: 'SHA-256' },
                    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
                const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(SEALED.iv) }, key, b64(SEALED.ct));
                return JSON.parse(new TextDecoder().decode(plain));
            }

            async function attempt() {
                if (busy) return;
                const wait = Math.ceil((lockUntil - Date.now()) / 1000);
                if (wait > 0) { showMsg('استني ' + wait + ' ثانية وجربي تاني 💫', 'err'); return; }

                if (!in1.value.trim() || !in2.value.trim()) {
                    showMsg('اكتبي التاريخين الأول 💕', 'err');
                    (in1.value.trim() ? in2 : in1).focus();
                    return;
                }
                const c1 = candidates(in1.value), c2 = candidates(in2.value);
                if (!c1.length || !c2.length) {
                    showMsg('الشكل مش واضح — اكتبي التاريخ كده: يوم/شهر/سنة', 'err');
                    if (!c1.length) shake(in1);
                    if (!c2.length) shake(in2);
                    return;
                }
                if (!SEALED) { showMsg('الصفحة دي لسه متبنتش، شغّلي build.mjs الأول', 'err'); return; }
                if (!(window.crypto && crypto.subtle)) {
                    showMsg('المتصفح مش بيدعم التحقق الآمن. افتحي الموقع من رابطه الأصلي (https) أو من متصفح حديث', 'err');
                    return;
                }

                setBusy(true);
                let opened = false;
                try {
                    let data = null, m1 = null, m2 = null;
                    outer: for (const a of c1) {
                        for (const b of c2) {
                            try { data = await openSealed(a, b); m1 = a; m2 = b; break outer; } catch (_) { /* wrong guess, keep going */ }
                        }
                    }
                    if (!data) {
                        fails++;
                        shake(in1); shake(in2);
                        if (fails >= 5) { fails = 0; lockUntil = Date.now() + 15000; showMsg('محاولات كتير.. خدي نفس واستني 15 ثانية 💫', 'err'); }
                        else showMsg('واحد من التاريخين مش مظبوط، راجعيهم وجربي تاني 💔', 'err');
                        in1.focus();
                    } else {
                        opened = true;
                        await onSuccess(data, m1, m2);
                    }
                } catch (err) {
                    console.error(err);
                    showMsg('حصل خطأ غير متوقع، حدّثي الصفحة وجربي تاني', 'err');
                } finally {
                    if (!opened) setBusy(false);
                }
            }
            gateForm.addEventListener('submit', e => { e.preventDefault(); attempt(); });

            async function onSuccess(data, d1, d2) {
                render(data);
                unlocked = true;
                window.__siteUnlocked = true;
                if (window.LoveApp.netState) window.LoveApp.netState();     // opened without internet: say so right away
                in1.value = ''; in2.value = '';
                gateCard.classList.add('ok');
                showMsg('أهلاً بيكي في حكايتنا 💖', 'ok');
                const r = gateStage.getBoundingClientRect();
                burst(r.left + r.width / 2, r.top + r.height / 2, 30);
                await sleep(reduce ? 300 : 1500);
                gate.classList.add('leaving');
                app.hidden = false;
                requestAnimationFrame(() => requestAnimationFrame(() => app.classList.add('show')));
                const h = location.hash.slice(1);
                go(scenes[h] ? h : 'home');
                setTimeout(() => { toastsOn = true; pumpToasts(); }, 1100);
                setTimeout(() => {
                    gate.remove();
                    try { if (typeof maybeAskIdentity === 'function') maybeAskIdentity(d1, d2); } catch (e) { console.warn(e); }
                }, 900);
            }

            /* ------------------------------------------------------------------
               3) Scenes, memories, letter, "open when", stars
               ------------------------------------------------------------------ */
            const scenes = {};
            $$('.scene').forEach(s => { scenes[s.dataset.scene] = s; });

            function go(name) {
                if (!scenes[name]) name = 'home';
                if (name === current) return;
                if (current && scenes[current]) {
                    scenes[current].classList.remove('active');
                    scenes[current].inert = true;
                    scenes[current].setAttribute('aria-hidden', 'true');
                }
                if (current === 'letter') closeEnvelope();
                const next = scenes[name];
                next.inert = false;
                next.removeAttribute('aria-hidden');
                next.scrollTop = 0;
                next.classList.add('active');
                current = name;
                if (name === 'world') refreshWorld();
                if (name === 'home') renderHome();
                const f = $('[data-focus]', next);
                focusSoon(f);
            }

            document.addEventListener('click', e => {
                const t = e.target.closest('[data-go]');
                if (t && unlocked) { e.preventDefault(); location.hash = t.dataset.go; }
            });
            window.addEventListener('hashchange', () => { if (unlocked) go(scenes[location.hash.slice(1)] ? location.hash.slice(1) : 'home'); });
            $('.header-logo').addEventListener('click', e => { e.preventDefault(); if (unlocked) location.hash = 'home'; });

            /* ------------------------------------------------------------------
               Progress — saved in this browser (ids only, never the private text)
               ------------------------------------------------------------------ */
            const STORE_KEY = 'loveWorld.v1', OLD_SEEN_KEY = 'loveSeen.v1';
            const IMG_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
            let P = L.emptyProgress(), firstRun = false, memStore = null;

            function loadProgress() {
                let raw = null;
                try { raw = localStorage.getItem(STORE_KEY); } catch (_) { }
                if (raw == null) raw = memStore;
                let parsed = null;
                try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = null; }
                firstRun = !parsed || typeof parsed !== 'object';
                P = L.normalize(parsed);
                if (firstRun) {
                    try {   // keep what was discovered before the world existed
                        JSON.parse(localStorage.getItem(OLD_SEEN_KEY) || '[]').forEach(id => {
                            if (typeof id !== 'string') return;
                            if (id.indexOf('ow-') === 0) L.add(P, 'openWhen', id.slice(3));
                            else if (id.indexOf('st-') === 0) L.add(P, 'stars', id.slice(3));
                        });
                    } catch (_) { }
                }
            }
            function saveProgress() {
                const str = JSON.stringify(P);
                try { localStorage.setItem(STORE_KEY, str); memStore = null; } catch (_) { memStore = str; }
            }

            /* ---------- toasts: "new planet", "new achievement" ---------- */
            const toastEl = $('#toast'), toastQ = [];
            let toastsOn = false, toastBusy = false, toastTimer = 0;
            function toast(t) { toastQ.push(t); pumpToasts(); }
            function pumpToasts() {
                if (!toastsOn || toastBusy || !toastQ.length) return;
                const t = toastQ.shift(); toastBusy = true;
                $('#toast-emoji').textContent = t.emoji || '✨';
                $('#toast-title').textContent = t.title || '';
                $('#toast-text').textContent = t.text || '';
                const btn = $('#toast-go');
                btn.hidden = !t.go; btn.tabIndex = t.go ? 0 : -1;
                btn.textContent = t.goLabel || 'شوفيه';
                btn.onclick = () => { hideToast(); if (t.go) t.go(); };
                toastEl.classList.add('show');
                clearTimeout(toastTimer);
                toastTimer = setTimeout(hideToast, t.go ? 6500 : 4200);
            }
            function hideToast() {
                if (!toastEl.classList.contains('show')) return;
                clearTimeout(toastTimer);
                toastEl.classList.remove('show');
                $('#toast-go').tabIndex = -1;
                setTimeout(() => { toastBusy = false; pumpToasts(); }, 450);
            }
            $('#toast-close').addEventListener('click', hideToast);

            /* ---------- what exists + what is unlocked ---------- */
            const CAT = { story: [], openWhen: [], stars: [], surprises: [], planets: [], ach: [], moods: [], greet: {}, adv: { title: '', intro: '', stages: [], finale: null }, valid: {} };

            function computeStates() {
                const ctx = { valid: CAT.valid };
                const pst = L.evaluate(CAT.planets.map(p => ({ id: p.id, unlock: p.unlock })), P, ctx, { planetList: true });
                CAT.planets.forEach(p => { if (P.planets.indexOf(p.id) !== -1) pst[p.id].unlocked = true; });   // once open, always open
                const have = CAT.planets.filter(p => pst[p.id].unlocked).length;
                const ast = L.evaluate(CAT.ach.map(a => ({ id: a.id, unlock: a.when })), P, ctx, { planetsHave: have, planetsTotal: CAT.planets.length });
                CAT.ach.forEach(a => { if (P.earned[a.id]) ast[a.id].unlocked = true; });
                return { pst, ast, planetsHave: have };
            }
            function closeAllDialogs() { dialogs.slice().forEach(hideDialog); }
            function checkUnlocks(silent) {
                const st = computeStates();
                const np = CAT.planets.filter(p => st.pst[p.id].unlocked && P.planets.indexOf(p.id) === -1);
                const na = CAT.ach.filter(a => st.ast[a.id].unlocked && !P.earned[a.id]);
                if (np.length || na.length) {
                    np.forEach(p => P.planets.push(p.id));
                    na.forEach(a => { P.earned[a.id] = Date.now(); });
                    saveProgress();
                    if (!silent) {
                        np.forEach(p => toast({ emoji: p.emoji || '🪐', title: 'كوكب جديد انفتح!', text: p.secret ? 'اتفتح مكان سري 🔮' : p.name, go: () => { closeAllDialogs(); location.hash = 'world'; go('world'); } }));
                        na.forEach(a => toast({ emoji: a.emoji || '🏆', title: 'إنجاز جديد!', text: a.title }));
                    }
                }
                refreshWorld(st);
                return st;
            }
            function mark(kind, id) { if (L.add(P, kind, id)) { saveProgress(); checkUnlocks(false); } }

            /* ------------------------------------------------------------------
               Dialogs (memory / planet / surprise modal, and the game) share one stack,
               focus trap and Esc handling
               ------------------------------------------------------------------ */
            const modal = $('#modal');
            const dialogs = [];   // open dialogs, the last one is on top
            function showDialog(d, focusEl) {
                if (dialogs.indexOf(d) === -1) { d._from = document.activeElement; dialogs.push(d); }
                d.inert = false; d.removeAttribute('aria-hidden'); d.classList.add('open');
                focusSoon(focusEl || d.querySelector('button'));
            }
            function hideDialog(d) {
                const i = dialogs.indexOf(d); if (i === -1) return;
                dialogs.splice(i, 1);
                d.classList.remove('open'); d.inert = true; d.setAttribute('aria-hidden', 'true');
                if (d._onClose) d._onClose();
                const back = d._from; d._from = null;
                if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
            }
            document.addEventListener('keydown', e => {
                const d = dialogs[dialogs.length - 1]; if (!d) return;
                if (e.key === 'Escape') { e.stopPropagation(); hideDialog(d); return; }
                if (e.key === 'Tab') {
                    const f = $$('button:not([disabled]), input:not([disabled])', d).filter(b => !b.hidden && b.getClientRects().length > 0);
                    if (!f.length) return;
                    e.preventDefault();
                    const i = f.indexOf(document.activeElement);
                    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
                }
            }, true);

            function openModal(o) {
                $('#m-emoji').textContent = o.emoji || '💖';
                $('#m-meta').textContent = o.meta || '';
                $('#m-title').textContent = o.title || '';
                $('#m-text').textContent = o.text || '';
                const img = $('#m-img');
                if (typeof o.image === 'string' && IMG_OK.test(o.image)) { img.src = o.image; img.alt = o.imageAlt || ''; img.hidden = false; }
                else { img.hidden = true; img.removeAttribute('src'); }
                const act = $('#m-actions'); act.textContent = '';
                (o.actions || []).forEach(a => {
                    const b = el('button', 'ubtn ' + (a.primary ? 'btn-main' : 'btn-soft'), a.label);
                    b.type = 'button'; b.addEventListener('click', a.onClick); act.appendChild(b);
                });
                showDialog(modal, $('#m-actions button') || $('#m-close'));
            }
            function closeModal() { hideDialog(modal); }
            $('#m-close').addEventListener('click', closeModal);
            modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

            /* random message — the list lives in content.json -> "randomMessages" (single place) */
            let randomList = [], bag = [], lastRandom = -1;
            function nextRandom() {
                if (!randomList.length) return null;
                if (!bag.length) {
                    bag = randomList.map((_, i) => i);
                    for (let i = bag.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [bag[i], bag[j]] = [bag[j], bag[i]]; }
                    if (bag.length > 1 && bag[bag.length - 1] === lastRandom) bag.unshift(bag.pop());
                }
                lastRandom = bag.pop();
                return randomList[lastRandom];
            }
            function showRandom() {
                if (!unlocked) return;
                const t = nextRandom();
                if (!t) {
                    openModal({ emoji: '💌', title: 'مفيش رسايل لسه', text: 'ضيفي رسايل في content.json (randomMessages) وشغّلي build.mjs.' });
                    return;
                }
                openModal({
                    emoji: '🎲', meta: 'رسالة من القلب', title: '', text: t,
                    actions: [
                        { label: 'رسالة تانية 🎲', onClick: showRandom },
                        { label: 'حطيها في الشات 💬', primary: true, onClick: () => { closeModal(); if (window.LoveApp.fillInput) window.LoveApp.fillInput(t); } }
                    ]
                });
            }
            window.LoveApp.randomMessage = showRandom;
            document.addEventListener('click', e => { if (e.target.closest('[data-random]')) showRandom(); });

            /* ------------------------------------------------------------------
               Surprise of the visit (a new one each visit, remembers the last)
               ------------------------------------------------------------------ */
            const TYPE_LABEL = { message: 'رسالة ليكي', memory: 'ذكرى', picture: 'صورة', question: 'سؤال', challenge: 'تحدٍّ لطيف' };
            const TYPE_EMOJI = { message: '💌', memory: '📸', picture: '🖼️', question: '❓', challenge: '🎯' };
            const giftBtn = $('#gift-btn');

            function currentSurprise() {
                const c = P.s.current;
                return c ? (CAT.surprises.find(x => x.id === c.id) || null) : null;
            }
            function renderHome() {
                $('#visit-line').textContent = 'زيارتك رقم ' + P.visits.toLocaleString('ar-EG') + ' 🌙';
                const it = currentSurprise();
                giftBtn.hidden = !it;
                if (it) {
                    const opened = !!P.s.current.opened;
                    giftBtn.classList.toggle('opened', opened);
                    $('#gift-label').textContent = opened ? 'مفاجأة الزيارة اتفتحت ✓' : 'مفاجأة الزيارة جاهزة!';
                    $('#gift-sub').textContent = opened ? 'اضغطي لو عايزة تشوفيها تاني' : 'اضغطي عشان تفتحيها 🎁';
                }
                $('#world-badge').hidden = !CAT.planets.some(p => P.planets.indexOf(p.id) !== -1 && !L.has(P, 'planetSeen', p.id));
                const stages = CAT.adv.stages, nav = $('#adv-nav'), has = stages.length > 0;
                nav.hidden = !has; $('#adv-world-btn').hidden = !has;
                if (has) {
                    const solved = stages.filter(x => L.has(P, 'adv', x.id)).length, bd = $('#adv-badge');
                    const allDone = solved === stages.length, seenEnd = L.has(P, 'advDone', 'finale');
                    bd.hidden = allDone && seenEnd;
                    bd.textContent = solved === 0 ? 'جديدة' : allDone ? 'المفاجأة مستنياكي' : solved + ' من ' + stages.length;
                }
            }
            function showSurprise(it) {
                const type = TYPE_LABEL[it.type] ? it.type : 'message';
                const actions = [];
                const toChat = prefix => () => { closeModal(); window.LoveApp.fillInput(prefix); };
                let accepted = false;
                if (type === 'question') {
                    actions.push({ label: 'ردّي عليا في الشات 💬', primary: true, onClick: toChat('❓ ' + it.text + ' — ') });
                } else if (type === 'challenge') {
                    accepted = L.has(P, 'challenge', it.id);
                    if (accepted) actions.push({ label: 'قوليلي لما تخلّصيه في الشات 💬', primary: true, onClick: toChat('🎯 ' + (it.title || 'التحدي') + ': ') });
                    else actions.push({ label: 'قبلت التحدي 🎯', primary: true, onClick: () => { mark('challenge', it.id); showSurprise(it); } });
                }
                openModal({
                    emoji: it.emoji || TYPE_EMOJI[type],
                    meta: TYPE_LABEL[type] + (type === 'memory' && it.date ? ' · ' + fmtDate(it.date) : '') + (accepted ? ' · اتسجل ✓' : ''),
                    title: it.title || '', text: it.text || '',
                    image: it.image, imageAlt: it.alt || it.title || 'صورة', actions
                });
            }
            function openGift() {
                const it = currentSurprise(); if (!it) return;
                const first = !P.s.current.opened;
                if (first) { P.s.current.opened = true; saveProgress(); }
                showSurprise(it);
                if (first) mark('surprise', it.id);
                renderHome();
            }
            giftBtn.addEventListener('click', openGift);

            /* ------------------------------------------------------------------
               World: planets + achievements
               ------------------------------------------------------------------ */
            const PALETTE = [['#ffc2dd', '#7d4bd8'], ['#ffd3a8', '#e0508c'], ['#ffa5b8', '#b44bd6'], ['#ffe9a8', '#f08c3c'], ['#b9c4ff', '#5d4bd6'], ['#e8b6ff', '#3a2a8c']];
            const SVGNS = 'http://www.w3.org/2000/svg';
            const clampN = (v, a, b, d) => { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
            const colorOf = (c, d) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : d;
            const GOTO = {
                story: ['story', 'روحي «حكايتنا» 📖'], openWhen: ['openwhen', 'روحي «افتحيني لما…» 💌'], stars: ['stars', 'روحي «سماء النجوم» ⭐'],
                letter: ['letter', 'روحي «رسالة حب» ✉️'], surprise: ['home', 'روحي الرئيسية 🎁'], challenge: ['home', 'روحي الرئيسية 🎁'],
                tod: ['home', 'روحي الرئيسية 🌙'], mood: ['home', 'روحي الرئيسية 🎭']
            };
            let worldLines = [];

            function buildWorld() {
                const map = $('#world-map');
                $$('.planet', map).forEach(n => n.remove());
                const svg = $('#world-lines'); svg.textContent = ''; worldLines = [];
                CAT.planets.forEach((p, i) => {
                    const pal = (Array.isArray(p.colors) && p.colors.length >= 2) ? p.colors : PALETTE[i % PALETTE.length];
                    const b = el('button', 'ubtn planet'); b.type = 'button';
                    b.style.left = clampN(p.x, 6, 94, 50) + '%'; b.style.top = clampN(p.y, 4, 96, 50) + '%';
                    b.style.setProperty('--c1', colorOf(pal[0], '#ffc2dd')); b.style.setProperty('--c2', colorOf(pal[1], '#7d4bd8'));
                    b.style.setProperty('--sz', clampN(p.size, 48, 110, 62) + 'px');
                    b.style.setProperty('--fd', (-(i * 1.3)).toFixed(1) + 's');
                    const orb = el('span', 'pl-orb' + (p.ring ? ' ring' : ''));
                    const em = el('span', 'pl-emoji'); em.setAttribute('aria-hidden', 'true');
                    const tag = el('span', 'pl-new', 'جديد'); tag.setAttribute('aria-hidden', 'true');
                    orb.append(em, tag);
                    const nm = el('span', 'pl-name');
                    b.append(orb, nm);
                    b.addEventListener('click', () => onPlanet(p));
                    map.appendChild(b);
                    p._el = { b, em, nm };
                });
                for (let i = 0; i < CAT.planets.length - 1; i++) {
                    const a = CAT.planets[i], c = CAT.planets[i + 1];
                    const ln = document.createElementNS(SVGNS, 'line');
                    ln.setAttribute('x1', clampN(a.x, 6, 94, 50)); ln.setAttribute('y1', clampN(a.y, 4, 96, 50));
                    ln.setAttribute('x2', clampN(c.x, 6, 94, 50)); ln.setAttribute('y2', clampN(c.y, 4, 96, 50));
                    svg.appendChild(ln); worldLines.push(ln);
                }
            }

            function refreshWorld(st) {
                st = st || computeStates();
                CAT.planets.forEach(p => {
                    const s = st.pst[p.id], E = p._el; if (!E) return;
                    const open = s.unlocked, seenIt = L.has(P, 'planetSeen', p.id);
                    E.b.classList.toggle('locked', !open);
                    E.b.classList.toggle('fresh', open && !seenIt);
                    E.em.textContent = open ? (p.emoji || '🪐') : '🔒';
                    E.nm.textContent = (open || !p.secret) ? p.name : '؟؟؟';
                    E.b.setAttribute('aria-label', open ? p.name + (seenIt ? '' : '، كوكب جديد')
                        : (p.secret ? 'كوكب سري' : p.name) + '، مقفول. ' + L.describe(p.unlock, s.need, true) + ' (' + s.have + ' من ' + s.need + ')');
                });
                worldLines.forEach((ln, i) => ln.classList.toggle('on', st.pst[CAT.planets[i].id].unlocked && st.pst[CAT.planets[i + 1].id].unlocked));
                $('#world-count').textContent = CAT.planets.length ? '(' + st.planetsHave + ' من ' + CAT.planets.length + ')' : '';
                renderAch(st);
                renderHome();
            }

            function renderAch(st) {
                const ul = $('#ach-list'); ul.textContent = '';
                let done = 0;
                CAT.ach.forEach(a => {
                    const s = st.ast[a.id], earned = s.unlocked; if (earned) done++;
                    const li = el('li', 'ach' + (earned ? ' done' : ''));
                    const ic = el('span', 'ach-ic', earned ? (a.emoji || '🏆') : '🔒'); ic.setAttribute('aria-hidden', 'true');
                    const box = el('div', 'ach-body');
                    box.appendChild(el('div', 'ach-title', a.title));
                    box.appendChild(el('div', 'ach-desc', L.describe(a.when, s.need, false)));
                    const bar = el('div', 'ach-bar'), fill = el('span');
                    fill.style.width = Math.round(100 * s.have / Math.max(1, s.need)) + '%';
                    bar.appendChild(fill); bar.setAttribute('aria-hidden', 'true');
                    box.appendChild(bar);
                    const num = el('span', 'ach-num', earned ? '✓ تم' : s.have + '/' + s.need);
                    li.append(ic, box, num);
                    ul.appendChild(li);
                });
                $('#ach-count').textContent = CAT.ach.length ? '(' + done + ' من ' + CAT.ach.length + ')' : '';
            }

            function onPlanet(p) {
                const s = computeStates().pst[p.id];
                if (s.unlocked) {
                    if (L.add(P, 'planetSeen', p.id)) { saveProgress(); refreshWorld(); }
                    openModal({ emoji: p.emoji || '🪐', meta: 'كوكب', title: p.name, text: p.text || '', image: p.image, imageAlt: p.name });
                    return;
                }
                const t = p.unlock && p.unlock.type, actions = [];
                if (t === 'game') actions.push({ label: 'العبي دلوقتي 🃏', primary: true, onClick: () => { closeModal(); openGame(); } });
                else if (t === 'adv' || t === 'advDone') actions.push({ label: 'ابدئي المغامرة 🗝️', primary: true, onClick: () => { closeModal(); openAdventure(); } });
                else if (GOTO[t]) actions.push({ label: GOTO[t][1], primary: true, onClick: () => { closeModal(); location.hash = GOTO[t][0]; } });
                openModal({
                    emoji: '🔒', meta: 'كوكب مقفول', title: p.secret ? 'كوكب سري' : p.name,
                    text: L.describe(p.unlock, s.need, true) + '\nالتقدم: ' + s.have + ' من ' + s.need + (t === 'days' ? '\nكل يوم بترجعي فيه بيقرّبك 🌙' : ''),
                    actions
                });
            }

            /* ------------------------------------------------------------------
               Memory game — winning opens the secret place
               ------------------------------------------------------------------ */
            const GAME = $('#game'), gGrid = $('#g-grid'), gMoves = $('#g-moves'), gResult = $('#g-result'), gActions = $('#g-result-actions');
            const SYMS = [['💖', 'قلب'], ['🌹', 'وردة'], ['🌙', 'قمر'], ['⭐', 'نجمة'], ['🎀', 'فيونكة'], ['🦋', 'فراشة']];
            let gState = null, gTimer = 0;
            function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
            const backLabel = i => 'كارت ' + (i + 1) + '، مقفول';

            function newGame() {
                clearTimeout(gTimer);
                const deck = shuffle(SYMS.concat(SYMS).map(x => ({ sym: x[0], name: x[1] })));
                gState = { deck, open: [], matched: 0, moves: 0, lock: false, done: false };
                gGrid.textContent = ''; gResult.textContent = ''; gActions.textContent = '';
                gMoves.textContent = 'الحركات: 0';
                deck.forEach((c, i) => {
                    const b = el('button', 'ubtn g-card'); b.type = 'button'; b.dataset.sym = c.sym;
                    const back = el('span', 'g-back', '✦'), face = el('span', 'g-face', c.sym);
                    back.setAttribute('aria-hidden', 'true'); face.setAttribute('aria-hidden', 'true');
                    b.append(back, face);
                    b.setAttribute('aria-label', backLabel(i));
                    b.addEventListener('click', () => flip(i));
                    gGrid.appendChild(b);
                });
            }
            function flip(i) {
                const g = gState; if (!g || g.lock || g.done) return;
                const b = gGrid.children[i];
                if (b.classList.contains('up') || b.classList.contains('matched')) return;
                b.classList.add('up'); b.setAttribute('aria-label', 'كارت ' + (i + 1) + ': ' + g.deck[i].name);
                g.open.push(i);
                if (g.open.length < 2) return;
                g.moves++; gMoves.textContent = 'الحركات: ' + g.moves;
                const a = g.open[0], c = g.open[1], A = gGrid.children[a], C = gGrid.children[c];
                if (g.deck[a].sym === g.deck[c].sym) {
                    [A, C].forEach(x => { x.classList.add('matched'); x.setAttribute('aria-disabled', 'true'); x.setAttribute('aria-label', 'زوج متطابق: ' + g.deck[a].name); });
                    g.open = []; g.matched++;
                    gResult.textContent = 'زوج متطابق! ' + g.deck[a].sym;
                    if (g.matched === SYMS.length) winGame();
                } else {
                    g.lock = true;
                    gTimer = setTimeout(() => {
                        [[A, a], [C, c]].forEach(x => { x[0].classList.remove('up'); x[0].setAttribute('aria-label', backLabel(x[1])); });
                        g.open = []; g.lock = false;
                    }, reduce ? 500 : 800);
                }
            }
            function winGame() {
                gState.done = true;
                gResult.textContent = 'كسبتي في ' + gState.moves + ' حركة! 🎉';
                mark('game', 'match');
                gActions.textContent = '';
                const secret = CAT.planets.find(p => p.unlock && p.unlock.type === 'game');
                if (secret) {
                    const b = el('button', 'ubtn btn-main', 'افتحي المكان السري 🔮'); b.type = 'button';
                    b.addEventListener('click', () => { hideDialog(GAME); location.hash = 'world'; go('world'); onPlanet(secret); });
                    gActions.appendChild(b);
                }
                const again = el('button', 'ubtn btn-soft', 'لعبة تانية 🔄'); again.type = 'button';
                again.addEventListener('click', () => { newGame(); gGrid.firstElementChild.focus(); });
                gActions.appendChild(again);
                (gActions.firstElementChild || again).focus();
            }
            function openGame() { newGame(); showDialog(GAME, gGrid.firstElementChild); }
            GAME._onClose = () => clearTimeout(gTimer);
            $('#g-close').addEventListener('click', () => hideDialog(GAME));
            GAME.addEventListener('click', e => { if (e.target === GAME) hideDialog(GAME); });
            $('#g-restart').addEventListener('click', () => { newGame(); gGrid.firstElementChild.focus(); });
            document.addEventListener('click', e => { if (e.target.closest('[data-game]')) openGame(); });


            /* ------------------------------------------------------------------
               Secret adventure — a few riddles; each solved one opens a letter / part of the story,
               and after the last one a prepared surprise. Content: content.json -> "adventure".
               ------------------------------------------------------------------ */
            const ADV = $('#adv'), advSteps = $('#adv-steps'), advIn = $('#adv-in'), advMsg = $('#adv-msg'), advHintBtn = $('#adv-hint');
            let advView = 0;                 // stage index being shown, or 'finale'
            const advTries = {};             // wrong attempts per stage (this visit only)
            const WRONG = ['لسه مش دي 🤍 جرّبي تاني', 'قريبة؟ فكّري كمان شوية 💭', 'مش دي بردو 😅 إنتي قدّها', 'استني، خدي نفس وجرّبي تاني 🌸'];

            function advDone() { return L.currentStage(P, CAT.adv.stages) === -1; }
            function advBurst() { const r = $('.adv-card').getBoundingClientRect(); burst(r.left + r.width / 2, r.top + 90, 16); }
            function advShowReward(r, title) {
                $('#adv-reward').hidden = false;
                $('#adv-r-title').textContent = title || (r && r.title) || '';
                $('#adv-r-text').textContent = (r && r.text) || '';
                const img = $('#adv-r-img');
                if (r && typeof r.image === 'string' && IMG_OK.test(r.image)) { img.src = r.image; img.alt = r.alt || (r.title || ''); img.hidden = false; }
                else { img.hidden = true; img.removeAttribute('src'); }
            }
            function advHintsRender(st) {
                const ul = $('#adv-hints'); ul.textContent = '';
                const list = st.hints || [], n = Math.min(list.length, P.hints[st.id] || 0);
                for (let i = 0; i < n; i++) ul.appendChild(el('li', null, '💡 ' + list[i]));
                advHintBtn.hidden = list.length === 0;
                advHintBtn.disabled = n >= list.length;
                advHintBtn.textContent = n >= list.length ? 'ده كان آخر تلميح 💡' : n === 0 ? '💡 محتاجة تلميح؟' : '💡 تلميح كمان (' + (n + 1) + ' من ' + list.length + ')';
                advHintBtn.classList.toggle('nudge', (advTries[st.id] || 0) >= 2 && n < list.length);
            }
            function renderAdv(view) {
                const A = CAT.adv, stages = A.stages, cur = L.currentStage(P, stages);
                if (view === undefined || view === null) view = cur >= 0 ? cur : 'finale';
                if (view === 'finale' && cur !== -1) view = cur;
                if (view !== 'finale' && (view > cur && cur !== -1)) view = cur;
                advView = view;
                $('#adv-title').textContent = A.title || 'المغامرة السرية 🗝️';
                const st = view === 'finale' ? null : stages[view];
                $('#adv-emoji').textContent = st ? (st.emoji || '🗝️') : ((A.finale && A.finale.emoji) || '🎁');
                /* step dots */
                advSteps.textContent = '';
                stages.forEach((x, i) => {
                    const done = L.has(P, 'adv', x.id), locked = cur !== -1 && i > cur;
                    const li = el('li'), b = el('button', 'ubtn adv-dot' + (done ? ' done' : '') + (i === cur ? ' now' : '') + (locked ? ' locked' : '') + (view === i ? ' view' : ''), done ? '✓' : String(i + 1));
                    b.type = 'button';
                    b.setAttribute('aria-label', 'المرحلة ' + (i + 1) + '، ' + (done ? 'اتحلّت' : locked ? 'مقفولة' : 'الحالية'));
                    if (view === i) b.setAttribute('aria-current', 'step');
                    if (locked) b.setAttribute('aria-disabled', 'true'); else b.addEventListener('click', () => { renderAdv(i); advFocus(); });
                    li.appendChild(b); advSteps.appendChild(li);
                });
                if (A.finale) {
                    const li = el('li'), can = cur === -1;
                    const b = el('button', 'ubtn adv-dot' + (can ? (L.has(P, 'advDone', 'finale') ? ' done' : ' now') : ' locked') + (view === 'finale' ? ' view' : ''), can ? '🎁' : '🔒');
                    b.type = 'button'; b.setAttribute('aria-label', 'المفاجأة الأخيرة، ' + (can ? 'مفتوحة' : 'مقفولة لحد ما تحلّي كل المراحل'));
                    if (view === 'finale') b.setAttribute('aria-current', 'step');
                    if (!can) b.setAttribute('aria-disabled', 'true'); else b.addEventListener('click', () => { renderAdv('finale'); advFocus(); });
                    li.appendChild(b); advSteps.appendChild(li);
                }
                const actions = $('#adv-actions'); actions.textContent = '';
                const addBtn = (label, primary, fn) => { const b = el('button', 'ubtn ' + (primary ? 'btn-main' : 'btn-soft'), label); b.type = 'button'; b.addEventListener('click', fn); actions.appendChild(b); return b; };
                $('#adv-puzzle').hidden = true; $('#adv-reward').hidden = true;
                $('#adv-intro').textContent = '';
                advMsg.textContent = ''; advMsg.className = '';

                if (!st) {                                   /* final surprise */
                    const f = A.finale || {};
                    advShowReward(f, f.title);
                    if (!L.has(P, 'advDone', 'finale')) { mark('advDone', 'finale'); advBurst(); }
                    addBtn('قوليلي في الشات 💬', true, () => { hideDialog(ADV); window.LoveApp.fillInput('🗝️ خلّصت المغامرة السرية! '); });
                    addBtn('تمام 💖', false, () => hideDialog(ADV));
                    return;
                }
                const solved = L.has(P, 'adv', st.id);
                if (!stages.some(x => L.has(P, 'adv', x.id)) && view === 0) $('#adv-intro').textContent = A.intro || '';
                $('#adv-story').textContent = st.story || '';
                $('#adv-riddle').textContent = st.riddle || '';
                $('#adv-puzzle').hidden = false;
                if (solved) {                                /* review of a solved stage: reward stays readable */
                    $('#adv-form').hidden = true; $('#adv-hints').textContent = ''; advHintBtn.hidden = true;
                    advShowReward(st.reward);
                    if (cur === -1) addBtn(L.has(P, 'advDone', 'finale') ? 'شوفي المفاجأة الأخيرة تاني 🎁' : 'افتحي المفاجأة الأخيرة 🎁', true, () => { renderAdv('finale'); advFocus(); });
                    else addBtn('كملي للمرحلة الجاية ➜', true, () => { renderAdv(cur); advFocus(); });
                } else {
                    $('#adv-form').hidden = false; advIn.value = '';
                    advHintsRender(st);
                }
            }
            function advFocus() {
                const t = advView !== 'finale' && !$('#adv-form').hidden && !$('#adv-puzzle').hidden ? advIn : ($('#adv-actions button') || $('#adv-close'));
                focusSoon(t);
                ADV.querySelector('.adv-card').scrollTop = 0;
            }
            function openAdventure() {
                if (!unlocked || !CAT.adv.stages.length) return;
                renderAdv();
                showDialog(ADV, advView !== 'finale' && !$('#adv-form').hidden ? advIn : ($('#adv-actions button') || $('#adv-close')));
            }
            $('#adv-form').addEventListener('submit', e => {
                e.preventDefault();
                const st = CAT.adv.stages[advView]; if (!st || L.has(P, 'adv', st.id)) return;
                const v = advIn.value;
                if (!v.trim()) { advMsg.className = ''; advMsg.textContent = 'اكتبي إجابتك الأول ✏️'; advIn.focus(); return; }
                if (L.checkAnswer(st, v)) {
                    advMsg.className = 'good'; advMsg.textContent = 'صح! 🎉';
                    mark('adv', st.id);
                    renderAdv(advView); advBurst(); advFocus();
                } else {
                    advTries[st.id] = (advTries[st.id] || 0) + 1;
                    const t = advTries[st.id], hasMore = (st.hints || []).length > (P.hints[st.id] || 0);
                    advMsg.className = ''; advMsg.textContent = WRONG[(t - 1) % WRONG.length] + (t >= 2 && hasMore ? ' — محتاجة تلميح؟ 💡' : '');
                    advIn.classList.remove('shake'); void advIn.offsetWidth; if (!reduce) advIn.classList.add('shake');
                    advIn.select(); advHintsRender(st);
                }
            });
            advHintBtn.addEventListener('click', () => {
                const st = CAT.adv.stages[advView]; if (!st || L.has(P, 'adv', st.id)) return;
                const n = L.useHint(P, st.id, (st.hints || []).length); saveProgress();
                advHintsRender(st);
                advMsg.className = ''; advMsg.textContent = 'تلميح ' + n + ' من ' + st.hints.length + ' 💡';
                if (advHintBtn.disabled) advIn.focus();
            });
            $('#adv-close').addEventListener('click', () => hideDialog(ADV));
            ADV.addEventListener('click', e => { if (e.target === ADV) hideDialog(ADV); });
            document.addEventListener('click', e => { if (e.target.closest('[data-adventure]')) openAdventure(); });

            /* ------------------------------------------------------------------
               Live scene on the home page: welcome line for the time of day + "how are you feeling?"
               ------------------------------------------------------------------ */
            const DEFAULT_GREET = {
                dawn: ['صباح النور يا هاجر 🌅'], morning: ['صباح الخير يا هاجر ☀️'], afternoon: ['نهارك سعيد يا هاجر 🌤️'],
                evening: ['مساء الخير يا هاجر 🌇'], night: ['ليلة هادية يا هاجر 🌙']
            };
            let liveReady = false;
            function activeMoodObj() { const id = L.activeMood(P, Date.now()); return CAT.moods.find(m => m.id === id) || null; }
            function renderGreeting() {
                const lines = (CAT.greet[curTod] && CAT.greet[curTod].length) ? CAT.greet[curTod] : DEFAULT_GREET[curTod] || [];
                const g = $('#live-greet');
                const i = L.greetingIndex(P, curTod, lines.length);
                g.hidden = i < 0; if (i >= 0) g.textContent = lines[i];
                saveProgress();
            }
            function moodLine(m, again) {
                const key = 'mood-' + m.id, last = P.live.last[key];
                const i = (again || last == null || last >= m.messages.length) ? L.pickLine(P, key, m.messages.length) : last;
                if (i !== last) saveProgress();
                return m.messages[i];
            }
            function renderMood() {
                const m = activeMoodObj();
                applyMoodScene(m ? m.scene : '');
                $$('.mood-chip').forEach(b => b.setAttribute('aria-pressed', m && b.dataset.mood === m.id ? 'true' : 'false'));
                const card = $('#mood-card');
                card.hidden = !m;
                if (m) $('#mood-text').textContent = moodLine(m, false);
            }
            function buildMoods() {
                const row = $('#mood-row'); row.textContent = '';
                CAT.moods.forEach(m => {
                    const b = el('button', 'ubtn mood-chip', (m.emoji ? m.emoji + ' ' : '') + m.label);
                    b.type = 'button'; b.dataset.mood = m.id; b.setAttribute('aria-pressed', 'false');
                    b.addEventListener('click', () => {
                        if (L.activeMood(P, Date.now()) === m.id) { P.live.mood = ''; P.live.moodAt = 0; saveProgress(); renderMood(); return; }
                        P.live.mood = m.id; P.live.moodAt = Date.now();
                        const first = !L.has(P, 'mood', m.id);
                        saveProgress(); renderMood();
                        $('#mood-text').textContent = moodLine(m, true);
                        if (first) mark('mood', m.id);
                    });
                    row.appendChild(b);
                });
                $('#mood-box').hidden = CAT.moods.length === 0;
            }
            $('#mood-more').addEventListener('click', () => { const m = activeMoodObj(); if (m) $('#mood-text').textContent = moodLine(m, true); });
            $('#mood-chat').addEventListener('click', () => { const m = activeMoodObj(); if (m && window.LoveApp.fillInput) window.LoveApp.fillInput((m.emoji ? m.emoji + ' ' : '') + m.label + ' — '); });
            function liveTick() {
                const t = L.partOfDay(new Date());
                if (t === curTod) return;
                applyTod(t);
                if (liveReady) { mark('tod', t); renderGreeting(); }
            }
            setInterval(liveTick, 60000);
            document.addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });
            window.LoveApp.liveTick = liveTick;


            /* ------------------------------------------------------------------
               App mode (PWA): install button, offline note, new-version notice, optional message alerts.
               The service worker (sw.js) only exists when the site is served over https / localhost.
               ------------------------------------------------------------------ */
            const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
            const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            let installEvt = null, swReg = null, reloadingForSw = false;
            const installBtn = $('#install-btn'), notifyBtn = $('#notify-btn'), notifyNote = $('#notify-note'), appRow = $('#app-row');
            const NOTIFY_KEY = 'loveNotify';
            const notifyOn = () => { try { return localStorage.getItem(NOTIFY_KEY) === '1'; } catch (_) { return false; } };
            const notifySupported = () => 'Notification' in window;

            function renderAppRow() {
                const showInstall = !standalone() && (!!installEvt || isIOS);
                installBtn.hidden = !showInstall;
                let showNotify = notifySupported();
                if (showNotify) {
                    const perm = Notification.permission, on = notifyOn() && perm === 'granted';
                    notifyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    notifyBtn.textContent = perm === 'denied' ? '🔕 التنبيهات ممنوعة من إعدادات المتصفح' : on ? '🔔 التنبيهات شغّالة (اضغطي للإيقاف)' : '🔔 نبّهيني لما تيجي رسالة';
                    notifyBtn.disabled = perm === 'denied';
                    notifyNote.hidden = !on;
                    notifyNote.textContent = on ? 'بتوصلك وإنتي فاتحة الموقع أو التطبيق في الخلفية. التنبيه مش بيعرض نص الرسالة.' : '';
                }
                notifyBtn.hidden = !showNotify;
                appRow.hidden = installBtn.hidden && notifyBtn.hidden;
            }
            window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderAppRow(); });
            window.addEventListener('appinstalled', () => { installEvt = null; renderAppRow(); toast({ emoji: '📲', title: 'اتثبّت!', text: 'هتلاقي «هاجر 💖» وسط تطبيقاتك' }); });
            installBtn.addEventListener('click', async () => {
                if (installEvt) {
                    const ev = installEvt; installEvt = null;
                    try { await ev.prompt(); await ev.userChoice; } catch (_) { }
                    renderAppRow();
                } else if (isIOS) {
                    openModal({
                        emoji: '📲', meta: 'على الآيفون', title: 'ثبّتي الموقع كتطبيق',
                        text: '١) افتحي الموقع في Safari\n٢) اضغطي زرار المشاركة ⬆️ تحت\n٣) اختاري «إضافة إلى الشاشة الرئيسية»\n٤) اضغطي «إضافة» وهتلاقيه وسط تطبيقاتك 💖'
                    });
                }
            });

            async function showAlert() {
                const opts = { body: 'افتحي الشات 💌', icon: 'icons/icon-192.png', badge: 'icons/favicon-64.png', tag: 'love-msg', renotify: true, lang: 'ar', dir: 'rtl' };
                try {
                    const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
                    if (reg && reg.showNotification) return await reg.showNotification('💌 عندك رسالة جديدة', opts);
                } catch (_) { }
                try { new Notification('💌 عندك رسالة جديدة', opts); } catch (_) { }
            }
            /* called by the chat when a message from the other person arrives while the page is in the background */
            window.LoveApp.notifyNew = () => {
                if (!notifySupported() || Notification.permission !== 'granted' || !notifyOn()) return;
                showAlert();
            };
            notifyBtn.addEventListener('click', async () => {
                if (!notifySupported()) return;
                if (notifyOn() && Notification.permission === 'granted') {
                    try { localStorage.setItem(NOTIFY_KEY, '0'); } catch (_) { }
                    renderAppRow(); return;
                }
                let perm = Notification.permission;
                if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (_) { } }
                if (perm === 'granted') {
                    try { localStorage.setItem(NOTIFY_KEY, '1'); } catch (_) { }
                    toast({ emoji: '🔔', title: 'تمام!', text: 'هنبّهك لما تيجي رسالة جديدة' });
                }
                renderAppRow();
            });

            const netPill = $('#net-pill');
            function netState() { netPill.hidden = !unlocked || navigator.onLine !== false; }
            window.addEventListener('online', netState); window.addEventListener('offline', netState);
            window.LoveApp.netState = netState;

            if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
                navigator.serviceWorker.register('sw.js').then(reg => {
                    swReg = reg;
                    const offer = w => toast({ emoji: '✨', title: 'فيه نسخة جديدة', text: 'اضغطي عشان الموقع يتحدّث', goLabel: 'حدّثي', go: () => w.postMessage('SKIP_WAITING') });
                    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
                    reg.addEventListener('updatefound', () => {
                        const w = reg.installing; if (!w) return;
                        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
                    });
                    setInterval(() => reg.update().catch(() => { }), 60 * 60 * 1000);
                }).catch(err => console.warn('sw', err));
                navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadingForSw || !hadController) return; reloadingForSw = true; location.reload(); });
            }
            const hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
            renderAppRow();

            function initWorld(data) {
                const w = data.world || {};
                CAT.story = (data.story || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
                    .map(it => Object.assign({}, it, { _id: it.id || (it.date + '|' + (it.title || '')) }));
                CAT.openWhen = (data.openWhen || []).map((it, i) => Object.assign({}, it, { _id: it.id || String(i) }));
                CAT.stars = (data.stars || []).map((it, i) => Object.assign({}, it, { _id: it.id || String(i) }));
                CAT.surprises = (data.surprises || []).filter(x => x && x.id);
                CAT.planets = (w.planets || []).filter(x => x && x.id);
                CAT.ach = (data.achievements || []).filter(x => x && x.id);
                const adv = data.adventure || {};
                CAT.adv = { title: adv.title || '', intro: adv.intro || '', stages: (adv.stages || []).filter(x => x && x.id), finale: adv.finale || null };
                const lv = data.live || {};
                CAT.greet = lv.greetings && typeof lv.greetings === 'object' ? lv.greetings : {};
                CAT.moods = (lv.moods || []).filter(x => x && x.id && x.label && Array.isArray(x.messages) && x.messages.length);
                CAT.valid = {
                    story: CAT.story.map(x => x._id), openWhen: CAT.openWhen.map(x => x._id), stars: CAT.stars.map(x => x._id),
                    surprise: CAT.surprises.map(x => x.id), challenge: CAT.surprises.filter(x => x.type === 'challenge').map(x => x.id),
                    adv: CAT.adv.stages.map(x => x.id), tod: L.TODS.slice(), mood: CAT.moods.map(x => x.id)
                };
                loadProgress();
                const now = Date.now();
                const isNew = L.touchVisit(P, now);
                L.ensureSurprise(P, CAT.surprises.map(x => ({ id: x.id, type: x.type })), isNew, now);
                L.add(P, 'tod', curTod);
                saveProgress();
                buildWorld();
                buildMoods(); renderGreeting(); renderMood();
                liveReady = true; netState();
                checkUnlocks(firstRun);       // first time ever: no pop-ups for things that were already true
            }

            /* dark / dim sky toggle (kept from the old page) */
            $('#darkModeToggle').addEventListener('click', e => {
                e.preventDefault();
                const on = document.body.classList.toggle('dark-mode');
                try { localStorage.setItem('loveSiteDarkMode', on ? 'true' : 'false'); } catch (_) { }
            });

            /* glowing heart tap */
            homeStage.addEventListener('click', () => {
                const r = homeStage.getBoundingClientRect();
                homeStage.classList.remove('pulse'); void homeStage.offsetWidth; homeStage.classList.add('pulse');
                burst(r.left + r.width / 2, r.top + r.height / 2, 14);
            });

            /* letter envelope */
            const env = $('#env'), envBtn = $('#env-btn'), letterP = $('#letter-text');
            let letterText = '', typed = false, typer = null, hearts = null, envOpen = false;
            const sound = $('#loveSound'); sound.volume = 0.1;
            const letterColors = ['#c2185b', '#d81b60', '#ad1457', '#e91e63', '#8e24aa', '#b0306a'];

            function fillLetter() {
                clearInterval(typer);
                letterP.textContent = '';
                letterText.split(/\s+/).forEach((w, i, all) => {
                    const sp = el('span', null, w + (i < all.length - 1 ? ' ' : ''));
                    sp.style.color = letterColors[i % letterColors.length];
                    letterP.appendChild(sp);
                });
            }
            function typeLetter() {
                clearInterval(typer);
                letterP.textContent = '';
                if (reduce) { fillLetter(); return; }
                const words = letterText.split(/\s+/);
                let i = 0;
                typer = setInterval(() => {
                    if (i >= words.length) { clearInterval(typer); return; }
                    const sp = el('span', null, words[i] + (i < words.length - 1 ? ' ' : ''));
                    sp.style.color = letterColors[i % letterColors.length];
                    letterP.appendChild(sp);
                    i++;
                }, 160);
            }
            function floatHeart() {
                const h = el('div', 'heart', '💖');
                h.style.left = (Math.random() * 90) + 'vw';
                h.style.fontSize = (Math.random() * 20 + 10) + 'px';
                document.body.appendChild(h);
                setTimeout(() => h.remove(), 4000);
            }
            function openEnvelope() {
                env.classList.add('open'); envOpen = true;
                envBtn.textContent = 'اقفلي الرسالة';
                try { sound.currentTime = 0; const p = sound.play(); if (p && p.catch) p.catch(() => { }); } catch (_) { }
                if (!typed) { typeLetter(); typed = true; }
                if (!reduce) hearts = setInterval(floatHeart, 300);
                mark('letter', 'letter');
            }
            function closeEnvelope() {
                if (!envOpen) return;
                env.classList.remove('open'); envOpen = false;
                envBtn.textContent = 'افتحي الرسالة 💌';
                try { sound.pause(); sound.currentTime = 0; } catch (_) { }
                clearInterval(hearts);
            }
            envBtn.addEventListener('click', () => envOpen ? closeEnvelope() : openEnvelope());
            $('#env-letter').addEventListener('click', () => { if (typed) fillLetter(); });

            /* rendering the decrypted payload */
            function fmtDate(s) {
                const d = new Date(String(s) + 'T00:00:00');
                return isNaN(d) ? String(s || '') : d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
            }

            function render(data) {
                initWorld(data);
                randomList = (data.randomMessages || []).map(String).filter(Boolean); bag = [];
                letterText = String(data.loveLetter || '');
                letterP.textContent = '';
                const sr = el('span', 'sr-only', letterText); letterP.parentNode.insertBefore(sr, letterP);
                letterP.setAttribute('aria-hidden', 'true');

                /* story */
                const tl = $('#timeline'); tl.textContent = '';
                const story = CAT.story;
                if (!story.length) tl.appendChild(el('li', null, 'لسه مفيش ذكريات هنا.'));
                story.forEach((it, i) => {
                    const li = el('li', 'tl-item' + (L.has(P, 'story', it._id) ? ' seen' : '')); li.style.setProperty('--i', Math.min(i, 10));
                    const btn = el('button', 'ubtn tl-card'); btn.type = 'button';
                    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'tl-body-' + i);
                    const top = el('span', 'tl-top');
                    top.appendChild(el('span', 'tl-emoji', it.emoji || '💖'));
                    const titles = el('span', 'tl-titles');
                    titles.appendChild(el('span', 'tl-date', fmtDate(it.date)));
                    titles.appendChild(el('span', 'tl-title', it.title || ''));
                    top.appendChild(titles);
                    const chev = el('i', 'fa-solid fa-chevron-down tl-chev'); chev.setAttribute('aria-hidden', 'true');
                    top.appendChild(chev);
                    btn.appendChild(top);
                    const body = el('div', 'tl-body'); body.id = 'tl-body-' + i;
                    const inner = el('div'); inner.appendChild(el('p', 'tl-text', it.text || ''));
                    if (typeof it.image === 'string' && IMG_OK.test(it.image)) { const im = el('img', 'tl-img'); im.src = it.image; im.alt = it.title || ''; im.loading = 'lazy'; inner.appendChild(im); }
                    body.appendChild(inner);
                    btn.appendChild(body);
                    btn.addEventListener('click', () => {
                        const open = li.classList.toggle('open');
                        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                        if (open) { li.classList.add('seen'); mark('story', it._id); }
                    });
                    li.appendChild(btn);
                    tl.appendChild(li);
                });

                /* open when */
                const grid = $('#ow-grid'); grid.textContent = '';
                CAT.openWhen.forEach((it, i) => {
                    const id = it._id;
                    const b = el('button', 'ubtn ow-card' + (L.has(P, 'openWhen', id) ? ' seen' : '')); b.type = 'button';
                    b.appendChild(el('span', 'ow-badge', 'اتفتحت ✓'));
                    b.appendChild(el('span', 'ow-emoji', it.emoji || '💌'));
                    b.appendChild(el('span', 'ow-label', 'افتحيني لما ' + (it.label || '')));
                    b.addEventListener('click', () => {
                        b.classList.add('seen');
                        openModal({ emoji: it.emoji || '💌', title: 'افتحيني لما ' + (it.label || ''), text: it.text, image: it.image, imageAlt: it.label || '' });
                        mark('openWhen', id);
                    });
                    grid.appendChild(b);
                });

                /* stars */
                const zone = $('#sky-zone'); zone.textContent = '';
                const list = CAT.stars;
                const count = $('#sky-count');
                const updateCount = () => {
                    const n = list.filter(x => L.has(P, 'stars', x._id)).length;
                    count.textContent = list.length ? '(' + n + ' من ' + list.length + ')' : '';
                };
                list.forEach((it, i) => {
                    const id = it._id;
                    const b = el('button', 'ubtn wish' + (L.has(P, 'stars', id) ? ' seen' : '')); b.type = 'button';
                    b.style.left = it.x + '%'; b.style.top = it.y + '%';
                    b.style.setProperty('--d', (-(i * 0.7) % 3.4).toFixed(2) + 's');
                    b.setAttribute('aria-label', 'نجمة رقم ' + (i + 1));
                    const ic = el('span', null, '\u2605'); ic.setAttribute('aria-hidden', 'true'); b.appendChild(ic);
                    b.addEventListener('click', () => {
                        b.classList.add('seen');
                        const r = b.getBoundingClientRect();
                        burst(r.left + r.width / 2, r.top + r.height / 2, 8, ['✨', '⭐', '💖']);
                        openModal({ emoji: it.emoji || (it.kind === 'secret' ? '🤫' : '🌟'), meta: it.kind === 'secret' ? 'رسالة مخفية' : 'ذكرى', title: it.title, text: it.text, image: it.image, imageAlt: it.title || '' });
                        mark('stars', id); updateCount();
                    });
                    zone.appendChild(b);
                });
                updateCount();
                refreshWorld();
            }
        })();