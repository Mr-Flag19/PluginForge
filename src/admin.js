(function () {
    var $ = function (id) { return document.getElementById(id); };

    // Date and time in the admin's own time zone, with the zone named (e.g. "2 Nov 2026, 09:00 GMT")
    function fmtLocal(ms) {
        return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    }

    // The wording for an account's plan and prompts, used on both the project card and the user card
    function usageView(acc) {
        if (!acc) return { tier: 'Unavailable', left: 'Unavailable', pct: null, reset: '' };
        var span = acc.period === 'day' ? '' : ' this month';
        var left = acc.bonus > 0
            ? acc.left + ' left (limit ' + acc.limit + ', plus ' + acc.bonus + ' extra)'
            : acc.left + ' of ' + acc.limit + ' left' + span + ' (' + acc.used + ' used)';
        return {
            tier: acc.tierName + ' Tier',
            left: left,
            pct: Math.max(0, Math.min(100, (acc.left / Math.max(acc.limit, acc.left)) * 100)),
            reset: acc.resetsAt ? 'Refills ' + fmtLocal(acc.resetsAt) : 'Full. Refills 24 hours after their next prompt.'
        };
    }

    function fmt(ms) {
        return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
    }

    async function adminFetch(query, method) {
        var r = await fetch('/api/admin/projects' + query, {
            method: method || 'GET',
            credentials: 'same-origin',
            headers: { 'x-pf-request': '1' }
        });
        var data = {};
        try { data = await r.json(); } catch (e) {}
        return { ok: r.ok, status: r.status, data: data };
    }

    function show(signedIn) {
        $('login').hidden = signedIn;
        $('denied').hidden = true;
        $('topbar').hidden = false;
        $('panel').hidden = !signedIn;
        $('signout').hidden = !signedIn;
    }

    // Signed in, but not an admin (or the server said no): show only the access denied card
    function deniedView() {
        $('login').hidden = true;
        $('panel').hidden = true;
        $('denied').hidden = false;
        $('topbar').hidden = true;
        $('who').hidden = true;
        $('result').hidden = true;
        $('inspect').hidden = true;
        $('user-inspect').hidden = true;
        document.body.style.overflow = '';
    }

    function signedOutView(message) {
        $('topbar').hidden = false;
        $('denied').hidden = true;
        show(false);
        $('who').hidden = true;
        $('login-error').textContent = message || '';
        $('result').hidden = true;
        $('inspect').hidden = true;
        document.body.style.overflow = '';
    }

    async function signOut() {
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'x-pf-request': '1' } }); } catch (e) {}
        signedOutView('You have been signed out.');
    }

    async function loadRecent() {
        var res = await adminFetch('');
        if (res.status === 401) return signedOutView('Your session ended. Sign in again.');
        if (res.status === 403) return deniedView();
        var list = $('recent');
        list.textContent = '';
        if (!res.ok) {
            $('recent-total').textContent = '';
            var err = document.createElement('li');
            err.className = 'p-4 text-xs text-[#a1a1aa]';
            err.textContent = res.data.error || 'Could not load projects.';
            list.appendChild(err);
            return;
        }
        $('recent-total').textContent = res.data.total + (res.data.total === 1 ? ' project' : ' projects') + ' in total';
        if (res.data.projects.length === 0) {
            var empty = document.createElement('li');
            empty.className = 'p-4 text-xs text-[#a1a1aa]';
            empty.textContent = 'No projects yet. They appear here once someone starts a chat on the projects page.';
            list.appendChild(empty);
            return;
        }
        res.data.projects.forEach(function (p) {
            var li = document.createElement('li');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'w-full text-left p-4 flex items-center justify-between gap-4 hover:bg-[#3A3D42]/30 transition-colors';
            var left = document.createElement('div');
            left.className = 'min-w-0';
            var title = document.createElement('div');
            title.className = 'text-sm font-medium truncate';
            title.textContent = p.title;
            var meta = document.createElement('div');
            meta.className = 'mt-0.5 text-[11px] font-mono text-[#71717a] truncate';
            meta.textContent = p.id + ' · ' + (p.ownerName || 'Unknown account') + ' · ' + p.messageCount + (p.messageCount === 1 ? ' message' : ' messages');
            left.appendChild(title);
            left.appendChild(meta);
            var when = document.createElement('div');
            when.className = 'text-[11px] text-[#a1a1aa] shrink-0';
            when.textContent = fmt(p.updatedAt);
            btn.appendChild(left);
            btn.appendChild(when);
            btn.addEventListener('click', function () {
                $('lookup-id').value = p.id;
                $('lookup-count').textContent = '16/16';
                lookup(p.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            li.appendChild(btn);
            list.appendChild(li);
        });
    }

    var current = null;
    var lastFocus = null;

    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

    function promptsOf(p) { return p.messages.filter(function (m) { return m.role === 'user'; }); }

    function renderProject(p) {
        current = p;
        $('r-title').textContent = p.title;
        $('r-id').textContent = 'Project ID: ' + p.id;
        $('r-created').textContent = fmt(p.createdAt);
        $('r-owner').textContent = (p.ownerName || 'Unknown') + (p.ownerUsername ? ' (@' + p.ownerUsername + ')' : '') + ', Discord ID ' + p.ownerId;
        var uv = usageView(p.account);
        $('r-tier').textContent = uv.tier;
        $('r-left').textContent = uv.left;
        $('r-bar').style.width = (uv.pct || 0) + '%';
        $('r-bar-wrap').hidden = uv.pct === null;
        $('r-reset').textContent = uv.reset;
        $('r-delete').textContent = 'Delete';
        $('r-delete').dataset.confirm = '';
        $('result').hidden = false;
    }

    function openInspect() {
        if (!current) return;
        var prompts = promptsOf(current);
        $('i-title').textContent = current.title;
        $('i-sub').textContent = (current.ownerName || 'Unknown') + ' · ' + current.id;
        $('i-count').textContent = String(prompts.length);
        var list = $('i-list');
        list.textContent = '';
        if (!prompts.length) {
            var empty = document.createElement('li');
            empty.className = 'text-sm text-[#a1a1aa]';
            empty.textContent = 'No prompts in this project.';
            list.appendChild(empty);
        }
        prompts.forEach(function (m, i) {
            var card = document.createElement('li');
            card.className = 'bg-[#2C2E31] border border-[#3A3D42] rounded-lg p-4';
            var head = document.createElement('div');
            head.className = 'flex items-baseline justify-between gap-3 text-xs text-[#a1a1aa] mb-2';
            var label = document.createElement('span');
            label.className = 'font-medium';
            label.textContent = 'Prompt ' + (i + 1) + ' of ' + prompts.length;
            var when = document.createElement('span');
            when.textContent = m.at ? fmt(m.at) : 'Time not recorded';
            head.appendChild(label);
            head.appendChild(when);
            var body = document.createElement('div');
            body.className = 'text-sm leading-relaxed whitespace-pre-wrap break-words text-[#f4f4f5]';
            body.textContent = m.text;
            card.appendChild(head);
            card.appendChild(body);
            list.appendChild(card);
        });
        list.scrollTop = 0;
        lastFocus = document.activeElement;
        $('inspect').hidden = false;
        document.body.style.overflow = 'hidden';
        $('i-close').focus();
    }

    function closeInspect() {
        if ($('inspect').hidden) return;
        $('inspect').hidden = true;
        document.body.style.overflow = '';
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }

    async function lookup(id) {
        $('lookup-error').textContent = '';
        $('result').hidden = true;
        id = id.trim().toLowerCase();
        if (!/^[a-z0-9]{16}$/.test(id)) {
            $('lookup-error').textContent = 'A project ID is exactly 16 letters and numbers.';
            return;
        }
        var res = await adminFetch('?id=' + encodeURIComponent(id));
        if (res.status === 401) return signedOutView('Your session ended. Sign in again.');
        if (res.status === 403) return deniedView();
        if (!res.ok) {
            $('lookup-error').textContent = res.data.error || 'Lookup failed.';
            return;
        }
        renderProject(res.data);
    }

    $('lookup-form').addEventListener('submit', function (e) { e.preventDefault(); lookup($('lookup-id').value); });
    $('lookup-id').addEventListener('input', function () { $('lookup-count').textContent = this.value.length + '/16'; });
    $('signout').addEventListener('click', function () { signOut(); });

    $('r-inspect').addEventListener('click', openInspect);
    $('i-close').addEventListener('click', closeInspect);
    $('inspect').addEventListener('click', function (e) { if (e.target === this) closeInspect(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeInspect(); });

    $('r-copy').addEventListener('click', function () {
        var btn = this;
        try {
            navigator.clipboard.writeText(current ? current.id : '').then(function () {
                btn.textContent = 'Copied';
                setTimeout(function () { btn.textContent = 'Copy ID'; }, 1500);
            }).catch(function () {});
        } catch (e) {}
    });

    // Two clicks to delete: the first asks, the second does it
    $('r-delete').addEventListener('click', async function () {
        var btn = this;
        if (!btn.dataset.confirm) {
            btn.dataset.confirm = '1';
            btn.textContent = 'Click again to delete';
            return;
        }
        var res = await adminFetch('?id=' + encodeURIComponent(current ? current.id : ''), 'DELETE');
        if (res.ok) {
            $('result').hidden = true;
            $('lookup-error').textContent = 'Project deleted.';
            loadRecent();
        } else {
            btn.dataset.confirm = '';
            btn.textContent = 'Delete';
            $('lookup-error').textContent = res.data.error || 'Could not delete the project.';
        }
    });

    // Messages Discord sign-in can send us back with
    function loginMessage() {
        var q = new URLSearchParams(window.location.search);
        var error = q.get('error');
        if (window.location.search) { try { window.history.replaceState({}, '', '/admin/'); } catch (e) {} }
        if (error === 'cancelled') return 'Sign in was cancelled.';
        if (error === 'setup') return 'Admin sign-in is not set up yet. Add the Discord environment variables in Vercel.';
        if (error) return 'Sign in did not work. Try again.';
        return '';
    }


    // ---- Tabs ----
    function showView(name) {
        var users = name === 'users';
        $('view-projects').hidden = users;
        $('view-users').hidden = !users;
        $('tab-projects').setAttribute('aria-selected', users ? 'false' : 'true');
        $('tab-users').setAttribute('aria-selected', users ? 'true' : 'false');
        $('tab-projects').className = 'px-1 py-3 mr-5 text-sm font-medium border-b-2 -mb-px ' + (users ? 'text-[#a1a1aa] hover:text-[#f4f4f5] border-transparent' : 'text-[#f4f4f5] border-[#f4f4f5]');
        $('tab-users').className = 'px-1 py-3 text-sm font-medium border-b-2 -mb-px ' + (users ? 'text-[#f4f4f5] border-[#f4f4f5]' : 'text-[#a1a1aa] hover:text-[#f4f4f5] border-transparent');
        if (users) closeInspect(); else closeUserInspect();
    }
    $('tab-projects').addEventListener('click', function () { showView('projects'); });
    $('tab-users').addEventListener('click', function () { showView('users'); });

    // ---- User lookup ----
    var userNow = null;

    async function userFetch(query, method, body) {
        var headers = { 'x-pf-request': '1' };
        if (body) headers['Content-Type'] = 'application/json';
        var r = await fetch('/api/admin/users' + query, { method: method || 'GET', credentials: 'same-origin', headers: headers, body: body ? JSON.stringify(body) : undefined });
        var data = {};
        try { data = await r.json(); } catch (e) {}
        return { ok: r.ok, status: r.status, data: data };
    }

    // Value for a datetime-local box: the given time in the admin's own time zone
    function toLocalInput(ms) {
        var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
        return d.toISOString().slice(0, 16);
    }

    function renderUser(u) {
        userNow = u;
        $('u-name').textContent = u.name ? u.name + (u.username ? ' (@' + u.username + ')' : '') : 'Unknown user';
        $('u-id').textContent = 'Discord ID: ' + u.id;
        var uv = usageView(u.usage);
        $('u-tier').value = u.usage ? u.usage.tier : 'stone';
        $('u-left').textContent = uv.left;
        $('u-bar').style.width = (uv.pct || 0) + '%';
        $('u-reset').textContent = uv.reset;
        $('u-refill-at').value = u.usage && u.usage.resetsAt ? toLocalInput(u.usage.resetsAt) : '';
        $('user').hidden = false;
    }

    async function lookupUser(id) {
        $('user-error').textContent = '';
        $('u-status').textContent = '';
        $('user').hidden = true;
        id = id.trim();
        if (!/^[0-9]{5,25}$/.test(id)) {
            $('user-error').textContent = 'A Discord ID is a long number, like 1343294685829136505.';
            return;
        }
        var res = await userFetch('?id=' + encodeURIComponent(id));
        if (res.status === 401) return signedOutView('Your session ended. Sign in again.');
        if (res.status === 403) return deniedView();
        if (!res.ok) { $('user-error').textContent = res.data.error || 'Lookup failed.'; return; }
        renderUser(res.data);
    }

    // Send one change, then show the account as it is afterwards
    async function userAction(body, doneText, button) {
        if (!userNow) return;
        var buttons = $('user').querySelectorAll('button');
        buttons.forEach(function (b) { b.disabled = true; });
        $('u-status').textContent = 'Saving...';
        var res = await userFetch('', 'POST', Object.assign({ id: userNow.id }, body));
        buttons.forEach(function (b) { b.disabled = false; });
        if (res.status === 401) return signedOutView('Your session ended. Sign in again.');
        if (res.status === 403) return deniedView();
        if (!res.ok) { $('u-status').textContent = res.data.error || 'That did not work.'; return; }
        renderUser(res.data);
        $('u-status').textContent = doneText;
    }

    function amount() {
        var raw = $('u-amount').value.trim();
        if (!/^[0-9]+$/.test(raw)) { $('u-status').textContent = 'Enter a whole number of prompts first.'; return null; }
        return parseInt(raw, 10);
    }


    // ---- Every project URL a user owns ----
    function projectUrl(id) {
        var folder = (window.PLUGINFORGE_CONFIG && window.PLUGINFORGE_CONFIG.projectsPath) || 'code';
        return window.location.origin + '/' + folder + '/' + id;
    }

    function openUserInspect() {
        if (!userNow) return;
        var projects = userNow.projects || [];
        $('ui-title').textContent = userNow.name || 'Unknown user';
        $('ui-sub').textContent = 'Discord ID ' + userNow.id;
        $('ui-count').textContent = String(projects.length);
        var list = $('ui-list');
        list.textContent = '';
        if (!projects.length) {
            var empty = document.createElement('li');
            empty.className = 'text-sm text-[#a1a1aa]';
            empty.textContent = 'This user has no projects yet.';
            list.appendChild(empty);
        }
        projects.forEach(function (p) {
            var url = projectUrl(p.id);
            var card = document.createElement('li');
            card.className = 'bg-[#2C2E31] border border-[#3A3D42] rounded-lg p-4';
            var top = document.createElement('div');
            top.className = 'flex items-baseline justify-between gap-3';
            var title = document.createElement('span');
            title.className = 'text-sm font-medium text-[#f4f4f5] break-words min-w-0';
            title.textContent = p.title;
            var when = document.createElement('span');
            when.className = 'text-xs text-[#a1a1aa] shrink-0';
            when.textContent = p.updatedAt ? fmt(p.updatedAt) : '';
            top.appendChild(title);
            top.appendChild(when);
            var link = document.createElement('div');
            link.className = 'mt-2 text-sm text-[#a1a1aa] break-all select-all';
            link.textContent = url;
            var actions = document.createElement('div');
            actions.className = 'mt-3 flex items-center gap-2';
            var copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'text-sm text-[#f4f4f5] bg-[#26282B] hover:bg-[#3A3D42] border border-[#3A3D42] px-3 py-1.5 rounded-lg transition-colors';
            copy.textContent = 'Copy URL';
            copy.addEventListener('click', function () {
                try {
                    navigator.clipboard.writeText(url).then(function () {
                        copy.textContent = 'Copied';
                        setTimeout(function () { copy.textContent = 'Copy URL'; }, 1500);
                    }).catch(function () {});
                } catch (e) {}
            });
            var view = document.createElement('button');
            view.type = 'button';
            view.className = 'text-sm text-[#f4f4f5] bg-[#26282B] hover:bg-[#3A3D42] border border-[#3A3D42] px-3 py-1.5 rounded-lg transition-colors';
            view.textContent = 'Look up';
            view.addEventListener('click', function () {
                closeUserInspect();
                showView('projects');
                $('lookup-id').value = p.id;
                $('lookup-count').textContent = '16/16';
                lookup(p.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            actions.appendChild(copy);
            actions.appendChild(view);
            card.appendChild(top);
            card.appendChild(link);
            card.appendChild(actions);
            list.appendChild(card);
        });
        list.scrollTop = 0;
        lastFocus = document.activeElement;
        $('user-inspect').hidden = false;
        document.body.style.overflow = 'hidden';
        $('ui-close').focus();
    }

    function closeUserInspect() {
        if ($('user-inspect').hidden) return;
        $('user-inspect').hidden = true;
        document.body.style.overflow = '';
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }

    $('u-inspect').addEventListener('click', openUserInspect);
    $('ui-close').addEventListener('click', closeUserInspect);
    $('user-inspect').addEventListener('click', function (e) { if (e.target === this) closeUserInspect(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeUserInspect(); });

    $('user-form').addEventListener('submit', function (e) { e.preventDefault(); lookupUser($('user-id').value); });
    $('r-user').addEventListener('click', function () {
        if (!current) return;
        showView('users');
        $('user-id').value = current.ownerId;
        lookupUser(current.ownerId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('u-tier-save').addEventListener('click', function () {
        var tier = $('u-tier').value;
        userAction({ action: 'tier', tier: tier }, 'Plan changed to ' + $('u-tier').options[$('u-tier').selectedIndex].text + '.');
    });
    $('u-add').addEventListener('click', function () { var n = amount(); if (n !== null) userAction({ action: 'prompts', add: n }, 'Added ' + n + ' prompts.'); });
    $('u-remove').addEventListener('click', function () { var n = amount(); if (n !== null) userAction({ action: 'prompts', add: -n }, 'Removed ' + n + ' prompts.'); });
    $('u-set').addEventListener('click', function () { var n = amount(); if (n !== null) userAction({ action: 'prompts', set: n }, 'Prompts left set to ' + n + '.'); });
    $('u-revoke').addEventListener('click', function () { if (window.confirm('Sign this person out on every device?')) userAction({ action: 'revoke' }, 'Signed out everywhere.'); });
    $('u-refill-now').addEventListener('click', function () { userAction({ action: 'refill', now: true }, 'Refilled. All prompts are back.'); });
    $('u-refill-set').addEventListener('click', function () {
        var v = $('u-refill-at').value;
        var at = v ? new Date(v).getTime() : NaN;
        if (!isFinite(at)) { $('u-status').textContent = 'Choose a date and time first.'; return; }
        userAction({ action: 'refill', at: at }, 'Refill time set.');
    });

    async function start() {
        var message = loginMessage();
        var me = null;
        try { me = await fetch('/api/auth/me', { credentials: 'same-origin' }); } catch (e) {}
        if (me && me.ok) {
            var user = await me.json();
            if (!user.admin) return deniedView();
            $('who').textContent = user.name + (user.username ? ' · @' + user.username : '');
            $('who').hidden = false;
            show(true);
            loadRecent();
        } else if (me && me.status === 503) {
            signedOutView('Admin sign-in is not set up yet. Add the Discord environment variables in Vercel.');
        } else {
            signedOutView(message);
        }
    }

    start();
})();
