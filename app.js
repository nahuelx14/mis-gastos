(() => {
  'use strict';

  // ===================================================================
  //  Configuración
  // ===================================================================
  const CATEGORIAS = {
    comida:          { label: 'Comida',               icon: '🍔', color: '#f97316' },
    transporte:      { label: 'Transporte',           icon: '🚌', color: '#3b82f6' },
    servicios:       { label: 'Servicios',            icon: '💡', color: '#eab308' },
    salidas:         { label: 'Salidas',              icon: '🎉', color: '#ec4899' },
    tarjeta_credito: { label: 'Tarjeta de crédito',   icon: '💳', color: '#8b5cf6' },
    credito_mp:      { label: 'Crédito Mercado Pago', icon: '🤝', color: '#06b6d4' },
  };

  const MEDIOS_PAGO = ['Efectivo', 'Débito', 'Tarjeta de crédito', 'Mercado Pago', 'Transferencia'];

  // Cotizaciones de https://dolarapi.com (casa -> etiqueta)
  const DOLAR_TIPOS = [
    { casa: 'oficial', label: 'Oficial' },
    { casa: 'tarjeta', label: 'Tarjeta' },
    { casa: 'bolsa',   label: 'MEP' },
    { casa: 'blue',    label: 'Blue' },
  ];

  const cfg = window.APP_CONFIG || {};
  const USE_SUPABASE = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  // ===================================================================
  //  Helpers
  // ===================================================================
  const $ = (sel) => document.querySelector(sel);
  const fmtARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
  const fmtUSD = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const fmtARSShort = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', notation: 'compact', maximumFractionDigits: 1 });

  const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const currentMonth = () => todayISO().slice(0, 7);
  const monthKey = (fecha) => String(fecha).slice(0, 7);
  const shiftMonth = (key, delta) => {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const monthLabel = (key, short = false) => {
    const [y, m] = key.split('-').map(Number);
    const opts = short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' };
    const s = new Date(y, m - 1, 1).toLocaleDateString('es-AR', opts);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const fmtDate = (fecha) => {
    const [y, m, d] = String(fecha).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  };

  /** Valor del gasto expresado en pesos (USD × cotización pagada). */
  const arsValue = (g) => (g.moneda === 'USD'
    ? Number(g.monto) * Number(g.cotizacion || 0)
    : Number(g.monto));

  const sum = (arr, fn) => arr.reduce((acc, x) => acc + fn(x), 0);
  const catInfo = (key) => CATEGORIAS[key] || { label: key, icon: '•', color: '#64748b' };
  const newId = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function toast(msg, type = 'ok') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // ===================================================================
  //  Almacenamiento: Supabase (nube) o localStorage (demo)
  // ===================================================================
  function createSupabaseStore() {
    const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const TABLE = 'gastos';
    const check = ({ data, error }) => { if (error) throw error; return data; };

    return {
      client,
      async getSession() {
        const { data } = await client.auth.getSession();
        return data.session;
      },
      async signIn(email, password) {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signOut() { await client.auth.signOut(); },
      async list() {
        // Supabase devuelve como máximo 1000 filas por pedido -> paginamos.
        const PAGE = 1000;
        const all = [];
        for (let from = 0; ; from += PAGE) {
          const rows = check(await client.from(TABLE).select('*')
            .order('fecha', { ascending: false })
            .range(from, from + PAGE - 1));
          all.push(...rows);
          if (rows.length < PAGE) break;
        }
        return all;
      },
      async create(g) { return check(await client.from(TABLE).insert(g).select().single()); },
      async update(id, g) { return check(await client.from(TABLE).update(g).eq('id', id).select().single()); },
      async remove(id) { check(await client.from(TABLE).delete().eq('id', id)); },
    };
  }

  function createLocalStore() {
    const KEY = 'mis-gastos-demo';
    const read = () => JSON.parse(localStorage.getItem(KEY) || '[]');
    const write = (arr) => localStorage.setItem(KEY, JSON.stringify(arr));

    return {
      async getSession() { return { local: true }; },
      async signIn() {},
      async signOut() {},
      async list() { return read(); },
      async create(g) {
        const row = { ...g, id: newId(), created_at: new Date().toISOString() };
        write([...read(), row]);
        return row;
      },
      async update(id, g) {
        const arr = read();
        const i = arr.findIndex((x) => x.id === id);
        arr[i] = { ...arr[i], ...g };
        write(arr);
        return arr[i];
      },
      async remove(id) { write(read().filter((x) => x.id !== id)); },
    };
  }

  // ===================================================================
  //  Estado
  // ===================================================================
  let store;
  const state = {
    gastos: [],
    period: currentMonth(), // 'YYYY-MM' o 'all'
    editingId: null,
    visible: [],            // filas que se ven en la tabla (para exportar)
  };
  const charts = { cat: null, month: null };
  let dolarCache = null;

  // ===================================================================
  //  Render
  // ===================================================================
  function sortGastos() {
    state.gastos.sort((a, b) => (
      String(b.fecha).localeCompare(String(a.fecha))
      || String(b.created_at || '').localeCompare(String(a.created_at || ''))
    ));
  }

  const periodList = () => (state.period === 'all'
    ? state.gastos
    : state.gastos.filter((g) => monthKey(g.fecha) === state.period));

  function render() {
    sortGastos();
    renderPeriodOptions();
    const list = periodList();
    renderStats(list);
    renderCategoryChart(list);
    renderMonthChart();
    renderTable(list);
  }

  function renderPeriodOptions() {
    const months = new Set(state.gastos.map((g) => monthKey(g.fecha)));
    months.add(currentMonth());
    if (state.period !== 'all') months.add(state.period);
    const sorted = [...months].sort().reverse();

    $('#period-select').innerHTML = sorted
      .map((m) => `<option value="${m}">${monthLabel(m)}</option>`)
      .join('') + '<option value="all">Todo el historial</option>';
    $('#period-select').value = state.period;
  }

  function renderStats(list) {
    const total = sum(list, arsValue);
    const usdList = list.filter((g) => g.moneda === 'USD');
    const usdTotal = sum(usdList, (g) => Number(g.monto));
    const usdEnPesos = sum(usdList, arsValue);

    // Total
    $('#stat-total').textContent = fmtARS.format(total);
    const subTotal = $('#stat-total-sub');
    subTotal.className = 'stat-sub';
    subTotal.textContent = state.period === 'all' ? 'Todo el historial' : monthLabel(state.period);
    if (state.period !== 'all') {
      const prevKey = shiftMonth(state.period, -1);
      const prev = sum(state.gastos.filter((g) => monthKey(g.fecha) === prevKey), arsValue);
      if (prev > 0) {
        const pct = Math.round(((total - prev) / prev) * 100);
        subTotal.textContent = `${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}% vs ${monthLabel(prevKey)}`;
        if (pct !== 0) subTotal.classList.add(pct > 0 ? 'up' : 'down');
      }
    }

    // USD
    $('#stat-usd').textContent = fmtUSD.format(usdTotal);
    $('#stat-usd-sub').textContent = usdTotal > 0
      ? `≈ ${fmtARS.format(usdEnPesos)} · cot. prom. ${fmtARS.format(usdEnPesos / usdTotal)}`
      : 'Sin gastos en dólares';

    // Cantidad
    $('#stat-count').textContent = String(list.length);
    $('#stat-count-sub').textContent = list.length ? `Promedio ${fmtARS.format(total / list.length)} por gasto` : '';

    // Categoría principal
    const porCat = Object.keys(CATEGORIAS)
      .map((k) => ({ k, v: sum(list.filter((g) => g.categoria === k), arsValue) }))
      .sort((a, b) => b.v - a.v);
    const top = porCat[0];
    if (top && top.v > 0) {
      const c = catInfo(top.k);
      $('#stat-top').textContent = `${c.icon} ${c.label}`;
      $('#stat-top-sub').textContent = `${fmtARS.format(top.v)} · ${Math.round((top.v / total) * 100)}% del total`;
    } else {
      $('#stat-top').textContent = '—';
      $('#stat-top-sub').textContent = '';
    }
  }

  function setupChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = '#8b98ad';
    Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  }

  function renderCategoryChart(list) {
    if (!window.Chart) return;
    const keys = Object.keys(CATEGORIAS);
    const totals = keys.map((k) => sum(list.filter((g) => g.categoria === k), arsValue));
    const empty = totals.every((t) => t === 0);

    $('#chart-cat-title').textContent = state.period === 'all'
      ? 'Por categoría · todo'
      : `Por categoría · ${monthLabel(state.period)}`;
    $('#chart-cat-empty').hidden = !empty;
    $('#chart-cat').style.visibility = empty ? 'hidden' : 'visible';

    const data = {
      labels: keys.map((k) => CATEGORIAS[k].label),
      datasets: [{
        data: totals,
        backgroundColor: keys.map((k) => CATEGORIAS[k].color),
        borderColor: '#121925',
        borderWidth: 3,
        hoverOffset: 6,
      }],
    };

    if (charts.cat) {
      charts.cat.data = data;
      charts.cat.update();
      return;
    }
    charts.cat = new Chart($('#chart-cat'), {
      type: 'doughnut',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const tot = sum(ctx.dataset.data, (x) => x);
                const pct = tot ? Math.round((ctx.raw / tot) * 100) : 0;
                return ` ${fmtARS.format(ctx.raw)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  function renderMonthChart() {
    if (!window.Chart) return;
    const end = state.period === 'all' ? currentMonth() : state.period;
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(end, i - 11));

    const datasets = Object.entries(CATEGORIAS).map(([k, c]) => ({
      label: c.label,
      backgroundColor: c.color,
      borderRadius: 4,
      data: months.map((m) => sum(
        state.gastos.filter((g) => g.categoria === k && monthKey(g.fecha) === m),
        arsValue,
      )),
    }));
    const data = { labels: months.map((m) => monthLabel(m, true)), datasets };

    if (charts.month) {
      charts.month.data = data;
      charts.month.update();
      return;
    }
    charts.month = new Chart($('#chart-month'), {
      type: 'bar',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, ticks: { callback: (v) => fmtARSShort.format(v) } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12, usePointStyle: true } },
          tooltip: {
            filter: (item) => item.raw > 0,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtARS.format(ctx.raw)}`,
              footer: (items) => `Total: ${fmtARS.format(sum(items, (i) => i.raw))}`,
            },
          },
        },
      },
    });
  }

  function renderTable(list) {
    const q = $('#f-search').value.trim().toLowerCase();
    const cat = $('#f-cat').value;
    const mon = $('#f-moneda').value;

    const rows = list.filter((g) => (
      (!cat || g.categoria === cat)
      && (!mon || g.moneda === mon)
      && (!q || `${g.descripcion} ${g.nota || ''} ${g.medio_pago || ''}`.toLowerCase().includes(q))
    ));
    state.visible = rows;

    $('#table-count').textContent = `${rows.length} gasto${rows.length === 1 ? '' : 's'} · ${fmtARS.format(sum(rows, arsValue))}`;

    const tbody = $('#tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No hay gastos para mostrar</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((g) => {
      const c = catInfo(g.categoria);
      const monto = g.moneda === 'USD'
        ? `<div class="amount usd">${fmtUSD.format(g.monto)}</div>
           <div class="amount-sub">dólar a ${fmtARS.format(g.cotizacion)} = ${fmtARS.format(arsValue(g))}</div>`
        : `<div class="amount">${fmtARS.format(g.monto)}</div>`;

      return `<tr>
        <td data-label="Fecha">${fmtDate(g.fecha)}</td>
        <td data-label="Descripción">
          <div class="desc">${escapeHtml(g.descripcion)}</div>
          ${g.nota ? `<div class="note">${escapeHtml(g.nota)}</div>` : ''}
        </td>
        <td data-label="Categoría"><span class="chip" style="--c:${c.color}">${c.icon} ${escapeHtml(c.label)}</span></td>
        <td data-label="Medio">${escapeHtml(g.medio_pago || '—')}</td>
        <td data-label="Monto" class="num">${monto}</td>
        <td class="actions">
          <button class="icon-btn" data-edit="${g.id}" title="Editar" aria-label="Editar">✏️</button>
          <button class="icon-btn danger" data-del="${g.id}" title="Borrar" aria-label="Borrar">🗑️</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ===================================================================
  //  Formulario
  // ===================================================================
  const getMoneda = () => document.querySelector('input[name="moneda"]:checked').value;

  function syncMonedaUI() {
    const usd = getMoneda() === 'USD';
    $('#usd-box').hidden = !usd;
    $('#in-cotizacion').required = usd;
    $('#monto-prefix').textContent = usd ? 'US$' : '$';
    if (usd) loadDolar();
    updateEquivalente();
  }

  function updateEquivalente() {
    const monto = parseFloat($('#in-monto').value);
    const cot = parseFloat($('#in-cotizacion').value);
    $('#equivalente').textContent = monto > 0 && cot > 0
      ? `${fmtUSD.format(monto)} × ${fmtARS.format(cot)} = ${fmtARS.format(monto * cot)}`
      : '';
    document.querySelectorAll('.chip-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.cot) === cot);
    });
  }

  async function loadDolar() {
    if (dolarCache) return;
    const box = $('#dolar-chips');
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares');
      if (!res.ok) throw new Error(res.statusText);
      const arr = await res.json();
      dolarCache = Object.fromEntries(arr.map((d) => [d.casa, d]));
      box.innerHTML = DOLAR_TIPOS
        .filter((t) => dolarCache[t.casa] && dolarCache[t.casa].venta)
        .map((t) => `<button type="button" class="chip-btn" data-cot="${dolarCache[t.casa].venta}">
            ${t.label} <b>${fmtARS.format(dolarCache[t.casa].venta)}</b></button>`)
        .join('');
      updateEquivalente();
    } catch (err) {
      console.warn('No se pudo obtener la cotización', err);
      box.innerHTML = '<span class="hint">No se pudo obtener la cotización de hoy. Ingresala a mano.</span>';
    }
  }

  function resetForm() {
    $('#expense-form').reset();
    $('#in-fecha').value = todayISO();
    $('#m-ars').checked = true;
    state.editingId = null;
    $('#form-title').textContent = 'Nuevo gasto';
    $('#save-btn').textContent = 'Guardar gasto';
    $('#cancel-btn').hidden = true;
    syncMonedaUI();
  }

  function startEdit(id) {
    const g = state.gastos.find((x) => x.id === id);
    if (!g) return;
    state.editingId = id;
    $('#in-fecha').value = String(g.fecha).slice(0, 10);
    $('#in-desc').value = g.descripcion;
    $('#in-cat').value = g.categoria;
    $('#in-medio').value = g.medio_pago || '';
    $('#in-nota').value = g.nota || '';
    $('#in-monto').value = g.monto;
    (g.moneda === 'USD' ? $('#m-usd') : $('#m-ars')).checked = true;
    $('#in-cotizacion').value = g.cotizacion || '';
    $('#form-title').textContent = 'Editar gasto';
    $('#save-btn').textContent = 'Guardar cambios';
    $('#cancel-btn').hidden = false;
    syncMonedaUI();
    $('#expense-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#in-desc').focus({ preventScroll: true });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const moneda = getMoneda();
    const monto = parseFloat($('#in-monto').value);
    const cotizacion = parseFloat($('#in-cotizacion').value);

    if (!(monto > 0)) return toast('Ingresá un monto válido', 'error');
    if (moneda === 'USD' && !(cotizacion > 0)) return toast('Ingresá la cotización del dólar', 'error');

    const payload = {
      fecha: $('#in-fecha').value,
      descripcion: $('#in-desc').value.trim(),
      categoria: $('#in-cat').value,
      medio_pago: $('#in-medio').value || null,
      moneda,
      monto,
      cotizacion: moneda === 'USD' ? cotizacion : null,
      nota: $('#in-nota').value.trim() || null,
    };

    const btn = $('#save-btn');
    btn.disabled = true;
    try {
      if (state.editingId) {
        const row = await store.update(state.editingId, payload);
        state.gastos = state.gastos.map((g) => (g.id === row.id ? row : g));
        toast('Gasto actualizado ✔');
      } else {
        const row = await store.create(payload);
        state.gastos.push(row);
        toast('Gasto guardado ✔');
      }
      // Mostrar el mes del gasto recién guardado
      if (state.period !== 'all') state.period = monthKey(payload.fecha);
      resetForm();
      render();
    } catch (err) {
      console.error(err);
      toast(`Error al guardar: ${err.message || err}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function onDelete(id) {
    const g = state.gastos.find((x) => x.id === id);
    if (!g || !confirm(`¿Borrar "${g.descripcion}" del ${fmtDate(g.fecha)}?`)) return;
    try {
      await store.remove(id);
      state.gastos = state.gastos.filter((x) => x.id !== id);
      if (state.editingId === id) resetForm();
      render();
      toast('Gasto borrado');
    } catch (err) {
      console.error(err);
      toast(`Error al borrar: ${err.message || err}`, 'error');
    }
  }

  // ===================================================================
  //  Exportar CSV (formato amigable con Excel en español)
  // ===================================================================
  function exportCSV() {
    const rows = state.visible;
    if (!rows.length) return toast('No hay gastos para exportar', 'error');

    const num = (n) => (n == null || n === '' ? '' : String(Number(n).toFixed(2)).replace('.', ','));
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Fecha', 'Descripción', 'Categoría', 'Medio de pago', 'Moneda', 'Monto', 'Cotización USD', 'Total en ARS', 'Nota'];
    const lines = rows.map((g) => [
      fmtDate(g.fecha), g.descripcion, catInfo(g.categoria).label, g.medio_pago || '',
      g.moneda, num(g.monto), num(g.cotizacion), num(arsValue(g)), g.nota || '',
    ].map(cell).join(';'));

    const csv = '\uFEFF' + [header.map(cell).join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gastos_${state.period === 'all' ? 'historial' : state.period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ===================================================================
  //  Vistas: login / app
  // ===================================================================
  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    $('#login-email').focus();
  }

  async function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    try {
      state.gastos = await store.list();
    } catch (err) {
      console.error(err);
      toast(`No se pudieron cargar los gastos: ${err.message || err}`, 'error');
      state.gastos = [];
    }
    render();
  }

  async function onLogin(e) {
    e.preventDefault();
    const btn = $('#login-btn');
    const errEl = $('#login-error');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Ingresando…';
    try {
      await store.signIn($('#login-email').value.trim(), $('#login-password').value);
      $('#login-password').value = '';
      await showApp();
    } catch (err) {
      errEl.textContent = err.message === 'Invalid login credentials'
        ? 'Email o contraseña incorrectos'
        : (err.message || 'No se pudo ingresar');
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  }

  // ===================================================================
  //  Inicio
  // ===================================================================
  function fillSelects() {
    const catOptions = Object.entries(CATEGORIAS)
      .map(([k, c]) => `<option value="${k}">${c.icon} ${c.label}</option>`).join('');
    $('#in-cat').innerHTML = catOptions;
    $('#f-cat').innerHTML = '<option value="">Todas las categorías</option>' + catOptions;
    $('#in-medio').innerHTML = '<option value="">— Elegir —</option>'
      + MEDIOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('');
  }

  function bindEvents() {
    $('#login-form').addEventListener('submit', onLogin);
    $('#expense-form').addEventListener('submit', onSubmit);
    $('#cancel-btn').addEventListener('click', resetForm);
    document.querySelectorAll('input[name="moneda"]').forEach((r) => r.addEventListener('change', syncMonedaUI));
    $('#in-monto').addEventListener('input', updateEquivalente);
    $('#in-cotizacion').addEventListener('input', updateEquivalente);

    $('#dolar-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cot]');
      if (!btn) return;
      $('#in-cotizacion').value = btn.dataset.cot;
      updateEquivalente();
    });

    $('#tbody').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (edit) startEdit(edit.dataset.edit);
      if (del) onDelete(del.dataset.del);
    });

    $('#period-select').addEventListener('change', (e) => { state.period = e.target.value; render(); });
    ['#f-search', '#f-cat', '#f-moneda'].forEach((sel) => {
      $(sel).addEventListener('input', () => renderTable(periodList()));
    });
    $('#export-btn').addEventListener('click', exportCSV);

    $('#logout-btn').addEventListener('click', async () => {
      await store.signOut();
      state.gastos = [];
      showLogin();
    });
  }

  async function init() {
    setupChartDefaults();
    fillSelects();
    bindEvents();
    resetForm();

    const badge = $('#mode-badge');
    if (USE_SUPABASE && window.supabase) {
      store = createSupabaseStore();
      badge.textContent = '☁ Nube';
      $('#logout-btn').hidden = false;
      store.client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') showLogin();
      });
      const session = await store.getSession();
      if (!session) return showLogin();
    } else {
      store = createLocalStore();
      badge.textContent = 'Modo demo';
      badge.classList.add('demo');
      $('#demo-notice').hidden = false;
    }
    showApp();
  }

  init();
})();
