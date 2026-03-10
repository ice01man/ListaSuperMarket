// ============================================================
// ESTADO GLOBAL
// ============================================================

let items = JSON.parse(localStorage.getItem('shoppingItems')) || [];

// BUG FIX #1: El total se recalcula desde los items para evitar
// desincronización entre localStorage y la variable global.
let total = recalcTotal(items);

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    updateList();
    updateTotal();
});

// ============================================================
// LÓGICA PRINCIPAL
// ============================================================

function addItem() {
    const nameInput     = document.getElementById('itemName');
    const priceInput    = document.getElementById('itemPrice');
    const quantityInput = document.getElementById('itemQuantity');

    if (!nameInput.value.trim() || !quantityInput.value) {
        alert('Por favor completa todos los campos');
        return;
    }

    // BUG FIX #2: La validación de precio vacío se hacía DESPUÉS de parseFloat,
    // cuando ya era NaN. Se revisa el valor crudo primero.
    const rawPrice = priceInput.value;
    const price    = (rawPrice === '' || isNaN(parseFloat(rawPrice))) ? 0 : parseFloat(rawPrice);

    const item = {
        id:       Date.now(),           // number
        name:     nameInput.value.trim(),
        price:    price,
        quantity: parseInt(quantityInput.value, 10),
        total:    0
    };

    item.total = item.price * item.quantity;
    items.push(item);
    total += item.total;

    saveToLocalStorage();
    updateList();
    updateTotal();
    clearInputs();
}

function updateList() {
    const list = document.getElementById('itemsList');
    list.innerHTML = '';

    items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'item';

        // BUG FIX #3: Se usa data-id en el <li> en lugar de id en el input de precio,
        // para evitar IDs duplicados si el DOM se regenera y para que la búsqueda
        // sea robusta.
        li.dataset.id = item.id;

        li.innerHTML = `
            <span>${escapeHtml(item.name)}</span>
            <span class="item-inputs">
                <input type="number" class="qty-input"   value="${item.quantity}" min="1">
                x $
                <input type="number" class="price-input" value="${item.price}" step="0.01" min="0">
            </span>
            <span class="item-total">$${item.total.toFixed(2)}</span>
            <button onclick="removeItem(${item.id})" class="clear">🗑️</button>
        `;
        list.appendChild(li);

        // BUG FIX #4: Se registra el evento en el <li> usando delegación correcta.
        // El código original usaba getElementsByClassName DENTRO de updateList,
        // acumulando N listeners por cada render (memory leak + doble disparo).
        li.addEventListener('change', function (e) {
            handleItemChange(this);
        });
    });
}

// BUG FIX #5 (principal): En el handler original:
//   - xId era string (del atributo id del input) pero item.id es number → findIndex siempre fallaba → cada cambio DUPLICABA el item en localStorage.
//   - El total global (variable `total`) nunca se actualizaba al editar inline.
//   - saveToLocalStorage() guardaba la variable `items` (desactualizada) en vez del array local modificado.
function handleItemChange(liElement) {
    const id       = parseInt(liElement.dataset.id, 10);  // ← number, igual que item.id
    const name     = liElement.children[0].textContent;
    const quantity = parseInt(liElement.querySelector('.qty-input').value, 10);
    const price    = parseFloat(liElement.querySelector('.price-input').value) || 0;
    const newTotal = quantity * price;

    // Actualizar el total mostrado en la fila
    liElement.querySelector('.item-total').textContent = `$${newTotal.toFixed(2)}`;

    // Actualizar el array global
    const idx = items.findIndex(item => item.id === id);
    if (idx !== -1) {
        total -= items[idx].total;   // restar el total anterior
        items[idx] = { id, name, price, quantity, total: newTotal };
        total += newTotal;           // sumar el nuevo
    }

    saveToLocalStorage();
    updateTotal();
}

function removeItem(id) {
    items = items.filter(item => {
        if (item.id === id) {
            total -= item.total;
            return false;
        }
        return true;
    });
    saveToLocalStorage();
    updateList();
    updateTotal();
}

function clearList() {
    if (confirm('¿Estás seguro de querer borrar toda la lista?')) {
        items = [];
        total = 0;
        localStorage.removeItem('shoppingItems');
        localStorage.removeItem('shoppingTotal');
        updateList();
        updateTotal();
    }
}

// ============================================================
// HELPERS
// ============================================================

