// Script de prueba para verificar conectividad con la API
async function testApiConnectivity() {
    const API_BASE_URL = 'https://proyectoingenieriasoftware-production.up.railway.app';

    console.log('🚀 Iniciando pruebas de conectividad...\n');

    const tests = [
        {
            name: 'Endpoint /test (sin BD)',
            url: `${API_BASE_URL}/test`,
            method: 'GET'
        },
        {
            name: 'Endpoint /health (con BD)',
            url: `${API_BASE_URL}/health`,
            method: 'GET'
        },
        {
            name: 'Endpoint /api/rewards (GET)',
            url: `${API_BASE_URL}/api/rewards`,
            method: 'GET'
        },
        {
            name: 'Endpoint /api/rewards (POST - datos de prueba)',
            url: `${API_BASE_URL}/api/rewards`,
            method: 'POST',
            body: {
                nombre: 'Premio de Prueba',
                descripcion: 'Premio creado para testing',
                costo_puntos: 100,
                tipo_descuento: 'MONTO',
                valor_descuento: 50
            }
        }
    ];

    for (const test of tests) {
        try {
            console.log(`📡 Probando: ${test.name}`);
            console.log(`   URL: ${test.url}`);
            console.log(`   Método: ${test.method}`);

            const options = {
                method: test.method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            if (test.body) {
                options.body = JSON.stringify(test.body);
                console.log(`   Body:`, test.body);
            }

            const response = await fetch(test.url, options);

            console.log(`   Status: ${response.status} ${response.statusText}`);

            if (response.ok) {
                const data = await response.json();
                console.log(`   ✅ Respuesta:`, data);
            } else {
                const errorText = await response.text();
                console.log(`   ❌ Error: ${errorText}`);
            }

        } catch (error) {
            console.log(`   ❌ Error de conexión: ${error.message}`);
        }

        console.log(''); // Línea en blanco
    }

    console.log('🏁 Pruebas completadas');
}

// Ejecutar las pruebas
testApiConnectivity();