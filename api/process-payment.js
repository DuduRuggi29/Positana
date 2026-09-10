
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

const { sendWhatsAppConfirmation, emitBlingNfe } = require('./_shared');

// Catálogo mínimo usado para enriquecer o item enviado ao Mercado Pago
// (nome, descrição, SKU e foto corretos por produto, em vez do texto
// genérico fixo que era usado antes para qualquer checkout).
const PRODUCTS = {
    'sutia-hanna': {
        sku: 'SUTIA-HANNA-30',
        title: 'Sutiã Hanna 3.0 de Alta Sustentação Sem Aro',
        description: 'Sutiã sem aro de alta sustentação, tecido premium respirável e alças largas ajustáveis',
        category_id: 'fashion',
        picture_path: '/braaa.jpg'
    },
    'calcinha-premium': {
        sku: 'CALCINHA-PREMIUM-ALGODAO',
        title: 'Calcinha Julie Premium Confort 100% Algodão Antiodor',
        description: 'Calcinha 95% algodão + 5% elastano, tecido antiodor, vendida em kit com múltiplas unidades',
        category_id: 'fashion',
        picture_path: '/cal1.jpg'
    }
};

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.socket?.remoteAddress || undefined;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const {
            customerName, customerEmail, customerCpf, customerPhone,
            customerAddress, quantity, promo, totalPrice,
            paymentMethodId, cardToken, cardPaymentMethodId, installments,
            shippingMethod, shippingPrice, tamanho, cor, deviceId, productId
        } = req.body;

        const product = PRODUCTS[productId] || PRODUCTS['sutia-hanna'];

        const cpfClean = (customerCpf || '').replace(/\D/g, '');
        const telClean = (customerPhone || '').replace(/\D/g, '');
        const nameParts = (customerName || '').trim().split(' ');
        const qtyNum = parseInt(quantity) || 1;

        const isPix = paymentMethodId === 'pix';

        const amount = Math.round(parseFloat(totalPrice) * 100) / 100;
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Valor inválido: ' + totalPrice });
        }

        const itemSku = [product.sku, tamanho, cor]
            .filter(Boolean)
            .map(s => String(s).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
            .filter(Boolean)
            .join('-');

        const clientIp = getClientIp(req);
        const siteUrl = process.env.SITE_URL || '';

        const mpBody = {
            transaction_amount: amount,
            description: `${product.title} - Kit ${promo} (${quantity} un)`,
            statement_descriptor: 'JULIAEJULIE',
            payment_method_id: isPix ? 'pix' : cardPaymentMethodId || 'visa',
            payer: {
                email: customerEmail,
                first_name: nameParts[0] || customerName,
                last_name: nameParts.slice(1).join(' ') || nameParts[0] || '',
                identification: { type: 'CPF', number: cpfClean },
                phone: { area_code: telClean.slice(0, 2), number: telClean.slice(2) },
                address: {
                    zip_code: (customerAddress?.cep || '').replace(/\D/g, ''),
                    street_name: customerAddress?.street || '',
                    street_number: customerAddress?.number || 'S/N'
                }
            },
            additional_info: {
                items: [{
                    id: itemSku,
                    title: product.title,
                    description: `${product.description} — Kit ${promo} (${quantity} un), tamanho ${tamanho || 'não informado'}, cor ${cor || 'não informada'}`,
                    category_id: product.category_id,
                    quantity: qtyNum,
                    unit_price: Math.round((amount / qtyNum) * 100) / 100,
                    picture_url: siteUrl ? `${siteUrl}${product.picture_path}` : undefined
                }],
                payer: {
                    first_name: nameParts[0] || customerName,
                    last_name: nameParts.slice(1).join(' ') || nameParts[0] || '',
                    phone: { area_code: telClean.slice(0, 2), number: telClean.slice(2) },
                    address: {
                        zip_code: (customerAddress?.cep || '').replace(/\D/g, ''),
                        street_name: customerAddress?.street || '',
                        street_number: customerAddress?.number || 'S/N'
                    }
                },
                shipments: {
                    receiver_address: {
                        zip_code: (customerAddress?.cep || '').replace(/\D/g, ''),
                        street_name: customerAddress?.street || '',
                        street_number: customerAddress?.number || 'S/N',
                        city_name: customerAddress?.city || '',
                        state_name: customerAddress?.state || ''
                    }
                },
                ip_address: clientIp
            },
            notification_url: `${siteUrl}/api/webhook`,
            external_reference: `jj-${Date.now()}`
        };

        if (!isPix) {
            mpBody.token = cardToken;
            mpBody.installments = parseInt(installments) || 1;
        }

        const mpHeaders = {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `jj-${Date.now()}-${Math.random()}`
        };
        if (deviceId) mpHeaders['X-meli-session-id'] = deviceId;

        const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: mpHeaders,
            body: JSON.stringify(mpBody)
        });

        const mpData = await mpRes.json();

        if (!mpRes.ok) {
            console.error('MP Error:', mpData);
            return res.status(400).json({ error: mpData.message || 'Erro no pagamento' });
        }

        // Save order to Supabase
        const orderData = {
            status: mpData.status === 'approved' ? 'aprovado' : 'pendente',
            nome: customerName,
            email: customerEmail,
            telefone: customerPhone,
            cpf: customerCpf,
            cep: customerAddress?.cep || '',
            rua: customerAddress?.street || '',
            numero: customerAddress?.number || '',
            complemento: customerAddress?.complement || '',
            bairro: customerAddress?.neighborhood || '',
            cidade: customerAddress?.city || '',
            estado: customerAddress?.state || '',
            tipo_frete: shippingMethod || '',
            prazo_frete: '',
            custo_frete: parseFloat(shippingPrice) || 0,
            kit: promo,
            nome_kit: `${product.title} - Kit ${promo}`,
            quantidade: parseInt(quantity) || 1,
            tamanho: tamanho || '',
            cor: cor || '',
            forma_pagamento: isPix ? 'PIX' : 'Cartão de Crédito',
            status_pagamento: mpData.status,
            subtotal: parseFloat(totalPrice),
            desconto: 0,
            total: parseFloat(totalPrice),
            observacoes: `MP ID: ${mpData.id}`
        };

        try {
            await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(orderData)
            });
        } catch (dbErr) {
            console.error('Supabase save error:', dbErr);
        }

        // Pagamentos no cartão são aprovados na hora (diferente do PIX, que só
        // aprova quando o cliente paga e o webhook do Mercado Pago avisa depois).
        // Por isso disparamos aqui também - o webhook.js já sabe não repetir,
        // pois vai encontrar o pedido já salvo como 'aprovado'.
        if (orderData.status === 'aprovado') {
            try {
                await sendWhatsAppConfirmation(orderData);
                await emitBlingNfe(orderData);
            } catch (notifyErr) {
                console.error('Notification error:', notifyErr);
            }
        }

        // Response
        if (isPix && mpData.point_of_interaction) {
            return res.status(200).json({
                id: mpData.id,
                status: mpData.status,
                qr_code: mpData.point_of_interaction.transaction_data?.qr_code,
                qr_code_base64: mpData.point_of_interaction.transaction_data?.qr_code_base64
            });
        }

        return res.status(200).json({
            id: mpData.id,
            status: mpData.status,
            status_detail: mpData.status_detail
        });

    } catch (err) {
        console.error('Server error:', err);
        return res.status(500).json({ error: err.message });
    }
};
