/* ==========================================================================
   Tutor track - sign-in for the shared Google Sheet.
   A username + key is checked by the Apps Script (never by this page), then
   remembered in this browser until "Sign out".

   Usage, at the top of a page's script:
     if (!PaisaAuth.mount()) return;      // shows the sign-in screen when signed out
   ========================================================================== */

var PaisaAuth = (function () {
  "use strict";

  var AUTH_KEY = "gb5tracker.auth";
  var NOTE_KEY = "gb5tracker.authNote";
  var THEME_KEY = "gb5tracker.theme";
  var SHEET_URL_KEY = "gb5tuition.sheetUrl";
  var SHEET_TOKEN_KEY = "gb5tuition.sheetToken";
  var SETUP_CHOICE_KEY = "gb5tracker.setupChoice";

  // Pre-filled so every device reaches the shared sheet with no manual setup.
  // The sign-in below is what actually protects each person's rows.
  var DEFAULT_SHEET_URL = "https://script.google.com/macros/s/AKfycbzxe6u5_Y3zif8VihQEoYx0olkSEJizirWP_3AK-BOpjpgAuPcM5RyPREsKOG9FwRow1w/exec";
  var DEFAULT_SHEET_TOKEN = "77978f86-1f84-491b-b2ec-1b7e864edca8";

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }

  // ---- sheet connection (shared by the Tuition and Finance pages) ----

  function sheetConfig() {
    var url = read(SHEET_URL_KEY);
    var token = read(SHEET_TOKEN_KEY);
    // The baked-in sheet is only the fallback when this device hasn't
    // explicitly saved a different one.
    if (read(SETUP_CHOICE_KEY) !== "own") {
      if (!url) url = DEFAULT_SHEET_URL;
      if (!token) token = DEFAULT_SHEET_TOKEN;
    }
    return { url: url, token: token };
  }

  function saveSheetConfig(url, token) {
    write(SHEET_URL_KEY, url);
    write(SHEET_TOKEN_KEY, token);
    write(SETUP_CHOICE_KEY, "own");
  }

  // ---- session ----

  function session() {
    try {
      var s = JSON.parse(read(AUTH_KEY));
      if (s && s.user && s.key) return { user: String(s.user), key: String(s.key) };
    } catch (e) { /* no valid session */ }
    return null;
  }

  function scopedKey(base) {
    var s = session();
    return s ? base + "." + s.user : base;
  }

  function logout(note) {
    remove(AUTH_KEY);
    if (note) {
      try { sessionStorage.setItem(NOTE_KEY, note); } catch (e) { /* ignore */ }
    }
    location.reload();
  }

  // Pages call this on every sheet response; true means the sign-in was
  // rejected and the page is being sent back to the sign-in screen.
  function rejected(res) {
    if (res && res.ok === false && res.error === "invalid login") {
      logout("Your key was rejected. Please sign in again.");
      return true;
    }
    return false;
  }

  function verify(user, key) {
    var cfg = sheetConfig();
    if (!cfg.url || !cfg.token) return Promise.resolve({ ok: false, message: "No sheet is connected." });
    var url = cfg.url + (cfg.url.indexOf("?") === -1 ? "?" : "&") +
      "token=" + encodeURIComponent(cfg.token) +
      "&user=" + encodeURIComponent(user) +
      "&key=" + encodeURIComponent(key);
    return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.ok && data.auth === true) return { ok: true };
      if (data && data.ok) return { ok: false, message: "The sync script is out of date and can't check sign-ins yet." };
      if (data && data.error === "invalid login") return { ok: false, message: "Wrong username or key." };
      if (data && data.error === "too many attempts") return { ok: false, message: "Too many wrong attempts. Try again in 15 minutes." };
      if (data && data.error === "unauthorized") return { ok: false, message: "The sheet rejected this page's sync token." };
      return { ok: false, message: "Sign-in failed" + (data && data.error ? " (" + data.error + ")" : "") + "." };
    }).catch(function () {
      return { ok: false, message: "Couldn't reach the sheet. Check your connection and try again." };
    });
  }

  // ---- UI ----

  function applySavedTheme() {
    var saved = read(THEME_KEY);
    if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function field(labelText, input) {
    var label = el("label", "auth-field");
    label.appendChild(el("span", "", labelText));
    label.appendChild(input);
    return label;
  }

  function showSignIn() {
    applySavedTheme();

    var overlay = el("div", "auth-overlay");
    var form = el("form", "auth-card");
    form.setAttribute("novalidate", "");

    form.appendChild(el("span", "eyebrow", "Welcome"));
    form.appendChild(el("h2", "", "Sign in to Tutor track"));
    form.appendChild(el("p", "", "Enter your username and key. You'll stay signed in on this device until you press Sign out."));

    var userInput = el("input");
    userInput.type = "text";
    userInput.name = "username";
    userInput.autocomplete = "username";
    userInput.autocapitalize = "none";
    userInput.spellcheck = false;
    userInput.placeholder = "Username";

    var keyInput = el("input");
    keyInput.type = "password";
    keyInput.name = "key";
    keyInput.autocomplete = "current-password";
    keyInput.placeholder = "Key";

    var note = "";
    try { note = sessionStorage.getItem(NOTE_KEY) || ""; sessionStorage.removeItem(NOTE_KEY); } catch (e) { /* ignore */ }
    var error = el("div", "auth-error", note);
    error.setAttribute("role", "alert");

    var submit = el("button", "btn", "Sign in");
    submit.type = "submit";

    form.appendChild(field("Username", userInput));
    form.appendChild(field("Key", keyInput));
    form.appendChild(error);
    form.appendChild(submit);
    overlay.appendChild(form);
    document.body.appendChild(overlay);
    userInput.focus();

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var user = userInput.value.trim().toLowerCase();
      var key = keyInput.value;
      if (!user || !key) {
        error.textContent = "Enter both your username and key.";
        return;
      }
      error.textContent = "";
      submit.disabled = true;
      submit.textContent = "Checking...";
      verify(user, key).then(function (res) {
        if (res.ok) {
          write(AUTH_KEY, JSON.stringify({ user: user, key: key }));
          location.reload();
          return;
        }
        error.textContent = res.message;
        submit.disabled = false;
        submit.textContent = "Sign in";
        keyInput.select();
      });
    });
  }

  function showUserChip(user) {
    var actions = document.querySelector(".appbar-actions");
    if (!actions) return;
    var chip = el("span", "user-chip", user);
    chip.title = "Signed in as " + user;
    var out = el("button", "btn ghost small signout", "Sign out");
    out.type = "button";
    out.addEventListener("click", function () { logout(); });
    actions.insertBefore(out, actions.firstChild);
    actions.insertBefore(chip, actions.firstChild);
  }

  // Returns true when signed in (page should carry on), false after showing
  // the sign-in screen (page should stop).
  function mount() {
    var s = session();
    if (!s) {
      showSignIn();
      return false;
    }
    showUserChip(s.user);
    return true;
  }

  return {
    mount: mount,
    session: session,
    scopedKey: scopedKey,
    logout: logout,
    rejected: rejected,
    sheetConfig: sheetConfig,
    saveSheetConfig: saveSheetConfig
  };
})();
