/**
 * index.js - Bot Pagamentos (UltraMsg)
 *
 * Requisitos:
 *  - npm i axios
 *  - Node 18+ recomendado
 *
 * Variáveis de ambiente:
 *  - OPENAI_API_KEY (obrigatório)
 *  - ADMIN_NUMBER (ex: 5513991194730) (obrigatório)
 *  - ULTRAMSG_INSTANCE (opcional, default instance151755)
 *  - ULTRAMSG_TOKEN (opcional, default idyxynn5iaugvpj4)
 *  - PORT (opcional, default 80)
 *
 * Arquivo de dados: lista.json (coloque no mesmo diretório)
 *
 * Observações:
 *  - Configure o webhook no UltraMsg para enviar JSON completo (application/json).
 *  - Se o UltraMsg trouxer outro campo, o bot tenta extrair de várias propriedades.
 */

const express = require("express");
const fs = require("fs");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json({ limit: "50mb" })); // aceita payloads grandes

// ================= CONFIGURAÇÕES =================
const ULTRAMSG_INSTANCE = process.env.ULTRAMSG_INSTANCE || "instance151755";
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN || "idyxynn5iaugvpj4";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || "";
const PORT = process.env.PORT ? Number(process.env.PORT) : 80;

const ARQUIVO_LISTA = path.join(__dirname, "lista.json");

// checar variáveis essenciais
if (!OPENAI_API_KEY) {
  console.error("FATAL: OPENAI_API_KEY não definido.");
  process.exit(1);
}
if (!ADMIN_NUMBER) {
  console.error("FATAL: ADMIN_NUMBER não definido.");
  process.exit(1);
}

// ================= HELPERS =================
function safeReadLista() {
  try {
    if (!fs.existsSync(ARQUIVO_LISTA)) {
      fs.writeFileSync(ARQUIVO_LISTA, "[]", "utf8");
      return [];
    }
    const raw = fs.readFileSync(ARQUIVO_LISTA, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    console.error("Erro ao ler lista.json:", e.message);
    return [];
  }
}
function safeWriteLista(lista) {
  fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2), "utf8");
}

function normalizarNome(nome) {
  if (!nome) return "";
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Extrai texto de vários formatos possíveis do webhook UltraMsg
function extractTextFromPayload(payload) {
  if (!payload) return "";
  // 1) diretamenete payload.body
  if (payload.body && typeof payload.body === "string") return payload.body.trim();
  // 2) payload.text
  if (payload.text && typeof payload.text === "string") return payload.text.trim();
  // 3) payload.message or payload.message.body
  if (payload.message && typeof payload.message === "string") return payload.message.trim();
  if (payload.message && payload.message.body && typeof payload.message.body === "string")
    return payload.message.body.trim();
  // 4) data field common in some webhooks
  if (payload.data && payload.data.body && typeof payload.data.body === "string")
    return payload.data.body.trim();
  if (payload.payload && payload.payload.body && typeof payload.payload.body === "string")
    return payload.payload.body.trim();
  // 5) fallback
  return "";
}

// ================= ULTRAMSG (envia mensagens) =================
const ULTRAMSG_BASE = `https://api.ultramsg.com/${ULTRAMSG_INSTANCE}`;
async function ultramsgSendText(to, body) {
  try {
    const payload = {
      token: ULTRAMSG_TOKEN,
      to,
      body,
    };
    const resp = await axios.post(`${ULTRAMSG_BASE}/messages/chat`, payload, {
      timeout: 15000,
    });
    return resp.data;
  } catch (err) {
    console.error("ultramsgSendText erro:", err.response ? err.response.data : err.message);
    throw err;
  }
}

// ================= OPENAI (envio do comprovante para análise) =================
async function analyzeImageWithOpenAI(base64Image, nomesPendentesArray) {
  // Enviamos um prompt pedindo JSON estrito
  const systemPrompt = `Você é um sistema que analisa comprovantes bancários.
Responda APENAS um JSON válido com a seguinte estrutura:
{"aprovado": boolean, "nomeEncontrado": "string ou null", "valor": "string ou null"}.
Valor correto esperado: 75.00.
Procure um dos nomes passados no array.`;

  const nomesStr = nomesPendentesArray.join(", ");

  const userPrompt = `Analise a imagem (fornecida em data URI). Procure o valor e um nome da lista: [${nomesStr}].
Retorne SOMENTE JSON.`;

  try {
    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o", // ou gpt-4o-mini se preferir
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          // enviamos a imagem embutida como texto data-uri na mensagem do usuário
          { role: "user", content: `data:image/jpeg;base64,${base64Image}` },
        ],
        max_tokens: 250,
        temperature: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const content = resp.data.choices?.[0]?.message?.content || "";
    // remover ```json fences se houver
    const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
      return parsed;
    } catch (jsonErr) {
      // caso a IA responda texto além do JSON, tentamos extrair o primeiro {...}
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch (e) {
          throw new Error("Não foi possível parsear JSON retornado pela OpenAI.");
        }
      }
      throw new Error("Resposta OpenAI sem JSON válido.");
    }
  } catch (err) {
    console.error("Erro OpenAI:", err.response ? err.response.data : err.message);
    throw err;
  }
}

