'use strict';
/* =========================================================
   Personal Expense Tracker — plain JavaScript
   Order: constants → helpers → data layer → expenses tab →
   income tab → dashboard → import/export → dialogs → init
   ========================================================= */

/* ---------- Constants ---------- */
const CATEGORIES = [
  { name: 'Food',          emoji: '🍜',       color: '#FF6B6B' },
  { name: 'Transport',     emoji: '🚌',       color: '#4D96FF' },
  { name: 'Shopping',      emoji: '🛍️',       color: '#9B5DE5' },
  { name: 'Health/Beauty', emoji: '💄',       color: '#F15BB5' },
  { name: 'Family Care',   emoji: '👨‍👩‍👧', color: '#FFA94D' },
  { name: 'Internet Bill', emoji: '🌐',       color: '#2EC4B6' },
  { name: 'Saving',        emoji: '🐷',       color: '#6BCB77' },
  { name: 'Other',         emoji: '📦',       color: '#9AA0B5' },
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.name, c]));
const INCOME_COLOR = '#20C997';
const EXPENSE_COLOR = '#FF6B6B';
const LINE_COLOR = '#7C5CFF';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DASH_FIRST_MONTH = 3;              // dashboard table starts in March, like the sheet
const STORE_KEY = 'expenseTracker.data.v1';
const PREF_KEY = 'expenseTracker.prefs';
const SYNC_KEY = 'expenseTracker.sync';        // { url, token, lastSynced } — entered in ⚙️ Settings
const QUEUE_KEY = 'expenseTracker.pending';    // changes waiting to be sent to Google Sheets

/* ---------- Small helpers ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const pad = n => String(n).padStart(2, '0');
const fmtNum = n => Math.round(n || 0).toLocaleString('en-US');
const fmtKs = n => `${fmtNum(n)} Ks`;
const sumAmount = rows => rows.reduce((t, r) => t + r.amount, 0);
const catOf = name => CAT[name] || CAT.Other;
const monthOf = date => date.slice(0, 7);
const inPeriod = (rows, prefix) => rows.filter(r => r.date.startsWith(prefix));
const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0);

function ymd(y, m, d) {
  y = +y; m = +m; d = +d;
  if (!(y > 1900) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}
const localYmd = date => ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
const todayStr = () => localYmd(new Date());
const thisMonth = () => todayStr().slice(0, 7);

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[+m - 1]} ${y}`;
}
function fmtDate(date) {
  const [y, m, d] = date.split('-');
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localYmd(d);
}
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** 1500000 → "1.5M", 25000 → "25K" (chart axes) */
function shortNum(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(v);
}
/** Sum amounts grouped by keyFn(row) → { key: total } */
function totalsBy(rows, keyFn) {
  const out = {};
  rows.forEach(r => { const k = keyFn(r); out[k] = (out[k] || 0) + r.amount; });
  return out;
}
function badge(name) {
  const c = catOf(name);
  return `<span class="badge" style="--c:${c.color}">${c.emoji} ${escapeHtml(name)}</span>`;
}
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

let toastTimer;
function toast(msg, type = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/* =========================================================
   Data layer (localStorage)
   ========================================================= */
let state = { expenses: [], income: [], budgets: {} };
let prefs = {};

function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (err) { console.warn(err); }
  if (raw === null) {                       // first visit → sample data
    state = { expenses: sampleExpenses(), income: sampleIncome(), budgets: {} };
    saveState();
    return;
  }
  try {
    state = normalizeState(JSON.parse(raw));
  } catch (err) {
    console.error('Saved data is corrupted', err);
    try { localStorage.setItem(`${STORE_KEY}.corrupt`, raw); } catch (e) { /* ignore */ }
    toast('Saved data could not be read — a copy was kept', 'error');
  }
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (err) { toast('Could not save — browser storage is full or blocked', 'error'); }
}

function loadPrefs() {
  try { prefs = JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (err) { prefs = {}; }
}
function savePref(key, value) {
  prefs[key] = value;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (err) { /* ignore */ }
}

/** Clean any loaded/restored data so the rest of the app can trust it */
function normalizeState(d) {
  const expenses = (Array.isArray(d?.expenses) ? d.expenses : []).map(cleanExpense).filter(Boolean);
  const income = (Array.isArray(d?.income) ? d.income : []).map(cleanIncome).filter(Boolean);
  const budgets = {};
  Object.entries(d?.budgets || {}).forEach(([k, v]) => { if (CAT[k] && +v > 0) budgets[k] = Math.round(+v); });
  return { expenses, income, budgets };
}
function cleanBase(r) {
  const amount = Math.round(+r?.amount);
  if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !(amount > 0)) return null;
  return { id: r.id || uid(), date: r.date, amount, created: +r.created || Date.now(), sample: !!r.sample, pending: !!r.pending };
}
function cleanExpense(r) {
  const base = cleanBase(r);
  return base && { ...base, category: matchCategory(r.category), item: String(r.item ?? '').trim() };
}
function cleanIncome(r) {
  const base = cleanBase(r);
  return base && { ...base, category: String(r.category ?? '').trim() || 'Other', description: String(r.description ?? '').trim() };
}

/** Map free text ("transportation ", "Health & Beauty") to one of the fixed categories */
function matchCategory(raw) {
  const key = String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return 'Other';
  const exact = CATEGORIES.find(c => c.name.toLowerCase().replace(/[^a-z]/g, '') === key);
  if (exact) return exact.name;
  if (key.length < 4) return 'Other';
  const loose = CATEGORIES.find(c => {
    const k = c.name.toLowerCase().replace(/[^a-z]/g, '');
    return k.startsWith(key) || key.startsWith(k.slice(0, 6));
  });
  return loose ? loose.name : 'Other';
}

/** Add (no id) or update (with id) a record in 'expenses' / 'income' */
function upsert(listName, data, id) {
  const list = state[listName];
  if (id) {
    const i = list.findIndex(r => r.id === id);
    if (i >= 0) list[i] = { ...list[i], ...data, sample: false };
  } else {
    list.push({ id: uid(), created: Date.now(), sample: false, ...data });
  }
  saveState();
}
function removeRecord(listName, id) {
  state[listName] = state[listName].filter(r => r.id !== id);
  saveState();
}
const hasSample = () => state.expenses.some(r => r.sample) || state.income.some(r => r.sample);
function clearSampleData() {
  state.expenses = state.expenses.filter(r => !r.sample);
  state.income = state.income.filter(r => !r.sample);
  saveState();
}

/* ---------- Sample data (relative to today so the dashboard has something to show) ---------- */
function sampleExpenses() {
  const rows = [
    [0, 'Food', 'Mohinga breakfast', 3000],
    [1, 'Transport', 'Grab taxi', 8500],
    [2, 'Food', 'Coffee', 4500],
    [4, 'Shopping', 'New T-shirt', 25000],
    [6, 'Health/Beauty', 'Sunscreen', 18000],
    [8, 'Family Care', 'Medicine for Mom', 35000],
    [10, 'Internet Bill', 'Home WiFi', 30000],
    [12, 'Saving', 'Monthly saving', 150000],
    [14, 'Food', 'Coffee', 4500],
    [20, 'Transport', 'Bus card top-up', 5000],
    [24, 'Food', 'Groceries', 45000],
    [28, 'Shopping', 'Running shoes', 60000],
    [32, 'Other', 'Birthday gift', 20000],
    [38, 'Internet Bill', 'Home WiFi', 30000],
    [42, 'Saving', 'Monthly saving', 150000],
  ];
  return rows.map(([ago, category, item, amount], i) => ({
    id: uid(), date: daysAgo(ago), category, item, amount, created: Date.now() - i, sample: true,
  }));
}
function sampleIncome() {
  const cur = thisMonth(), prev = shiftMonth(cur, -1);
  const rows = [
    [`${cur}-01`, 'Salary', 800000, 'Monthly salary'],
    [`${prev}-01`, 'Salary', 800000, 'Monthly salary'],
    [`${prev}-15`, 'Ko Ko', 100000, 'Support from Ko Ko'],
  ];
  return rows.map(([date, category, amount, description], i) => ({
    id: uid(), date, category, amount, description, created: Date.now() - i, sample: true,
  }));
}

/* =========================================================
   Tabs & global refresh
   ========================================================= */
let currentTab = 'dashboard';

