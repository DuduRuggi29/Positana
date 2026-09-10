// Mercado Pago Public Key
const MP_PUBLIC_KEY = 'APP_USR-79a4de34-da24-451b-b8ea-ac141b962ec9';

// Order data from URL
const params      = new URLSearchParams(window.location.search);
const promoType   = params.get('promo') || 'B';
const qty         = parseInt(params.get('qty') || '1');
const prices      = { A: 98.90, B: 147.90, C: 197.90 };
const kitLabels   = { A: '1 Sutiã Hanna 3.0', B: 'Kit com 2 Sutiãs Hanna 3.0', C: 'Kit com 3 Sutiãs Hanna 3.0' };
const unitsPerKit = { A: 1, B: 2, C: 3 };
const freeShip    = { A: false, B: true, C: true };

let shippingCost   = freeShip[promoType] ? 0 : 19.90;
let discountAmount = 0;
let orderTotal     = prices[promoType] * qty;
let currentStep    = 'info';
let paymentType    = 'pix';
let mpInstance     = null;
let cardFormInstance = null;

// ── Helpers ───────────────────────────────────────────────
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function fmt(val) { return 'R$' + parseFloat(val).toFixed(2).replace('.', ','); }

// ── Summary ───────────────────────────────────────────────
function initSummary() {
    const totalUnits = unitsPerKit[promoType] * qty;
    const label = qty > 1
        ? `${kitLabels[promoType]} × ${qty}`
        : kitLabels[promoType];

    setEl('badge-qty', totalUnits);
    setEl('item-var',  label);
    setEl('item-p',    fmt(prices[promoType] * qty));
    updateTotals();
}

function updateTotals() {
    const sub   = prices[promoType] * qty;
    const total = Math.max(0, sub + shippingCost - discountAmount);

    setEl('r-subtotal', fmt(sub));
    setEl('r-total',    fmt(total));
    setEl('mob-total',  fmt(total));

    const shippingEl = document.getElementById('r-shipping');
    if (shippingEl) {
        if (shippingCost === 0) {
            shippingEl.textContent = freeShip[promoType] ? 'Grátis' : 'Calculado no próximo passo';
            shippingEl.className   = 'co-muted';
        } else {
            shippingEl.textContent = fmt(shippingCost);
            shippingEl.className   = '';
        }
    }
    orderTotal = total;
}

function updateShipping(cost) {
    shippingCost = cost;
    const methodEl = document.getElementById('pill-method');
    if (methodEl) {
        methodEl.textContent = cost === 0
            ? 'Envio Padrão · Grátis'
            : 'Envio Expresso · R$59,90';
    }
    updateTotals();
}

// ── Discount ──────────────────────────────────────────────
const DISCOUNT_CODES = { 'JULIA10': 0.10, 'JULIE15': 0.15 };

function applyDiscount() {
    const input = document.getElementById('disc-code');
    if (!input) return;
    const code = input.value.trim().toUpperCase();
    if (DISCOUNT_CODES[code]) {
        const pct = DISCOUNT_CODES[code];
        discountAmount = prices[promoType] * qty * pct;
        setEl('r-discount', '-' + fmt(discountAmount));
        const row = document.getElementById('r-discount-row');
        if (row) row.classList.remove('hidden');
        updateTotals();
        alert(`Cupom aplicado! ${pct * 100}% de desconto.`);
    } else {
        alert('Cupom inválido.');
    }
}

// ── Step navigation ───────────────────────────────────────
const STEP_IDS  = { info: 'step-info', shipping: 'step-shipping', payment: 'step-payment' };
const STEP_ORDER = ['info', 'shipping', 'payment'];

