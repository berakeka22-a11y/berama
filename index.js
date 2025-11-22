// ===============================
// BOT PAGAMENTOS - EVOLUTION API
// ===============================

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// -------------------------------
// CONFIG
// -------------------------------
const EVOLUTION_API_KEY = "SUA_API_KEY_AQUI";
const EVOLUTION_INSTANCE = "bera";
const API_URL = `https://api.evolution-api.com/whatsapp/${EVOLUTION_INSTANCE}`;

// ===============================
// FUNÇÃO BAIXAR MÍDIA
// ===============================
async function baixarMidia(mediaUrl, filename) {
  try {
    const filePath = path.join("/tmp", filename);

    const response = await axios.get(mediaUrl, {
      headers: { apikey: EVOLUTION_API_KEY },
      responseType: "arraybuffer",
    });

    fs.writeFileSync(filePath, response.data);
    return filePath;

  } catch (e) {
    console.log("ERRO AO BAIXAR MÍDIA:", e.message);
    return null;
  }
}

// ===============================
// ENVIAR TEXTO
// ===============================
async function enviarMensagem(numero, texto) {
  try {
    await axios.post(
      `${API_URL}/sendMessage`,
      {
        number: numero,
        textMessage: { text: texto }
      },
      { headers: { apikey: EVOLUTION_API_KEY } }
    );
  } catch (e) {
    console.log("ERRO AO ENVIAR:", e.response?.data || e.message);
  }
}

// ===============================
// WEBHOOK
// ===============================
app.post("/api/webhook", async (req, res) => {
  res.sendStatus(200);

  const data = req.body;
  if (!data?.messages?.length) return;

  const msg = data.messages[0];
  const from = msg.from;

  // TEXTO
  if (msg.type === "text") {
    const t = msg.textMessage.text.toLowerCase();

    if (t.includes("lista")) {
      enviarMensagem(from, "📌 Lista atualizada enviada!");
      return;
    }

    if (t.includes("pix") || t.includes("pagar")) {
      enviarMensagem(from, "Envie o comprovante do PIX de R$ 75.");
      return;
    }

    return;
  }

  // MÍDIA
  if (["image", "document", "video"].includes(msg.type)) {
    try {
      const url = msg[`${msg.type}Message`].directPath;

      const filename = `${Date.now()}-${msg.type}.bin`;
      const filePath = await baixarMidia(url, filename);

      if (!filePath) {
        enviarMensagem(from, "❌ Erro ao baixar arquivo.");
        return;
      }

      await enviarMensagem(from, "📥 Comprovante recebido! Validando...");

      setTimeout(() => {
        enviarMensagem(from, "✅ Pagamento confirmado! Nome adicionado na lista.");
      }, 2000);

    } catch (e) {
      console.log("ERRO PROCESSAR MÍDIA:", e);
      enviarMensagem(from, "❌ Ocorreu um erro ao processar sua imagem.");
    }
  }
});

// ===============================
// SERVIDOR
// ===============================
app.listen(3000, () => {
  console.log("Bot rodando na porta 3000");
});
