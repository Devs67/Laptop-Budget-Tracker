/**
 * Backs the Tuition Log & Finance pages with a Google Sheet, with one login
 * (username + key) per person. Every row is tagged with its owner in a `user`
 * column and each person only ever reads or changes their own rows.
 * Deploy this as a Web App (Execute as: Me, Who has access: Anyone).
 * See SETUP.md in this folder for the full walkthrough.
 */

// Rows that have no `user` value (everything created before logins existed)
// belong to this person.
var OWNER_USER = "dev";

// People create their own account on the sign-in screen, but only with this
// code, so a stranger who finds the site can't sign up. Set it to something
// only you and your friends know. While it is "change-me", sign-up is off.
var INVITE_CODE = "change-me";

var STUDENTS_SHEET = "Students";
var SESSIONS_SHEET = "Sessions";
var FINANCE_SHEET = "Finance";
var LOANS_SHEET = "Loans";
var LOAN_PAYMENTS_SHEET = "LoanPayments";
var USERS_SHEET = "Users";
var SESSION_FIELDS = ["id", "childId", "date", "time", "durationMinutes", "amount", "note", "paid"];
var FINANCE_FIELDS = ["id", "date", "type", "category", "amount", "note"];
var MAX_FAILED_LOGINS = 5;
var LOCKOUT_SECONDS = 900;

function setup() {
  var token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty("SHARED_TOKEN", token);
  Logger.log("Your sync token (copy this into the Tuition page settings): " + token);
}

/**
 * Create a person, or reset their key. Edit the two values below, click Run,
 * then put them back to placeholders so the key doesn't sit in the code.
 */
function createOrResetUser() {
  var NAME = "friend";
  var KEY = "change-me";
  var user = normUser_(NAME);
  if (!user || !KEY) throw new Error("Set both NAME and KEY first.");
  var sheet = getUsersSheet_();
  var hash = hashKey_(user, KEY);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (normUser_(values[i][0]) === user) {
      sheet.getRange(i + 1, 2).setValue(hash);
      Logger.log("Updated key for: " + user);
      return;
    }
  }
  sheet.appendRow([user, hash]);
  Logger.log("Created user: " + user);
}

/** Sign-up from the sign-in screen: needs the invite code, creates the login. */
function register_(body) {
  if (!INVITE_CODE || INVITE_CODE === "change-me") return jsonOut_({ ok: false, error: "signup disabled" });

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get("fail:invite") || 0);
  if (fails >= MAX_FAILED_LOGINS) return jsonOut_({ ok: false, error: "too many attempts" });
  if (String((body.payload && body.payload.invite) || "") !== INVITE_CODE) {
    cache.put("fail:invite", String(fails + 1), LOCKOUT_SECONDS);
    return jsonOut_({ ok: false, error: "bad invite" });
  }

  var user = normUser_(body.user);
  var key = String(body.key || "");
  if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(user)) return jsonOut_({ ok: false, error: "invalid username" });
  if (key.length < 6) return jsonOut_({ ok: false, error: "key too short" });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (lockErr) {
    return jsonOut_({ ok: false, error: "busy, try again" });
  }
  try {
    var sheet = getUsersSheet_();
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (normUser_(values[i][0]) === user) return jsonOut_({ ok: false, error: "username taken" });
    }
    sheet.appendRow([user, hashKey_(user, key)]);
  } finally {
    lock.releaseLock();
  }
  return jsonOut_({ ok: true });
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty("SHARED_TOKEN") || "";
}

function checkToken_(token) {
  var expected = getToken_();
  return !!expected && token === expected;
}

function jsonOut_(obj) {
  obj.auth = true; // lets the pages tell this script apart from the pre-login version
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function normUser_(name) {
  return String(name || "").trim().toLowerCase();
}

function getSalt_() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty("KEY_SALT");
  if (!salt) {
    salt = Utilities.getUuid();
    props.setProperty("KEY_SALT", salt);
  }
  return salt;
}

function hashKey_(user, key) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    getSalt_() + ":" + user + ":" + key,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    return ("0" + (b & 0xff).toString(16)).slice(-2);
  }).join("");
}

function getUsersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET);
    sheet.appendRow(["user", "keyHash"]);
  }
  return sheet;
}

