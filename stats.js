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

    const len = { month: 1, quarter: 3, year: 12 }[type] || 1;
    const groups = {};
    const allMonths = {};   // índice de mes → total gastado (para comparar)

    valid.forEach(l => {
      const { key, label } = periodOf(l, type);
      const y = Number(l.year), m = Number(l.month);
      const mIdx = monthIndex(y, m);
      const amount = parseFloat(l.total) || 0;
      // primer mes del período (enero del año / primer mes del trimestre / el mismo mes)
      const startIdx = type === 'year'    ? monthIndex(y, 1)
                     : type === 'quarter' ? monthIndex(y, (quarterOf(m) - 1) * 3 + 1)
                     : mIdx;
      if (!groups[key]) groups[key] = { key, label, startIdx, lastIdx: mIdx, purchases: [], byMonth: {} };
      const g = groups[key];
      g.purchases.push(amount);
      g.byMonth[mIdx] = (g.byMonth[mIdx] || 0) + amount;
      if (mIdx > g.lastIdx) g.lastIdx = mIdx;
      allMonths[mIdx] = (allMonths[mIdx] || 0) + amount;
    });

    // Variación contra el período calendario anterior, comparando los
    // MISMOS meses: si el año va de enero a octubre, se compara contra
    // enero–octubre del año anterior (acumulado). Si falta algún mes con
    // compras en cualquiera de los dos tramos, no se calcula.
    function compare(g) {
      // Mensual: si el mes anterior no tiene compras, se toma el último
      // mes anterior que sí tenga.
      if (type === 'month') {
        const prevIdx = Object.keys(allMonths).map(Number)
          .filter(i => i < g.startIdx).sort((a, b) => b - a)[0];
        if (prevIdx === undefined || allMonths[prevIdx] <= 0) return null;
        const base = allMonths[prevIdx], cur = allMonths[g.startIdx];
        return { change: (cur - base) / base, base,
                 baseLabel: prevIdx === g.startIdx - 1 ? '' : labelOf(prevIdx).toLowerCase() };
      }
      let cur = 0, base = 0;
      for (let i = g.startIdx; i <= g.lastIdx; i++) {
        if (!(i in allMonths) || !((i - len) in allMonths)) return null;
        cur  += allMonths[i];
        base += allMonths[i - len];
      }
      if (base <= 0) return null;
      return { change: (cur - base) / base, base };
    }

    const asc = Object.values(groups).sort((a, b) => a.key.localeCompare(b.key));

    const result = asc.map(g => {
      const monthlyTotals = Object.values(g.byMonth);
      const total = sum(g.purchases);
      const cmp   = compare(g);
      const partial = g.lastIdx - g.startIdx + 1 < len;
      return {
        accumLabel:     partial ? `acum. ${labelOf(g.startIdx).split(' ')[0].toLowerCase()}–${labelOf(g.lastIdx).split(' ')[0].toLowerCase()}` : '',
        prevBase:       cmp ? cmp.base : null,
        prevBaseLabel:  cmp && cmp.baseLabel ? cmp.baseLabel : '',
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
        changeVsPrev:      cmp ? cmp.change : null
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

  // ==============================================================
  //  PRECIOS POR PRODUCTO: promedio, mediana, mín/máx y vs mes anterior
  //  (precio unitario; cada vez que se compró cuenta como un registro)
  // ==============================================================
  function computeProductPriceStats(lists) {
    const prods = {};
    (lists || []).forEach(l => {
      if (!(Number(l.year) > 0 && Number(l.month) >= 1 && Number(l.month) <= 12)) return;
      const idx = monthIndex(l.year, l.month);
      (l.items || []).forEach(i => {
        const qty   = Number(i.quantity) || 0;
        const price = parseFloat(i.unit_price) || 0;
        if (qty <= 0 || price <= 0) return;             // sin precio cargado: no cuenta
        const key = normalizeName(i.product_name);
        if (!key) return;
        if (!prods[key]) prods[key] = { name: String(i.product_name).trim(), rubro: rubroOf(i.product_name, l.supermarket), prices: [], months: {} };
        const p = prods[key];
        p.prices.push(price);
        const m = p.months[idx] || (p.months[idx] = { amount: 0, qty: 0 });
        m.amount += price * qty;
        m.qty    += qty;
      });
    });

    return Object.values(prods).map(p => {
      const idxs = Object.keys(p.months).map(Number).sort((a, b) => a - b);
      const monthPrice = i => p.months[i].amount / p.months[i].qty;
      const lastIdx = idxs[idxs.length - 1];
      const prevIdx = idxs.length > 1 ? idxs[idxs.length - 2] : null;   // último mes anterior con compras
      const last = monthPrice(lastIdx);
      const prev = prevIdx !== null ? monthPrice(prevIdx) : null;
      return {
        name:          p.name,
        rubro:         p.rubro,
        count:         p.prices.length,
        months:        idxs.length,
        lastLabel:     labelOf(lastIdx),
        lastPrice:     last,
        avg:           mean(p.prices),
        median:        median(p.prices),
        min:           Math.min(...p.prices),
        max:           Math.max(...p.prices),
        prevPrice:     prev,
        prevLabel:     prevIdx !== null ? labelOf(prevIdx) : '',
        prevIsGap:     prevIdx !== null && prevIdx !== lastIdx - 1,
        changeVsPrev:  prev ? (last - prev) / prev : null
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  // Totales para la fila TOTAL de la tabla de productos
  function computeProductTotals(products) {
    const ps = products || [];
    const withPrev = ps.filter(p => p.prevPrice);
    const lastCompared = sum(withPrev.map(p => p.lastPrice));
    const prevCompared = sum(withPrev.map(p => p.prevPrice));
    return {
      products:     ps.length,
      last:         sum(ps.map(p => p.lastPrice)),
      avg:          sum(ps.map(p => p.avg)),
      median:       sum(ps.map(p => p.median)),
      min:          sum(ps.map(p => p.min)),
      max:          sum(ps.map(p => p.max)),
      compared:     withPrev.length,
      lastCompared, prevCompared,
      change:       prevCompared > 0 ? (lastCompared - prevCompared) / prevCompared : null
    };
  }

  const api = { mean, median, computeSpendingStats, computeOverallStats, computeProductPriceStats, computeProductTotals,
                computePriceIncreases, normalizeName, rubroOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
