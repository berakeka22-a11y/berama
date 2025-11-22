// index.js - Bot Pagamentos (completo, robusto, CommonJS)
// Copiar e colar inteiro no EasyPanel -> salvar -> reiniciar
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// -------------------- CONFIG --------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 80;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11';
const EVOLUTION_URL = (process.env.EVOLUTION_URL || 'https://tutoriaisdigitais-evolution-api.ksyx1x.easypanel.host').replace(/\/$/, '');
const INSTANCIA = process.env.INSTANCIA || 'bera';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''; // opcional

const LISTA_FILE = path.join(__dirname, 'lista.json');
const MEDIA_DIR = path.join(__dirname, 'comprovantes');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// -------------------- UTIL --------------------
function log(...args) { console.log(new Date().toISOString(), ...args); }

function readLista() {
  try {
    if (!fs.existsSync(LISTA_FILE)) {
      fs.writeFileSync(LISTA_FILE, JSON.stringify([
        /* exemplo: { "nome":"Alex", "status":"PAGO" } */
      ], null, 2));
    }
    return JSON.parse(fs.readFileSync(LISTA_FILE, 'utf8') || '[]');
  } catch (e) {
    log('Erro ler lista:', e.message);
    return [];
  }
}

function writeLista(lista) {
  try {
    fs.writeFileSync(LISTA_FILE, JSON.stringify(lista, null, 2));
  } catch (e) {
    log('Erro gravar lista:', e.message);
  }
}

function gerarNomeArquivo(ext = '.jpg') {
  return `comprovante_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
}

function salvarBase64EmArquivo(base64, ext = '.jpg') {
  const clean = base64.replace(/^data:.*;base64,/, '');
  const fname = gerarNomeArquivo(ext);
  const fpath = path.join(MEDIA_DIR, fname);
  fs.writeFileSync(fpath, Buffer.from(clean, 'base64'));
  return fpath;
}

function normalizarNome(nome) {
  if (!nome) return '';
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// -------------------- EVOLUTION HELPERS --------------------
async function sendText(number, text) {
  try {
    await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCIA}`, {
      number,
      text
    }, {
      headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    log('enviado ->', number, text.slice(0, 100));
  } catch (err) {
    log('Erro sendText:', err.response?.data || err.message);
  }
}

// Tentativa 1: rota getMedia/chat (usa payload.message) - conforme algumas instâncias
async function baixarMedia_getMedia(messageObject) {
  try {
    const url = `${EVOLUTION_URL}/chat/getMedia/${INSTANCIA}`;
    const resp = await axios.post(url, { message: messageObject }, {
      headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 20000
    });
    if (resp && resp.data) {
      return Buffer.from(resp.data).toString('base64');
    }
    return null;
  } catch (err) {
    log('baixarMedia_getMedia erro:', err.response?.status, err.response?.data || err.message);
    return null;
  }
}

// Tentativa 2: rota downloadMedia by id (algumas instâncias implementam)
// expects messageId string
async function baixarMedia_byId(messageId) {
  try {
    const url = `${EVOLUTION_URL}/message/downloadMedia/${INSTANCIA}/${messageId}`;
    const resp = await axios.get(url, {
      headers: { apikey: EVOLUTION_API_KEY },
      responseType: 'arraybuffer',
      timeout: 20000
    });
    if (resp && resp.data) return Buffer.from(resp.data).toString('base64');
    return null;
  } catch (err) {
    log('baixarMedia_byId erro:', err.response?.status, err.response?.data || err.message);
    return null;
  }
}

// -------------------- OPENAI (opcional) --------------------
async function analisarComprovanteOpenAI(base64, nomesPendentes) {
  if (!OPENAI_API_KEY) return null;
  try {
    // chamada via API REST simples (sem sdk) para ser compatível
    const payload = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `Analise o comprovante. Valor deve ser 75.00 e o nome um destes: [${nomesPendentes}]. Responda APENAS JSON: {"aprovado": boolean, "nomeEncontrado": "string ou null"}` },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }] }
      ],
      max_tokens: 200,
      temperature: 0
    };
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    const raw = resp.data?.choices?.[0]?.message?.content || resp.data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const cleaned = String(raw).replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    log('Erro OpenAI:', err.response?.data || err.message);
    return null;
  }
}