function showTab(name) {
  currentTab = name;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => { p.hidden = p.id !== `tab-${name}`; });
  savePref('tab', name);
  renderTab(name);
}
function renderTab(name) {
  if (name === 'expenses') renderExpenses();
  else if (name === 'income') renderIncome();
  else renderDashboard();
}
/** Re-render whatever is visible after data changes */
function refresh() {
  $('#sampleBanner').hidden = !hasSample();
  renderTab(currentTab);
}

function showFormError(sel, msg) { $(sel).textContent = msg ? `⚠️ ${msg}` : ''; }
function validateRecord(rec, textField, textLabel) {
  if (!rec.date) return 'Please choose a date.';
  if (!(rec.amount > 0)) return 'Amount must be greater than 0.';
  if (textField && !rec[textField]) return `Please enter ${textLabel}.`;
  return '';
}
const pendingMark = r => (r.pending ? '<span class="pending-dot" title="Waiting to sync to Google Sheets">⏳</span>' : '');
function emptyRow(cols, msg) { return `<tr class="empty-row"><td colspan="${cols}">${msg}</td></tr>`; }
function actionButtons(id) {
  return `<button class="icon-btn" data-edit="${id}" title="Edit">✏️</button><button class="icon-btn" data-del="${id}" title="Delete">🗑️</button>`;
}

/* =========================================================
   Tab 1 — Expenses
   ========================================================= */
let editingExpense = null;

function fillCategorySelects() {
  const opts = CATEGORIES.map(c => `<option value="${c.name}">${c.emoji} ${c.name}</option>`).join('');
  $('#expCategory').innerHTML = opts;
  $('#expCatFilter').innerHTML = `<option value="">All categories</option>${opts}`;
}

function readExpenseForm() {
  return {
    date: $('#expDate').value,
    category: $('#expCategory').value,
    item: $('#expItem').value.trim(),
    amount: Math.round(Number($('#expAmount').value)),
  };
}

function onExpenseSubmit(e) {
  e.preventDefault();
  const rec = readExpenseForm();
  const err = validateRecord(rec, 'item', 'an item name');
  showFormError('#expError', err);
  if (err) return;
  const wasEditing = !!editingExpense;
  if (!saveRecord('expenses', rec, editingExpense)) return;
  toast(wasEditing ? '✏️ Expense updated' : `✅ Added ${rec.item} · ${fmtKs(rec.amount)}`);
  resetExpenseForm(wasEditing);   // keep date & category for fast entry of the next item
  refresh();
}

function resetExpenseForm(full) {
  editingExpense = null;
  $('#expItem').value = '';
  $('#expAmount').value = '';
  if (full) {
    $('#expDate').value = todayStr();
    $('#expCategory').value = CATEGORIES[0].name;
  }
  $('#expFormTitle').textContent = '➕ Quick add expense';
  $('#expSubmit').textContent = '➕ Add';
  $('#expCancel').hidden = true;
  $('#expenseForm').classList.remove('editing');
  showFormError('#expError', '');
  $('#expItem').focus();
}

function startEditExpense(id) {
  const r = state.expenses.find(x => x.id === id);
  if (!r) return;
  editingExpense = id;
  $('#expDate').value = r.date;
  $('#expCategory').value = r.category;
  $('#expItem').value = r.item;
  $('#expAmount').value = r.amount;
  $('#expFormTitle').textContent = '✏️ Edit expense';
  $('#expSubmit').textContent = '💾 Save';
  $('#expCancel').hidden = false;
  $('#expenseForm').classList.add('editing');
  $('#expenseForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#expAmount').focus({ preventScroll: true });
}

async function deleteExpense(id) {
  const r = state.expenses.find(x => x.id === id);
  if (!r) return;
  const ok = await confirmBox({
    title: '🗑️ Delete this expense?',
    message: `<b>${escapeHtml(r.item || '(no name)')}</b> ${badge(r.category)}<br>${fmtKs(r.amount)} on ${fmtDate(r.date)}<p class="muted">This cannot be undone.</p>`,
    ok: 'Delete', danger: true,
  });
  if (!ok) return;
  deleteRecord('expenses', id);
  if (editingExpense === id) resetExpenseForm(true);
  refresh();
  toast('🗑️ Expense deleted');
}

function filteredExpenses() {
  const q = $('#expSearch').value.trim().toLowerCase();
  const month = $('#expMonth').value;
  const cat = $('#expCatFilter').value;
  return state.expenses
    .filter(r => (!q || r.item.toLowerCase().includes(q))
      && (!month || monthOf(r.date) === month)
      && (!cat || r.category === cat))
    .sort(byNewest);
}

function expenseRow(r) {
  return `<tr>
    <td class="c-date">${fmtDate(r.date)}</td>
    <td class="c-cat">${badge(r.category)}</td>
    <td class="c-item">${escapeHtml(r.item) || '<span class="muted">(no name)</span>'}${pendingMark(r)}</td>
    <td class="num c-amt">${fmtNum(r.amount)}</td>
    <td class="c-act">${actionButtons(r.id)}</td>
  </tr>`;
}

function renderExpenses() {
  const rows = filteredExpenses();
  const msg = state.expenses.length ? 'No expenses match your filters 🔍' : 'No expenses yet — add your first one above! 🎉';
  $('#expTable tbody').innerHTML = rows.length ? rows.map(expenseRow).join('') : emptyRow(5, msg);
  $('#expCount').textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
  $('#expTotal').textContent = `Total: ${fmtKs(sumAmount(rows))}`;
  renderItemSuggestions();
}

/** Autocomplete list of item names already used */
function renderItemSuggestions() {
  const names = [...new Set([...state.expenses].sort(byNewest).map(r => r.item).filter(Boolean))].slice(0, 200);
  $('#itemSuggestions').innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join('');
}

/** Picking a known item name pre-selects its last category */
function autoCategoryFromItem() {
  if (editingExpense) return;
  const name = $('#expItem').value.trim().toLowerCase();
  const last = [...state.expenses].sort(byNewest).find(r => r.item.toLowerCase() === name);
  if (last) $('#expCategory').value = last.category;
}

/* =========================================================
   Tab 3 — Income
   ========================================================= */
let editingIncome = null;

function readIncomeForm() {
  return {
    date: $('#incDate').value,
    category: $('#incCategory').value.trim(),
    amount: Math.round(Number($('#incAmount').value)),
    description: $('#incDesc').value.trim(),
  };
}

function onIncomeSubmit(e) {
  e.preventDefault();
  const rec = readIncomeForm();
  const err = validateRecord(rec, 'category', 'a category (e.g. Salary)');
  showFormError('#incError', err);
  if (err) return;
  const wasEditing = !!editingIncome;
  if (!saveRecord('income', rec, editingIncome)) return;
  toast(wasEditing ? '✏️ Income updated' : `✅ Added ${rec.category} · ${fmtKs(rec.amount)}`);
  resetIncomeForm(wasEditing);
  refresh();
}

function resetIncomeForm(full) {
  editingIncome = null;
  $('#incAmount').value = '';
  $('#incDesc').value = '';
  if (full) {
    $('#incDate').value = todayStr();
    $('#incCategory').value = '';
  }
  $('#incFormTitle').textContent = '➕ Add income';
  $('#incSubmit').textContent = '➕ Add';
  $('#incCancel').hidden = true;
  $('#incomeForm').classList.remove('editing');
  showFormError('#incError', '');
}

function startEditIncome(id) {
  const r = state.income.find(x => x.id === id);
  if (!r) return;
  editingIncome = id;
  $('#incDate').value = r.date;
  $('#incCategory').value = r.category;
  $('#incAmount').value = r.amount;
  $('#incDesc').value = r.description;
  $('#incFormTitle').textContent = '✏️ Edit income';
  $('#incSubmit').textContent = '💾 Save';
  $('#incCancel').hidden = false;
  $('#incomeForm').classList.add('editing');
  $('#incomeForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#incAmount').focus({ preventScroll: true });
}

async function deleteIncome(id) {
  const r = state.income.find(x => x.id === id);
  if (!r) return;
  const ok = await confirmBox({
    title: '🗑️ Delete this income?',
    message: `<b>${escapeHtml(r.category)}</b> ${escapeHtml(r.description)}<br>${fmtKs(r.amount)} on ${fmtDate(r.date)}<p class="muted">This cannot be undone.</p>`,
    ok: 'Delete', danger: true,
  });
  if (!ok) return;
  deleteRecord('income', id);
  if (editingIncome === id) resetIncomeForm(true);
  refresh();
  toast('🗑️ Income deleted');
}

