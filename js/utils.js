// Utility Functions

function showMessage(message, type = 'info') {
    const messageEl = document.getElementById('message');
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
    
    // Auto-hide message after 5 seconds
    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function clearForm(formId) {
    document.getElementById(formId).reset();
}

function formatDate(dateString) {
    const options = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString('es-ES', options);
}

function formatCurrencyQ(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 'Q-';
    }
    
    return numeric.toLocaleString('es-GT', {
        style: 'currency',
        currency: 'GTQ',
        maximumFractionDigits: 2
    });
}

function navigateSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    // Remove active class from navbar
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    // Show selected section
    document.getElementById(sectionId).classList.add('active');

    // Add active class to clicked navbar link
    document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');
}

function displayInteractions(interactions) {
    const listEl = document.getElementById('interactions-list');
    
    if (!interactions || interactions.length === 0) {
        listEl.innerHTML = '<p>No hay interacciones registradas para este cliente.</p>';
        return;
    }

    let html = '';
    interactions.forEach(interaction => {
        html += `
            <div class="interaction-item">
                <h4>Tipo: ${interaction.tipo}</h4>
                <p><strong>Fecha:</strong> ${formatDate(interaction.fecha)}</p>
                <p><strong>Resumen:</strong> ${interaction.resumen}</p>
                <p><strong>Usuario:</strong> ${interaction.usuario}</p>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

function displayConfigInfo(data) {
    const configList = document.getElementById('config-list');
    const html = `
        <li><strong>API Status:</strong> ${data.message}</li>
        <li><strong>Endpoints disponibles:</strong> ${data.endpoints.join(', ')}</li>
        <li><strong>Base de datos:</strong> bdcanches</li>
        <li><strong>Puerto:</strong> 3000</li>
    `;
    configList.innerHTML = html;
}

function showSalesMessage(message, type = 'info') {
    const messageEl = document.getElementById('sales-message');
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function showNewSaleMessage(message, type = 'info') {
    const messageEl = document.getElementById('new-sale-message');
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function showClientMessage(message, type = 'info') {
    const messageEl = document.getElementById('client-message');
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function showOpportunityMessage(message, type = 'info') {
    const messageEl = document.getElementById('opportunity-message');
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;

    setTimeout(() => {
        messageEl.className = 'message';
    }, 5000);
}

function displaySalesClients(clients) {
    const listEl = document.getElementById('sales-clients-list');

    if (!clients || clients.length === 0) {
        listEl.innerHTML = '<p>No hay clientes disponibles.</p>';
        return;
    }

    let html = '<div>';
    clients.forEach((client) => {
        const fields = Object.entries(client).filter(([key]) => key !== 'cliente_id');
        const details = fields
            .map(([key, value]) => `<p><strong>${key}:</strong> ${value ?? ''}</p>`)
            .join('');

        html += `
            <div class="interaction-item">
                <h4>${client.codigo_cliente ?? 'Cliente'}</h4>
                ${details}
            </div>
        `;
    });
    html += '</div>';

    listEl.innerHTML = html;
}

let salesBarChart;
let salesLineChart;

function formatSalesPeriod(periodValue, selectedPeriod) {
    if (!periodValue) {
        return '-';
    }

    if (selectedPeriod === 'day') {
        const date = new Date(periodValue);
        if (Number.isNaN(date.getTime())) {
            return String(periodValue);
        }
        return date.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    }

    if (selectedPeriod === 'month') {
        const raw = String(periodValue);
        const monthDate = new Date(`${raw}-01T00:00:00`);
        if (Number.isNaN(monthDate.getTime())) {
            return raw;
        }
        return monthDate.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long'
        });
    }

    if (selectedPeriod === 'week') {
        const numeric = Number(periodValue);
        const year = Math.floor(numeric / 100);
        const week = numeric % 100;

        if (!Number.isInteger(year) || !Number.isInteger(week) || week <= 0) {
            return String(periodValue);
        }
        return `Semana ${week}, ${year}`;
    }

    return String(periodValue);
}

function renderSalesCharts(rows, selectedPeriod) {
    if (typeof Chart === 'undefined') {
        return;
    }

    const barCanvas = document.getElementById('sales-bar-chart');
    const lineCanvas = document.getElementById('sales-line-chart');

    if (!barCanvas || !lineCanvas) {
        return;
    }

    const labels = rows.map((row) => formatSalesPeriod(row.periodo, selectedPeriod));
    const values = rows.map((row) => Number(row.total_ventas));

    if (salesBarChart) {
        salesBarChart.destroy();
    }
    if (salesLineChart) {
        salesLineChart.destroy();
    }

    salesBarChart = new Chart(barCanvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Total ventas',
                data: values,
                backgroundColor: 'rgba(52, 152, 219, 0.6)',
                borderColor: 'rgba(52, 152, 219, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.2,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    salesLineChart = new Chart(lineCanvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Tendencia',
                data: values,
                fill: false,
                borderColor: 'rgba(46, 204, 113, 1)',
                backgroundColor: 'rgba(46, 204, 113, 0.3)',
                tension: 0.2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.2,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function displaySalesReport(rows, selectedPeriod) {
    const listEl = document.getElementById('sales-list');

    if (!rows || rows.length === 0) {
        listEl.innerHTML = '<p>No hay ventas confirmadas para el período seleccionado.</p>';
        if (salesBarChart) {
            salesBarChart.destroy();
            salesBarChart = null;
        }
        if (salesLineChart) {
            salesLineChart.destroy();
            salesLineChart = null;
        }
        return;
    }

    let html = '<div>';
    rows.forEach((row) => {
        const formattedPeriod = formatSalesPeriod(row.periodo, selectedPeriod);
        html += `
            <div class="interaction-item">
                <h4>Período: ${formattedPeriod}</h4>
                <p><strong>Total ventas:</strong> Q${Number(row.total_ventas).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
        `;
    });
    html += '</div>';

    listEl.innerHTML = html;
    renderSalesCharts(rows, selectedPeriod);
}
