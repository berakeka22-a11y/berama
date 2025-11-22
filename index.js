// ===============================
// BOT DE PAGAMENTOS - EVOLUTION API
// Suporta: receber imagem, baixar mídia,
// enviar para IA, atualizar lista, responder no WhatsApp.
// ===============================

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "50mb" }));

// ===============================
// VARIÁVEIS DE AMBIENTE
// ===============================
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const INSTANCIA = process.env.INSTANCIA;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;
const ARQUIVO_LISTA = "./lista.json";

if (!EVOLUTION_API_KEY || !EVOLUTION_URL || !INSTANCIA || !OPENAI_API_KEY) {
  console.error("❌ ERRO FATAL: Variáveis de ambiente faltando.");
  process.exit(1);
}

// ===============================
// GARANTE ARQUIVO lista.json
// ===============================
if (!fs.existsSync(ARQUIVO_LISTA)) {
  fs.writeFileSync(ARQUIVO_LISTA, "[]");
}

// ===============================
// ENVIAR MENSAGEM PARA O WHATSAPP
// ===============================
async function enviarTexto(numero, texto) {
  try {
    await axios.post(
      `${EVOLUTION_URL}/message/sendText/${INSTANCIA}`,
      {
        number: numero,
        text: texto,
      },
      {
        headers: { apikey: EVOLUTION_API_KEY },
      }
    );
  } catch (e) {
    console.log("Erro ao enviar mensagem:", e?.response?.data || e.message);
  }
}

// ===============================
// FORMATA LISTA
// ===============================
async function enviarLista(numero, titulo) {
  const lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));

  let msg = `📋 *${titulo}*\n\n`;
  lista.forEach((p, i) => {
    msg += `${i + 1}. ${p.nome} — ${p.status === "PAGO" ? "✅" : "⏳"}\n`;
  });

  msg += `\n💳 *PIX:* sagradoresenha@gmail.com`;

  await enviarTexto(numero, msg);
}

// ===============================
// NORMALIZA NOME
// ===============================
function normalizarNome(nome) {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// ===============================
// PROCESSAR MENSAGEM RECEBIDA
// ===============================
async function processarMensagem(data) {
  try {
    const numero = data.key.remoteJid;
    const texto =
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text ||
      null;

    // ===============================
    // COMANDO: RESETAR
    // ===============================
    if (texto && texto.toLowerCase() === "!resetar") {
      if (!numero.includes(ADMIN_NUMBER)) return;

      let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));
      lista.forEach((p) => (p.status = "PENDENTE"));
      fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));

      await enviarLista(numero, "Lista Resetada");
      return;
    }

    // ===============================
    // RECEBER IMAGEM
    // ===============================
    const tipo = data.messageType;
    if (tipo !== "imageMessage") return;

    console.log("📥 Recebendo imagem…");

    const urlDownload = `${EVOLUTION_URL}/chat/downloadMedia`;

    const baixar = await axios.post(urlDownload, data.message, {
      headers: { apikey: EVOLUTION_API_KEY },
      responseType: "arraybuffer",
    });

    const base64 = Buffer.from(baixar.data).toString("base64");

    if (!base64) {
      console.log("Erro ao converter imagem.");
      return;
    }

    // ===============================
    // Nomes pendentes
    // ===============================
    let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));
    const pendentes = lista
      .filter((p) => p.status !== "PAGO")
      .map((p) => p.nome)
      .join(", ");

    if (!pendentes) {
      await enviarTexto(numero, "Todos já pagaram! 🎉");
      return;
    }

    // ===============================
    // ANALISAR COMPROVANTE NA OPENAI
    // ===============================

    const resposta = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Analise o comprovante de PIX. Valor deve ser 75.00 e nome deve estar entre: [${pendentes}]. 
              Retorne apenas JSON no formato:
              {"aprovado": boolean, "nomeEncontrado": "string ou null"} `,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64}`,
                },
              },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let resultado = JSON.parse(
      resposta.data.choices[0].message.content
        .replace(/```json|```/g, "")
        .trim()
    );

    console.log("📊 Resultado IA:", resultado);

    // ===============================
    // ATUALIZA LISTA
    // ===============================
    if (resultado.aprovado && resultado.nomeEncontrado) {
      const nomeIA = normalizarNome(resultado.nomeEncontrado);

      const idx = lista.findIndex(
        (p) => normalizarNome(p.nome) === nomeIA
      );

      if (idx !== -1) {
        lista[idx].status = "PAGO";
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));

        await enviarLista(numero, "Lista Atualizada");
      }
    }
  } catch (e) {
    console.log("ERRO processarMensagem:", e.message);
  }
}

// ===============================
// WEBHOOK
// ===============================
app.post("/webhook", (req, res) => {
  if (req.body.event === "messages.upsert") {
    processarMensagem(req.body.data);
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("BOT OK 🔥");
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 80;
app.listen(PORT, () =>
  console.log("🚀 Servidor rodando na porta " + PORT)
);
