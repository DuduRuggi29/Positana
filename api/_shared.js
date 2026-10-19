const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY;
const ZAPI_INSTANCE_ID   = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN         = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN  = process.env.ZAPI_CLIENT_TOKEN;
const BLING_CLIENT_ID     = process.env.BLING_CLIENT_ID;
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;

// Produtos (por tamanho) cadastrados no Bling para o Sutiã Sustentação Hanna.
const BLING_PRODUTO_POR_TAMANHO = {
    'P':   { id: 16699171798, codigo: 'hanna/p' },
    'M':   { id: 16699171799, codigo: 'hanna/m' },
    'G':   { id: 16699171800, codigo: 'hanna/g' },
    'GG':  { id: 16699171801, codigo: 'hanna/gg' },
    'XL':  { id: 16699171802, codigo: 'hanna/xl' },
    '2XL': { id: 16699734769, codigo: 'hanna/2xl' },
    '3XL': { id: 16699734772, codigo: 'hanna/3xl' },
    '4XL': { id: 16699734774, codigo: 'hanna/4xl' }
};

// Formas de pagamento cadastradas no Bling.
const BLING_FORMA_PAGAMENTO = {
    PIX: 10210399,
    CARTAO: 11036296
};

async function sendWhatsAppConfirmation(order) {
    try {
        const { nome, telefone, kit } = order || {};
        if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN || !telefone) return;
        const isCalca = kit && String(kit).startsWith('CALCA');
        if (kit && String(kit).startsWith('CALC') && !isCalca) return; // calcinha fica de fora - mensagem oferece o kit de calcinha

        let phone = String(telefone).replace(/\D/g, '');
        if (!phone.startsWith('55')) phone = '55' + phone;

        const primeiroNome = (nome || '').trim().split(' ')[0] || 'cliente';
        const message = isCalca
            ? `Olá ${primeiroNome}, seu pedido da Calça Cintura Alta Cruzada foi confirmado com sucesso e logo será processado e sairá para entrega. Prazo de entrega é de 14 dias.\n\nPara mais dúvidas chame o suporte pelo número: 21 97560-5337`
            : `Olá ${primeiroNome}, seu pedido foi confirmado com sucesso e logo será processado e sairá para entrega. Prazo de entrega é de 14 dias.\n\nPara mais dúvidas chame o suporte pelo número: 21 97560-5337\n\nE como você é nossa cliente que comprou nessa super promoção, estamos oferecendo para você, ${primeiroNome}, o kit de 10 calcinhas 100% algodão recomendadas por ginecologistas por menos de R$100 reais, aproveite agora por esse link: https://www.juliajuliesutia.com.br/calcinha#`;

        const zapiRes = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Token': ZAPI_CLIENT_TOKEN
            },
            body: JSON.stringify({ phone, message })
        });
        if (!zapiRes.ok) {
            const errText = await zapiRes.text();
            console.error('Z-API send failed (pedido', order?.id, '):', zapiRes.status, errText);
        }
    } catch (err) {
        console.error('Z-API send error:', err);
    }
}

async function getBlingAccessToken() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bling_tokens?id=eq.1&select=access_token,refresh_token,expires_at`, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        }
    });
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const row = rows[0];

    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
        return row.access_token;
    }

    const basicAuth = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${basicAuth}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: row.refresh_token
        })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
        console.error('Bling token refresh failed:', tokenData);
        return null;
    }

    const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 21600) * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/bling_tokens`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
            id: 1,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || row.refresh_token,
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString()
        })
    });

    return tokenData.access_token;
}

