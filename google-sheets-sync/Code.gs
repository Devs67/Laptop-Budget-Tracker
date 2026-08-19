/**
 * Backs the Tuition Log & Invoices page with a Google Sheet.
 * Deploy this as a Web App (Execute as: Me, Who has access: Anyone).
 * See SETUP.md in this folder for the full walkthrough.
 */

var STUDENTS_SHEET = "Students";
var SESSIONS_SHEET = "Sessions";
var FINANCE_SHEET = "Finance";
var SESSION_FIELDS = ["id", "childId", "date", "time", "durationMinutes", "amount", "note", "paid"];
var FINANCE_FIELDS = ["id", "date", "type", "category", "amount", "note"];

function setup() {
  var token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty("SHARED_TOKEN", token);
  Logger.log("Your sync token (copy this into the Tuition page settings): " + token);
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty("SHARED_TOKEN") || "";
}

function checkToken_(token) {
  var expected = getToken_();
  return !!expected && token === expected;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet tab: " + name);
  return sheet;
}

function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1)
    .filter(function (r) { return r[0] !== "" && r[0] !== null; })
    .map(function (r) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = r[i]; });
      return obj;
    });
}

function findRowIndexById_(sheet, id) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function doGet(e) {
  var token = (e && e.parameter && e.parameter.token) || "";
  if (!checkToken_(token)) return jsonOut_({ ok: false, error: "unauthorized" });

  try {
    var students = sheetToObjects_(getSheet_(STUDENTS_SHEET));
    var sessions = sheetToObjects_(getSheet_(SESSIONS_SHEET));
    var finance = [];
    try { finance = sheetToObjects_(getSheet_(FINANCE_SHEET)); } catch (fe) { finance = []; }
    return jsonOut_({ ok: true, students: students, sessions: sessions, finance: finance });
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

  var action = body.action;
  var payload = body.payload || {};

  try {
    if (action === "addStudent") {
      getSheet_(STUDENTS_SHEET).appendRow([payload.id, payload.name, payload.rate]);
    } else if (action === "updateStudent") {
      var shS = getSheet_(STUDENTS_SHEET);
      var rowS = findRowIndexById_(shS, payload.id);
      if (rowS === -1) return jsonOut_({ ok: false, error: "student not found" });
      if (payload.name !== undefined) shS.getRange(rowS, 2).setValue(payload.name);
      if (payload.rate !== undefined) shS.getRange(rowS, 3).setValue(payload.rate);
    } else if (action === "deleteStudent") {
      var shDS = getSheet_(STUDENTS_SHEET);
      var rowDS = findRowIndexById_(shDS, payload.id);
      if (rowDS !== -1) shDS.deleteRow(rowDS);
    } else if (action === "addSession") {
      var shAS = getSheet_(SESSIONS_SHEET);
      // Write date/time blank first, then force plain-text formatting so Sheets
      // doesn't silently convert "2026-08-10" / "16:00" into a Date serial.
      shAS.appendRow([payload.id, payload.childId, "", "", payload.durationMinutes, payload.amount, payload.note, !!payload.paid]);
      var newRow = shAS.getLastRow();
      shAS.getRange(newRow, 3, 1, 2).setNumberFormat("@");
      shAS.getRange(newRow, 3).setValue(String(payload.date || ""));
      shAS.getRange(newRow, 4).setValue(String(payload.time || ""));
    } else if (action === "updateSession") {
      var shUS = getSheet_(SESSIONS_SHEET);
      var rowUS = findRowIndexById_(shUS, payload.id);
      if (rowUS === -1) return jsonOut_({ ok: false, error: "session not found" });
      SESSION_FIELDS.forEach(function (f, i) {
        if (payload[f] === undefined) return;
        var col = i + 1;
        if (f === "date" || f === "time") shUS.getRange(rowUS, col).setNumberFormat("@");
        shUS.getRange(rowUS, col).setValue(payload[f]);
      });
    } else if (action === "deleteSession") {
      var shDE = getSheet_(SESSIONS_SHEET);
      var rowDE = findRowIndexById_(shDE, payload.id);
      if (rowDE !== -1) shDE.deleteRow(rowDE);
    } else if (action === "addFinance") {
      var shAF = getSheet_(FINANCE_SHEET);
      shAF.appendRow([payload.id, "", payload.type, payload.category, payload.amount, payload.note]);
      var newRowF = shAF.getLastRow();
      shAF.getRange(newRowF, 2).setNumberFormat("@");
      shAF.getRange(newRowF, 2).setValue(String(payload.date || ""));
    } else if (action === "updateFinance") {
      var shUF = getSheet_(FINANCE_SHEET);
      var rowUF = findRowIndexById_(shUF, payload.id);
      if (rowUF === -1) return jsonOut_({ ok: false, error: "finance entry not found" });
      FINANCE_FIELDS.forEach(function (f, i) {
        if (payload[f] === undefined) return;
        var col = i + 1;
        if (f === "date") shUF.getRange(rowUF, col).setNumberFormat("@");
        shUF.getRange(rowUF, col).setValue(payload[f]);
      });
    } else if (action === "deleteFinance") {
      var shDF = getSheet_(FINANCE_SHEET);
      var rowDF = findRowIndexById_(shDF, payload.id);
      if (rowDF !== -1) shDF.deleteRow(rowDF);
    } else {
      return jsonOut_({ ok: false, error: "unknown action" });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }

  return jsonOut_({ ok: true });
}