function incomeRow(r) {
  return `<tr>
    <td class="c-date">${fmtDate(r.date)}</td>
    <td class="c-cat"><span class="badge" style="--c:${INCOME_COLOR}">💵 ${escapeHtml(r.category)}</span></td>
    <td class="c-item">${escapeHtml(r.description) || '<span class="muted">—</span>'}${pendingMark(r)}</td>
    <td class="num c-amt">${fmtNum(r.amount)}</td>
    <td class="c-act">${actionButtons(r.id)}</td>
  </tr>`;
}

function renderIncome() {
  const month = $('#incMonth').value;
  const rows = state.income.filter(r => !month || monthOf(r.date) === month).sort(byNewest);
  const msg = month ? `No income in ${monthLabel(month)} yet.` : 'No income yet — add your salary above! 💵';
  $('#incTable tbody').innerHTML = rows.length ? rows.map(incomeRow).join('') : emptyRow(5, msg);
  $('#incTotalLabel').textContent = month ? `Total for ${monthLabel(month)}` : 'Total (all months)';
  $('#incTotal').textContent = fmtKs(sumAmount(rows));
  renderIncomeMonthChips(month);
  renderIncomeCategories();
}

function renderIncomeMonthChips(active) {
  const totals = totalsBy(state.income, r => monthOf(r.date));
  const months = Object.keys(totals).sort().reverse();
  $('#incMonths').innerHTML = months.length
    ? months.map(m => `<button type="button" class="month-chip ${m === active ? 'active' : ''}" data-month="${m}"><span>${monthLabel(m)}</span><b>${fmtNum(totals[m])} Ks</b></button>`).join('')
    : '<span class="muted">No income yet.</span>';
}

function renderIncomeCategories() {
  const cats = new Set(['Salary', 'Ko Ko', 'Saving', ...state.income.map(r => r.category)]);
  $('#incCatList').innerHTML = [...cats].map(c => `<option value="${escapeHtml(c)}">`).join('');
}

/* =========================================================
   Tab 2 — Monthly Dashboard
   ========================================================= */

/** Current dashboard period: selected month or whole year */
function dashState() {
  const ym = $('#dashMonth').value || thisMonth();
  const year = ym.slice(0, 4);
  const yearMode = $('#yearToggle').checked;
  return { ym, year, yearMode, prefix: yearMode ? year : ym, label: yearMode ? `Year ${year}` : monthLabel(ym) };
}

/** Months shown in the table/charts: Mar–Dec (earlier if there is data in Jan/Feb) */
function dashMonths(year) {
  const used = [...state.expenses, ...state.income].filter(r => r.date.startsWith(year)).map(r => +r.date.slice(5, 7));
  const first = Math.min(DASH_FIRST_MONTH, ...used);
  return Array.from({ length: 13 - first }, (_, i) => `${year}-${pad(first + i)}`);
}
const shortMonth = ym => MONTHS[+ym.slice(5) - 1];

function renderDashboard() {
  const p = dashState();
  const exp = inPeriod(state.expenses, p.prefix);
  const inc = inPeriod(state.income, p.prefix);
  $$('.period-label').forEach(el => { el.textContent = p.label; });
  $('#tableYear').textContent = p.year;
  renderStatCards(p, exp, inc);
  renderInsights(p, exp);
  renderMonthTable(p);
  renderBudgets(p.ym);
  renderCharts(p, exp);
}

/* ---------- Summary cards ---------- */
function renderStatCards(p, exp, inc) {
  const income = sumAmount(inc);
  const expense = sumAmount(exp);
  const balance = income - expense;
  const saving = sumAmount(exp.filter(r => r.category === 'Saving'));
  const days = countedDays(p);
  const pctOfIncome = v => (income ? `${Math.round(v / income * 100)}% of income` : '');
  const cards = [
    { cls: 'income', icon: '💵', label: 'Total Income', value: income, sub: `${inc.length} entr${inc.length === 1 ? 'y' : 'ies'}` },
    { cls: 'expense', icon: '💸', label: 'Total Expense', value: expense, sub: `${exp.length} expense${exp.length === 1 ? '' : 's'}` },
    { cls: `balance${balance < 0 ? ' negative' : ''}`, icon: '💰', label: 'Balance Left', value: balance, sub: pctOfIncome(balance) || 'Income − Expense' },
    { cls: 'saving', icon: '🐷', label: 'Saving', value: saving, sub: pctOfIncome(saving) || 'Saved this period' },
    { cls: 'daily', icon: '📅', label: 'Daily average spend', value: days ? (expense - saving) / days : 0, sub: `over ${days} day${days === 1 ? '' : 's'} · excl. Saving` },
  ];
  $('#statCards').innerHTML = cards.map(c => `
    <div class="stat ${c.cls}">
      <div class="stat-icon">${c.icon}</div>
      <div>
        <div class="stat-label">${c.label}</div>
        <div class="stat-value">${fmtNum(c.value)} <small>Ks</small></div>
        <div class="stat-sub">${c.sub}</div>
      </div>
    </div>`).join('');
}

