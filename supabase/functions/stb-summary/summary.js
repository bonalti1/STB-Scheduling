// Read-only summary of the STB scheduling boards and Change Orders, built from the raw
// rows exactly the way the apps compute them (same visible-task, progress, delay and
// payment rules). Plain JS so it runs in Deno (edge function) and in Node (tests).
import { PHASES, PHASE_TASKS } from './phase-tasks.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isoToday = () => new Date().toISOString().slice(0, 10);
const lower = (s) => String(s || '').toLowerCase();

// ── Scheduling board ────────────────────────────────────────
function visibleTasks(p, phase) {
  const deleted = (p.deletedPhaseTasks || {})[phase] || {};
  const custom = ((p.customPhaseTasks || {})[phase] || []).map((t) => (typeof t === 'string' ? t : t && t.text)).filter(Boolean);
  return (PHASE_TASKS[phase] || []).concat(custom).filter((t) => !deleted[lower(t)] && lower(t).trim() !== 'delay');
}
function taskState(p, phase, text) {
  const saved = ((p.phaseTaskState || {})[phase] || {})[lower(text)];
  if (saved && typeof saved === 'object') {
    let status = saved.status || (saved.today ? 'today' : saved.scheduled ? 'scheduled' : '');
    if (saved.done && !status) status = 'done';
    return { done: !!saved.done, status, sub: saved.sub || '', note: saved.note || '', undo: undoInfo(saved) };
  }
  return { done: !!saved, status: saved ? 'done' : '', sub: '', note: '' };
}
/* From the activity log: when a task was checked off and by whom. */
function completedBy(board, p, phase, text) {
  const log = (board && board.dailyLog) || {};
  let hit = null;
  Object.keys(log).sort().forEach((day) => (log[day] || []).forEach((e) => {
    if (e.projectId === p.id && e.type === 'task' && (e.phase || '') === phase && (e.task || '') === text && e.toDone) hit = e;
  }));
  return hit ? { at: hit.at, by: hit.by || undefined } : undefined;
}
function nextPhase(phase) { const i = PHASES.indexOf(phase); return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : ''; }
function daysBetween(a, b) { if (!a || !b) return null; return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

function phaseBlock(board, p, phase) {
  const tasks = visibleTasks(p, phase).map((text) => ({ text, ...taskState(p, phase, text) }));
  return {
    phase,
    done: tasks.filter((t) => t.done).length,
    total: tasks.length,
    tasks: tasks.map((t) => {
      const c = t.done ? completedBy(board, p, phase, t.text) : undefined;
      return { text: t.text, done: t.done, status: t.status || undefined, sub: t.sub || undefined, note: t.note || undefined,
        completedAt: c && c.at, completedBy: c && c.by, undo: t.undo };
    })
  };
}

/* Activity feed: every recorded action (who / when / what) for the last N days. The board
   logs checkbox and status changes, task deletions, delays, house removals/completions/
   restores, today's tasks, document uploads and address edits. */
export function activityFeed(board, area, days = 14, today = isoToday()) {
  const log = (board && board.dailyLog) || {};
  const from = new Date(today + 'T00:00:00'); from.setDate(from.getDate() - Math.max(0, days - 1));
  const fromIso = from.toISOString().slice(0, 10);
  const rows = [];
  Object.keys(log).filter((d) => d >= fromIso && d <= today).sort().forEach((day) => {
    (log[day] || []).forEach((e) => {
      const what = describeEntry(e);
      rows.push({ area, day, at: e.at || undefined, by: e.by || undefined, project: e.projectName, phase: e.phase || undefined, type: e.type || 'activity', task: e.task || undefined, action: what, note: e.note || undefined });
    });
  });
  return rows.sort((a, b) => String(a.at || a.day).localeCompare(String(b.at || b.day)));
}
function describeEntry(e) {
  const t = e.type || 'activity';
  if (t === 'task') {
    if (e.toStatus === 'deleted') return 'deleted task';
    if (e.toDone && !e.fromDone) return 'checked off';
    if (!e.toDone && e.fromDone) return 'un-checked' + (e.note ? '' : '');
    if (e.toStatus && e.toStatus !== e.fromStatus) return 'status → ' + e.toStatus;
    return 'updated task';
  }
  if (t === 'delay') return e.toStatus === 'resolved' ? 'delay resolved' : 'delay added';
  if (t === 'project') return { removed: 'house removed from board', completed: 'house moved to Completed', restored: 'house restored to board', address: 'address changed' }[e.toStatus] || 'house updated';
  if (t === 'daytask') return "today's task " + (e.toStatus || 'updated');
  if (t === 'document') return (e.task || 'document') + ' uploaded';
  return e.toStatus || 'activity';
}
/* Who un-checked a completed task and why (stored on the task itself). */
function undoInfo(st) {
  return st && st.undoAt ? { undoAt: st.undoAt, undoBy: st.undoBy || undefined, undoReason: st.undoReason || undefined } : undefined;
}

export function summarizeCompleted(list, today = isoToday()) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    area: c.area === 'alice' ? 'alice' : 'main', name: c.project && c.project.name, code: c.project && c.project.code || undefined,
    address: c.project && c.project.address || undefined, completedAt: c.completedAt, completedBy: c.completedBy || undefined
  }));
}
export function summarizeLessons(list) {
  return (Array.isArray(list) ? list : []).map((l) => ({ project: l.project || undefined, phase: l.phase || undefined, issue: l.issue, owner: l.owner || undefined, rootCause: l.root || undefined, prevention: l.prevent || undefined, system: l.system || undefined, source: l.source || undefined, at: l.at || l.createdAt || undefined }));
}

