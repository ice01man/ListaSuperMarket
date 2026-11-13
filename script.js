// ================================================================
//  CLIENTE API  (reemplaza a Supabase)
//  Todas las llamadas van a nuestra propia API en /api, que a su vez
//  habla con MongoDB. La connection string NUNCA llega al navegador.
// ================================================================
const API = '/api';

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    let msg = 'Error ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Convierte un item local (con id de UI) al formato que guarda la DB
function mapItem(i) {
  return {
    product_name: i.product_name,
    quantity:     i.quantity,
    unit_price:   i.unit_price,
    total_price:  i.total_price
  };
}

// ================================================================
//  ESTADO GLOBAL
// ================================================================
let currentUser  = null;   // { id, name, device_key }
let items        = [];
let total        = 0;
let priceEvoData = [];     // cache para filtro de evolución
let _doneCache   = null;   // cache de listas guardadas (historial + reportes)

// ================================================================
//  STORE — única key en localStorage: "misCompras"
//  Estructura: { theme, user, deviceKey, draft:{ items, total, supermarket, listId } }
// ================================================================
const STORE_KEY = 'misCompras';

function storeGet() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function storeSet(patch) {
  const cur = storeGet();
  localStorage.setItem(STORE_KEY, JSON.stringify({ ...cur, ...patch }));
}
function storeMergeDraft(draftPatch) {
  const cur = storeGet();
  storeSet({ draft: { ...(cur.draft || {}), ...draftPatch } });
}
function storeClearDraft() {
  const cur = storeGet();
  delete cur.draft;
  localStorage.setItem(STORE_KEY, JSON.stringify(cur));
}

// ================================================================
//  TEMA DARK / LIGHT
// ================================================================
function initTheme() {
  const saved = storeGet().theme || 'dark';
  applyTheme(saved);
}

function toggleTheme() {
  const current = storeGet().theme || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
  const root = document.documentElement;
  const btn  = document.getElementById('themeToggle');
  if (theme === 'light') {
    root.classList.add('light');
    if (btn) btn.textContent = '☀️';
  } else {
    root.classList.remove('light');
    if (btn) btn.textContent = '🌙';
  }
  storeSet({ theme });
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  const store = storeGet();
  if (store.user) {
    currentUser = store.user;
    await enterApp();
  }
  setCurrentListLabel();
});

function setCurrentListLabel() {
  const now = new Date();
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  document.getElementById('currentListLabel').textContent =
    `${months[now.getMonth()]} ${now.getFullYear()}`;
  document.getElementById('currentListDate').textContent =
    now.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
}

// ================================================================
//  REGISTRO DE USUARIO
// ================================================================
async function registerUser() {
  const nameVal = document.getElementById('userName').value.trim();
  if (!nameVal) { showToast('Ingresá tu nombre', 'error'); return; }

  const mailVal = document.getElementById('userMail').value.trim();
  if (!mailVal) { showToast('Ingresá tu mail', 'error'); return; }

  showToast('Conectando…', 'info');

  // device_key: SIEMPRE derivado del mail ingresado.
  // Así, cada correo distinto es una cuenta distinta y un correo nuevo
  // (que no está en la DB) se crea y deja entrar.
  const deviceKey = mailVal.toLowerCase().replace(/\s+/g,'-');
  storeSet({ deviceKey });

  try {
    const user = await api('/users', {
      method: 'POST',
      body: JSON.stringify({ name: nameVal, device_key: deviceKey })
    });
    currentUser = user;                       // { id, name, device_key }
    storeSet({ user: currentUser });
    enterApp();
    showToast(`¡Bienvenido, ${currentUser.name}! 👋`, 'success');

  } catch (err) {
    console.error(err);
    showToast('No se pudo entrar: ' + err.message, 'error');
  }
}

async function enterApp() {
  document.getElementById('screen-welcome').classList.remove('active');
  document.getElementById('screen-main').classList.add('active');
  document.getElementById('headerUser').textContent = currentUser.name;
  await checkForDraft();
  loadSupermarketOptions(); // pre-cargar opciones de supermercado
}

// ================================================================
//  NAVEGACIÓN POR TABS
// ================================================================
function showTab(tabId, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');

  if (tabId === 'tab-history') { loadHistory(); loadSupermarketOptions(); }
  if (tabId === 'tab-reports') { const f = document.getElementById('reportFilterSupermarket'); if(f) f.value=''; loadReports(); }
}

// ================================================================
//  LISTA DE COMPRAS — lógica local
// ================================================================
function addItem() {
  const nameInput = document.getElementById('itemName');
  const qtyInput  = document.getElementById('itemQuantity');
  const priceInput= document.getElementById('itemPrice');

  if (!nameInput.value.trim()) { showToast('Ingresá el nombre del producto', 'error'); return; }

  const raw   = priceInput.value;
  const price = (raw === '' || isNaN(parseFloat(raw))) ? 0 : parseFloat(raw);
  const qty   = parseInt(qtyInput.value, 10) || 1;

  const item = {
    id:         Date.now(),
    product_name: nameInput.value.trim(),
    unit_price: price,
    quantity:   qty,
    total_price: price * qty
  };

  items.push(item);
  total += item.total_price;

  renderList();
  updateTotal();
  saveDraftLocal();
  saveDraftCloud();   // sin await — background, no bloquea UI

  // Limpiar
  nameInput.value  = '';
  priceInput.value = '0';
  qtyInput.value   = '1';
  nameInput.focus();
}