/** Days used for the daily average (only days that have passed in the current month/year) */
function countedDays(p) {
  const today = todayStr();
  if (!p.yearMode) return p.ym === thisMonth() ? +today.slice(8) : daysInMonth(p.ym);
  const start = new Date(`${dashMonths(p.year)[0]}-01T00:00:00`);
  const end = new Date(`${p.year === today.slice(0, 4) ? today : `${p.year}-12-31`}T00:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

/* ---------- Insights ---------- */
function insight(icon, title, body) {
  return `<div class="insight"><span class="insight-icon">${icon}</span><div><div class="insight-title">${title}</div><div class="insight-body">${body}</div></div></div>`;
}

function renderInsights(p, exp) {
  const parts = [changeInsight(p.ym)];
  if (exp.length) parts.unshift(topCategoryInsight(p, exp), biggestInsight(exp), frequentInsight(exp));
  else parts.unshift(`<p class="muted">No expenses in ${p.label} yet. Add some to see insights ✨</p>`);
  if (exp.length) parts.push(topItemsInsight(exp));
  $('#insights').innerHTML = parts.join('');
}

function topCategoryInsight(p, exp) {
  const [name, amt] = Object.entries(totalsBy(exp, r => r.category)).sort((a, b) => b[1] - a[1])[0];
  const pct = Math.round(amt / sumAmount(exp) * 100);
  return insight('🏆', `Top category ${p.yearMode ? 'this year' : 'this month'}`,
    `${badge(name)} <b>${fmtKs(amt)}</b> <span class="muted">(${pct}% of spending)</span>`);
}

function biggestInsight(exp) {
  const r = exp.reduce((a, b) => (b.amount > a.amount ? b : a));
  return insight('💸', 'Biggest single expense',
    `<b>${escapeHtml(r.item || '(no name)')}</b> ${badge(r.category)} <b>${fmtKs(r.amount)}</b> <span class="muted">· ${fmtDate(r.date)}</span>`);
}

/** Group expenses by item name (case-insensitive) */
function groupItems(exp) {
  const groups = new Map();
  exp.forEach(r => {
    const name = r.item || '(no name)';
    const key = name.toLowerCase();
    const g = groups.get(key) || { name, category: r.category, count: 0, total: 0 };
    g.count++;
    g.total += r.amount;
    groups.set(key, g);
  });
  return [...groups.values()];
}

function frequentInsight(exp) {
  const g = groupItems(exp).sort((a, b) => b.count - a.count || b.total - a.total)[0];
  return insight('🔁', 'Most frequent item',
    `<b>${escapeHtml(g.name)}</b> — ${g.count} time${g.count > 1 ? 's' : ''}, total <b>${fmtKs(g.total)}</b>`);
}

function changeInsight(ym) {
  const prevYm = shiftMonth(ym, -1);
  const cur = totalsBy(inPeriod(state.expenses, ym), r => r.category);
  const prev = totalsBy(inPeriod(state.expenses, prevYm), r => r.category);
  const chips = CATEGORIES.filter(c => cur[c.name] || prev[c.name])
    .map(c => changeChip(c, cur[c.name] || 0, prev[c.name] || 0)).join('');
  return insight('📈', `${monthLabel(ym)} vs ${monthLabel(prevYm)}`,
    chips ? `<div class="chips">${chips}</div>` : '<span class="muted">No spending to compare yet.</span>');
}

/** Red ▲ when spending went up, green ▼ when it went down */
function changeChip(c, cur, prev) {
  let cls = 'same', text = '0%';
  if (!prev) { cls = 'up'; text = '▲ new'; }
  else {
    const pct = Math.round((cur - prev) / prev * 100);
    if (pct > 0) { cls = 'up'; text = `▲ ${pct}%`; }
    if (pct < 0) { cls = 'down'; text = `▼ ${-pct}%`; }
  }
  return `<span class="chip ${cls}" title="${fmtKs(prev)} → ${fmtKs(cur)}">${c.emoji} ${c.name} <b>${text}</b></span>`;
}

function topItemsInsight(exp) {
  const top = groupItems(exp).sort((a, b) => b.total - a.total).slice(0, 5);
  const max = top[0].total;
  const rows = top.map((g, i) => {
    const c = catOf(g.category);
    return `<li><span class="rank">${i + 1}</span><span class="ti-name" title="${escapeHtml(g.name)}">${c.emoji} ${escapeHtml(g.name)}</span><span class="ti-bar"><span style="width:${g.total / max * 100}%;background:${c.color}"></span></span><b>${fmtNum(g.total)}</b></li>`;
  }).join('');
  return insight('🥇', 'Top 5 items by total spend', `<ol class="top-items">${rows}</ol>`);
}

/* ---------- Month table (like the Monthly Dashboard sheet) ---------- */
function monthTableData(year) {
  const months = dashMonths(year);
  const perMonth = months.map(m => totalsBy(inPeriod(state.expenses, m), r => r.category));
  const incomes = months.map(m => sumAmount(inPeriod(state.income, m)));
  const expenses = perMonth.map(t => Object.values(t).reduce((a, b) => a + b, 0));
  const balances = incomes.map((v, i) => v - expenses[i]);
  return { months, perMonth, incomes, expenses, balances };
}

function renderMonthTable(p) {
  const { months, perMonth, incomes, expenses, balances } = monthTableData(p.year);
  const sel = i => (months[i] === p.ym ? 'sel' : '');
  const maxes = perMonth.map(t => Math.max(0, ...Object.values(t)));

  const head = `<thead><tr><th>Category</th>${months.map((m, i) => `<th class="num ${sel(i)}">${shortMonth(m)}</th>`).join('')}<th class="num">Total</th></tr></thead>`;

  const catRows = CATEGORIES.map(c => {
    const cells = perMonth.map((t, i) => {
      const v = t[c.name] || 0;
      const isTop = v > 0 && v === maxes[i];
      const attrs = isTop ? ` style="--c:${c.color}" title="Highest in ${monthLabel(months[i])}"` : '';
      return `<td class="num ${sel(i)} ${isTop ? 'top' : ''}"${attrs}>${v ? fmtNum(v) : '<span class="dash">–</span>'}</td>`;
    }).join('');
    const total = perMonth.reduce((t, m) => t + (m[c.name] || 0), 0);
    return `<tr><td>${badge(c.name)}</td>${cells}<td class="num total">${total ? fmtNum(total) : '<span class="dash">–</span>'}</td></tr>`;
  }).join('');

  const sumRow = (label, vals, cls) => {
    const total = vals.reduce((a, b) => a + b, 0);
    const cells = vals.map((v, i) => `<td class="num ${sel(i)} ${v < 0 ? 'neg' : ''}">${fmtNum(v)}</td>`).join('');
    return `<tr class="sum-row ${cls}"><td>${label}</td>${cells}<td class="num total ${total < 0 ? 'neg' : ''}">${fmtNum(total)}</td></tr>`;
  };

  $('#monthTable').innerHTML = `${head}<tbody>${catRows}</tbody><tfoot>
    ${sumRow('💵 Total Income', incomes, 'inc')}
    ${sumRow('💸 Total Expense', expenses, 'exp')}
    ${sumRow('💰 Balance Left', balances, 'bal')}</tfoot>`;
}

/* ---------- Budgets ---------- */
function renderBudgets(ym) {
  const spent = totalsBy(inPeriod(state.expenses, ym), r => r.category);
  $('#budgetMonth').textContent = monthLabel(ym);
  $('#budgets').innerHTML = CATEGORIES.map(c => `
    <div class="budget-row" style="--c:${c.color}">
      <div class="budget-head">
        <span>${c.emoji} ${c.name}</span>
        <label class="budget-input">Budget
          <input type="number" min="0" step="1000" inputmode="numeric" placeholder="not set" value="${state.budgets[c.name] || ''}" data-budget="${c.name}">
        </label>
      </div>
      <div class="budget-bar">${budgetBar(spent[c.name] || 0, state.budgets[c.name])}</div>
    </div>`).join('');
}

/** Progress bar: normal < 80%, orange 80–100%, red > 100% */
function budgetBar(spent, budget) {
  if (!budget) {
    return `<div class="progress"><span style="width:0"></span></div><div class="budget-meta"><span>Spent ${fmtKs(spent)}</span><span>no budget set</span></div>`;
  }
  const pct = spent / budget * 100;
  const level = pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
  const left = budget - spent;
  const leftText = left >= 0 ? `${fmtKs(left)} left` : `${fmtKs(-left)} over! 🚨`;
  return `<div class="progress ${level}"><span style="width:${Math.min(pct, 100)}%"></span></div>
    <div class="budget-meta"><span>${fmtNum(spent)} / ${fmtKs(budget)} (${Math.round(pct)}%)</span><span class="${level}">${leftText}</span></div>`;
}

/** Save a budget and update only that row (keeps keyboard focus) */
function onBudgetChange(e) {
  const input = e.target.closest('[data-budget]');
  if (!input) return;
  const cat = input.dataset.budget;
  const value = Math.round(Number(input.value));
  if (value > 0) state.budgets[cat] = value;
  else { delete state.budgets[cat]; input.value = ''; }
  saveState();
  const spent = sumAmount(inPeriod(state.expenses, dashState().ym).filter(r => r.category === cat));
  input.closest('.budget-row').querySelector('.budget-bar').innerHTML = budgetBar(spent, state.budgets[cat]);
}

/* ---------- Charts (Chart.js) ---------- */
const charts = {};

/** Draws total in the middle of the donut */
const centerTextPlugin = {
  id: 'centerText',
  afterDraw(chart, args, opts) {
    if (!opts || !opts.text) return;
    const { ctx, chartArea: { left, right, top, bottom } } = chart;
    const x = (left + right) / 2, y = (top + bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color;
    ctx.font = "900 20px Nunito, system-ui, sans-serif";
    ctx.fillText(opts.text, x, y - 8);
    ctx.fillStyle = opts.subColor;
    ctx.font = "700 12px Nunito, system-ui, sans-serif";
    ctx.fillText(opts.sub, x, y + 13);
    ctx.restore();
  },
};

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function applyChartTheme() {
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--grid');
  Chart.defaults.font.family = "'Nunito', system-ui, sans-serif";
  Chart.defaults.font.weight = 600;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
}

function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}
function setChartEmpty(id, isEmpty, msg) {
  const box = document.getElementById(id).closest('.chart-box');
  box.classList.toggle('is-empty', isEmpty);
  box.dataset.empty = msg;
}

const ksAxis = (stacked = false) => ({ stacked, beginAtZero: true, ticks: { callback: v => shortNum(v) } });
const ksTooltip = { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtKs(ctx.parsed.y)}` } };

function renderCharts(p, exp) {
  if (!window.Chart) {
    $$('.chart-box').forEach(b => { b.classList.add('is-empty'); b.dataset.empty = '📡 Charts need an internet connection (Chart.js)'; });
    return;
  }
  applyChartTheme();
  drawDonut(p, exp);
  drawIncomeVsExpense(p);
  drawDailyLine(p, exp);
  drawStacked(p);
}

/* (a) Donut: category share in the selected period */
function drawDonut(p, exp) {
  const totals = totalsBy(exp, r => r.category);
  const cats = CATEGORIES.filter(c => totals[c.name]);
  const total = sumAmount(exp);
  setChartEmpty('chartDonut', !cats.length, `No expenses in ${p.label}`);
  drawChart('chartDonut', {
    type: 'doughnut',
    data: {
      labels: cats.map(c => `${c.emoji} ${c.name}`),
      datasets: [{ data: cats.map(c => totals[c.name]), backgroundColor: cats.map(c => c.color), borderColor: cssVar('--card'), borderWidth: 3, hoverOffset: 10 }],
    },
    options: {
      cutout: '64%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${fmtKs(ctx.parsed)} (${Math.round(ctx.parsed / total * 100)}%)` } },
        centerText: cats.length ? { text: fmtNum(total), sub: 'Ks spent', color: cssVar('--text'), subColor: cssVar('--muted') } : {},
      },
    },
    plugins: [centerTextPlugin],
  });
}

