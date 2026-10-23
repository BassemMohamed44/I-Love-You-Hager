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
