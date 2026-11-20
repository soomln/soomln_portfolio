/**
 * Page interactions: fluid unit, custom cursor, scroll reveals,
 * split headlines, mouse parallax, magnetic buttons, progress bar.
 */
(() => {
  const root = document.documentElement;
  root.classList.add('js');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- 1 design px = clientWidth / 1440 (excludes scrollbar) ---------- */
  const setUnit = () => root.style.setProperty('--u', `${root.clientWidth / 1440}px`);
  setUnit();
  window.addEventListener('resize', setUnit);

  /* ---------- split headlines into characters ---------- */
  document.querySelectorAll('[data-split]').forEach((el) => {
    let i = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          for (const ch of child.textContent) {
            if (ch.trim() === '') {
              frag.appendChild(document.createTextNode(ch));
            } else {
              const span = document.createElement('span');
              span.className = 'char';
              span.style.setProperty('--i', i++);
              span.textContent = ch;
              frag.appendChild(span);
            }
          }
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
          walk(child);
        }
      });
    };
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    walk(el);
    el.dataset.chars = i;
  });

  /* ---------- scroll reveal ---------- */
  // Delays live in the markup as plain numbers (seconds):
  //   data-reveal="0.2"   → this element waits 0.2s
  //   data-stagger="0.06" → on a list: each revealing child waits 0.06s more than the one before
  //   data-cols="3"       → with data-stagger: restart the count every 3 items (one grid row)
  document.querySelectorAll('[data-stagger]').forEach((list) => {
    const step = parseFloat(list.dataset.stagger) || 0;
    const cols = parseInt(list.dataset.cols, 10) || Infinity;
    [...list.children]
      .filter((item) => item.hasAttribute('data-reveal'))
      .forEach((item, i) => {
        if (!item.dataset.reveal) item.dataset.reveal = String(+((i % cols) * step).toFixed(3));
      });
  });
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    const delay = parseFloat(el.dataset.reveal);
    if (delay) el.style.setProperty('--d', `${delay}s`);
  });

  const revealTargets = document.querySelectorAll('[data-reveal], [data-split]');

  const finish = (el) => {
    if (el.hasAttribute('data-split')) {
      const total = Number(el.dataset.chars || 0) * 35 + 900;
      setTimeout(() => el.classList.add('is-done'), total);
    } else {
      // hand control back to the component's own hover transitions
      const delay = parseFloat(getComputedStyle(el).getPropertyValue('--d')) || 0;
      setTimeout(() => el.removeAttribute('data-reveal'), delay * 1000 + 1150);
    }
  };

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach((el) => {
      el.classList.add('is-in');
      finish(el);
    });
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        finish(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    revealTargets.forEach((el) => io.observe(el));
  }

  /* ---------- copy to clipboard: <button data-copy="text" data-copied-label="..."> ---------- */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    const original = btn.textContent;
    let timer;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = btn.dataset.copiedLabel || 'COPIED';
      } catch {
        // clipboard blocked (e.g. not https/localhost): fall back to opening mail
        window.location.href = `mailto:${btn.dataset.copy}`;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => { btn.textContent = original; }, 1800);
    });
  });

  /* ---------- pointer-driven effects ---------- */
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  }, { passive: true });

  // custom cursor
  const cursor = document.querySelector('.cursor');
  const dot = cursor && cursor.querySelector('.cursor__dot');
  const ring = cursor && cursor.querySelector('.cursor__ring');
  const ringPos = { x: pointer.x, y: pointer.y };
  const contact = document.querySelector('[data-marble-dark]'); // dark area → light cursor

  if (cursor && finePointer) {
    root.classList.add('has-cursor');

    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('[data-cursor], a, button');
      cursor.classList.toggle('is-view', !!el && el.dataset.cursor === 'view');
      cursor.classList.toggle('is-hover', !!el && el.dataset.cursor !== 'view');
    });
    document.addEventListener('pointerleave', () => cursor.classList.add('is-hidden'));
    document.addEventListener('pointerenter', () => cursor.classList.remove('is-hidden'));
  }

  // parallax layers: data-parallax="<max shift in design px>"
  const parallax = Array.from(document.querySelectorAll('[data-parallax]')).map((el) => ({
    el,
    section: el.closest('.section'),
    amount: Number(el.dataset.parallax) || 10,
    x: 0,
    y: 0,
  }));

  // magnetic buttons
  const magnets = Array.from(document.querySelectorAll('[data-magnetic]')).map((el) => ({ el, x: 0, y: 0 }));

  // scroll progress
  const bar = document.querySelector('.progress__bar');

  function tick() {
    const unit = root.clientWidth / 1440;

    if (cursor && finePointer) {
      ringPos.x = lerp(ringPos.x, pointer.x, 0.2);
      ringPos.y = lerp(ringPos.y, pointer.y, 0.2);
      dot.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
      ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`;

      if (contact) {
        const r = contact.getBoundingClientRect();
        cursor.classList.toggle('is-light', pointer.y >= r.top && pointer.y <= r.bottom);
      }
    }

    if (!reduceMotion) {
      const nx = (pointer.x / window.innerWidth) * 2 - 1;
      const ny = (pointer.y / window.innerHeight) * 2 - 1;

      parallax.forEach((p) => {
        const r = p.section.getBoundingClientRect();
        const visible = r.bottom > 0 && r.top < window.innerHeight;
        const tx = visible && pointer.active ? -nx * p.amount * unit : 0;
        const ty = visible && pointer.active ? -ny * p.amount * unit : 0;
        p.x = lerp(p.x, tx, 0.06);
        p.y = lerp(p.y, ty, 0.06);
        p.el.style.translate = `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`;
      });

      magnets.forEach((m) => {
        const r = m.el.getBoundingClientRect();
        const cx = r.left + r.width / 2 - m.x;
        const cy = r.top + r.height / 2 - m.y;
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        const reach = Math.max(r.width, r.height) * 1.1;
        const inside = Math.hypot(dx, dy) < reach;
        m.x = lerp(m.x, inside ? dx * 0.35 : 0, 0.15);
        m.y = lerp(m.y, inside ? dy * 0.35 : 0, 0.15);
        m.el.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`;
      });
    }

    if (bar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  /* ---------- case index: highlight the chapter being read ---------- */
  // project-daylong.html: links in .case-index point at #dl-01 … #dl-11.
  // The chapter crossing the middle of the screen is "current".
  const indexLinks = [...document.querySelectorAll('.case-index a[href^="#"]')];
  if (indexLinks.length && 'IntersectionObserver' in window) {
    const byId = new Map(indexLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const setActive = (id) => {
      indexLinks.forEach((a) => {
        const on = a === byId.get(id);
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };

    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-50% 0px -50% 0px' }); // a 1px line across the middle

    byId.forEach((_, id) => {
      const target = document.getElementById(id);
      if (target) spy.observe(target);
    });

    // before / after the viewer, nothing is highlighted
    const viewer = document.querySelector('.case-viewer');
    if (viewer) {
      new IntersectionObserver(([e]) => { if (!e.isIntersecting) setActive(null); },
        { rootMargin: '-50% 0px -50% 0px' }).observe(viewer);
    }
  }
})();
