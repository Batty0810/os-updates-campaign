import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const ATTENDEES = ["Sean Rose", "Daniel Martins", "Jimmy Mokwena", "Jose van der Merwe", "Brendon Atwell"];

const state = { customers: [], user: null };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (n) => `${Math.round(n * 100)}%`;
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "";

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg || "";
  el.classList.toggle("err", isError);
}

// ---------- data ----------
async function load() {
  setStatus("Loading…");
  const { data, error } = await sb
    .from("customers")
    .select("id, name, account_manager, vms(id, vm_name, status, hw_version, os_config, os_tools, contact_date, am_notes), meetings(id, attendee, meeting_date, completed, comment, updated_by, updated_at)")
    .order("name");
  if (error) return setStatus(`Could not load data: ${error.message}`, true);
  state.customers = data.map((c) => ({
    ...c,
    meeting: Array.isArray(c.meetings) ? c.meetings[0] || null : c.meetings || null,
  }));
  setStatus("");
  renderAll();
}

const meetingState = (c) => !c.meeting ? "none" : c.meeting.completed ? "completed" : "scheduled";

function summarise() {
  const byAm = new Map();
  for (const c of state.customers) {
    const am = c.account_manager;
    if (!byAm.has(am)) byAm.set(am, { am, customers: 0, scheduled: 0, completed: 0 });
    const r = byAm.get(am);
    r.customers++;
    if (c.meeting) r.scheduled++;
    if (c.meeting?.completed) r.completed++;
  }
  const rows = [...byAm.values()].map((r) => ({ ...r, rate: r.customers ? r.completed / r.customers : 0 }))
    .sort((a, b) => a.am.localeCompare(b.am));
  const total = rows.reduce((t, r) => ({
    customers: t.customers + r.customers, scheduled: t.scheduled + r.scheduled, completed: t.completed + r.completed,
  }), { customers: 0, scheduled: 0, completed: 0 });
  total.rate = total.customers ? total.completed / total.customers : 0;
  return { rows, total };
}