function goToStep(step) {
    if (step === 'shipping' && currentStep === 'info') {
        const nome  = getVal('firstName') + ' ' + getVal('lastName');
        const email = getVal('email');
        const tel   = getVal('phone');
        if (!email || !email.includes('@')) { alert('Informe um e-mail válido.'); return; }
        if (!nome.trim() || nome.trim() === '') { alert('Informe seu nome.'); return; }
        if (!tel) { alert('Informe seu telefone.'); return; }

        setEl('pill-email',  email);
        setEl('pill-email2', email);
        const addr = buildAddressString();
        setEl('pill-address',  addr);
        setEl('pill-address2', addr);
    }
    if (step === 'payment' && currentStep === 'shipping') {
        updateTotals();
    }

    Object.values(STEP_IDS).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const target = document.getElementById(STEP_IDS[step]);
    if (target) target.classList.remove('hidden');

    const currentIdx = STEP_ORDER.indexOf(step);
    STEP_ORDER.forEach((s, i) => {
        const crumb = document.getElementById('crumb-' + s);
        if (!crumb) return;
        crumb.className = 'crumb';
        if (s === step)          crumb.classList.add('active');
        else if (i < currentIdx) crumb.classList.add('done');
        else                     crumb.classList.add('inactive');
    });

    currentStep = step;
    if (step === 'payment') initMercadoPago();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildAddressString() {
    const apt = getVal('apt') ? `, ${getVal('apt')}` : '';
    return `${getVal('address')}${apt}, ${getVal('city')}, ${getVal('state')} ${getVal('zip')}`.replace(/^,\s|,\s$/, '').trim();
}

function toggleBilling(showFields) {
    const fields = document.getElementById('billing-fields');
    const sameLabel = document.getElementById('billing-same-label');
    const diffLabel = document.getElementById('billing-diff-label');
    if (fields)    fields.classList.toggle('hidden', !showFields);
    if (sameLabel) sameLabel.classList.toggle('active', !showFields);
    if (diffLabel) diffLabel.classList.toggle('active', showFields);
}

function toggleMobileSummary() {
    const panel   = document.getElementById('mob-panel');
    const label   = document.getElementById('mob-toggle-label');
    const chevron = document.getElementById('mob-chevron');
    if (!panel) return;
    const isOpen = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', isOpen);
    if (label)   label.textContent = isOpen ? 'Ver resumo do pedido' : 'Ocultar resumo';
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    if (!isOpen) { const right = document.querySelector('.co-summary'); if (right) panel.innerHTML = right.innerHTML; }
}

// ── Mercado Pago Init ─────────────────────────────────────
function initMercadoPago() {
    if (!window.MercadoPago) {
        const script = document.createElement('script');
        script.src = 'https://sdk.mercadopago.com/js/v2';
        script.onload = () => { mpInstance = new MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' }); renderPaymentTab(paymentType); };
        document.head.appendChild(script);
    } else {
        if (!mpInstance) mpInstance = new MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
        renderPaymentTab(paymentType);
    }
}

function switchPayment(type) {
    paymentType = type;
    document.querySelectorAll('.payment-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
    document.getElementById('card-payment-form') && (document.getElementById('card-payment-form').style.display = type === 'card' ? 'block' : 'none');
    document.getElementById('pix-payment-form') && (document.getElementById('pix-payment-form').style.display  = type === 'pix'  ? 'block' : 'none');
    renderPaymentTab(type);
}

function renderPaymentTab(type) {
    if (type === 'card') renderCardForm();
}

function renderCardForm() {
    if (cardFormInstance || !mpInstance) return;
    const container = document.getElementById('card-payment-form');
    if (!container) return;

    container.innerHTML = `
        <div id="form-checkout" style="display:flex; flex-direction:column; gap:12px;">
            <input type="text" id="form-checkout__cardholderName" placeholder="Nome no cartão" style="padding:12px; border:1.5px solid #e0e0e0; border-radius:8px; font-family:'Poppins',sans-serif; font-size:14px; outline:none;">
            <div id="form-checkout__cardNumber" style="padding:12px; border:1.5px solid #e0e0e0; border-radius:8px; height:44px;"></div>
            <div style="display:flex; gap:10px;">
                <div id="form-checkout__expirationDate" style="flex:1; padding:12px; border:1.5px solid #e0e0e0; border-radius:8px; height:44px;"></div>
                <div id="form-checkout__securityCode" style="flex:1; padding:12px; border:1.5px solid #e0e0e0; border-radius:8px; height:44px;"></div>
            </div>
            <select id="form-checkout__installments" style="padding:12px; border:1.5px solid #e0e0e0; border-radius:8px; font-family:'Poppins',sans-serif; font-size:14px; background:#fff;">
                <option value="1">1x sem juros</option>
                <option value="2">2x sem juros</option>
                <option value="3">3x sem juros</option>
            </select>
            <select id="form-checkout__identificationType" style="display:none;"></select>
            <input type="text" id="form-checkout__identificationNumber" placeholder="CPF (somente números)" style="padding:12px; border:1.5px solid #e0e0e0; border-radius:8px; font-family:'Poppins',sans-serif; font-size:14px; outline:none;">
            <input type="hidden" id="form-checkout__issuer">
            <p id="card-error" style="color:#c0392b; font-size:13px; display:none;"></p>
        </div>`;

    cardFormInstance = mpInstance.cardForm({
        amount: String(orderTotal.toFixed(2)),
        iframe: true,
        form: {
            id: 'form-checkout',
            cardholderName: { id: 'form-checkout__cardholderName', placeholder: 'Nome no cartão' },
            cardholderEmail: { id: 'form-checkout__cardholderEmail' },
            cardNumber:      { id: 'form-checkout__cardNumber', placeholder: '0000 0000 0000 0000' },
            expirationDate:  { id: 'form-checkout__expirationDate', placeholder: 'MM/AA' },
            securityCode:    { id: 'form-checkout__securityCode', placeholder: 'CVV' },
            installments:    { id: 'form-checkout__installments' },
            identificationType:   { id: 'form-checkout__identificationType' },
            identificationNumber: { id: 'form-checkout__identificationNumber', placeholder: 'CPF' },
            issuer: { id: 'form-checkout__issuer' }
        },
        callbacks: {
            onFormMounted: err => { if (err) console.warn('CardForm mount error:', err); },
            onError: err => { console.error('CardForm error:', err); }
        }
    });
}

// ── Payment Submit ────────────────────────────────────────
async function handlePayment() {
    const btn     = document.getElementById('pay-btn');
    const text    = document.getElementById('pay-text');
    const spinner = document.getElementById('pay-spinner');
    const errEl   = document.getElementById('payment-error');

    btn.disabled = true;
    if (text) text.textContent = 'Processando...';
    if (spinner) spinner.classList.remove('hidden');
    if (errEl) errEl.classList.add('hidden');

    try {
        const orderData = collectOrderData();

        if (paymentType === 'pix') {
            await submitPix(orderData, btn, text, spinner, errEl);
        } else {
            await submitCard(orderData, btn, text, spinner, errEl);
        }
    } catch (err) {
        showError(err.message, btn, text, spinner, errEl);
    }
}

function collectOrderData() {
    return {
        paymentMethod: paymentType,
        nome:    (getVal('firstName') + ' ' + getVal('lastName')).trim(),
        email:   getVal('email'),
        telefone: getVal('phone'),
        cpf:     getVal('form-checkout__identificationNumber') || getVal('cpf') || '',
        cep:     getVal('zip'),
        rua:     getVal('address'),
        numero:  getVal('number') || 'S/N',
        complemento: getVal('apt'),
        bairro:  getVal('neighborhood') || '',
        cidade:  getVal('city'),
        estado:  getVal('state'),
        tipo_frete:  shippingCost === 0 ? 'Padrão' : 'Expresso',
        prazo_frete: shippingCost === 0 ? '7 a 18 dias úteis' : '4 dias úteis',
        custo_frete: shippingCost,
        kit:      promoType,
        nome_kit: kitLabels[promoType],
        quantidade: qty,
        tamanho: params.get('tamanho') || '',
        cor:     params.get('cor') || '',
        subtotal: prices[promoType] * qty,
        desconto: discountAmount,
        total:    orderTotal
    };
}

async function submitPix(orderData, btn, text, spinner, errEl) {
    const res = await fetch('/api/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Erro ao gerar PIX');

    // Show QR code
    showPixQR(data.pix_qr_code, data.pix_qr_code_base64);

    if (btn) btn.disabled = false;
    if (text) text.textContent = 'Confirmar Pagamento';
    if (spinner) spinner.classList.add('hidden');
}

function showPixQR(code, base64) {
    const container = document.getElementById('pix-payment-form');
    if (!container) return;

    container.innerHTML = `
        <div style="text-align:center; padding:20px 0;">
            <p style="font-size:14px; color:#555; margin-bottom:16px;">Escaneie o QR Code com seu app do banco:</p>
            ${base64 ? `<img src="data:image/png;base64,${base64}" style="width:200px; height:200px; border:2px solid #eee; border-radius:12px; margin-bottom:16px;">` : ''}
            <p style="font-size:12px; color:#888; margin-bottom:8px;">Ou copie o código PIX:</p>
            <div style="display:flex; gap:8px; align-items:center; justify-content:center;">
                <input id="pix-code" type="text" readonly value="${code || ''}" style="font-size:11px; padding:8px 12px; border:1.5px solid #e0e0e0; border-radius:8px; width:100%; max-width:280px; font-family:monospace; color:#555;">
                <button onclick="copyPix()" style="padding:8px 14px; background:var(--rosa-escuro); color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; white-space:nowrap;">Copiar</button>
            </div>
            <p id="pix-copied" style="color:#1a7a4a; font-size:13px; margin-top:8px; display:none;">✓ Copiado!</p>
            <div style="margin-top:20px; background:#f0faf5; border-radius:10px; padding:14px; font-size:13px; color:#1a7a4a; border:1px solid #c3e6d4;">
                ⏱️ O PIX expira em <strong>30 minutos</strong>. Após o pagamento, você receberá a confirmação por e-mail.
            </div>
            <button onclick="window.location.href='success.html'" style="margin-top:16px; background:var(--rosa-escuro); color:#fff; border:none; padding:14px 28px; border-radius:50px; font-family:'Poppins',sans-serif; font-size:14px; font-weight:700; cursor:pointer; width:100%;">
                ✓ Já realizei o pagamento
            </button>
        </div>`;
}

function copyPix() {
    const input = document.getElementById('pix-code');
    if (input) { input.select(); document.execCommand('copy'); }
    const msg = document.getElementById('pix-copied');
    if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
}

async function submitCard(orderData, btn, text, spinner, errEl) {
    if (!cardFormInstance) throw new Error('Formulário de cartão não carregado.');

    const { token, isValid, cardholderEmail } = cardFormInstance.getCardFormData();
    if (!isValid || !token) throw new Error('Dados do cartão inválidos. Verifique e tente novamente.');

    const installments = document.getElementById('form-checkout__installments')?.value || '1';

    const res = await fetch('/api/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderData, token, installments })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Erro ao processar cartão');

    if (data.status === 'approved') {
        window.location.href = 'success.html?method=card&id=' + data.id;
    } else {
        throw new Error('Pagamento não aprovado: ' + (data.status_detail || data.status));
    }
}

function showError(msg, btn, text, spinner, errEl) {
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    if (btn)     btn.disabled = false;
    if (text)    text.textContent = 'Tentar novamente';
    if (spinner) spinner.classList.add('hidden');
}

// ── Init ──────────────────────────────────────────────────
initSummary();
