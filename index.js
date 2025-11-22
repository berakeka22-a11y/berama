// index.js - Bot pagamentos (versão completa, robusta)
// --------------------------------------------------
// Requisitos: axios, openai (v4+), express, fs
// Variáveis de ambiente obrigatórias:
// OPENAI_API_KEY, EVOLUTION_API_KEY, EVOLUTION_URL, INSTANCIA, ADMIN_NUMBER
// --------------------------------------------------

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();

// Robust JSON parsing: se payload inválido, não quebra o servidor
app.use(express.json({
  verify: (req, res, buf) => {
    try { JSON.parse(buf); } catch { req.body = {}; }
  },
  limit: '50mb'
}));

// ----------------- CONFIG -----------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 80;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_URL = (process.env.EVOLUTION_URL || '').replace(/\/$/, ''); // remove slash final
const INSTANCIA = process.env.INSTANCIA || '';
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '';
const ARQUIVO_LISTA = path.join(__dirname, 'lista.json');

if (!OPENAI_API_KEY || !EVOLUTION_API_KEY || !EVOLUTION_URL || !INSTANCIA || !ADMIN_NUMBER) {
  console.error('ERRO: Variáveis de ambiente não definidas (OPENAI_API_KEY, EVOLUTION_API_KEY, EVOLUTION_URL, INSTANCIA, ADMIN_NUMBER)');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ----------------- UTIL -----------------
function normalizarNome(nome) {
  if (!nome) return '';
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function carregarLista() {
  try {
    if (!fs.existsSync(ARQUIVO_LISTA)) {
      fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify([], null, 2));
      return [];
    }
    const raw = fs.readFileSync(ARQUIVO_LISTA, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Erro carregarLista:', e.message);
    return [];
  }
}

function salvarLista(lista) {
  try {
    fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));
  } catch (e) {
    console.error('Erro salvarLista:', e.message);
  }
}

// ----------------- EVOLUTION HELPERS -----------------
async function enviarWhats(jidDestino, texto) {
  try {
    const payload = { number: jidDestino, text: texto };
    await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCIA}`, payload, {
      headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
      timeout: 15000
    });
  } catch (err) {
    console.error('Erro ao enviar mensagem via Evolution:', err.response?.data || err.message);
  }
}

// Baixar mídia da Evolution: rota /chat/getMedia/{INSTANCIA}
async function baixarMidiaEvolution(dataMessage) {
  try {
    const url = `${EVOLUTION_URL}/chat/getMedia/${INSTANCIA}`;
    const resp = await axios.post(url, { message: dataMessage }, {
      headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 20000
    });

    // Retorna base64
    return Buffer.from(resp.data).toString('base64');
  } catch (err) {
    console.error('Erro baixarMidiaEvolution:', err.response?.status, err.response?.data?.toString?.() || err.message);
    return null;
  }
}

// ----------------- OPENAI HELPERS -----------------
async function analisarComprovanteBase64(base64Image, nomesPendentes) {
  try {
    // Mensagem pedindo resposta JSON com aprovado/nomeEncontrado
    const systemPrompt = `Analise o comprovante. Valor deve ser 75.00 e o nome um destes: [${nomesPendentes}]. Responda APENAS JSON: {"aprovado": boolean, "nomeEncontrado": "string ou null"}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }
      ],
      max_tokens: 200,
      temperature: 0
    });

    const raw = response.choices[0].message.content;
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Erro analisarComprovanteBase64:', err.response?.data || err.message);
    return null;
  }
}