/** Returns { ok: true, user } or { ok: false, error }. */
function checkLogin_(rawUser, key) {
  var user = normUser_(rawUser);
  if (!user || !key) return { ok: false, error: "invalid login" };

  var cache = CacheService.getScriptCache();
  var failKey = "fail:" + user;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILED_LOGINS) return { ok: false, error: "too many attempts" };

  var values = getUsersSheet_().getDataRange().getValues();
  var expected = "";
  for (var i = 1; i < values.length; i++) {
    if (normUser_(values[i][0]) === user) { expected = String(values[i][1]); break; }
  }
  if (!expected || expected !== hashKey_(user, String(key))) {
    cache.put(failKey, String(fails + 1), LOCKOUT_SECONDS);
    return { ok: false, error: "invalid login" };
  }
  cache.remove(failKey);
  return { ok: true, user: user };
}

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet tab: " + name);
  return sheet;
}

/** 1-based column of the `user` header, added at the end of the tab if missing. */
function ensureUserColumn_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === "user") return i + 1;
  }
  var col = lastCol + 1;
  sheet.getRange(1, col).setValue("user");
  return col;
}

function rowOwner_(value) {
  return normUser_(value) || OWNER_USER;
}

function sheetToObjects_(sheet, user) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  // Trim only (not lowercase) so a stray trailing space doesn't silently break
  // the id->field mapping, while camelCase keys like "childId" still match exactly.
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var userIdx = headers.indexOf("user");
  return values.slice(1)
    .filter(function (r) { return r[0] !== "" && r[0] !== null; })
    .filter(function (r) { return rowOwner_(userIdx === -1 ? "" : r[userIdx]) === user; })
    .map(function (r) {
      var obj = {};
      headers.forEach(function (h, i) { if (h !== "user") obj[h] = r[i]; });
      return obj;
    });
}

/** Row number of this person's row with this id, or -1. */
function findRowIndexById_(sheet, id, user) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return -1;
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var userIdx = headers.indexOf("user");
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== String(id)) continue;
    if (rowOwner_(userIdx === -1 ? "" : values[i][userIdx]) === user) return i + 1;
  }
  return -1;
}