// -------------------- EXTRACTION HELPERS --------------------
function extractMessagesFromWebhook(body) {
  // Support many shapes: body.event/messages.upsert, body.data, body.messages array, etc.
  // Return array of message objects in a normalized form.
  try {
    if (!body) return [];
    // Evolution common: { event: 'messages.upsert', data: { ... } } where data may be a message or messages
    if (body.event && body.data) {
      // data might contain messages array or single message
      const d = body.data;
      if (Array.isArray(d.messages)) return d.messages;
      // older shapes: data.message or data
      if (d.message) return [d.message];
      return [d];
    }
    // If body.messages array
    if (Array.isArray(body.messages)) return body.messages;
    // If body.message single
    if (body.message) return [body.message];
    // If body.data is array
    if (Array.isArray(body.data)) return body.data;
    // fallback: treat body as single message
    return [body];
  } catch (e) {
    log('extractMessages error:', e.message);
    return [];
  }
}

function findBase64InMessage(msg) {
  // Check many possible fields for embedded base64
  if (!msg) return null;
  // common Evolution: msg.imageMessage.base64 or msg.imageMessage.jpegThumbnail (small)
  if (msg.imageMessage) {
    if (typeof msg.imageMessage.base64 === 'string' && msg.imageMessage.base64.length > 100) return msg.imageMessage.base64;
    if (typeof msg.imageMessage.jpegThumbnail === 'string' && msg.imageMessage.jpegThumbnail.length > 50) {
      // jpegThumbnail sometimes is small; still usable if nothing else
      return msg.imageMessage.jpegThumbnail;
    }
  }
  // other shapes
  if (msg.media && typeof msg.media.data === 'string' && msg.media.data.length > 50) return msg.media.data;
  if (msg.mediaData && typeof msg.mediaData === 'string' && msg.mediaData.length > 50) return msg.mediaData;
  if (msg.base64 && typeof msg.base64 === 'string' && msg.base64.length > 50) return msg.base64;
  // maybe nested: msg.message.imageMessage
  if (msg.message && msg.message.imageMessage) {
    const im = msg.message.imageMessage;
    if (im.base64) return im.base64;
    if (im.jpegThumbnail) return im.jpegThumbnail;
  }
  return null;
}

function findMessageId(msg) {
  // possible places for id/mediaId
  if (!msg) return null;
  if (msg.id) return msg.id;
  if (msg.messageId) return msg.messageId;
  if (msg.media && msg.media.id) return msg.media.id;
  if (msg.imageMessage && msg.imageMessage.id) return msg.imageMessage.id;
  if (msg.imageMessage && msg.imageMessage.mediaKey) return msg.imageMessage.mediaKey;
  if (msg.message && msg.message.imageMessage && msg.message.imageMessage.id) return msg.message.imageMessage.id;
  if (msg.data && msg.data.id) return msg.data.id;
  return null;
}