function renderList() {
  const ul = document.getElementById('itemsList');
  ul.innerHTML = '';

  if (items.length === 0) {
    ul.innerHTML = '<li class="empty-msg" style="padding:20px 0">Agregá productos a la lista ☝️</li>';
    return;
  }

  items.forEach(item => {
    const li = document.createElement('li');
    li.className  = 'item';
    li.dataset.id = item.id;
    li.innerHTML  = `
      <span class="item-name">${escapeHtml(item.product_name)}</span>
      <span class="item-inputs">
        <input type="number" class="qty-input"   value="${item.quantity}"   min="1">
        x&nbsp;$
        <input type="number" class="price-input" value="${item.unit_price}" step="0.01" min="0">
      </span>
      <span class="item-total">$${item.total_price.toFixed(2)}</span>
      <button class="btn-remove" onclick="removeItem(${item.id})">✕</button>
    `;
    li.addEventListener('change', () => handleItemChange(li));
    ul.appendChild(li);
  });
}

function handleItemChange(li) {
  const id    = parseInt(li.dataset.id, 10);
  const qty   = parseInt(li.querySelector('.qty-input').value, 10)    || 1;
  const price = parseFloat(li.querySelector('.price-input').value)    || 0;
  const newTot= qty * price;

  li.querySelector('.item-total').textContent = `$${newTot.toFixed(2)}`;

  const idx = items.findIndex(i => i.id === id);
  if (idx !== -1) {
    total -= items[idx].total_price;
    items[idx] = { ...items[idx], quantity: qty, unit_price: price, total_price: newTot };
    total += newTot;
  }

  updateTotal();
  saveDraftLocal();
  saveDraftCloud();
}

function removeItem(id) {
  items = items.filter(i => {
    if (i.id === id) { total -= i.total_price; return false; }
    return true;
  });
  renderList();
  updateTotal();
  saveDraftLocal();
  saveDraftCloud();
}

async function clearList() {
  // Si hay un borrador sin guardar en la nube, borrarlo también
  const draftId = storeGet().draft?.listId;
  if (draftId && currentUser) {
    try { await api(`/lists?id=${draftId}`, { method: 'DELETE' }); }
    catch (e) { /* silencioso */ }
  }

  storeClearDraft();
  items = [];
  total = 0;
  renderList();
  updateTotal();
  document.getElementById('supermarket').value = '';
  showToast('Lista nueva 🧹', 'info');
}

function updateTotal() {
  document.getElementById('totalAmount').textContent = `$${total.toFixed(2)}`;
}

// ================================================================
//  GUARDAR EN LA NUBE (MongoDB vía API)
// ================================================================
async function saveListToCloud() {
  if (!currentUser) { showToast('Primero ingresá tu nombre', 'error'); return; }
  if (items.length === 0) { showToast('La lista está vacía', 'error'); return; }

  showToast('Guardando…', 'info');

  const now    = new Date();
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const label  = `${months[now.getMonth()]} ${now.getFullYear()}`;
  const draftId = storeGet().draft?.listId;

  try {
    // Si hay un draft guardado, borrarlo primero (lo reemplaza el definitivo)
    if (draftId) {
      try { await api(`/lists?id=${draftId}`, { method: 'DELETE' }); } catch (e) {}
      storeClearDraft();
    }

    
    await api('/lists', {
      method: 'POST',
      body: JSON.stringify({
        userId:      currentUser.id,
        label,
        month:       now.getMonth() + 1,
        year:        now.getFullYear(),
        supermarket: document.getElementById('supermarket').value.trim() || null,
        total,
        status:      'done',
        items:       items.map(mapItem)
      })
    });

    _doneCache = null;          // invalidar cache: historial/reportes se refrescan
    storeClearDraft();
    showToast('✅ Lista guardada en la nube', 'success');

  } catch (err) {
    console.error(err);
    showToast('Error al guardar: ' + err.message, 'error');
  }
}

// ================================================================
//  HISTORIAL
// ================================================================
let _allHistoryLists = [];

// Trae (y cachea) todas las listas guardadas del usuario, con sus items
async function fetchDoneLists(force = false) {
  if (_doneCache && !force) return _doneCache;
  _doneCache = await api(`/lists?scope=done&userId=${encodeURIComponent(currentUser.id)}`);
  return _doneCache || [];
}

