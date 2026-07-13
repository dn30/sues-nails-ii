const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.getElementById("year").textContent = new Date().getFullYear();

/* Mobile nav */
const toggle = document.querySelector(".nav-toggle");
const links = document.querySelector(".nav-links");

toggle.addEventListener("click", () => {
  const isOpen = links.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", isOpen);
});

links.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    links.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  });
});

/* Split hero title into animated characters */
const heroTitle = document.querySelector("[data-split]");
if (heroTitle) {
  const text = heroTitle.textContent;
  heroTitle.textContent = "";
  heroTitle.setAttribute("aria-label", text);
  [...text].forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = ch === " " ? "char char--space" : "char";
    span.textContent = ch === " " ? "\u00a0" : ch;
    span.style.setProperty("--char-delay", `${0.15 + i * 0.055}s`);
    span.setAttribute("aria-hidden", "true");
    heroTitle.appendChild(span);
  });
}

/* Header state + scroll progress + back-to-top + hero parallax */
const header = document.querySelector("[data-header]");
const progress = document.querySelector(".scroll-progress");
const backToTop = document.querySelector("[data-back-to-top]");
const parallaxEls = prefersReducedMotion ? [] : [...document.querySelectorAll("[data-parallax]")];
const hero = document.querySelector("[data-hero]");

let ticking = false;

function onScroll() {
  const y = window.scrollY;

  header.classList.toggle("is-scrolled", y > 24);

  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;

  backToTop.classList.toggle("is-visible", y > window.innerHeight * 0.6);

  if (hero && y < window.innerHeight) {
    parallaxEls.forEach((el) => {
      const speed = parseFloat(el.dataset.parallax);
      el.style.transform = `translateY(${y * speed}px)`;
    });
  }

  ticking = false;
}

window.addEventListener("scroll", () => {
  if (!ticking) {
    requestAnimationFrame(onScroll);
    ticking = true;
  }
}, { passive: true });

onScroll();

backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
});

/* Scroll-triggered reveals with stagger */
document.querySelectorAll("[data-stagger]").forEach((group) => {
  [...group.querySelectorAll(".reveal")].forEach((el, i) => {
    el.style.setProperty("--stagger-delay", `${(i % 5) * 0.09}s`);
  });
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

/* Animated counters */
function animateCount(el) {
  const target = parseInt(el.dataset.count, 10);
  const duration = 1400;
  const start = performance.now();

  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased);
    if (t < 1) requestAnimationFrame(frame);
  }

  if (prefersReducedMotion) {
    el.textContent = target;
  } else {
    requestAnimationFrame(frame);
  }
}

const countObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      animateCount(entry.target);
      countObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll("[data-count]").forEach((el) => countObserver.observe(el));

/* Card tilt + shine following cursor */
if (!prefersReducedMotion && window.matchMedia("(hover: hover)").matches) {
  document.querySelectorAll("[data-tilt]").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      card.style.transform = `perspective(800px) rotateY(${(px - 0.5) * 6}deg) rotateX(${(0.5 - py) * 6}deg) translateY(-4px)`;
      card.style.setProperty("--mx", `${px * 100}%`);
      card.style.setProperty("--my", `${py * 100}%`);
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });

  /* Magnetic buttons */
  document.querySelectorAll("[data-magnetic]").forEach((btn) => {
    btn.addEventListener("mousemove", (e) => {
      const rect = btn.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      btn.style.transform = `translate(${dx * 0.15}px, ${dy * 0.25}px)`;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "";
    });
  });
}

/* Open/closed status from business hours (visitor's local time) */
function updateOpenStatus() {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const open = 9 * 60;
  const close = (day === 0 ? 18 : 20) * 60;
  const isOpen = minutes >= open && minutes < close;

  document.querySelectorAll("[data-status-dot]").forEach((dot) => {
    dot.classList.toggle("is-open", isOpen);
    dot.classList.toggle("is-closed", !isOpen);
  });

  const closeLabel = day === 0 ? "6:00 PM" : "8:00 PM";
  const text = isOpen
    ? `Open now · until ${closeLabel}`
    : "Closed now · opens at 9:00 AM";
  document.querySelectorAll("[data-status-text]").forEach((el) => {
    el.textContent = text;
  });

  document.querySelectorAll(".hours-row[data-days]").forEach((row) => {
    const days = row.dataset.days.split(",").map(Number);
    row.classList.toggle("is-today", days.includes(day));
  });
}

updateOpenStatus();
setInterval(updateOpenStatus, 60000);

/* Highlight active nav link while scrolling */
const sections = [...document.querySelectorAll("section[id]")];
const navAnchors = [...document.querySelectorAll('.nav-links a[href^="#"]')];

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      navAnchors.forEach((a) => {
        a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`);
      });
    }
  });
}, { rootMargin: "-40% 0px -55% 0px" });

sections.forEach((s) => sectionObserver.observe(s));
