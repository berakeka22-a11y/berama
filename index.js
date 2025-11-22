// index.js (CommonJS) - Bot de pagamentos UltraMSG + OpenAI
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json({ limit: '100mb' }));

/**
 * CONFIGURAÇÃO
 * - Prefira setar as variáveis no painel (Easypanel) como ENV vars.
 * - Fallbacks abaixo existem porque você mandou as credenciais na conversa.
 */
const ULTRAMSG_INSTANCE = process.env.ULTRAMSG_INSTANCE || 'instance151755';
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN || 'idyxynn5iaugvpj4';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''; // obrigatória
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '5513991194730'; // sem @c.us

const ARQUIVO_LISTA = path.resolve(__dirname, 'lista.json');

// porta (easy panel geralmente publica 80)
const PORT = process.env.PORT || 80;

// validação mínima
if (!OPENAI_API_KEY) {
  console.error('ERRO: OPENAI_API_KEY não está definida. Coloque no EasyPanel ENV.');
  // não processa webhooks se não tiver chave
}

// inicializa OpenAI e UltraMsg axios
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const ultramsgAPI = axios.create({
  baseURL: `https://api.ultramsg.com/${ULTRAMSG_INSTANCE}`,
  params: { token: ULTRAMSG_TOKEN },
  timeout: 30000,
});

// utilitários
function normalizarNome(nome) {
  if (!nome) return '';
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function carregarLista() {
  try {
    if (!fs.existsSync(ARQUIVO_LISTA)) {
      fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify([], null, 2));
    }
    const txt = fs.readFileSync(ARQUIVO_LISTA, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    console.error('Erro ao carregar lista.json:', e.message);
    return [];
  }
}

function salvarLista(lista) {
  try {
    fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));
  } catch (e) {
    console.error('Erro ao salvar lista.json:', e.message);
  }
}

async function enviarMensagemTexto(to, body) {
  try {
    console.log(`Enviando mensagem via UltraMSG para ${to} ...`);
    await ultramsgAPI.post('/messages/chat', { to, body });
    console.log('Mensagem enviada.');
  } catch (err) {
    console.error('Erro ao enviar mensagem UltraMSG:', err.response ? err.response.data : err.message);
  }
}

async function formatarEEnviarLista(destino, titulo) {
  try {
    const lista = carregarLista();
    let mensagem = `📊 *${titulo}* 📊\n\n`;
    lista.forEach((p, i) => {
      const icon = p.status === 'PAGO' ? '✅' : '⏳';
      mensagem += `${i + 1}. ${p.nome} ${icon}\n`;
    });
    mensagem += `\n---\n💳 *PIX*: sagradoresenha@gmail.com\nReferência: Mauricio Carvalho`;
    await enviarMensagemTexto(destino, mensagem);
  } catch (e) {
    console.error('Erro formatarEEnviarLista:', e.message);
  }
}

/**
 * Função que tenta extrair URL/base64 da carga do webhook do UltraMSG (vários formatos)
 * Retorna: { type:'url'|'base64'|'none', value: string|null }
 */
function extrairMediaInfo(data) {
  // adapta para diversos formatos comuns de webhook/ultramsg/evolution
  // verificamos campos que vimos nas imagens e no histórico do user
  // possibilidades: data.media, data.message.imageUrl, data.message?.image?.url, data.message?.media_url, data.data?.media, data.message?.imageMessage?.mimetype etc.
  try {
    // caso receba já URL direto (campo media / file / imageUrl)
    const tryPaths = [
      'media', // usado em nossos exemplos anteriores
      'message.imageUrl',
      'message.image_url',
      'message.imageMessage.url',
      'message.imageMessage.mimetype', // se tiver mimetype mas sem url
      'data.media',
      'data.message.imageUrl',
      'data.message.media',
    ];

    // função util de pegar safe
    const get = (obj, path) => {
      if (!obj) return undefined;
      return path.split('.').reduce((s, k) => (s && s[k] !== undefined ? s[k] : undefined), obj);
    };

    // 1) se payload vem com data.message.imageMessage (ULTRAMSG típico)
    const msg = data.data || data.message || data;
    // UltraMSG pode enviar "media" com URL direto:
    if (msg && msg.media && typeof msg.media === 'string' && msg.media.startsWith('http')) {
      return { type: 'url', value: msg.media };
    }

    // tenta campos conhecidos
    for (const p of tryPaths) {
      const v = get(msg, p);
      if (v && typeof v === 'string' && v.startsWith('http')) return { type: 'url', value: v };
    }

    // se vier base64 junto (alguns webhooks enviam base64)
    // procura por data.message.base64, data.base64, message.data
    const base64Candidates = ['message.base64', 'data.base64', 'media_base64', 'message.data'];
    for (const p of base64Candidates) {
      const v = get(msg, p);
      if (v && typeof v === 'string' && v.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 100))) {
        return { type: 'base64', value: v };
      }
    }

    // se não encontrou
    return { type: 'none', value: null };
  } catch (e) {
    console.error('erro extrairMediaInfo:', e.message);
    return { type: 'none', value: null };
  }
}