async function loadHistory() {
  if (!currentUser) return;
  const container = document.getElementById('historyList');
  container.innerHTML = '<p class="empty-msg">Cargando…</p>';

  try {
    _allHistoryLists = await fetchDoneLists(true) || [];

    if (!_allHistoryLists.length) {
      container.innerHTML = '<p class="empty-msg">Aún no guardaste listas.<br/>Agregá productos y tocá ☁️ Guardar.</p>';
      return;
    }

    renderHistoryCards(_allHistoryLists);

  } catch (err) {
    container.innerHTML = `<p class="empty-msg error-msg">Error: ${err.message}</p>`;
  }
}

function renderHistoryCards(lists) {
  const container = document.getElementById('historyList');
  if (!lists.length) {
    container.innerHTML = '<p class="empty-msg">No hay listas para ese filtro.</p>';
    return;
  }
  container.innerHTML = lists.map(list => `
    <div class="history-card" onclick="showListDetail('${list.id}', '${escapeHtml(list.label)}', '${escapeHtml(list.supermarket || '')}', '${new Date(list.created_at).toLocaleDateString('es-AR')}')">
      <div class="history-card-top">
        <span class="history-label">${list.label}</span>
        <span class="history-total">$${parseFloat(list.total).toFixed(2)}</span>
      </div>
      <div class="history-card-bottom">
        <span class="history-supermarket">${list.supermarket ? '🏪 ' + escapeHtml(list.supermarket) : 'Sin supermercado'}</span>
        <span>${new Date(list.created_at).toLocaleDateString('es-AR')}</span>
      </div>
    </div>
  `).join('');
}

function filterHistory() {
  const q = document.getElementById('historyFilterSupermarket')?.value.trim().toLowerCase() || '';
  if (!q) { renderHistoryCards(_allHistoryLists); return; }
  const filtered = _allHistoryLists.filter(l =>
    (l.supermarket || '').toLowerCase().includes(q)
  );
  renderHistoryCards(filtered);
}

async function loadSupermarketOptions() {
  if (!currentUser) return;
  try {
    const lists  = await fetchDoneLists();
    const unique = [...new Set(lists.map(r => r.supermarket).filter(Boolean))].sort();

    const dlHistory = document.getElementById('history-supermarket-options');
    if (dlHistory) dlHistory.innerHTML = unique.map(s => `<option value="${escapeHtml(s)}">`).join('');

    const dlInput = document.getElementById('supermarket-options');
    if (dlInput) dlInput.innerHTML = unique.map(s => `<option value="${escapeHtml(s)}">`).join('');

  } catch (e) { /* silencioso */ }
}

async function showListDetail(listId, label, supermarket, date) {
  const titleEl = document.getElementById('modalTitle');
  titleEl.textContent = label;
  document.getElementById('modalBody').innerHTML = '<p class="empty-msg">Cargando…</p>';
  document.getElementById('modal').style.display = 'flex';

  let listData = null;

  // Primero intentamos usar la cache; si no está, pedimos el detalle
  if (_doneCache) listData = _doneCache.find(l => l.id === listId) || null;
  if (!listData) {
    try { listData = await api(`/lists?scope=detail&id=${listId}`); }
    catch (e) { listData = null; }
  }

  if (!listData || !listData.items) {
    document.getElementById('modalBody').innerHTML = '<p class="empty-msg error-msg">Error al cargar.</p>';
    return;
  }

  const data = [...listData.items].sort((a, b) =>
    a.product_name.localeCompare(b.product_name));

  const metaHtml = (supermarket || date) ? `
    <div class="modal-meta">
      ${supermarket ? `<span>🏪 ${escapeHtml(supermarket)}</span>` : ''}
      ${date ? `<span>📅 ${date}</span>` : ''}
    </div>
  ` : '';

  const rows = data.map(i => `
    <div class="modal-item">
      <span class="modal-item-name">${escapeHtml(i.product_name)}</span>
      <span class="modal-item-detail">${i.quantity} x $${parseFloat(i.unit_price).toFixed(2)}</span>
      <span class="modal-item-total">$${parseFloat(i.total_price).toFixed(2)}</span>
    </div>
  `).join('');

  const listTotal = data.reduce((a, i) => a + parseFloat(i.total_price), 0);
  document.getElementById('modalBody').innerHTML = `
    ${metaHtml}
    <div class="modal-items-header">
      <span>Producto</span><span>Cantidad · Precio</span><span>Subtotal</span>
    </div>
    ${rows}
    <div class="modal-total">Total: <strong>$${listTotal.toFixed(2)}</strong></div>
  `;
}

function closeModal(e) {
  if (e.target.id === 'modal') document.getElementById('modal').style.display = 'none';
}

