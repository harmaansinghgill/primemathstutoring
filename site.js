// Prime Maths Tutoring: shared script for every page except the student area.
(function () {
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Feedback carousel: moves on every 5 seconds, and pauses while someone is reading or using it.
  (function () {
    var section = document.getElementById('reviews');
    if (!section || section.hidden) return;
    var track = section.querySelector('.reviews-track');
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var behavior = still ? 'auto' : 'smooth';
    var paused = false;

    function step(dir) {
      var card = track.querySelector('.review');
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      var width = card ? card.getBoundingClientRect().width + gap : track.clientWidth;
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      var atStart = track.scrollLeft <= 4;
      if (dir > 0 && atEnd) track.scrollTo({ left: 0, behavior: behavior });
      else if (dir < 0 && atStart) track.scrollTo({ left: track.scrollWidth, behavior: behavior });
      else track.scrollBy({ left: dir * width, behavior: behavior });
    }

    section.querySelectorAll('.round-btn').forEach(function (b) {
      b.addEventListener('click', function () { step(Number(b.dataset.dir)); });
    });
    ['mouseenter', 'focusin', 'touchstart'].forEach(function (e) {
      section.addEventListener(e, function () { paused = true; }, { passive: true });
    });
    ['mouseleave', 'focusout'].forEach(function (e) {
      section.addEventListener(e, function () { paused = false; });
    });
    if (!still) setInterval(function () { if (!paused && !document.hidden) step(1); }, 5000);
  })();

  // Forms: both send to your email through Web3Forms. Paste your access key here (see README).
  var WEB3FORMS_KEY = '980257b5-da28-4e19-800e-0b23003da30c';
  var CONTACT_EMAIL = 'hello@primemathstutoring.co.uk';

  document.querySelectorAll('form.form').forEach(function (form) {
    var status = form.querySelector('.form-status');
    var button = form.querySelector('button[type="submit"]');

    function say(message, kind) {
      status.textContent = message;
      status.className = 'form-status' + (kind ? ' is-' + kind : '');
    }

    function clear(e) {
      var el = e.target;
      if (el.type === 'radio') form.querySelectorAll('input[name="' + el.name + '"]').forEach(function (r) { r.removeAttribute('aria-invalid'); });
      else el.removeAttribute('aria-invalid');
    }
    form.addEventListener('input', clear);
    form.addEventListener('change', clear);

    // A link like /contact?topic=prices picks the matching topic, then tidies the address.
    var wanted = new URLSearchParams(location.search).get('topic') || location.hash.slice(1);
    var topic = wanted && form.querySelector('[data-topic="' + wanted + '"]');
    if (topic) {
      topic.checked = true;
      try { history.replaceState(null, '', location.pathname); } catch (err) {}
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstProblem = null;
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.willValidate) return;
        if (el.checkValidity()) el.removeAttribute('aria-invalid');
        else { el.setAttribute('aria-invalid', 'true'); firstProblem = firstProblem || el; }
      });
      if (firstProblem) {
        say('Please fill in or check the highlighted boxes.', 'error');
        firstProblem.focus();
        return;
      }
      if (form.elements.botcheck.checked) return;
      if (WEB3FORMS_KEY.indexOf('PASTE') === 0) {
        say('This form isn\'t connected to an inbox yet. Please email ' + CONTACT_EMAIL + ' instead.', 'error');
        return;
      }

      var data = { access_key: WEB3FORMS_KEY, subject: form.dataset.subject, from_name: 'Prime Maths Tutoring website' };
      new FormData(form).forEach(function (value, key) {
        if (key === 'botcheck' || value === '') return;
        data[key] = data[key] ? data[key] + ', ' + value : value;
      });

      button.disabled = true;
      say('Sending…');
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          if (!result.success) throw new Error(result.message);
          // The booking page swaps the form for a thank-you message; other forms just say thanks.
          var thanks = form.dataset.thanks && document.getElementById(form.dataset.thanks);
          if (thanks) {
            var name = thanks.querySelector('[data-name]');
            var nameField = form.querySelector('[data-name-field]');
            if (name && nameField && nameField.value.trim()) name.textContent = ', ' + nameField.value.trim().split(/\s+/)[0];
            form.closest('.window').hidden = true;
            thanks.hidden = false;
            thanks.focus({ preventScroll: true });
            thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            say('Thanks, that\'s been sent. We\'ll be in touch within 24 hours.', 'success');
          }
          form.reset();
        })
        .catch(function () {
          say('Sorry, that didn\'t send. Please try again, or email ' + CONTACT_EMAIL + '.', 'error');
        })
        .then(function () { button.disabled = false; });
    });
  });

  // Sections of the home page have their own clean addresses (/feedback, /prices and so on).
  // Pressing a tab lines its heading up just under the top bar, highlights it straight away and shows its address.
  // While scrolling normally, the tab for the section on screen stays highlighted.
  (function () {
    var nav = document.querySelector('.tabs');
    if (!nav) return;
    var header = document.querySelector('.site-header');
    var tabs = Array.prototype.slice.call(nav.querySelectorAll('a[data-section]'));
    // On the other pages the section tabs are plain links back to the home page.
    if (!tabs.length || !document.getElementById('top')) return;
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var GAP = 24;
    // After a tab is pressed, hold its highlight until the page arrives (or the visitor scrolls themselves).
    var lock = null;

    // Address for each section, taken from the tabs: { reviews: '/feedback', ... }
    var pathFor = {};
    var sectionFor = { 'at-a-glance': 'top' };
    tabs.forEach(function (a) {
      var path = a.getAttribute('href');
      pathFor[a.dataset.section] = path;
      sectionFor[path.replace(/^\/+|\/+$/g, '')] = a.dataset.section;
    });

    function target(id) {
      var section = document.getElementById(id);
      if (!section) return null;
      return section.querySelector('.section-head') || section;
    }

    function highlight(id) {
      var active = null;
      tabs.forEach(function (a) {
        if (a.dataset.section === id) { a.setAttribute('aria-current', 'true'); active = a; }
        else a.removeAttribute('aria-current');
      });
      // On phones the tabs scroll sideways, so keep the highlighted one in view.
      if (active && nav.scrollWidth > nav.clientWidth) {
        nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2, behavior: still ? 'auto' : 'smooth' });
      }
    }

    function go(id, smooth) {
      var el = target(id);
      if (!el) return;
      var top = id === 'top' ? 0 : el.getBoundingClientRect().top + window.scrollY - header.offsetHeight - GAP;
      top = Math.min(Math.max(0, top), document.documentElement.scrollHeight - window.innerHeight);
      highlight(id);
      lock = { top: top, until: Date.now() + 2000 };
      window.scrollTo({ top: top, behavior: smooth && !still ? 'smooth' : 'auto' });
    }

    function setAddress(id, replace) {
      var path = pathFor[id] || '/';
      if (location.pathname === path && !location.search && !location.hash) return;
      try { history[replace ? 'replaceState' : 'pushState']({ section: id }, '', path); } catch (err) {}
    }

    document.querySelectorAll('a[data-section]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (!target(a.dataset.section)) return;
        e.preventDefault();
        go(a.dataset.section, true);
        setAddress(a.dataset.section, false);
      });
    });

    // Back and forward buttons move between sections.
    window.addEventListener('popstate', function () {
      go(sectionFor[location.pathname.replace(/^\/+|\/+$/g, '')] || 'top', true);
    });

    // Arriving at a section's address. GitHub sends /feedback and the like to the 404 page,
    // which hands the section over here; older links with #reviews and so on still work too.
    window.addEventListener('load', function () {
      var slug = null;
      try { slug = sessionStorage.getItem('pmt-section'); sessionStorage.removeItem('pmt-section'); } catch (err) {}
      slug = slug || new URLSearchParams(location.search).get('section');
      var id = slug ? sectionFor[slug] : (location.hash && document.getElementById(location.hash.slice(1)) && pathFor[location.hash.slice(1)] ? location.hash.slice(1) : null);
      if (id) {
        go(id, false);
        setAddress(id, true);
      }
    });

    function update() {
      if (lock) {
        if (Math.abs(window.scrollY - lock.top) > 2 && Date.now() < lock.until) return;
        lock = null;
        return;
      }
      var line = header.offsetHeight + window.innerHeight * 0.3;
      var current = tabs[0].dataset.section;
      tabs.forEach(function (a) {
        var el = target(a.dataset.section);
        if (el && el.getBoundingClientRect().top <= line) current = a.dataset.section;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = tabs[tabs.length - 1].dataset.section;
      if (window.scrollY < 10) current = tabs[0].dataset.section;
      if (!nav.querySelector('[data-section="' + current + '"][aria-current]')) highlight(current);
    }

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; update(); });
    }, { passive: true });
    ['wheel', 'touchstart', 'keydown'].forEach(function (type) {
      window.addEventListener(type, function () { lock = null; }, { passive: true });
    });
    update();
  })();
})();