// ---------- dashboard ----------
function renderDashboard() {
  const { rows, total } = summarise();
  $("kpis").innerHTML = [
    ["Customers", total.customers, `${rows.length} account managers`],
    ["Meetings scheduled", total.scheduled, `${pct(total.customers ? total.scheduled / total.customers : 0)} of customers`],
    ["Meetings completed", total.completed, `${total.scheduled - total.completed} still to happen`],
    ["Success rate", pct(total.rate), "completed ÷ customers"],
  ].map(([l, v, s]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-sub">${s}</div></div>`).join("");

  $("am-rows").innerHTML = rows.map((r) => `<tr>
      <td>${esc(r.am)}</td><td class="num">${r.customers}</td><td class="num">${r.scheduled}</td>
      <td class="num">${r.completed}</td><td class="num">${pct(r.rate)}</td></tr>`).join("") +
    `<tr><td><strong>Total</strong></td><td class="num"><strong>${total.customers}</strong></td>
      <td class="num"><strong>${total.scheduled}</strong></td><td class="num"><strong>${total.completed}</strong></td>
      <td class="num"><strong>${pct(total.rate)}</strong></td></tr>`;

  renderChart(rows);
}

function renderChart(rows) {
  const sorted = [...rows].sort((a, b) => b.rate - a.rate || a.am.localeCompare(b.am));
  const W = 760, labelW = 170, valueW = 48, rowH = 34, barH = 16, top = 8, axisH = 24;
  const plotW = W - labelW - valueW;
  const H = top + sorted.length * rowH + axisH;
  const x = (v) => labelW + v * plotW;
  const r = 4;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - axisH}"/>`).join("");
  const axis = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${pct(t)}</text>`).join("");

  const bars = sorted.map((d, i) => {
    const y = top + i * rowH + (rowH - barH) / 2;
    const w = d.rate * plotW;
    // Square at the baseline, 4px rounded at the data end.
    const path = w <= 0 ? "" : w < r
      ? `<rect class="bar" x="${labelW}" y="${y}" width="${w}" height="${barH}"/>`
      : `<path class="bar" d="M${labelW},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z"/>`;
    return `<g class="row" tabindex="0" data-i="${i}">
      <rect x="0" y="${top + i * rowH}" width="${W}" height="${rowH}" fill="transparent"/>
      <text class="cat" x="${labelW - 10}" y="${y + barH / 2}" dy=".35em" text-anchor="end"><tspan>${esc(d.am)}</tspan></text>
      ${path}
      <text class="val" x="${labelW + w + 6}" y="${y + barH / 2}" dy=".35em">${pct(d.rate)}</text>
    </g>`;
  }).join("");

  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Success rate by account manager, bar chart">
      <g class="grid">${grid}</g><g class="axis">${axis}</g><g class="cat">${bars}</g></svg>`;

  const tip = $("tooltip");
  $("chart").querySelectorAll(".row").forEach((g) => {
    const d = sorted[+g.dataset.i];
    const show = (ev) => {
      tip.innerHTML = `<strong>${esc(d.am)}</strong><br>${pct(d.rate)} success rate<br>
        ${d.completed} of ${d.customers} customers met · ${d.scheduled} scheduled`;
      tip.hidden = false;
      const rect = ev.type === "focus" ? g.getBoundingClientRect() : { left: ev.clientX, top: ev.clientY };
      tip.style.left = `${Math.min(rect.left + 12, window.innerWidth - 270)}px`;
      tip.style.top = `${rect.top + 14}px`;
    };
    g.addEventListener("mousemove", show);
    g.addEventListener("focus", show);
    g.addEventListener("mouseleave", () => (tip.hidden = true));
    g.addEventListener("blur", () => (tip.hidden = true));
  });
}

// ---------- customers ----------
function renderFilters() {
  const sel = $("f-am");
  const current = sel.value;
  const ams = [...new Set(state.customers.map((c) => c.account_manager))].sort();
  sel.innerHTML = `<option value="">All account managers</option>` + ams.map((a) => `<option>${esc(a)}</option>`).join("");
  sel.value = current;
}

function vmTable(c) {
  if (!c.vms.length) return "";
  const os = [...new Set(c.vms.map((v) => v.os_tools || v.os_config).filter(Boolean))];
  return `<details class="vms"><summary>${c.vms.length} VM${c.vms.length > 1 ? "s" : ""} · ${esc(os.join(", "))}</summary>
    <div class="table-wrap"><table class="data"><thead><tr><th>VM</th><th>Status</th><th>OS (config)</th><th>OS (VMware Tools)</th><th class="num">HW</th><th>AM notes</th></tr></thead><tbody>
    ${c.vms.map((v) => `<tr><td>${esc(v.vm_name || "(unnamed)")}</td>
      <td><span class="vm-status ${v.status || ""}">${v.status ? v.status[0].toUpperCase() + v.status.slice(1) : "Not set"}</span></td>
      <td>${esc(v.os_config)}</td><td>${esc(v.os_tools || "—")}</td><td class="num">${v.hw_version ?? ""}</td><td>${esc(v.am_notes)}</td></tr>`).join("")}
    </tbody></table></div></details>`;
}

function meetingEditor(c) {
  const m = c.meeting || {};
  return `<form class="meeting" data-id="${c.id}">
    <label>Nymbis attendee
      <select name="attendee" required>
        <option value="">Select…</option>
        ${ATTENDEES.map((a) => `<option ${m.attendee === a ? "selected" : ""}>${esc(a)}</option>`).join("")}
      </select></label>
    <label>Meeting date <input type="date" name="meeting_date" required value="${m.meeting_date || ""}"></label>
    <label class="check"><input type="checkbox" name="completed" ${m.completed ? "checked" : ""}> Meeting held</label>
    <label class="comment" ${m.completed ? "" : "hidden"}>Meeting comment
      <textarea name="comment" placeholder="What was discussed and agreed?">${esc(m.comment)}</textarea></label>
    <div class="actions">
      <button class="btn btn-accent" type="submit">Save</button>
      ${c.meeting ? `<button class="btn btn-ghost" type="button" data-action="clear" style="color:var(--ink-2)">Clear</button>` : ""}
      <span class="saved">${c.meeting ? `Last saved ${new Date(m.updated_at).toLocaleString("en-ZA")}${m.updated_by ? " by " + esc(m.updated_by) : ""}` : ""}</span>
    </div>
  </form>`;
}

function meetingReadonly(c) {
  const m = c.meeting;
  if (!m) return `<div class="meeting-ro">No meeting scheduled yet.</div>`;
  return `<div class="meeting-ro">Meeting with <strong>${esc(m.attendee)}</strong> on ${fmtDate(m.meeting_date)}${m.completed ? " — held" : ""}
    ${m.completed && m.comment ? `<div class="comment-text">${esc(m.comment)}</div>` : ""}</div>`;
}

function renderCustomers() {
  const q = $("f-search").value.trim().toLowerCase();
  const am = $("f-am").value;
  const ms = $("f-meeting").value;
  const list = state.customers.filter((c) =>
    (!am || c.account_manager === am) &&
    (!ms || meetingState(c) === ms) &&
    (!q || c.name.toLowerCase().includes(q) || c.vms.some((v) => (v.vm_name || "").toLowerCase().includes(q))));

  $("f-count").textContent = `${list.length} of ${state.customers.length} customers`;
  $("readonly-note").hidden = !!state.user;
  const labels = { none: "Not scheduled", scheduled: "Scheduled", completed: "Completed" };

  $("customer-list").innerHTML = list.map((c) => {
    const s = meetingState(c);
    return `<article class="cust ${s}">
      <div class="cust-head">
        <div><div class="cust-name">${esc(c.name)}</div><div class="cust-meta">Account manager: ${esc(c.account_manager)}</div></div>
        <span class="pill ${s}">${labels[s]}${c.meeting && !c.meeting.completed ? " · " + fmtDate(c.meeting.meeting_date) : ""}</span>
      </div>
      ${vmTable(c)}
      ${state.user ? meetingEditor(c) : meetingReadonly(c)}
    </article>`;
  }).join("") || `<p class="muted">No customers match these filters.</p>`;
}

function renderAll() {
  renderDashboard();
  renderFilters();
  renderCustomers();
}

// Toggle comment box when "Meeting held" is ticked.
$("customer-list").addEventListener("change", (e) => {
  if (e.target.name !== "completed") return;
  const box = e.target.form.querySelector(".comment");
  box.hidden = !e.target.checked;
  if (e.target.checked) box.querySelector("textarea").focus();
});

$("customer-list").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const completed = form.completed.checked;
  const comment = (f.get("comment") || "").trim();
  const savedEl = form.querySelector(".saved");
  if (completed && !comment) {
    savedEl.textContent = "Please add a comment about the meeting.";
    form.comment.focus();
    return;
  }
  form.querySelector("button[type=submit]").disabled = true;
  savedEl.textContent = "Saving…";
  const { error } = await sb.from("meetings").upsert({
    customer_id: +form.dataset.id,
    attendee: f.get("attendee"),
    meeting_date: f.get("meeting_date"),
    completed,
    comment: comment || null,
  }, { onConflict: "customer_id" });
  if (error) {
    savedEl.textContent = `Not saved: ${error.message}`;
    form.querySelector("button[type=submit]").disabled = false;
    return;
  }
  await load();
});

