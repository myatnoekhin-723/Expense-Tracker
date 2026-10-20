# 💰 My Expense Tracker

A simple, colorful personal expense tracker for Myanmar Kyat (Ks).
Plain HTML + CSS + JavaScript: no framework, no server, no build step.

## How to run

1. Open `index.html` in a browser (double-click it). Chrome, Edge or Safari work best.
2. That's it. Your data is saved automatically in the browser's **localStorage**.

> You need an internet connection the first time so the browser can load **Chart.js** (charts),
> **SheetJS** (Excel) and the Nunito font from their CDNs. After that the browser usually caches them.

⚠️ Data lives only in this browser on this device. Clearing browser data deletes it,
so click **💾 Backup** now and then to save a `.json` copy.

## Files

| File         | What it does                                              |
|--------------|-----------------------------------------------------------|
| `index.html` | Page layout: header, 3 tabs, dialog                       |
| `style.css`  | Colors (light and dark), cards, tables, mobile layout     |
| `app.js`     | Data layer, tabs, dashboard and charts, import and export |

## Tabs

- **🧾 Expenses**: quick-add form (press Enter to add), table newest first, ✏️ edit / 🗑️ delete,
  search, month and category filters, and the total of the filtered rows.
  Typing an item you used before picks its category for you.
- **📊 Dashboard**: month picker (‹ ›) or **Year overview**. It shows summary cards
  (Income, Expense, Balance Left = Income − Expense, Saving, Daily average excluding Saving),
  4 charts, insights, a table like the "Monthly Dashboard" sheet (Mar–Dec, 👑 marks the top category of each month)
  and an optional monthly budget per category (orange at 80%, red above 100%).
- **💵 Income**: add form, monthly totals (tap a month to filter), and a table with edit and delete.

## Importing your Excel file

1. Click **📥 Import Excel** in the header and choose your `.xlsx` file.
2. The app reads these sheets (names are not case-sensitive):
   - **Expenses**: columns `Timestamp, Date, Category, Item Name, Amount`
     (if `Date` is empty, the date part of `Timestamp` is used)
   - **Income**: columns `Date, Category, Amount, Description`
3. During import:
   - Empty rows are skipped. Rows without a valid date or with an amount ≤ 0 are skipped and counted.
   - Category names are trimmed and matched to the fixed categories
     (e.g. `"Food "` → Food, `"Transportation"` → Transport, `"Health & Beauty"` → Health/Beauty).
     Anything unknown becomes **Other**.
   - **Duplicates are skipped.** A row with the same date, category, item and amount as a saved row is
     not added again, so importing the same file twice is safe. Two real identical purchases in the file
     (e.g. two coffees on one day) are both kept.
   - If sample data is still there, the app first asks whether to remove it.
4. A summary shows how many rows were added and skipped.

Tip: if your sheet has a title row above the headers, that's fine. The app looks for the row that contains "Amount".

## Export and backup

- **📤 Export Excel** downloads an `.xlsx` file with `Expenses`, `Income` and `Monthly Dashboard <year>` sheets.
  The Expenses and Income sheets use the same columns as the import, so you can re-import the file.
- **💾 Backup** downloads all data (including budgets) as `.json`.
- **♻️ Restore** loads a `.json` backup and **replaces** current data, after asking you to confirm.

## ☁️ Google Sheets sync (optional)

The app can keep your data in a Google Sheet through an Apps Script **Web App**. With sync on, the
**sheet is the main copy**. The app still saves everything in localStorage, so it opens fast and works offline.

### Setup