// ================================================================
//  REPORTES  (se calculan sobre las listas ya traídas de la API)
// ================================================================
async function loadReports() {
  if (!currentUser) return;

  let lists;
  try { lists = await fetchDoneLists(true); }
  catch (e) {
    document.getElementById('reportMonthly').innerHTML = `<p class="empty-msg error-msg">Error: ${e.message}</p>`;
    return;
  }

  // Poblar datalist del filtro con supermercados disponibles
  const dlReport = document.getElementById('report-supermarket-options');
  if (dlReport) {
    const unique = [...new Set(lists.map(r => r.supermarket).filter(Boolean))].sort();
    dlReport.innerHTML = unique.map(s => `<option value="${escapeHtml(s)}">`).join('');
  }

  const filterVal = document.getElementById('reportFilterSupermarket')?.value.trim() || '';
  loadSpendingStats(filterVal);
  loadProductPriceStats(filterVal);
  loadPriceIncreases(filterVal);
  loadMonthlyReport(filterVal);
  loadTopProducts(filterVal);
  loadPriceEvolution(filterVal);
}

function applyReportFilter() {
  const filterVal = document.getElementById('reportFilterSupermarket')?.value.trim() || '';
  loadSpendingStats(filterVal);
  loadProductPriceStats(filterVal);
  loadPriceIncreases(filterVal);
  loadMonthlyReport(filterVal);
  loadTopProducts(filterVal);
  loadPriceEvolution(filterVal);
}

// Devuelve las listas guardadas filtradas por supermercado (subcadena)
function filteredDoneLists(supermarketFilter = '') {
  const all = _doneCache || [];
  if (!supermarketFilter) return all;
  const q = supermarketFilter.toLowerCase();
  return all.filter(l => (l.supermarket || '').toLowerCase().includes(q));
}

// ---------- Estadísticas de gasto (promedio / mediana) ----------
let _statsPeriod = 'month';   // 'month' | 'quarter' | 'year'

