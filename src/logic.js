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