export function summarizeBoard(board, area, today = isoToday()) {
  const projects = (board && board.projects) || [];
  const out = projects.map((p) => {
    let total = 0, done = 0, workingToday = [], scheduled = [], alerts = [];
    PHASES.forEach((ph) => visibleTasks(p, ph).forEach((text) => {
      total++;
      const st = taskState(p, ph, text);
      if (st.done) done++;
      else if (st.status === 'today') workingToday.push({ phase: ph, task: text, sub: st.sub || undefined, note: st.note || undefined });
      else if (st.status === 'scheduled') scheduled.push({ phase: ph, task: text, sub: st.sub || undefined, note: st.note || undefined });
      else if (st.status === 'alert') alerts.push({ phase: ph, task: text, sub: st.sub || undefined, note: st.note || undefined });
    }));
    const delays = (p.delays || []).map((d) => ({
      phase: d.phase, reason: d.reason, responsible: d.responsible || undefined, impactDays: Number(d.impact) || 0,
      status: d.status || 'Open', by: d.by || undefined, createdAt: d.createdAt || undefined
    }));
    const removed = p.dayTasksRemoved || {};
    const todaysTasks = (p.dayTasks || []).filter((t) => t && t.id && !removed[t.id] && (!t.done || t.doneOn === today)).map((t) => ({
      text: t.text, done: !!t.done, by: t.by || undefined, added: t.added || undefined,
      doneOn: t.done ? t.doneOn || undefined : undefined, doneBy: t.done ? t.doneBy || undefined : undefined,
      daysOpen: t.done ? 0 : Math.max(0, daysBetween(t.added, today) || 0)
    }));
    const phase = p.phase || 'Pre Phase';
    const sqft = p.budget && Number(p.budget.squareFeet) || 0;
    return {
      area, id: p.id, name: p.name, code: p.code || undefined, address: p.address || undefined,
      squareFeet: sqft && !(sqft === 2200 && !(p.budget && p.budget.squareFeetKnown)) ? sqft : undefined,
      currentPhase: phase,
      progressPct: total ? Math.round((done / total) * 100) : 0, tasksDone: done, tasksTotal: total,
      noWorkToday: workingToday.length === 0,
      startDate: p.startDate || undefined, goalDate: p.goalDate || undefined,
      daysSinceStart: p.startDate ? daysBetween(p.startDate, today) : undefined,
      workingToday, scheduled, alerts,
      openDelays: delays.filter((d) => d.status !== 'Resolved'),
      resolvedDelays: delays.filter((d) => d.status === 'Resolved').length,
      todaysTasks,
      currentPhaseChecklist: phaseBlock(board, p, phase),
      nextPhase: nextPhase(phase) ? phaseBlock(board, p, nextPhase(phase)) : undefined,
      allPhases: PHASES.map((ph) => { const b = phaseBlock(board, p, ph); return { phase: ph, done: b.done, total: b.total }; }),
      links: { render: p.renderImage || undefined, blueprint: p.blueprintUrl || undefined, windstorm: p.windstormUrl || undefined, selections: p.selectionsUrl || undefined }
    };
  });
  return { area, boardDay: (board && board.dayDate) || undefined, projects: out };
}

