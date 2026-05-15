// Main Application

document.addEventListener('DOMContentLoaded', async () => {
    initializeAuthUI();
    await tryRestoreSession();
});

let clientSearchDebounce;
let selectedClientRef = '';
const opportunityStates = ['ABIERTA', 'EN_PROCESO', 'NEGOCIACION', 'GANADA', 'PERDIDA'];
let opportunitiesCache = [];
let opportunityFilterCode = '';
let opportunitiesAutoRefreshTimer = null;
let salesAutoRefreshTimer = null;
let currentUser = null;
let usersAdminCache = [];
let selectedSupportTicketId = null;
let rewardsCache = [];
let rewardsSelectedClientRef = '';
let rewardsPointsAvailable = 0;

let newSaleClientsCache = [];

let saleConfirmModalResolver = null;
let saleConfirmModalPayload = null;

let currentSalesReport = {
    rows: [],
    period: 'month',
    codigoCliente: '',
    vendedor: ''
};

function setSalesReportContext({ rows, period, codigoCliente, vendedor }) {
    currentSalesReport = {
        rows: Array.isArray(rows) ? rows : [],
        period: String(period || '').trim() || 'month',
        codigoCliente: String(codigoCliente || '').trim(),
        vendedor: String(vendedor || '').trim()
    };

    updateSalesExportButtons();
}

function updateSalesExportButtons() {
    const exportContainer = document.getElementById('sales-export-actions');
    const excelButton = document.getElementById('btn-export-excel');
    const pdfButton = document.getElementById('btn-export-pdf');

    if (!exportContainer || !excelButton || !pdfButton) {
        return;
    }

    const role = String(currentUser?.rol || '').toLowerCase();
    const isManager = role === 'gerente';
    const isSeller = role === 'vendedor';
    const canExport = isManager || isSeller;

    exportContainer.style.display = canExport ? 'flex' : 'none';

    const hasRows = Array.isArray(currentSalesReport?.rows) && currentSalesReport.rows.length > 0;
    excelButton.disabled = !canExport || !hasRows;
    pdfButton.disabled = !canExport || !hasRows;
}

function buildSalesExportFilename(extension) {
    const period = String(currentSalesReport?.period || 'month');
    const vendedor = String(currentSalesReport?.vendedor || '').trim();
    const codigoCliente = String(currentSalesReport?.codigoCliente || '').trim();

    const parts = ['reporte_ventas', period];
    if (vendedor) parts.push(vendedor.replace(/\s+/g, '_'));
    if (codigoCliente) parts.push(codigoCliente.replace(/\s+/g, '_'));

    return `${parts.join('_')}.${extension}`;
}

function formatDateEs(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function getTodayDateInputValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseSaleDateInputValue(value) {
    const dateValue = String(value || '').trim();
    if (!dateValue) {
        return null;
    }

    const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);

    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

function getPeriodBounds(periodValue, selectedPeriod) {
    if (!periodValue) {
        return null;
    }

    if (selectedPeriod === 'day') {
        const date = new Date(periodValue);
        if (Number.isNaN(date.getTime())) {
            return null;
        }
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
        return { start, end };
    }

    if (selectedPeriod === 'month') {
        const raw = String(periodValue);
        const match = raw.match(/^(\d{4})-(\d{2})$/);
        if (!match) {
            return null;
        }
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
            return null;
        }

        const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const end = new Date(year, month, 0, 23, 59, 59, 999);
        return { start, end };
    }

    if (selectedPeriod === 'week') {
        const numeric = Number(periodValue);
        const year = Math.floor(numeric / 100);
        const week = numeric % 100;
        if (!Number.isInteger(year) || !Number.isInteger(week) || week <= 0 || week > 53) {
            return null;
        }

        // ISO week: Monday as first day.
        const simple = new Date(year, 0, 1 + (week - 1) * 7);
        const dayOfWeek = simple.getDay() === 0 ? 7 : simple.getDay();
        const start = new Date(simple);
        start.setHours(0, 0, 0, 0);
        if (dayOfWeek <= 4) {
            start.setDate(simple.getDate() - (dayOfWeek - 1));
        } else {
            start.setDate(simple.getDate() + (8 - dayOfWeek));
        }

        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }

    return null;
}

function getSalesReportDateRange(rows, selectedPeriod) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { start: null, end: null };
    }

    const first = getPeriodBounds(rows[0].periodo, selectedPeriod);
    const last = getPeriodBounds(rows[rows.length - 1].periodo, selectedPeriod);

    return {
        start: first?.start || null,
        end: last?.end || null
    };
}

function exportSalesToExcel() {
    if (typeof XLSX === 'undefined') {
        showSalesMessage('No se encontró la librería para exportar a Excel', 'error');
        return;
    }

    const rows = currentSalesReport?.rows || [];
    const period = currentSalesReport?.period || 'month';
    const vendedor = String(currentSalesReport?.vendedor || '').trim();
    const codigoCliente = String(currentSalesReport?.codigoCliente || '').trim();

    const range = getSalesReportDateRange(rows, period);
    const rangeText = range.start && range.end
        ? `${formatDateEs(range.start)} - ${formatDateEs(range.end)}`
        : '-';

    const totalVentas = rows.reduce((acc, row) => acc + Number(row?.total_ventas ?? 0), 0);
    const cantidadVentas = rows.reduce((acc, row) => acc + Number(row?.cantidad_ventas ?? 0), 0);

    const data = rows.map((row) => ({
        Periodo: formatSalesPeriod(row.periodo, period),
        Total_ventas: Number(row.total_ventas ?? 0),
        Cantidad_ventas: Number(row.cantidad_ventas ?? 0)
    }));

    const workbook = XLSX.utils.book_new();

    // Crear hoja de resumen con estilos mejorados
    const resumenAoA = [
        ['REPORTE DE VENTAS', ''],
        ['Generado', new Date().toLocaleString('es-ES')],
        ['Agrupación', period === 'month' ? 'Mes' : period === 'week' ? 'Semana' : period === 'day' ? 'Día' : String(period)],
        ['Rango de fechas', rangeText],
        ['Vendedor', vendedor || 'Todos'],
        ['Código cliente', codigoCliente || 'Todos'],
        ['', ''],
        ['RESUMEN ESTADÍSTICO', ''],
        ['Registros (períodos)', rows.length],
        ['Total ventas (suma)', totalVentas],
        ['Cantidad ventas (suma)', cantidadVentas]
    ];

    const resumenSheet = XLSX.utils.aoa_to_sheet(resumenAoA);

    // Aplicar anchos de columna
    if (!resumenSheet['!cols']) resumenSheet['!cols'] = [];
    resumenSheet['!cols'][0] = { width: 25 };
    resumenSheet['!cols'][1] = { width: 30 };

    // Aplicar merges para combinar celdas del título
    resumenSheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, // Combinar título principal
        { s: { r: 7, c: 0 }, e: { r: 7, c: 1 } }  // Combinar encabezado de resumen
    ];

    XLSX.utils.book_append_sheet(workbook, resumenSheet, 'Resumen');

    // Crear hoja de datos con anchos de columna mejorados
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Aplicar anchos de columna
    if (!worksheet['!cols']) worksheet['!cols'] = [];
    worksheet['!cols'][0] = { width: 20 }; // Periodo
    worksheet['!cols'][1] = { width: 15 }; // Total_ventas
    worksheet['!cols'][2] = { width: 18 }; // Cantidad_ventas

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');

    XLSX.writeFile(workbook, buildSalesExportFilename('xlsx'));
}

function exportSalesToPdf() {
    const jsPdfNamespace = window.jspdf;
    const JsPdfCtor = jsPdfNamespace?.jsPDF;

    if (!JsPdfCtor) {
        showSalesMessage('No se encontró la librería para exportar a PDF', 'error');
        return;
    }

    const doc = new JsPdfCtor({ unit: 'pt', format: 'a4' });
    const rows = currentSalesReport?.rows || [];
    const period = currentSalesReport?.period || 'month';

    const vendedor = String(currentSalesReport?.vendedor || '').trim();
    const codigoCliente = String(currentSalesReport?.codigoCliente || '').trim();

    doc.setFontSize(14);
    doc.text('Reporte de Ventas', 40, 50);
    doc.setFontSize(10);
    doc.text(`Período: ${period}`, 40, 70);
    if (vendedor) doc.text(`Vendedor: ${vendedor}`, 40, 86);
    if (codigoCliente) doc.text(`Cliente: ${codigoCliente}`, 40, 102);

    let cursorY = codigoCliente || vendedor ? 120 : 100;

    // Incluir gráficos si existen
    const barCanvas = document.getElementById('sales-bar-chart');
    const lineCanvas = document.getElementById('sales-line-chart');

    const pageWidth = doc.internal.pageSize.getWidth();
    const maxImgWidth = pageWidth - 80;

    const addCanvasImage = (canvas) => {
        if (!canvas || typeof canvas.toDataURL !== 'function') {
            return;
        }

        try {
            const dataUrl = canvas.toDataURL('image/png', 1.0);
            const imgWidth = maxImgWidth;
            const imgHeight = (canvas.height / canvas.width) * imgWidth;

            if (cursorY + imgHeight > doc.internal.pageSize.getHeight() - 120) {
                doc.addPage();
                cursorY = 50;
            }

            doc.addImage(dataUrl, 'PNG', 40, cursorY, imgWidth, imgHeight);
            cursorY += imgHeight + 18;
        } catch (error) {
            // Si falla la imagen, seguimos con la tabla.
        }
    };

    addCanvasImage(barCanvas);
    addCanvasImage(lineCanvas);

    if (typeof doc.autoTable === 'function') {
        const body = rows.map((row) => ([
            formatSalesPeriod(row.periodo, period),
            Number(row.total_ventas ?? 0),
            Number(row.cantidad_ventas ?? 0)
        ]));

        doc.autoTable({
            startY: cursorY,
            head: [['Período', 'Total ventas', 'Cantidad ventas']],
            body,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [44, 62, 80] }
        });
    }

    doc.save(buildSalesExportFilename('pdf'));
}

function formatInvoiceDate(date) {
    const parsed = date instanceof Date ? date : new Date(date);
    return parsed.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }) + ' ' + parsed.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getInvoiceFilename(saleId) {
    const date = new Date().toISOString().slice(0, 10);
    return `factura_${saleId}_${date}.pdf`;
}

