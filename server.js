const express = require('express');
const mercadopago = require('mercadopago');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
if (MP_TOKEN) mercadopago.configure({ access_token: MP_TOKEN });

const pagos = new Set();
const dadosMap = new Map();

function gerarPDFCompleto(dados, doc){
  const margem = 50;
  doc.fontSize(10);
  
  // CABEÇALHO
  doc.font('Helvetica-Bold').fontSize(16).text('CONTRATO DE LOCAÇÃO DE IMÓVEL RESIDENCIAL', {align:'center'});
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).text('Contrato regido pela Lei nº 8.245/91 (Lei do Inquilinato) com alterações da Lei nº 12.112/2009 e disposições do Código Civil/2002', {align:'center'});
  doc.moveDown(1);

  // QUALIFICAÇÃO
  doc.font('Helvetica-Bold').fontSize(11).text('DAS PARTES:');
  doc.font('Helvetica').fontSize(10);
  doc.text(`LOCADOR(A): ${dados.nomeLocador || '________________________________'}, brasileiro(a), ${dados.estadoCivilLocador||''}, portador(a) do RG ${dados.rgLocador||''} e CPF ${dados.cpfLocador||''}, residente e domiciliado em ${dados.enderecoLocador||''}.`);
  doc.moveDown(0.5);
  doc.text(`LOCATÁRIO(A): ${dados.nomeLocatario || '________________________________'}, ${dados.profissaoLocatario||''}, portador(a) do RG ${dados.rgLocatario||''} e CPF ${dados.cpfLocatario||''}, residente em ${dados.enderecoAtualLocatario||''}, e-mail: ${dados.emailLocatario||''} para fins do Art. 5º da LGPD (Lei 13.709/18).`);
  if(dados.nomeFiador){
    doc.moveDown(0.5);
    doc.text(`FIADOR(A): ${dados.nomeFiador||''}, CPF ${dados.cpfFiador||''}, nos termos do Art. 62 da Lei 8.245/91, renunciando expressamente ao benefício de ordem previsto no Art. 827 do Código Civil.`);
  }
  doc.moveDown(1);

  // CLÁUSULAS
  doc.font('Helvetica-Bold').fontSize(11).text('CLÁUSULAS E CONDIÇÕES:', {underline:true});
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10);

  doc.font('Helvetica-Bold').text('CLÁUSULA 1ª - DO OBJETO: ', {continued:true}).font('Helvetica').text(`O LOCADOR cede em locação ao LOCATÁRIO o imóvel situado em ${dados.enderecoImovel||'________________'}, do tipo ${dados.tipoImovel||''}, ${dados.mobiliado==='sim'?'MOBILIADO conforme inventário anexo (Art. 22, Lei 8.245/91)':'NÃO MOBILIADO'}, no estado de conservação ${dados.estadoImovel||'bom'}, para fins exclusivamente RESIDENCIAIS, conforme Art. 48 da Lei 8.245/91, vedada a sublocação, cessão ou empréstimo sem anuência expressa, sob pena de rescisão (Art. 13).`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 2ª - DO PRAZO - Art. 46 e 47 da Lei 8.245/91: ', {continued:true}).font('Helvetica').text(`A presente locação tem prazo determinado de ${dados.prazoMeses||'12'} meses, com início em ${dados.dataInicio||'__/__/____'} e término em ___/___/____. Findo o prazo, se o locatário permanecer por mais de 30 dias sem oposição (Art. 46, §1º), prorroga-se por prazo indeterminado, mantidas as demais cláusulas.`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 3ª - DO VALOR E REAJUSTE - Art. 18, 19 e Lei 10.406/02: ', {continued:true}).font('Helvetica').text(`O aluguel mensal é de R$ ${dados.valorAluguel||'________'} (__________________________________________________________________), a ser pago até o dia ${dados.vencimento||'05'} de cada mês, via PIX chave ${dados.chavePixLocador||''} ou depósito. Após 12 meses, será reajustado anualmente pelo índice IPCA ou IGP-M, o que for menor para o locatário, conforme Art. 18, ou na falta, pelo índice oficial. Atraso superior a 10 dias incidirá multa de 10% + juros de 1% a.m. + correção monetária (Art. 394 CC).`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 4ª - DOS ENCARGOS - Art. 22, VIII e Art. 23, XII: ', {continued:true}).font('Helvetica').text(`Além do aluguel, são de responsabilidade do LOCATÁRIO: IPTU ${dados.iptu||'a definir'}, condomínio, água, luz, gás, internet e seguro contra incêndio obrigatório (Art. 23, XI e XII). O LOCADOR responde por despesas extraordinárias de condomínio (Art. 22, X, parágrafo único) e taxa de corretagem. O não pagamento de encargos por 2 meses autoriza rescisão.`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 5ª - DA GARANTIA - Art. 37, 38, 39 e 40 da Lei 8.245/91 (Redação Lei 12.112/09): ', {continued:true}).font('Helvetica').text(`Como garantia, as partes elegem: ${dados.garantia||'CAUÇÃO'}. ${dados.garantia==='caução' && dados.valorCaucao ? `Valor da caução: R$ ${dados.valorCaucao} equivalente a até 3 aluguéis (Art. 38, §1º), a ser depositada em conta poupança e devolvida ao final com correção, deduzidos débitos. ` : ''}${dados.garantia==='fiador' ? `Fiador qualificado acima, com responsabilidade solidária até efetiva entrega das chaves, conforme Art. 39. ` : ''}É vedada mais de uma garantia no mesmo contrato (Art. 37, parágrafo único), sob pena de nulidade.`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 6ª - DAS OBRIGAÇÕES - Art. 22 e 23 da Lei 8.245/91: ', {continued:true}).font('Helvetica').text(`DO LOCADOR: entregar imóvel em condições de uso, com laudo de vistoria; garantir uso pacífico; pagar taxas extraordinárias. DO LOCATÁRIO: pagar pontualmente; servir-se do imóvel para uso convencionado; levar ao conhecimento do locador perturbações de terceiros; restituir no estado que recebeu, salvo desgaste natural (Art. 23, III); permitir vistoria mediante agendamento; não modificar estrutura sem autorização (Art. 23, VI).`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 7ª - DAS BENFEITORIAS - Art. 35 e 36: ', {continued:true}).font('Helvetica').text(`Benfeitorias necessárias, mesmo não autorizadas, serão indenizáveis (Art. 35). Úteis, se autorizadas, serão indenizáveis e permitem retenção. Voluptuárias não são indenizáveis, podendo ser levantadas se não prejudicar estrutura. Qualquer obra depende de autorização por escrito.`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 8ª - DA RESCISÃO E MULTA - Art. 4º, 9º e 59: ', {continued:true}).font('Helvetica').text(`Infração legal ou contratual autoriza rescisão. Locatário pode devolver a qualquer tempo, mediante multa compensatória de 3 aluguéis proporcionais ao tempo restante, conforme Art. 4º, parágrafo único (redação Lei 12.112/09), isento se após 12 meses e com aviso prévio de 30 dias por transferência de trabalho (Art. 4º, parágrafo único). Em caso de ação de despejo (Art. 59), incidirão custas e honorários de 20%.`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 9ª - DA PROTEÇÃO DE DADOS - LGPD Lei 13.709/2018: ', {continued:true}).font('Helvetica').text(`Os dados pessoais coletados (CPF, RG, endereço, e-mail) serão usados exclusivamente para fins deste contrato, emissão de recibos, cobrança e eventual ação judicial, com base no Art. 7º, V da LGPD (execução de contrato). O LOCADOR compromete-se a não compartilhar com terceiros, salvo obrigação legal.`);
  doc.moveDown(0.7);

  doc.font('Helvetica-Bold').text('CLÁUSULA 10ª - DO FORO - Art. 58, II: ', {continued:true}).font('Helvetica').text(`Elegem o foro da comarca de ${dados.cidade||''}/${dados.foro||''} para dirimir quaisquer dúvidas, com renúncia a qualquer outro, por mais privilegiado. E por estarem justos e contratados, assinam em 2 vias de igual teor, com testemunhas.`);
  doc.moveDown(1.5);

  doc.text(`Local e Data: ${dados.cidade||'__________________'}, ___ de ________________ de 20___.`, {align:'center'});
  doc.moveDown(2);
  doc.text('___________________________________________          ___________________________________________');
  doc.text(`          ${dados.nomeLocador||'LOCADOR'}                                      ${dados.nomeLocatario||'LOCATÁRIO'}`, {align:'left'});
  if(dados.nomeFiador){
    doc.moveDown(1);
    doc.text('___________________________________________');
    doc.text(`          ${dados.nomeFiador} - FIADOR`);
  }
  doc.moveDown(1.5);
  doc.text('Testemunhas: 1) ___________________________ CPF: _______________   2) ___________________________ CPF: _______________');
  
  doc.moveDown(2);
  doc.fontSize(7).text('Documento gerado eletronicamente por Contrato-Rapido.com - Modelo jurídico conforme Lei 8.245/91 atualizada pela Lei 12.112/2009, Código Civil 2002 e LGPD. Recomenda-se reconhecimento de firma em cartório. Chave PIX de pagamento deste contrato: '+ (dados.chavePixLocador||''), {align:'center'});

  doc.end();
}

