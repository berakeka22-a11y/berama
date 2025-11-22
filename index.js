// index.js - Bot Pagamentos (Evolution) - CommonJS, robusto
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// ---------- CONFIG (use env vars) ----------
const PORT = process.env.PORT ? Number(process.env.PORT) : 80;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11';
const EVOLUTION_URL = (process.env.EVOLUTION_URL || 'https://tutoriaisdigitais-evolution-api.ksyx1x.easypanel.host').replace(/\/$/, '');
const INSTANCIA = process.env.INSTANCIA || 'bera';

const DB_FILE = path.join(__dirname, 'lista.json');
const MEDIA_DIR = path.join(__dirname, 'comprovantes');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ---------- UTIL ----------
function log(...args) { console.log(new Date().toISOString(), ...args); }
function readJson(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch (e) {
    log('Erro ler JSON', e.message);
    return fallback;
  }
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { log('Erro gravar JSON', e.message); }
}
function gerarNome(ext = '.jpg') { return `comp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`; }
function salvarBase64(base64, ext = '.jpg') {
  const clean = String(base64).replace(/^data:.*;base64,/, '');
  const nome = gerarNome(ext);
  const caminho = path.join(MEDIA_DIR, nome);
  fs.writeFileSync(caminho, Buffer.from(clean, 'base64'));
  return caminho;
}