async function generateSaleInvoicePdf({
    saleId,
    codigoCliente,
    vendedor,
    total,
    total_normal,
    descuento_aplicado,
    estado,
    puntosObtenidos,
    puntosAcumulados,
    rewardInfo,
    saleDate
}) {
    const jsPdfNamespace = window.jspdf;
    const JsPdfCtor = jsPdfNamespace?.jsPDF;
    if (typeof JsPdfCtor !== 'function') {
        throw new Error('La librería jsPDF no está disponible');
    }

    let cliente = null;
    try {
        cliente = await getClientDetail(codigoCliente);
    } catch (clientError) {
        cliente = null;
    }

    const doc = new JsPdfCtor({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
    let y = 40;

    doc.setFontSize(18);
    doc.text('Factura de Venta', margin, y);
    y += 24;

    doc.setFontSize(10);
    doc.text(`Factura #: ${saleId}`, margin, y);
    doc.text(`Fecha: ${formatInvoiceDate(saleDate)}`, margin + 320, y);
    y += 18;
    doc.text(`Vendedor: ${vendedor}`, margin, y);
    doc.text(`Estado: ${estado}`, margin + 320, y);
    y += 24;

    doc.setFontSize(12);
    doc.text('Datos del cliente', margin, y);
    y += 16;

    const clienteNombre = cliente?.nombre || cliente?.razon_social || cliente?.nombres || '';
    const clienteNit = cliente?.nit || cliente?.identificacion || '';
    const clienteTelefono = cliente?.telefono || cliente?.telefono_celular || '';
    const clienteEmail = cliente?.correo || cliente?.email || '';
    const clienteDireccion = cliente?.direccion || cliente?.domicilio || '';

    doc.setFontSize(10);
    doc.text(`Código cliente: ${codigoCliente}`, margin, y);
    y += 14;
    if (clienteNombre) {
        doc.text(`Nombre: ${clienteNombre}`, margin, y);
        y += 14;
    }
    if (clienteNit) {
        doc.text(`NIT/Identificación: ${clienteNit}`, margin, y);
        y += 14;
    }
    if (clienteTelefono) {
        doc.text(`Teléfono: ${clienteTelefono}`, margin, y);
        y += 14;
    }
    if (clienteEmail) {
        doc.text(`Correo: ${clienteEmail}`, margin, y);
        y += 14;
    }
    if (clienteDireccion) {
        doc.text(`Dirección: ${clienteDireccion}`, margin, y);
        y += 14;
    }

    y += 10;
    doc.setFontSize(12);
    doc.text('Detalle de la venta', margin, y);
    y += 16;
    doc.setFontSize(10);
    if (Number.isFinite(total_normal) && Number(total_normal) !== Number(total)) {
        doc.text(`Total normal: Q${Number(total_normal).toFixed(2)}`, margin, y);
        y += 14;
        doc.text(`Descuento aplicado: Q${Number(descuento_aplicado || 0).toFixed(2)}`, margin, y);
        y += 14;
        doc.text(`Total con descuento: Q${Number(total).toFixed(2)}`, margin, y);
    } else {
        doc.text(`Total de la venta: Q${Number(total).toFixed(2)}`, margin, y);
    }
    y += 14;
    if (rewardInfo) {
        doc.text(`Premio canjeado: ${rewardInfo.rewardLabel || 'No especificado'}`, margin, y);
        y += 14;
        if (rewardInfo.couponCode) {
            doc.text(`Código cupón: ${rewardInfo.couponCode}`, margin, y);
            y += 14;
        }
    }
    doc.text(`Puntos obtenidos: ${Math.trunc(puntosObtenidos)}`, margin, y);
    y += 14;
    doc.text(`Puntos acumulados: ${Math.trunc(puntosAcumulados)}`, margin, y);
    y += 24;

    doc.setFontSize(9);
    doc.text('Gracias por su compra. Esta factura es un comprobante de la venta realizada y contiene los detalles del cliente y producto.', margin, y, { maxWidth });

    doc.save(getInvoiceFilename(saleId));
}

function initializeAuthUI() {
    const loginForm = document.getElementById('login-form');
    const logoutButton = document.getElementById('btn-logout');
    const testApiButton = document.getElementById('btn-test-api');

    loginForm.addEventListener('submit', handleLoginSubmit);
    logoutButton.addEventListener('click', handleLogout);
    testApiButton.addEventListener('click', handleTestApi);
}

async function tryRestoreSession() {
    const token = getAuthToken();
    const cachedUser = getAuthUser();

    if (!token || !cachedUser) {
        setAuthenticatedLayout(false);
        return;
    }

    try {
        const session = await getCurrentSession();
        await startAuthenticatedApp(session.user || cachedUser);
    } catch (error) {
        clearAuthSession();
        setAuthenticatedLayout(false);
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();

    const correo = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!correo || !password) {
        showLoginMessage('Correo y contraseña son obligatorios', 'error');
        return;
    }

    try {
        const result = await login(correo, password);
        saveAuthSession(result.token, result.user);
        await startAuthenticatedApp(result.user);
        showLoginMessage('', 'info');
    } catch (error) {
        showLoginMessage('Credenciales inválidas. Verifica tus datos e intenta nuevamente.', 'error');
    }
}

function handleLogout() {
    clearAuthSession();
    window.location.reload();
}

async function handleTestApi() {
    try {
        // Importar la función de prueba
        const { testApiConnectivity } = await import('./test-api.js');
        await testApiConnectivity();
    } catch (error) {
        console.error('Error ejecutando pruebas de API:', error);
        alert('Error al ejecutar las pruebas: ' + error.message);
    }
}

function showLoginMessage(message, type = 'info') {
    const messageEl = document.getElementById('login-message');

    if (!message) {
        messageEl.className = 'message';
        messageEl.textContent = '';
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
}

function showSaleConfirmMessage(message, type = 'info') {
    const messageEl = document.getElementById('sale-confirm-message');
    if (!messageEl) {
        return;
    }

    if (!message) {
        messageEl.className = 'message';
        messageEl.textContent = '';
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
}

function setSaleConfirmModalOpen(isOpen) {
    const modal = document.getElementById('sale-confirm-modal');
    if (!modal) {
        return;
    }

    modal.style.display = isOpen ? 'block' : 'none';
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function closeSaleConfirmModal(result = { confirmed: false, rewardId: null }) {
    setSaleConfirmModalOpen(false);
    showSaleConfirmMessage('', 'info');

    const resolver = saleConfirmModalResolver;
    saleConfirmModalResolver = null;
    saleConfirmModalPayload = null;

    if (typeof resolver === 'function') {
        resolver(result);
    }
}

function getClientLabelFromCache(codigoCliente) {
    const code = String(codigoCliente || '').trim();
    if (!code) {
        return '-';
    }

    const match = (newSaleClientsCache || []).find((c) => String(c?.codigo_cliente || '').trim() === code);
    if (!match) {
        return code;
    }
    return buildNewSaleClientLabel(match);
}

async function openSaleConfirmModal(payload) {
    if (saleConfirmModalResolver) {
        // Si hay uno abierto, lo cerramos como cancelado.
        closeSaleConfirmModal({ confirmed: false, rewardId: null });
    }

    let resolveModal;
    const modalPromise = new Promise((resolve) => {
        resolveModal = resolve;
    });
    saleConfirmModalResolver = resolveModal;
    saleConfirmModalPayload = payload;

    // Set summary
    const clientEl = document.getElementById('sale-confirm-client');
    const vendorEl = document.getElementById('sale-confirm-vendor');
    const totalEl = document.getElementById('sale-confirm-total');
    const dateEl = document.getElementById('sale-confirm-date');
    const statusEl = document.getElementById('sale-confirm-status');
    const pointsEl = document.getElementById('sale-confirm-points');
    const rewardsEl = document.getElementById('sale-confirm-rewards');
    const acceptButton = document.getElementById('btn-sale-confirm-accept');

    if (clientEl) clientEl.textContent = getClientLabelFromCache(payload.codigoCliente);
    if (vendorEl) vendorEl.textContent = payload.vendedor || '-';
    if (totalEl) totalEl.textContent = `Q${Number(payload.total || 0).toFixed(2)}`;
    if (dateEl) {
        const parsedDate = parseSaleDateInputValue(payload.fechaVenta);
        dateEl.textContent = parsedDate ? formatDateEs(parsedDate) : (payload.fechaVenta || '-');
    }
    if (statusEl) statusEl.textContent = payload.estado || '-';
    if (pointsEl) pointsEl.textContent = '-';
    if (rewardsEl) rewardsEl.innerHTML = '<p>Cargando premios...</p>';
    showSaleConfirmMessage('', 'info');

    if (acceptButton) {
        acceptButton.disabled = true;
    }

    setSaleConfirmModalOpen(true);

    // Load points + rewards
    try {
        const detail = await getClientDetail(payload.codigoCliente);
        const points = Math.trunc(Number(detail?.puntos_acumulados || 0));
        if (pointsEl) pointsEl.textContent = String(points);

        const rewards = await getRewards();
        const availableRewards = (rewards || [])
            .filter((r) => Number(r?.activo) !== 0)
            .map((r) => ({
                id: Number(r.id),
                nombre: String(r.nombre || '').trim(),
                descripcion: String(r.descripcion || '').trim(),
                costo: Number(r.costo_puntos || 0),
                tipo_descuento: String(r.tipo_descuento || 'PORCENTAJE'),
                valor_descuento: Number(r.valor_descuento || 0)
            }))
            .filter((r) => Number.isInteger(r.id) && r.id > 0 && Number.isFinite(r.costo) && r.costo > 0)
            .sort((a, b) => a.costo - b.costo);

        const redeemable = availableRewards.filter((r) => points >= r.costo);

        if (!rewardsEl) {
            return modalPromise;
        }

        const noneOption = `
            <label class="modal-reward-option">
                <input type="radio" name="sale-reward" value="" checked>
                <div>
                    <strong>No aplicar premio</strong>
                    <div class="muted">Generar la venta sin canje.</div>
                </div>
            </label>
        `;

        if (redeemable.length === 0) {
            rewardsEl.innerHTML = noneOption + '<p class="muted">No hay premios canjeables con los puntos actuales.</p>';
            return modalPromise;
        }

        const optionsHtml = redeemable
            .map((r) => {
                const discountLabel = r.tipo_descuento === 'PORCENTAJE'
                    ? `${r.valor_descuento.toFixed(2)}%`
                    : `Q${r.valor_descuento.toFixed(2)}`;
                return `
                <label class="modal-reward-option">
                    <input type="radio" name="sale-reward" value="${r.id}">
                    <div>
                        <strong>${escapeHtmlAttr(r.nombre || 'Premio')}</strong>
                        ${r.descripcion ? `<div class="muted">${escapeHtmlAttr(r.descripcion)}</div>` : '<div class="muted">&nbsp;</div>'}
                        <div><strong>Costo:</strong> ${Math.trunc(r.costo)} puntos</div>
                        <div><strong>Descuento:</strong> ${escapeHtmlAttr(discountLabel)}</div>
                    </div>
                </label>
            `;
            })
            .join('');

        rewardsEl.innerHTML = noneOption + optionsHtml;
    } catch (error) {
        if (rewardsEl) {
            rewardsEl.innerHTML = '<p class="muted">No se pudo cargar la información de premios.</p>';
        }
        showSaleConfirmMessage('No se pudo cargar puntos/premios: ' + error.message, 'error');
    } finally {
        if (acceptButton) {
            acceptButton.disabled = false;
        }
    }

    return modalPromise;
}

function initializeSaleConfirmModal() {
    const modal = document.getElementById('sale-confirm-modal');
    const acceptButton = document.getElementById('btn-sale-confirm-accept');

    if (!modal || !acceptButton || modal.dataset.bound) {
        return;
    }

    modal.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) {
            return;
        }

        const action = target.getAttribute?.('data-action');
        if (action === 'close') {
            closeSaleConfirmModal({ confirmed: false, rewardId: null });
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            const isOpen = modal.style.display !== 'none';
            if (isOpen) {
                closeSaleConfirmModal({ confirmed: false, rewardId: null });
            }
        }
    });

    acceptButton.addEventListener('click', () => {
        const selected = modal.querySelector('input[name="sale-reward"]:checked');
        const rawValue = selected ? String(selected.value || '').trim() : '';
        const rewardId = rawValue ? Number(rawValue) : null;
        const rewardLabel = selected?.closest('label')?.querySelector('strong')?.textContent || '';
        closeSaleConfirmModal({
            confirmed: true,
            rewardId: Number.isInteger(rewardId) && rewardId > 0 ? rewardId : null,
            rewardLabel: rewardLabel.trim() || null
        });
    });

    modal.dataset.bound = 'true';
}

function setAuthenticatedLayout(isLoggedIn) {
    document.getElementById('login-section').style.display = isLoggedIn ? 'none' : 'block';
    document.getElementById('main-navbar').style.display = isLoggedIn ? 'block' : 'none';
    document.getElementById('main-content').style.display = isLoggedIn ? 'block' : 'none';
    document.getElementById('main-footer').style.display = isLoggedIn ? 'block' : 'none';
    document.getElementById('session-info').style.display = isLoggedIn ? 'inline-flex' : 'none';

    // Control del toggle de navegación móvil: solo mostrar cuando esté autenticado
    try {
        const navToggle = document.getElementById('nav-toggle');
        if (navToggle) {
            if (!isLoggedIn) {
                navToggle.style.display = 'none';
                navToggle.setAttribute('aria-expanded', 'false');
                const navbar = document.getElementById('main-navbar');
                if (navbar) navbar.classList.remove('open');
            } else {
                // Mostrar toggle solo en pantallas pequeñas
                const shouldShow = window.matchMedia('(max-width: 768px)').matches;
                navToggle.style.display = shouldShow ? 'inline-flex' : 'none';
            }
        }
    } catch (e) {
        // ignore
    }
}

async function startAuthenticatedApp(user) {
    currentUser = user;
    const role = String(currentUser?.rol || '').toLowerCase();

    setAuthenticatedLayout(true);
    initializeNavigation();
    applyRolePermissions(role);
    applyUserDefaults();
    initializeSaleConfirmModal();

    document.getElementById('session-user-label').textContent =
        `${currentUser.nombre || currentUser.correo} (${currentUser.rol})`;

    await initializeConfigSection();

    if (role === 'it') {
        return;
    }

    await initializeDashboard();
    initializeInteractionForm();
    initializeSalesSection();
    initializeNewSaleSection();
    initializeSupportTicketsSection();

    if (role === 'gerente') {
        initializeClientsSection();
        initializeKpisSection();
    }

    initializeOpportunitiesSection();
}

function showKpisMessage(message, type = 'info') {
    const messageEl = document.getElementById('kpis-message');
    if (!messageEl) {
        return;
    }

    if (!message) {
        messageEl.className = 'message';
        messageEl.textContent = '';
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 6000);
}

function formatCurrency(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return '-';
    }

    return numeric.toLocaleString('es-GT', {
        style: 'currency',
        currency: 'GTQ',
        maximumFractionDigits: 2
    });
}

function formatPercent(value, { decimals = 1 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return '-';
    }
    return `${numeric.toFixed(decimals)}%`;
}

function formatRate(value, { decimals = 1 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return '-';
    }
    return `${(numeric * 100).toFixed(decimals)}%`;
}

function renderKpisTable(items) {
    const table = document.getElementById('kpis-table');
    if (!table) {
        return;
    }

    const tbody = table.querySelector('tbody');
    if (!tbody) {
        return;
    }

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4">No hay datos para el período seleccionado.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items
        .map((row) => {
            const vendor = row?.vendedor || '-';
            const totalMes = row?.ventas?.total_mes ?? 0;
            const pct = row?.ventas?.variacion_pct_total;
            const promedioCierre = row?.ventas?.promedio_cierre_mes;

            return `
                <tr>
                    <td>${vendor}</td>
                    <td>${formatCurrency(totalMes)}</td>
                    <td>${pct === null ? '-' : formatPercent(pct)}</td>
                    <td>${promedioCierre === null ? '-' : formatCurrency(promedioCierre)}</td>
                </tr>
            `;
        })
        .join('');
}

function getDefaultMonthInputValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

async function initializeKpisSection() {
    const form = document.getElementById('kpis-form');
    const monthInput = document.getElementById('kpis-month');
    const vendorSelect = document.getElementById('kpis-vendedor');

    if (!form || !monthInput || !vendorSelect) {
        return;
    }

    monthInput.value = monthInput.value || getDefaultMonthInputValue();

    try {
        const vendedores = await getSalesVendedores();
        vendorSelect.innerHTML = '<option value="">Equipo (todos los vendedores)</option>';

        (vendedores || []).forEach((item) => {
            const name = String(item.vendedor || '').trim();
            if (!name) {
                return;
            }

            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            vendorSelect.appendChild(option);
        });
    } catch (error) {
        showKpisMessage('No se pudo cargar la lista de vendedores: ' + error.message, 'error');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const month = String(monthInput.value || '').trim();
        const vendor = String(vendorSelect.value || '').trim();

        if (!month) {
            showKpisMessage('Debes seleccionar un mes', 'error');
            return;
        }

        showKpisMessage('Cargando KPIs...', 'info');

        try {
            const data = await getSalesKpis(month, vendor);
            renderKpisTable(data?.items || []);
            showKpisMessage('', 'info');
        } catch (error) {
            showKpisMessage('Error al cargar KPIs: ' + error.message, 'error');
            renderKpisTable([]);
        }
    });

    // Carga inicial con vista de equipo
    try {
        const data = await getSalesKpis(monthInput.value, '');
        renderKpisTable(data?.items || []);
    } catch (error) {
        renderKpisTable([]);
    }
}