$("customer-list").addEventListener("click", async (e) => {
  if (e.target.dataset.action !== "clear") return;
  const form = e.target.closest("form");
  if (!confirm("Remove this meeting?")) return;
  const { error } = await sb.from("meetings").delete().eq("customer_id", +form.dataset.id);
  if (error) form.querySelector(".saved").textContent = `Not removed: ${error.message}`;
  else await load();
});

["f-search", "f-am", "f-meeting"].forEach((id) => $(id).addEventListener("input", renderCustomers));

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => {
    x.classList.toggle("active", x === t);
    x.setAttribute("aria-selected", x === t);
  });
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${t.dataset.view}`));
}));

// ---------- export ----------
$("export-btn").addEventListener("click", () => {
  if (!state.user) return setStatus("Please sign in to export.", true);
  if (!window.XLSX) return setStatus("Export library still loading, try again in a moment.", true);
  const { rows, total } = summarise();
  const wb = XLSX.utils.book_new();

  const dash = rows.map((r) => ({
    "Account manager": r.am, Customers: r.customers, "Meetings scheduled": r.scheduled,
    "Meetings completed": r.completed, "Success rate": Math.round(r.rate * 1000) / 10 + "%",
  }));
  dash.push({ "Account manager": "Total", Customers: total.customers, "Meetings scheduled": total.scheduled,
    "Meetings completed": total.completed, "Success rate": Math.round(total.rate * 1000) / 10 + "%" });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dash), "Dashboard");

  const meetings = state.customers.map((c) => ({
    "Account manager": c.account_manager, Customer: c.name, VMs: c.vms.length,
    "Operating systems": [...new Set(c.vms.map((v) => v.os_tools || v.os_config).filter(Boolean))].join(", "),
    "Meeting status": { none: "Not scheduled", scheduled: "Scheduled", completed: "Completed" }[meetingState(c)],
    "Nymbis attendee": c.meeting?.attendee || "", "Meeting date": c.meeting?.meeting_date || "",
    "Meeting held": c.meeting ? (c.meeting.completed ? "Yes" : "No") : "", Comment: c.meeting?.comment || "",
    "Last updated by": c.meeting?.updated_by || "",
    "Last updated": c.meeting ? new Date(c.meeting.updated_at).toLocaleString("en-ZA") : "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meetings), "Customers & meetings");

  const vms = state.customers.flatMap((c) => c.vms.map((v) => ({
    "Account manager": c.account_manager, Customer: c.name, VM: v.vm_name || "", Status: v.status || "",
    "OS (config file)": v.os_config || "", "OS (VMware Tools)": v.os_tools || "", "HW version": v.hw_version,
    "Contact date": v.contact_date || "", "AM notes": v.am_notes || "",
  })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vms), "VMs");

  XLSX.writeFile(wb, `OS Updates Campaign ${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// ---------- auth ----------
const dlg = $("login-dialog");
$("auth-btn").addEventListener("click", async () => {
  if (state.user) { await sb.auth.signOut(); return; }
  $("login-error").textContent = "";
  dlg.showModal();
});
$("login-cancel").addEventListener("click", () => dlg.close());
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({
    email: $("login-email").value.trim(), password: $("login-password").value,
  });
  if (error) { $("login-error").textContent = error.message; return; }
  dlg.close();
});

