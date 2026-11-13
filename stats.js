// ================================================================
//  ESTADÍSTICAS DE GASTO  (funciones puras, sin DOM)
//  Se usan en la pestaña Reportes. Toman las listas guardadas
//  (status 'done') y calculan, por mes / trimestre / año:
//    - cantidad de compras y total gastado
//    - promedio (media) y mediana POR COMPRA
//    - mínimo y máximo por compra
//    - en trimestre y año: promedio y mediana MENSUAL
//      (sobre los meses del período que tienen compras)
//    - variación del total contra el período anterior
// ================================================================
(function (root) {
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  function sum(arr)  { return arr.reduce((a, n) => a + n, 0); }
  function mean(arr) { return arr.length ? sum(arr) / arr.length : 0; }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function quarterOf(month) { return Math.ceil(month / 3); }

  // Clave y etiqueta de cada período según el tipo
  function periodOf(list, type) {
    const y = Number(list.year);
    const m = Number(list.month);
    if (type === 'year')    return { key: `${y}`, label: `${y}` };
    if (type === 'quarter') { const q = quarterOf(m); return { key: `${y}-Q${q}`, label: `T${q} ${y}` }; }
    return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${MESES[m - 1] || m} ${y}` };
  }

  // type: 'month' | 'quarter' | 'year'
  // Devuelve un array ordenado del período más reciente al más viejo.
  function computeSpendingStats(lists, type = 'month') {
    const valid = (lists || []).filter(l =>
      Number(l.year) > 0 && Number(l.month) >= 1 && Number(l.month) <= 12);

    const groups = {};
    valid.forEach(l => {
      const { key, label } = periodOf(l, type);
      const monthKey = `${l.year}-${String(l.month).padStart(2, '0')}`;
      const amount = parseFloat(l.total) || 0;
      if (!groups[key]) groups[key] = { key, label, purchases: [], byMonth: {} };
      groups[key].purchases.push(amount);
      groups[key].byMonth[monthKey] = (groups[key].byMonth[monthKey] || 0) + amount;
    });

    // Orden cronológico ascendente para calcular variación
    const asc = Object.values(groups).sort((a, b) => a.key.localeCompare(b.key));

    const result = asc.map((g, idx) => {
      const monthlyTotals = Object.values(g.byMonth);
      const total = sum(g.purchases);
      const prev  = idx > 0 ? sum(asc[idx - 1].purchases) : null;
      return {
        key:            g.key,
        label:          g.label,
        count:          g.purchases.length,
        total,
        avgPerPurchase:    mean(g.purchases),
        medianPerPurchase: median(g.purchases),
        minPurchase:       Math.min(...g.purchases),
        maxPurchase:       Math.max(...g.purchases),
        monthsWithPurchases: monthlyTotals.length,
        avgPerMonth:       mean(monthlyTotals),
        medianPerMonth:    median(monthlyTotals),
        changeVsPrev:      prev ? (total - prev) / prev : null
      };
    });

    return result.reverse();
  }

  // Resumen general (todas las compras del filtro actual)
  function computeOverallStats(lists) {
    const valid = (lists || []).filter(l => Number(l.year) > 0 && Number(l.month) >= 1);
    const purchases = valid.map(l => parseFloat(l.total) || 0);
    const byMonth = {};
    valid.forEach(l => {
      const k = `${l.year}-${String(l.month).padStart(2, '0')}`;
      byMonth[k] = (byMonth[k] || 0) + (parseFloat(l.total) || 0);
    });
    const monthly = Object.values(byMonth);
    return {
      count:             purchases.length,
      total:             sum(purchases),
      avgPerPurchase:    mean(purchases),
      medianPerPurchase: median(purchases),
      months:            monthly.length,
      avgPerMonth:       mean(monthly),
      medianPerMonth:    median(monthly)
    };
  }

  // ==============================================================
  //  AUMENTOS DE PRECIO POR RUBRO Y POR PRODUCTO
  // ==============================================================
  // Mínimo de meses consecutivos con compra del producto para calcular.
  const MIN_MESES_CONSECUTIVOS = 3;

  // Rubros: se detectan por el nombre del producto o por el campo
  // "supermercado" de la lista (ej: YPF, Shell). Lo que no coincide es "Super".
  // Para sumar un rubro nuevo, agregar una entrada acá.
  const RUBROS = [
    { nombre: 'Nafta',
      producto: /\b(nafta|combustible|gasoil|gas oil|diesel|gnc)\b/,
      lugar:    /\b(ypf|shell|axion|puma|gulf|estacion de servicio)\b/ }
  ];
  const RUBRO_DEFAULT = 'Super';

  // "Leche  Entera" y "leche entera" son el mismo producto (mayúsculas,
  // acentos y espacios de más no cuentan). Cualquier otra diferencia sí.
  function normalizeName(str) {
    return String(str || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function rubroOf(productName, supermarket) {
    const p = normalizeName(productName);
    const s = normalizeName(supermarket);
    for (const r of RUBROS) {
      if (r.producto.test(p) || (s && r.lugar.test(s))) return r.nombre;
    }
    return RUBRO_DEFAULT;
  }

  function monthIndex(year, month) { return Number(year) * 12 + (Number(month) - 1); }
  function labelOf(idx) { return `${MESES[idx % 12].slice(0, 3)} ${Math.floor(idx / 12)}`; }

  // Devuelve { products: [...], rubros: [...], excluded: n }
  function computePriceIncreases(lists) {
    const prods = {};   // key normalizada → { name, rubro, months: { idx: {amount, qty} } }

    (lists || []).forEach(l => {
      if (!(Number(l.year) > 0 && Number(l.month) >= 1 && Number(l.month) <= 12)) return;
      const idx = monthIndex(l.year, l.month);
      (l.items || []).forEach(i => {
        const qty   = Number(i.quantity) || 0;
        const price = parseFloat(i.unit_price) || 0;
        if (qty <= 0 || price <= 0) return;           // sin precio cargado: no cuenta
        const key = normalizeName(i.product_name);
        if (!key) return;
        if (!prods[key]) prods[key] = { name: String(i.product_name).trim(), rubro: rubroOf(i.product_name, l.supermarket), months: {} };
        const m = prods[key].months[idx] || (prods[key].months[idx] = { amount: 0, qty: 0 });
        m.amount += price * qty;
        m.qty    += qty;
      });
    });

    const products = [];
    let excluded = 0;

    Object.values(prods).forEach(p => {
      const idxs = Object.keys(p.months).map(Number).sort((a, b) => a - b);
      // Tramo más reciente de meses consecutivos
      let start = idxs.length - 1;
      while (start > 0 && idxs[start - 1] === idxs[start] - 1) start--;
      const run = idxs.slice(start);
      if (run.length < MIN_MESES_CONSECUTIVOS) { excluded++; return; }

      // Precio del mes = promedio ponderado por cantidad
      const prices = run.map(i => p.months[i].amount / p.months[i].qty);
      const first = prices[0], prev = prices[prices.length - 2], last = prices[prices.length - 1];
      products.push({
        name:          p.name,
        rubro:         p.rubro,
        months:        run.length,
        fromLabel:     labelOf(run[0]),
        toLabel:       labelOf(run[run.length - 1]),
        firstPrice:    first,
        lastPrice:     last,
        lastChange:    (last - prev) / prev,                              // último mes vs anterior
        accumChange:   (last - first) / first,                            // acumulado del tramo
        monthlyChange: Math.pow(last / first, 1 / (run.length - 1)) - 1   // promedio mensual compuesto
      });
    });

    products.sort((a, b) => b.accumChange - a.accumChange);

    // Resumen por rubro: promedio y mediana de los productos calculados
    const byRubro = {};
    products.forEach(p => (byRubro[p.rubro] = byRubro[p.rubro] || []).push(p));
    const rubros = Object.entries(byRubro).map(([nombre, arr]) => ({
      nombre,
      productos:           arr.length,
      lastChangeAvg:       mean(arr.map(p => p.lastChange)),
      monthlyChangeAvg:    mean(arr.map(p => p.monthlyChange)),
      monthlyChangeMedian: median(arr.map(p => p.monthlyChange))
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));

    return { products, rubros, excluded, minMonths: MIN_MESES_CONSECUTIVOS };
  }

  const api = { mean, median, computeSpendingStats, computeOverallStats,
                computePriceIncreases, normalizeName, rubroOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