function showRewardsMessage(message, type = 'info') {
    const messageEl = document.getElementById('rewards-message');
    if (!messageEl) {
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 6000);
}

function setRewardsPointsLabel(points) {
    const pointsEl = document.getElementById('rewards-points');
    if (!pointsEl) {
        return;
    }

    if (!Number.isFinite(Number(points))) {
        pointsEl.textContent = '-';
        return;
    }

    pointsEl.textContent = String(Number(points));
}

function renderRewardsList() {
    const listEl = document.getElementById('rewards-list');
    if (!listEl) {
        return;
    }

    if (!rewardsSelectedClientRef) {
        listEl.innerHTML = '<p>Selecciona un cliente para ver recompensas disponibles.</p>';
        return;
    }

    if (!rewardsCache || rewardsCache.length === 0) {
        listEl.innerHTML = '<p>No hay premios disponibles.</p>';
        return;
    }

    let html = '<div>';
    rewardsCache.forEach((reward) => {
        const cost = Number(reward.costo_puntos || 0);
        const canRedeem = Number.isFinite(cost) && cost > 0 && rewardsPointsAvailable >= cost;

        html += `
            <div class="interaction-item">
                <h4>${reward.nombre || 'Premio'}</h4>
                ${reward.descripcion ? `<p>${reward.descripcion}</p>` : ''}
                <p><strong>Costo:</strong> ${Number.isFinite(cost) ? cost : '-'} puntos</p>
                <button type="button" class="btn btn-primary btn-redeem-reward" data-reward-id="${reward.id}" ${canRedeem ? '' : 'disabled'}>
                    Canjear
                </button>
                ${canRedeem ? '' : '<p class="muted">Saldo insuficiente</p>'}
            </div>
        `;
    });
    html += '</div>';

    listEl.innerHTML = html;

    const buttons = document.querySelectorAll('.btn-redeem-reward');
    buttons.forEach((button) => {
        button.addEventListener('click', async () => {
            const rewardId = Number(button.dataset.rewardId);
            if (!Number.isInteger(rewardId) || rewardId <= 0) {
                return;
            }

            button.disabled = true;
            showRewardsMessage('Procesando canje...', 'info');

            try {
                const result = await redeemReward(rewardsSelectedClientRef, rewardId);
                rewardsPointsAvailable = Number(result?.puntos_restantes || 0);
                setRewardsPointsLabel(rewardsPointsAvailable);
                showRewardsMessage(`Canje exitoso. Cupón generado: ${result?.coupon_code || '-'}`, 'success');
            } catch (error) {
                showRewardsMessage('Error al canjear: ' + error.message, 'error');
            } finally {
                renderRewardsList();
            }
        });
    });
}

async function initializeRewardsSection() {
    const clientSelect = document.getElementById('rewards-client');
    const listEl = document.getElementById('rewards-list');

    if (!clientSelect || !listEl) {
        return;
    }

    setRewardsPointsLabel(null);

    try {
        const clients = await getSalesClients();
        clientSelect.innerHTML = '<option value="">Selecciona un cliente...</option>';

        (clients || []).forEach((client) => {
            const ref = String(client.codigo_cliente || '').trim();
            if (!ref) {
                return;
            }

            const labelParts = [ref];
            if (client.nombre) {
                labelParts.push(String(client.nombre));
            }

            const option = document.createElement('option');
            option.value = ref;
            option.textContent = labelParts.join(' - ');
            clientSelect.appendChild(option);
        });
    } catch (error) {
        showRewardsMessage('No se pudieron cargar clientes: ' + error.message, 'error');
    }

    clientSelect.addEventListener('change', async () => {
        rewardsSelectedClientRef = String(clientSelect.value || '').trim();
        rewardsPointsAvailable = 0;
        setRewardsPointsLabel(null);

        if (!rewardsSelectedClientRef) {
            renderRewardsList();
            return;
        }

        try {
            const detail = await getClientDetail(rewardsSelectedClientRef);
            rewardsPointsAvailable = Number(detail?.puntos_acumulados || 0);
            setRewardsPointsLabel(rewardsPointsAvailable);
        } catch (error) {
            showRewardsMessage('No se pudo cargar saldo de puntos: ' + error.message, 'error');
        }

        try {
            rewardsCache = await getRewards();
        } catch (error) {
            showRewardsMessage('No se pudieron cargar premios: ' + error.message, 'error');
            rewardsCache = [];
        }

        renderRewardsList();
    });

    renderRewardsList();
}

function applyRolePermissions(role) {
    const userRole = String(role || '').toLowerCase();
    const navLinks = document.querySelectorAll('.nav-link');
    let firstAllowedSection = 'dashboard';

    navLinks.forEach((link) => {
        const allowedRoles = String(link.dataset.roles || '')
            .split(',')
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);

        const isAllowed = allowedRoles.includes(userRole);
        link.style.display = isAllowed ? 'block' : 'none';

        const sectionId = link.getAttribute('data-section');
        const section = document.getElementById(sectionId);

        if (section) {
            section.style.display = isAllowed ? '' : 'none';
        }

        if (isAllowed && firstAllowedSection === 'dashboard') {
            firstAllowedSection = sectionId;
        }
    });

    navigateSection(firstAllowedSection);
}

function applyUserDefaults() {
    if (String(currentUser?.rol || '').toLowerCase() === 'it') {
        return;
    }

    const userName = currentUser?.nombre || currentUser?.correo || '';

    const interactionUserInput = document.getElementById('usuario');
    if (interactionUserInput) {
        interactionUserInput.value = userName;
        interactionUserInput.readOnly = true;
    }

    if (currentUser?.rol !== 'it') {
        const saleVendedorInput = document.getElementById('new-sale-vendedor');
        if (saleVendedorInput) {
            saleVendedorInput.value = userName;
            saleVendedorInput.readOnly = true;
        }

        const opportunityVendedorInput = document.getElementById('opportunity-vendedor');
        if (opportunityVendedorInput) {
            opportunityVendedorInput.value = userName;
            opportunityVendedorInput.readOnly = true;
        }
    }
}