// Password change. When the account still has its starting password
// (user_metadata.must_change_password), the dialog is forced and can't be dismissed.
const pwDlg = $("pw-dialog");
let pwForced = false;
function openPasswordDialog(forced) {
  pwForced = forced;
  $("pw-form").reset();
  $("pw-cancel").hidden = forced;
  $("pw-title").textContent = forced ? "Set your own password" : "Change password";
  $("pw-intro").hidden = !forced;
  $("pw-msg").textContent = "";
  if (!pwDlg.open) pwDlg.showModal();
}
$("pw-btn").addEventListener("click", () => openPasswordDialog(false));
$("pw-cancel").addEventListener("click", () => pwDlg.close());
pwDlg.addEventListener("cancel", (e) => { if (pwForced) e.preventDefault(); }); // block Escape when forced
$("pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("pw-new").value;
  if (pw !== $("pw-confirm").value) { $("pw-msg").textContent = "The passwords don't match."; return; }
  const { error } = await sb.auth.updateUser({ password: pw, data: { must_change_password: false } });
  if (error) {
    $("pw-msg").textContent = /different from the old/i.test(error.message)
      ? "Please choose a password different from the starting one." : error.message;
    return;
  }
  pwForced = false;
  pwDlg.close();
  setStatus("Your password has been changed.");
});

sb.auth.onAuthStateChange((_event, session) => {
  state.user = session?.user || null;
  // Re-read the user from the server (a cached session may predate the flag). Deferred so we
  // don't call Supabase from inside its own auth callback.
  if (state.user) setTimeout(async () => {
    const { data } = await sb.auth.getUser();
    if (data?.user?.user_metadata?.must_change_password) openPasswordDialog(true);
  }, 0);
  $("pw-btn").hidden = !state.user;
  $("export-btn").hidden = !state.user;
  $("auth-btn").textContent = state.user ? "Sign out" : "Sign in";
  $("user-email").textContent = state.user?.email || "";
  if (state.customers.length) renderCustomers();
});

load();