// ── Change Orders (Cobros) ──────────────────────────────────
function planDe(co) {
  const p = (co && co.plan) || {};
  if (p.tipo === 'una' || p.tipo === 'varios' || p.tipo === 'final') return p;
  if (p.tipo === 'mensual' || p.tipo === 'quincenal') return { tipo: 'varios', numPagos: p.numPagos || (co.cuotas || []).length || 2, frecuencia: p.tipo, fechaInicio: p.fechaInicio || '' };
  return { tipo: 'una', plazoDias: 30 };
}
function planText(plan) {
  if (plan.tipo === 'final') return 'Due at end of construction';
  if (plan.tipo === 'varios') return `${plan.numPagos} payments · ${{ semanal: 'weekly', quincenal: 'biweekly', mensual: 'monthly' }[plan.frecuencia || 'mensual']}`;
  return `Single payment · ${plan.plazoDias == null ? 30 : plan.plazoDias} days after signing`;
}
function installmentStates(co, project, today) {
  const plan = planDe(co);
  let remaining = (co.pagos || []).reduce((s, x) => s + (Number(x.monto) || 0), 0);
  return (co.cuotas || []).map((c) => {
    let due = c.fecha || '', open = false;
    if (plan.tipo === 'final') { if (project.terminado) due = project.terminadoFecha || due || today; else open = true; }
    let status;
    if (remaining >= c.monto - 0.005) { status = 'paid'; remaining -= c.monto; }
    else if (remaining > 0.005) { status = 'partial'; remaining = 0; }
    else status = (!open && due && due < today) ? 'overdue' : 'pending';
    return { num: c.num, dueDate: open ? undefined : due || undefined, dueOnCompletion: open || undefined, amount: r2(c.monto), status };
  });
}
export function summarizeCobros(data, today = isoToday()) {
  const projects = (data && data.proyectos) || [];
  const out = projects.map((p) => {
    const cos = (p.changeOrders || []).map((co) => {
      const paid = r2((co.pagos || []).reduce((s, x) => s + (Number(x.monto) || 0), 0));
      const inst = installmentStates(co, p, today);
      const overdueAmt = r2(inst.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.amount, 0) + inst.filter((i) => i.status === 'partial' && i.dueDate && i.dueDate < today).reduce((s, i) => s + i.amount, 0));
      const plan = planDe(co);
      return {
        description: co.descripcion, amount: r2(co.monto), paid, balance: r2(Math.max(0, co.monto - paid)), overdue: overdueAmt,
        signedOn: co.fechaFirma || undefined, plan: planText(plan),
        estimatedCompletion: plan.tipo === 'final' && plan.fechaEstimada ? plan.fechaEstimada : undefined,
        installments: inst,
        payments: (co.pagos || []).map((g) => ({ date: g.fecha, amount: r2(g.monto), method: g.metodo, note: g.nota || undefined, by: g.registradoPor || undefined }))
      };
    });
    const pending = (p.contratos || []).filter((c) => c.estado === 'pendiente').map((c) => ({ description: c.descripcion, amount: r2(c.monto), createdBy: c.creadoPor, created: c.creado }));
    const total = r2(cos.reduce((s, c) => s + c.amount, 0)), paid = r2(cos.reduce((s, c) => s + c.paid, 0)), overdue = r2(cos.reduce((s, c) => s + c.overdue, 0));
    return {
      family: p.familia, number: p.numero || undefined, address: p.direccion || undefined,
      projectFinished: !!p.terminado, finishedOn: p.terminadoFecha || undefined,
      total, paid, balance: r2(Math.max(0, total - paid)), overdue,
      status: !cos.length ? 'current' : paid >= total - 0.005 ? 'paid' : overdue > 0.005 ? 'overdue' : 'current',
      changeOrders: cos, contractsAwaitingSignature: pending
    };
  });
  return { projects: out, totals: { receivable: r2(out.reduce((s, p) => s + p.balance, 0)), overdue: r2(out.reduce((s, p) => s + p.overdue, 0)) } };
}

