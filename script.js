// ================================================================
//  CONFIGURACIÓN SUPABASE
//  👇 Reemplazá estos dos valores con los tuyos
//     Supabase Dashboard → Settings → API
// ================================================================
const SUPABASE_URL  = 'https://rvudlaehohyodttetsjp.supabase.co';
const SUPABASE_ANON = 'sb_publishable_b0xt4ednHwA7mCj-TSGZVA_OHJ0ay8W';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);


 // ================================================================
//  ESTADO GLOBAL
// ================================================================
let currentUser  = null;   // { id, name, device_key }
let items        = [];
let total        = 0;
let priceEvoData = [];     // cache para filtro de evolución
 
// ================================================================
//  INIT
// ================================================================
 
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
 
  // device_key: nombre + timestamp fijo (único por dispositivo)
  const deviceKey = storeGet().deviceKey ||
    `${mailVal.toLowerCase().replace(/\s+/g,'-')}`;
  storeSet({ deviceKey });
 
  try {
    // Buscar si ya existe este device
    let { data: existing } = await db
      .from('users')
      .select('*')
      .eq('device_key', deviceKey)
      .maybeSingle();
 
    if (existing) {
      currentUser = existing;
    } else {
      // Crear usuario nuevo
      const { data: created, error } = await db
        .from('users')
        .insert({ name: nameVal, device_key: deviceKey })
        .select()
        .single();
      if (error) throw error;
      currentUser = created;
    }
 
    storeSet({ user: currentUser });
    enterApp();
    showToast(`¡Bienvenido, ${currentUser.name}! 👋`, 'success');
 
  } catch (err) {
    console.error(err);
    showToast('Error al conectar con Supabase. Revisá las credenciales.', 'error');
  }
}
 
async function enterApp() {
  document.getElementById('screen-welcome').classList.remove('active');
  document.getElementById('screen-main').classList.add('active');
  document.getElementById('headerUser').textContent = currentUser.name;
  await checkForDraft();
}
 
// ================================================================
//  NAVEGACIÓN POR TABS
// ================================================================
function showTab(tabId, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
 
  if (tabId === 'tab-history') loadHistory();
  if (tabId === 'tab-reports') loadReports();
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
    try {
      await db.from('list_items').delete().eq('list_id', draftId);
      await db.from('shopping_lists').delete().eq('id', draftId);
    } catch(e) { /* silencioso */ }
  }
 
  storeClearDraft();
  items = [];
  total = 0;
  renderList();
  updateTotal();
  document.getElementById('supermarket').value = '';
  showToast('Lista nueva lista 🧹', 'info');
}
 
function updateTotal() {
  document.getElementById('totalAmount').textContent = `$${total.toFixed(2)}`;
}
 
