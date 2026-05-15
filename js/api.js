// API Configuration
const API_BASE_URL = 'https://proyectoingenieriasoftware-production.up.railway.app/api';
const AUTH_TOKEN_KEY = 'erp_token';
const AUTH_USER_KEY = 'erp_user';

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function getAuthUser() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
    } catch (error) {
        return null;
    }
}

function saveAuthSession(token, user) {
    localStorage.setItem(AUTH_TOKEN_KEY, String(token || ''));
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user || null));
}

function clearAuthSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
}

// API Functions
async function apiCall(endpoint, method = 'GET', data = null) {
    const token = getAuthToken();
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        }
    };

    if (token) {
        options.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        
        if (!response.ok) {
            if (response.status === 401) {
                clearAuthSession();
            }

            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error || `HTTP error! status: ${response.status}`;
            throw new Error(errorMessage);
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function login(correo, password) {
    return apiCall('/auth/login', 'POST', {
        correo: String(correo || '').trim(),
        password: String(password || '')
    });
}

async function getCurrentSession() {
    return apiCall('/auth/me', 'GET');
}

async function getSystemUsers() {
    return apiCall('/users', 'GET');
}

async function createSystemUser(userData) {
    return apiCall('/users', 'POST', userData);
}

async function updateSystemUser(userId, userData) {
    return apiCall(`/users/${encodeURIComponent(String(userId))}`, 'PUT', userData);
}

async function deleteSystemUser(userId) {
    return apiCall(`/users/${encodeURIComponent(String(userId))}`, 'DELETE');
}

async function checkApiStatus() {
    try {
        const baseURL = 'https://proyectoingenieriasoftware-production.up.railway.app';

        // Primero probar endpoint simple sin BD
        const testResponse = await fetch(`${baseURL}/test`);
        if (testResponse.ok) {
            const testData = await testResponse.json();
            console.log('API test endpoint working:', testData);

            // Luego probar health check con BD
            try {
                const healthResponse = await fetch(`${baseURL}/health`);
                if (healthResponse.ok) {
                    const healthData = await healthResponse.json();
                    return { ...testData, ...healthData };
                }
            } catch (healthError) {
                console.warn('Health check failed, but API is responding:', healthError);
                return { ...testData, database: 'unknown' };
            }
        }

        return null;
    } catch (error) {
        console.error('Error checking API status:', error);
        return null;
    }
}

async function createInteraction(interactionData) {
    return apiCall('/interactions', 'POST', interactionData);
}

async function getAllInteractions() {
    return apiCall('/interactions', 'GET');
}

async function getInteractionsByClient(codigoCliente) {
    return apiCall(`/interactions/${codigoCliente}`, 'GET');
}

async function getSalesReport(period, codigoCliente = '', vendedor = '') {
    const params = new URLSearchParams({ period });

    if (codigoCliente && codigoCliente.trim()) {
        params.append('codigo_cliente', codigoCliente.trim());
    }

    if (vendedor && vendedor.trim()) {
        params.append('vendedor', vendedor.trim());
    }

    return apiCall(`/sales/report?${params.toString()}`, 'GET');
}

async function getSalesBySeller(vendedor, limit = 100) {
    const params = new URLSearchParams();

    if (vendedor && vendedor.trim()) {
        params.append('vendedor', vendedor.trim());
    }

    if (limit && limit !== 100) {
        params.append('limit', String(limit));
    }

    return apiCall(`/sales/by-seller?${params.toString()}`, 'GET');
}

async function getSalesClients() {
    return apiCall('/sales/clients', 'GET');
}

async function searchClients(query, limit = 20) {
    const params = new URLSearchParams({
        q: String(query || '').trim(),
        limit: String(limit)
    });

    return apiCall(`/sales/clients/search?${params.toString()}`, 'GET');
}

async function getClientDetail(clientRef) {
    return apiCall(`/sales/clients/${encodeURIComponent(String(clientRef || '').trim())}`, 'GET');
}

async function createClient(clientData) {
    return apiCall('/sales/clients', 'POST', clientData);
}

async function updateClient(clientRef, clientData) {
    return apiCall(`/sales/clients/${encodeURIComponent(String(clientRef || '').trim())}`, 'PUT', clientData);
}

async function deleteClient(clientRef) {
    return apiCall(`/sales/clients/${encodeURIComponent(String(clientRef || '').trim())}`, 'DELETE');
}

async function getSalesVendedores() {
    return apiCall('/sales/vendedores', 'GET');
}

async function getVendedoresRendimiento(period = 'month') {
    return apiCall(`/sales/vendedores/rendimiento?period=${period}`, 'GET');
}

async function getSalesKpis(month, vendedor = '') {
    const params = new URLSearchParams();
    const monthValue = String(month || '').trim();

    if (monthValue) {
        params.set('month', monthValue);
    }

    const vendorValue = String(vendedor || '').trim();
    if (vendorValue) {
        params.set('vendedor', vendorValue);
    }

    const queryString = params.toString();
    return apiCall(`/sales/kpis${queryString ? `?${queryString}` : ''}`, 'GET');
}

async function createSale(saleData) {
    return apiCall('/sales', 'POST', saleData);
}

async function getLoyaltyConfig() {
    return apiCall('/sales/loyalty/config', 'GET');
}

async function updateLoyaltyConfig(configData) {
    return apiCall('/sales/loyalty/config', 'PUT', configData);
}

async function createOpportunity(opportunityData) {
    return apiCall('/opportunities', 'POST', opportunityData);
}

async function getOpportunities(codigoCliente = '') {
    const codigo = String(codigoCliente || '').trim();
    if (!codigo) {
        return apiCall('/opportunities', 'GET');
    }

    const params = new URLSearchParams({ codigo_cliente: codigo });
    return apiCall(`/opportunities?${params.toString()}`, 'GET');
}

async function updateOpportunityState(opportunityId, estado) {
    return apiCall(`/opportunities/${encodeURIComponent(String(opportunityId))}/state`, 'PATCH', { estado });
}

async function getSupportTicketsByClient(codigoCliente) {
    const codigo = String(codigoCliente || '').trim();
    const params = new URLSearchParams({ codigo_cliente: codigo });
    return apiCall(`/tickets?${params.toString()}`, 'GET');
}

async function createSupportTicket(ticketData) {
    return apiCall('/tickets', 'POST', ticketData);
}

async function getSupportTicketDetail(ticketId) {
    return apiCall(`/tickets/${encodeURIComponent(String(ticketId))}`, 'GET');
}

async function updateSupportTicket(ticketId, ticketData) {
    return apiCall(`/tickets/${encodeURIComponent(String(ticketId))}`, 'PUT', ticketData);
}

async function deleteSupportTicket(ticketId) {
    return apiCall(`/tickets/${encodeURIComponent(String(ticketId))}`, 'DELETE');
}

async function getRewards() {
    return apiCall('/rewards', 'GET');
}

async function getAllRewards() {
    return apiCall('/rewards/all', 'GET');
}

async function createReward(rewardData) {
    return apiCall('/rewards', 'POST', rewardData);
}

async function updateRewardItem(rewardId, rewardData) {
    return apiCall(`/rewards/${encodeURIComponent(String(rewardId))}`, 'PUT', rewardData);
}

async function deleteRewardItem(rewardId) {
    return apiCall(`/rewards/${encodeURIComponent(String(rewardId))}`, 'DELETE');
}

async function redeemReward(clientRef, rewardId) {
    return apiCall('/rewards/redeem', 'POST', {
        clientRef: String(clientRef || '').trim(),
        rewardId: Number(rewardId)
    });
}
