(() => {
  'use strict';

  // ===================================================================
  //  Configuración
  // ===================================================================
  const CATEGORIAS_GASTO = {
    comida:          { label: 'Comida',               icon: '🍔', color: '#f97316' },
    transporte:      { label: 'Transporte',           icon: '🚌', color: '#3b82f6' },
    servicios:       { label: 'Servicios',            icon: '💡', color: '#eab308' },
    salidas:         { label: 'Salidas',              icon: '🎉', color: '#ec4899' },
    tarjeta_credito: { label: 'Tarjeta de crédito',   icon: '💳', color: '#8b5cf6' },
    credito_mp:      { label: 'Crédito Mercado Pago', icon: '🤝', color: '#06b6d4' },
  };

  const CATEGORIAS_INGRESO = {
    sueldo:         { label: 'Sueldo',         icon: '💼', color: '#22c55e' },
    extras:         { label: 'Trabajos extra', icon: '💻', color: '#14b8a6' },
    otros_ingresos: { label: 'Otros ingresos', icon: '🎁', color: '#a3e635' },
  };

  const CATEGORIAS = { ...CATEGORIAS_GASTO, ...CATEGORIAS_INGRESO };

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

  /** Valor del movimiento expresado en pesos (USD × cotización). */
  const arsValue = (g) => (g.moneda === 'USD'
    ? Number(g.monto) * Number(g.cotizacion || 0)
    : Number(g.monto));

  const tipoDe = (g) => g.tipo || 'gasto'; // registros viejos no tienen "tipo"
  const esIngreso = (g) => tipoDe(g) === 'ingreso';
  const esGasto = (g) => tipoDe(g) === 'gasto';

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
    gastos: [],             // todos los movimientos (gastos + ingresos)
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
    renderCategoryChart(list.filter(esGasto));
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
    const gastos = list.filter(esGasto);
    const ingresos = list.filter(esIngreso);
    const totalGastos = sum(gastos, arsValue);
    const totalIngresos = sum(ingresos, arsValue);
    const balance = totalIngresos - totalGastos;

    // Ingresos
    $('#stat-ing').textContent = fmtARS.format(totalIngresos);
    $('#stat-ing-sub').textContent = ingresos.length
      ? `${ingresos.length} ingreso${ingresos.length === 1 ? '' : 's'}`
      : 'Sin ingresos cargados';

    // Gastos (con comparación vs mes anterior)
    $('#stat-gas').textContent = fmtARS.format(totalGastos);
    const subGas = $('#stat-gas-sub');
    subGas.className = 'stat-sub';
    subGas.textContent = `${gastos.length} gasto${gastos.length === 1 ? '' : 's'}`;
    if (state.period !== 'all') {
      const prevKey = shiftMonth(state.period, -1);
      const prev = sum(state.gastos.filter((g) => esGasto(g) && monthKey(g.fecha) === prevKey), arsValue);
      if (prev > 0) {
        const pct = Math.round(((totalGastos - prev) / prev) * 100);
        subGas.textContent = `${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}% vs ${monthLabel(prevKey)}`;
        if (pct !== 0) subGas.classList.add(pct > 0 ? 'up' : 'down');
      }
    }

    // Balance
    const balCard = $('#stat-bal-card');
    balCard.classList.remove('positivo', 'negativo');
    $('#stat-bal').textContent = fmtARS.format(balance);
    const subBal = $('#stat-bal-sub');
    if (totalIngresos > 0) {
      const pctAhorro = Math.round((balance / totalIngresos) * 100);
      balCard.classList.add(balance >= 0 ? 'positivo' : 'negativo');
      subBal.textContent = balance >= 0
        ? `Ahorraste el ${pctAhorro}% de tus ingresos`
        : `Gastaste ${fmtARS.format(-balance)} más de lo que entró`;
    } else {
      subBal.textContent = totalGastos > 0 ? 'Cargá tus ingresos para ver el balance' : '';
      if (totalGastos > 0) balCard.classList.add('negativo');
    }

    // USD (solo gastos)
    const usdGastos = gastos.filter((g) => g.moneda === 'USD');
    const usdTotal = sum(usdGastos, (g) => Number(g.monto));
    const usdEnPesos = sum(usdGastos, arsValue);
    $('#stat-usd').textContent = fmtUSD.format(usdTotal);
    $('#stat-usd-sub').textContent = usdTotal > 0
      ? `≈ ${fmtARS.format(usdEnPesos)} · cot. prom. ${fmtARS.format(usdEnPesos / usdTotal)}`
      : 'Sin gastos en dólares';
  }

  function setupChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = '#8b98ad';
    Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  }

  function renderCategoryChart(gastos) {
    if (!window.Chart) return;
    const keys = Object.keys(CATEGORIAS_GASTO);
    const totals = keys.map((k) => sum(gastos.filter((g) => g.categoria === k), arsValue));
    const empty = totals.every((t) => t === 0);

    $('#chart-cat-title').textContent = state.period === 'all'
      ? 'Gastos por categoría · todo'
      : `Gastos por categoría · ${monthLabel(state.period)}`;
    $('#chart-cat-empty').hidden = !empty;
    $('#chart-cat').style.visibility = empty ? 'hidden' : 'visible';

    const data = {
      labels: keys.map((k) => CATEGORIAS_GASTO[k].label),
      datasets: [{
        data: totals,
        backgroundColor: keys.map((k) => CATEGORIAS_GASTO[k].color),
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
    const totalMes = (m, pred) => sum(state.gastos.filter((g) => pred(g) && monthKey(g.fecha) === m), arsValue);

    const barras = Object.entries(CATEGORIAS_GASTO).map(([k, c]) => ({
      type: 'bar',
      label: c.label,
      stack: 'gastos',
      backgroundColor: c.color,
      borderRadius: 4,
      order: 2,
      data: months.map((m) => totalMes(m, (g) => esGasto(g) && g.categoria === k)),
    }));

    const lineaIngresos = {
      type: 'line',
      label: 'Ingresos',
      stack: 'ingresos',
      borderColor: '#4ade80',
      backgroundColor: '#4ade80',
      borderWidth: 2.5,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      order: 1,
      data: months.map((m) => totalMes(m, esIngreso)),
    };

    const data = { labels: months.map((m) => monthLabel(m, true)), datasets: [...barras, lineaIngresos] };

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
          y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtARSShort.format(v) } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12, usePointStyle: true } },
          tooltip: {
            filter: (item) => item.raw > 0,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtARS.format(ctx.raw)}`,
              footer: (items) => {
                const gastos = sum(items.filter((i) => i.dataset.stack === 'gastos'), (i) => i.raw);
                return gastos ? `Total gastos: ${fmtARS.format(gastos)}` : '';
              },
            },
          },
        },
      },
    });
  }

  function renderTable(list) {
    const q = $('#f-search').value.trim().toLowerCase();
    const tipo = $('#f-tipo').value;
    const cat = $('#f-cat').value;
    const mon = $('#f-moneda').value;

    const rows = list.filter((g) => (
      (!tipo || tipoDe(g) === tipo)
      && (!cat || g.categoria === cat)
      && (!mon || g.moneda === mon)
      && (!q || `${g.descripcion} ${g.nota || ''} ${g.medio_pago || ''}`.toLowerCase().includes(q))
    ));
    state.visible = rows;

    const tg = sum(rows.filter(esGasto), arsValue);
    const ti = sum(rows.filter(esIngreso), arsValue);
    const partes = [`${rows.length} movimiento${rows.length === 1 ? '' : 's'}`];
    if (tg) partes.push(`gastos ${fmtARS.format(tg)}`);
    if (ti) partes.push(`ingresos ${fmtARS.format(ti)}`);
    $('#table-count').textContent = partes.join(' · ');

    const tbody = $('#tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No hay movimientos para mostrar</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((g) => {
      const c = catInfo(g.categoria);
      const ing = esIngreso(g);
      const signo = ing ? '+ ' : '';
      const clase = ing ? 'ingreso' : (g.moneda === 'USD' ? 'usd' : '');
      const monto = g.moneda === 'USD'
        ? `<div class="amount ${clase}">${signo}${fmtUSD.format(g.monto)}</div>
           <div class="amount-sub">dólar a ${fmtARS.format(g.cotizacion)} = ${fmtARS.format(arsValue(g))}</div>`
        : `<div class="amount ${clase}">${signo}${fmtARS.format(g.monto)}</div>`;

      return `<tr class="${ing ? 'row-ingreso' : ''}">
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
  const getTipo = () => document.querySelector('input[name="tipo"]:checked').value;

  const catOptions = (cats) => Object.entries(cats)
    .map(([k, c]) => `<option value="${k}">${c.icon} ${c.label}</option>`).join('');

  /** Ajusta el formulario según sea gasto o ingreso. */
  function syncTipoUI() {
    const ing = getTipo() === 'ingreso';
    const prevCat = $('#in-cat').value;
    const cats = ing ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;
    $('#in-cat').innerHTML = catOptions(cats);
    if (cats[prevCat]) $('#in-cat').value = prevCat;

    const form = $('#expense-form');
    form.classList.toggle('modo-ingreso', ing);
    form.classList.toggle('modo-gasto', !ing);

    const editando = Boolean(state.editingId);
    const nombre = ing ? 'ingreso' : 'gasto';
    $('#form-title').textContent = editando ? `Editar ${nombre}` : `Nuevo ${nombre}`;
    $('#save-btn').textContent = editando ? 'Guardar cambios' : `Guardar ${nombre}`;
    $('#medio-label').textContent = ing ? 'Medio de cobro' : 'Medio de pago';
    $('#cot-label').textContent = ing
      ? 'Cotización del dólar (pesos por 1 USD)'
      : 'Cotización del dólar pagada (pesos por 1 USD)';
    $('#in-desc').placeholder = ing ? 'Ej: Sueldo octubre, trabajo freelance…' : 'Ej: Supermercado, Netflix, Uber…';
  }

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

  function resetForm(keepTipo = true) {
    const tipo = getTipo();
    $('#expense-form').reset();
    $('#in-fecha').value = todayISO();
    $('#m-ars').checked = true;
    (keepTipo && tipo === 'ingreso' ? $('#t-ingreso') : $('#t-gasto')).checked = true;
    state.editingId = null;
    $('#cancel-btn').hidden = true;
    syncTipoUI();
    syncMonedaUI();
  }

  function startEdit(id) {
    const g = state.gastos.find((x) => x.id === id);
    if (!g) return;
    state.editingId = id;
    (esIngreso(g) ? $('#t-ingreso') : $('#t-gasto')).checked = true;
    syncTipoUI();
    $('#in-fecha').value = String(g.fecha).slice(0, 10);
    $('#in-desc').value = g.descripcion;
    $('#in-cat').value = g.categoria;
    $('#in-medio').value = g.medio_pago || '';
    $('#in-nota').value = g.nota || '';
    $('#in-monto').value = g.monto;
    (g.moneda === 'USD' ? $('#m-usd') : $('#m-ars')).checked = true;
    $('#in-cotizacion').value = g.cotizacion || '';
    $('#cancel-btn').hidden = false;
    syncMonedaUI();
    $('#expense-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const tipo = getTipo();
    const moneda = getMoneda();
    const monto = parseFloat($('#in-monto').value);
    const cotizacion = parseFloat($('#in-cotizacion').value);

    if (!(monto > 0)) return toast('Ingresá un monto válido', 'error');
    if (moneda === 'USD' && !(cotizacion > 0)) return toast('Ingresá la cotización del dólar', 'error');

    const payload = {
      tipo,
      fecha: $('#in-fecha').value,
      descripcion: $('#in-desc').value.trim(),
      categoria: $('#in-cat').value,
      medio_pago: $('#in-medio').value || null,
      moneda,
      monto,
      cotizacion: moneda === 'USD' ? cotizacion : null,
      nota: $('#in-nota').value.trim() || null,
    };

    const nombre = tipo === 'ingreso' ? 'Ingreso' : 'Gasto';
    const btn = $('#save-btn');
    btn.disabled = true;
    try {
      if (state.editingId) {
        const row = await store.update(state.editingId, payload);
        state.gastos = state.gastos.map((g) => (g.id === row.id ? row : g));
        toast(`${nombre} actualizado ✔`);
      } else {
        const row = await store.create(payload);
        state.gastos.push(row);
        toast(`${nombre} guardado ✔`);
      }
      // Mostrar el mes del movimiento recién guardado
      if (state.period !== 'all') state.period = monthKey(payload.fecha);
      resetForm(true);
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
      toast('Movimiento borrado');
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
    if (!rows.length) return toast('No hay movimientos para exportar', 'error');

    const num = (n) => (n == null || n === '' ? '' : String(Number(n).toFixed(2)).replace('.', ','));
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Medio', 'Moneda', 'Monto', 'Cotización USD', 'Total en ARS', 'Nota'];
    const lines = rows.map((g) => [
      fmtDate(g.fecha), esIngreso(g) ? 'Ingreso' : 'Gasto', g.descripcion, catInfo(g.categoria).label,
      g.medio_pago || '', g.moneda, num(g.monto), num(g.cotizacion), num(arsValue(g)), g.nota || '',
    ].map(cell).join(';'));

    const csv = '\uFEFF' + [header.map(cell).join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `movimientos_${state.period === 'all' ? 'historial' : state.period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ===================================================================
  //  Vistas: login / app
  // ===================================================================
  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
  }

  async function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    try {
      state.gastos = await store.list();
    } catch (err) {
      console.error(err);
      toast(`No se pudieron cargar los movimientos: ${err.message || err}`, 'error');
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
    $('#f-cat').innerHTML = '<option value="">Todas las categorías</option>'
      + `<optgroup label="Gastos">${catOptions(CATEGORIAS_GASTO)}</optgroup>`
      + `<optgroup label="Ingresos">${catOptions(CATEGORIAS_INGRESO)}</optgroup>`;
    $('#in-medio').innerHTML = '<option value="">— Elegir —</option>'
      + MEDIOS_PAGO.map((m) => `<option value="${m}">${m}</option>`).join('');
  }

  function bindEvents() {
    $('#login-form').addEventListener('submit', onLogin);
    $('#expense-form').addEventListener('submit', onSubmit);
    $('#cancel-btn').addEventListener('click', () => resetForm(true));
    document.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', syncTipoUI));
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
    ['#f-search', '#f-tipo', '#f-cat', '#f-moneda'].forEach((sel) => {
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
    resetForm(false);

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
