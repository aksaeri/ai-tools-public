// Tabs for "Get it", and the copy button for the build-your-own prompt.
// Without JavaScript every panel shows, each with its own heading.
(function () {
  var root = document.documentElement;
  root.classList.add("js");

  // Theme: System (no attribute), Light or Dark, remembered per browser.
  function current() { return root.dataset.theme || "system"; }
  function mark() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-set-theme]"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.setTheme === current() ? "true" : "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-set-theme]"), function (b) {
    b.addEventListener("click", function () {
      var v = b.dataset.setTheme;
      if (v === "system") delete root.dataset.theme; else root.dataset.theme = v;
      try { if (v === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", v); } catch (err) {}
      mark();
    });
  });
  mark();
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function select(t) {
    tabs.forEach(function (b) {
      var on = b === t;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach(function (b, i) {
    b.addEventListener("click", function () { select(b); });
    b.addEventListener("keydown", function (ev) {
      var d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      var n = tabs[(i + d + tabs.length) % tabs.length];
      select(n);
      n.focus();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".copy"), function (btn) {
    btn.addEventListener("click", function () {
      var pre = btn.parentNode.querySelector(".prompt");
      var msg = btn.parentNode.parentNode.querySelector(".copied");
      function fallback() {
        var r = document.createRange();
        r.selectNodeContents(pre);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        if (msg) msg.textContent = "Selected. Press Ctrl+C or Cmd+C to copy.";
      }
      try {
        navigator.clipboard.writeText(pre.textContent).then(function () {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1500);
        }, fallback);
      } catch (err) { fallback(); }
    });
  });
})();