function showUsersAdminMessage(message, type = 'info') {
    const messageEl = document.getElementById('users-admin-message');

    if (!messageEl) {
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function renderUsersAdmin(users) {
    const container = document.getElementById('users-admin-list');

    if (!users || users.length === 0) {
        container.innerHTML = '<p>No hay usuarios registrados.</p>';
        return;
    }

    let html = '<div>';
    users.forEach((user) => {
        const isCurrent = Number(user.id) === Number(currentUser?.id);
        html += `
            <div class="interaction-item">
                <h4>${user.nombre || '-'}</h4>
                <p><strong>Correo:</strong> ${user.correo || '-'}</p>
                <p><strong>Rol:</strong> ${String(user.rol || '').toUpperCase()}</p>
                <p><strong>Estado:</strong> ${Number(user.activo) === 1 ? 'Activo' : 'Inactivo'}</p>
                <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.75rem;">
                    <button type="button" class="btn btn-primary btn-edit-user" data-user-id="${user.id}">Editar</button>
                    <button type="button" class="btn btn-danger btn-delete-user" data-user-id="${user.id}" ${isCurrent ? 'disabled' : ''}>Eliminar</button>
                </div>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
    bindUsersAdminActions();
}

function resetUsersAdminForm() {
    const form = document.getElementById('user-admin-form');
    form.reset();
    document.getElementById('admin-user-id').value = '';
    document.getElementById('admin-user-active').value = '1';
}

function fillUsersAdminForm(user) {
    document.getElementById('admin-user-id').value = String(user.id);
    document.getElementById('admin-user-name').value = user.nombre || '';
    document.getElementById('admin-user-email').value = user.correo || '';
    document.getElementById('admin-user-role').value = String(user.rol || 'vendedor').toLowerCase();
    document.getElementById('admin-user-active').value = Number(user.activo) === 1 ? '1' : '0';
    document.getElementById('admin-user-password').value = '';
}

function bindUsersAdminActions() {
    const editButtons = document.querySelectorAll('.btn-edit-user');
    const deleteButtons = document.querySelectorAll('.btn-delete-user');

    editButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const userId = Number(button.dataset.userId);
            const selected = usersAdminCache.find((item) => Number(item.id) === userId);

            if (!selected) {
                return;
            }

            fillUsersAdminForm(selected);
        });
    });

    deleteButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const userId = Number(button.dataset.userId);
            if (!Number.isInteger(userId) || userId <= 0) {
                return;
            }

            if (!window.confirm('¿Seguro que deseas eliminar este usuario?')) {
                return;
            }

            try {
                await deleteSystemUser(userId);
                showUsersAdminMessage('Usuario eliminado correctamente', 'success');
                await loadUsersAdmin();
            } catch (error) {
                showUsersAdminMessage('Error al eliminar usuario: ' + error.message, 'error');
            }
        });
    });
}

async function loadUsersAdmin() {
    const list = document.getElementById('users-admin-list');
    list.innerHTML = '<p>Cargando usuarios...</p>';

    try {
        const users = await getSystemUsers();
        usersAdminCache = users;
        renderUsersAdmin(users);
    } catch (error) {
        list.innerHTML = '<p>Error al cargar usuarios.</p>';
        showUsersAdminMessage('Error al cargar usuarios: ' + error.message, 'error');
    }
}

async function initializeConfigSection() {
    const apiConfigPanel = document.getElementById('api-config-panel');
    const usersPanel = document.getElementById('users-admin-panel');
    const loyaltyPanel = document.getElementById('loyalty-config-panel');
    const role = String(currentUser?.rol || '').toLowerCase();

    if (apiConfigPanel) {
        apiConfigPanel.style.display = role === 'it' ? 'block' : 'none';
    }

    if (role === 'it') {
        try {
            const status = await checkApiStatus();
            if (status) {
                displayConfigInfo(status);
            }
        } catch (error) {
            // Ignorado para no bloquear la sección.
        }
    }

    usersPanel.style.display = role === 'it' ? 'block' : 'none';
    loyaltyPanel.style.display = role === 'gerente' ? 'block' : 'none';
    const rewardsPanel = document.getElementById('rewards-config-panel');
    if (rewardsPanel) {
        rewardsPanel.style.display = role === 'gerente' ? 'block' : 'none';
    }

    if (role === 'gerente') {
        const loyaltyForm = document.getElementById('loyalty-config-form');

        await loadLoyaltyConfigPanel();
        await initializeRewardsConfig();

        if (!loyaltyForm.dataset.bound) {
            loyaltyForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                try {
                    const result = await updateLoyaltyConfig({
                        monto_por_punto: Number(document.getElementById('loyalty-amount-per-point').value),
                        puntos_por_bloque: Number(document.getElementById('loyalty-points-per-block').value)
                    });

                    document.getElementById('loyalty-amount-per-point').value = String(result.monto_por_punto);
                    document.getElementById('loyalty-points-per-block').value = String(result.puntos_por_bloque);
                    showLoyaltyConfigMessage('Configuración de fidelización actualizada correctamente', 'success');
                } catch (error) {
                    showLoyaltyConfigMessage('Error al guardar configuración: ' + error.message, 'error');
                }
            });

            loyaltyForm.dataset.bound = 'true';
        }
    }

    if (role !== 'it') {
        return;
    }

    const form = document.getElementById('user-admin-form');
    const cancelButton = document.getElementById('btn-cancel-user-edit');

    cancelButton.addEventListener('click', () => {
        resetUsersAdminForm();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const userId = String(document.getElementById('admin-user-id').value || '').trim();
        const payload = {
            nombre: document.getElementById('admin-user-name').value.trim(),
            correo: document.getElementById('admin-user-email').value.trim(),
            rol: document.getElementById('admin-user-role').value,
            activo: Number(document.getElementById('admin-user-active').value)
        };

        const password = document.getElementById('admin-user-password').value;

        if (!payload.nombre || !payload.correo || !payload.rol) {
            showUsersAdminMessage('Nombre, correo y rol son obligatorios', 'error');
            return;
        }

        try {
            if (userId) {
                if (password) {
                    payload.password = password;
                }
                await updateSystemUser(userId, payload);
                showUsersAdminMessage('Usuario actualizado correctamente', 'success');
            } else {
                if (!password || password.length < 8) {
                    showUsersAdminMessage('La contraseña es obligatoria y debe tener mínimo 8 caracteres', 'error');
                    return;
                }

                payload.password = password;
                await createSystemUser(payload);
                showUsersAdminMessage('Usuario creado correctamente', 'success');
            }

            resetUsersAdminForm();
            await loadUsersAdmin();
        } catch (error) {
            showUsersAdminMessage('Error al guardar usuario: ' + error.message, 'error');
        }
    });

    resetUsersAdminForm();
    await loadUsersAdmin();
}

function initializeNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = link.getAttribute('data-section');
            navigateSection(sectionId);
        });
    });
}

async function initializeDashboard() {
    try {
        const status = await checkApiStatus();
        const statusEl = document.getElementById('status-text');
        
        if (status) {
            statusEl.innerHTML = `
                <span style="color: #2ecc71;">✓ API conectada correctamente</span><br>
                <small>${status.message}</small>
            `;
        } else {
            statusEl.innerHTML = `
                <span style="color: #e74c3c;">✗ No se pudo conectar a la API</span><br>
                <small>Verifica que el servidor Node.js esté ejecutándose</small>
            `;
        }
    } catch (error) {
        const statusEl = document.getElementById('status-text');
        statusEl.innerHTML = `
            <span style="color: #e74c3c;">✗ Error al conectar con la API</span><br>
            <small>${error.message}</small>
        `;
    }
}

function initializeInteractionForm() {
    const form = document.getElementById('interaction-form');
    const clientSelect = document.getElementById('interaction-cliente');
    const resumenInput = document.getElementById('resumen');
    const historialClienteSelect = document.getElementById('historial-cliente');
    const btnCargarHistorial = document.getElementById('btn-cargar-historial');
    const isManager = String(currentUser?.rol || '').toLowerCase() === 'gerente';
    
    // Load clients dropdown
    loadInteractionClients(clientSelect);
    
    // Contador de caracteres en tiempo real
    resumenInput.addEventListener('input', () => {
        const count = resumenInput.value.length;
        document.getElementById('char-count').textContent = `(${count}/20)`;
    });
    
    // Cargar clientes en el selector de historial
    loadInteractionClients(historialClienteSelect);

    if (isManager) {
        btnCargarHistorial.textContent = 'Cargar Todo';
        loadAllInteractions();
    }
    
    btnCargarHistorial.addEventListener('click', async () => {
        const codigoCliente = historialClienteSelect.value;
        if (codigoCliente) {
            try {
                const interactions = await getInteractionsByClient(codigoCliente);
                displayInteractions(interactions);
                showMessage(`Historial de ${codigoCliente} cargado`, 'success');
            } catch (error) {
                showMessage('Error al cargar interacciones: ' + error.message, 'error');
            }
        } else if (isManager) {
            try {
                await loadAllInteractions();
                showMessage('Mostrando todas las interacciones', 'success');
            } catch (error) {
                showMessage('Error al cargar interacciones: ' + error.message, 'error');
            }
        } else {
            showMessage('Por favor selecciona un cliente', 'error');
        }
    });

    // Guardar nueva interacción
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const codigoCliente = clientSelect.value;
        const tipo = document.getElementById('tipo').value;
        const resumen = document.getElementById('resumen').value;
        const usuario = document.getElementById('usuario').value;

        // Validaciones
        if (!codigoCliente) {
            showMessage('Por favor selecciona un cliente', 'error');
            return;
        }
        if (!tipo) {
            showMessage('Por favor selecciona un tipo de interacción', 'error');
            return;
        }
        if (resumen.length < 20) {
            showMessage('El resumen debe tener mínimo 20 caracteres', 'error');
            return;
        }
        if (!usuario) {
            showMessage('Por favor ingresa el nombre de usuario', 'error');
            return;
        }

        const interactionData = {
            codigo_cliente: String(codigoCliente).trim(),
            tipo: tipo,
            resumen: resumen,
            usuario: usuario
        };

        try {
            const result = await createInteraction(interactionData);
            showMessage('Interacción guardada correctamente', 'success');
            clearForm('interaction-form');
            document.getElementById('usuario').value = currentUser?.nombre || currentUser?.correo || '';
            
            // Recargar la lista de interacciones si el mismo cliente está en el historial
            const historialCliente = historialClienteSelect.value;
            if (isManager) {
                await loadAllInteractions();
            } else if (historialCliente === codigoCliente) {
                const interactions = await getInteractionsByClient(codigoCliente);
                displayInteractions(interactions);
            }
        } catch (error) {
            showMessage('Error al guardar la interacción: ' + error.message, 'error');
        }
    });
}

async function loadInteractionClients(clientSelect) {
    try {
        const clients = await getSalesClients();

        clientSelect.innerHTML = '<option value="">Selecciona un cliente...</option>';
        clients.forEach((client) => {
            const option = document.createElement('option');
            option.value = client.codigo_cliente ? String(client.codigo_cliente) : '';
            option.textContent = client.codigo_cliente || 'Cliente sin código';
            clientSelect.appendChild(option);
        });
    } catch (error) {
        showMessage('No se pudo cargar el listado de clientes', 'error');
    }
}

async function loadAllInteractions() {
    const listEl = document.getElementById('interactions-list');

    try {
        const interactions = await getAllInteractions();
        displayInteractions(interactions);
        return interactions;
    } catch (error) {
        if (listEl) {
            listEl.innerHTML = '<p>Error al cargar interacciones.</p>';
        }
        throw error;
    }
}


function initializeSalesSection() {
    const salesForm = document.getElementById('sales-form');
    const salesPeriod = document.getElementById('sales-period');
    const salesCodigoCliente = document.getElementById('sales-codigo-cliente');
    const salesVendedor = document.getElementById('sales-vendedor');

    const isManager = currentUser?.rol === 'gerente';

    const excelButton = document.getElementById('btn-export-excel');
    const pdfButton = document.getElementById('btn-export-pdf');

    if (excelButton && !excelButton.dataset.bound) {
        excelButton.addEventListener('click', () => {
            exportSalesToExcel();
        });
        excelButton.dataset.bound = 'true';
    }

    if (pdfButton && !pdfButton.dataset.bound) {
        pdfButton.addEventListener('click', () => {
            exportSalesToPdf();
        });
        pdfButton.dataset.bound = 'true';
    }

    updateSalesExportButtons();

    if (isManager) {
        // Cargar vendedores en el dropdown
        loadSalesVendedores();

        // Cargar rendimiento inicial del equipo
        loadRendimientoEquipo(salesPeriod.value);

        if (salesAutoRefreshTimer) {
            clearInterval(salesAutoRefreshTimer);
        }

        salesAutoRefreshTimer = setInterval(() => {
            loadRendimientoEquipo(salesPeriod.value);
        }, 15000);
    } else {
        if (salesAutoRefreshTimer) {
            clearInterval(salesAutoRefreshTimer);
            salesAutoRefreshTimer = null;
        }

        salesVendedor.innerHTML = '<option value="">Solo mis ventas</option>';
        salesVendedor.disabled = true;
        document.getElementById('rendimiento-vendedores').style.display = 'none';

        // Cargar ventas individuales del vendedor actual
        const currentVendedor = currentUser?.nombre || currentUser?.correo;
        if (currentVendedor) {
            loadIndividualSales(currentVendedor);
            // Cargar también el reporte de ventas del propio vendedor para exportar/visualizar
            getSalesReport(salesPeriod.value, '', currentVendedor)
                .then((rows) => {
                    displaySalesReport(rows, salesPeriod.value);
                    setSalesReportContext({ rows, period: salesPeriod.value, codigoCliente: '', vendedor: currentVendedor });
                    showSalesMessage('Mostrando ventas individuales del vendedor', 'success');
                })
                .catch((error) => {
                    console.warn('No se pudo cargar el reporte de ventas del vendedor:', error);
                });
        }
    }

    // Actualizar automáticamente al cambiar vendedor
    salesVendedor.addEventListener('change', async () => {
        if (!isManager) {
            return;
        }

        const period = salesPeriod.value;
        const codigoCliente = salesCodigoCliente.value;
        const vendedor = salesVendedor.value;

        try {
            const rows = await getSalesReport(period, codigoCliente, vendedor);
            displaySalesReport(rows, period);
            setSalesReportContext({ rows, period, codigoCliente, vendedor });
            
            if (vendedor) {
                showVendedorStats(vendedor, rows);
                await loadIndividualSales(vendedor);
                showSalesMessage(`Mostrando ventas de: ${vendedor}`, 'success');
            } else {
                hideVendedorStats();
                hideIndividualSales();
                showSalesMessage('Vista general - Todos los vendedores', 'success');
            }
        } catch (error) {
            showSalesMessage('Error al cargar reporte: ' + error.message, 'error');
            setSalesReportContext({ rows: [], period, codigoCliente, vendedor });
        }
    });

    // Actualizar rendimiento al cambiar período
    salesPeriod.addEventListener('change', () => {
        if (isManager) {
            loadRendimientoEquipo(salesPeriod.value);
        }
    });

    salesForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const period = salesPeriod.value;
        const codigoCliente = salesCodigoCliente.value;
        const vendedor = isManager ? salesVendedor.value : '';

        try {
            const rows = await getSalesReport(period, codigoCliente, vendedor);
            displaySalesReport(rows, period);
            setSalesReportContext({ rows, period, codigoCliente, vendedor });
            
            if (vendedor) {
                showVendedorStats(vendedor, rows);
                await loadIndividualSales(vendedor);
                showSalesMessage(`Reporte de ${vendedor} cargado correctamente`, 'success');
            } else {
                hideVendedorStats();
                hideIndividualSales();
                showSalesMessage('Reporte general cargado correctamente', 'success');
            }
            
            // Actualizar rendimiento del equipo
            if (isManager) {
                loadRendimientoEquipo(period);
            }
        } catch (error) {
            showSalesMessage('Error al cargar reporte: ' + error.message, 'error');
            setSalesReportContext({ rows: [], period, codigoCliente, vendedor });
        }
    });
}

function showSupportTicketsMessage(message, type = 'info') {
    const messageEl = document.getElementById('support-tickets-message');

    if (!messageEl) {
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function showSupportTicketDetailMessage(message, type = 'info') {
    const messageEl = document.getElementById('support-ticket-detail-message');

    if (!messageEl) {
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function showLoyaltyConfigMessage(message, type = 'info') {
    const messageEl = document.getElementById('loyalty-config-message');

    if (!messageEl) {
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function showRewardsAdminMessage(message, type = 'info') {
    const messageEl = document.getElementById('rewards-admin-message');

    if (!messageEl) {
        return;
    }

    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function resetRewardsAdminForm() {
    const form = document.getElementById('reward-admin-form');
    if (!form) {
        return;
    }

    document.getElementById('admin-reward-id').value = '';
    document.getElementById('admin-reward-name').value = '';
    document.getElementById('admin-reward-description').value = '';
    document.getElementById('admin-reward-cost').value = '';
    document.getElementById('admin-reward-type').value = 'PORCENTAJE';
    document.getElementById('admin-reward-value').value = '';
    document.getElementById('admin-reward-active').value = '1';
    showRewardsAdminMessage('', 'info');
}

function fillRewardsAdminForm(reward) {
    if (!reward) {
        resetRewardsAdminForm();
        return;
    }

    document.getElementById('admin-reward-id').value = String(reward.id || '');
    document.getElementById('admin-reward-name').value = String(reward.nombre || '');
    document.getElementById('admin-reward-description').value = String(reward.descripcion || '');
    document.getElementById('admin-reward-cost').value = String(Number(reward.costo_puntos || 0));
    document.getElementById('admin-reward-type').value = String(reward.tipo_descuento || 'PORCENTAJE');
    document.getElementById('admin-reward-value').value = String(Number(reward.valor_descuento || 0));
    document.getElementById('admin-reward-active').value = Number(reward.activo) === 1 ? '1' : '0';
    showRewardsAdminMessage('', 'info');
}

function renderRewardsAdminList(rewards) {
    const listEl = document.getElementById('rewards-admin-list');
    if (!listEl) {
        return;
    }

    if (!Array.isArray(rewards) || rewards.length === 0) {
        listEl.innerHTML = '<p>No hay premios configurados.</p>';
        return;
    }

    let html = '<div>';
    rewards.forEach((reward) => {
        const discountType = String(reward.tipo_descuento || 'PORCENTAJE');
        const discountValue = Number(reward.valor_descuento || 0);
        const discountLabel = discountType === 'PORCENTAJE'
            ? `${discountValue.toFixed(2)}%`
            : `Q${discountValue.toFixed(2)}`;

        html += `
            <div class="interaction-item">
                <h4>${reward.nombre || `Premio #${reward.id}`}</h4>
                <p>${reward.descripcion ? `${reward.descripcion}` : '<span class="muted">Sin descripción</span>'}</p>
                <p><strong>Costo:</strong> ${Number(reward.costo_puntos || 0)} puntos</p>
                <p><strong>Descuento:</strong> ${discountLabel}</p>
                <p><strong>Activo:</strong> ${Number(reward.activo) === 1 ? 'Sí' : 'No'}</p>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem;">
                    <button type="button" class="btn btn-secondary btn-edit-reward" data-reward-id="${reward.id}">Editar</button>
                    <button type="button" class="btn btn-danger btn-delete-reward" data-reward-id="${reward.id}">Eliminar</button>
                </div>
            </div>
        `;
    });
    html += '</div>';

    listEl.innerHTML = html;

    const editButtons = listEl.querySelectorAll('.btn-edit-reward');
    editButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const rewardId = Number(button.dataset.rewardId);
            if (!Number.isInteger(rewardId)) {
                return;
            }

            const reward = (window.rewardsAdminCache || []).find((item) => Number(item.id) === rewardId);
            if (reward) {
                fillRewardsAdminForm(reward);
            }
        });
    });

    const deleteButtons = listEl.querySelectorAll('.btn-delete-reward');
    deleteButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const rewardId = Number(button.dataset.rewardId);
            if (!Number.isInteger(rewardId)) {
                return;
            }

            const confirmed = window.confirm('¿Estás seguro de eliminar este premio?');
            if (!confirmed) {
                return;
            }

            try {
                await deleteRewardItem(rewardId);
                await loadRewardsAdmin();
                showRewardsAdminMessage('Premio eliminado correctamente', 'success');
            } catch (error) {
                showRewardsAdminMessage('Error al eliminar premio: ' + error.message, 'error');
            }
        });
    });
}

async function loadRewardsAdmin() {
    try {
        const rewards = await getAllRewards();
        window.rewardsAdminCache = Array.isArray(rewards) ? rewards : [];
        renderRewardsAdminList(window.rewardsAdminCache);
    } catch (error) {
        renderRewardsAdminList([]);
        showRewardsAdminMessage('Error al cargar premios: ' + error.message, 'error');
    }
}

async function initializeRewardsConfig() {
    const rewardsPanel = document.getElementById('rewards-config-panel');
    const rewardForm = document.getElementById('reward-admin-form');
    const cancelButton = document.getElementById('btn-cancel-reward-edit');

    if (!rewardsPanel || !rewardForm || !cancelButton) {
        return;
    }

    rewardsPanel.style.display = 'block';
    resetRewardsAdminForm();

    if (!rewardForm.dataset.bound) {
        rewardForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const rewardId = String(document.getElementById('admin-reward-id').value || '').trim();
            const payload = {
                nombre: document.getElementById('admin-reward-name').value.trim(),
                descripcion: document.getElementById('admin-reward-description').value.trim(),
                costo_puntos: Number(document.getElementById('admin-reward-cost').value),
                tipo_descuento: document.getElementById('admin-reward-type').value,
                valor_descuento: Number(document.getElementById('admin-reward-value').value),
                activo: Number(document.getElementById('admin-reward-active').value)
            };

            if (!payload.nombre || !Number.isFinite(payload.costo_puntos) || payload.costo_puntos <= 0) {
                showRewardsAdminMessage('Nombre y costo en puntos son obligatorios', 'error');
                return;
            }

            try {
                if (rewardId) {
                    await updateRewardItem(rewardId, payload);
                    showRewardsAdminMessage('Premio actualizado correctamente', 'success');
                } else {
                    await createReward(payload);
                    showRewardsAdminMessage('Premio creado correctamente', 'success');
                }

                resetRewardsAdminForm();
                await loadRewardsAdmin();
            } catch (error) {
                showRewardsAdminMessage('Error al guardar premio: ' + error.message, 'error');
            }
        });

        cancelButton.addEventListener('click', (event) => {
            event.preventDefault();
            resetRewardsAdminForm();
        });

        rewardForm.dataset.bound = 'true';
    }

    await loadRewardsAdmin();
}

async function loadLoyaltyConfigPanel() {
    const config = await getLoyaltyConfig();
    document.getElementById('loyalty-amount-per-point').value = String(config.monto_por_punto ?? 10);
    document.getElementById('loyalty-points-per-block').value = String(config.puntos_por_bloque ?? 1);
}

async function refreshSupportTicketsList(codigoCliente, preserveSelectedTicket = false) {
    const clientCode = String(codigoCliente || '').trim();
    if (!clientCode) {
        renderSupportTickets([]);
        renderSupportTicketDetail(null);
        selectedSupportTicketId = null;
        return;
    }

    const tickets = await getSupportTicketsByClient(clientCode);
    renderSupportTickets(tickets);

    if (preserveSelectedTicket && selectedSupportTicketId) {
        try {
            const detail = await getSupportTicketDetail(selectedSupportTicketId);
            renderSupportTicketDetail(detail);
            return;
        } catch (error) {
            selectedSupportTicketId = null;
        }
    }

    renderSupportTicketDetail(null);
    selectedSupportTicketId = null;
}

function renderSupportTickets(tickets) {
    const listEl = document.getElementById('support-tickets-list');

    if (!tickets || tickets.length === 0) {
        listEl.innerHTML = '<p>No hay tickets de soporte para este cliente.</p>';
        return;
    }

    let html = '<div>';
    tickets.forEach((ticket) => {
        html += `
            <div class="interaction-item">
                <h4>${ticket.titulo || `Ticket #${ticket.id}`}</h4>
                <p><strong>Estado:</strong> ${ticket.estado || '-'}</p>
                <p><strong>Prioridad:</strong> ${ticket.prioridad || '-'}</p>
                <p><strong>Fecha:</strong> ${formatDate(ticket.fecha_creacion)}</p>
                <button type="button" class="btn btn-secondary btn-open-support-ticket" data-ticket-id="${ticket.id}" style="margin-top: 0.6rem;">Abrir detalle</button>
            </div>
        `;
    });
    html += '</div>';

    listEl.innerHTML = html;
    bindSupportTicketDetailButtons();
}

function renderSupportTicketDetail(ticket) {
    const detailEl = document.getElementById('support-ticket-detail');

    if (!ticket) {
        detailEl.innerHTML = '<p>Abre un ticket para ver su detalle completo.</p>';
        return;
    }

    detailEl.innerHTML = `
        <div class="interaction-item">
            <h4>Editar Ticket #${ticket.id}</h4>
            <p class="ticket-detail-meta"><strong>Cliente:</strong> ${ticket.codigo_cliente || '-'} | <strong>Creado:</strong> ${formatDate(ticket.fecha_creacion)} | <strong>Actualizado:</strong> ${formatDate(ticket.fecha_actualizacion)}</p>

            <input type="hidden" id="support-ticket-detail-id" value="${ticket.id}">

            <div class="form-group">
                <label for="support-ticket-detail-title">Título</label>
                <input type="text" id="support-ticket-detail-title" value="${escapeHtmlAttr(ticket.titulo || '')}">
            </div>

            <div class="form-group">
                <label for="support-ticket-detail-description">Descripción</label>
                <textarea id="support-ticket-detail-description" rows="4">${escapeHtmlAttr(ticket.descripcion || '')}</textarea>
            </div>

            <div class="form-group" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
                <div>
                    <label for="support-ticket-detail-state">Estado</label>
                    <select id="support-ticket-detail-state">
                        <option value="ABIERTO" ${ticket.estado === 'ABIERTO' ? 'selected' : ''}>ABIERTO</option>
                        <option value="EN_PROCESO" ${ticket.estado === 'EN_PROCESO' ? 'selected' : ''}>EN_PROCESO</option>
                        <option value="RESUELTO" ${ticket.estado === 'RESUELTO' ? 'selected' : ''}>RESUELTO</option>
                        <option value="CERRADO" ${ticket.estado === 'CERRADO' ? 'selected' : ''}>CERRADO</option>
                    </select>
                </div>
                <div>
                    <label for="support-ticket-detail-priority">Prioridad</label>
                    <select id="support-ticket-detail-priority">
                        <option value="BAJA" ${ticket.prioridad === 'BAJA' ? 'selected' : ''}>BAJA</option>
                        <option value="MEDIA" ${ticket.prioridad === 'MEDIA' ? 'selected' : ''}>MEDIA</option>
                        <option value="ALTA" ${ticket.prioridad === 'ALTA' ? 'selected' : ''}>ALTA</option>
                        <option value="CRITICA" ${ticket.prioridad === 'CRITICA' ? 'selected' : ''}>CRITICA</option>
                    </select>
                </div>
            </div>

            <div class="ticket-detail-actions">
                <button type="button" id="btn-save-support-ticket" class="btn btn-primary">Guardar cambios</button>
                <button type="button" id="btn-delete-support-ticket" class="btn btn-danger">Eliminar ticket</button>
            </div>
        </div>
    `;

    bindSupportTicketDetailActions(ticket);
}

function bindSupportTicketDetailButtons() {
    const buttons = document.querySelectorAll('.btn-open-support-ticket');

    buttons.forEach((button) => {
        button.addEventListener('click', async () => {
            const ticketId = Number(button.dataset.ticketId);
            if (!Number.isInteger(ticketId) || ticketId <= 0) {
                return;
            }

            try {
                const detail = await getSupportTicketDetail(ticketId);
                selectedSupportTicketId = ticketId;
                renderSupportTicketDetail(detail);
            } catch (error) {
                showSupportTicketsMessage('Error al abrir detalle: ' + error.message, 'error');
            }
        });
    });
}

function bindSupportTicketDetailActions(ticket) {
    const saveButton = document.getElementById('btn-save-support-ticket');
    const deleteButton = document.getElementById('btn-delete-support-ticket');

    if (saveButton) {
        saveButton.addEventListener('click', async () => {
            const titulo = document.getElementById('support-ticket-detail-title').value.trim();
            const descripcion = document.getElementById('support-ticket-detail-description').value.trim();
            const estado = document.getElementById('support-ticket-detail-state').value;
            const prioridad = document.getElementById('support-ticket-detail-priority').value;

            if (!titulo) {
                showSupportTicketDetailMessage('El título del ticket es obligatorio', 'error');
                return;
            }

            try {
                const result = await updateSupportTicket(ticket.id, {
                    titulo,
                    descripcion,
                    estado,
                    prioridad
                });

                selectedSupportTicketId = ticket.id;
                renderSupportTicketDetail(result.ticket);
                await refreshSupportTicketsList(ticket.codigo_cliente, true);
                showSupportTicketDetailMessage('Ticket actualizado correctamente', 'success');
                showSupportTicketsMessage('Listado actualizado', 'success');
            } catch (error) {
                showSupportTicketDetailMessage('Error al actualizar ticket: ' + error.message, 'error');
            }
        });
    }

    if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
            const confirmed = window.confirm('¿Seguro que deseas eliminar este ticket? Esta acción no se puede deshacer.');
            if (!confirmed) {
                return;
            }

            try {
                await deleteSupportTicket(ticket.id);
                selectedSupportTicketId = null;
                renderSupportTicketDetail(null);
                await refreshSupportTicketsList(ticket.codigo_cliente, false);
                showSupportTicketDetailMessage('Ticket eliminado correctamente', 'success');
                showSupportTicketsMessage('Listado actualizado', 'success');
            } catch (error) {
                showSupportTicketDetailMessage('Error al eliminar ticket: ' + error.message, 'error');
            }
        });
    }
}

async function loadSupportTicketClients() {
    const clientSelect = document.getElementById('support-ticket-client');

    try {
        const clients = await getSalesClients();
        clientSelect.innerHTML = '<option value="">Selecciona un cliente...</option>';

        clients.forEach((client) => {
            const option = document.createElement('option');
            option.value = client.codigo_cliente ? String(client.codigo_cliente) : '';
            option.textContent = client.codigo_cliente || 'Cliente sin código';
            clientSelect.appendChild(option);
        });
    } catch (error) {
        clientSelect.innerHTML = '<option value="">No se pudieron cargar clientes</option>';
        showSupportTicketsMessage('No se pudo cargar el listado de clientes', 'error');
    }
}

function initializeSupportTicketsSection() {
    const clientSelect = document.getElementById('support-ticket-client');
    const loadButton = document.getElementById('btn-load-support-tickets');
    const createForm = document.getElementById('support-ticket-form');

    loadSupportTicketClients();
    renderSupportTicketDetail(null);

    createForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const codigoCliente = String(clientSelect.value || '').trim();
        const titulo = document.getElementById('support-ticket-title').value.trim();
        const descripcion = document.getElementById('support-ticket-description').value.trim();
        const estado = document.getElementById('support-ticket-state').value;
        const prioridad = document.getElementById('support-ticket-priority').value;

        if (!codigoCliente) {
            showSupportTicketsMessage('Selecciona un cliente antes de crear ticket', 'error');
            return;
        }

        if (!titulo) {
            showSupportTicketsMessage('El título del ticket es obligatorio', 'error');
            return;
        }

        try {
            await createSupportTicket({
                codigo_cliente: codigoCliente,
                titulo,
                descripcion,
                estado,
                prioridad
            });

            showSupportTicketsMessage('Ticket creado correctamente', 'success');
            createForm.reset();
            document.getElementById('support-ticket-state').value = 'ABIERTO';
            document.getElementById('support-ticket-priority').value = 'MEDIA';
            await refreshSupportTicketsList(codigoCliente);
        } catch (error) {
            showSupportTicketsMessage('Error al crear ticket: ' + error.message, 'error');
        }
    });

    loadButton.addEventListener('click', async () => {
        const codigoCliente = String(clientSelect.value || '').trim();
        if (!codigoCliente) {
            showSupportTicketsMessage('Selecciona un cliente para consultar tickets', 'error');
            return;
        }

        try {
            await refreshSupportTicketsList(codigoCliente);
            showSupportTicketsMessage(`Tickets de ${codigoCliente} cargados`, 'success');
        } catch (error) {
            document.getElementById('support-tickets-list').innerHTML = '<p>Error al cargar tickets.</p>';
            showSupportTicketsMessage('Error al consultar tickets: ' + error.message, 'error');
        }
    });
}

async function loadSalesVendedores() {
    const vendedorSelect = document.getElementById('sales-vendedor');
    try {
        const vendedores = await getSalesVendedores();
        vendedorSelect.innerHTML = '<option value="">Todos los vendedores (Vista General)</option>';
        vendedores.forEach((v) => {
            const option = document.createElement('option');
            option.value = v.vendedor;
            option.textContent = v.vendedor;
            vendedorSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar vendedores:', error);
    }
}

async function loadRendimientoEquipo(period) {
    const container = document.getElementById('rendimiento-list');
    try {
        const data = await getVendedoresRendimiento(period);
        
        if (data.length === 0) {
            container.innerHTML = '<p>No hay datos de rendimiento para este período.</p>';
            return;
        }

        // Calcular totales para porcentajes
        const totalVentas = data.reduce((sum, v) => sum + Number(v.total_ventas), 0);
        const maxVentas = Math.max(...data.map(v => Number(v.total_ventas)));
        const minVentas = Math.min(...data.map(v => Number(v.total_ventas)));

        let html = '<table class="rendimiento-table"><thead><tr>';
        html += '<th>Vendedor</th><th>Total Ventas</th><th>Cantidad</th><th>Promedio</th><th>% del Total</th><th>Rendimiento</th>';
        html += '</tr></thead><tbody>';

        data.forEach((v) => {
            const total = Number(v.total_ventas);
            const porcentaje = ((total / totalVentas) * 100).toFixed(1);
            const promedio = Number(v.promedio_venta).toFixed(2);
            
            // Determinar nivel de rendimiento
            let rendimientoClass = 'rendimiento-medio';
            let rendimientoText = 'Medio';
            
            if (total === maxVentas || porcentaje >= 30) {
                rendimientoClass = 'rendimiento-alto';
                rendimientoText = '⬆ Alto';
            } else if (total === minVentas || porcentaje < 15) {
                rendimientoClass = 'rendimiento-bajo';
                rendimientoText = '⬇ Bajo';
            }

            html += `<tr class="${rendimientoClass}">`;
            html += `<td><strong>${v.vendedor}</strong></td>`;
            html += `<td>${formatCurrency(total)}</td>`;
            html += `<td>${v.cantidad_ventas}</td>`;
            html += `<td>${formatCurrency(promedio)}</td>`;
            html += `<td>${porcentaje}%</td>`;
            html += `<td><span class="badge ${rendimientoClass}">${rendimientoText}</span></td>`;
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p>Error al cargar rendimiento del equipo.</p>';
        console.error('Error:', error);
    }
}

function showVendedorStats(vendedor, rows) {
    const statsContainer = document.getElementById('vendedor-stats');
    const statsContent = document.getElementById('vendedor-stats-content');
    
    const totalVentas = rows.reduce((sum, r) => sum + Number(r.total_ventas), 0);
    const cantidadPeriodos = rows.length;
    const cantidadVentas = rows.reduce((sum, r) => sum + Number(r.cantidad_ventas || 0), 0);
    
    statsContent.innerHTML = `
        <div class="stats-grid">
            <div class="stat-item">
                <span class="stat-label">Vendedor:</span>
                <span class="stat-value">${vendedor}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Total Ventas:</span>
                <span class="stat-value">${formatCurrency(totalVentas)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Cantidad de Ventas:</span>
                <span class="stat-value">${cantidadVentas}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Períodos con Ventas:</span>
                <span class="stat-value">${cantidadPeriodos}</span>
            </div>
        </div>
    `;
    
    statsContainer.style.display = 'block';
}

function hideVendedorStats() {
    document.getElementById('vendedor-stats').style.display = 'none';
}

async function loadIndividualSales(vendedor) {
    if (!vendedor || !vendedor.trim()) {
        hideIndividualSales();
        return;
    }

    try {
        const sales = await getSalesBySeller(vendedor);
        displayIndividualSales(sales);
    } catch (error) {
        console.error('Error loading individual sales:', error);
        hideIndividualSales();
    }
}

function displayIndividualSales(sales) {
    const container = document.getElementById('individual-sales');
    const listContainer = document.getElementById('individual-sales-list');

    if (!sales || sales.length === 0) {
        listContainer.innerHTML = '<p>No hay ventas registradas para este vendedor.</p>';
        container.style.display = 'block';
        return;
    }

    const tableHtml = `
        <table class="individual-sales-table">
            <thead>
                <tr>
                    <th>ID Venta</th>
                    <th>Fecha</th>
                    <th>Total</th>
                    <th>Cliente</th>
                </tr>
            </thead>
            <tbody>
                ${sales.map(sale => `
                    <tr>
                        <td>${sale.id}</td>
                        <td>${formatDateEs(new Date(sale.fecha))}</td>
                        <td>${formatCurrency(sale.total)}</td>
                        <td>${sale.codigo_cliente || 'N/A'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    listContainer.innerHTML = tableHtml;
    container.style.display = 'block';
}

function hideIndividualSales() {
    document.getElementById('individual-sales').style.display = 'none';
}

function initializeNewSaleSection() {
    const form = document.getElementById('new-sale-form');
    const clientSelect = document.getElementById('new-sale-cliente');
    const clientSearchInput = document.getElementById('new-sale-client-search');
    const saleDateInput = document.getElementById('new-sale-date');

    if (saleDateInput && !saleDateInput.value) {
        saleDateInput.value = getTodayDateInputValue();
    }

    loadSalesClients(clientSelect);

    if (clientSearchInput && !clientSearchInput.dataset.bound) {
        clientSearchInput.addEventListener('input', () => {
            applyNewSaleClientFilter(clientSelect, String(clientSearchInput.value || ''));
        });
        clientSearchInput.dataset.bound = 'true';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const selectedOption = clientSelect.options[clientSelect.selectedIndex];
        const codigoCliente = clientSelect.value ? String(clientSelect.value).trim() : '';
        const clienteId = selectedOption && selectedOption.dataset.clienteId
            ? Number(selectedOption.dataset.clienteId)
            : null;
        const vendedor = document.getElementById('new-sale-vendedor').value.trim();
        const total = Number(document.getElementById('new-sale-total').value);
        const fechaVenta = document.getElementById('new-sale-date').value;
        const estado = document.getElementById('new-sale-estado').value;

        if (!codigoCliente) {
            showNewSaleMessage('El cliente seleccionado no tiene código', 'error');
            return;
        }

        if (!vendedor) {
            showNewSaleMessage('El vendedor es obligatorio', 'error');
            return;
        }

        if (!Number.isFinite(total) || total <= 0) {
            showNewSaleMessage('El total debe ser mayor que 0', 'error');
            return;
        }

        if (!parseSaleDateInputValue(fechaVenta)) {
            showNewSaleMessage('La fecha de venta no es válida', 'error');
            return;
        }

        try {
            const modalResult = await openSaleConfirmModal({
                codigoCliente,
                clienteId,
                vendedor,
                total,
                fechaVenta,
                estado
            });

            if (!modalResult?.confirmed) {
                return;
            }

            const payload = { codigo_cliente: codigoCliente, vendedor, total, fecha: fechaVenta, estado };
            if (Number.isInteger(clienteId) && clienteId > 0) {
                payload.cliente_id = clienteId;
            }
            if (modalResult?.rewardId) {
                payload.reward_id = modalResult.rewardId;
            }

            const result = await createSale(payload);
            const loyalty = result.loyalty || {};
            const puntosObtenidos = Number(loyalty.puntos_obtenidos || 0);
            const puntosAcumulados = Number(loyalty.puntos_acumulados || 0);

            let rewardMessage = '';
            let rewardInvoiceInfo = null;
            if (result.reward) {
                rewardInvoiceInfo = {
                    rewardId: result.reward.rewardId,
                    rewardLabel: result.reward.rewardLabel || '',
                    couponCode: result.reward.couponCode || ''
                };
                rewardMessage = rewardInvoiceInfo.couponCode
                    ? ` Cupón generado: ${rewardInvoiceInfo.couponCode}.`
                    : ' Premio canjeado correctamente.';
            }

            showNewSaleMessage(
                `Venta guardada correctamente. Factura #${result.id}. Puntos obtenidos: ${Math.trunc(puntosObtenidos)}. Puntos acumulados: ${Math.trunc(puntosAcumulados)}.${rewardMessage}`,
                'success'
            );

            try {
                const saleDate = parseSaleDateInputValue(fechaVenta) || new Date();
                await generateSaleInvoicePdf({
                    saleId: result.id,
                    codigoCliente,
                    vendedor,
                    total: result.total || total,
                    total_normal: result.total_normal || total,
                    descuento_aplicado: result.descuento_aplicado || 0,
                    estado,
                    puntosObtenidos,
                    puntosAcumulados,
                    rewardInfo: rewardInvoiceInfo,
                    saleDate
                });
            } catch (pdfError) {
                console.warn('Error generando factura PDF:', pdfError);
            }

            clearForm('new-sale-form');
            if (saleDateInput) {
                saleDateInput.value = getTodayDateInputValue();
            }
            clientSelect.value = '';

            if (clientSearchInput) {
                clientSearchInput.value = '';
            }

            await loadSalesClients(clientSelect);

            if (selectedClientRef && selectedClientRef === codigoCliente) {
                await loadClientDetail(selectedClientRef);
            }

            if (currentUser?.rol === 'vendedor') {
                document.getElementById('new-sale-vendedor').value = currentUser.nombre || currentUser.correo || '';
            }
        } catch (error) {
            showNewSaleMessage('Error al guardar venta: ' + error.message, 'error');
        }
    });
}

function normalizeSearchValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
}

function buildNewSaleClientLabel(client) {
    const code = String(client?.codigo_cliente || '').trim();
    const name = String(client?.nombre || '').trim();
    if (code && name) {
        return `${code} - ${name}`;
    }
    return code || name || 'Cliente';
}

function filterNewSaleClients(clients, term) {
    const query = normalizeSearchValue(term);
    if (!query) {
        return Array.isArray(clients) ? clients : [];
    }

    return (clients || []).filter((client) => {
        const fields = [
            client?.codigo_cliente,
            client?.nombre,
            client?.correo,
            client?.nit
        ];

        return fields.some((field) => normalizeSearchValue(field).includes(query));
    });
}

function renderNewSaleClientOptions(clientSelect, clients) {
    if (!clientSelect) {
        return;
    }

    const previousValue = String(clientSelect.value || '').trim();
    clientSelect.innerHTML = '<option value="">Selecciona un cliente...</option>';

    (clients || []).forEach((client) => {
        const code = client?.codigo_cliente ? String(client.codigo_cliente).trim() : '';
        if (!code) {
            return;
        }

        const option = document.createElement('option');
        option.value = code;
        if (client?.cliente_id !== undefined && client?.cliente_id !== null) {
            option.dataset.clienteId = String(client.cliente_id);
        }
        option.textContent = buildNewSaleClientLabel(client);
        clientSelect.appendChild(option);
    });

    if (previousValue && Array.from(clientSelect.options).some((opt) => opt.value === previousValue)) {
        clientSelect.value = previousValue;
    }
}

function applyNewSaleClientFilter(clientSelect, term) {
    const filtered = filterNewSaleClients(newSaleClientsCache, term);
    renderNewSaleClientOptions(clientSelect, filtered);

    // También filtra el panel "Listado de clientes" que aparece en la sección.
    displaySalesClients(filtered);

    if (filtered.length === 0 && normalizeSearchValue(term)) {
        const listEl = document.getElementById('sales-clients-list');
        if (listEl) {
            listEl.innerHTML = '<p>No se encontraron clientes con ese criterio.</p>';
        }
    }
}

async function loadSalesClients(clientSelect) {
    try {
        const clients = await getSalesClients();

        newSaleClientsCache = Array.isArray(clients) ? clients : [];
        const searchTerm = document.getElementById('new-sale-client-search')?.value || '';
        applyNewSaleClientFilter(clientSelect, searchTerm);
    } catch (error) {
        displaySalesClients([]);
        showNewSaleMessage('No se pudo cargar el listado de clientes', 'error');
    }
}

function initializeClientsSection() {
    const clientForm = document.getElementById('client-form');
    const searchInput = document.getElementById('client-search-input');

    clientForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nombre = document.getElementById('client-nombre').value.trim();
        const correo = document.getElementById('client-correo').value.trim();
        const numero = document.getElementById('client-numero').value.trim();
        const direccion = document.getElementById('client-direccion').value.trim();
        const nit = document.getElementById('client-nit').value.trim();

        if (!nombre && !correo && !numero && !direccion && !nit) {
            showClientMessage('Ingresa al menos nombre, correo, número, dirección o NIT', 'error');
            return;
        }

        try {
            await createClient({ nombre, correo, numero, direccion, nit });
            showClientMessage('Cliente registrado correctamente', 'success');
            clearForm('client-form');
            await refreshSharedClientLists();
        } catch (error) {
            showClientMessage('Error al registrar cliente: ' + error.message, 'error');
        }
    });

    searchInput.addEventListener('input', () => {
        const term = searchInput.value.trim();
        clearTimeout(clientSearchDebounce);

        if (term.length < 2) {
            document.getElementById('client-search-results').innerHTML =
                '<p>Ingresa al menos 2 caracteres para buscar.</p>';
            document.getElementById('client-search-meta').textContent = '';
            return;
        }

        clientSearchDebounce = setTimeout(() => {
            executeClientSearch(term);
        }, 300);
    });
}