/** Appends a row, stamps the owner, and returns the new row number. */
function appendOwnedRow_(sheet, values, user) {
  var userCol = ensureUserColumn_(sheet);
  var row = values.slice();
  while (row.length < userCol) row.push("");
  row[userCol - 1] = user;
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkToken_(p.token || "")) return jsonOut_({ ok: false, error: "unauthorized" });
  var login = checkLogin_(p.user, p.key);
  if (!login.ok) return jsonOut_({ ok: false, error: login.error });
  var user = login.user;

  try {
    var students = sheetToObjects_(getSheet_(STUDENTS_SHEET), user);
    var sessions = sheetToObjects_(getSheet_(SESSIONS_SHEET), user);
    var finance = [];
    try { finance = sheetToObjects_(getSheet_(FINANCE_SHEET), user); } catch (fe) { finance = []; }
    var loans = [];
    try { loans = sheetToObjects_(getSheet_(LOANS_SHEET), user); } catch (le) { loans = []; }
    var loanPayments = [];
    try { loanPayments = sheetToObjects_(getSheet_(LOAN_PAYMENTS_SHEET), user); } catch (lpe) { loanPayments = []; }
    return jsonOut_({ ok: true, user: user, students: students, sessions: sessions, finance: finance, loans: loans, loanPayments: loanPayments });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: "bad json" });
  }
  if (!checkToken_(body.token)) return jsonOut_({ ok: false, error: "unauthorized" });
  if (body.action === "register") return register_(body);
  var login = checkLogin_(body.user, body.key);
  if (!login.ok) return jsonOut_({ ok: false, error: login.error });
  var user = login.user;

  var action = body.action;
  var payload = body.payload || {};

  // Two people saving at the same moment must not interleave appends, or a row
  // could be stamped with the wrong owner.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (lockErr) {
    return jsonOut_({ ok: false, error: "busy, try again" });
  }

  try {
    if (action === "addStudent") {
      appendOwnedRow_(getSheet_(STUDENTS_SHEET), [payload.id, payload.name, payload.rate], user);
    } else if (action === "updateStudent") {
      var shS = getSheet_(STUDENTS_SHEET);
      var rowS = findRowIndexById_(shS, payload.id, user);
      if (rowS === -1) return jsonOut_({ ok: false, error: "student not found" });
      if (payload.name !== undefined) shS.getRange(rowS, 2).setValue(payload.name);
      if (payload.rate !== undefined) shS.getRange(rowS, 3).setValue(payload.rate);
    } else if (action === "deleteStudent") {
      var shDS = getSheet_(STUDENTS_SHEET);
      var rowDS = findRowIndexById_(shDS, payload.id, user);
      if (rowDS !== -1) shDS.deleteRow(rowDS);
    } else if (action === "addSession") {
      var shAS = getSheet_(SESSIONS_SHEET);
      // Write date/time blank first, then force plain-text formatting so Sheets
      // doesn't silently convert "2026-08-10" / "16:00" into a Date serial.
      var newRow = appendOwnedRow_(shAS, [payload.id, payload.childId, "", "", payload.durationMinutes, payload.amount, payload.note, !!payload.paid], user);
      shAS.getRange(newRow, 3, 1, 2).setNumberFormat("@");
      shAS.getRange(newRow, 3).setValue(String(payload.date || ""));
      shAS.getRange(newRow, 4).setValue(String(payload.time || ""));
    } else if (action === "updateSession") {
      var shUS = getSheet_(SESSIONS_SHEET);
      var rowUS = findRowIndexById_(shUS, payload.id, user);
      if (rowUS === -1) return jsonOut_({ ok: false, error: "session not found" });
      SESSION_FIELDS.forEach(function (f, i) {
        if (payload[f] === undefined) return;
        var col = i + 1;
        if (f === "date" || f === "time") shUS.getRange(rowUS, col).setNumberFormat("@");
        shUS.getRange(rowUS, col).setValue(payload[f]);
      });
    } else if (action === "deleteSession") {
      var shDE = getSheet_(SESSIONS_SHEET);
      var rowDE = findRowIndexById_(shDE, payload.id, user);
      if (rowDE !== -1) shDE.deleteRow(rowDE);
    } else if (action === "addFinance") {
      var shAF = getSheet_(FINANCE_SHEET);
      var newRowF = appendOwnedRow_(shAF, [payload.id, "", payload.type, payload.category, payload.amount, payload.note], user);
      shAF.getRange(newRowF, 2).setNumberFormat("@");
      shAF.getRange(newRowF, 2).setValue(String(payload.date || ""));
    } else if (action === "updateFinance") {
      var shUF = getSheet_(FINANCE_SHEET);
      var rowUF = findRowIndexById_(shUF, payload.id, user);
      if (rowUF === -1) return jsonOut_({ ok: false, error: "finance entry not found" });
      FINANCE_FIELDS.forEach(function (f, i) {
        if (payload[f] === undefined) return;
        var col = i + 1;
        if (f === "date") shUF.getRange(rowUF, col).setNumberFormat("@");
        shUF.getRange(rowUF, col).setValue(payload[f]);
      });
    } else if (action === "deleteFinance") {
      var shDF = getSheet_(FINANCE_SHEET);
      var rowDF = findRowIndexById_(shDF, payload.id, user);
      if (rowDF !== -1) shDF.deleteRow(rowDF);
    } else if (action === "addLoan") {
      appendOwnedRow_(getSheet_(LOANS_SHEET), [payload.id, payload.name, payload.totalAmount, payload.monthlyPlan, payload.note], user);
    } else if (action === "deleteLoan") {
      var shDL = getSheet_(LOANS_SHEET);
      var rowDL = findRowIndexById_(shDL, payload.id, user);
      if (rowDL !== -1) shDL.deleteRow(rowDL);
    } else if (action === "addLoanPayment") {
      var shALP = getSheet_(LOAN_PAYMENTS_SHEET);
      var newRowLP = appendOwnedRow_(shALP, [payload.id, payload.loanId, "", payload.amount, payload.note], user);
      shALP.getRange(newRowLP, 3).setNumberFormat("@");
      shALP.getRange(newRowLP, 3).setValue(String(payload.date || ""));
    } else if (action === "deleteLoanPayment") {
      var shDLP = getSheet_(LOAN_PAYMENTS_SHEET);
      var rowDLP = findRowIndexById_(shDLP, payload.id, user);
      if (rowDLP !== -1) shDLP.deleteRow(rowDLP);
    } else {
      return jsonOut_({ ok: false, error: "unknown action" });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }

  return jsonOut_({ ok: true });
}