/* (b) Bars: monthly income vs expense for the year */
function drawIncomeVsExpense(p) {
  const { months, incomes, expenses } = monthTableData(p.year);
  const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 8, maxBarThickness: 26 });
  setChartEmpty('chartIncExp', !incomes.some(Boolean) && !expenses.some(Boolean), `No data in ${p.year}`);
  drawChart('chartIncExp', {
    type: 'bar',
    data: { labels: months.map(shortMonth), datasets: [bar('Income', incomes, INCOME_COLOR), bar('Expense', expenses, EXPENSE_COLOR)] },
    options: { plugins: { tooltip: ksTooltip }, scales: { y: ksAxis(), x: { grid: { display: false } } } },
  });
}

/* (c) Line: daily spending in the month (or monthly spending in year mode) */
function drawDailyLine(p, exp) {
  let labels, values;
  if (p.yearMode) {
    const months = dashMonths(p.year);
    const t = totalsBy(exp, r => monthOf(r.date));
    labels = months.map(shortMonth);
    values = months.map(m => t[m] || 0);
    $('#dailyTitle').textContent = `📈 Monthly spending · ${p.year}`;
  } else {
    const t = totalsBy(exp, r => +r.date.slice(8));
    labels = Array.from({ length: daysInMonth(p.ym) }, (_, i) => i + 1);
    values = labels.map(d => t[d] || 0);
    $('#dailyTitle').textContent = `📈 Daily spending · ${monthLabel(p.ym)}`;
  }
  setChartEmpty('chartDaily', !values.some(Boolean), `No expenses in ${p.label}`);
  drawChart('chartDaily', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Spent', data: values, borderColor: LINE_COLOR, borderWidth: 3, tension: 0.35, fill: true,
        backgroundColor: lineGradient, pointRadius: 3, pointHoverRadius: 7, pointBackgroundColor: LINE_COLOR,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => (p.yearMode ? `${items[0].label} ${p.year}` : `${items[0].label} ${monthLabel(p.ym)}`),
            label: ctx => ` ${fmtKs(ctx.parsed.y)}`,
          },
        },
      },
      scales: { y: ksAxis(), x: { grid: { display: false } } },
    },
  });
}
function lineGradient(ctx) {
  const { chart } = ctx;
  if (!chart.chartArea) return 'rgba(124, 92, 255, .15)';
  const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
  g.addColorStop(0, 'rgba(124, 92, 255, .35)');
  g.addColorStop(1, 'rgba(124, 92, 255, 0)');
  return g;
}

/* (d) Stacked bars: categories per month */
function drawStacked(p) {
  const { months, perMonth } = monthTableData(p.year);
  const datasets = CATEGORIES
    .map(c => ({ label: `${c.emoji} ${c.name}`, data: perMonth.map(t => t[c.name] || 0), backgroundColor: c.color, borderRadius: 4, maxBarThickness: 40 }))
    .filter(d => d.data.some(Boolean));
  setChartEmpty('chartStacked', !datasets.length, `No expenses in ${p.year}`);
  drawChart('chartStacked', {
    type: 'bar',
    data: { labels: months.map(shortMonth), datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12 } },
        tooltip: { ...ksTooltip, filter: item => item.parsed.y > 0 },
      },
      scales: { x: { stacked: true, grid: { display: false } }, y: ksAxis(true) },
    },
  });
}

/* =========================================================
   Import (Excel) / Export (Excel + JSON)
   ========================================================= */
const normKey = v => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Prefer an exact sheet name ("Expenses"), else any name containing the word */
function findSheet(wb, word) {
  return wb.SheetNames.find(n => [word, `${word}s`].includes(n.trim().toLowerCase()))
    || wb.SheetNames.find(n => n.toLowerCase().includes(word));
}

/** Sheet → array of objects keyed by normalized header ("Item Name" → "itemname") */
function sheetObjects(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
  const headerIdx = rows.findIndex(r => r.some(c => normKey(c).startsWith('amount')));
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx].map(h => (normKey(h).startsWith('amount') ? 'amount' : normKey(h)));
  return rows.slice(headerIdx + 1).map(r => {
    const o = {};
    headers.forEach((h, i) => { if (h && !(h in o)) o[h] = r[i]; });
    return o;
  });
}

/** First non-empty value among the given keys */
function pick(o, ...keys) {
  for (const k of keys) {
    if (o[k] !== undefined && String(o[k]).trim() !== '') return o[k];
  }
  return '';
}
const isEmptyRow = o => Object.values(o).every(v => String(v ?? '').trim() === '');