async function executeClientSearch(term) {
    const resultContainer = document.getElementById('client-search-results');
    const metaContainer = document.getElementById('client-search-meta');

    resultContainer.innerHTML = '<p>Buscando clientes...</p>';
    metaContainer.textContent = '';

    try {
        const data = await searchClients(term, 25);
        const elapsed = Number(data.elapsed_ms || 0);
        const total = Number(data.total || 0);
        const sla = elapsed < 3000 ? 'Cumple SLA (< 3s)' : 'Fuera de SLA (> 3s)';

        metaContainer.textContent = `Coincidencias: ${total}. Tiempo de respuesta: ${elapsed} ms. ${sla}.`;

        if (total === 0) {
            resultContainer.innerHTML = '<p>No se encontraron clientes con ese criterio.</p>';
            return;
        }

        let html = '<div>';
        data.items.forEach((item) => {
            const clientRef = item.codigo_cliente || item.cliente_id || '';
            const openButton = clientRef
                ? `<button type="button" class="btn btn-secondary btn-open-client" data-client-ref="${String(clientRef)}">Abrir ficha completa</button>`
                : '<p class="muted">Ficha no disponible: cliente sin referencia.</p>';
            html += `
                <div class="interaction-item client-search-item">
                    <h4>${item.nombre || item.codigo_cliente || 'Cliente sin nombre'}</h4>
                    <p><strong>Código:</strong> ${item.codigo_cliente || '-'}</p>
                    <p><strong>Correo:</strong> ${item.correo || '-'}</p>
                    <p><strong>Número:</strong> ${item.numero || '-'}</p>
                    <p><strong>Dirección:</strong> ${item.direccion || '-'}</p>
                    <p><strong>NIT:</strong> ${item.nit || '-'}</p>
                    <p><strong>Puntos acumulados:</strong> ${Math.trunc(Number(item.puntos_acumulados || 0))}</p>
                    ${openButton}
                </div>
            `;
        });
        html += '</div>';

        resultContainer.innerHTML = html;
        bindOpenClientButtons();
    } catch (error) {
        resultContainer.innerHTML = '<p>Error al buscar clientes.</p>';
        showClientMessage('Error al buscar clientes: ' + error.message, 'error');
    }
}