// ----------------- PROCESSAMENTO DE MENSAGENS -----------------
async function processarMensagem(payload) {
  try {
    // payload é o objeto que vem do webhook (eventos da Evolution)
    // Observação: Evolution pode enviar variações. Normalizamos aqui.
    const remoteJid = payload.key?.remoteJid || payload.data?.key?.remoteJid || payload.key?.from || null;
    const dataMessage = payload.message || payload.data?.message || payload.messageMessage || payload.data?.messageMessage || payload; // tentativa robusta

    // Identificar tipo
    const tipo = payload.messageType || payload.type || (dataMessage?.imageMessage ? 'imageMessage' : (dataMessage?.conversation ? 'conversation' : null));

    // Se for texto (comando)
    const textoMensagem = dataMessage?.conversation || dataMessage?.extendedTextMessage?.text || dataMessage?.text?.body || null;
    if (textoMensagem) {
      await processarComando(textoMensagem, payload.key?.participant || payload.key?.remoteJid || payload.key?.from || remoteJid, remoteJid);
      return;
    }

    if (tipo !== 'imageMessage' && !dataMessage?.imageMessage) {
      // ignorar outros tipos por enquanto
      return;
    }

    console.log('📥 Iniciando processamento de imagem...');

    // Baixar mídia (usa o objeto original da message conforme Evolution exige)
    const base64 = await baixarMidiaEvolution(dataMessage);
    if (!base64) {
      console.log('Falha ao baixar mídia - abortando processamento da imagem.');
      return;
    }

    // Carregar lista e nomes pendentes
    let lista = carregarLista();
    const nomesPendentes = lista.filter(p => p.status !== 'PAGO').map(p => p.nome).join(', ');
    if (!nomesPendentes) {
      console.log('Nenhum pendente encontrado na lista - nada a validar.');
      return;
    }

    // Enviar para OpenAI analisar
    const resultado = await analisarComprovanteBase64(base64, nomesPendentes);
    if (!resultado) {
      console.log('Sem resultado da OpenAI.');
      return;
    }

    console.log('Resultado OpenAI:', resultado);

    if (resultado.aprovado && resultado.nomeEncontrado) {
      const nomeAj = normalizarNome(resultado.nomeEncontrado);
      const idx = lista.findIndex(item => normalizarNome(item.nome) === nomeAj);
      if (idx !== -1 && lista[idx].status !== 'PAGO') {
        lista[idx].status = 'PAGO';
        salvarLista(lista);
        console.log(`💾 Atualizado: ${lista[idx].nome} => PAGO`);
        await formatarEEnviarLista(remoteJid || (payload.key?.remoteJid || 'unknown'), 'Lista de Mensalistas Atualizada');
      } else {
        console.log('Nome encontrado não corresponde à lista pendente ou já estava pago.');
      }
    } else {
      console.log('Comprovante não aprovado pela OpenAI.');
    }

  } catch (err) {
    console.error('Erro no processarMensagem:', err.response?.data || err.message || err);
  }
}

async function processarComando(comando, remetente, remoteJid) {
  try {
    const numeroRemetente = (remetente || '').split('@')[0];

    if (comando.trim().toLowerCase() === '!resetar') {
      if (numeroRemetente !== ADMIN_NUMBER) {
        console.log(`Comando !resetar rejeitado de ${numeroRemetente}`);
        return;
      }

      let lista = carregarLista();
      lista.forEach(p => p.status = 'PENDENTE');
      salvarLista(lista);
      await formatarEEnviarLista(remoteJid, 'Lista de Pagamentos Resetada para o Novo Mês');
      return;
    }

    // Outros comandos simples: /lista ou lista
    if (comando.trim().toLowerCase().includes('lista')) {
      await formatarEEnviarLista(remoteJid, 'Lista Atual');
      return;
    }

  } catch (err) {
    console.error('Erro processarComando:', err.message || err);
  }
}

async function formatarEEnviarLista(jidDestino, titulo) {
  try {
    const lista = carregarLista();
    let mensagem = `📊 *${titulo}* 📊\n\n`;
    lista.forEach((p, i) => {
      const icone = p.status === 'PAGO' ? '✅' : '⏳';
      mensagem += `${i + 1}. ${p.nome} ${icone}\n`;
    });
    mensagem += `\n---\n💳 *PIX:* sagradoresenha@gmail.com\nReferência: Mauricio Carvalho`;
    await enviarWhats(jidDestino, mensagem);
  } catch (err) {
    console.error('Erro formatarEEnviarLista:', err.message);
  }
}

// ----------------- WEBHOOK (rota que a Evolution deve apontar) -----------------
app.post('/webhook', (req, res) => {
  try {
    const body = req.body || {};
    // Normalização: event pode ser messages.upsert, messages.update etc
    // Evolution envia vários formatos; tentamos extrair o payload útil
    let payload = null;

    if (body.event === 'messages.upsert' && body.data) {
      payload = body.data;
    } else if (body.event === 'message' || body.event === 'messages') {
      payload = body;
    } else if (body.message || body.data?.message) {
      payload = body;
    } else {
      // nothing to do
      return res.sendStatus(200);
    }

    // Processar assincronamente (responde 200 à Evolution imediatamente)
    processarMensagem(payload).catch(err => console.error('Erro async processarMensagem:', err));
    return res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook:', err);
    return res.sendStatus(200); // sempre responder 200 para Evolution
  }
});

// rota raiz para testar se o processo está vivo
app.get('/', (req, res) => {
  res.send('Bot de pagamentos (rodando) — porta ' + PORT);
});

// ----------------- INICIAR SERVIDOR -----------------
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