async function baixarMediaParaBase64(urlOrBase64Info) {
  try {
    if (!urlOrBase64Info) return null;
    if (urlOrBase64Info.type === 'base64') {
      // já é base64
      return urlOrBase64Info.value.replace(/^data:image\/\w+;base64,/, '');
    }
    // se for URL: baixa conteúdo e converte para base64
    if (urlOrBase64Info.type === 'url') {
      console.log('Baixando imagem de', urlOrBase64Info.value);
      const resp = await axios.get(urlOrBase64Info.value, { responseType: 'arraybuffer', timeout: 30000 });
      const b64 = Buffer.from(resp.data).toString('base64');
      return b64;
    }
    return null;
  } catch (e) {
    console.error('Erro baixarMediaParaBase64:', e.response ? e.response.data : e.message);
    return null;
  }
}

/**
 * Processa comando de texto simples (!resetar) e imagens
 * Espera payload no formato UltraMSG (data) - mas é tolerante.
 */
async function processarMensagem(data) {
  try {
    // O UltraMSG geralmente envia objeto na raiz: { data: {...} } ou só { message: {...} }.
    const payload = data.data || data.message || data;

    // Campos habituais:
    // - from (telefone com +55...)
    // - type (chat, image, audio, etc) ou messageType
    // - body (texto)
    // - media (url)
    const from = payload.from || payload.sender || payload.who || payload.author || payload.remoteJid || payload.fromNumber;
    const type = payload.type || payload.messageType || payload.event || (payload.body ? 'chat' : undefined);
    const body = payload.body || payload.text || (payload.message && payload.message.conversation) || '';

    console.log('processarMensagem -> from:', from, 'type:', type);

    // 1) Se for chat de texto -> comando
    if (String(type).toLowerCase() === 'chat' || String(type).toLowerCase() === 'text' || body) {
      const txt = String(body || '').trim();
      if (txt.toLowerCase() === '!resetar') {
        // valida admin
        const apenasNumero = String(from || '').replace(/\D/g, '');
        if (apenasNumero === ADMIN_NUMBER.replace(/\D/g, '')) {
          const lista = carregarLista();
          lista.forEach(x => (x.status = 'PENDENTE'));
          salvarLista(lista);
          await formatarEEnviarLista(from, 'Lista resetada pelo admin');
          return;
        } else {
          console.log('Comando !resetar recebido de não-admin:', from);
          await enviarMensagemTexto(from, '🔒 Você não tem permissão para executar esse comando.');
          return;
        }
      }
      // se não for comando, ignora (ou você pode implementar respostas)
      return;
    }

    // 2) se for imagem -> processar comprovante
    // detecta media info
    const mediaInfo = extrairMediaInfo(payload);
    if (mediaInfo.type === 'none') {
      console.log('Mensagem sem mídia válida (nenhuma URL/base64 encontrada).');
      return;
    }

    const base64Image = await baixarMediaParaBase64(mediaInfo);
    if (!base64Image) {
      console.log('Não foi possível obter base64 da imagem.');
      await enviarMensagemTexto(from, '❌ Não consegui baixar a imagem do comprovante. Tenta enviar novamente.');
      return;
    }

    // carrega lista e constrói prompt
    const lista = carregarLista();
    const nomesPendentes = lista.filter(x => x.status !== 'PAGO').map(x => x.nome);
    if (nomesPendentes.length === 0) {
      await enviarMensagemTexto(from, '👏 Todos já constam como PAGO. Obrigado!');
      return;
    }

    // Chamada para a OpenAI: pede JSON de saída
    if (!OPENAI_API_KEY) {
      console.log('OpenAI não configurada. Ignorando análise IA.');
      await enviarMensagemTexto(from, '⚠️ Bot sem OpenAI configurada. Só recebi a imagem.');
      return;
    }

    console.log('Enviando imagem para OpenAI para análise...');
    const promptSystem = `Você é um OCR/validador de comprovantes. Valor esperado: 75.00 (BRL). Nomes possíveis (array): [${nomesPendentes.join(', ')}]. Analise a imagem e responda APENAS UM JSON puro, nada mais, no formato:
{"aprovado": boolean, "valor": "número ou string", "nomeEncontrado": "string ou null"}
Atenção: responda somente o JSON sem texto adicional.`;

    // usa Chat Completions (compatível com a lib usada antes)
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] },
      ],
      max_tokens: 250,
      temperature: 0,
    });

    const raw = chatResponse.choices && chatResponse.choices[0] && chatResponse.choices[0].message && chatResponse.choices[0].message.content
      ? chatResponse.choices[0].message.content
      : null;

    if (!raw) {
      console.log('Resposta da OpenAI vazia.');
      await enviarMensagemTexto(from, '⚠️ Não consegui analisar o comprovante. Tenta novamente por favor.');
      return;
    }

    // limpa code fences e tenta parse
    const cleaned = String(raw).replace(/```json|```/g, '').trim();
    let resultado;
    try {
      resultado = JSON.parse(cleaned);
    } catch (e) {
      console.log('Falha ao parsear JSON da OpenAI. Conteúdo recebido:', cleaned);
      await enviarMensagemTexto(from, '⚠️ Não consegui entender a resposta automática do OCR. Tenta enviar melhor a imagem.');
      return;
    }

    console.log('Resultado IA:', resultado);

    // Se aprovado e nome encontrado, atualiza lista
    if (resultado.aprovado && resultado.nomeEncontrado) {
      const nomeNorm = normalizarNome(resultado.nomeEncontrado);
      const idx = lista.findIndex(x => normalizarNome(x.nome) === nomeNorm);
      if (idx !== -1) {
        if (lista[idx].status !== 'PAGO') {
          lista[idx].status = 'PAGO';
          salvarLista(lista);
          await enviarMensagemTexto(from, `✅ Pagamento confirmado para *${lista[idx].nome}*. Obrigado!`);
          await formatarEEnviarLista(from, 'Lista Atualizada');
        } else {
          await enviarMensagemTexto(from, `ℹ️ O nome ${lista[idx].nome} já consta como PAGO.`);
        }
        return;
      } else {
        // nome informado pela IA não consta na lista
        await enviarMensagemTexto(from, `❌ Nome "${resultado.nomeEncontrado}" não encontrado na lista. Se for erro, avise o admin.`);
        return;
      }
    } else {
      await enviarMensagemTexto(from, '⛔ Comprovante não aprovado automaticamente. Verifique o comprovante (valor ou nome).');
      return;
    }

  } catch (err) {
    console.error('ERRO processarMensagem geral:', err.response ? err.response.data || err.response : err.message);
  }
}

// ROTA DO WEBHOOK - UltraMSG envia POSTs com JSON
app.post('/webhook', async (req, res) => {
  try {
    // log mínimo
    console.log('Webhook recebido (body keys):', Object.keys(req.body || {}).join(', '));
    // processa assincronamente (respondemos 200 rápido)
    processarMensagem(req.body).catch(e => console.error('processarMensagem erro:', e.message));
    return res.sendStatus(200);
  } catch (e) {
    console.error('Erro na rota webhook:', e.message);
    return res.sendStatus(500);
  }
});

app.get('/', (req, res) => {
  res.send('Bot Pagamentos UltraMSG - rodando');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