/** Excel serial number, Date, "2026-03-15" or "3/15/2026 10:20:00" → "YYYY-MM-DD" */
function parseDate(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') {
    if (v < 1) return '';
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (v instanceof Date) return isNaN(v) ? '' : localYmd(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return +m[1] > 12 ? ymd(m[3], m[2], m[1]) : ymd(m[3], m[1], m[2]);   // M/D/YYYY, or D/M/YYYY when day > 12
  const d = new Date(s);
  return isNaN(d) ? '' : localYmd(d);
}
function parseAmount(v) {
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseRows(objects, toRecord) {
  const rows = [];
  let invalid = 0, empty = 0;
  objects.forEach(o => {
    if (isEmptyRow(o)) { empty++; return; }
    const rec = toRecord(o);
    if (!rec.date || !(rec.amount > 0)) { invalid++; return; }
    rows.push(rec);
  });
  return { rows, invalid, empty };
}
const toExpense = o => ({
  date: parseDate(pick(o, 'date', 'timestamp')),
  category: matchCategory(String(pick(o, 'category')).trim()),
  item: String(pick(o, 'itemname', 'item', 'name', 'description')).trim(),
  amount: parseAmount(pick(o, 'amount')),
});
const toIncome = o => ({
  date: parseDate(pick(o, 'date', 'timestamp')),
  category: String(pick(o, 'category', 'source', 'type')).trim() || 'Other',
  amount: parseAmount(pick(o, 'amount')),
  description: String(pick(o, 'description', 'note', 'notes', 'remark', 'remarks', 'itemname', 'item')).trim(),
});
const expenseKey = r => `${r.date}|${r.category}|${r.item.toLowerCase()}|${r.amount}`;
const incomeKey = r => `${r.date}|${r.category.toLowerCase()}|${r.amount}|${r.description.toLowerCase()}`;

/** Add rows that are not already stored (counts duplicates, so re-importing the same file adds nothing) */
function mergeRecords(listName, rows, keyFn) {
  const existing = {};
  state[listName].forEach(r => { const k = keyFn(r); existing[k] = (existing[k] || 0) + 1; });
  const records = [];
  let dupes = 0;
  rows.forEach((r, i) => {
    const k = keyFn(r);
    if (existing[k]) { existing[k]--; dupes++; return; }
    const rec = { id: uid(), created: Date.now() + i, sample: false, ...r };
    state[listName].push(rec);
    records.push(rec);
  });
  if (isSyncOn()) records.forEach(rec => queueAdd(listName, rec));   // upload new rows to the sheet
  return { added: records.length, dupes };
}

async function importExcel(file) {
  if (!window.XLSX) { toast('Excel library not loaded — check your internet connection', 'error'); return; }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const expName = findSheet(wb, 'expense');
    const incName = findSheet(wb, 'income');
    if (!expName && !incName) {
      await messageBox('😕 Nothing to import', `No sheet named <b>Expenses</b> or <b>Income</b> was found in <b>${escapeHtml(file.name)}</b>.`);
      return;
    }
    const none = { rows: [], invalid: 0, empty: 0 };
    const exp = expName ? parseRows(sheetObjects(wb.Sheets[expName]), toExpense) : none;
    const inc = incName ? parseRows(sheetObjects(wb.Sheets[incName]), toIncome) : none;

    if (hasSample() && await confirmBox({ title: '🧹 Remove sample data?', message: 'You are importing your real data. Remove the sample rows first?', ok: 'Yes, remove', cancel: 'Keep them' })) {
      clearSampleData();
    }
    const e = mergeRecords('expenses', exp.rows, expenseKey);
    const i = mergeRecords('income', inc.rows, incomeKey);
    saveState();
    refresh();
    const uploading = isSyncOn() && e.added + i.added;
    if (uploading) { saveQueue(); renderSyncStatus(); requestSync(); }
    await messageBox('🎉 Import finished', `<ul>
      <li>🧾 Expenses added: <b>${e.added}</b>${expName ? '' : ' <span class="muted">(no Expenses sheet)</span>'}</li>
      <li>💵 Income added: <b>${i.added}</b>${incName ? '' : ' <span class="muted">(no Income sheet)</span>'}</li>
      <li>🔁 Duplicates skipped: <b>${e.dupes + i.dupes}</b></li>
      <li>⚠️ Rows skipped (missing date or amount): <b>${exp.invalid + inc.invalid}</b></li>
    </ul>${uploading ? '<p class="muted">☁️ New rows are being uploaded to Google Sheets in the background.</p>' : ''}`);
  } catch (err) {
    console.error(err);
    await messageBox('❌ Import failed', 'This file could not be read. Please choose an .xlsx file with "Expenses" and/or "Income" sheets.');
  }
}

/** "YYYY-MM-DD" → Excel date serial (so Excel shows real dates) */
function dateSerial(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
}
function stampStr(ms) {
  const d = new Date(ms);
  return `${localYmd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addSheet(wb, name, header, rows, dateCols = []) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  rows.forEach((_, r) => dateCols.forEach(c => {
    const cell = ws[XLSX.utils.encode_cell({ r: r + 1, c })];
    if (cell) cell.z = 'yyyy-mm-dd';
  }));
  ws['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 20 : Math.max(12, String(h).length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function dashboardSheetRows(year) {
  const { months, perMonth, incomes, expenses, balances } = monthTableData(year);
  const withTotal = vals => [...vals, vals.reduce((a, b) => a + b, 0)];
  return {
    header: ['Category', ...months.map(m => `${shortMonth(m)} ${year}`), 'Total'],
    rows: [
      ...CATEGORIES.map(c => [c.name, ...withTotal(perMonth.map(t => t[c.name] || 0))]),
      ['Total Income', ...withTotal(incomes)],
      ['Total Expense', ...withTotal(expenses)],
      ['Balance Left', ...withTotal(balances)],
    ],
  };
}

function exportExcel() {
  if (!window.XLSX) { toast('Excel library not loaded — check your internet connection', 'error'); return; }
  const wb = XLSX.utils.book_new();
  const exp = [...state.expenses].sort((a, b) => a.date.localeCompare(b.date));
  const inc = [...state.income].sort((a, b) => a.date.localeCompare(b.date));
  addSheet(wb, 'Expenses', ['Timestamp', 'Date', 'Category', 'Item Name', 'Amount'],
    exp.map(r => [stampStr(r.created), dateSerial(r.date), r.category, r.item, r.amount]), [1]);
  addSheet(wb, 'Income', ['Date', 'Category', 'Amount', 'Description'],
    inc.map(r => [dateSerial(r.date), r.category, r.amount, r.description]), [0]);
  const year = dashState().year;
  const dash = dashboardSheetRows(year);
  addSheet(wb, `Monthly Dashboard ${year}`, dash.header, dash.rows);
  XLSX.writeFile(wb, `expense-tracker-${todayStr()}.xlsx`);
  toast('📤 Excel file downloaded');
}

function backupJson() {
  const data = { app: 'personal-expense-tracker', version: 1, exportedAt: new Date().toISOString(), ...state };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `expense-backup-${todayStr()}.json`);
  toast('💾 Backup downloaded');
}

async function restoreJson(file) {
  if (isSyncOn()) {
    await messageBox('☁️ Sync is on', 'While sync is on, your Google Sheet is the main copy, so the next sync would replace a restored backup.<p>Turn off sync in ⚙️ Settings first, or use 📥 Import Excel to add rows to the sheet.</p>');
    return;
  }
  let next;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.expenses) && !Array.isArray(data.income)) throw new Error('Not a backup');
    next = normalizeState(data);
  } catch (err) {
    await messageBox('❌ Restore failed', 'That file is not a valid Expense Tracker backup (.json).');
    return;
  }
  const ok = await confirmBox({
    title: '♻️ Restore backup?',
    message: `This will <b>replace all current data</b> with the backup:<ul><li>${next.expenses.length} expenses</li><li>${next.income.length} income entries</li></ul>`,
    ok: 'Replace my data', danger: true,
  });
  if (!ok) return;
  state = next;
  saveState();
  resetExpenseForm(true);
  resetIncomeForm(true);
  refresh();
  toast('♻️ Backup restored');
}

/* =========================================================
   Google Sheets sync (Apps Script Web App)
   The sheet is the main copy: each sync replaces local
   expenses/income with the sheet, then re-applies changes
   still waiting in the pending queue. Budgets stay local.
   ========================================================= */
const SYNC_KINDS = {
  expenses: {
    add: 'addExpense', del: 'deleteExpense',
    fields: r => ({ date: r.date, category: r.category, item: r.item, amount: r.amount }),
    key: r => expenseKey(r),
  },
  income: {
    add: 'addIncome', del: 'deleteIncome',
    fields: r => ({ date: r.date, category: r.category, amount: r.amount, description: r.description }),
    key: r => incomeKey(r),
  },
};
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_INTERVAL_MS = 60000;
const MSG = {
  offline: '📡 No internet. Your changes are saved on this device and will sync when you are back online.',
  network: "Can't reach Google Sheets. Check the Web App URL, and that the script is deployed with access “Anyone”.",
  auth: '🔑 Wrong token. Open ⚙️ Settings and check it.',
  access: '🔒 Google asked for a sign-in, so the Web App is not public. In Apps Script: Deploy → Manage deployments → Edit → "Who has access: Anyone" → Deploy, then press 🔄 Sync.',
  badresponse: "That URL didn't return expense data. Use the Web App URL that ends in /exec.",
  unknown: 'Something went wrong while syncing. Please try again.',
};

let syncSettings = { url: '', token: '' };
let pendingQueue = [];      // [{ opId, kind, action, tempId?, fields? | record? }]
let inFlightOpId = null;    // op currently being sent
const sync = { status: 'off', lastSynced: 0, message: '', lastError: '', retry: true };

class SyncError extends Error {
  constructor(kind, message) { super(message || MSG[kind]); this.kind = kind; }
}

const isSyncOn = () => !!(syncSettings.url && syncSettings.token);

/* ---------- Storage ---------- */
function loadSync() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY)) || {};
    syncSettings = { url: s.url || '', token: s.token || '' };
    sync.lastSynced = +s.lastSynced || 0;
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
    pendingQueue = Array.isArray(q) ? q : [];
  } catch (err) {
    pendingQueue = [];
  }
}
function saveSyncSettings() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify({ ...syncSettings, lastSynced: sync.lastSynced })); } catch (err) { /* ignore */ }
}
function saveQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(pendingQueue)); } catch (err) { /* ignore */ }
}

/* ---------- Network ---------- */

/** fetch with timeout; network failures become friendly SyncErrors */
async function request(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { ...options, signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
  } catch (err) {
    throw new SyncError(navigator.onLine === false ? 'offline' : 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new SyncError('access');
  if (!res.ok) throw new SyncError('server', `Google Sheets returned an error (HTTP ${res.status}). Please try again later.`);
  return res.text();
}

/** Parse the Web App reply; error replies ({error}, {ok:false}…) become SyncErrors */
function parseReply(text, requireJson) {
  let data;
  try {
    data = JSON.parse(text) || {};
  } catch (err) {
    if (requireJson || /<html|<!doctype/i.test(text)) throw new SyncError('badresponse');
    return {};                                   // plain-text "OK" reply to a POST
  }
  const failed = data.ok === false || data.success === false || data.status === 'error';
  const errText = data.error || (failed ? data.message || 'Request failed' : '');
  if (errText) {
    const msg = String(errText);
    if (/token|auth|unauthori|forbidden|denied|permission/i.test(msg)) throw new SyncError('auth');
    throw new SyncError('server', `Google Sheets said: ${msg}`);
  }
  return data;
}

async function apiGet() {
  const { url, token } = syncSettings;
  const text = await request(`${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
  const data = parseReply(text, true);
  if (!Array.isArray(data.expenses) || !Array.isArray(data.income)) throw new SyncError('badresponse');
  return data;
}

/** text/plain body = "simple" request, so the browser skips the CORS preflight */
async function apiPost(body) {
  const text = await request(syncSettings.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: syncSettings.token, ...body }),
  });
  return parseReply(text, false);
}

/* ---------- Sheet rows → local records ---------- */