function bindOpenClientButtons() {
    const buttons = document.querySelectorAll('.btn-open-client');
    buttons.forEach((button) => {
        button.addEventListener('click', async () => {
            const clientRef = button.dataset.clientRef;
            if (!clientRef) {
                showClientMessage('No se encontró la referencia del cliente', 'error');
                return;
            }

            await loadClientDetail(clientRef);
        });
    });
}

async function loadClientDetail(clientRef) {
    const detailContainer = document.getElementById('client-detail');
    detailContainer.innerHTML = '<p>Cargando ficha del cliente...</p>';

    try {
        const detail = await getClientDetail(clientRef);
        selectedClientRef = String(clientRef || '').trim();

        const nombre = detail.nombre ?? detail.nombres ?? detail.nombre_cliente ?? detail.razon_social ?? '';
        const correo = detail.correo ?? detail.email ?? detail.mail ?? detail.correo_electronico ?? '';
        const numero = detail.numero ?? detail.telefono ?? detail.celular ?? detail.telefono_movil ?? detail.telefono1 ?? '';
        const direccion = detail.direccion ?? detail.domicilio ?? detail.direccion_fiscal ?? '';
        const nit = detail.nit ?? detail.nit_cliente ?? detail.ruc ?? detail.tax_id ?? '';
        const codigoCliente = detail.codigo_cliente ?? detail.codigo ?? detail.cod_cliente ?? selectedClientRef;
        const puntos = Number(detail.puntos_acumulados || 0);
        const configPuntos = detail.configuracion_puntos || {};
        const historialPuntos = Array.isArray(detail.historial_puntos) ? detail.historial_puntos : [];
        const historialPuntosHtml = historialPuntos.length > 0
            ? historialPuntos.map((entry) => `
                <div class="interaction-item">
                    <h4>${entry.tipo_evento || 'PUNTOS_OBTENIDOS'}</h4>
                    <p><strong>Factura ID:</strong> ${entry.factura_id}</p>
                    <p><strong>Puntos obtenidos:</strong> ${Math.trunc(Number(entry.puntos_obtenidos || 0))}</p>
                    <p><strong>Total compra:</strong> Q${Number(entry.total_compra || 0).toFixed(2)}</p>
                    <p><strong>Regla aplicada:</strong> ${entry.puntos_por_bloque} punto(s) por cada Q${Number(entry.monto_por_punto || 0).toFixed(2)}</p>
                    <p><strong>Fecha:</strong> ${formatDate(entry.fecha_registro)}</p>
                </div>
            `).join('')
            : '<p>No hay movimientos de puntos registrados para este cliente.</p>';

        detailContainer.innerHTML = `
            <div class="interaction-item">
                <h4>Ficha de cliente</h4>
                <p><strong>Código cliente:</strong> ${codigoCliente || '-'}</p>

                <div class="loyalty-summary">
                    <div class="loyalty-card">
                        <strong>Puntos acumulados</strong>
                        <span>${Math.trunc(puntos)}</span>
                    </div>
                    <div class="loyalty-card">
                        <strong>Regla vigente</strong>
                        <span>${Number(configPuntos.puntos_por_bloque || 1)} punto(s) por cada Q${Number(configPuntos.monto_por_punto || 10).toFixed(2)}</span>
                    </div>
                </div>

                <div class="form-group">
                    <label for="edit-client-nombre">Nombre</label>
                    <input type="text" id="edit-client-nombre" value="${escapeHtmlAttr(nombre)}">
                </div>

                <div class="form-group">
                    <label for="edit-client-correo">Correo</label>
                    <input type="email" id="edit-client-correo" value="${escapeHtmlAttr(correo)}">
                </div>

                <div class="form-group">
                    <label for="edit-client-numero">Número</label>
                    <input type="text" id="edit-client-numero" value="${escapeHtmlAttr(numero)}">
                </div>

                <div class="form-group">
                    <label for="edit-client-direccion">Dirección</label>
                    <input type="text" id="edit-client-direccion" value="${escapeHtmlAttr(direccion)}">
                </div>

                <div class="form-group">
                    <label for="edit-client-nit">NIT</label>
                    <input type="text" id="edit-client-nit" value="${escapeHtmlAttr(nit)}">
                </div>

                <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                    <button type="button" id="btn-save-client" class="btn btn-primary">Guardar cambios</button>
                    <button type="button" id="btn-delete-client" class="btn btn-danger">Eliminar cliente</button>
                </div>

                <div class="loyalty-history">
                    <h4 style="margin-top: 1rem;">Historial de fidelización</h4>
                    ${historialPuntosHtml}
                </div>
            </div>
        `;

        bindClientDetailActions();
    } catch (error) {
        detailContainer.innerHTML = '<p>No se pudo cargar la ficha del cliente.</p>';
        showClientMessage('Error al abrir ficha: ' + error.message, 'error');
    }
}