// ================================================================
//  GUARDAR EN SUPABASE
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
      await db.from('list_items').delete().eq('list_id', draftId);
      await db.from('shopping_lists').delete().eq('id', draftId);
      storeClearDraft();
    }
 
    // Guardar lista definitiva con status='done'
    const { data: list, error: listErr } = await db
      .from('shopping_lists')
      .insert({
        user_id:     currentUser.id,
        label,
        month:       now.getMonth() + 1,
        year:        now.getFullYear(),
        supermarket: document.getElementById('supermarket').value.trim() || null,
        total,
        status:      'done'
      })
      .select()
      .single();
 
    if (listErr) throw listErr;
 
    const rows = items.map(i => ({
      list_id:      list.id,
      product_name: i.product_name,
      quantity:     i.quantity,
      unit_price:   i.unit_price,
      total_price:  i.total_price
    }));
 
    const { error: itemsErr } = await db.from('list_items').insert(rows);
    if (itemsErr) throw itemsErr;
 
    // Limpiar solo el borrador del store (la lista sigue visible en pantalla)
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
async function loadHistory() {
  if (!currentUser) return;
  const container = document.getElementById('historyList');
  container.innerHTML = '<p class="empty-msg">Cargando…</p>';
 
  try {
    // Solo listas definitivamente guardadas (status = 'done'), no borradores
    const { data, error } = await db
      .from('shopping_lists')
      .select('id, label, total, supermarket, created_at, status')
      .eq('user_id', currentUser.id)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(30);
 
    if (error) throw error;
    if (!data.length) {
      container.innerHTML = '<p class="empty-msg">Aún no guardaste listas.<br/>Agregá productos y tocá ☁️ Guardar.</p>';
      return;
    }
 
    container.innerHTML = data.map(list => `
      <div class="history-card" onclick="showListDetail('${list.id}', '${escapeHtml(list.label)}', '${escapeHtml(list.supermarket || '')}', '${new Date(list.created_at).toLocaleDateString('es-AR')}')">
        <div class="history-card-top">
          <span class="history-label">${list.label}</span>
          <span class="history-total">$${parseFloat(list.total).toFixed(2)}</span>
        </div>
        <div class="history-card-bottom">
          <span>${list.supermarket || 'Sin supermercado'}</span>
          <span>${new Date(list.created_at).toLocaleDateString('es-AR')}</span>
        </div>
      </div>
    `).join('');
 
  } catch (err) {
    container.innerHTML = `<p class="empty-msg error-msg">Error: ${err.message}</p>`;
  }
}
 