// ── Plain-text digest (easy for a bot to read) ──────────────
export function digest(summary) {
  const L = [];
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  L.push(`STB DAILY SUMMARY — ${summary.generatedAt.slice(0, 10)}`);
  for (const b of summary.boards) {
    L.push('', `== ${b.area.toUpperCase()} BOARD · ${b.projects.length} active houses ==`);
    for (const p of b.projects) {
      L.push(`• ${p.name}${p.code ? ' (' + p.code + ')' : ''} · ${p.currentPhase} · ${p.progressPct}% (${p.tasksDone}/${p.tasksTotal})${p.address ? ' · ' + p.address : ''}${p.noWorkToday ? ' · NO WORK TODAY' : ''}`);
      if (p.workingToday.length) L.push(`   Working today: ${p.workingToday.map((t) => t.task + (t.sub ? ' — ' + t.sub : '')).join('; ')}`);
      if (p.scheduled.length) L.push(`   Scheduled: ${p.scheduled.map((t) => t.task).join('; ')}`);
      if (p.alerts.length) L.push(`   ALERTS: ${p.alerts.map((t) => t.task + (t.note ? ' (' + t.note + ')' : '')).join('; ')}`);
      if (p.openDelays.length) L.push(`   Open delays: ${p.openDelays.map((d) => d.reason + (d.responsible ? ' — ' + d.responsible : '') + (d.impactDays ? ' (' + d.impactDays + 'd)' : '')).join('; ')}`);
      const open = p.todaysTasks.filter((t) => !t.done);
      if (open.length) L.push(`   Today's tasks: ${open.map((t) => t.text + (t.daysOpen ? ' [' + t.daysOpen + 'd open]' : '')).join('; ')}`);
      const pend = p.currentPhaseChecklist.tasks.filter((t) => !t.done).slice(0, 6).map((t) => t.text);
      if (pend.length) L.push(`   Still pending in ${p.currentPhase}: ${pend.join('; ')}${p.currentPhaseChecklist.total - p.currentPhaseChecklist.done > 6 ? '; …' : ''}`);
    }
  }
  if (summary.activity && summary.activity.length) {
    L.push('', `== ACTIVITY · last ${summary.activityDays} days · ${summary.activity.length} entries ==`);
    for (const a of summary.activity.slice(-80)) {
      const when = a.at ? a.at.replace('T', ' ').slice(0, 16) : a.day;
      L.push(`${when} · ${a.by || '?'} · ${a.project}${a.phase ? ' · ' + a.phase : ''} · ${a.action}${a.task ? ': ' + a.task : ''}${a.note ? ' (' + a.note + ')' : ''}`);
    }
  }
  if (summary.completedHouses && summary.completedHouses.length) {
    L.push('', `== COMPLETED HOUSES · ${summary.completedHouses.length} ==`);
    for (const h of summary.completedHouses) L.push(`• ${h.name}${h.code ? ' (' + h.code + ')' : ''} · ${h.area} · completed ${String(h.completedAt).slice(0, 10)}${h.completedBy ? ' by ' + h.completedBy : ''}`);
  }
  if (summary.changeOrders) {
    const c = summary.changeOrders;
    L.push('', `== CHANGE ORDERS · receivable ${money(c.totals.receivable)} · overdue ${money(c.totals.overdue)} ==`);
    for (const p of c.projects) {
      if (!p.changeOrders.length && !p.contractsAwaitingSignature.length) continue;
      L.push(`• ${p.family}${p.number ? ' (' + p.number + ')' : ''} · ${p.status.toUpperCase()} · total ${money(p.total)} · paid ${money(p.paid)} · balance ${money(p.balance)}${p.overdue ? ' · OVERDUE ' + money(p.overdue) : ''}${p.projectFinished ? ' · finished ' + p.finishedOn : ''}`);
      for (const co of p.changeOrders) {
        const next = co.installments.find((i) => i.status !== 'paid');
        L.push(`   - ${co.description}: ${money(co.amount)} · ${co.plan}${co.signedOn ? ' · signed ' + co.signedOn : ' · NOT SIGNED'} · balance ${money(co.balance)}${next ? ' · next: #' + next.num + ' ' + money(next.amount) + (next.dueDate ? ' due ' + next.dueDate : ' on completion') + ' (' + next.status + ')' : ''}`);
      }
      for (const ct of p.contractsAwaitingSignature) L.push(`   - awaiting signature: ${ct.description} ${money(ct.amount)}`);
    }
  }
  return L.join('\n');
}
