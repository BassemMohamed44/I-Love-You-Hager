    <script>
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
            const SEALED = /*@@SEALED@@*/ null;
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
    </script>