// ROTAS IGUAIS DO PIX DIRETO
app.post('/criar-pagamento', async (req, res) => {
  try {
    if(!MP_TOKEN) return res.status(500).json({error:'Token MP nao configurado'});
    const ref = 'contrato-'+Date.now();
    dadosMap.set(ref, req.body);
    const cpfLimpo = (req.body.cpfLocatario||'11144477735').replace(/\D/g,'');
    const email = req.body.emailLocatario || 'cliente@email.com';
    const payment_data = {
      transaction_amount: 9.99,
      description: 'Contrato Aluguel Completo Atualizado 2026 - 10 clausulas',
      payment_method_id: 'pix',
      external_reference: ref,
      payer: { email, first_name: req.body.nomeLocatario?.split(' ')[0] || 'Cliente', last_name: req.body.nomeLocatario?.split(' ').slice(1).join(' ') || 'Teste', identification: { type: 'CPF', number: cpfLimpo } },
      notification_url: `https://${req.headers.host}/webhook`
    };
    const result = await mercadopago.payment.create(payment_data);
    const data = result.body;
    res.json({ id: data.id, external_reference: ref, status: data.status, qr_code: data.point_of_interaction?.transaction_data?.qr_code, qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64 });
  } catch(e){ console.error(e); res.status(500).json({error: e.message}); }
});

