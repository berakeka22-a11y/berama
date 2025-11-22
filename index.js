// index.js - Bot pagamentos (CommonJS) - Versão corrigida e robusta
// Instalar dependências: npm i express axios openai fs path

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();

// Robust JSON parsing to avoid crashes on bad payload
app.use(express.json({
  verify: (req, res, buf) => {
    try { JSON.parse(buf); } catch (e) { req.body = {}; }
  },
  limit: '200mb'
}));

// ----------------- CONFIG (via ENV) -----------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 80;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_URL = (process.env.EVOLUTION_URL || '').replace(/\/$/, ''); // sem / final
const INSTANCIA = process.env.INSTANCIA || ''; // ex: 'bera'
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || ''; // ex: '551399...'
const ARQUIVO_LISTA = path.join(__dirname, 'lista.json');

if (!EVOLUTION_API_KEY || !EVOLUTION_URL || !INSTANCIA) {
  console.error('Faltam variáveis de ambiente: EVOLUTION_API_KEY, EVOLUTION_URL, INSTANCIA');
  // não sair aqui para permitir testes locais sem OpenAI
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ----------------- UTIL -----------------
function safeReadJson(file) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify([], null, 2));
      return [];
    }
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error('safeReadJson error:', e.message);
    return [];
  }
}

function safeWriteJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('safeWriteJson error:', e.message);
  }
}

function normalizarNome(nome) {
  if (!nome) return '';
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ----------------- EVOLUTION HELPERS -----------------
async function enviarWhats(number, text) {
  try {
    const payload = { number, text };
    await axios.post(
      `${EVOLUTION_URL}/message/sendText/${INSTANCIA}`,
      payload,
      { headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
  } catch (err) {
    console.error('Erro enviarWhats:', err.response?.data || err.message);
  }
}

// Tenta baixar base64 via rota /chat/getMedia/{INSTANCIA} - retorna base64 string ou null
async function baixarMidiaPorId(messageObj) {
  try {
    const url = `${EVOLUTION_URL}/chat/getMedia/${INSTANCIA}`;
    const resp = await axios.post(url, { message: messageObj }, {
      headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 20000
    });

    // Se a API já retorna conteúdo binário, converte para base64
    if (resp && resp.data) {
      return Buffer.from(resp.data).toString('base64');
    }
    return null;
  } catch (err) {
    console.error('Erro baixarMidiaPorId:', err.response?.status, err.response?.data?.toString?.() || err.message);
    return null;
  }
}

// ----------------- OPENAI HELPERS -----------------
async function analisarComprovante(base64Image, nomesPendentes) {
  if (!openai) {
    console.log('OpenAI não configurado — pulando análise automática.');
    return null;
  }

  try {
    const systemPrompt = `Analise o comprovante. Valor deve ser 75.00 e o nome um destes: [${nomesPendentes}]. Responda APENAS JSON: {"aprovado": boolean, "nomeEncontrado": "string ou null"}`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }
      ],
      temperature: 0,
      max_tokens: 200
    });

    const raw = response.choices[0].message.content;
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Erro analisarComprovante:', err.response?.data || err.message);
    return null;
  }
}

// ----------------- LISTA HELPERS -----------------
function carregarLista() {
  return safeReadJson(ARQUIVO_LISTA);
}
function salvarLista(lista) {
  safeWriteJson(ARQUIVO_LISTA, lista);
}