function setStatsPeriod(period, btn) {
  _statsPeriod = period;
  document.querySelectorAll('.stats-btn[data-period]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const filterVal = document.getElementById('reportFilterSupermarket')?.value.trim() || '';
  loadSpendingStats(filterVal);
}

function fmtMoneyShort(n) {
  return '$' + Math.round(Number(n || 0)).toLocaleString('es-AR');
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChange(c) {
  if (c === null || !isFinite(c)) return '<span class="stats-change flat">—</span>';
  const pct = (c * 100).toFixed(1).replace('.', ',');
  const cls = c > 0.0005 ? 'up' : c < -0.0005 ? 'down' : 'flat';
  const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '→';
  return `<span class="stats-change ${cls}">${arrow} ${c > 0 ? '+' : ''}${pct}%</span>`;
}

function loadSpendingStats(supermarketFilter = '') {
  const el    = document.getElementById('reportStats');
  const sumEl = document.getElementById('reportStatsSummary');
  if (!el) return;
  const data = filteredDoneLists(supermarketFilter);

  if (!data.length) {
    el.innerHTML = '<p class="empty-msg">Sin datos aún</p>';
    if (sumEl) sumEl.innerHTML = '';
    return;
  }

  // Resumen general del filtro actual
  const o = computeOverallStats(data);
  if (sumEl) sumEl.innerHTML = `
    <div class="stats-summary">
      <div class="stats-kpi"><span class="stats-kpi-label">Compras</span><span class="stats-kpi-value">${o.count}</span></div>
      <div class="stats-kpi"><span class="stats-kpi-label">Promedio por compra</span><span class="stats-kpi-value">${fmtMoneyShort(o.avgPerPurchase)}</span></div>
      <div class="stats-kpi"><span class="stats-kpi-label">Mediana por compra</span><span class="stats-kpi-value">${fmtMoneyShort(o.medianPerPurchase)}</span></div>
      <div class="stats-kpi"><span class="stats-kpi-label">Promedio mensual</span><span class="stats-kpi-value">${fmtMoneyShort(o.avgPerMonth)}</span></div>
      <div class="stats-kpi"><span class="stats-kpi-label">Mediana mensual</span><span class="stats-kpi-value">${fmtMoneyShort(o.medianPerMonth)}</span></div>
    </div>`;

  const rows = computeSpendingStats(data, _statsPeriod);
  const showMonthly = _statsPeriod !== 'month';
  const prevLabel = { month: 'mes ant.', quarter: 'trim. ant.', year: 'año ant.' }[_statsPeriod];

  el.innerHTML = `
    <div class="stats-table-wrap">
      <table class="stats-table stats-table-cards">
        <thead>
          <tr>
            <th>Período</th>
            <th>Prom. x compra</th>
            <th>Mediana x compra</th>
            ${showMonthly ? '<th>Prom. mensual</th><th>Mediana mensual</th>' : '<th>Mín · Máx</th>'}
            <th>vs ${prevLabel}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="stats-period" data-label="Período">${escapeHtml(r.label)}<span class="stats-note">${r.accumLabel ? r.accumLabel + ' · ' : ''}${r.count} compra${r.count !== 1 ? 's' : ''} · ${fmtMoney(r.total)}</span></td>
              <td data-label="Prom. x compra">${fmtMoney(r.avgPerPurchase)}</td>
              <td data-label="Mediana x compra">${fmtMoney(r.medianPerPurchase)}</td>
              ${showMonthly
                ? `<td data-label="Prom. mensual">${fmtMoney(r.avgPerMonth)}<span class="stats-note">${r.monthsWithPurchases} mes${r.monthsWithPurchases !== 1 ? 'es' : ''}</span></td>
                   <td data-label="Mediana mensual">${fmtMoney(r.medianPerMonth)}</td>`
                : `<td data-label="Mín · Máx">${fmtMoney(r.minPurchase)}<span class="stats-note">máx ${fmtMoney(r.maxPurchase)}</span></td>`}
              <td data-label="vs ${prevLabel}">${fmtChange(r.changeVsPrev)}${r.prevBase !== null ? `<span class="stats-note">vs ${fmtMoney(r.prevBase)}${r.prevBaseLabel ? ` (${r.prevBaseLabel})` : ''}</span>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="stats-footnote">
      ${_statsPeriod === 'month'
        ? 'Variación: compara el gasto total (no precios) contra el mes anterior. Si ese mes no tuvo compras, se toma el último mes anterior con compras (se indica entre paréntesis).'
        : `Variación: compara el gasto total (no precios) contra el ${prevLabel.replace(' ant.', '').replace('trim.', 'trimestre')} anterior, tomando los mismos meses (si el período está en curso, se compara el acumulado contra los mismos meses del anterior). Si falta algún mes con compras en cualquiera de los dos tramos, no se calcula.`}
      ${showMonthly ? 'Promedio y mediana mensual se calculan sobre los meses del período que tienen compras.' : ''}
    </p>
  `;
}

// ---------- Precios por producto (prom / mediana / mín-máx / vs mes ant.) ----------
let _productStats = [];
let _productStatsRubro = 'Todos';

function loadProductPriceStats(supermarketFilter = '') {
  _productStats = computeProductPriceStats(filteredDoneLists(supermarketFilter));
  const rubros = [...new Set(_productStats.map(p => p.rubro))];
  if (_productStatsRubro !== 'Todos' && !rubros.includes(_productStatsRubro)) _productStatsRubro = 'Todos';
  renderProductPriceStats();
}

function setProductStatsRubro(rubro) {
  _productStatsRubro = rubro;
  renderProductPriceStats();
}

// Fila TOTAL: suma los valores de los productos que se ven en la tabla.
// vs mes ant.: suma de últimos precios contra suma de precios anteriores,
// solo de los productos que tienen precio anterior.
function renderProductTotalRow(products) {
  const t = computeProductTotals(products);
  return `
        <tfoot>
          <tr class="stats-total-row">
            <td class="stats-period" data-label="Total">TOTAL<span class="stats-note">${t.products} producto${t.products !== 1 ? 's' : ''} · último ${fmtMoney(t.last)}</span>${t.compared && t.compared < t.products ? `<span class="stats-note">vs mes ant.: ${t.compared} con precio anterior (${fmtMoney(t.lastCompared)})</span>` : ''}</td>
            <td data-label="Prom.">${fmtMoney(t.avg)}</td>
            <td data-label="Mediana">${fmtMoney(t.median)}</td>
            <td data-label="Mín · Máx">${fmtMoney(t.min)}<span class="stats-note">máx ${fmtMoney(t.max)}</span></td>
            <td data-label="vs mes ant.">${fmtChange(t.change)}${t.compared ? `<span class="stats-note">vs ${fmtMoney(t.prevCompared)}</span>` : ''}</td>
          </tr>
        </tfoot>`;
}

function renderProductPriceStats() {
  const el    = document.getElementById('reportProductStats');
  const tglEl = document.getElementById('productStatsRubroToggle');
  if (!el) return;
  if (!_productStats.length) {
    el.innerHTML = '<p class="empty-msg">Sin datos aún</p>';
    if (tglEl) tglEl.innerHTML = '';
    return;
  }

  const rubros = [...new Set(_productStats.map(p => p.rubro))].sort();
  if (tglEl) tglEl.innerHTML = rubros.length > 1
    ? ['Todos', ...rubros].map(o => `<button class="stats-btn ${o === _productStatsRubro ? 'active' : ''}" onclick="setProductStatsRubro('${escapeHtml(o)}')">${escapeHtml(o)}</button>`).join('')
    : '';

  const q = (document.getElementById('productStatsSearch')?.value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const shown = _productStats.filter(p =>
    (_productStatsRubro === 'Todos' || p.rubro === _productStatsRubro) &&
    (!q || p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)));

  if (!shown.length) { el.innerHTML = '<p class="empty-msg">Ningún producto coincide.</p>'; return; }

  el.innerHTML = `
    <div class="stats-table-wrap">
      <table class="stats-table stats-table-cards">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Prom.</th>
            <th>Mediana</th>
            <th>Mín · Máx</th>
            <th>vs mes ant.</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map(p => `
            <tr>
              <td class="stats-period" data-label="Producto">${escapeHtml(p.name)}<span class="stats-note">${p.count} compra${p.count !== 1 ? 's' : ''} · último ${fmtMoney(p.lastPrice)} (${p.lastLabel.toLowerCase()})</span></td>
              <td data-label="Prom.">${fmtMoney(p.avg)}</td>
              <td data-label="Mediana">${fmtMoney(p.median)}</td>
              <td data-label="Mín · Máx">${fmtMoney(p.min)}<span class="stats-note">máx ${fmtMoney(p.max)}</span></td>
              <td data-label="vs mes ant.">${fmtChange(p.changeVsPrev)}${p.prevPrice !== null ? `<span class="stats-note">vs ${fmtMoney(p.prevPrice)}${p.prevIsGap ? ` (${p.prevLabel.toLowerCase()})` : ''}</span>` : ''}</td>
            </tr>`).join('')}
        </tbody>
        ${renderProductTotalRow(shown)}
      </table>
    </div>
    <p class="stats-footnote">Precio unitario. vs mes ant.: precio del último mes en que se compró contra el mes anterior en que se compró (si hubo meses sin comprarlo, se indica cuál entre paréntesis). Si se compró varias veces en un mes, se usa el promedio ponderado por cantidad. Items sin precio cargado no cuentan. TOTAL: suma de los productos que se ven en la tabla; su vs mes ant. compara la suma de últimos precios contra la suma de precios anteriores, solo de los productos que tienen precio anterior.</p>
  `;
}

// ---------- Aumentos de precios por rubro y producto ----------
let _increaseRubro = 'Todos';
let _increaseData  = null;

function setIncreaseRubro(rubro) {
  _increaseRubro = rubro;
  renderPriceIncreases();
}

function fmtPct(c) {
  if (c === null || !isFinite(c)) return '<span class="stats-change flat">—</span>';
  const cls = c > 0.0005 ? 'up' : c < -0.0005 ? 'down' : 'flat';
  const pct = (c * 100).toFixed(1).replace('.', ',');
  return `<span class="stats-change ${cls}">${c > 0 ? '+' : ''}${pct}%</span>`;
}

function loadPriceIncreases(supermarketFilter = '') {
  _increaseData = computePriceIncreases(filteredDoneLists(supermarketFilter));
  const rubros = _increaseData.rubros.map(r => r.nombre);
  if (_increaseRubro !== 'Todos' && !rubros.includes(_increaseRubro)) _increaseRubro = 'Todos';
  renderPriceIncreases();
}

function renderPriceIncreases() {
  const el     = document.getElementById('reportIncreases');
  const rubEl  = document.getElementById('reportIncreaseRubros');
  const tglEl  = document.getElementById('increaseRubroToggle');
  if (!el || !_increaseData) return;
  const { products, rubros, excluded, minMonths } = _increaseData;
  const rule = `Se calcula solo para productos con el mismo nombre comprados en al menos ${minMonths} meses consecutivos (se toma el tramo más reciente).`;

  if (!products.length) {
    if (tglEl) tglEl.innerHTML = '';
    if (rubEl) rubEl.innerHTML = '';
    el.innerHTML = `<p class="empty-msg">Todavía no hay productos con datos suficientes.</p><p class="stats-footnote">${rule}</p>`;
    return;
  }

  const options = ['Todos', ...rubros.map(r => r.nombre)];
  if (tglEl) tglEl.innerHTML = options.map(o => `
    <button class="stats-btn ${o === _increaseRubro ? 'active' : ''}" onclick="setIncreaseRubro('${escapeHtml(o)}')">${escapeHtml(o)}</button>
  `).join('');

  // Resumen por rubro
  if (rubEl) rubEl.innerHTML = `
    <div class="stats-summary">
      ${rubros.map(r => `
        <div class="stats-kpi">
          <span class="stats-kpi-label">${escapeHtml(r.nombre)} · ${r.productos} producto${r.productos !== 1 ? 's' : ''}</span>
          <span class="stats-kpi-value">${fmtPct(r.monthlyChangeAvg)} <small>/mes</small></span>
          <span class="stats-note">Último mes: ${fmtPct(r.lastChangeAvg)} · Mediana: ${fmtPct(r.monthlyChangeMedian)}</span>
        </div>`).join('')}
    </div>`;

  const shown = _increaseRubro === 'Todos' ? products : products.filter(p => p.rubro === _increaseRubro);

  el.innerHTML = `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Meses</th>
            <th>Precio actual</th>
            <th>Último mes</th>
            <th>Prom. mensual</th>
            <th>Acumulado</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map(p => `
            <tr>
              <td class="stats-period">${escapeHtml(p.name)}<span class="stats-note">${escapeHtml(p.rubro)}</span></td>
              <td>${p.months}<span class="stats-note">${p.fromLabel} – ${p.toLabel}</span></td>
              <td>${fmtMoney(p.lastPrice)}<span class="stats-note">desde ${fmtMoney(p.firstPrice)}</span></td>
              <td>${fmtPct(p.lastChange)}</td>
              <td>${fmtPct(p.monthlyChange)}</td>
              <td class="stats-total">${fmtPct(p.accumChange)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="stats-footnote">${rule}${excluded ? ` ${excluded} producto${excluded !== 1 ? 's' : ''} sin datos suficientes no se ${excluded !== 1 ? 'muestran' : 'muestra'}.` : ''}</p>
  `;
}

function loadMonthlyReport(supermarketFilter = '') {
  const el = document.getElementById('reportMonthly');
  const data = filteredDoneLists(supermarketFilter);

  if (!data.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }

  // Agrupar por año-mes
  const grouped = {};
  data.forEach(r => {
    const key = `${r.year}-${String(r.month).padStart(2,'0')}`;
    if (!grouped[key]) grouped[key] = { label: r.label, total: 0, count: 0 };
    grouped[key].total += parseFloat(r.total);
    grouped[key].count++;
  });

  const ordered = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));

  el.innerHTML = ordered.map(([, v]) => `
    <div class="report-row">
      <span class="report-label">${v.label}</span>
      <span class="report-value">$${v.total.toFixed(2)}</span>
      <span class="report-sub">${v.count} lista${v.count>1?'s':''}</span>
    </div>
  `).join('');
}