function bindClientDetailActions() {
    const saveButton = document.getElementById('btn-save-client');
    const deleteButton = document.getElementById('btn-delete-client');

    if (saveButton) {
        saveButton.addEventListener('click', async () => {
            if (!selectedClientRef) {
                showClientMessage('No se encontró referencia del cliente', 'error');
                return;
            }

            const payload = {
                nombre: document.getElementById('edit-client-nombre').value.trim(),
                correo: document.getElementById('edit-client-correo').value.trim(),
                numero: document.getElementById('edit-client-numero').value.trim(),
                direccion: document.getElementById('edit-client-direccion').value.trim(),
                nit: document.getElementById('edit-client-nit').value.trim()
            };

            try {
                await updateClient(selectedClientRef, payload);
                showClientMessage('Cliente actualizado correctamente', 'success');
                await loadClientDetail(selectedClientRef);

                const term = document.getElementById('client-search-input').value.trim();
                if (term.length >= 2) {
                    await executeClientSearch(term);
                }

                await refreshSharedClientLists();
            } catch (error) {
                showClientMessage('Error al actualizar cliente: ' + error.message, 'error');
            }
        });
    }

    if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
            if (!selectedClientRef) {
                showClientMessage('No se encontró referencia del cliente', 'error');
                return;
            }

            const confirmDelete = window.confirm('¿Seguro que deseas eliminar este cliente? Esta acción no se puede deshacer.');
            if (!confirmDelete) {
                return;
            }

            try {
                await deleteClient(selectedClientRef);
                showClientMessage('Cliente eliminado correctamente', 'success');
                document.getElementById('client-detail').innerHTML =
                    '<p>Cliente eliminado. Selecciona otro cliente para ver su ficha.</p>';
                selectedClientRef = '';

                const term = document.getElementById('client-search-input').value.trim();
                if (term.length >= 2) {
                    await executeClientSearch(term);
                }

                await refreshSharedClientLists();
                await loadOpportunityClients();
            } catch (error) {
                showClientMessage('Error al eliminar cliente: ' + error.message, 'error');
            }
        });
    }
}

function escapeHtmlAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function refreshSharedClientLists() {
    const selects = [
        document.getElementById('interaction-cliente'),
        document.getElementById('historial-cliente'),
        document.getElementById('new-sale-cliente')
    ].filter(Boolean);

    for (const select of selects) {
        if (select.id === 'new-sale-cliente') {
            await loadSalesClients(select);
        } else {
            await loadInteractionClients(select);
        }
    }
}

function displayOpportunities(opportunities) {
    const listEl = document.getElementById('opportunities-list');

    if (!opportunities || opportunities.length === 0) {
        listEl.innerHTML = '<p>No hay oportunidades registradas.</p>';
        return;
    }

    let html = '<div>';
    opportunities.forEach((item) => {
        html += `
            <div class="interaction-item">
                <h4>${item.nombre_oportunidad}</h4>
                <p><strong>Cliente:</strong> ${item.codigo_cliente || '-'}</p>
                <p><strong>Vendedor responsable:</strong> ${item.vendedor || '-'}</p>
                <p><strong>Estado:</strong> ${item.estado || '-'}</p>
                <p><strong>Fecha de creación:</strong> ${formatDate(item.fecha_creacion)}</p>
            </div>
        `;
    });
    html += '</div>';

    listEl.innerHTML = html;

    renderPipeline(opportunities);
}

function renderPipeline(opportunities) {
    const summaryEl = document.getElementById('pipeline-summary');
    const boardEl = document.getElementById('pipeline-board');

    const grouped = opportunityStates.reduce((acc, state) => {
        acc[state] = [];
        return acc;
    }, {});

    (opportunities || []).forEach((item) => {
        const state = opportunityStates.includes(item.estado) ? item.estado : 'ABIERTA';
        grouped[state].push(item);
    });

    const summaryHtml = opportunityStates
        .map((state) => `<span class="pipeline-count">${state}: ${grouped[state].length}</span>`)
        .join(' ');
    summaryEl.innerHTML = summaryHtml || '<p>No hay datos para el pipeline.</p>';

    let boardHtml = '';
    opportunityStates.forEach((state) => {
        const items = grouped[state];
        boardHtml += `
            <div class="pipeline-column">
                <h4>${state}</h4>
                <div class="pipeline-count">${items.length} oportunidades</div>
                ${items.length === 0 ? '<p class="pipeline-empty">Sin oportunidades en esta etapa.</p>' : ''}
                ${items.map((item) => `
                    <div class="pipeline-item">
                        <h5>${item.nombre_oportunidad}</h5>
                        <small>Cliente: ${item.codigo_cliente || '-'}</small>
                        <small>Vendedor: ${item.vendedor || '-'}</small>
                        <select class="opportunity-state-select" data-opportunity-id="${item.id}">
                            ${opportunityStates.map((optionState) => `
                                <option value="${optionState}" ${item.estado === optionState ? 'selected' : ''}>${optionState}</option>
                            `).join('')}
                        </select>
                    </div>
                `).join('')}
            </div>
        `;
    });

    boardEl.innerHTML = boardHtml;
    bindOpportunityStateSelectors();
}

function bindOpportunityStateSelectors() {
    const selectors = document.querySelectorAll('.opportunity-state-select');
    selectors.forEach((selector) => {
        selector.addEventListener('change', async () => {
            const opportunityId = selector.dataset.opportunityId;
            const nextState = selector.value;

            try {
                await updateOpportunityState(opportunityId, nextState);

                opportunitiesCache = opportunitiesCache.map((item) => {
                    if (String(item.id) === String(opportunityId)) {
                        return { ...item, estado: nextState };
                    }
                    return item;
                });

                displayOpportunities(opportunitiesCache);
                showOpportunityMessage('Estado actualizado en tiempo real', 'success');
            } catch (error) {
                showOpportunityMessage('Error al actualizar estado: ' + error.message, 'error');
                await loadOpportunities(opportunityFilterCode);
            }
        });
    });
}

async function loadOpportunities(codigoCliente = '') {
    try {
        const opportunities = await getOpportunities(codigoCliente);
        opportunityFilterCode = String(codigoCliente || '').trim();
        opportunitiesCache = opportunities;
        displayOpportunities(opportunities);

        if (String(codigoCliente || '').trim() && opportunities.length === 0) {
            showOpportunityMessage('No hay oportunidades para ese código de cliente', 'info');
        }
    } catch (error) {
        document.getElementById('opportunities-list').innerHTML =
            '<p>Error al cargar oportunidades.</p>';
    }
}

async function loadOpportunityClients() {
    const clientSelect = document.getElementById('opportunity-client');
    try {
        const clients = await getSalesClients();
        clientSelect.innerHTML = '<option value="">Selecciona un cliente...</option>';

        clients.forEach((client) => {
            const code = client.codigo_cliente ? String(client.codigo_cliente) : '';
            const name = client.nombre ? ` - ${client.nombre}` : '';
            const option = document.createElement('option');
            option.value = code;
            option.textContent = code ? `${code}${name}` : 'Cliente sin código';
            clientSelect.appendChild(option);
        });
    } catch (error) {
        clientSelect.innerHTML = '<option value="">No se pudieron cargar clientes</option>';
    }
}

async function loadOpportunityVendedores() {
    const datalist = document.getElementById('opportunity-vendedores-list');

    try {
        const vendedores = await getSalesVendedores();
        datalist.innerHTML = '';

        vendedores.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.vendedor;
            datalist.appendChild(option);
        });
    } catch (error) {
        datalist.innerHTML = '';
    }
}

function initializeOpportunitiesSection() {
    const form = document.getElementById('opportunity-form');
    const searchInput = document.getElementById('opportunity-search-client-code');
    const searchButton = document.getElementById('btn-search-opportunity');
    const clearButton = document.getElementById('btn-clear-opportunity-search');

    loadOpportunityClients();

    if (currentUser?.rol === 'gerente') {
        loadOpportunityVendedores();
    }

    loadOpportunities();

    if (opportunitiesAutoRefreshTimer) {
        clearInterval(opportunitiesAutoRefreshTimer);
    }

    opportunitiesAutoRefreshTimer = setInterval(() => {
        loadOpportunities(opportunityFilterCode);
    }, 8000);

    searchButton.addEventListener('click', async () => {
        const codigoCliente = searchInput.value.trim();
        if (!codigoCliente) {
            showOpportunityMessage('Ingresa un código de cliente para buscar', 'error');
            return;
        }

        await loadOpportunities(codigoCliente);
    });

    clearButton.addEventListener('click', async () => {
        searchInput.value = '';
        await loadOpportunities();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nombreOportunidad = document.getElementById('opportunity-name').value.trim();
        const codigoCliente = document.getElementById('opportunity-client').value.trim();
        const vendedor = document.getElementById('opportunity-vendedor').value.trim();

        if (!nombreOportunidad) {
            showOpportunityMessage('Debes ingresar el nombre de la oportunidad', 'error');
            return;
        }

        if (!codigoCliente) {
            showOpportunityMessage('Debes seleccionar un cliente', 'error');
            return;
        }

        if (!vendedor) {
            showOpportunityMessage('Debes asignar un vendedor responsable', 'error');
            return;
        }

        try {
            await createOpportunity({
                nombre_oportunidad: nombreOportunidad,
                codigo_cliente: codigoCliente,
                vendedor
            });

            showOpportunityMessage('Oportunidad registrada correctamente', 'success');
            clearForm('opportunity-form');

            if (currentUser?.rol === 'vendedor') {
                document.getElementById('opportunity-vendedor').value = currentUser.nombre || currentUser.correo || '';
            }

            await loadOpportunities(searchInput.value.trim());
        } catch (error) {
            showOpportunityMessage('Error al registrar oportunidad: ' + error.message, 'error');
        }
    });
}