/** Apps Script sends sheet dates as UTC ISO strings ("2026-10-18T17:30:00.000Z") → back to the local day */
function remoteDate(v) {
  const s = String(v ?? '').trim();
  if (/T\d\d:\d\d.*(Z|[+-]\d\d:?\d\d)$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return localYmd(d);
  }
  return parseDate(v);
}
function remoteFields(r) {
  return { id: String(r.id), created: Number(r.id) || 0, date: remoteDate(r.date), amount: parseAmount(r.amount) };
}
const hasId = r => r && r.id !== undefined && r.id !== null && r.id !== '';
const remoteExpense = r => (hasId(r) ? cleanExpense({ ...r, ...remoteFields(r) }) : null);
const remoteIncome = r => (hasId(r) ? cleanIncome({ ...r, ...remoteFields(r) }) : null);
const remoteRows = (data, kind) => data[kind].map(kind === 'expenses' ? remoteExpense : remoteIncome).filter(Boolean);

/** Find the sheet row for a local record: same id + same content, else first row with the same content */
function findMatch(rows, rec, kind) {
  const keyOf = SYNC_KINDS[kind].key;
  const key = keyOf(rec);
  return rows.find(r => r.id === rec.id && keyOf(r) === key) || rows.find(r => keyOf(r) === key);
}

/** Replace local data with the sheet, keeping changes that are still waiting */
function applyRemote(data) {
  ['expenses', 'income'].forEach(kind => {
    let rows = remoteRows(data, kind);
    pendingQueue.filter(op => op.kind === kind && op.record).forEach(op => {   // hide rows waiting to be deleted
      const target = findMatch(rows, op.record, kind);
      if (target) rows = rows.filter(r => r !== target);
    });
    state[kind] = [...rows, ...state[kind].filter(r => r.pending)];
  });
  saveState();
}

/* ---------- Pending queue ---------- */
function queueAdd(kind, rec) {
  rec.pending = true;
  pendingQueue.push({ opId: uid(), kind, action: SYNC_KINDS[kind].add, tempId: rec.id, fields: SYNC_KINDS[kind].fields(rec) });
}
function queueDelete(kind, rec) {
  pendingQueue.push({ opId: uid(), kind, action: SYNC_KINDS[kind].del, record: { id: rec.id, ...SYNC_KINDS[kind].fields(rec) } });
}
/** The queued "add" for a local-only record, unless it is being sent right now */
const queuedAddOp = id => pendingQueue.find(o => o.tempId === id && o.opId !== inFlightOpId);

/** Add or edit a record. With sync on it is also queued for Google Sheets. Returns false if nothing was saved. */
function saveRecord(kind, rec, id) {
  if (!isSyncOn()) { upsert(kind, rec, id); return true; }
  const list = state[kind];
  const old = id ? list.find(r => r.id === id) : null;
  if (id && !old) {
    toast('This entry was just refreshed from Google Sheets. Please edit it again.', 'error');
    return false;
  }
  const queued = old && old.pending && queuedAddOp(old.id);
  if (queued) {                                     // not uploaded yet → just change what will be uploaded
    Object.assign(old, rec);
    queued.fields = SYNC_KINDS[kind].fields(old);
  } else {
    const fresh = { id: `tmp-${uid()}`, created: Date.now(), sample: false, ...rec };
    if (old) list.splice(list.indexOf(old), 1, fresh);
    else list.push(fresh);
    queueAdd(kind, fresh);
    if (old && !old.sample) queueDelete(kind, old); // the sheet API has no "update": add new, then delete old
  }
  saveState();
  saveQueue();
  renderSyncStatus();
  requestSync();
  return true;
}

/** Delete locally; with sync on, also delete from the sheet (or cancel a not-yet-sent add) */
function deleteRecord(kind, id) {
  const rec = state[kind].find(r => r.id === id);
  if (!rec) return;
  if (isSyncOn() && !rec.sample) {
    const queued = rec.pending && queuedAddOp(id);
    if (queued) pendingQueue = pendingQueue.filter(o => o !== queued);
    else queueDelete(kind, rec);
    saveQueue();
  }
  removeRecord(kind, id);
  if (isSyncOn()) { renderSyncStatus(); requestSync(); }
}

/** Send one queued change. Deletes look up the current row number first, because rows shift. */
async function sendOp(op) {
  if (op.fields) {
    await apiPost({ action: op.action, ...op.fields });
    return;
  }
  const target = findMatch(remoteRows(await apiGet(), op.kind), op.record, op.kind);
  if (!target) return;                              // already gone from the sheet
  await apiPost({ action: op.action, id: /^\d+$/.test(target.id) ? Number(target.id) : target.id });
}

/** Send queued changes in order; stops at the first failure (the rest stay queued) */
async function flushQueue() {
  while (pendingQueue.length) {
    const op = pendingQueue[0];
    inFlightOpId = op.opId;
    try { await sendOp(op); } finally { inFlightOpId = null; }
    pendingQueue = pendingQueue.filter(o => o.opId !== op.opId);
    const rec = op.tempId && state[op.kind].find(r => r.id === op.tempId);
    if (rec) { rec.pending = false; saveState(); }  // it's in the sheet now; next fetch replaces it
    saveQueue();
    renderSyncStatus();
  }
}

/* ---------- Sync cycle ---------- */
let syncRun = null;
let syncAgain = false;

/** Flush the queue, then fetch the sheet. Calls made while running are merged into one more pass. */
function requestSync(manual = false) {
  if (!isSyncOn()) {
    if (manual) openSettings();
    return Promise.resolve();
  }
  if (manual) sync.retry = true;
  if (syncRun) { syncAgain = true; return syncRun; }
  syncRun = (async () => {
    do { syncAgain = false; await syncOnce(manual); } while (syncAgain);
  })().finally(() => { syncRun = null; });
  return syncRun;
}

async function syncOnce(manual) {
  setSyncStatus('syncing');
  try {
    await flushQueue();
    applyRemote(await apiGet());
    sync.lastSynced = Date.now();
    sync.lastError = '';
    sync.retry = true;
    saveSyncSettings();
    setSyncStatus('synced');
    refresh();
    if (manual) toast('✅ Synced with Google Sheets');
  } catch (err) {
    onSyncError(err, manual);
  }
}

function onSyncError(err, manual) {
  if (!(err instanceof SyncError)) { console.error(err); err = new SyncError('server', MSG.unknown); }
  sync.retry = !['auth', 'access', 'badresponse'].includes(err.kind);   // those need a settings fix first
  sync.message = err.message;
  setSyncStatus(err.kind === 'offline' ? 'offline' : 'error');
  if (manual || err.message !== sync.lastError) toast(err.message, 'error');
  sync.lastError = err.message;
  refresh();
}

function setSyncStatus(status) {
  sync.status = status;
  renderSyncStatus();
}