// ---------- EVOLUTION HELPERS ----------
async function sendText(number, text) {
  try {
    await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCIA}`, {
      number,
      text
    }, { headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 });
    log('Enviado texto para', number);
  } catch (err) {
    log('Erro sendText:', err.response?.data || err.message);
  }
}

// Tenta baixar usando endpoint /message/downloadMedia/:instance/:messageId or /message/downloadMedia/:instance/:messageId (two formats tried)
async function baixarMedia_byId(messageId) {
  try {
    const url = `${EVOLUTION_URL}/message/downloadMedia/${INSTANCIA}/${messageId}`;
    const res = await axios.get(url, { headers: { apikey: EVOLUTION_API_KEY }, responseType: 'arraybuffer', timeout: 20000 });
    if (res && res.data) return Buffer.from(res.data).toString('base64');
    return null;
  } catch (err) {
    log('baixarMedia_byId erro:', err.response?.status, err.response?.data || err.message);
    return null;
  }
}

// Alguns Evolution exigem /chat/getMedia passando whole message
async function baixarMedia_getMedia(messageObject) {
  try {
    const url = `${EVOLUTION_URL}/chat/getMedia/${INSTANCIA}`;
    const resp = await axios.post(url, { message: messageObject }, {
      headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 20000
    });
    if (resp && resp.data) return Buffer.from(resp.data).toString('base64');
    return null;
  } catch (err) {
    log('baixarMedia_getMedia erro:', err.response?.status, err.response?.data || err.message);
    return null;
  }
}

// ---------- EXTRACTION HELPERS ----------
function findBase64(msg) {
  if (!msg) return null;
  // Common Evolution shapes
  if (msg.imageMessage) {
    if (typeof msg.imageMessage.base64 === 'string' && msg.imageMessage.base64.length > 50) return msg.imageMessage.base64;
    if (typeof msg.imageMessage.jpegThumbnail === 'string' && msg.imageMessage.jpegThumbnail.length > 50) return msg.imageMessage.jpegThumbnail;
  }
  if (msg.message && msg.message.imageMessage) {
    const im = msg.message.imageMessage;
    if (im.base64) return im.base64;
    if (im.jpegThumbnail) return im.jpegThumbnail;
  }
  if (msg.media && typeof msg.media.data === 'string') return msg.media.data;
  if (msg.base64 && typeof msg.base64 === 'string') return msg.base64;
  // fallback null
  return null;
}
function findMessageId(msg) {
  if (!msg) return null;
  if (msg.id) return msg.id;
  if (msg.messageId) return msg.messageId;
  if (msg.imageMessage && msg.imageMessage.id) return msg.imageMessage.id;
  if (msg.message && msg.message.imageMessage && msg.message.imageMessage.id) return msg.message.imageMessage.id;
  if (msg.media && msg.media.id) return msg.media.id;
  return null;
}

// ---------- PROCESS MESSAGE ----------
async function processSingleMessage(msg) {
  try {
    // Log compact
    try { log('MSG (short):', JSON.stringify(msg).slice(0, 800)); } catch(e){}

    // determine sender
    const from = msg.from || msg.key?.remoteJid || msg.key?.participant || msg.participant || (msg.message && (msg.message.key?.remoteJid || msg.message.key?.participant)) || 'unknown';

    // try find base64 embedded
    let base64 = findBase64(msg) || findBase64(msg.message);

    // if not present, try download strategies
    if (!base64) {
      log('base64 não embutido. tentando baixar via API...');
      // 1) try getMedia (pass whole message)
      const attempt1 = await baixarMedia_getMedia(msg.message || msg).catch(()=>null);
      if (attempt1) base64 = attempt1;
      // 2) try by id
      if (!base64) {
        const mid = findMessageId(msg) || findMessageId(msg.message);
        if (mid) {
          const attempt2 = await baixarMedia_byId(mid).catch(()=>null);
          if (attempt2) base64 = attempt2;
        }
      }
    }

    if (!base64) {
      log('Não foi possível obter base64 da mensagem. Enviando erro ao usuário.');
      await sendText(from, 'Erro ao processar comprovante: não foi possível obter a imagem.');
      return;
    }

    // save file
    const ext = (String(msg.mimetype || msg.message?.mimetype || '').includes('pdf')) ? '.pdf' : '.jpg';
    const filePath = salvarBase64ToFile(base64, ext);
    log('Arquivo salvo em:', filePath);

    // update lista.json
    const lista = readJson(DB_FILE, []);
    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      numero: from,
      arquivo: filePath,
      data: new Date().toISOString(),
      status: 'PENDENTE'
    };
    lista.push(entry);
    writeJson(DB_FILE, lista);

    // reply user
    await sendText(from, 'Comprovante recebido e salvo. Obrigado!');
    log('Processamento finalizado para', from);
  } catch (err) {
    log('processSingleMessage erro:', err && (err.response?.data || err.message || err));
  }
}

function salvarBase64ToFile(base64, ext = '.jpg') {
  return salvarBase64(base64, ext);
}

// ---------- WEBHOOK ----------
app.post('/webhook', async (req, res) => {
  try {
    log('📩 WEBHOOK RECEBIDO (raw):');
    try { console.log(JSON.stringify(req.body, null, 2).slice(0, 4000)); } catch(e){ console.log('[cannot stringify]'); }

    // Normalizar mensagens: Evolution pode enviar data / messages upsert / etc.
    let messages = [];
    if (req.body && req.body.event && req.body.data) {
      const d = req.body.data;
      if (Array.isArray(d.messages)) messages = d.messages;
      else if (d.message) messages = [d.message];
      else messages = [d];
    } else if (Array.isArray(req.body.messages)) messages = req.body.messages;
    else if (req.body.message) messages = [req.body.message];
    else if (req.body.data && Array.isArray(req.body.data)) messages = req.body.data;
    else messages = [req.body];

    // respond fast
    res.sendStatus(200);

    for (const m of messages) {
      processSingleMessage(m).catch(e => log('processSingleMessage uncaught:', e && e.message));
    }
  } catch (err) {
    log('Erro webhook:', err && err.message);
    try { res.sendStatus(200); } catch(e){}
  }
});

app.get('/', (req, res) => res.send('Bot Pagamentos - Evolution - Online'));
app.listen(PORT, () => log('Servidor rodando na porta', PORT, 'INSTANCIA=', INSTANCIA, 'EVOLUTION_URL=', EVOLUTION_URL));
