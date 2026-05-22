(function () {
  "use strict";

  const STORAGE_SEASON = "banira-season";
  const STORAGE_NIGHT = "banira-night-mode";
  const DEFAULT_SEASON = "spring";
  const DEFAULT_NIGHT = "auto";

  const SEASONS = [
    { id: "spring", label: "春", title: "樱花粉" },
    { id: "summer", label: "夏", title: "翠绿" },
    { id: "autumn", label: "秋", title: "暖橙" },
    { id: "winter", label: "冬", title: "霜雪" },
  ];

  function getSeason() {
    return localStorage.getItem(STORAGE_SEASON) || DEFAULT_SEASON;
  }

  function getNightMode() {
    return localStorage.getItem(STORAGE_NIGHT) || DEFAULT_NIGHT;
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-season", getSeason());
    document.documentElement.setAttribute("data-night-mode", getNightMode());
  }

  function setSeason(id) {
    localStorage.setItem(STORAGE_SEASON, id);
    applyTheme();
    syncSeasonButtons();
  }

  function setNightMode(mode) {
    localStorage.setItem(STORAGE_NIGHT, mode);
    applyTheme();
    syncAppearanceButtons();
  }

  function syncSeasonButtons() {
    const current = getSeason();
    document.querySelectorAll(".season-btn").forEach((btn) => {
      const on = btn.getAttribute("data-season") === current;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncAppearanceButtons() {
    const current = getNightMode();
    document.querySelectorAll(".appearance-btn").forEach((btn) => {
      const on = btn.getAttribute("data-night") === current;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function openThemeModal() {
    const modal = document.getElementById("theme-modal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("theme-modal-open");
    document.getElementById("theme-modal-close")?.focus();
  }

  function closeThemeModal() {
    const modal = document.getElementById("theme-modal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("theme-modal-open");
    document.getElementById("theme-trigger")?.focus();
  }

  function initThemeModal() {
    const picker = document.getElementById("season-picker");
    if (picker) {
      SEASONS.forEach((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "season-btn";
        btn.setAttribute("data-season", s.id);
        btn.title = s.title;
        btn.setAttribute("aria-label", s.title);
        btn.innerHTML = '<span class="season-btn__label">' + s.label + "</span><span class=\"season-btn__sub\">" + s.title + "</span>";
        btn.addEventListener("click", () => setSeason(s.id));
        picker.appendChild(btn);
      });
    }

    document.querySelectorAll(".appearance-btn").forEach((btn) => {
      btn.addEventListener("click", () => setNightMode(btn.getAttribute("data-night")));
    });

    document.getElementById("theme-trigger")?.addEventListener("click", openThemeModal);
    document.getElementById("theme-modal-close")?.addEventListener("click", closeThemeModal);
    document.getElementById("theme-modal-backdrop")?.addEventListener("click", closeThemeModal);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("theme-modal")?.hidden) closeThemeModal();
    });

    syncSeasonButtons();
    syncAppearanceButtons();
  }

  applyTheme();

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getNightMode() === "auto") applyTheme();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemeModal);
  } else {
    initThemeModal();
  }
})();