function fmtSyncTime(ms) {
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return localYmd(d) === todayStr() ? time : `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** ✅ synced / 🔄 syncing / ⚠️ offline + "Last synced" + "N waiting to sync" */
function renderSyncStatus() {
  const on = isSyncOn();
  const status = on ? sync.status : 'off';
  const labels = { off: '☁️ Sync off', syncing: '🔄 Syncing…', synced: '✅ Synced', offline: '⚠️ Offline', error: '⚠️ Sync problem' };
  const pill = $('#syncPill');
  pill.textContent = labels[status];
  pill.className = `sync-pill ${status}`;
  $('#syncText').textContent = !on ? 'Connect your Google Sheet in ⚙️ Settings'
    : sync.lastSynced ? `Last synced: ${fmtSyncTime(sync.lastSynced)}` : 'Not synced yet';
  const n = on ? pendingQueue.length : 0;
  $('#pendingBadge').hidden = !n;
  $('#pendingBadge').textContent = `⏳ ${n} waiting to sync`;
  const showMsg = on && (status === 'offline' || status === 'error');
  $('#syncMsg').hidden = !showMsg;
  $('#syncMsg').textContent = showMsg ? sync.message : '';
  $('#btnSync').textContent = on ? '🔄 Sync' : '⚙️ Set up sync';
  $('#btnSync').disabled = status === 'syncing';
}

/* ---------- Settings dialog ---------- */
function openSettings() {
  $('#setUrl').value = syncSettings.url;
  $('#setToken').value = syncSettings.token;
  $('#setToken').type = 'password';
  showFormError('#setError', '');
  $('#btnDisconnect').hidden = !isSyncOn();
  renderPendingBox();
  $('#settingsDialog').showModal();
}

function renderPendingBox() {
  const n = pendingQueue.length;
  $('#pendingBox').hidden = !n;
  $('#pendingInfo').textContent = `⏳ ${n} change${n === 1 ? '' : 's'} waiting to sync`;
}

function onSettingsSubmit(e) {
  e.preventDefault();
  const url = $('#setUrl').value.trim();
  const token = $('#setToken').value.trim();
  if (!/^https:\/\/script\.google\.com\/\S+$/.test(url)) {
    showFormError('#setError', 'Paste the Web App URL. It starts with https://script.google.com/ and ends with /exec.');
    return;
  }
  if (!token) { showFormError('#setError', 'Please enter your token.'); return; }
  syncSettings = { url, token };
  sync.lastError = '';
  saveSyncSettings();
  $('#settingsDialog').close();
  renderSyncStatus();
  requestSync(true);
}

async function disconnectSync() {
  const n = pendingQueue.length;
  const ok = await confirmBox({
    title: '☁️ Turn off sync?',
    message: `The URL and token will be removed from this browser. Your data stays on this device.${n ? `<p><b>${n} change${n === 1 ? '' : 's'} not yet synced</b> will stay only on this device.</p>` : ''}`,
    ok: 'Turn off sync', danger: true,
  });
  if (!ok) return;
  syncSettings = { url: '', token: '' };
  pendingQueue = [];
  sync.lastSynced = 0;
  sync.status = 'off';
  [...state.expenses, ...state.income].forEach(r => { r.pending = false; });
  try { localStorage.removeItem(SYNC_KEY); } catch (err) { /* ignore */ }
  saveQueue();
  saveState();
  $('#settingsDialog').close();
  renderSyncStatus();
  refresh();
  toast('☁️ Sync turned off');
}

async function discardPending() {
  const n = pendingQueue.length;
  const ok = await confirmBox({
    title: '🗑️ Discard waiting changes?',
    message: `${n} change${n === 1 ? '' : 's'} that did not reach Google Sheets will be thrown away. Your data will match the sheet after the next sync.`,
    ok: 'Discard', danger: true,
  });
  if (!ok) return;
  pendingQueue = pendingQueue.filter(o => o.opId === inFlightOpId);
  state.expenses = state.expenses.filter(r => !r.pending);
  state.income = state.income.filter(r => !r.pending);
  saveQueue();
  saveState();
  renderPendingBox();
  renderSyncStatus();
  refresh();
  requestSync();
}

/** Retry when the network comes back, and every minute while changes are waiting */
function bindSyncEvents() {
  $('#btnSync').addEventListener('click', () => requestSync(true));
  $('#btnSettings').addEventListener('click', openSettings);
  $('#settingsForm').addEventListener('submit', onSettingsSubmit);
  $('#setCancel').addEventListener('click', () => $('#settingsDialog').close());
  $('#btnDisconnect').addEventListener('click', disconnectSync);
  $('#btnDiscardPending').addEventListener('click', discardPending);
  $('#toggleToken').addEventListener('click', () => {
    const input = $('#setToken');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  window.addEventListener('online', () => requestSync());
  window.addEventListener('offline', () => {
    if (!isSyncOn()) return;
    sync.message = MSG.offline;
    setSyncStatus('offline');
  });
  setInterval(() => {
    if (isSyncOn() && pendingQueue.length && sync.retry && navigator.onLine !== false) requestSync();
  }, RETRY_INTERVAL_MS);
}

/* =========================================================
   Dialogs & theme
   ========================================================= */

/** Promise-based confirm dialog → resolves true when OK is pressed */
function confirmBox({ title = 'Are you sure?', message = '', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  const dlg = $('#dialog');
  if (typeof dlg.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${message.replace(/<[^>]+>/g, ' ')}`));
  }
  $('#dlgTitle').textContent = title;
  $('#dlgMessage').innerHTML = message;
  $('#dlgOk').textContent = ok;
  $('#dlgOk').className = `btn ${danger ? 'danger' : 'primary'}`;
  $('#dlgCancel').hidden = !cancel;
  $('#dlgCancel').textContent = cancel || '';
  dlg.returnValue = '';
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    (cancel ? $('#dlgCancel') : $('#dlgOk')).focus();
  });
}
const messageBox = (title, message) => confirmBox({ title, message, ok: 'OK', cancel: null });

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#btnTheme').textContent = theme === 'dark' ? '☀️' : '🌙';
  savePref('theme', theme);
  if (currentTab === 'dashboard') renderDashboard();   // charts read colors from CSS
}

/* =========================================================
   Events & init
   ========================================================= */

/** Edit/delete buttons inside a table body */
function bindTableActions(tbodySel, onEdit, onDelete) {
  $(tbodySel).addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.edit) onEdit(btn.dataset.edit);
    if (btn.dataset.del) onDelete(btn.dataset.del);
  });
}

/** Opens a hidden file input and passes the chosen file to handler */
function bindFilePicker(buttonSel, inputSel, handler) {
  $(buttonSel).addEventListener('click', () => $(inputSel).click());
  $(inputSel).addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';                     // allow choosing the same file again
    if (file) await handler(file);
  });
}

function bindEvents() {
  $$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Expenses
  $('#expenseForm').addEventListener('submit', onExpenseSubmit);
  $('#expCancel').addEventListener('click', () => resetExpenseForm(true));
  $('#expItem').addEventListener('change', autoCategoryFromItem);
  bindTableActions('#expTable tbody', startEditExpense, deleteExpense);
  ['#expSearch', '#expMonth', '#expCatFilter'].forEach(sel => $(sel).addEventListener('input', renderExpenses));
  $('#expResetFilters').addEventListener('click', () => {
    $('#expSearch').value = ''; $('#expMonth').value = ''; $('#expCatFilter').value = '';
    renderExpenses();
  });

  // Income
  $('#incomeForm').addEventListener('submit', onIncomeSubmit);
  $('#incCancel').addEventListener('click', () => resetIncomeForm(true));
  bindTableActions('#incTable tbody', startEditIncome, deleteIncome);
  $('#incMonth').addEventListener('input', renderIncome);
  $('#incAllMonths').addEventListener('click', () => { $('#incMonth').value = ''; renderIncome(); });
  $('#incMonths').addEventListener('click', e => {
    const chip = e.target.closest('[data-month]');
    if (chip) { $('#incMonth').value = chip.dataset.month; renderIncome(); }
  });

  // Dashboard
  $('#dashMonth').addEventListener('change', () => { if (!$('#dashMonth').value) $('#dashMonth').value = thisMonth(); renderDashboard(); });
  $('#dashPrev').addEventListener('click', () => { $('#dashMonth').value = shiftMonth(dashState().ym, -1); renderDashboard(); });
  $('#dashNext').addEventListener('click', () => { $('#dashMonth').value = shiftMonth(dashState().ym, 1); renderDashboard(); });
  $('#yearToggle').addEventListener('change', renderDashboard);
  $('#budgets').addEventListener('change', onBudgetChange);

  // Header actions
  bindFilePicker('#btnImport', '#fileExcel', importExcel);
  bindFilePicker('#btnRestore', '#fileJson', restoreJson);
  $('#btnExport').addEventListener('click', exportExcel);
  $('#btnBackup').addEventListener('click', backupJson);
  $('#btnTheme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  bindSyncEvents();
  $('#btnClearSample').addEventListener('click', async () => {
    const ok = await confirmBox({ title: '🧹 Clear sample data?', message: 'This removes the sample expenses and income. Anything you added yourself stays.', ok: 'Clear sample data', danger: true });
    if (!ok) return;
    clearSampleData();
    refresh();
    toast('🧹 Sample data cleared');
  });
}

function init() {
  loadPrefs();
  loadSync();
  loadState();
  fillCategorySelects();
  const prefersDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = prefs.theme || (prefersDark ? 'dark' : 'light');
  $('#btnTheme').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
  $('#expDate').value = todayStr();
  $('#incDate').value = todayStr();
  $('#dashMonth').value = thisMonth();
  $('#incMonth').value = thisMonth();
  bindEvents();
  $('#sampleBanner').hidden = !hasSample();
  showTab(['expenses', 'dashboard', 'income'].includes(prefs.tab) ? prefs.tab : 'dashboard');
  // Redraw charts once the web font is ready so canvas text uses it
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (currentTab === 'dashboard') renderDashboard(); });
  renderSyncStatus();
  requestSync();                     // pull the latest data from Google Sheets (if set up)
}

init();