// ================= PROCESSAMENTO DE MENSAGENS =================
async function handleIncomingWebhook(payload) {
  // O UltraMsg pode enviar estrutura diferente; tente pegar os campos relevantes:
  // - payload.from OR payload.data.from OR payload.to
  const from =
    (payload && (payload.from || payload.data?.from || payload.sender || payload.to)) || null;

  // detectamos tipo: pode ser "chat" "image" etc. Ultramsg costuma mandar "type" ou "messageType"
  const type = payload.type || payload.messageType || payload.msgType || (payload.data && payload.data.type) || "";

  // extrair texto em todas as variantes
  const text = extractTextFromPayload(payload || payload.data);

  console.log("handleIncomingWebhook -> from:", from, "type:", type, "text:", text ? text.slice(0,200) : "(vazio)");

  // comandos de texto
  if (text) {
    const lower = text.toLowerCase().trim();
    if (lower === "lista") {
      const lista = safeReadLista();
      let msg = "📄 Lista de Pagamentos:\n\n";
      lista.forEach((p, idx) => {
        msg += `${idx + 1}. ${p.nome} - ${p.status}\n`;
      });
      await ultramsgSendText(from, msg);
      return;
    }
    if (lower === "!resetar") {
      // só admin
      const senderNumber = (from || "").replace(/\D/g, "");
      if (senderNumber === ADMIN_NUMBER) {
        const lista = safeReadLista();
        lista.forEach(x => (x.status = "PENDENTE"));
        safeWriteLista(lista);
        await ultramsgSendText(from, "✅ Lista resetada com sucesso.");
      } else {
        await ultramsgSendText(from, "⚠️ Você não tem permissão para resetar.");
      }
      return;
    }
    // aqui poderia haver mais comandos
  }

  // se for imagem (várias possibilidades de campo)
  // UltraMsg webhook costuma ter: payload.media (url) ou payload.picture or payload.image
  const mediaUrl =
    payload.media ||
    payload.picture ||
    payload.image ||
    payload.data?.media ||
    payload.data?.image ||
    payload.data?.url ||
    payload.url ||
    null;

  if (type && type.toLowerCase().includes("image") || mediaUrl) {
    // baixar a imagem da URL
    const url = mediaUrl;
    if (!url) {
      console.log("Webhook com tipo imagem mas sem URL válida.");
      return;
    }

    console.log("Baixando imagem de:", url);
    try {
      const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
      const base64 = Buffer.from(resp.data).toString("base64");

      // pega a lista e nomes pendentes
      const lista = safeReadLista();
      const nomesPendentes = lista.filter(x => x.status !== "PAGO").map(x => x.nome);
      if (nomesPendentes.length === 0) {
        await ultramsgSendText(from, "Todos já estão como PAGO. Nenhuma ação necessária.");
        return;
      }

      // enviar para OpenAI
      let analisado;
      try {
        analisado = await analyzeImageWithOpenAI(base64, nomesPendentes);
        console.log("OpenAI retornou:", analisado);
      } catch (err) {
        await ultramsgSendText(from, "Erro ao analisar comprovante (IA). Tente novamente mais tarde.");
        return;
      }

      // verificar resposta esperada
      if (analisado && analisado.aprovado === true && analisado.nomeEncontrado) {
        const nomeNormalizado = normalizarNome(analisado.nomeEncontrado);
        const idx = lista.findIndex(x => normalizarNome(x.nome) === nomeNormalizado);
        if (idx !== -1) {
          if (lista[idx].status !== "PAGO") {
            lista[idx].status = "PAGO";
            safeWriteLista(lista);
            await ultramsgSendText(from, `✅ Recebido. ${lista[idx].nome} marcado como PAGO.`);
            // opcional: enviar lista atualizada
            let resumo = "📄 Lista atualizada:\n\n";
            lista.forEach((p, i) => (resumo += `${i + 1}. ${p.nome} - ${p.status}\n`));
            await ultramsgSendText(from, resumo);
          } else {
            await ultramsgSendText(from, `ℹ️ ${lista[idx].nome} já constava como PAGO.`);
          }
        } else {
          await ultramsgSendText(from, `⚠️ Nome "${analisado.nomeEncontrado}" não encontrado na lista.`);
        }
      } else {
        await ultramsgSendText(from, "❌ Comprovante não aprovado. Verifique o valor/nome e tente novamente.");
      }
    } catch (err) {
      console.error("Erro ao baixar/processar imagem:", err.message);
      await ultramsgSendText(from, "Erro ao processar imagem. Tente novamente.");
    }
    return;
  }

  // se não for texto nem imagem válida, respondemos com instrução básica
  await ultramsgSendText(from, "👋 Envie 'lista' para ver os mensalistas ou envie o comprovante (foto).");
}

// ================= ROUTES =================
app.post("/webhook", async (req, res) => {
  try {
    // log rápido (pode ser grande)
    console.log("==== WEBHOOK RAW ====");
    console.log(Object.keys(req.body).length ? JSON.stringify(req.body).slice(0, 2000) : req.body);
    // UltraMsg pode pôr o payload direto ou dentro de req.body.data
    const payload = req.body.data || req.body;
    // processe sem bloquear a resposta
    handleIncomingWebhook(payload).catch(err => {
      console.error("Erro interno handleIncomingWebhook:", err.message);
    });
    res.status(200).send({ ok: true });
  } catch (e) {
    console.error("Erro endpoint webhook:", e.message);
    res.status(500).send({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.send("Bot Pagamentos UltraMsg - Online");
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} (process.env.PORT=${process.env.PORT || "n/a"})`);
});