async function getOrCreateBlingContato(order, accessToken) {
    const cpf = String(order.cpf || '').replace(/\D/g, '');
    if (!cpf) return null;

    const searchRes = await fetch(`https://api.bling.com.br/Api/v3/contatos?numeroDocumento=${cpf}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const searchData = await searchRes.json();
    if (Array.isArray(searchData?.data) && searchData.data.length) {
        return searchData.data[0].id;
    }

    const createRes = await fetch('https://api.bling.com.br/Api/v3/contatos', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            nome: order.nome || '',
            tipo: 'F',
            situacao: 'A',
            numeroDocumento: cpf,
            telefone: order.telefone || undefined,
            email: order.email || undefined,
            endereco: {
                geral: {
                    endereco: order.rua || '',
                    numero: order.numero || 'S/N',
                    complemento: order.complemento || undefined,
                    bairro: order.bairro || '',
                    cep: String(order.cep || '').replace(/\D/g, ''),
                    municipio: order.cidade || '',
                    uf: order.estado || undefined
                }
            }
        })
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData?.data?.id) {
        console.error('Bling contato create failed:', JSON.stringify(createData));
        return null;
    }
    return createData.data.id;
}

async function emitBlingNfe(order) {
    try {
        if (!BLING_CLIENT_ID || !BLING_CLIENT_SECRET) return;
        if (!order.kit || String(order.kit).startsWith('CALC')) return; // calcinha e calça (kit CALCA) ficam de fora, só sutiã

        const tamanhoPrefixo = String(order.tamanho || '').split(' ')[0].toUpperCase();
        const produto = BLING_PRODUTO_POR_TAMANHO[tamanhoPrefixo];
        if (!produto) {
            console.error('Bling: tamanho não mapeado para produto:', order.tamanho, '(pedido', order.id, ')');
            return;
        }

        const accessToken = await getBlingAccessToken();
        if (!accessToken) {
            console.error('Bling: token de acesso indisponível (pedido', order.id, ')');
            return;
        }

        const contatoId = await getOrCreateBlingContato(order, accessToken);
        if (!contatoId) {
            console.error('Bling: não foi possível localizar/criar contato (pedido', order.id, ')');
            return;
        }

        const quantidade = parseInt(order.quantidade, 10) || 1;
        const totalPedido = parseFloat(order.total) || 0;
        const valorUnitario = quantidade > 0 ? Math.round((totalPedido / quantidade) * 100) / 100 : totalPedido;
        const hoje = new Date().toISOString().slice(0, 10);
        const formaPagamentoId = String(order.forma_pagamento || '').toUpperCase().includes('PIX')
            ? BLING_FORMA_PAGAMENTO.PIX
            : BLING_FORMA_PAGAMENTO.CARTAO;

        const pedidoBody = {
            data: hoje,
            dataSaida: hoje,
            dataPrevista: hoje,
            contato: { id: contatoId },
            itens: [{
                codigo: produto.codigo,
                unidade: 'UN',
                quantidade,
                valor: valorUnitario,
                descricao: `Sutiã Sustentação Hanna Tamanho:${tamanhoPrefixo}`,
                produto: { id: produto.id }
            }],
            parcelas: [{
                dataVencimento: hoje,
                valor: totalPedido,
                formaPagamento: { id: formaPagamentoId }
            }]
        };

        const pedidoRes = await fetch('https://api.bling.com.br/Api/v3/pedidos/vendas', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(pedidoBody)
        });
        const pedidoData = await pedidoRes.json();
        if (!pedidoRes.ok || !pedidoData?.data?.id) {
            console.error('Bling pedido de venda create failed (pedido', order.id, '):', JSON.stringify(pedidoData));
            return;
        }
        const idPedidoVenda = pedidoData.data.id;

        const gerarNfeRes = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedidoVenda}/gerar-nfe`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        const gerarNfeData = await gerarNfeRes.json();
        const idNotaFiscal = gerarNfeData?.data?.idNotaFiscal || gerarNfeData?.idNotaFiscal;
        if (!gerarNfeRes.ok || !idNotaFiscal) {
            console.error('Bling gerar-nfe failed (pedido', order.id, ', pedido venda', idPedidoVenda, '):', JSON.stringify(gerarNfeData));
            return;
        }

        const sendRes = await fetch(`https://api.bling.com.br/Api/v3/nfe/${idNotaFiscal}/enviar`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!sendRes.ok) {
            const errText = await sendRes.text();
            console.error('Bling NF-e send failed (pedido', order.id, '):', errText);
        }
    } catch (err) {
        console.error('Bling NF-e error (pedido', order?.id, '):', err);
    }
}

module.exports = { sendWhatsAppConfirmation, emitBlingNfe };
