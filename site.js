// Prime Maths Tutoring: shared script for the home page and the booking page.
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
  var WEB3FORMS_KEY = 'PASTE-YOUR-ACCESS-KEY-HERE';
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

    // A link like contact.html#prices picks the matching topic.
    var topic = location.hash && form.querySelector('[data-topic="' + location.hash.slice(1) + '"]');
    if (topic) topic.checked = true;

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

  // Section tabs: pressing one lines its heading up just under the top bar and highlights it straight away.
  // While scrolling normally, the tab for the section on screen stays highlighted.
  (function () {
    var nav = document.querySelector('.tabs');
    if (!nav) return;
    var header = document.querySelector('.site-header');
    // Only tabs that point at a section on this page take part; Contact Us is a normal link to its own page.
    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // After a tab is pressed, hold its highlight until the page arrives (or the visitor scrolls themselves).
    var lock = null;
    var GAP = 24;

    function target(a) {
      var section = document.querySelector(a.getAttribute('href'));
      if (!section) return null;
      return section.querySelector('.section-head') || section;
    }

    function highlight(a) {
      links.forEach(function (l) {
        if (l === a) l.setAttribute('aria-current', 'true');
        else l.removeAttribute('aria-current');
      });
      // On phones the tabs scroll sideways, so keep the highlighted one in view.
      if (a && nav.scrollWidth > nav.clientWidth) {
        nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: still ? 'auto' : 'smooth' });
      }
    }

    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        var el = target(a);
        if (!el) return;
        e.preventDefault();
        var top = a.getAttribute('href') === '#top' ? 0
          : el.getBoundingClientRect().top + window.scrollY - header.offsetHeight - GAP;
        var maxTop = document.documentElement.scrollHeight - window.innerHeight;
        top = Math.min(Math.max(0, top), maxTop);
        highlight(a);
        lock = { top: top, until: Date.now() + 2000 };
        window.scrollTo({ top: top, behavior: still ? 'auto' : 'smooth' });
        try { history.replaceState(null, '', a.getAttribute('href')); } catch (err) {}
      });
    });

    function update() {
      if (lock) {
        if (Math.abs(window.scrollY - lock.top) > 2 && Date.now() < lock.until) return;
        lock = null;
        return;
      }
      var line = header.offsetHeight + window.innerHeight * 0.3;
      var current = links[0];
      links.forEach(function (a) {
        var el = target(a);
        if (el && el.getBoundingClientRect().top <= line) current = a;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = links[links.length - 1];
      if (window.scrollY < 10) current = links[0];
      if (current.getAttribute('aria-current') !== 'true') highlight(current);
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