function recalcTotal(arr) {
    return arr.reduce((acc, item) => acc + (item.total || 0), 0);
}

// BUG FIX #6: shareList fallaba con TypeError si price/total eran string
// (tras edición inline, se guardaban como string en localStorage).
// Ahora se castea a number antes de llamar a toFixed().
function shareList() {
    if (items.length === 0) {
        alert('La lista está vacía');
        return;
    }

    let listText = '📝 Lista de Compras:\n\n';
    items.forEach(item => {
        const price    = parseFloat(item.price)  || 0;
        const itemTotal = parseFloat(item.total) || 0;
        listText += `✔ ${item.name} - ${item.quantity} x $${price.toFixed(2)} = $${itemTotal.toFixed(2)}\n`;
    });
    listText += `\n💰 Total: $${total.toFixed(2)}`;

    if (navigator.share) {
        navigator.share({ title: 'Mi Lista de Compras', text: listText }).catch(console.error);
    } else {
        navigator.clipboard.writeText(listText);
        alert('Lista copiada al portapapeles! 📋');
    }
}

function saveToLocalStorage() {
    localStorage.setItem('shoppingItems', JSON.stringify(items));
    localStorage.setItem('shoppingTotal', total.toString());
}

function updateTotal() {
    document.getElementById('totalAmount').textContent = `Total: $${total.toFixed(2)}`;
}

function clearInputs() {
    document.getElementById('itemName').value     = '';
    document.getElementById('itemPrice').value    = '0';
    document.getElementById('itemQuantity').value = '1';
}

// Previene XSS al insertar nombres de productos en innerHTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ============================================================
// NUBE — JSONBin.io (gratuito, sin backend propio requerido)
// Alternativa: reemplazar las URLs por tu propio backend Node/Express + MongoDB
// ============================================================

const JSONBIN_API_KEY = 'TU_API_KEY_AQUI';  // ← Registrate en jsonbin.io y pegá tu key
const JSONBIN_BASE    = 'https://api.jsonbin.io/v3/b';

function showStatus(msg, type = 'info') {
    const el = document.getElementById('cloudStatus');
    el.textContent = msg;
    el.className   = `cloud-status cloud-status--${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

async function saveToCloud() {
    if (items.length === 0) {
        alert('La lista está vacía, no hay nada que guardar.');
        return;
    }

    showStatus('Guardando en la nube…', 'info');

    const payload = { items, total, savedAt: new Date().toISOString() };
    const listId  = localStorage.getItem('cloudListId');

    try {
        let url    = JSONBIN_BASE;
        let method = 'POST';

        if (listId) {
            // Actualizar bin existente
            url    = `${JSONBIN_BASE}/${listId}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type':  'application/json',
                'X-Master-Key':  JSONBIN_API_KEY,
                'X-Bin-Private': 'false'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const newId = data.metadata?.id || data.record?.id || listId;

        if (newId) {
            localStorage.setItem('cloudListId', newId);
            showStatus(`✅ Lista guardada. ID: ${newId}`, 'success');
        } else {
            showStatus('✅ Lista actualizada en la nube.', 'success');
        }

    } catch (err) {
        console.error(err);
        showStatus('❌ Error al guardar. Revisá la API key o la conexión.', 'error');
    }
}

function loadFromCloud() {
    document.getElementById('cloudModal').style.display = 'flex';
    const saved = localStorage.getItem('cloudListId');
    if (saved) document.getElementById('cloudListId').value = saved;
}

function closeModal() {
    document.getElementById('cloudModal').style.display = 'none';
}

async function confirmLoad() {
    const inputId = document.getElementById('cloudListId').value.trim();
    if (!inputId) { alert('Ingresá un ID de lista válido.'); return; }

    closeModal();
    showStatus('Cargando desde la nube…', 'info');

    try {
        const res = await fetch(`${JSONBIN_BASE}/${inputId}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const record = data.record;

        if (!record?.items) throw new Error('Formato de datos inválido');

        items = record.items;
        total = recalcTotal(items);

        localStorage.setItem('cloudListId', inputId);
        saveToLocalStorage();
        updateList();
        updateTotal();

        showStatus('✅ Lista cargada correctamente desde la nube.', 'success');

    } catch (err) {
        console.error(err);
        showStatus('❌ No se pudo cargar la lista. Verificá el ID.', 'error');
    }
}