function loadTopProducts(supermarketFilter = '') {
  const el = document.getElementById('reportTopProducts');
  const lists = filteredDoneLists(supermarketFilter);

  if (!lists.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }

  // Contar cantidades por producto sobre los items embebidos
  const counts = {};
  lists.forEach(l => (l.items || []).forEach(i => {
    counts[i.product_name] = (counts[i.product_name] || 0) + i.quantity;
  }));

  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 10);
  if (!sorted.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }

  const max = sorted[0][1];
  el.innerHTML = sorted.map(([name, qty], idx) => `
    <div class="report-row">
      <span class="rank-num">${idx+1}</span>
      <span class="report-label">${escapeHtml(name)}</span>
      <div class="bar-wrap">
        <div class="bar" style="width:${(qty/max*100).toFixed(0)}%"></div>
      </div>
      <span class="report-value">${qty} u.</span>
    </div>
  `).join('');
}

function loadPriceEvolution(supermarketFilter = '') {
  const el = document.getElementById('reportPriceEvolution');
  const lists = filteredDoneLists(supermarketFilter);

  if (!lists.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }

  // Armar estructura: { producto: [ { label, year, month, price } ] }
  const evo = {};
  lists.forEach(l => (l.items || []).forEach(i => {
    if (!evo[i.product_name]) evo[i.product_name] = [];
    evo[i.product_name].push({
      label: l.label,
      year:  l.year,
      month: l.month,
      price: parseFloat(i.unit_price)
    });
  }));

  if (!Object.keys(evo).length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }

  Object.values(evo).forEach(arr =>
    arr.sort((a,b) => a.year===b.year ? a.month-b.month : a.year-b.year));

  priceEvoData = evo;
  renderPriceEvolution(evo);
}

