import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const ATTENDEES = ["Sean Rose", "Daniel Martins", "Jimmy Mokwena", "Jose van der Merwe", "Brendon Atwell"];

const state = { customers: [], user: null, role: null }; // role: admin | editor | viewer | null
const canEdit = () => state.role === "admin" || state.role === "editor";
const canExport = () => state.role === "admin";
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
  renderSchedule();
  renderAttendees();
}

// ---------- meetings by Nymbis attendee ----------
function attendeeSummary() {
  const rows = ATTENDEES.map((name) => {
    const list = state.customers.filter((c) => c.meeting?.attendee === name);
    const held = list.filter((c) => c.meeting.completed).length;
    return { name, total: list.length, held, upcoming: list.length - held, list };
  });
  const total = rows.reduce((t, r) => t + r.total, 0);
  rows.forEach((r) => (r.share = total ? r.total / total : 0));
  return { rows: rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)), total };
}

function renderAttendees() {
  const { rows, total } = attendeeSummary();
  if (!total) {
    $("attendee-chart").innerHTML = `<p class="empty-chart">No meetings booked yet.</p>`;
    return;
  }
  const W = 760, labelW = 170, valueW = 90, rowH = 34, barH = 16, top = 22, axisH = 24, gap = 2, r = 4;
  const plotW = W - labelW - valueW;
  const H = top + rows.length * rowH + axisH;
  const max = Math.max(...rows.map((d) => d.total));
  const step = max <= 8 ? 1 : Math.ceil(max / 6);
  const xMax = Math.ceil(max / step) * step;
  const x = (v) => labelW + (v / xMax) * plotW;
  const even = total / ATTENDEES.length;

  const ticks = [];
  for (let v = 0; v <= xMax; v += step) ticks.push(v);
  const grid = ticks.map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - axisH}"/>`).join("");
  const axis = ticks.map((v) => `<text x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`).join("");

  // Horizontal segment from a to b; only the rightmost segment gets the rounded data end.
  const seg = (cls, yy, a, b, roundEnd) => {
    if (b <= a) return "";
    const x0 = x(a) + (a > 0 ? gap : 0), w = x(b) - x0;
    if (w <= 0) return "";
    if (!roundEnd || w < r) return `<rect class="${cls}" x="${x0}" y="${yy}" width="${w}" height="${barH}"/>`;
    return `<path class="${cls}" d="M${x0},${yy} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z"/>`;
  };

  const bars = rows.map((d, i) => {
    const yy = top + i * rowH + (rowH - barH) / 2;
    return `<g class="col" tabindex="0" data-i="${i}">
      <rect x="0" y="${top + i * rowH}" width="${W}" height="${rowH}" fill="transparent"/>
      <text class="cat" x="${labelW - 10}" y="${yy + barH / 2}" dy=".35em" text-anchor="end">${esc(d.name)}</text>
      ${seg("bar-held", yy, 0, d.held, d.upcoming === 0)}
      ${seg("bar-upcoming", yy, d.held, d.total, true)}
      <text class="val" x="${x(d.total) + 6}" y="${yy + barH / 2}" dy=".35em">${d.total}<tspan class="share"> · ${pct(d.share)}</tspan></text>
    </g>`;
  }).join("");

  const evenMark = `<g class="even"><line x1="${x(even)}" x2="${x(even)}" y1="${top - 6}" y2="${H - axisH}"/>
    <text x="${x(even)}" y="${top - 10}" text-anchor="middle">Even split ${Math.round(even * 10) / 10}</text></g>`;

  $("attendee-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Meetings per Nymbis attendee, bar chart">
    <g class="grid">${grid}</g><g class="axis">${axis}</g><g class="cat">${bars}</g>${evenMark}</svg>`;

  $("attendee-chart").querySelectorAll(".col").forEach((g) => {
    const d = rows[+g.dataset.i];
    bindTooltip(g, () => {
      const vs = d.total - even;
      const cmp = Math.abs(vs) < 0.5 ? "about an even share" : `${Math.abs(Math.round(vs * 10) / 10)} ${vs > 0 ? "above" : "below"} an even share`;
      const list = d.list.slice(0, 8).map((c) => `${esc(c.name)} · ${fmtDate(c.meeting.meeting_date)}${c.meeting.completed ? " ✓" : ""}`).join("<br>");
      const more = d.list.length > 8 ? `<br>+${d.list.length - 8} more` : "";
      return `<strong>${esc(d.name)}</strong><br>${d.total} meeting${d.total === 1 ? "" : "s"} (${pct(d.share)}) · ${d.held} held<br>${cmp}${list ? "<br><br>" + list + more : ""}`;
    });
  });
}

// Hover/focus tooltip for any chart mark.
function bindTooltip(el, html) {
  const tip = $("tooltip");
  const show = (ev) => {
    tip.innerHTML = html();
    tip.hidden = false;
    const r = ev.type === "focus" ? el.getBoundingClientRect() : { left: ev.clientX, top: ev.clientY };
    tip.style.left = `${Math.min(r.left + 12, window.innerWidth - 270)}px`;
    tip.style.top = `${r.top + 14}px`;
  };
  el.addEventListener("mousemove", show);
  el.addEventListener("focus", show);
  el.addEventListener("mouseleave", () => (tip.hidden = true));
  el.addEventListener("blur", () => (tip.hidden = true));
}

// ---------- meetings by date ----------
const isoDay = (d) => d.toISOString().slice(0, 10);
const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

function renderSchedule() {
  const byDay = new Map();
  for (const c of state.customers) {
    const m = c.meeting;
    if (!m?.meeting_date) continue;
    if (!byDay.has(m.meeting_date)) byDay.set(m.meeting_date, []);
    byDay.get(m.meeting_date).push({ customer: c.name, am: c.account_manager, ...m });
  }

  if (!byDay.size) {
    $("schedule-chart").innerHTML = `<p class="empty-chart">No meetings booked yet.</p>`;
    $("schedule-rows").innerHTML = "";
    return;
  }

  // Continuous run of days from first to last meeting: weekdays always, weekends only if a meeting falls on one.
  const dates = [...byDay.keys()].sort();
  const days = [];
  for (let d = new Date(dates[0] + "T00:00:00Z"); isoDay(d) <= dates.at(-1); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = isoDay(d), dow = d.getUTCDay();
    if ((dow !== 0 && dow !== 6) || byDay.has(iso)) {
      const list = byDay.get(iso) || [];
      const held = list.filter((m) => m.completed).length;
      days.push({ iso, dow, list, held, upcoming: list.length - held });
    }
  }

  const W = 760, H = 230, left = 30, right = 8, top = 22, bottom = 40;
  const plotW = W - left - right, plotH = H - top - bottom;
  const max = Math.max(...days.map((d) => d.list.length));
  const step = max <= 6 ? 1 : Math.ceil(max / 5);
  const yMax = Math.ceil(max / step) * step;
  const y = (v) => top + plotH - (v / yMax) * plotH;
  const band = plotW / days.length;
  const barW = Math.max(4, Math.min(36, band * 0.6));
  const gap = 2, r = 4;
  const labelEvery = days.length > 30 ? 5 : days.length > 16 ? 2 : 1;
  const today = todayIso();
  const dayName = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short" });
  const dayNum = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

  const ticks = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);
  const grid = ticks.map((v) => `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/>`).join("");
  const yAxis = ticks.map((v) => `<text x="${left - 8}" y="${y(v)}" dy=".35em" text-anchor="end">${v}</text>`).join("");

  // A segment from value a to b; only the topmost segment gets the rounded data end.
  const seg = (cls, x, a, b, roundTop) => {
    if (b <= a) return "";
    const y0 = y(a) - (a > 0 ? gap : 0), y1 = y(b), h = y0 - y1;
    if (h <= 0) return "";
    if (!roundTop || h < r) return `<rect class="${cls}" x="${x}" y="${y1}" width="${barW}" height="${h}"/>`;
    return `<path class="${cls}" d="M${x},${y0} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z"/>`;
  };

  let todayMark = "";
  const cols = days.map((d, i) => {
    const cx = left + band * i + band / 2, x = cx - barW / 2;
    const total = d.list.length;
    if (d.iso === today) {
      todayMark = `<g class="today"><line x1="${cx}" x2="${cx}" y1="${top - 14}" y2="${top + plotH}"/>
        <text x="${cx + 4}" y="${top - 6}">Today</text></g>`;
    }
    const showLabel = i % labelEvery === 0 || d.iso === today;
    return `<g class="col" tabindex="${total ? 0 : -1}" data-i="${i}">
      <rect x="${left + band * i}" y="${top}" width="${band}" height="${plotH}" fill="transparent"/>
      ${seg("bar-held", x, 0, d.held, d.upcoming === 0)}
      ${seg("bar-upcoming", x, d.held, total, true)}
      ${total ? `<text class="val" x="${cx}" y="${y(total) - 6}" text-anchor="middle">${total}</text>` : ""}
      ${showLabel ? `<text class="xlab${d.iso === today ? " today-lab" : ""}" x="${cx}" y="${H - bottom + 16}" text-anchor="middle">${dayName(d.iso)}</text>
      <text class="xlab${d.iso === today ? " today-lab" : ""}" x="${cx}" y="${H - bottom + 30}" text-anchor="middle">${dayNum(d.iso)}</text>` : ""}
    </g>`;
  }).join("");

  $("schedule-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Meetings per day, column chart. A list version follows.">
    <g class="grid">${grid}</g><g class="axis">${yAxis}</g>${todayMark}${cols}</svg>`;

  $("schedule-chart").querySelectorAll(".col").forEach((g) => {
    const d = days[+g.dataset.i];
    if (!d.list.length) return;
    bindTooltip(g, () => {
      const names = d.list.slice(0, 8).map((m) => `${esc(m.customer)} · ${esc(m.attendee)}${m.completed ? " ✓" : ""}`).join("<br>");
      const more = d.list.length > 8 ? `<br>+${d.list.length - 8} more` : "";
      return `<strong>${fmtDate(d.iso)}</strong><br>${d.list.length} meeting${d.list.length > 1 ? "s" : ""} · ${d.held} held<br><br>${names}${more}`;
    });
  });

  $("schedule-rows").innerHTML = days.filter((d) => d.list.length).map((d) => `<tr>
      <td>${dayName(d.iso)} ${fmtDate(d.iso)}${d.iso === today ? " (today)" : ""}</td>
      <td class="num">${d.list.length}</td><td class="num">${d.held}</td>
      <td>${d.list.map((m) => `${esc(m.customer)} (${esc(m.attendee)})`).join("; ")}</td></tr>`).join("");
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
  $("readonly-note").hidden = canEdit();
  const labels = { none: "Not scheduled", scheduled: "Scheduled", completed: "Completed" };

  $("customer-list").innerHTML = list.map((c) => {
    const s = meetingState(c);
    return `<article class="cust ${s}">
      <div class="cust-head">
        <div><div class="cust-name">${esc(c.name)}</div><div class="cust-meta">Account manager: ${esc(c.account_manager)}</div></div>
        <span class="pill ${s}">${labels[s]}${c.meeting && !c.meeting.completed ? " · " + fmtDate(c.meeting.meeting_date) : ""}</span>
      </div>
      ${vmTable(c)}
      ${canEdit() ? meetingEditor(c) : meetingReadonly(c)}
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
  if (!canExport()) return setStatus("Export is restricted.", true);
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

  const att = attendeeSummary();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(att.rows.map((r) => ({
    "Nymbis attendee": r.name, Meetings: r.total, Held: r.held, "Not yet held": r.upcoming,
    "Share of meetings": Math.round(r.share * 1000) / 10 + "%",
  }))), "By attendee");

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
function openLogin() {
  $("login-error").textContent = "";
  dlg.showModal();
}
$("auth-btn").addEventListener("click", async () => {
  if (state.user) { await sb.auth.signOut(); return; }
  openLogin();
});
$("gate-btn").addEventListener("click", () => (state.user ? sb.auth.signOut() : openLogin()));

// Show the app only to signed-in users on the access list; everyone else sees the gate.
function applyAccess() {
  const allowed = !!state.role;
  $("gate").hidden = allowed;
  $("app-main").hidden = !allowed;
  document.querySelector(".tabs").hidden = !allowed;
  $("export-btn").hidden = !canExport();
  $("pw-btn").hidden = !state.user;
  $("auth-btn").textContent = state.user ? "Sign out" : "Sign in";
  $("auth-btn").hidden = !state.user; // the gate has its own sign-in button
  $("user-email").textContent = state.user ? `${state.user.email}${state.role ? ` · ${state.role}` : ""}` : "";
  $("gate-title").textContent = state.user ? "No access" : "Sign in to continue";
  $("gate-text").textContent = state.user
    ? "Your account isn't on the approved list for this dashboard. Ask Brendon Atwell for access."
    : "This dashboard is only available to approved users.";
  $("gate-btn").textContent = state.user ? "Sign out" : "Sign in";
}

async function onSignedIn() {
  const [{ data: u }, { data: access }] = await Promise.all([
    sb.auth.getUser(),
    sb.from("app_users").select("role").maybeSingle(),
  ]);
  state.role = access?.role || null;
  applyAccess();
  if (u?.user?.user_metadata?.must_change_password) openPasswordDialog(true);
  if (state.role) await load();
}
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

let lastUserId;
sb.auth.onAuthStateChange((event, session) => {
  const user = session?.user || null;
  // Token refreshes fire this too; only react when the signed-in person actually changes.
  if (event !== "INITIAL_SESSION" && (user?.id ?? null) === (lastUserId ?? null)) return;
  lastUserId = user?.id ?? null;
  state.user = user;
  state.role = null;
  state.customers = [];
  applyAccess();
  // Deferred so we don't call Supabase from inside its own auth callback.
  if (user) setTimeout(onSignedIn, 0);
});