app.get('/verificar-pagamento/:ref', async (req,res)=>{
  const ref = req.params.ref;
  try{
    if(pagos.has(ref)) return res.json({pago:true});
    const search = await mercadopago.payment.search({qs:{external_reference:ref}});
    const ok = search.body.results?.find(p=>p.status==='approved');
    if(ok){ pagos.add(ref); return res.json({pago:true}); }
    res.json({pago:false});
  }catch(e){ res.json({pago:false}); }
});

app.post('/gerar-pdf/:ref', async (req,res)=>{
  const ref = req.params.ref;
  let pago = pagos.has(ref);
  if(!pago){
    try{
      const search = await mercadopago.payment.search({qs:{external_reference:ref}});
      const ok = search.body.results?.find(p=>p.status==='approved');
      if(ok){ pago=true; pagos.add(ref); }
    }catch(e){}
  }
  if(!pago) return res.status(402).json({error:'Pagamento nao confirmado'});
  const dados = dadosMap.get(ref) || req.body;
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename=contrato-atualizado-${ref}.pdf`);
  const doc = new PDFDocument({margin:50, size:'A4'});
  doc.pipe(res);
  gerarPDFCompleto(dados, doc);
});

app.post('/webhook', async (req,res)=>{
  try{
    const id = req.body.data?.id;
    if(id){
      const p = await mercadopago.payment.findById(id);
      if(p.body.status==='approved' && p.body.external_reference) pagos.add(p.body.external_reference);
    }
    res.sendStatus(200);
  }catch(e){ res.sendStatus(200); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Rodando na '+PORT));
