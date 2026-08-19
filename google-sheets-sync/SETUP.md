# Google Sheet sync — setup

This connects the Tuition page to a Google Sheet so your sessions log is backed up in the cloud
and readable from any device, not just the browser you entered it in.

**How it works:** you deploy a small Google Apps Script as a Web App attached to your Sheet. The
Tuition page calls that Web App's URL to read and write rows. There's no sign-in prompt on the
page itself — access is controlled by a token you set once and paste into the page.

**Trust model, read before deploying:** the Web App is deployed with "Anyone" access, meaning
anyone who has both the deployment URL *and* your token could read or write the sheet. Neither
is guessable, but neither is truly secret either — treat this the same way you treat your private
GitHub Pages link. Don't post the deployment URL or token publicly.

## 1. Create the Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
   Name it whatever you like, e.g. "Tuition Log".
2. Rename the first tab to `Students`. In row 1, enter these headers exactly:
   ```
   id   name   rate
   ```
3. Add a second tab (bottom-left `+`) named `Sessions`. In row 1, enter these headers exactly:
   ```
   id   childId   date   time   durationMinutes   amount   note   paid
   ```
4. Add a third tab named `Finance`. In row 1, enter these headers exactly:
   ```
   id   date   type   category   amount   note
   ```
5. Leave all three tabs otherwise empty — the pages will populate them.

## 2. Add the script

1. In the Sheet, go to **Extensions → Apps Script**. A new tab opens with an empty `Code.gs`.
2. Delete the placeholder content and paste in the contents of [`Code.gs`](./Code.gs) from this
   folder.
3. Click the disk icon (or Ctrl+S) to save. Name the project anything, e.g. "Tuition Sync".

## 3. Generate your sync token

1. In the Apps Script editor, use the function dropdown (near the Run button) to select `setup`.
2. Click **Run**. The first time, it'll ask you to authorize the script — click through
   (Google will warn it's unverified since it's your own private script; click **Advanced →
   Go to Tuition Sync (unsafe)** → **Allow**).
3. Go to **Executions** (left sidebar, clock icon) or **View → Logs**, open the latest run, and
   copy the token it printed — a string like `8f14e45f-ceea-...`. Save it somewhere; you'll paste
   it into the Tuition page next.

## 4. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone
4. Click **Deploy**, authorize again if asked, then copy the **Web app URL** it gives you
   (ends in `/exec`).

## 5. Connect the Tuition page

1. Open `tuition.html`, scroll to **Settings → Google Sheet sync**.
2. Paste the Web app URL and the token from step 3.
3. Click **Connect & sync**. The status line should say "Synced just now."

From then on, every session or student change you make is pushed to the Sheet automatically, and
the page pulls the latest data from the Sheet each time it loads.

## Updating the script later

If you edit `Code.gs` again, you don't need a new deployment — use **Deploy → Manage deployments →
edit (pencil) → New version → Deploy** to update the existing URL in place.

## Already deployed and adding the Finances page?

If you set this up before the Finances page existed, do this once:

1. Add the `Finance` tab to your existing Sheet (step 4 above) with those exact headers.
2. In the Apps Script editor, replace the contents of `Code.gs` with the current version from
   this folder (it now has `addFinance` / `updateFinance` / `deleteFinance` actions and returns
   a `finance` array from `doGet`).
3. **Deploy → Manage deployments → pencil icon → New version → Deploy.** Same URL, same token —
   nothing to reconnect on any page.