function renderPriceEvolution(evo) {
  const el = document.getElementById('reportPriceEvolution');
  const products = Object.keys(evo);

  if (!products.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }

  el.innerHTML = products.map(name => {
    const entries = evo[name];
    const prices  = entries.map(e => e.price);
    const min     = Math.min(...prices);
    const max     = Math.max(...prices);
    const last    = prices[prices.length-1];
    const prev    = prices.length > 1 ? prices[prices.length-2] : null;
    const trend   = prev === null ? '' : last > prev ? '▲' : last < prev ? '▼' : '→';
    const trendCls= prev === null ? '' : last > prev ? 'up' : last < prev ? 'down' : 'flat';

    const cols = entries.map(e => `
      <div class="evo-col">
        <div class="evo-bar-wrap">
          <div class="evo-bar" style="height:${max>0?(e.price/max*60).toFixed(0):0}px"></div>
        </div>
        <span class="evo-price">$${e.price.toFixed(0)}</span>
        <span class="evo-label">${e.label.split(' ')[0].substring(0,3)}</span>
      </div>
    `).join('');

    return `
      <div class="evo-card">
        <div class="evo-header">
          <span class="evo-name">${escapeHtml(name)}</span>
          <span class="evo-trend ${trendCls}">${trend} $${last.toFixed(2)}</span>
        </div>
        <div class="evo-range">Mín: $${min.toFixed(2)} · Máx: $${max.toFixed(2)}</div>
        <div class="evo-cols">${cols}</div>
      </div>
    `;
  }).join('');
}

function filterPriceEvolution() {
  const q = document.getElementById('searchProduct').value.toLowerCase();
  if (!Object.keys(priceEvoData).length) return;
  const filtered = Object.fromEntries(
    Object.entries(priceEvoData).filter(([k]) => k.toLowerCase().includes(q))
  );
  renderPriceEvolution(filtered);
}

