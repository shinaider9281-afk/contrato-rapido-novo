
const express = require('express');
const mercadopago = require('mercadopago');
const PDFDocument = require('pdfkit');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const pagamentosAprovados = new Set();
const dadosPorPagamento = new Map();

mercadopago.configure({
  access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
});

function gerarPDFContrato(dados) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const dataHoje = new Date().toLocaleDateString('pt-BR');
    
    doc.fontSize(16).font('Helvetica-Bold').text('CONTRATO DE LOCAÇÃO RESIDENCIAL', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica').fillColor('#666').text(`Gerado em ${dataHoje} | Contrato Rápido - PAGO | ID: ${dados.paymentId || ''}`, { align: 'center' }).fillColor('#000');
    doc.moveDown(1.2);
    doc.fontSize(11).font('Helvetica');

    doc.font('Helvetica-Bold').text('1. DAS PARTES:', { underline: true }); doc.moveDown(0.3);
    doc.font('Helvetica').text(`LOCADOR(A): ${dados.nomeLocador || '-'} - CPF: ${dados.cpfLocador || '-'} | RG: ${dados.rgLocador || '-'} | Civil: ${dados.estadoCivilLocador || '-'}\nEndereço: ${dados.enderecoLocador || '-'}\n\nLOCATÁRIO(A): ${dados.nomeLocatario || '-'} - CPF: ${dados.cpfLocatario || '-'} | RG: ${dados.rgLocatario || '-'} | Profissão: ${dados.profissaoLocatario || '-'}\nEndereço: ${dados.enderecoLocatario || '-'} | Email: ${dados.email || '-'}`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('2. DO IMÓVEL:', { underline: true }); doc.moveDown(0.3);
    doc.font('Helvetica').text(`Endereço locado: ${dados.enderecoImovel || '-'}\nTipo: ${dados.tipoImovel || '-'} | Mobiliado: ${dados.mobiliado || 'não'} | IPTU: ${dados.iptu || '-'}\nEstado inicial: ${dados.estadoImovel || 'bom estado'}`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('3. DO PRAZO:', { underline: true }); doc.moveDown(0.3);
    doc.font('Helvetica').text(`Prazo de ${dados.prazoMeses || '12'} meses, início em ${dados.dataInicio || dataHoje}. Prorroga por prazo indeterminado se não houver manifestação. Rescisão antecipada: multa de ${dados.multaRecisoria || '1 mês'}.`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('4. DO VALOR E PAGAMENTO:', { underline: true }); doc.moveDown(0.3);
    doc.font('Helvetica').text(`4.1 Aluguel: R$ ${dados.valor}\n4.2 Vencimento dia ${dados.diaVencimento || '10'} via ${dados.formaPagamento || 'PIX'} (${dados.chavePix || '-'})\n4.3 Atraso: multa 10% + juros 1% a.m. + IGP-M.\n4.4 Reajuste anual IGP-M/IPCA.\n4.5 IPTU, condomínio, água, luz, gás, internet do LOCATÁRIO.`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('5. GARANTIA:', { underline: true }); doc.moveDown(0.3);
    doc.font('Helvetica').text(`Garantia: ${dados.garantia || 'Caução 1 mês'} - R$ ${dados.valorCaucao || dados.valor}\nFiador: ${dados.nomeFiador || 'Não há'} CPF: ${dados.cpfFiador || '-'}\nCaução devolvida em até 30 dias após entrega das chaves, descontados débitos.`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('6. OBRIGAÇÕES DO LOCATÁRIO:'); doc.moveDown(0.3);
    doc.font('Helvetica').text(`a) Pagar aluguel e encargos; b) Conservar imóvel; c) Sem modificações sem autorização; d) Permitir vistoria 24h; e) Entregar pintado, limpo, sem débitos; f) Não sublocar; g) Respeitar condomínio.`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('7. OBRIGAÇÕES DO LOCADOR:'); doc.moveDown(0.3);
    doc.font('Helvetica').text(`a) Entregar em condições de uso; b) Garantir uso pacífico; c) Pagar taxas extraordinárias; d) Fornecer recibos.`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('8. VISTORIA:'); doc.moveDown(0.3);
    doc.font('Helvetica').text(`Imóvel vistoriado em ${dataHoje}, estado: ${dados.estadoImovel || 'bom estado'}. Fotos anexas.`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('9. RESCISÃO:'); doc.moveDown(0.3);
    doc.font('Helvetica').text(`Infração, falta de pagamento, uso indevido, abandono >30 dias autorizam rescisão.`); doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('10. FORO:'); doc.moveDown(0.3);
    doc.font('Helvetica').text(`Foro de ${dados.foro || 'Contagem/MG'}.`); doc.moveDown(1.5);
    doc.text(`E por estarem justos e contratados, assinam em 2 vias.`, { align: 'center' }); doc.moveDown(1);
    doc.text(`${dados.cidade || 'Contagem'}, ${dataHoje}.`); doc.moveDown(2);
    const y = doc.y;
    doc.text(`_________________________\n${dados.nomeLocador || 'LOCADOR'}\nCPF: ${dados.cpfLocador || ''}`, 50, y, { width: 220 });
    doc.text(`_________________________\n${dados.nomeLocatario || 'LOCATÁRIO'}\nCPF: ${dados.cpfLocatario || ''}`, 300, y, { width: 220 });
    if (dados.nomeFiador) { doc.moveDown(3); doc.text(`_________________________\n${dados.nomeFiador}\nFIADOR CPF: ${dados.cpfFiador || ''}`, { align: 'center' }); }
    doc.end();
  });
}

app.post('/criar-pix', async (req, res) => {
  try {
    const dados = req.body;
    const external_reference = `contrato-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
    dadosPorPagamento.set(external_reference, dados);
    const preference = {
      items: [{ title: `Contrato Aluguel - ${dados.enderecoImovel?.substring(0,40) || 'Imóvel'}`, quantity: 1, unit_price: 9.99 }],
      payer: { email: dados.email || 'cliente@contratorapido.com' },
      external_reference: external_reference,
      back_urls: {
        success: `https://contrato-rapido-zzo6.onrender.com/sucesso.html?ref=${external_reference}`,
        failure: `https://contrato-rapido-zzo6.onrender.com/`,
        pending: `https://contrato-rapido-zzo6.onrender.com/`
      },
      auto_return: 'approved',
      notification_url: `https://contrato-rapido-zzo6.onrender.com/webhook`
    };
    const result = await mercadopago.preferences.create(preference);
    res.json({ id: result.body.id, init_point: result.body.init_point, external_reference: external_reference });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment') {
      const payment = await mercadopago.payment.findById(data.id);
      if (payment.body.status === 'approved') {
        pagamentosAprovados.add(payment.body.external_reference);
        console.log('PAGAMENTO APROVADO:', payment.body.external_reference);
      }
    }
    res.sendStatus(200);
  } catch (e) { res.sendStatus(200); }
});

app.get('/verificar-pagamento/:ref', async (req, res) => {
  try {
    const { ref } = req.params;
    if (pagamentosAprovados.has(ref)) return res.json({ pago: true });
    const search = await mercadopago.payment.search({ qs: { 'external_reference': ref } });
    if (search.body.results?.find(p => p.status === 'approved')) {
      pagamentosAprovados.add(ref);
      return res.json({ pago: true });
    }
    res.json({ pago: false });
  } catch { res.json({ pago: false }); }
});

app.post('/gerar-pdf/:ref', async (req, res) => {
  try {
    const { ref } = req.params;
    if (!pagamentosAprovados.has(ref)) {
      try {
        const search = await mercadopago.payment.search({ qs: { 'external_reference': ref } });
        if (!search.body.results?.find(p => p.status === 'approved')) {
          return res.status(402).json({ error: 'Pagamento não confirmado. Pague o PIX.' });
        }
        pagamentosAprovados.add(ref);
      } catch { return res.status(402).json({ error: 'Pagamento não confirmado.' }); }
    }
    const dadosSalvos = dadosPorPagamento.get(ref) || req.body;
    dadosSalvos.paymentId = ref;
    const pdfBuffer = await gerarPDFContrato(dadosSalvos);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename=contrato-aluguel-${Date.now()}.pdf` });
    res.send(pdfBuffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sucesso.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'sucesso.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Rodando porta ' + PORT + ' - MODO PAGO'));
