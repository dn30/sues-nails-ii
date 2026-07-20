document.getElementById("year").textContent = new Date().getFullYear();

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

/* Online booking widget: enabled when window.BOOKING_API is set (see index.html). */
(function () {
  const api = (window.BOOKING_API || "").replace(/\/+$/, "");
  if (!api) return;
  document.getElementById("book").hidden = false;
  document.getElementById("nav-book").hidden = false;
  const s = document.createElement("script");
  s.src = api + "/widget.js";
  s.defer = true;
  s.dataset.target = "#sues-booking";
  document.head.appendChild(s);
})();

/* Live open/closed status (salon local time: America/Los_Angeles).
   Mon–Sat 9:00–20:00, Sun 9:00–18:00. */
function updateOpenStatus() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type).value;
  const day = get("weekday");
  const hour = parseInt(get("hour"), 10) % 24;
  const minutes = hour * 60 + parseInt(get("minute"), 10);

  const closeHour = day === "Sun" ? 18 : 20;
  const isOpen = minutes >= 9 * 60 && minutes < closeHour * 60;

  const status = document.getElementById("open-status");
  if (status) {
    status.classList.toggle("is-open", isOpen);
    status.querySelector(".status-text").textContent = isOpen
      ? `Open now — closes at ${closeHour === 18 ? "6:00" : "8:00"} PM`
      : "Closed now — opens at 9:00 AM";
  }

  const heroNote = document.getElementById("hero-status");
  if (heroNote) {
    heroNote.textContent = isOpen
      ? "Open now · Walk-ins welcome"
      : "Walk-ins welcome · Open 7 days a week";
  }
}

updateOpenStatus();
setInterval(updateOpenStatus, 60 * 1000);
