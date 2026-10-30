// Prime Maths Tutoring student area.
// Logging in, homework, hand-ins, self-marking, marking and resources, all stored in Supabase.
// Setup steps are in portal-setup/README.md.
(function () {
  // Paste these from Supabase: Project Settings, then API. Both are safe to publish:
  // the security rules in portal-setup/schema.sql decide what each person can see.
  var SUPABASE_URL = 'PASTE-YOUR-SUPABASE-URL';
  var SUPABASE_ANON_KEY = 'PASTE-YOUR-SUPABASE-ANON-KEY';

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
  function subjectName(id) {
    if (id === 'all') return 'All subjects';
    var s = SUBJECTS.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : id;
  }
  function firstName(p) { return ((p && p.full_name) || '').trim().split(/\s+/)[0] || 'there'; }
  function formatDate(iso, withYear) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    return d.toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function daysUntil(isoDate) {
    var today = new Date(); today.setHours(12, 0, 0, 0);
    return Math.round((new Date(isoDate + 'T12:00:00') - today) / 86400000);
  }
  function safeFileName(name) {
    var clean = name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return Date.now() + '-' + (clean || 'file');
  }
  function say(form, message, kind) {
    var el = form.querySelector('.form-status');
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
  function friendly(error) {
    var m = (error && error.message) || '';
    if (/Invalid login credentials/i.test(m)) return 'That email and password don\'t match. Check them and try again.';
    if (/Email not confirmed/i.test(m)) return 'Your account isn\'t ready yet. Ask your tutor to confirm it.';
    if (/rate limit/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Couldn\'t reach the server. Check your internet connection and try again.';
    if (/Payload too large|exceeded the maximum/i.test(m)) return 'That file is too big. Files can be up to 50 MB.';
    return m || 'Something went wrong. Please try again.';
  }

  // Views: only one is shown at a time.
  var VIEWS = ['loading', 'setup', 'login', 'forgot', 'password', 'student', 'staff'];
  function show(view) {
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== view; });
    window.scrollTo(0, 0);
  }

  // --- Start up -----------------------------------------------------------------------------------
  var configured = SUPABASE_URL.indexOf('PASTE') !== 0 && SUPABASE_ANON_KEY.indexOf('PASTE') !== 0 && window.supabase;
  if (!configured) { show('setup'); return; }

  // A link from an invite or password reset email lands here with this in the address.
  var arrivedFor = new URLSearchParams(location.hash.slice(1)).get('type');
  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var me = null;          // the logged-in person's profile
  var passwordReturn = null;

  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') { passwordReturn = null; show('password'); }
    if (event === 'SIGNED_OUT') { me = null; setAccount(null); show('login'); }
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
    $('account-name').textContent = profile ? (profile.full_name || profile.email || '') : '';
  }

  function loadProfile() {
    return client.auth.getUser().then(function (res) {
      var user = res.data && res.data.user;
      if (!user) throw new Error('Not logged in');
      return client.from('profiles').select('*').eq('id', user.id).single();
    }).then(function (res) {
      if (res.error) throw res.error;
      me = res.data;
      setAccount(me);
      return me;
    });
  }

  function enter() {
    show('loading');
    return loadProfile().then(function () {
      if (me.role === 'tutor' || me.role === 'admin') return Staff.open();
      return Student.open();
    }).catch(function (e) {
      show('login');
      say($('login-form'), friendly(e), 'error');
    });
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

  $('change-password-open').addEventListener('click', function () {
    passwordReturn = me && (me.role === 'student' ? 'student' : 'staff');
    $('password-form').reset();
    say($('password-form'), '');
    show('password');
  });
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
      if (passwordReturn) show(passwordReturn); else enter();
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
  function fileButton(path, name, label) {
    return '<button type="button" class="file-link" data-path="' + esc(path) + '" data-name="' + esc(name) + '">' + esc(label || name) + '</button>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.file-link');
    if (b) download(b.dataset.path, b.dataset.name, b);
  });

  function pillTabs(nav, items, current, onPick) {
    nav.innerHTML = items.map(function (it) {
      return '<button type="button" data-id="' + esc(it.id) + '"' + (it.id === current ? ' aria-current="true"' : '') + '>' + esc(it.name) + '</button>';
    }).join('');
    nav.onclick = function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      nav.querySelectorAll('button').forEach(function (x) { x.removeAttribute('aria-current'); });
      b.setAttribute('aria-current', 'true');
      onPick(b.dataset.id);
    };
  }

  // --- Students -----------------------------------------------------------------------------------
  var Student = {
    data: null,
    subject: null,
    open: function () {
      $('student-greeting').textContent = 'Hi, ' + firstName(me);
      show('student');
      return Student.load();
    },
    load: function () {
      return Promise.all([
        client.from('homework').select('*').order('due_date', { ascending: true }),
        client.from('submissions').select('*'),
        client.from('resources').select('*').order('created_at', { ascending: false }),
        client.from('homework_answers').select('*'),
      ]).then(function (r) {
        r.forEach(function (x) { if (x.error) throw x.error; });
        var answers = {};
        r[3].data.forEach(function (a) { answers[a.homework_id] = a; });
        Student.data = { homework: r[0].data, submissions: r[1].data, resources: r[2].data, answers: answers };
        var subjects = (me.subjects || []).map(function (id) { return { id: id, name: subjectName(id) }; });
        if (!subjects.length) {
          $('subject-tabs').innerHTML = '';
          $('student-homework').innerHTML = '<p class="empty">Your tutor hasn\'t added your subjects yet. They\'ll appear here soon.</p>';
          $('student-resources').innerHTML = '';
          return;
        }
        if (!Student.subject || !subjects.some(function (s) { return s.id === Student.subject; })) Student.subject = subjects[0].id;
        pillTabs($('subject-tabs'), subjects, Student.subject, function (id) { Student.subject = id; Student.render(); });
        $('subject-tabs').hidden = subjects.length < 2;
        Student.render();
      }).catch(function (e) {
        $('student-homework').innerHTML = '<p class="empty">' + esc(friendly(e)) + '</p>';
      });
    },
    render: function () {
      var d = Student.data, subject = Student.subject;
      var hw = d.homework.filter(function (h) { return h.subject === subject; });
      var subs = {};
      d.submissions.forEach(function (s) { subs[s.homework_id] = s; });
      // Work still to do first, then handed in, then marked.
      var rank = function (h) { var s = subs[h.id]; return s ? (s.marked_at ? 2 : 1) : 0; };
      hw.sort(function (a, b) { return rank(a) - rank(b) || String(a.due_date).localeCompare(String(b.due_date)); });
      $('student-homework').innerHTML = hw.length ? hw.map(function (h) { return Student.card(h, subs[h.id]); }).join('')
        : '<p class="empty">No homework set for ' + esc(subjectName(subject)) + ' yet.</p>';

      var res = d.resources.filter(function (r) { return r.subject === subject || r.subject === 'all'; });
      $('student-resources').innerHTML = res.length ? res.map(function (r) {
        return '<article class="res-card"><div><h3>' + esc(r.title) + '</h3>' +
          (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
          '<p class="portal-muted portal-small">' + esc(subjectName(r.subject)) + ' &middot; ' + esc(formatDate(r.created_at, true)) + '</p></div>' +
          (r.file_path ? fileButton(r.file_path, r.file_name, 'Download') : '') + '</article>';
      }).join('') : '<p class="empty">Nothing shared yet. Slides and notes from your lessons will appear here.</p>';
    },
    card: function (h, s) {
      var status, chip;
      if (s && s.marked_at) { status = 'marked'; chip = 'Marked'; }
      else if (s) { status = 'handed-in'; chip = 'Handed in ' + formatDate(s.submitted_at); }
      else if (h.due_date) {
        var n = daysUntil(h.due_date);
        status = n < 0 ? 'overdue' : 'due';
        chip = n < 0 ? 'Overdue by ' + (-n) + (n === -1 ? ' day' : ' days') : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : 'Due ' + formatDate(h.due_date);
      } else { status = 'due'; chip = 'No due date'; }

      var html = '<article class="hw-card is-' + status + '" data-id="' + esc(h.id) + '">' +
        '<header><h3>' + esc(h.title) + '</h3><span class="chip-status">' + esc(chip) + '</span></header>';
      if (h.instructions) html += '<p class="hw-instructions">' + esc(h.instructions) + '</p>';
      if (h.attachment_path) html += '<p>' + fileButton(h.attachment_path, h.attachment_name, 'Download ' + (h.attachment_name || 'worksheet')) + '</p>';
      var selfMarking = !!h.self_mark_questions;
      if (selfMarking) html += Student.selfMarkBox(h, s);
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
              '<input id="self-' + id + '" class="self-mark-input" value="' + esc((s && s.self_mark) || '') + '" inputmode="text" autocomplete="off"></div>'
            : '') +
          '<div class="field"><label for="note-' + id + '">Note for your tutor <span class="optional">Optional</span></label>' +
          '<textarea id="note-' + id + '" rows="2">' + esc((s && s.note) || '') + '</textarea></div>' +
          '<button class="btn btn-small" type="submit">' + (s ? 'Save changes' : 'Hand in') + '</button>' +
          '<p class="form-status" role="status" aria-live="polite"></p></form>';
      }
      return html + '</article>';
    },
    // Which questions to mark yourself, and the answers once the tutor allows them.
    selfMarkBox: function (h, s) {
      var a = Student.data.answers[h.id];
      var html = '<div class="self-mark-box"><p><strong>Mark ' + esc(h.self_mark_questions) + ' yourself</strong>, in a different colour pen, then add your score when you hand in. Your tutor marks the rest.</p>';
      if (a) {
        html += (a.answers ? '<div class="self-mark-answers"><p class="portal-small portal-muted">Answers</p><p>' + multiline(a.answers) + '</p></div>' : '') +
          (a.file_path ? '<p>' + fileButton(a.file_path, a.file_name, 'Answers: ' + (a.file_name || 'download')) + '</p>' : '');
      } else if (h.answers_when === 'after' && !s) {
        html += '<p class="portal-small portal-muted">The answers appear here once you\'ve handed in.</p>';
      }
      return html + '</div>';
    },
    handIn: function (form) {
      var card = form.closest('.hw-card'), hwId = card.dataset.id;
      var files = Array.prototype.slice.call(form.querySelector('input[type="file"]').files);
      var note = form.querySelector('textarea').value.trim();
      var selfInput = form.querySelector('.self-mark-input');
      var existing = Student.data.submissions.filter(function (s) { return s.homework_id === hwId; })[0];
      if (!files.length && !existing) return say(form, 'Choose at least one file.', 'error');
      busy(form, true); say(form, files.length ? 'Uploading ' + files.length + (files.length === 1 ? ' file…' : ' files…') : 'Saving…');
      Promise.all(files.map(function (f) {
        return upload('submissions/' + me.id + '/' + hwId + '/' + safeFileName(f.name), f).then(function (path) { return { path: path, name: f.name }; });
      })).then(function (uploaded) {
        // New files are added to what's already handed in, so photos of the marking can go up afterwards.
        var change = { files: (existing ? existing.files || [] : []).concat(uploaded), note: note };
        if (selfInput) change.self_mark = selfInput.value.trim() || null;
        var write = existing
          ? client.from('submissions').update(change).eq('id', existing.id).select().single()
          : client.from('submissions').insert(Object.assign({ homework_id: hwId }, change)).select().single();
        return write.then(function (res) {
          if (res.error) throw res.error;
          return Student.load();
        });
      }).catch(function (e) {
        busy(form, false);
        say(form, friendly(e), 'error');
      });
    },
    removeFile: function (button) {
      var hwId = button.closest('.hw-card').dataset.id;
      var s = Student.data.submissions.filter(function (x) { return x.homework_id === hwId; })[0];
      var path = button.dataset.path;
      button.disabled = true;
      client.from('submissions').update({ files: s.files.filter(function (f) { return f.path !== path; }) }).eq('id', s.id).select().single().then(function (res) {
        if (res.error) { button.disabled = false; return alertInline(button, friendly(res.error)); }
        client.storage.from(BUCKET).remove([path]);
        Student.load();
      });
    },
  };
  $('student-homework').addEventListener('click', function (e) {
    var b = e.target.closest('.file-remove');
    if (b) Student.removeFile(b);
  });
  $('student-homework').addEventListener('submit', function (e) {
    if (!e.target.classList.contains('hw-upload')) return;
    e.preventDefault();
    Student.handIn(e.target);
  });

  // --- Tutors and admins --------------------------------------------------------------------------
  var Staff = {
    data: null,
    open: function () {
      $('staff-greeting').textContent = 'Hi, ' + firstName(me);
      show('staff');
      var subjectOptions = SUBJECTS.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
      $('hw-subject').innerHTML = subjectOptions;
      $('res-subject').innerHTML = '<option value="all">All subjects</option>' + subjectOptions;
      return Staff.load();
    },
    load: function () {
      return Promise.all([
        client.from('profiles').select('*').order('full_name', { ascending: true }),
        client.from('homework').select('*').order('created_at', { ascending: false }),
        client.from('homework_students').select('*'),
        client.from('submissions').select('*'),
        client.from('resources').select('*').order('created_at', { ascending: false }),
        client.from('homework_answers').select('*'),
      ]).then(function (r) {
        r.forEach(function (x) { if (x.error) throw x.error; });
        var answers = {};
        r[5].data.forEach(function (a) { answers[a.homework_id] = a; });
        Staff.data = { profiles: r[0].data, homework: r[1].data, assigned: r[2].data, submissions: r[3].data, resources: r[4].data, answers: answers };
        Staff.renderHomeworkForm();
        Staff.renderHomework();
        Staff.renderStudents();
        Staff.renderResources();
      }).catch(function (e) {
        $('staff-homework').innerHTML = '<p class="empty">' + esc(friendly(e)) + '</p>';
      });
    },
    students: function () {
      return Staff.data.profiles.filter(function (p) { return p.role === 'student'; });
    },
    nameOf: function (id) {
      var p = Staff.data.profiles.filter(function (x) { return x.id === id; })[0];
      return p ? (p.full_name || p.email) : 'Removed student';
    },
    renderHomeworkForm: function () {
      var subject = $('hw-subject').value;
      var list = Staff.students().filter(function (p) { return (p.subjects || []).indexOf(subject) !== -1; });
      $('hw-students').innerHTML = list.map(function (p) {
        return '<label class="chip"><input type="checkbox" value="' + esc(p.id) + '" checked><span>' + esc(p.full_name || p.email) + '</span></label>';
      }).join('');
      $('hw-students-empty').hidden = list.length > 0;
    },
    renderHomework: function () {
      var d = Staff.data;
      $('staff-homework').innerHTML = d.homework.length ? d.homework.map(function (h) {
        var who = d.assigned.filter(function (a) { return a.homework_id === h.id; });
        var subs = d.submissions.filter(function (s) { return s.homework_id === h.id; });
        var marked = subs.filter(function (s) { return s.marked_at; }).length;
        var selfMarking = !!h.self_mark_questions;
        var ans = d.answers[h.id];
        var rows = who.map(function (a) {
          var s = subs.filter(function (x) { return x.student_id === a.student_id; })[0];
          var state = !s ? '<span class="chip-status is-due">Not handed in</span>'
            : s.marked_at ? '<span class="chip-status is-marked">Marked</span>'
            : '<span class="chip-status is-handed-in">Handed in ' + esc(formatDate(s.submitted_at)) + '</span>';
          var body = '';
          if (s) {
            var sid = esc(s.id);
            var total = totalMark(s.self_mark, s.mark);
            body = '<div class="hw-files">' + (s.files || []).map(function (f) { return fileButton(f.path, f.name); }).join('') +
              (s.note ? '<p class="portal-small">&ldquo;' + esc(s.note) + '&rdquo;</p>' : '') + '</div>' +
              '<form class="form mark-form" data-id="' + sid + '" novalidate>' +
              (selfMarking
                ? '<div class="field-row"><div class="field"><label for="selfmark-' + sid + '">Their self-mark <span class="optional">Check it, ' + esc(h.self_mark_questions) + '</span></label>' +
                  '<input id="selfmark-' + sid + '" value="' + esc(s.self_mark || '') + '" placeholder="Not given"></div>' +
                  '<div class="field"><label for="mark-' + sid + '">Your mark <span class="optional">The rest</span></label>' +
                  '<input id="mark-' + sid + '" value="' + esc(s.mark || '') + '" placeholder="e.g. 9/10"></div></div>' +
                  (total ? '<p class="portal-small">Total so far: <strong>' + esc(total) + '</strong></p>' : '')
                : '<div class="field-row"><div class="field"><label for="mark-' + sid + '">Mark</label>' +
                  '<input id="mark-' + sid + '" value="' + esc(s.mark || '') + '" placeholder="e.g. 18/20"></div></div>') +
              '<div class="field"><label for="fb-' + esc(s.id) + '">Feedback</label>' +
              '<textarea id="fb-' + esc(s.id) + '" rows="2">' + esc(s.feedback || '') + '</textarea></div>' +
              '<button class="btn btn-small" type="submit">' + (s.marked_at ? 'Update mark' : 'Save mark') + '</button>' +
              '<p class="form-status" role="status" aria-live="polite"></p></form>';
          }
          return '<div class="mark-row"><div class="mark-row-head"><strong>' + esc(Staff.nameOf(a.student_id)) + '</strong>' + state + '</div>' + body + '</div>';
        }).join('');
        return '<details class="hw-card staff-hw" data-id="' + esc(h.id) + '"><summary>' +
          '<span><strong>' + esc(h.title) + '</strong><span class="portal-small portal-muted"> ' + esc(subjectName(h.subject)) +
          (h.due_date ? ' &middot; due ' + esc(formatDate(h.due_date)) : '') + '</span></span>' +
          '<span class="portal-small">' + subs.length + ' of ' + who.length + ' handed in' + (marked ? ', ' + marked + ' marked' : '') + '</span></summary>' +
          (h.instructions ? '<p class="hw-instructions">' + esc(h.instructions) + '</p>' : '') +
          (h.attachment_path ? '<p>' + fileButton(h.attachment_path, h.attachment_name, 'Worksheet: ' + (h.attachment_name || 'download')) + '</p>' : '') +
          (selfMarking
            ? '<div class="self-mark-box"><p><strong>Students mark ' + esc(h.self_mark_questions) + ' themselves.</strong> ' +
                (h.answers_when === 'after' ? 'Answers show once they hand in.' : 'Answers show straight away.') + '</p>' +
                (ans && ans.answers ? '<div class="self-mark-answers"><p>' + multiline(ans.answers) + '</p></div>' : '') +
                (ans && ans.file_path ? '<p>' + fileButton(ans.file_path, ans.file_name, 'Answers: ' + (ans.file_name || 'download')) + '</p>' : '') +
              '</div>'
            : '') +
          (rows || '<p class="empty">Not set for anyone.</p>') +
          '<div class="danger-zone"><button type="button" class="text-button hw-delete">Delete this homework</button></div>' +
          '</details>';
      }).join('') : '<p class="empty">You haven\'t set any homework yet.</p>';
    },
    renderStudents: function () {
      var list = Staff.data.profiles.filter(function (p) { return p.id !== me.id; });
      $('staff-students').innerHTML = list.length ? list.map(function (p) {
        var subjects = SUBJECTS.map(function (s) {
          return '<label class="chip"><input type="checkbox" value="' + s.id + '"' + ((p.subjects || []).indexOf(s.id) !== -1 ? ' checked' : '') + '><span>' + esc(s.name) + '</span></label>';
        }).join('');
        var role = me.role === 'admin'
          ? '<div class="field"><label for="role-' + esc(p.id) + '">Role</label><select id="role-' + esc(p.id) + '" class="role-select">' +
            ['student', 'tutor', 'admin'].map(function (r) { return '<option value="' + r + '"' + (p.role === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>'; }).join('') +
            '</select></div>'
          : '';
        return '<form class="window student-form" data-id="' + esc(p.id) + '" novalidate><div class="form">' +
          '<div class="field-row"><div class="field"><label for="name-' + esc(p.id) + '">Name</label>' +
          '<input id="name-' + esc(p.id) + '" class="name-input" value="' + esc(p.full_name) + '" placeholder="Full name"></div>' +
          '<div class="field"><label>Email</label><p class="portal-static">' + esc(p.email) + '</p></div></div>' +
          '<fieldset class="field"><legend>Subjects</legend><div class="chips">' + subjects + '</div></fieldset>' + role +
          '<button class="btn btn-small" type="submit">Save</button><p class="form-status" role="status" aria-live="polite"></p></div></form>';
      }).join('') : '<p class="empty">No students yet. Follow the steps above to add your first one.</p>';
    },
    renderResources: function () {
      $('res-student').innerHTML = '<option value="">Everyone taking the subject</option>' + Staff.students().map(function (p) {
        return '<option value="' + esc(p.id) + '">Only ' + esc(p.full_name || p.email) + '</option>';
      }).join('');
      var d = Staff.data;
      $('staff-resources').innerHTML = d.resources.length ? d.resources.map(function (r) {
        return '<article class="res-card" data-id="' + esc(r.id) + '"><div><h3>' + esc(r.title) + '</h3>' +
          (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
          '<p class="portal-muted portal-small">' + esc(subjectName(r.subject)) + (r.student_id ? ' &middot; only ' + esc(Staff.nameOf(r.student_id)) : '') +
          ' &middot; ' + esc(formatDate(r.created_at, true)) + '</p></div>' +
          '<div class="res-actions">' + (r.file_path ? fileButton(r.file_path, r.file_name, 'Download') : '') +
          '<button type="button" class="text-button res-delete">Remove</button></div></article>';
      }).join('') : '<p class="empty">Nothing shared yet.</p>';
    },
  };

  $('staff-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-panel]');
    if (!b) return;
    $('staff-tabs').querySelectorAll('button').forEach(function (x) { x.removeAttribute('aria-current'); });
    b.setAttribute('aria-current', 'true');
    ['homework', 'students', 'resources'].forEach(function (p) { $('panel-' + p).hidden = p !== b.dataset.panel; });
  });
  $('hw-subject').addEventListener('change', function () { Staff.renderHomeworkForm(); });
  $('hw-self').addEventListener('input', function () { $('hw-self-more').hidden = !$('hw-self').value.trim(); });

  $('hw-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var title = $('hw-title-input').value.trim(), due = $('hw-due').value, subject = $('hw-subject').value;
    var file = $('hw-file').files[0];
    var selfQs = $('hw-self').value.trim();
    var answersText = selfQs ? $('hw-answers-text').value.trim() : '';
    var answersFile = selfQs ? $('hw-answers-file').files[0] : null;
    var students = Array.prototype.map.call($('hw-students').querySelectorAll('input:checked'), function (i) { return i.value; });
    if (!title || !due) return say(form, 'Add a title and a due date.', 'error');
    if (!students.length) return say(form, 'Choose at least one student.', 'error');
    busy(form, true); say(form, 'Setting homework…');
    client.from('homework').insert({
      subject: subject, title: title, instructions: $('hw-instructions').value.trim(), due_date: due,
      self_mark_questions: selfQs, answers_when: $('hw-answers-when').value,
    })
      .select().single().then(function (res) {
        if (res.error) throw res.error;
        var hw = res.data;
        var attach = file
          ? upload('homework/' + hw.id + '/' + safeFileName(file.name), file).then(function (path) {
            return client.from('homework').update({ attachment_path: path, attachment_name: file.name }).eq('id', hw.id);
          })
          : Promise.resolve({});
        return attach.then(function (r) {
          if (r && r.error) throw r.error;
          if (!answersText && !answersFile) return {};
          var answersUpload = answersFile ? upload('answers/' + hw.id + '/' + safeFileName(answersFile.name), answersFile) : Promise.resolve(null);
          return answersUpload.then(function (path) {
            return client.from('homework_answers').insert({ homework_id: hw.id, answers: answersText, file_path: path, file_name: path ? answersFile.name : null });
          });
        }).then(function (r) {
          if (r && r.error) throw r.error;
          return client.from('homework_students').insert(students.map(function (id) { return { homework_id: hw.id, student_id: id }; }));
        });
      }).then(function (res) {
        if (res && res.error) throw res.error;
        busy(form, false);
        form.reset();
        $('hw-self-more').hidden = true;
        say(form, 'Homework set.', 'success');
        return Staff.load();
      }).catch(function (err) {
        busy(form, false);
        say(form, friendly(err), 'error');
      });
  });

  $('staff-homework').addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList.contains('mark-form')) return;
    e.preventDefault();
    var id = form.dataset.id;
    busy(form, true); say(form, 'Saving…');
    var change = {
      mark: $('mark-' + id).value.trim() || null,
      feedback: $('fb-' + id).value.trim() || null,
      marked_at: new Date().toISOString(),
    };
    if ($('selfmark-' + id)) change.self_mark = $('selfmark-' + id).value.trim() || null;
    client.from('submissions').update(change).eq('id', id).select().single().then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      var openId = form.closest('details').dataset.id;
      Staff.load().then(function () {
        var d = document.querySelector('.staff-hw[data-id="' + openId + '"]');
        if (d) d.open = true;
      });
    });
  });

  $('staff-homework').addEventListener('click', function (e) {
    var b = e.target.closest('.hw-delete');
    if (!b) return;
    if (b.dataset.confirm !== 'yes') {
      b.dataset.confirm = 'yes';
      b.textContent = 'Click again to delete it, and everything handed in for it';
      return;
    }
    var hw = Staff.data.homework.filter(function (h) { return h.id === b.closest('details').dataset.id; })[0];
    var paths = [];
    if (hw.attachment_path) paths.push(hw.attachment_path);
    var ans = Staff.data.answers[hw.id];
    if (ans && ans.file_path) paths.push(ans.file_path);
    Staff.data.submissions.forEach(function (s) {
      if (s.homework_id === hw.id) (s.files || []).forEach(function (f) { paths.push(f.path); });
    });
    client.from('homework').delete().eq('id', hw.id).then(function (res) {
      if (res.error) return alertInline(b, friendly(res.error));
      if (paths.length) client.storage.from(BUCKET).remove(paths);
      Staff.load();
    });
  });

  $('staff-students').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, id = form.dataset.id;
    var update = {
      full_name: form.querySelector('.name-input').value.trim(),
      subjects: Array.prototype.map.call(form.querySelectorAll('.chips input:checked'), function (i) { return i.value; }),
    };
    var role = form.querySelector('.role-select');
    if (role) update.role = role.value;
    busy(form, true); say(form, 'Saving…');
    client.from('profiles').update(update).eq('id', id).select().single().then(function (res) {
      busy(form, false);
      if (res.error) return say(form, friendly(res.error), 'error');
      Staff.data.profiles = Staff.data.profiles.map(function (p) { return p.id === id ? res.data : p; });
      say(form, 'Saved.', 'success');
      Staff.renderHomeworkForm();
      Staff.renderResources();
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
      if (res.error) throw res.error;
      var r = res.data;
      return upload('resources/' + r.id + '/' + safeFileName(file.name), file).then(function (path) {
        return client.from('resources').update({ file_path: path, file_name: file.name }).eq('id', r.id);
      });
    }).then(function (res) {
      if (res && res.error) throw res.error;
      busy(form, false);
      form.reset();
      say(form, 'Shared.', 'success');
      return Staff.load();
    }).catch(function (err) {
      busy(form, false);
      say(form, friendly(err), 'error');
    });
  });

  $('staff-resources').addEventListener('click', function (e) {
    var b = e.target.closest('.res-delete');
    if (!b) return;
    if (b.dataset.confirm !== 'yes') { b.dataset.confirm = 'yes'; b.textContent = 'Click again to remove'; return; }
    var r = Staff.data.resources.filter(function (x) { return x.id === b.closest('.res-card').dataset.id; })[0];
    client.from('resources').delete().eq('id', r.id).then(function (res) {
      if (res.error) return alertInline(b, friendly(res.error));
      if (r.file_path) client.storage.from(BUCKET).remove([r.file_path]);
      Staff.load();
    });
  });
})();
