
const express = require('express');
const mercadopago = require('mercadopago');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
console.log('TOKEN:', MP_TOKEN ? MP_TOKEN.substring(0,20)+'...' : 'NENHUM');

if (MP_TOKEN) mercadopago.configure({ access_token: MP_TOKEN });

const pagos = new Set();
const dadosMap = new Map();

function gerarPDF(dados, doc){
  doc.fontSize(16).text('CONTRATO DE LOCACAO RESIDENCIAL', {align:'center'});
  doc.moveDown();
  doc.fontSize(11).text(`LOCADOR: ${dados.nomeLocador||''} CPF: ${dados.cpfLocador||''}`);
  doc.text(`LOCATARIO: ${dados.nomeLocatario||''} CPF: ${dados.cpfLocatario||''} EMAIL: ${dados.emailLocatario||''}`);
  doc.moveDown();
  doc.text(`IMOVEL: ${dados.enderecoImovel||''} Tipo: ${dados.tipoImovel||''}`);
  doc.text(`VALOR: R$ ${dados.valorAluguel||''} Venc: ${dados.vencimento||''} PRAZO: ${dados.prazoMeses||''} meses`);
  doc.text(`INICIO: ${dados.dataInicio||''} GARANTIA: ${dados.garantia||''}`);
  doc.text(`CIDADE/FORO: ${dados.cidade||''}/${dados.foro||''}`);
  doc.moveDown(2);
  doc.text('Assinaturas: ________________________  ________________________');
  doc.end();
}

// NOVA ROTA PIX DIRETO - NAO VAI PRO SITE DO MP, GERA QR AQUI MESMO
app.post('/criar-pagamento', async (req, res) => {
  try {
    if(!MP_TOKEN) return res.status(500).json({error:'Token MP nao configurado'});
    
    const ref = 'contrato-'+Date.now();
    dadosMap.set(ref, req.body);
    console.log('Criando PIX direto:', ref);

    const cpfLimpo = (req.body.cpfLocatario||'11144477735').replace(/\D/g,'');
    const email = req.body.emailLocatario || 'cliente@email.com';

    const payment_data = {
      transaction_amount: 9.99,
      description: 'Contrato Aluguel - 10 clausulas',
      payment_method_id: 'pix',
      external_reference: ref,
      payer: {
        email: email,
        first_name: req.body.nomeLocatario?.split(' ')[0] || 'Cliente',
        last_name: req.body.nomeLocatario?.split(' ').slice(1).join(' ') || 'Teste',
        identification: { type: 'CPF', number: cpfLimpo }
      },
      notification_url: `https://${req.headers.host}/webhook`
    };

    const result = await mercadopago.payment.create(payment_data);
    const data = result.body;

    console.log('PIX criado:', data.id, data.status);

    res.json({
      id: data.id,
      external_reference: ref,
      status: data.status,
      qr_code: data.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
      ticket_url: data.point_of_interaction?.transaction_data?.ticket_url
    });

  } catch(e){
    console.error('ERRO PIX:', e.message, e.cause);
    res.status(500).json({error: e.message, details: e.cause});
  }
});

app.get('/verificar-pagamento/:ref', async (req,res)=>{
  const ref = req.params.ref;
  try{
    if(pagos.has(ref)) return res.json({pago:true});
    
    // Busca todos pagamentos com essa ref
    const search = await mercadopago.payment.search({qs:{external_reference:ref}});
    const ok = search.body.results?.find(p=>p.status==='approved');
    if(ok){ pagos.add(ref); return res.json({pago:true}); }
    
    res.json({pago:false});
  }catch(e){ res.json({pago:false}); }
});

app.post('/gerar-pdf/:ref', async (req,res)=>{
  const ref = req.params.ref || req.body.external_reference;
  if(!ref) return res.status(402).json({error:'Sem ref'});
  
  let pago = pagos.has(ref);
  if(!pago){
    try{
      const search = await mercadopago.payment.search({qs:{external_reference:ref}});
      const ok = search.body.results?.find(p=>p.status==='approved');
      if(ok){ pago=true; pagos.add(ref); }
    }catch(e){}
  }
  if(!pago) return res.status(402).json({error:'Pagamento nao confirmado ainda'});

  const dados = dadosMap.get(ref) || req.body;
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename=contrato-${ref}.pdf`);
  const doc = new PDFDocument();
  doc.pipe(res);
  gerarPDF(dados, doc);
});

app.post('/webhook', async (req,res)=>{
  try{
    const id = req.body.data?.id;
    if(id){
      const p = await mercadopago.payment.findById(id);
      if(p.body.status==='approved' && p.body.external_reference){
        pagos.add(p.body.external_reference);
        console.log('✅ WEBHOOK APROVADO:', p.body.external_reference);
      }
    }
    res.sendStatus(200);
  }catch(e){ res.sendStatus(200); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Rodando na '+PORT));
