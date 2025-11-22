// ===============================
// BOT PAGAMENTOS - EVOLUTION API
// ===============================

import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

const EVOLUTION_API_KEY = "SUA_API_KEY_AQUI";        // troque
const EVOLUTION_INSTANCE = "bera";                   // seu número
const API_URL = `https://api.evolution-api.com/whatsapp/${EVOLUTION_INSTANCE}`;

// ===============================
// 1. Função para baixar mídia
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
// 2. Enviar mensagem pelo WhatsApp
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
    console.log("ERRO AO ENVIAR MENSAGEM:", e.response?.data || e.message);
  }
}

// ===============================
// 3. Webhook principal
// ===============================
app.post("/api/webhook", async (req, res) => {
  res.sendStatus(200);
  const data = req.body;

  if (!data || !data.messages || data.messages.length === 0) return;

  const msg = data.messages[0];
  const from = msg.from;

  // -------------------------------
  // SE FOR TEXTO COMANDO
  // -------------------------------
  if (msg.type === "text") {
    const texto = msg.textMessage.text.toLowerCase();

    if (texto.includes("lista")) {
      enviarMensagem(from, "Aqui está a lista atualizada ✔️");
      return;
    }

    if (texto.includes("pix") || texto.includes("pagar")) {
      enviarMensagem(from, "Envie o comprovante do PIX de R$ 75 para validar.");
      return;
    }

    return;
  }

  // -------------------------------
  // SE FOR MÍDIA (FOTO / PDF / ETC)
  // -------------------------------
  if (msg.type === "image" || msg.type === "document" || msg.type === "video") {
    try {
      const mediaUrl = msg[`${msg.type}Message`].directPath;

      const filename = `${Date.now()}-${msg.type}.bin`;
      const filePath = await baixarMidia(mediaUrl, filename);

      if (!filePath) {
        enviarMensagem(from, "❌ Erro ao baixar o arquivo. Tente novamente.");
        return;
      }

      // FAKE PROCESSAMENTO
      await enviarMensagem(from, "📥 Comprovante recebido! Validando pagamento...");

      setTimeout(async () => {
        await enviarMensagem(from, "✅ Pagamento confirmado! Já atualizei seu nome na lista.");
      }, 1500);

    } catch (e) {
      enviarMensagem(from, "❌ Ocorreu um erro ao processar sua imagem.");
      console.log("ERRO PROCESSAR MÍDIA:", e);
    }
    return;
  }
});

// ===============================
// 4. Servidor
// ===============================
app.listen(3000, () => {
  console.log("Bot rodando na porta 3000");
});
