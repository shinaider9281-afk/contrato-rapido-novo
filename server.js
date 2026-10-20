const express = require('express');
const mercadopago = require('mercadopago');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ACEITA OS 2 NOMES DE VARIAVEL - RESOLVE O BUG
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;

if (!MP_TOKEN) {
  console.error('❌ ERRO CRITICO: Nenhum token do Mercado Pago configurado!');
  console.error('Configure MERCADOPAGO_ACCESS_TOKEN no Render > Environment');
} else {
  console.log('✅ Token MP configurado: ' + MP_TOKEN.substring(0, 15) + '...');
  mercadopago.configure({
    access_token: MP_TOKEN
  });
}

// Memoria temporaria (perde se resetar, mas busca no MP de novo)
const pagamentosAprovados = new Set();
const dadosPorPagamento = new Map();

function gerarPDFContrato(dados, doc) {
  doc.fontSize(16).text('CONTRATO DE LOCAÇÃO RESIDENCIAL', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Lei 8.245/91 - 10 Cláusulas`);
  doc.moveDown();
  doc.text(`LOCADOR: ${dados.nomeLocador || ''} CPF: ${dados.cpfLocador || ''}`);
  doc.text(`LOCATÁRIO: ${dados.nomeLocatario || ''} CPF: ${dados.cpfLocatario || ''} Email: ${dados.emailLocatario || ''}`);
  doc.moveDown();
  doc.text(`IMÓVEL: ${dados.enderecoImovel || ''}`);
  doc.text(`Tipo: ${dados.tipoImovel || ''} Mobiliado: ${dados.mobiliado || ''}`);
  doc.moveDown();
  doc.text(`VALOR: R$ ${dados.valorAluguel || ''} Vencimento dia ${dados.vencimento || ''}`);
  doc.text(`PRAZO: ${dados.prazoMeses || ''} meses a partir de ${dados.dataInicio || ''}`);
  doc.text(`GARANTIA: ${dados.garantia || ''} ${dados.valorCaucao ? '- R$ '+dados.valorCaucao : ''}`);
  doc.moveDown();
  doc.text(`CIDADE/FORO: ${dados.cidade || ''} / ${dados.foro || ''}`);
  doc.moveDown(2);
  doc.text('Assinaturas: __________________________________ __________________________________');
  doc.text('Locador                                    Locatário');
  doc.end();
}

// ROTA CRIAR PAGAMENTO PIX
app.post('/criar-pagamento', async (req, res) => {
  try {
    if (!MP_TOKEN) {
      return res.status(500).json({ error: 'Token do Mercado Pago não configurado no servidor' });
    }
    
    const external_reference = 'contrato-' + Date.now();
    dadosPorPagamento.set(external_reference, req.body);
    
    console.log('Criando pagamento:', external_reference);

    const preference = {
      items: [{
        title: 'Contrato de Aluguel Completo - 10 cláusulas',
        quantity: 1,
        unit_price: 9.99,
        currency_id: 'BRL'
      }],
      payer: {
        email: req.body.emailLocatario || 'cliente@teste.com'
      },
      external_reference: external_reference,
      back_urls: {
        success: `https://${req.headers.host}/sucesso.html?ref=${external_reference}`,
        failure: `https://${req.headers.host}/`,
        pending: `https://${req.headers.host}/sucesso.html?ref=${external_reference}`
      },
      notification_url: `https://${req.headers.host}/webhook`
      // REMOVIDO auto_return que travava o botão
    };

    const response = await mercadopago.preferences.create(preference);
    console.log('Preferencia criada:', response.body.id);
    res.json({ 
      id: response.body.id, 
      init_point: response.body.init_point,
      external_reference: external_reference
    });

  } catch (e) {
    console.error('ERRO criar-pagamento:', e);
    res.status(500).json({ error: e.message });
  }
});

// COMPATIBILIDADE: ROTA ANTIGA /criar-pix
app.post('/criar-pix', (req, res) => {
  req.url = '/criar-pagamento';
  app._router.handle(req, res);
});

// VERIFICAR PAGAMENTO - POLLING A CADA 5s
app.get('/verificar-pagamento/:ref', async (req, res) => {
  const ref = req.params.ref;
  
  try {
    // 1. Verifica memoria
    if (pagamentosAprovados.has(ref)) {
      console.log('Pagamento aprovado (memoria):', ref);
      return res.json({ pago: true });
    }

    // 2. Busca no Mercado Pago (se resetou o servidor)
    if (MP_TOKEN) {
      try {
        const search = await mercadopago.payment.search({
          qs: { 'external_reference': ref }
        });
        
        const results = search.body.results || [];
        const aprovado = results.find(p => p.status === 'approved');
        
        if (aprovado) {
          console.log('Pagamento aprovado (API MP):', ref);
          pagamentosAprovados.add(ref);
          return res.json({ pago: true });
        }
      } catch (err) {
        console.log('Busca MP falhou, continuando...', err.message);
      }
    }

    res.json({ pago: false });

  } catch (e) {
    console.error('Erro verificar:', e);
    res.json({ pago: false });
  }
});

// GERAR PDF - COM TRAVA
app.post('/gerar-pdf/:ref?', async (req, res) => {
  const ref = req.params.ref || req.body.external_reference || req.query.ref;

  // Se não tem ref, bloqueia (acesso direto)
  if (!ref) {
    console.log('Tentativa sem ref - bloqueado');
    return res.status(402).json({ error: 'Pagamento não encontrado. Pague para liberar.' });
  }

  // Verifica se pagou
  let pago = pagamentosAprovados.has(ref);
  
  if (!pago && MP_TOKEN) {
    try {
      const search = await mercadopago.payment.search({
        qs: { 'external_reference': ref }
      });
      const aprovado = search.body.results?.find(p => p.status === 'approved');
      if (aprovado) {
        pago = true;
        pagamentosAprovados.add(ref);
      }
    } catch (e) {}
  }

  if (!pago) {
    console.log('Tentativa de PDF sem pagamento:', ref);
    return res.status(402).json({ error: 'Aguardando confirmação do pagamento PIX' });
  }

  try {
    const dados = dadosPorPagamento.get(ref) || req.body;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=contrato-${ref}.pdf`);
    
    const doc = new PDFDocument();
    doc.pipe(res);
    gerarPDFContrato(dados, doc);
    
  } catch (e) {
    console.error('Erro gerar PDF:', e);
    res.status(500).json({ error: e.message });
  }
});

// WEBHOOK - MERCADO PAGO AVISA QUE PAGOU
app.post('/webhook', async (req, res) => {
  try {
    console.log('Webhook recebido:', JSON.stringify(req.body));
    
    const paymentId = req.body.data?.id || req.body.id;
    
    if (paymentId) {
      const payment = await mercadopago.payment.findById(paymentId);
      const status = payment.body.status;
      const external_reference = payment.body.external_reference;
      
      console.log(`Pagamento ${paymentId} status ${status} ref ${external_reference}`);
      
      if (status === 'approved' && external_reference) {
        pagamentosAprovados.add(external_reference);
        console.log('✅ PAGAMENTO APROVADO:', external_reference);
      }
    }
    
    res.sendStatus(200);
  } catch (e) {
    console.error('Erro webhook:', e);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