// ----------------- PROCESSAR MENSAGEM (CORE) -----------------
async function processarMensagem(payload) {
  try {
    // Normaliza vários formatos de payload vindo do webhook Evolution
    const key = payload?.key || payload?.data?.key || {};
    const remoteJid = key.remoteJid || key.from || payload?.from || null;
    const messageObj = payload?.message || payload?.data?.message || payload?.messageMessage || payload;

    // Detecta texto simples
    const texto = messageObj?.conversation || messageObj?.extendedTextMessage?.text || messageObj?.text?.body || null;
    const remetente = (key.participant || key.remoteJid || key.from || remoteJid) || null;

    if (texto) {
      await processarComando(texto, remetente, remoteJid);
      return;
    }

    // Detectar imagem: Evolution pode enviar media.data (base64) direto no webhook
    const imageField = messageObj?.imageMessage || messageObj?.image || messageObj?.media || null;

    if (!imageField) return; // nada para processar

    console.log('📥 Iniciando processamento de mídia...');

    // 1) Se o webhook já trouxe base64 (media.data or media.base64 or imageMessage.data), usa direto
    let base64 = imageField?.data || imageField?.base64 || imageField?.mediaData || null;

    // 2) Se não tiver base64, tentar baixar pela API com o objeto de message (que contém ids)
    if (!base64) {
      base64 = await baixarMidiaPorId(messageObj);
    }

    if (!base64) {
      console.log('Falha ao obter base64 da mídia. Não é possível analisar.');
      await enviarWhats(remoteJid || remetente || 'unknown', '❌ Falha ao baixar mídia do comprovante.');
      return;
    }

    // Carregar lista e nomes pendentes
    let lista = carregarLista();
    const nomesPendentes = lista.filter(p => p.status !== 'PAGO').map(p => p.nome).join(', ');
    if (!nomesPendentes) {
      console.log('Nenhum pendente na lista - não há quem validar.');
      await enviarWhats(remoteJid || remetente || 'unknown', 'Não há mensalistas pendentes na lista para validar.');
      return;
    }

    // Analisar via OpenAI
    const resultado = await analisarComprovante(base64, nomesPendentes);
    if (!resultado) {
      await enviarWhats(remoteJid || remetente || 'unknown', 'Não foi possível validar o comprovante automaticamente.');
      return;
    }

    console.log('Resultado IA:', resultado);

    if (resultado.aprovado && resultado.nomeEncontrado) {
      const nomeNorm = normalizarNome(resultado.nomeEncontrado);
      const idx = lista.findIndex(item => normalizarNome(item.nome) === nomeNorm);
      if (idx !== -1 && lista[idx].status !== 'PAGO') {
        lista[idx].status = 'PAGO';
        salvarLista(lista);
        console.log(`Atualizado ${lista[idx].nome} => PAGO`);
        await enviarWhats(remoteJid || remetente || 'unknown', `✅ Pago: ${lista[idx].nome}. Lista atualizada.`);
        // também enviar lista atualizada
        await enviarLista(remoteJid || remetente || 'unknown', 'Lista de Mensalistas Atualizada');
      } else {
        console.log('Nome encontrado não corresponde ou já estava pago.');
        await enviarWhats(remoteJid || remetente || 'unknown', 'Comprovante identificado, mas nome não corresponde à lista pendente ou já estava marcado como pago.');
      }
    } else {
      await enviarWhats(remoteJid || remetente || 'unknown', 'Comprovante não aprovado pela análise automática.');
    }

  } catch (err) {
    console.error('Erro processarMensagem:', err.response?.data || err.message || err);
  }
}

// Envia a lista formatada
async function enviarLista(jidDestino, titulo) {
  try {
    const lista = carregarLista();
    let msg = `📊 *${titulo}* 📊\n\n`;
    lista.forEach((p, i) => {
      const icone = p.status === 'PAGO' ? '✅' : '⏳';
      msg += `${i + 1}. ${p.nome} ${icone}\n`;
    });
    msg += `\n---\n💳 PIX: sagradoresenha@gmail.com\nRef: Mauricio Carvalho`;
    await enviarWhats(jidDestino, msg);
  } catch (e) {
    console.error('Erro enviarLista:', e.message || e);
  }
}

// ----------------- COMANDOS -----------------
async function processarComando(texto, remetente, remoteJid) {
  try {
    const numeroRemetente = (remetente || '').split('@')[0];

    const cmd = (texto || '').trim().toLowerCase();

    if (cmd === '!resetar') {
      if (numeroRemetente !== ADMIN_NUMBER) {
        await enviarWhats(remoteJid || remetente || numeroRemetente, 'Você não tem permissão para resetar a lista.');
        return;
      }
      let lista = carregarLista();
      lista.forEach(p => p.status = 'PENDENTE');
      salvarLista(lista);
      await enviarLista(remoteJid || remetente || numeroRemetente, 'Lista Resetada');
      return;
    }

    if (cmd === 'lista' || cmd === '/lista') {
      await enviarLista(remoteJid || remetente || numeroRemetente, 'Lista Atual');
      return;
    }

    // Outros comandos simples
    if (cmd === 'ajuda' || cmd === 'help') {
      await enviarWhats(remoteJid || remetente || numeroRemetente, 'Comandos: lista, !resetar (admin), ajuda');
      return;
    }

    // padrão: ignorar
  } catch (err) {
    console.error('Erro processarComando:', err.message || err);
  }
}

// ----------------- WEBHOOK ROUTE -----------------
app.post('/webhook', (req, res) => {
  try {
    const body = req.body || {};

    // Evolution pode enviar formats variados: try to normalize
    let payload = null;
    if (body.event === 'messages.upsert' && body.data) {
      payload = body.data;
    } else if (body.event) {
      payload = body;
    } else if (body.message || body.messages) {
      payload = body;
    } else {
      // nothing actionable
      return res.sendStatus(200);
    }

    // Respond immediately (Evolution expects 200 fast)
    res.sendStatus(200);

    // Process asynchronously
    processarMensagem(payload).catch(err => console.error('processarMensagem async error:', err));

  } catch (err) {
    console.error('erro webhook:', err);
    // always return 200 for Evolution to avoid retries
    return res.sendStatus(200);
  }
});

// Root
app.get('/', (req, res) => res.send('Bot de pagamentos rodando'));

// Start server
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