1. In your Google Sheet, open **Extensions → Apps Script** and make sure the script is deployed:
   **Deploy → New deployment → Web app**, with
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (needed so the browser can reach it without a Google login)
2. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/…/exec`.
3. In the tracker, click **⚙️ Settings** in the header, then paste the **Web App URL** and your **Token**.
4. Click **💾 Save & sync**. The status in the header should change to **✅ Synced**.

The URL and token are stored **only in this browser's localStorage**. They are not in the code,
so they won't end up in a shared copy of these files. Anyone who can use this browser profile can see them in ⚙️ Settings.
To disconnect, open ⚙️ Settings and click **Turn off sync**.

If you redeploy the script as a *new deployment*, the URL changes. Paste the new one in ⚙️ Settings.

### How it works

| When | What the app does |
|------|-------------------|
| App opens / **🔄 Sync** clicked | `GET {url}?token={token}` and **replaces** local expenses and income with the reply |
| Add expense / income | Saves locally first, then `POST {token, action: "addExpense" \| "addIncome", ...fields}`, then syncs again |
| Delete | `POST {token, action: "deleteExpense" \| "deleteIncome", id}`, then syncs again |
| Edit | The API has no "update", so an edit is sent as **add new + delete old** (the edited row moves to the bottom of the sheet) |
| Offline / request fails | The change waits in a **pending queue** (saved in localStorage). The header shows "⏳ N waiting to sync" and the row shows ⏳. It retries automatically when the network comes back, and every minute while changes are waiting |

- POSTs use `Content-Type: text/plain` so the browser doesn't send a CORS preflight (Apps Script can't answer one).
- `id` is the **sheet row number**. Row numbers shift when a row is deleted, so before each delete the app
  fetches the sheet again and finds the row by its content (date, category, item/description, amount).
  This way a stale row number never deletes the wrong row.
- Status in the header: **✅ Synced**, **🔄 Syncing…**, **⚠️ Offline** or **⚠️ Sync problem**, plus "Last synced: time".
- **Budgets** are not synced. They stay in this browser.
- **📥 Import Excel** with sync on uploads the new (non-duplicate) rows to the sheet in the background, one request per row.
- **♻️ Restore** is disabled while sync is on, because the next sync would overwrite it. Turn sync off first.
- If a change keeps failing (e.g. the script rejects it), open ⚙️ Settings and click **Discard** next to the waiting changes.

### Expected API (what your Apps Script must return)

```jsonc
// GET {url}?token=…
{ "expenses": [ { "id": 2, "date": "2026-10-19", "category": "Food", "item": "Coffee", "amount": 4500 } ],
  "income":   [ { "id": 2, "date": "2026-10-01", "category": "Salary", "amount": 800000, "description": "Oct" } ] }

// Errors: any reply like { "error": "…" } or { "ok": false, "message": "…" }.
// An error message mentioning "token", "unauthorized", "forbidden" or "denied" is shown as "Wrong token".
```

Dates can be `YYYY-MM-DD` or the ISO strings Apps Script makes from date cells (`2026-10-18T17:30:00.000Z`).
ISO dates are converted back to your local day.

### Troubleshooting

| Message | Fix |
|---------|-----|
| 🔒 Google asked for a sign-in (HTTP 401/403) | The deployment isn't public. Go to **Deploy → Manage deployments → ✏️ Edit**, set *Who has access* to **Anyone** and *Version* to **New version**, then **Deploy** (the URL stays the same). If "Anyone" isn't offered, your Workspace admin blocks public web apps. Ask them, or deploy from a personal Gmail account |
| 🔑 Wrong token | Re-enter the token in ⚙️ Settings exactly as it is set in the script |
| Can't reach Google Sheets | Check your internet; check the script is deployed with access **Anyone**; check the URL ends in `/exec` |
| That URL didn't return expense data | You pasted the editor URL or a `/dev` URL. Use the deployment's `/exec` URL |
| 📡 No internet | Nothing to do. Changes are kept and sync automatically when you're back online |

## Sample data

The first time you open the app, it adds 15 sample expenses and 3 sample income entries
from the last few weeks so the dashboard isn't empty.
Click **🧹 Clear sample data** in the yellow banner to remove them. Your own entries are kept.

## Customizing

Categories, emojis and colors are in the `CATEGORIES` list at the top of `app.js`.
The dashboard table starts in March (`DASH_FIRST_MONTH`). If you have data in Jan or Feb, those months are shown too.