// ================================================================
//  COMPARTIR
// ================================================================
function shareList() {
  if (!items.length) { showToast('La lista está vacía', 'error'); return; }
  let txt = '📝 Lista de Compras:\n\n';
  items.forEach(i => {
    txt += `✔ ${i.product_name} — ${i.quantity} x $${i.unit_price.toFixed(2)} = $${i.total_price.toFixed(2)}\n`;
  });
  txt += `\n💰 Total: $${total.toFixed(2)}`;

  if (navigator.share) {
    navigator.share({ title: 'Mi Lista de Compras', text: txt }).catch(console.error);
  } else {
    navigator.clipboard.writeText(txt);
    showToast('Lista copiada al portapapeles 📋', 'success');
  }
}

// ================================================================
//  HELPERS
// ================================================================
function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast toast--${type} toast--show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('toast--show'), 3500);
}

// ================================================================
//  BORRADOR AUTOMÁTICO — localStorage + API
// ================================================================

// Guarda items en localStorage inmediatamente (sin red)
function saveDraftLocal() {
  storeMergeDraft({
    items:       items,
    total:       total,
    supermarket: document.getElementById('supermarket')?.value || ''
  });
}

// Guarda/actualiza borrador en la nube en background (debounce)
let _draftTimer = null;
function saveDraftCloud() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(_uploadDraft, 1500);
}

async function _uploadDraft() {
  if (!currentUser || !items.length) return;

  const now    = new Date();
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const label  = `${months[now.getMonth()]} ${now.getFullYear()}`;
  const draftId= storeGet().draft?.listId;
  const supermarket = document.getElementById('supermarket')?.value || null;

  try {
    if (draftId) {
      // Actualizar borrador existente (reemplaza items + total)
      await api(`/lists?id=${draftId}`, {
        method: 'PUT',
        body: JSON.stringify({ total, supermarket, items: items.map(mapItem), status: 'draft' })
      });
    } else {
      // Crear borrador nuevo
      const { id } = await api('/lists', {
        method: 'POST',
        body: JSON.stringify({
          userId:      currentUser.id,
          label,
          month:       now.getMonth() + 1,
          year:        now.getFullYear(),
          supermarket,
          total,
          status:      'draft',
          items:       items.map(mapItem)
        })
      });
      storeMergeDraft({ listId: id });
    }
  } catch (err) {
    // Silencioso — el draft local ya está guardado
    console.warn('Draft cloud save failed (offline?):', err.message);
  }
}

// Al abrir la app: verificar si hay borrador pendiente
async function checkForDraft() {
  // 1. Intentar recuperar de la nube primero
  if (currentUser) {
    try {
      const data = await api(`/lists?scope=draft&userId=${encodeURIComponent(currentUser.id)}`);
      if (data && data.items?.length) {
        storeMergeDraft({ listId: data.id });
        const cloudItems = data.items.map(i => ({
          id:           Date.now() + Math.random(),
          product_name: i.product_name,
          quantity:     i.quantity,
          unit_price:   parseFloat(i.unit_price),
          total_price:  parseFloat(i.total_price)
        }));
        storeMergeDraft({ items: cloudItems, total: parseFloat(data.total) });
        showDraftModal(data.label, cloudItems.length, parseFloat(data.total));
        return;
      }
    } catch (err) {
      console.warn('No se pudo verificar draft en la nube:', err.message);
    }
  }

  // 2. Fallback: verificar store local
  const localDraft = storeGet().draft;
  if (localDraft?.items?.length) {
    showDraftModal('lista anterior', localDraft.items.length, localDraft.total || 0);
  }
}

function showDraftModal(label, count, draftTotal) {
  const existing = document.getElementById('draftModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id        = 'draftModal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-box draft-modal-box">
      <div class="draft-icon">🛒</div>
      <h3>Tenés una lista en progreso</h3>
      <p class="draft-info">
        <strong>${label}</strong><br/>
        ${count} producto${count !== 1 ? 's' : ''} · Total $${draftTotal.toFixed(2)}
      </p>
      <div class="draft-actions">
        <button class="btn-primary" onclick="resumeDraft()">Continuar lista</button>
        <button class="btn-ghost"   onclick="discardDraft()">Empezar nueva</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function resumeDraft() {
  const draft = storeGet().draft;
  if (!draft?.items?.length) return;

  items = draft.items;
  total = items.reduce((sum, i) => sum + i.total_price, 0);
  const supermarket = draft.supermarket || '';
  const sm = document.getElementById('supermarket');
  if (sm) sm.value = supermarket;

  renderList();
  updateTotal();

  document.getElementById('draftModal')?.remove();
  showToast('Lista retomada ✅', 'success');
}

async function discardDraft() {
  const draftId = storeGet().draft?.listId;
  if (draftId && currentUser) {
    try { await api(`/lists?id=${draftId}`, { method: 'DELETE' }); }
    catch (e) { /* silencioso */ }
  }
  storeClearDraft();

  document.getElementById('draftModal')?.remove();
  showToast('Lista nueva iniciada', 'info');
}