async function showListDetail(listId, label, supermarket, date) {
  const titleEl = document.getElementById('modalTitle');
  titleEl.textContent = label;
  document.getElementById('modalBody').innerHTML = '<p class="empty-msg">Cargando…</p>';
  document.getElementById('modal').style.display = 'flex';
 
  const { data, error } = await db
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .order('product_name');
 
  if (error || !data) {
    document.getElementById('modalBody').innerHTML = '<p class="empty-msg error-msg">Error al cargar.</p>';
    return;
  }
 
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
//  REPORTES
// ================================================================
async function loadReports() {
  if (!currentUser) return;
  await Promise.all([loadMonthlyReport(), loadTopProducts(), loadPriceEvolution()]);
}
 
async function loadMonthlyReport() {
  const el = document.getElementById('reportMonthly');
  el.innerHTML = '<p class="empty-msg">Cargando…</p>';
 
  const { data, error } = await db
    .from('shopping_lists')
    .select('year, month, label, total')
    .eq('user_id', currentUser.id)
    .order('year',  { ascending: false })
    .order('month', { ascending: false });
 
  if (error || !data?.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }
 
  // Agrupar por año-mes
  const grouped = {};
  data.forEach(r => {
    const key = `${r.year}-${String(r.month).padStart(2,'0')}`;
    if (!grouped[key]) grouped[key] = { label: r.label, total: 0, count: 0 };
    grouped[key].total += parseFloat(r.total);
    grouped[key].count++;
  });
 
  el.innerHTML = Object.entries(grouped).map(([, v]) => `
    <div class="report-row">
      <span class="report-label">${v.label}</span>
      <span class="report-value">$${v.total.toFixed(2)}</span>
      <span class="report-sub">${v.count} lista${v.count>1?'s':''}</span>
    </div>
  `).join('');
}
 
async function loadTopProducts() {
  const el = document.getElementById('reportTopProducts');
  el.innerHTML = '<p class="empty-msg">Cargando…</p>';
 
  // Join a través de shopping_lists para filtrar por usuario
  const { data: lists } = await db
    .from('shopping_lists')
    .select('id')
    .eq('user_id', currentUser.id);
 
  if (!lists?.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }
 
  const listIds = lists.map(l => l.id);
 
  const { data, error } = await db
    .from('list_items')
    .select('product_name, quantity')
    .in('list_id', listIds);
 
  if (error || !data?.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }
 
  // Agrupar localmente
  const counts = {};
  data.forEach(i => {
    counts[i.product_name] = (counts[i.product_name] || 0) + i.quantity;
  });
 
  const sorted = Object.entries(counts)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 10);
 
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
 
async function loadPriceEvolution() {
  const el = document.getElementById('reportPriceEvolution');
  el.innerHTML = '<p class="empty-msg">Cargando…</p>';
 
  const { data: lists } = await db
    .from('shopping_lists')
    .select('id, label, year, month')
    .eq('user_id', currentUser.id);
 
  if (!lists?.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }
 
  const listIds  = lists.map(l => l.id);
  const listMap  = Object.fromEntries(lists.map(l => [l.id, l]));
 
  const { data, error } = await db
    .from('list_items')
    .select('product_name, unit_price, list_id')
    .in('list_id', listIds)
    .order('product_name');
 
  if (error || !data?.length) { el.innerHTML = '<p class="empty-msg">Sin datos aún</p>'; return; }
 
  // Armar estructura: { producto: [ { label, price } ] }
  const evo = {};
  data.forEach(i => {
    if (!evo[i.product_name]) evo[i.product_name] = [];
    const list = listMap[i.list_id];
    evo[i.product_name].push({
      label: list.label,
      year:  list.year,
      month: list.month,
      price: parseFloat(i.unit_price)
    });
  });
 
  // Ordenar entradas por fecha
  Object.values(evo).forEach(arr => arr.sort((a,b) => a.year===b.year ? a.month-b.month : a.year-b.year));
 
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
//  BORRADOR AUTOMÁTICO — localStorage + Supabase
// ================================================================
 
// Guarda items en localStorage inmediatamente (sin red)
function saveDraftLocal() {
  storeMergeDraft({
    items:       items,
    total:       total,
    supermarket: document.getElementById('supermarket')?.value || ''
  });
}
 
// Guarda/actualiza borrador en Supabase en background
let _draftTimer = null;
function saveDraftCloud() {
  // Debounce: espera 31.5s sin cambios antes de subir
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(_uploadDraft, 31500);
}
 
async function _uploadDraft() {
  if (!currentUser || !items.length) return;
 
  const now    = new Date();
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const label  = `${months[now.getMonth()]} ${now.getFullYear()}`;
  const draftId = storeGet().draft?.listId;
 
  try {
    let listId = draftId;
 
    if (draftId) {
      // Actualizar total del draft existente
      await db.from('shopping_lists')
        .update({ total, supermarket: document.getElementById('supermarket')?.value || null })
        .eq('id', draftId);
 
      // Reemplazar todos los items
      await db.from('list_items').delete().eq('list_id', draftId);
 
    } else {
      // Crear nuevo draft
      const { data, error } = await db
        .from('shopping_lists')
        .insert({
          user_id:     currentUser.id,
          label,
          month:       now.getMonth() + 1,
          year:        now.getFullYear(),
          supermarket: document.getElementById('supermarket')?.value || null,
          total,
          status:      'draft'
        })
        .select()
        .single();
 
      if (error) throw error;
      listId = data.id;
      storeMergeDraft({ listId });
    }
 
    // Insertar items actuales
    const rows = items.map(i => ({
      list_id:      listId,
      product_name: i.product_name,
      quantity:     i.quantity,
      unit_price:   i.unit_price,
      total_price:  i.total_price
    }));
    await db.from('list_items').insert(rows);
 
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
      const { data } = await db
        .from('shopping_lists')
        .select('*, list_items(*)')
        .eq('user_id', currentUser.id)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
 
      if (data && data.list_items?.length) {
        storeMergeDraft({ listId: data.id });
        // Sincronizar store con lo que hay en la nube
        const cloudItems = data.list_items.map(i => ({
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
  // Crear modal dinámico
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
  // Borrar draft de la nube
  const draftId = storeGet().draft?.listId;
  if (draftId && currentUser) {
    try {
      await db.from('list_items').delete().eq('list_id', draftId);
      await db.from('shopping_lists').delete().eq('id', draftId);
    } catch(e) { /* silencioso */ }
  }
  storeClearDraft();
 
  document.getElementById('draftModal')?.remove();
  showToast('Lista nueva iniciada', 'info');
}