// -------------------- CORE PROCESS --------------------
async function handleSingleMessage(msgRaw) {
  try {
    log('RAW MESSAGE (short):', JSON.stringify(msgRaw, (k, v) => (k === 'binary' ? '[binary]' : v), 2).slice(0, 1000));

    // Try to locate sender number
    const from = msgRaw.from || msgRaw.key?.remoteJid || msgRaw.key?.participant || (msgRaw.message && (msgRaw.message.key?.remoteJid || msgRaw.message.key?.participant)) || 'unknown';

    // Try to locate pushName
    const pushName = msgRaw.pushName || msgRaw.senderName || msgRaw.message?.pushName || null;

    // Attempt to find base64 embedded
    let base64 = findBase64InMessage(msgRaw) || findBase64InMessage(msgRaw.message);

    // If no base64, try to download using message object or id
    if (!base64) {
      log('base64 não encontrado embutido - tentando baixar pela API');
      // prefer passing the full message object if present (some instances require this)
      const messageObj = msgRaw.message || msgRaw;
      base64 = await baixarMedia_getMedia(messageObj);
      if (!base64) {
        const mid = findMessageId(msgRaw) || findMessageId(msgRaw.message);
        if (mid) {
          base64 = await baixarMedia_byId(mid);
        }
      }
    }

    if (!base64) {
      log('Falha: não foi possível obter base64 para a mensagem', findMessageId(msgRaw));
      await sendText(from, '❌ Falha ao processar o comprovante: não foi possível baixar a mídia.');
      return;
    }

    // save file
    const ext = (msgRaw.mimetype && msgRaw.mimetype.includes('pdf')) ? '.pdf' : '.jpg';
    const savedPath = salvarBase64EmArquivo(base64, ext);
    log('Arquivo salvo em:', savedPath);

    // update lista.json: add entry (basic)
    const lista = readLista();
    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      numero: from,
      nome: pushName || null,
      arquivo: savedPath,
      data: new Date().toISOString(),
      status: 'PENDENTE'
    };

    // If OPENAI configured, try to analyze and mark PAGO if matches
    if (OPENAI_API_KEY) {
      const nomesPendentes = lista.filter(p => p.status !== 'PAGO').map(p => p.nome).filter(Boolean).join(', ');
      if (nomesPendentes) {
        const analise = await analisarComprovante(base64, nomesPendentes).catch(e => { log('openai err', e && e.message); return null; });
        if (analise && analise.aprovado && analise.nomeEncontrado) {
          // find match in lista and mark PAGO
          const nomeNorm = normalizarNome(analise.nomeEncontrado);
          const idx = lista.findIndex(it => normalizarNome(it.nome || '') === nomeNorm);
          if (idx !== -1) {
            lista[idx].status = 'PAGO';
            log(`Atualizado via IA: ${lista[idx].nome} => PAGO`);
            // add audit entry linking to file
            entry.status = 'PAGO (IA)';
            entry.nomeReconhecido = lista[idx].nome;
            writeLista(lista);
            await sendText(from, `✅ Comprovante aprovado. ${lista[idx].nome} marcado como PAGO.`);
          } else {
            // no exact match, just push entry
            lista.push(entry);
            writeLista(lista);
            await sendText(from, 'Comprovante recebido — não localizei correspondência exata na lista.');
          }
        } else {
          lista.push(entry);
          writeLista(lista);
          await sendText(from, 'Comprovante recebido — análise automática não aprovou.');
        }
      } else {
        lista.push(entry);
        writeLista(lista);
        await sendText(from, 'Comprovante recebido e salvo. (Sem nomes pendentes para análise automática.)');
      }
    } else {
      // no OpenAI -> just save
      lista.push(entry);
      writeLista(lista);
      await sendText(from, 'Comprovante recebido e salvo. Obrigado.');
    }

  } catch (err) {
    log('handleSingleMessage error:', err && (err.response?.data || err.message || err));
  }
}

// -------------------- WEBHOOK ROUTE --------------------
app.post('/webhook', async (req, res) => {
  try {
    log('📩 WEBHOOK RECEBIDO (raw):');
    // log compacted but full (be careful with huge output)
    try { console.log(JSON.stringify(req.body, null, 2).slice(0, 3000)); } catch (e) { console.log('[cannot stringify]'); }

    // Normalize messages array
    const msgs = extractMessagesFromWebhook(req.body);
    if (!msgs || msgs.length === 0) {
      res.sendStatus(200);
      return;
    }

    // respond immediately
    res.sendStatus(200);

    for (const m of msgs) {
      // process each message async but not awaiting all to keep logs clear
      handleSingleMessage(m).catch(err => log('handleSingleMessage uncaught:', err && err.message));
    }

  } catch (err) {
    log('Webhook handler error:', err && err.message);
    // always return 200 to avoid retries
    try { res.sendStatus(200); } catch (e) {}
  }
});

// -------------------- ROOT --------------------
app.get('/', (req, res) => res.send('Bot pagamentos (ready)'));

// -------------------- START --------------------
app.listen(PORT, () => {
  log(`Servidor rodando na porta ${PORT}`);
  log('INSTANCIA:', INSTANCIA, 'EVOLUTION_URL:', EVOLUTION_URL);
});
