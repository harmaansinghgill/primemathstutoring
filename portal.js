// Prime Maths Tutoring student area.
// Homework, hand-ins, self-marking, marking, messages, notifications and resources, all stored in Supabase.
// Setup steps are in portal-setup/README.md.
(function () {
  // From Supabase: Project Settings, then API Keys. Both are safe to publish:
  // the security rules in portal-setup/*.sql decide what each person can see.
  var SUPABASE_URL = 'https://ebakrrsdpwuhcdouiyep.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_Cphe2mLKw0igMh6O4Iqang_aR4lArXg';

  var SUBJECTS = [
    { id: 'maths', name: 'Maths' },
    { id: 'further-maths', name: 'Further Maths' },
    { id: 'science', name: 'Science' },
  ];
  var BUCKET = 'portal';

  // --- Small helpers ------------------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function by(list, key, value) { return list.filter(function (x) { return x[key] === value; }); }
  function subjectName(id) {
    if (id === 'all') return 'All subjects';
    var s = SUBJECTS.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : id;
  }
  function firstName(name) { return (name || '').trim().split(/\s+/)[0] || 'there'; }
  function localDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function formatDate(iso, withYear) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    return d.toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  // "14:05" today, "Yesterday 09:12", otherwise "Sat 15 Nov, 10:30"
  function formatWhen(iso) {
    var d = new Date(iso), now = new Date();
    var time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (localDay(d) === localDay(now)) return time;
    var y = new Date(now); y.setDate(y.getDate() - 1);
    if (localDay(d) === localDay(y)) return 'Yesterday ' + time;
    return formatDate(iso) + ', ' + time;
  }
  function daysUntil(isoDate) {
    var today = new Date(); today.setHours(12, 0, 0, 0);
    return Math.round((new Date(isoDate + 'T12:00:00') - today) / 86400000);
  }
  function handedInLate(h, s) { return !!(h.due_date && s && localDay(new Date(s.submitted_at)) > h.due_date); }
  function safeFileName(name) {
    var clean = name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + (clean || 'file');
  }
  function say(form, message, kind) {
    var el = form.querySelector('.form-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'form-status' + (kind ? ' is-' + kind : '');
  }
  function busy(form, on) {
    var b = form.querySelector('button[type="submit"]');
    if (b) b.disabled = on;
  }
  // Adds up marks written like "4/5" and "9/10". Anything else is left as written.
  function totalMark(a, b) {
    var re = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/;
    var x = re.exec(a || ''), y = re.exec(b || '');
    if (!x || !y) return '';
    var add = function (p, q) { return Math.round((parseFloat(p) + parseFloat(q)) * 100) / 100; };
    return add(x[1], y[1]) + '/' + add(x[2], y[2]);
  }
  function multiline(text) { return esc(text).replace(/\n/g, '<br>'); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function friendly(error) {
    var m = (error && error.message) || '';
    if (/Invalid login credentials/i.test(m)) return 'That email and password don\'t match. Check them and try again.';
    if (/Email not confirmed/i.test(m)) return 'Your account isn\'t ready yet. Ask your tutor to confirm it.';
    if (/rate limit/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Couldn\'t reach the server. Check your internet connection and try again.';
    if (/Payload too large|exceeded the maximum/i.test(m)) return 'That file is too big. Files can be up to 50 MB.';
    if (/already been marked/i.test(m)) return 'Your tutor has already marked this, so it can\'t be changed. Send them a message instead.';
    return m || 'Something went wrong. Please try again.';
  }
  function check(res) { if (res.error) throw res.error; return res.data; }

  // Views: only one is shown at a time.
  var VIEWS = ['loading', 'setup', 'login', 'forgot', 'password', 'student', 'staff'];
  function show(view) {
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== view; });
    window.scrollTo(0, 0);
  }

  // --- Start up -----------------------------------------------------------------------------------
  var configured = SUPABASE_URL.indexOf('PASTE') !== 0 && SUPABASE_KEY.indexOf('PASTE') !== 0 && window.supabase;
  if (!configured) { show('setup'); return; }

  // A link from an invite or password reset email lands here with this in the address.
  var arrivedFor = new URLSearchParams(location.hash.slice(1)).get('type');
  // A link from a notification email, e.g. /portal?go=homework&hw=...
  var deepLink = (function () {
    var q = new URLSearchParams(location.search);
    if (!q.get('go')) return null;
    history.replaceState(null, '', location.pathname);
    return { tab: q.get('go'), hw: q.get('hw'), student: q.get('s') };
  })();
  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  var me = null;          // the logged-in person's profile
  var staff = false;      // tutors and admins
  var D = null;           // everything loaded for this person
  var tab = 'homework';
  var passwordReturn = null;
  var live = null, poll = null;

  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') { passwordReturn = null; show('password'); }
    if (event === 'SIGNED_OUT') { stopLive(); me = null; D = null; setAccount(null); show('login'); }
  });

  client.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (!session) return show('login');
    if (arrivedFor === 'recovery' || arrivedFor === 'invite') {
      history.replaceState(null, '', location.pathname);
      return loadProfile().then(function () { passwordReturn = null; show('password'); });
    }
    return enter();
  });

  function setAccount(profile) {
    $('account').hidden = !profile;
    $('back-link').hidden = !!profile;
    if (!profile) closeNotifications();
  }

  function loadProfile() {
    return client.auth.getUser().then(function (res) {
      var user = res.data && res.data.user;
      if (!user) throw new Error('Not logged in');
      return client.from('profiles').select('*').eq('id', user.id).single();
    }).then(function (res) {
      me = check(res);
      staff = me.role === 'tutor' || me.role === 'admin';
      setAccount(me);
      return me;
    });
  }

  function enter() {
    show('loading');
    return loadProfile().then(function () {
      $(staff ? 'staff-greeting' : 'student-greeting').textContent = 'Hi, ' + firstName(me.full_name);
      if (staff) setUpStaffForms();
      return load();
    }).then(function () {
      show(staff ? 'staff' : 'student');
      startLive();
      if (deepLink) { var link = deepLink; deepLink = null; goTo(link); }
      else openTab(tab);
    }).catch(function (e) {
      show('login');
      say($('login-form'), friendly(e), 'error');
    });
  }

  // --- Loading everything -------------------------------------------------------------------------
  function load() {
    var q = [
      client.from('homework').select('*').order('created_at', { ascending: false }),
      client.from('submissions').select('*'),
      client.from('homework_answers').select('*'),
      client.from('resources').select('*').order('created_at', { ascending: false }),
      client.from('messages').select('*').order('created_at', { ascending: true }),
      client.from('thread_reads').select('*'),
      client.from('notifications').select('*').order('created_at', { ascending: false }).limit(60),
      client.from('notification_prefs').select('*').eq('user_id', me.id),
    ];
    if (staff) q.push(
      client.from('profiles').select('*').order('full_name', { ascending: true }),
      client.from('homework_students').select('*'),
      client.from('tutor_notes').select('*')
    );
    else q.push(client.rpc('staff_names'));
    return Promise.all(q).then(function (r) {
      var answers = {};
      check(r[2]).forEach(function (a) { answers[a.homework_id] = a; });
      D = {
        homework: check(r[0]), submissions: check(r[1]), answers: answers, resources: check(r[3]),
        messages: check(r[4]), reads: check(r[5]), notifications: check(r[6]), prefs: check(r[7])[0] || null,
      };
      if (staff) {
        D.profiles = check(r[8]);
        D.assigned = check(r[9]);
        D.notes = check(r[10]);
      } else {
        D.staffNames = check(r[8]) || [];
      }
    });
  }

  // Messages and notifications only, for live updates
  function loadLive() {
    return Promise.all([
      client.from('messages').select('*').order('created_at', { ascending: true }),
      client.from('thread_reads').select('*'),
      client.from('notifications').select('*').order('created_at', { ascending: false }).limit(60),
    ]).then(function (r) {
      D.messages = check(r[0]); D.reads = check(r[1]); D.notifications = check(r[2]);
    });
  }

  // After a change: reload, then redraw the open tab, keeping open sections and half-typed text.
  function refresh() {
    return load().then(function () { renderTab(tab, true); renderBadges(); });
  }

  // --- Names ----------------------------------------------------------------------------------------
  function profileOf(id) { return staff ? by(D.profiles, 'id', id)[0] : (id === me.id ? me : null); }
  function nameOf(id) {
    if (id === me.id) return 'You';
    if (staff) { var p = profileOf(id); return p ? (p.full_name || p.email) : 'Someone'; }
    var t = by(D.staffNames, 'id', id)[0];
    return t ? t.full_name : 'Your tutor';
  }
  function students() { return D.profiles.filter(function (p) { return p.role === 'student'; }); }
  function staffList() { return D.profiles.filter(function (p) { return p.role !== 'student'; }); }
  function homeworkById(id) { return by(D.homework, 'id', id)[0]; }
  function submissionFor(hwId, studentId) {
    return D.submissions.filter(function (s) { return s.homework_id === hwId && s.student_id === studentId; })[0];
  }

  // --- Keeping state when a section is redrawn ----------------------------------------------------
  // Anything with data-keep keeps its open/closed state or typed text, and focus stays where it was.
  function keepState(root, draw) {
    var saved = {}, focusKey = null, sel = null;
    root.querySelectorAll('[data-keep]').forEach(function (el) {
      var k = el.dataset.keep;
      if (el.tagName === 'DETAILS') saved[k] = { open: el.open };
      else if (el.type !== 'file' && 'value' in el) saved[k] = { value: el.value };
      if (el === document.activeElement) {
        focusKey = k;
        try { sel = [el.selectionStart, el.selectionEnd]; } catch (e) { sel = null; }
      }
    });
    draw();
    root.querySelectorAll('[data-keep]').forEach(function (el) {
      var s = saved[el.dataset.keep];
      if (!s) return;
      if ('open' in s) el.open = s.open; else if (s.value != null && s.value !== '') el.value = s.value;
    });
    if (focusKey) {
      var f = root.querySelector('[data-keep="' + focusKey + '"]');
      if (f) { f.focus(); if (sel && sel[0] != null) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text box */ } }
    }
  }

  // --- Tabs ---------------------------------------------------------------------------------------
  function panelOf(name) { return $((staff ? 't-' : 's-') + name); }
  function openTab(name, opts) {
    var nav = $(staff ? 'staff-tabs' : 'student-tabs');
    if (!nav.querySelector('[data-tab="' + name + '"]')) name = 'homework';
    tab = name;
    nav.querySelectorAll('button[data-tab]').forEach(function (b) {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    nav.querySelectorAll('button[data-tab]').forEach(function (b) {
      var other = b.dataset.tab, panel = panelOf(other);
      panel.hidden = other !== name;
      // Empty the hidden tabs, so the same form is never on the page twice
      if (other !== name) {
        var dynamic = staff && { homework: 'staff-homework', students: 'staff-students', resources: 'staff-resources' }[other];
        if (dynamic) $(dynamic).innerHTML = ''; else if (!staff || other !== 'homework') panel.innerHTML = '';
      }
    });
    renderTab(name, false, opts);
    renderBadges();
  }
  ['student-tabs', 'staff-tabs'].forEach(function (id) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (b) openTab(b.dataset.tab);
    });
  });

  function renderTab(name, keep, opts) {
    var root = panelOf(name);
    if (!root || !D) return;
    var draw = function () { (staff ? StaffViews : StudentViews)[name](root, opts || {}); };
    if (keep) keepState(root, draw); else draw();
    renderSummary();
  }

  // Go to whatever a notification or email link is about
  function goTo(t) {
    if (t.tab === 'messages') {
      if (staff) Threads.open = t.student || Threads.open;
      openTab('messages');
      return;
    }
    if (t.tab === 'marking' && staff) { openTab('marking'); return; }
    if (t.tab === 'settings') { openTab('settings'); return; }
    if (t.hw) {
      if (!staff) {
        var s = submissionFor(t.hw, me.id);
        HwFilter.current = !s ? 'todo' : s.marked_at ? 'marked' : 'handed';
      }
      openTab('homework');
      var el = document.getElementById('hw-' + t.hw);
      if (el) {
        if (el.tagName === 'DETAILS') el.open = true;
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        el.classList.add('is-flash');
        setTimeout(function () { el.classList.remove('is-flash'); }, 1600);
      }
      return;
    }
    openTab(t.tab || 'homework');
  }

  // --- Badges and the summary line -----------------------------------------------------------------
  function unreadIn(studentId, hwId) {
    var read = D.reads.filter(function (r) { return r.student_id === studentId; })[0];
    var since = read ? read.last_read_at : '1970-01-01';
    return D.messages.filter(function (m) {
      return m.student_id === studentId && m.sender_id !== me.id && m.created_at > since && (hwId === undefined || m.homework_id === hwId);
    }).length;
  }
  function unreadMessages() {
    if (!staff) return unreadIn(me.id);
    return students().reduce(function (n, p) { return n + unreadIn(p.id); }, 0);
  }
  function toMark() {
    return D.submissions.filter(function (s) { return !s.marked_at && homeworkById(s.homework_id); });
  }
  function setBadge(name, n) {
    document.querySelectorAll('[data-badge="' + name + '"]').forEach(function (b) {
      b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
    });
  }
  function renderBadges() {
    if (!D) return;
    var unreadNotes = D.notifications.filter(function (n) { return !n.read_at; }).length;
    var bell = $('bell-count');
    bell.hidden = !unreadNotes; bell.textContent = unreadNotes > 99 ? '99+' : unreadNotes;
    $('bell').setAttribute('aria-label', unreadNotes ? 'Notifications, ' + unreadNotes + ' unread' : 'Notifications');
    setBadge('messages', unreadMessages());
    if (staff) setBadge('marking', toMark().length);
    else setBadge('homework', StudentViews.counts().todo);
  }
  function renderSummary() {
    if (staff) {
      var waiting = toMark().length, unread = unreadMessages();
      $('staff-summary').textContent = (waiting ? plural(waiting, 'piece') + ' of work to mark' : 'Nothing waiting to be marked') +
        (unread ? ', ' + plural(unread, 'unread message') : '') + '.';
    } else {
      var c = StudentViews.counts();
      $('student-summary').textContent = c.todo
        ? plural(c.todo, 'piece') + ' of homework to do' + (c.missing ? ', ' + c.missing + ' missing' : '') + (c.dueSoon ? ', ' + c.dueSoon + ' due in the next 3 days' : '') + '.'
        : 'You\'re all caught up.';
    }
  }

  // --- Notifications (the bell) -----------------------------------------------------------------------
  function renderNotifications() {
    var list = D ? D.notifications : [];
    $('notif-list').innerHTML = list.length ? list.map(function (n) {
      return '<button type="button" class="notif' + (n.read_at ? '' : ' is-unread') + '" data-id="' + esc(n.id) + '">' +
        '<span class="notif-dot" aria-hidden="true"></span><span class="notif-text">' +
        '<strong>' + esc(n.title) + '</strong>' + (n.body ? '<span>' + esc(n.body) + '</span>' : '') +
        '<time datetime="' + esc(n.created_at) + '">' + esc(formatWhen(n.created_at)) + '</time></span></button>';
    }).join('') : '<p class="empty">Nothing yet. You\'ll see new homework, marks and messages here.</p>';
    $('notif-read-all').hidden = !list.some(function (n) { return !n.read_at; });
  }
  function openNotifications() {
    renderNotifications();
    $('notif-panel').hidden = false;
    $('bell').setAttribute('aria-expanded', 'true');
  }
  function closeNotifications() {
    $('notif-panel').hidden = true;
    $('bell').setAttribute('aria-expanded', 'false');
  }
  $('bell').addEventListener('click', function (e) {
    e.stopPropagation();
    if ($('notif-panel').hidden) openNotifications(); else closeNotifications();
  });
  document.addEventListener('click', function (e) {
    if (!$('notif-panel').hidden && !e.target.closest('#notif-panel') && !e.target.closest('#bell')) closeNotifications();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('notif-panel').hidden) { closeNotifications(); $('bell').focus(); } });

  function markRead(ids) {
    var now = new Date().toISOString();
    D.notifications.forEach(function (n) { if (ids.indexOf(n.id) !== -1 && !n.read_at) n.read_at = now; });
    renderBadges();
    if (!$('notif-panel').hidden) renderNotifications();
    if (!ids.length) return Promise.resolve();
    return client.from('notifications').update({ read_at: now }).in('id', ids).then(function () {});
  }
  $('notif-read-all').addEventListener('click', function () {
    markRead(D.notifications.filter(function (n) { return !n.read_at; }).map(function (n) { return n.id; }));
  });
  $('notif-list').addEventListener('click', function (e) {
    var b = e.target.closest('.notif');
    if (!b) return;
    var n = by(D.notifications, 'id', b.dataset.id)[0];
    if (!n) return;
    markRead([n.id]);
    closeNotifications();
    if (n.kind === 'message') goTo({ tab: 'messages', student: n.student_id });
    else if (n.kind === 'handed_in') goTo({ tab: 'marking' });
    else goTo({ tab: 'homework', hw: n.homework_id });
  });

  // --- Live updates ---------------------------------------------------------------------------------
  // New messages and notifications arrive straight away where Supabase Realtime is available,
  // and every minute otherwise.
  var liveTimer = null;
  function liveSoon() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      if (!D) return;
      loadLive().then(function () {
        renderBadges();
        if (!$('notif-panel').hidden) renderNotifications();
        Threads.refreshAll();
        if (staff) StaffViews.refreshInbox();
        if (staff && Threads.open && tab === 'messages' && unreadIn(Threads.open)) Threads.markRead(Threads.open);
        if (!staff && tab === 'messages' && unreadIn(me.id)) Threads.markRead(me.id);
        renderSummary();
      }).catch(function () {});
    }, 400);
  }
  function startLive() {
    stopLive();
    try {
      live = client.channel('pmt-' + me.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + me.id }, liveSoon)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, liveSoon)
        .subscribe();
    } catch (e) { live = null; }
    poll = setInterval(function () { if (!document.hidden) liveSoon(); }, 60000);
    document.addEventListener('visibilitychange', onVisible);
  }
  function onVisible() { if (!document.hidden && D) liveSoon(); }
  function stopLive() {
    if (live) { try { client.removeChannel(live); } catch (e) { /* already gone */ } live = null; }
    clearInterval(poll); poll = null;
    document.removeEventListener('visibilitychange', onVisible);
  }

  // --- Logging in and passwords -------------------------------------------------------------------
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var email = $('login-email').value.trim(), password = $('login-password').value;
    if (!email || !password) return say(form, 'Enter your email and password.', 'error');
    busy(form, true); say(form, 'Logging in…');
    client.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      say(form, '');
      form.reset();
      enter();
    });
  });

  $('forgot-open').addEventListener('click', function () {
    $('forgot-email').value = $('login-email').value;
    say($('forgot-form'), '');
    show('forgot');
  });
  $('forgot-close').addEventListener('click', function () { show('login'); });
  $('forgot-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, email = $('forgot-email').value.trim();
    if (!email) return say(form, 'Enter your email.', 'error');
    busy(form, true); say(form, 'Sending…');
    client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/portal' }).then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      say(form, 'If that email has an account, a reset link is on its way.', 'success');
    });
  });

  function changePassword() {
    passwordReturn = staff ? 'staff' : 'student';
    $('password-form').reset();
    say($('password-form'), '');
    show('password');
  }
  $('password-cancel').addEventListener('click', function () {
    if (passwordReturn) show(passwordReturn); else enter();
  });
  $('password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, a = $('new-password').value, b = $('new-password-again').value;
    if (a.length < 8) return say(form, 'Use at least 8 characters.', 'error');
    if (a !== b) return say(form, 'Those passwords don\'t match.', 'error');
    busy(form, true); say(form, 'Saving…');
    client.auth.updateUser({ password: a }).then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      form.reset();
      say(form, '');
      if (passwordReturn && D) show(passwordReturn); else enter();
    });
  });

  $('log-out').addEventListener('click', function () { client.auth.signOut(); });

  // --- Files --------------------------------------------------------------------------------------
  function download(path, name, button) {
    if (button) button.disabled = true;
    client.storage.from(BUCKET).createSignedUrl(path, 120, { download: name || true }).then(function (res) {
      if (button) button.disabled = false;
      if (res.error) return alertInline(button, friendly(res.error));
      location.href = res.data.signedUrl;
    });
  }
  function alertInline(near, message) {
    var p = document.createElement('p');
    p.className = 'form-status is-error';
    p.textContent = message;
    if (near && near.parentNode) near.parentNode.insertBefore(p, near.nextSibling);
  }
  function upload(path, file) {
    return client.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined }).then(function (res) {
      if (res.error) throw res.error;
      return path;
    });
  }
  function uploadAll(folder, files) {
    return Promise.all(files.map(function (f) {
      return upload(folder + safeFileName(f.name), f).then(function (path) { return { path: path, name: f.name }; });
    }));
  }
  function fileButton(path, name, label) {
    return '<button type="button" class="file-link" data-path="' + esc(path) + '" data-name="' + esc(name) + '" title="' + esc(name) + '"><span>' + esc(label || name) + '</span></button>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.file-link');
    if (b) download(b.dataset.path, b.dataset.name, b);
  });

  // --- Conversations ---------------------------------------------------------------------------------
  // One conversation per student. Comments on a piece of homework are messages with that homework attached,
  // so they show under the homework and in the full conversation.
  var Threads = {
    open: null,   // tutors: the student whose conversation is open
    messagesFor: function (studentId, hwId) {
      return D.messages.filter(function (m) { return m.student_id === studentId && (hwId == null || m.homework_id === hwId); });
    },
    list: function (studentId, hwId) {
      var list = Threads.messagesFor(studentId, hwId);
      if (!list.length) return '<p class="thread-empty">' + (hwId ? 'No comments yet. Ask a question or leave a note about this homework.' : (staff ? 'No messages yet. Say hello.' : 'No messages yet. Ask your tutor anything about your work.')) + '</p>';
      var read = D.reads.filter(function (r) { return r.student_id === studentId; })[0];
      var since = read ? read.last_read_at : '1970-01-01';
      return list.map(function (m) {
        var mine = m.sender_id === me.id;
        var hw = !hwId && m.homework_id ? homeworkById(m.homework_id) : null;
        return '<div class="msg' + (mine ? ' is-mine' : '') + (!mine && m.created_at > since ? ' is-new' : '') + '">' +
          '<p class="msg-meta"><strong>' + esc(nameOf(m.sender_id)) + '</strong> <time datetime="' + esc(m.created_at) + '">' + esc(formatWhen(m.created_at)) + '</time></p>' +
          (hw ? '<button type="button" class="msg-about" data-hw="' + esc(hw.id) + '">About: ' + esc(hw.title) + '</button>' : '') +
          (m.body ? '<p class="msg-body">' + multiline(m.body) + '</p>' : '') +
          ((m.files || []).length ? '<p class="msg-files">' + m.files.map(function (f) { return fileButton(f.path, f.name); }).join('') + '</p>' : '') +
          '</div>';
      }).join('');
    },
    // The whole thing: messages plus a box to write in. hwId fixes the homework; otherwise the writer can pick one.
    html: function (studentId, hwId, opts) {
      opts = opts || {};
      var key = studentId + '-' + (hwId || 'all');
      var hwChoices = '';
      if (!hwId && !opts.noChoice) {
        var mine = staff ? by(D.assigned, 'student_id', studentId).map(function (a) { return homeworkById(a.homework_id); }).filter(Boolean)
          : D.homework.slice();
        mine.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
        if (mine.length) hwChoices = '<select class="msg-hw" aria-label="What is this about?" data-keep="hw-' + key + '"><option value="">General message</option>' +
          mine.slice(0, 30).map(function (h) { return '<option value="' + esc(h.id) + '">About: ' + esc(h.title) + '</option>'; }).join('') + '</select>';
      }
      return '<div class="thread' + (opts.compact ? ' is-compact' : '') + '" data-student="' + esc(studentId) + '" data-hw="' + esc(hwId || '') + '">' +
        '<div class="thread-list" role="log" aria-live="polite">' + Threads.list(studentId, hwId) + '</div>' +
        '<form class="msg-form" novalidate>' +
          '<label class="visually-hidden" for="msg-' + esc(key) + '">' + (hwId ? 'Add a comment' : 'Write a message') + '</label>' +
          '<textarea id="msg-' + esc(key) + '" rows="2" maxlength="5000" data-keep="msg-' + esc(key) + '" placeholder="' + (hwId ? 'Add a comment about this homework' : 'Write a message') + '"></textarea>' +
          '<div class="msg-actions">' + hwChoices +
            '<label class="msg-attach"><input type="file" multiple accept=".pdf,image/*,.doc,.docx,.ppt,.pptx"><span>Attach</span></label>' +
            '<button class="btn btn-small" type="submit">Send</button>' +
          '</div>' +
          '<p class="form-status" role="status" aria-live="polite"></p>' +
        '</form></div>';
    },
    // Redraw just the messages (not the writing boxes) wherever conversations are on screen
    refreshAll: function () {
      document.querySelectorAll('.thread').forEach(function (t) {
        var list = t.querySelector('.thread-list');
        var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        list.innerHTML = Threads.list(t.dataset.student, t.dataset.hw || undefined);
        if (atBottom) list.scrollTop = list.scrollHeight;
      });
      document.querySelectorAll('[data-comment-count]').forEach(function (el) {
        var p = el.dataset.commentCount.split('|');
        var n = Threads.messagesFor(p[0], p[1]).length, u = unreadIn(p[0], p[1]);
        el.textContent = n ? '(' + n + (u ? ', ' + u + ' new' : '') + ')' : '';
      });
    },
    scrollDown: function (root) {
      (root || document).querySelectorAll('.thread-list').forEach(function (l) { l.scrollTop = l.scrollHeight; });
    },
    markRead: function (studentId) {
      var now = new Date().toISOString();
      var existing = D.reads.filter(function (r) { return r.student_id === studentId; })[0];
      if (existing) existing.last_read_at = now; else D.reads.push({ user_id: me.id, student_id: studentId, last_read_at: now });
      var notes = D.notifications.filter(function (n) { return n.kind === 'message' && n.student_id === studentId && !n.read_at; }).map(function (n) { return n.id; });
      markRead(notes);
      renderBadges();
      return client.from('thread_reads').upsert({ user_id: me.id, student_id: studentId, last_read_at: now }, { onConflict: 'user_id,student_id' }).then(function () {});
    },
  };

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList.contains('msg-form')) return;
    e.preventDefault();
    var thread = form.closest('.thread');
    var studentId = thread.dataset.student;
    var hwSelect = form.querySelector('.msg-hw');
    var hwId = thread.dataset.hw || (hwSelect && hwSelect.value) || null;
    var box = form.querySelector('textarea');
    var body = box.value.trim();
    var files = Array.prototype.slice.call(form.querySelector('input[type="file"]').files);
    if (!body && !files.length) return say(form, 'Write a message or attach a file.', 'error');
    busy(form, true); say(form, files.length ? 'Uploading…' : '');
    uploadAll('messages/' + studentId + '/', files).then(function (uploaded) {
      return client.from('messages').insert({ student_id: studentId, homework_id: hwId, body: body, files: uploaded }).select().single();
    }).then(function (res) {
      var m = check(res);
      busy(form, false);
      say(form, '');
      box.value = '';
      form.querySelector('input[type="file"]').value = '';
      form.querySelector('.msg-attach').classList.remove('has-files');
      form.querySelector('.msg-attach span').textContent = 'Attach';
      if (!D.messages.some(function (x) { return x.id === m.id; })) D.messages.push(m);
      Threads.refreshAll();
      Threads.scrollDown(thread);
      Threads.markRead(studentId);
      if (staff) StaffViews.refreshInbox();
    }).catch(function (err) {
      busy(form, false);
      say(form, friendly(err), 'error');
    });
  });
  // Enter sends, Shift+Enter starts a new line (on a keyboard; phones keep the normal return key)
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || !t.closest || !t.closest('.msg-form') || t.tagName !== 'TEXTAREA') return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    // requestSubmit is missing on older iPads (Safari before 16), so fall back to a submit event.
    if (t.form.requestSubmit) t.form.requestSubmit();
    else t.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('.msg-attach input')) {
      var n = e.target.files.length;
      e.target.parentNode.classList.toggle('has-files', n > 0);
      e.target.nextElementSibling.textContent = n ? plural(n, 'file') : 'Attach';
    }
  });
  document.addEventListener('click', function (e) {
    var about = e.target.closest('.msg-about');
    if (about) goTo({ tab: 'homework', hw: about.dataset.hw });
  });
  // Opening the comments on a piece of homework counts as reading them
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d.classList && d.classList.contains('comments') && d.open) {
      Threads.scrollDown(d);
      if (unreadIn(d.dataset.student, d.dataset.hw)) Threads.markRead(d.dataset.student);
    }
  }, true);

  function commentsBlock(studentId, hwId, label) {
    var n = Threads.messagesFor(studentId, hwId).length, u = unreadIn(studentId, hwId);
    return '<details class="comments" data-keep="c-' + esc(studentId + '-' + hwId) + '" data-student="' + esc(studentId) + '" data-hw="' + esc(hwId) + '">' +
      '<summary>' + esc(label || 'Comments') + ' <span class="portal-muted" data-comment-count="' + esc(studentId + '|' + hwId) + '">' + (n ? '(' + n + (u ? ', ' + u + ' new' : '') + ')' : '') + '</span></summary>' +
      Threads.html(studentId, hwId, { compact: true }) + '</details>';
  }

  // --- Email settings (both) ---------------------------------------------------------------------------
  function settingsHtml(options) {
    var p = D.prefs || {};
    var on = function (k) { return p[k] === undefined || p[k] === null ? true : p[k]; };
    return '<div class="portal-grid">' +
      '<form class="window settings-form" id="settings-form" novalidate><div class="window-bar"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="window-title">Emails</span></div>' +
      '<div class="form"><fieldset class="field"><legend>Email me when&hellip;</legend><div class="toggles">' +
      options.map(function (o) {
        return '<label class="toggle"><input type="checkbox" name="' + o[0] + '"' + (on(o[0]) ? ' checked' : '') + '><span><strong>' + esc(o[1]) + '</strong><span class="portal-muted portal-small">' + esc(o[2]) + '</span></span></label>';
      }).join('') + '</div></fieldset>' +
      '<p class="portal-muted portal-small">Emails go to ' + esc(me.email) + '. You\'ll always see everything under the bell at the top of the page.</p>' +
      '<button class="btn btn-small" type="submit">Save</button><p class="form-status" role="status" aria-live="polite"></p></div></form>' +
      '<div class="stack"><div class="portal-note"><h2>Your account</h2><p class="portal-muted">' + esc(me.full_name || '') + ' &middot; ' + esc(me.email) + '</p>' +
      '<p><button type="button" class="btn btn-small btn-ghost" id="settings-password">Change password</button></p></div>' +
      (staff ? '' : studentInfoNote()) + '</div></div>';
  }
  function studentInfoNote() {
    var tutor = me.tutor_id ? nameOf(me.tutor_id) : '';
    return '<div class="portal-note"><h2>Your tutor and updates</h2>' +
      '<p class="portal-muted">' + (tutor ? 'Your tutor is ' + esc(tutor) + '.' : 'Your tutor will be added soon.') + '</p>' +
      (me.parent_updates && me.parent_email ? '<p class="portal-muted">' + esc(me.parent_name || 'Your parent or guardian') + ' (' + esc(me.parent_email) + ') also gets emails about new homework, reminders and marks. Ask your tutor if this needs changing.</p>' : '') +
      '</div>';
  }
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.id !== 'settings-form') return;
    e.preventDefault();
    var row = { user_id: me.id, updated_at: new Date().toISOString() };
    form.querySelectorAll('input[type="checkbox"]').forEach(function (c) { row[c.name] = c.checked; });
    busy(form, true); say(form, 'Saving…');
    client.from('notification_prefs').upsert(row, { onConflict: 'user_id' }).select().single().then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      D.prefs = res.data;
      say(form, 'Saved.', 'success');
    });
  });
  document.addEventListener('click', function (e) { if (e.target.id === 'settings-password') changePassword(); });

  // ====================================================================================================
  // Students
  // ====================================================================================================
  var HwFilter = { current: 'todo', subject: 'all' };

  var StudentViews = {
    statusOf: function (h) {
      var s = submissionFor(h.id, me.id);
      return !s ? 'todo' : s.marked_at ? 'marked' : 'handed';
    },
    counts: function () {
      var c = { todo: 0, handed: 0, marked: 0, missing: 0, dueSoon: 0 };
      if (!D) return c;
      D.homework.forEach(function (h) {
        var st = StudentViews.statusOf(h);
        c[st] += 1;
        if (st === 'todo' && h.due_date) {
          var n = daysUntil(h.due_date);
          if (n < 0) c.missing += 1; else if (n <= 3) c.dueSoon += 1;
        }
      });
      return c;
    },

    homework: function (root) {
      var subjects = (me.subjects || []);
      if (!subjects.length && !D.homework.length) {
        root.innerHTML = '<p class="empty">Your tutor hasn\'t added your subjects yet. Your homework will appear here.</p>';
        return;
      }
      var c = StudentViews.counts();
      var f = HwFilter.current;
      var list = D.homework.filter(function (h) {
        return StudentViews.statusOf(h) === f && (HwFilter.subject === 'all' || h.subject === HwFilter.subject);
      });
      if (f === 'todo') list.sort(function (a, b) { return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')); });
      else if (f === 'handed') list.sort(function (a, b) { return String(submissionFor(b.id, me.id).submitted_at).localeCompare(String(submissionFor(a.id, me.id).submitted_at)); });
      else list.sort(function (a, b) { return String(submissionFor(b.id, me.id).marked_at).localeCompare(String(submissionFor(a.id, me.id).marked_at)); });
      var subjectsUsed = SUBJECTS.filter(function (s) { return D.homework.some(function (h) { return h.subject === s.id; }); });
      var empty = { todo: 'Nothing to do. Nice work.', handed: 'Nothing waiting to be marked.', marked: 'Nothing marked yet.' }[f];
      root.innerHTML = '<div class="toolbar">' +
        '<div class="seg" role="tablist" aria-label="Show">' +
          [['todo', 'To do', c.todo], ['handed', 'Handed in', c.handed], ['marked', 'Marked', c.marked]].map(function (t) {
            return '<button type="button" role="tab" data-filter="' + t[0] + '" aria-selected="' + (t[0] === f) + '">' + t[1] + ' <span class="seg-count">' + t[2] + '</span></button>';
          }).join('') + '</div>' +
        (subjectsUsed.length > 1 ? '<label class="toolbar-select"><span class="visually-hidden">Subject</span><select id="hw-subject-filter"><option value="all">All subjects</option>' +
          subjectsUsed.map(function (s) { return '<option value="' + s.id + '"' + (HwFilter.subject === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' : '') +
        '</div>' +
        '<div class="stack" id="student-homework">' + (list.length ? list.map(StudentViews.card).join('') : '<p class="empty">' + empty + '</p>') + '</div>';
      root.querySelectorAll('[data-filter]').forEach(function (b) {
        b.addEventListener('click', function () { HwFilter.current = b.dataset.filter; renderTab('homework'); });
      });
      var sel = root.querySelector('#hw-subject-filter');
      if (sel) sel.addEventListener('change', function () { HwFilter.subject = sel.value; renderTab('homework'); });
    },

    card: function (h) {
      var s = submissionFor(h.id, me.id);
      var status, chip;
      if (s && s.marked_at) { status = 'marked'; chip = 'Marked'; }
      else if (s) { status = 'handed-in'; chip = (handedInLate(h, s) ? 'Handed in late, ' : 'Handed in ') + formatDate(s.submitted_at); }
      else if (h.due_date) {
        var n = daysUntil(h.due_date);
        status = n < 0 ? 'overdue' : n <= 3 ? 'soon' : 'due';
        chip = n < 0 ? 'Missing: due ' + formatDate(h.due_date) : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : n <= 7 ? 'Due in ' + n + ' days' : 'Due ' + formatDate(h.due_date);
      } else { status = 'due'; chip = 'No due date'; }

      var html = '<article class="hw-card is-' + status + '" id="hw-' + esc(h.id) + '" data-id="' + esc(h.id) + '">' +
        '<header><div><h3>' + esc(h.title) + '</h3><p class="portal-muted portal-small">' + esc(subjectName(h.subject)) +
        (h.due_date ? ' &middot; due ' + esc(formatDate(h.due_date)) : '') + '</p></div><span class="chip-status">' + esc(chip) + '</span></header>';
      if (h.instructions) html += '<p class="hw-instructions">' + esc(h.instructions) + '</p>';
      if (h.attachment_path) html += '<p>' + fileButton(h.attachment_path, h.attachment_name, 'Download ' + (h.attachment_name || 'worksheet')) + '</p>';
      var selfMarking = !!h.self_mark_questions;
      if (selfMarking) html += StudentViews.selfMarkBox(h, s);
      if (s && s.marked_at) {
        var rows = selfMarking
          ? '<div class="hw-scores">' +
              (s.self_mark ? '<p><span>Your marking</span><strong>' + esc(s.self_mark) + '</strong></p>' : '') +
              (s.mark ? '<p><span>Tutor\'s marking</span><strong>' + esc(s.mark) + '</strong></p>' : '') +
              (totalMark(s.self_mark, s.mark) ? '<p class="hw-total"><span>Total</span><strong>' + esc(totalMark(s.self_mark, s.mark)) + '</strong></p>' : '') +
            '</div>'
          : '<p class="hw-mark">' + esc(s.mark || 'Marked') + '</p>';
        html += '<div class="hw-feedback">' + rows + (s.feedback ? '<p>' + multiline(s.feedback) + '</p>' : '') + '</div>';
      }
      if (s) {
        var canRemove = !s.marked_at && (s.files || []).length > 1;
        html += '<div class="hw-files"><p class="portal-small portal-muted">Your hand-in</p>' +
          (s.files || []).map(function (f) {
            return '<span class="file-row">' + fileButton(f.path, f.name) +
              (canRemove ? '<button type="button" class="text-button file-remove" data-path="' + esc(f.path) + '">Remove</button>' : '') + '</span>';
          }).join('') +
          (s.self_mark && !s.marked_at ? '<p class="portal-small">Your self-mark: <strong>' + esc(s.self_mark) + '</strong></p>' : '') +
          (s.note ? '<p class="portal-small">' + esc(s.note) + '</p>' : '') + '</div>';
      }
      if (!s || !s.marked_at) {
        var id = esc(h.id);
        html += '<form class="form hw-upload" novalidate>' +
          '<div class="field"><label for="up-' + id + '">' + (s ? 'Add more files' : 'Hand in your work') + ' <span class="optional">' + (s ? 'Optional, ' : '') + 'PDF or photos</span></label>' +
          '<input id="up-' + id + '" type="file" accept=".pdf,image/*" multiple' + (s ? '' : ' required') + '></div>' +
          (selfMarking && (h.answers_when !== 'after' || s)
            ? '<div class="field"><label for="self-' + id + '">Your score for ' + esc(h.self_mark_questions) + ' <span class="optional">e.g. 7/10</span></label>' +
              '<input id="self-' + id + '" class="self-mark-input" data-keep="self-' + id + '" value="' + esc((s && s.self_mark) || '') + '" inputmode="text" autocomplete="off"></div>'
            : '') +
          '<div class="field"><label for="note-' + id + '">Note for your tutor <span class="optional">Optional</span></label>' +
          '<textarea id="note-' + id + '" rows="2" data-keep="note-' + id + '">' + esc((s && s.note) || '') + '</textarea></div>' +
          '<button class="btn btn-small" type="submit">' + (s ? 'Save changes' : 'Hand in') + '</button>' +
          '<p class="form-status" role="status" aria-live="polite"></p></form>';
      }
      html += commentsBlock(me.id, h.id, 'Comments with your tutor');
      return html + '</article>';
    },

    // Which questions to mark yourself, and the answers once the tutor allows them.
    selfMarkBox: function (h, s) {
      var a = D.answers[h.id];
      var html = '<div class="self-mark-box"><p><strong>Mark ' + esc(h.self_mark_questions) + ' yourself</strong>, in a different colour pen, then add your score when you hand in. Your tutor marks the rest.</p>';
      if (a && (a.answers || a.file_path)) {
        html += (a.answers ? '<div class="self-mark-answers"><p class="portal-small portal-muted">Answers</p><p>' + multiline(a.answers) + '</p></div>' : '') +
          (a.file_path ? '<p>' + fileButton(a.file_path, a.file_name, 'Answers: ' + (a.file_name || 'download')) + '</p>' : '');
      } else if (h.answers_when === 'after' && !s) {
        html += '<p class="portal-small portal-muted">The answers appear here once you\'ve handed in.</p>';
      } else if (!a) {
        html += '<p class="portal-small portal-muted">The answers are on the last page of the sheet.</p>';
      }
      return html + '</div>';
    },

    messages: function (root) {
      var tutor = me.tutor_id ? nameOf(me.tutor_id) : '';
      root.innerHTML = '<div class="convo window"><div class="window-bar"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="window-title">' +
        (tutor ? 'Messages with ' + esc(tutor) : 'Messages with your tutor') + '</span></div>' +
        Threads.html(me.id, null) + '</div>' +
        '<p class="portal-muted portal-small">Ask questions about your work, send a photo of something you\'re stuck on, or tell your tutor about a test coming up. Your tutor gets an email when you send a message.</p>';
      Threads.scrollDown(root);
      Threads.markRead(me.id);
    },

    resources: function (root) {
      var res = D.resources.slice();
      root.innerHTML = '<div class="stack">' + (res.length ? res.map(function (r) {
        return '<article class="res-card"><div><h3>' + esc(r.title) + '</h3>' +
          (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
          '<p class="portal-muted portal-small">' + esc(subjectName(r.subject)) + ' &middot; ' + esc(formatDate(r.created_at, true)) + '</p></div>' +
          (r.file_path ? fileButton(r.file_path, r.file_name, 'Download') : '') + '</article>';
      }).join('') : '<p class="empty">Nothing shared yet. Slides and notes from your lessons will appear here.</p>') + '</div>';
    },

    settings: function (root) {
      root.innerHTML = settingsHtml([
        ['email_new_homework', 'New homework is set', 'With the due date and anything to mark yourself'],
        ['email_reminders', 'A due date is getting close', '7 days, 3 days and 1 day before, and the day after if it\'s missing'],
        ['email_marked', 'My work is marked', 'With your mark'],
        ['email_messages', 'My tutor sends me a message', 'Including comments on your homework'],
      ]);
    },
  };

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList.contains('hw-upload') || staff) return;
    e.preventDefault();
    var hwId = form.closest('.hw-card').dataset.id;
    var files = Array.prototype.slice.call(form.querySelector('input[type="file"]').files);
    var note = form.querySelector('textarea').value.trim();
    var selfInput = form.querySelector('.self-mark-input');
    var existing = submissionFor(hwId, me.id);
    if (!files.length && !existing) return say(form, 'Choose at least one file.', 'error');
    busy(form, true); say(form, files.length ? 'Uploading ' + plural(files.length, 'file') + '…' : 'Saving…');
    uploadAll('submissions/' + me.id + '/' + hwId + '/', files).then(function (uploaded) {
      // New files are added to what's already handed in, so photos of the marking can go up afterwards.
      var change = { files: (existing ? existing.files || [] : []).concat(uploaded), note: note };
      if (selfInput) change.self_mark = selfInput.value.trim() || null;
      return existing
        ? client.from('submissions').update(change).eq('id', existing.id).select().single()
        : client.from('submissions').insert(Object.assign({ homework_id: hwId }, change)).select().single();
    }).then(function (res) {
      check(res);
      form.reset();
      if (!existing) HwFilter.current = 'handed';
      return refresh();
    }).then(function () {
      var card = $('hw-' + hwId);
      if (card) { card.scrollIntoView({ block: 'start' }); say(card.querySelector('.hw-upload') || card, existing ? 'Saved.' : '', 'success'); }
    }).catch(function (err) {
      busy(form, false);
      say(form, friendly(err), 'error');
    });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.file-remove');
    if (!b || staff) return;
    var hwId = b.closest('.hw-card').dataset.id;
    var s = submissionFor(hwId, me.id), path = b.dataset.path;
    b.disabled = true;
    client.from('submissions').update({ files: s.files.filter(function (f) { return f.path !== path; }) }).eq('id', s.id).select().single().then(function (res) {
      if (res.error) { b.disabled = false; return alertInline(b, friendly(res.error)); }
      client.storage.from(BUCKET).remove([path]);
      refresh();
    });
  });

  // ====================================================================================================
  // Tutors and admins
  // ====================================================================================================
  function setUpStaffForms() {
    var subjectOptions = SUBJECTS.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
    $('hw-subject').innerHTML = subjectOptions;
    $('res-subject').innerHTML = '<option value="all">All subjects</option>' + subjectOptions;
  }

  function markForm(h, s) {
    var sid = esc(s.id), total = totalMark(s.self_mark, s.mark);
    return '<form class="form mark-form" data-id="' + sid + '" novalidate>' +
      (h.self_mark_questions
        ? '<div class="field-row"><div class="field"><label for="selfmark-' + sid + '">Their self-mark <span class="optional">Check it, ' + esc(h.self_mark_questions) + '</span></label>' +
          '<input id="selfmark-' + sid + '" data-keep="selfmark-' + sid + '" value="' + esc(s.self_mark || '') + '" placeholder="Not given"></div>' +
          '<div class="field"><label for="mark-' + sid + '">Your mark <span class="optional">The rest</span></label>' +
          '<input id="mark-' + sid + '" data-keep="mark-' + sid + '" value="' + esc(s.mark || '') + '" placeholder="e.g. 9/10"></div></div>' +
          (total ? '<p class="portal-small">Total so far: <strong>' + esc(total) + '</strong></p>' : '')
        : '<div class="field-row"><div class="field"><label for="mark-' + sid + '">Mark</label>' +
          '<input id="mark-' + sid + '" data-keep="mark-' + sid + '" value="' + esc(s.mark || '') + '" placeholder="e.g. 18/20"></div></div>') +
      '<div class="field"><label for="fb-' + sid + '">Feedback</label>' +
      '<textarea id="fb-' + sid + '" data-keep="fb-' + sid + '" rows="3">' + esc(s.feedback || '') + '</textarea></div>' +
      '<button class="btn btn-small" type="submit">' + (s.marked_at ? 'Update mark' : 'Save mark and return') + '</button>' +
      '<p class="form-status" role="status" aria-live="polite"></p></form>';
  }

  function handInBlock(h, s) {
    return '<div class="hw-files">' + (s.files || []).map(function (f) { return fileButton(f.path, f.name); }).join('') +
      (s.self_mark ? '<p class="portal-small">Self-mark: <strong>' + esc(s.self_mark) + '</strong></p>' : '') +
      (s.note ? '<p class="portal-small">&ldquo;' + esc(s.note) + '&rdquo;</p>' : '') + '</div>';
  }

  function stateChip(h, s) {
    if (!s) {
      var n = h.due_date ? daysUntil(h.due_date) : 1;
      return n < 0 ? '<span class="chip-status is-overdue">Missing</span>' : '<span class="chip-status is-due">Not handed in</span>';
    }
    if (s.marked_at) return '<span class="chip-status is-marked">Marked</span>';
    return '<span class="chip-status is-handed-in">' + (handedInLate(h, s) ? 'Handed in late ' : 'Handed in ') + esc(formatDate(s.submitted_at)) + '</span>';
  }

  var StaffViews = {
    homework: function () {
      StaffViews.homeworkForm();
      var list = $('staff-homework');
      list.innerHTML = D.homework.length ? D.homework.map(function (h) {
        var who = by(D.assigned, 'homework_id', h.id);
        var subs = by(D.submissions, 'homework_id', h.id);
        var marked = subs.filter(function (s) { return s.marked_at; }).length;
        var ans = D.answers[h.id];
        var rows = who.map(function (a) {
          var s = submissionFor(h.id, a.student_id);
          return '<div class="mark-row"><div class="mark-row-head"><strong>' + esc(nameOf(a.student_id)) + '</strong>' + stateChip(h, s) + '</div>' +
            (s ? handInBlock(h, s) + markForm(h, s) : '') + commentsBlock(a.student_id, h.id) + '</div>';
        }).join('');
        return '<details class="hw-card staff-hw" id="hw-' + esc(h.id) + '" data-id="' + esc(h.id) + '" data-keep="hw-' + esc(h.id) + '"><summary>' +
          '<span><strong>' + esc(h.title) + '</strong><span class="portal-small portal-muted"> ' + esc(subjectName(h.subject)) +
          (h.due_date ? ' &middot; due ' + esc(formatDate(h.due_date)) : '') + '</span></span>' +
          '<span class="portal-small">' + subs.length + ' of ' + who.length + ' handed in' + (marked ? ', ' + marked + ' marked' : '') + '</span></summary>' +
          (h.instructions ? '<p class="hw-instructions">' + esc(h.instructions) + '</p>' : '') +
          (h.attachment_path ? '<p>' + fileButton(h.attachment_path, h.attachment_name, 'Worksheet: ' + (h.attachment_name || 'download')) + '</p>' : '') +
          (h.self_mark_questions
            ? '<div class="self-mark-box"><p><strong>Students mark ' + esc(h.self_mark_questions) + ' themselves.</strong> ' +
                (ans && (ans.answers || ans.file_path) ? (h.answers_when === 'after' ? 'Answers show once they hand in.' : 'Answers show straight away.') : 'Answers are on the sheet.') + '</p>' +
                (ans && ans.answers ? '<div class="self-mark-answers"><p>' + multiline(ans.answers) + '</p></div>' : '') +
                (ans && ans.file_path ? '<p>' + fileButton(ans.file_path, ans.file_name, 'Answers: ' + (ans.file_name || 'download')) + '</p>' : '') +
              '</div>'
            : '') +
          '<form class="due-form" data-id="' + esc(h.id) + '" novalidate><label for="due-' + esc(h.id) + '">Due date</label>' +
            '<input type="date" id="due-' + esc(h.id) + '" value="' + esc(h.due_date || '') + '"><button type="submit" class="btn btn-small btn-ghost">Change</button><span class="form-status" role="status"></span></form>' +
          (rows || '<p class="empty">Not set for anyone.</p>') +
          '<div class="danger-zone"><button type="button" class="text-button hw-delete">Delete this homework</button></div>' +
          '</details>';
      }).join('') : '<p class="empty">You haven\'t set any homework yet.</p>';
    },

    homeworkForm: function () {
      var subject = $('hw-subject').value;
      var chosen = {};
      $('hw-students').querySelectorAll('input').forEach(function (i) { chosen[i.value] = i.checked; });
      var list = students().filter(function (p) { return (p.subjects || []).indexOf(subject) !== -1; });
      $('hw-students').innerHTML = list.map(function (p) {
        var on = chosen[p.id] === undefined ? true : chosen[p.id];
        return '<label class="chip"><input type="checkbox" value="' + esc(p.id) + '"' + (on ? ' checked' : '') + '><span>' + esc(p.full_name || p.email) + '</span></label>';
      }).join('');
      $('hw-students-empty').hidden = list.length > 0;
    },

    // Everything handed in and waiting, oldest first, like a marking pile
    marking: function (root) {
      var waiting = toMark().sort(function (a, b) { return String(a.submitted_at).localeCompare(String(b.submitted_at)); });
      var recent = D.submissions.filter(function (s) { return s.marked_at && homeworkById(s.homework_id); })
        .sort(function (a, b) { return String(b.marked_at).localeCompare(String(a.marked_at)); }).slice(0, 10);
      var card = function (s) {
        var h = homeworkById(s.homework_id);
        return '<article class="hw-card mark-card" id="sub-' + esc(s.id) + '">' +
          '<header><div><h3>' + esc(nameOf(s.student_id)) + ': ' + esc(h.title) + '</h3><p class="portal-muted portal-small">' + esc(subjectName(h.subject)) +
          (h.due_date ? ' &middot; due ' + esc(formatDate(h.due_date)) : '') + '</p></div>' + stateChip(h, s) + '</header>' +
          handInBlock(h, s) + markForm(h, s) + commentsBlock(s.student_id, h.id) + '</article>';
      };
      root.innerHTML = '<div class="stack">' +
        (waiting.length ? waiting.map(card).join('') : '<p class="empty">Nothing to mark. When a student hands in, it appears here and you get an email.</p>') +
        '</div>' +
        (recent.length ? '<details class="recent" data-keep="recent-marked"><summary><h2 class="portal-section-title">Recently marked</h2></summary><div class="stack">' + recent.map(card).join('') + '</div></details>' : '');
    },

    // Conversations down the side, the open one on the right
    inboxRows: function () {
      return students().map(function (p) {
        var msgs = Threads.messagesFor(p.id);
        return { p: p, last: msgs[msgs.length - 1], unread: unreadIn(p.id) };
      }).sort(function (a, b) {
        return String(b.last ? b.last.created_at : '').localeCompare(String(a.last ? a.last.created_at : '')) || String(a.p.full_name).localeCompare(String(b.p.full_name));
      });
    },
    inboxList: function (rows, open) {
      return rows.map(function (x) {
        return '<button type="button" class="inbox-item' + (x.p.id === open ? ' is-current' : '') + (x.unread ? ' is-unread' : '') + '" data-student="' + esc(x.p.id) + '">' +
          '<span class="inbox-name">' + esc(x.p.full_name || x.p.email) + (x.unread ? ' <span class="badge">' + x.unread + '</span>' : '') + '</span>' +
          '<span class="inbox-preview">' + (x.last ? esc((x.last.sender_id === me.id ? 'You: ' : '') + (x.last.body || 'Sent a file').slice(0, 70)) : 'No messages yet') + '</span>' +
          (x.last ? '<time>' + esc(formatWhen(x.last.created_at)) + '</time>' : '') + '</button>';
      }).join('');
    },
    // Live updates only redraw the list, so a half-written message (and any attached files) is left alone
    refreshInbox: function () {
      var nav = document.querySelector('#t-messages .inbox-list');
      if (nav) nav.innerHTML = StaffViews.inboxList(StaffViews.inboxRows(), Threads.open);
    },
    messages: function (root) {
      var rows = StaffViews.inboxRows();
      if (!rows.length) { root.innerHTML = '<p class="empty">No students yet.</p>'; return; }
      var open = Threads.open && rows.some(function (x) { return x.p.id === Threads.open; }) ? Threads.open : null;
      root.innerHTML = '<div class="inbox' + (open ? ' is-open' : '') + '">' +
        '<nav class="inbox-list" aria-label="Conversations">' + StaffViews.inboxList(rows, open) + '</nav>' +
        '<section class="inbox-thread">' + (open
          ? '<div class="inbox-thread-head"><button type="button" class="text-button inbox-back">All conversations</button><h2>' + esc(nameOf(open)) + '</h2></div>' + Threads.html(open, null)
          : '<p class="empty">Choose a student to see your messages with them.</p>') + '</section></div>';
      if (open) { Threads.scrollDown(root); if (unreadIn(open)) Threads.markRead(open); }
    },

    students: function () {
      var list = D.profiles.filter(function (p) { return p.id !== me.id; });
      var tutors = staffList();
      $('staff-students').innerHTML = list.length ? list.map(function (p) {
        var id = esc(p.id);
        var subjects = SUBJECTS.map(function (s) {
          return '<label class="chip"><input type="checkbox" value="' + s.id + '"' + ((p.subjects || []).indexOf(s.id) !== -1 ? ' checked' : '') + '><span>' + esc(s.name) + '</span></label>';
        }).join('');
        var role = me.role === 'admin'
          ? '<div class="field"><label for="role-' + id + '">Role</label><select id="role-' + id + '" class="role-select">' +
            ['student', 'tutor', 'admin'].map(function (r) { return '<option value="' + r + '"' + (p.role === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>'; }).join('') +
            '</select></div>'
          : '';
        var isStudent = p.role === 'student';
        var assigned = by(D.assigned, 'student_id', p.id).map(function (a) { return homeworkById(a.homework_id); }).filter(Boolean);
        var missing = assigned.filter(function (h) { return !submissionFor(h.id, p.id) && h.due_date && daysUntil(h.due_date) < 0; }).length;
        var todo = assigned.filter(function (h) { return !submissionFor(h.id, p.id); }).length;
        var waiting = D.submissions.filter(function (s) { return s.student_id === p.id && !s.marked_at; }).length;
        var note = by(D.notes, 'student_id', p.id)[0];
        return '<form class="window student-form" data-id="' + id + '" novalidate><div class="form">' +
          '<div class="student-form-head"><h3>' + esc(p.full_name || p.email) + '</h3>' +
            (isStudent ? '<p class="portal-muted portal-small">' + plural(todo, 'piece') + ' to do' + (missing ? ', ' + missing + ' missing' : '') + ', ' + waiting + ' to mark &middot; ' +
              '<button type="button" class="text-button student-message" data-student="' + id + '">Message</button></p>' : '<p class="portal-muted portal-small">' + esc(p.role) + '</p>') + '</div>' +
          '<div class="field-row"><div class="field"><label for="name-' + id + '">Name</label>' +
          '<input id="name-' + id + '" class="name-input" data-keep="name-' + id + '" value="' + esc(p.full_name) + '" placeholder="Full name"></div>' +
          '<div class="field"><label>Email</label><p class="portal-static">' + esc(p.email) + '</p></div></div>' +
          (isStudent
            ? '<fieldset class="field"><legend>Subjects</legend><div class="chips">' + subjects + '</div></fieldset>' +
              '<div class="field"><label for="tutor-' + id + '">Tutor</label><select id="tutor-' + id + '" class="tutor-select"><option value="">Not assigned yet</option>' +
                tutors.map(function (t) { return '<option value="' + esc(t.id) + '"' + (p.tutor_id === t.id ? ' selected' : '') + '>' + esc(t.full_name || t.email) + '</option>'; }).join('') + '</select></div>' +
              '<div class="field-row"><div class="field"><label for="pname-' + id + '">Parent or guardian <span class="optional">Optional</span></label>' +
                '<input id="pname-' + id + '" class="parent-name" data-keep="pname-' + id + '" value="' + esc(p.parent_name || '') + '" placeholder="Name"></div>' +
              '<div class="field"><label for="pemail-' + id + '">Their email</label>' +
                '<input id="pemail-' + id + '" type="email" class="parent-email" data-keep="pemail-' + id + '" value="' + esc(p.parent_email || '') + '" placeholder="parent@example.com"></div></div>' +
              '<label class="toggle"><input type="checkbox" class="parent-updates"' + (p.parent_updates ? ' checked' : '') + '><span><strong>Email them updates</strong><span class="portal-muted portal-small">New homework, reminders and marks. Never messages.</span></span></label>' +
              '<div class="field"><label for="notes-' + id + '">Tutor notes <span class="optional">Only tutors see these</span></label>' +
                '<textarea id="notes-' + id + '" class="tutor-notes" data-keep="notes-' + id + '" rows="3" placeholder="e.g. Exam board, target grade, what they find hard">' + esc(note ? note.notes : '') + '</textarea>' +
                (note ? '<p class="portal-muted portal-small">Last changed ' + esc(formatWhen(note.updated_at)) + (note.updated_by ? ' by ' + esc(nameOf(note.updated_by)) : '') + '</p>' : '') + '</div>'
            : '') +
          role +
          '<button class="btn btn-small" type="submit">Save</button><p class="form-status" role="status" aria-live="polite"></p></div></form>';
      }).join('') : '<p class="empty">No students yet. Follow the steps above to add your first one.</p>';
    },

    resources: function () {
      $('res-student').innerHTML = '<option value="">Everyone taking the subject</option>' + students().map(function (p) {
        return '<option value="' + esc(p.id) + '">Only ' + esc(p.full_name || p.email) + '</option>';
      }).join('');
      $('staff-resources').innerHTML = D.resources.length ? D.resources.map(function (r) {
        return '<article class="res-card" data-id="' + esc(r.id) + '"><div><h3>' + esc(r.title) + '</h3>' +
          (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
          '<p class="portal-muted portal-small">' + esc(subjectName(r.subject)) + (r.student_id ? ' &middot; only ' + esc(nameOf(r.student_id)) : '') +
          ' &middot; ' + esc(formatDate(r.created_at, true)) + '</p></div>' +
          '<div class="res-actions">' + (r.file_path ? fileButton(r.file_path, r.file_name, 'Download') : '') +
          '<button type="button" class="text-button res-delete">Remove</button></div></article>';
      }).join('') : '<p class="empty">Nothing shared yet.</p>';
    },

    settings: function (root) {
      root.innerHTML = settingsHtml([
        ['email_handed_in', 'A student hands in work', 'So you know there\'s something to mark'],
        ['email_messages', 'A student sends a message', 'Including comments on homework'],
        ['email_reminders', 'Work is missing', 'The day after a due date, if a student hasn\'t handed in'],
      ]);
    },
  };

  $('hw-subject').addEventListener('change', function () { $('hw-students').innerHTML = ''; StaffViews.homeworkForm(); });
  $('hw-self').addEventListener('input', function () { $('hw-self-more').hidden = !$('hw-self').value.trim(); });

  $('hw-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var title = $('hw-title-input').value.trim(), due = $('hw-due').value, subject = $('hw-subject').value;
    var file = $('hw-file').files[0];
    var selfQs = $('hw-self').value.trim();
    var answersText = selfQs ? $('hw-answers-text').value.trim() : '';
    var answersFile = selfQs ? $('hw-answers-file').files[0] : null;
    var chosen = Array.prototype.map.call($('hw-students').querySelectorAll('input:checked'), function (i) { return i.value; });
    if (!title || !due) return say(form, 'Add a title and a due date.', 'error');
    if (!chosen.length) return say(form, 'Choose at least one student.', 'error');
    busy(form, true); say(form, 'Setting homework…');
    var hw;
    client.from('homework').insert({
      subject: subject, title: title, instructions: $('hw-instructions').value.trim(), due_date: due,
      self_mark_questions: selfQs, answers_when: $('hw-answers-when').value,
    }).select().single().then(function (res) {
      hw = check(res);
      return file ? upload('homework/' + hw.id + '/' + safeFileName(file.name), file).then(function (path) {
        return client.from('homework').update({ attachment_path: path, attachment_name: file.name }).eq('id', hw.id).then(check);
      }) : null;
    }).then(function () {
      if (!answersText && !answersFile) return null;
      var up = answersFile ? upload('answers/' + hw.id + '/' + safeFileName(answersFile.name), answersFile) : Promise.resolve(null);
      return up.then(function (path) {
        return client.from('homework_answers').insert({ homework_id: hw.id, answers: answersText, file_path: path, file_name: path ? answersFile.name : null }).then(check);
      });
    }).then(function () {
      // Assigning it last means students are told once the worksheet is there to download.
      return client.from('homework_students').insert(chosen.map(function (id) { return { homework_id: hw.id, student_id: id }; })).then(check);
    }).then(function () {
      busy(form, false);
      form.reset();
      $('hw-self-more').hidden = true;
      $('hw-students').innerHTML = '';
      say(form, 'Homework set. ' + (chosen.length === 1 ? 'Your student has' : 'Your students have') + ' been told.', 'success');
      return refresh();
    }).catch(function (err) {
      busy(form, false);
      say(form, friendly(err), 'error');
    });
  });

  // Saving a mark (from To mark or from Homework)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList.contains('mark-form')) return;
    e.preventDefault();
    var id = form.dataset.id;
    var change = {
      mark: form.querySelector('[id^="mark-"]').value.trim() || null,
      feedback: form.querySelector('[id^="fb-"]').value.trim() || null,
      marked_at: new Date().toISOString(),
    };
    var selfBox = form.querySelector('[id^="selfmark-"]');
    if (selfBox) change.self_mark = selfBox.value.trim() || null;
    busy(form, true); say(form, 'Saving…');
    client.from('submissions').update(change).eq('id', id).select().single().then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      return refresh().then(function () {
        var again = document.querySelector('.mark-form[data-id="' + id + '"]');
        if (again && tab === 'homework') say(again, 'Saved. Your student has been told.', 'success');
      });
    });
  });

  // Changing a due date
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList.contains('due-form')) return;
    e.preventDefault();
    var due = form.querySelector('input').value;
    if (!due) return;
    busy(form, true);
    client.from('homework').update({ due_date: due }).eq('id', form.dataset.id).then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      refresh();
    });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.hw-delete');
    if (!b) return;
    if (b.dataset.confirm !== 'yes') {
      b.dataset.confirm = 'yes';
      b.textContent = 'Click again to delete it, and everything handed in for it';
      return;
    }
    var hw = homeworkById(b.closest('details').dataset.id);
    var paths = [];
    if (hw.attachment_path) paths.push(hw.attachment_path);
    var ans = D.answers[hw.id];
    if (ans && ans.file_path) paths.push(ans.file_path);
    D.submissions.forEach(function (s) {
      if (s.homework_id === hw.id) (s.files || []).forEach(function (f) { paths.push(f.path); });
    });
    client.from('homework').delete().eq('id', hw.id).then(function (res) {
      if (res.error) return alertInline(b, friendly(res.error));
      if (paths.length) client.storage.from(BUCKET).remove(paths);
      refresh();
    });
  });

  $('t-messages').addEventListener('click', function (e) {
    var item = e.target.closest('.inbox-item');
    if (item) { Threads.open = item.dataset.student; renderTab('messages'); return; }
    if (e.target.closest('.inbox-back')) { Threads.open = null; renderTab('messages'); }
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.student-message');
    if (b) { Threads.open = b.dataset.student; openTab('messages'); }
  });

  $('staff-students').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, id = form.dataset.id;
    var update = { full_name: form.querySelector('.name-input').value.trim() };
    var isStudent = !!form.querySelector('.tutor-select');
    if (isStudent) {
      var email = form.querySelector('.parent-email').value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say(form, 'That parent email doesn\'t look right.', 'error');
      update.subjects = Array.prototype.map.call(form.querySelectorAll('.chips input:checked'), function (i) { return i.value; });
      update.tutor_id = form.querySelector('.tutor-select').value || null;
      update.parent_name = form.querySelector('.parent-name').value.trim();
      update.parent_email = email;
      update.parent_updates = form.querySelector('.parent-updates').checked && !!email;
    }
    var role = form.querySelector('.role-select');
    if (role) update.role = role.value;
    busy(form, true); say(form, 'Saving…');
    client.from('profiles').update(update).eq('id', id).select().single().then(function (res) {
      check(res);
      if (!isStudent) return null;
      var notes = form.querySelector('.tutor-notes').value;
      var old = by(D.notes, 'student_id', id)[0];
      if ((old ? old.notes : '') === notes) return null;
      return client.from('tutor_notes').upsert({ student_id: id, notes: notes, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'student_id' }).then(check);
    }).then(function () {
      busy(form, false);
      return refresh().then(function () {
        var again = document.querySelector('.student-form[data-id="' + id + '"]');
        if (again) say(again, 'Saved.', 'success');
      });
    }).catch(function (err) {
      busy(form, false);
      say(form, friendly(err), 'error');
    });
  });

  $('res-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var title = $('res-title-input').value.trim(), file = $('res-file').files[0];
    if (!title || !file) return say(form, 'Add a title and choose a file.', 'error');
    busy(form, true); say(form, 'Uploading…');
    client.from('resources').insert({
      subject: $('res-subject').value, title: title,
      description: $('res-description').value.trim(),
      student_id: $('res-student').value || null,
    }).select().single().then(function (res) {
      var r = check(res);
      return upload('resources/' + r.id + '/' + safeFileName(file.name), file).then(function (path) {
        return client.from('resources').update({ file_path: path, file_name: file.name }).eq('id', r.id).then(check);
      });
    }).then(function () {
      busy(form, false);
      form.reset();
      say(form, 'Shared.', 'success');
      return refresh();
    }).catch(function (err) {
      busy(form, false);
      say(form, friendly(err), 'error');
    });
  });

  $('staff-resources').addEventListener('click', function (e) {
    var b = e.target.closest('.res-delete');
    if (!b) return;
    if (b.dataset.confirm !== 'yes') { b.dataset.confirm = 'yes'; b.textContent = 'Click again to remove'; return; }
    var r = by(D.resources, 'id', b.closest('.res-card').dataset.id)[0];
    client.from('resources').delete().eq('id', r.id).then(function (res) {
      if (res.error) return alertInline(b, friendly(res.error));
      if (r.file_path) client.storage.from(BUCKET).remove([r.file_path]);
      refresh();
    });
  });
})();
