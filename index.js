import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(bodyParser.json({ limit: "50mb" }));

// ===============================
// VARIÁVEIS DA EVOLUTION
// ===============================
const EVOLUTION_API_KEY = "429683C4C977415CAAFCCE10F7D57E11";
const EVOLUTION_URL = "https://tutoriaisdigitais-evolution-api.ksyx1x.easypanel.host";
const INSTANCE = "bera";

// ===============================
// FUNÇÃO PARA ENVIAR MENSAGEM
// ===============================
async function enviarMensagem(numero, texto) {
  try {
    await axios.post(
      `${EVOLUTION_URL}/message/sendText/${INSTANCE}`,
      {
        number: numero,
        textMessage: { text: texto }
      },
      {
        headers: {
          "apikey": EVOLUTION_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Mensagem enviada para:", numero);
  } catch (err) {
    console.log("Erro ao enviar:", err.response?.data || err.message);
  }
}

// ===============================
// FUNÇÃO PARA ENVIAR MÍDIA BASE64
// ===============================
async function enviarMidiaBase64(numero, nome, base64, mimetype) {
  try {
    await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${INSTANCE}`,
      {
        number: numero,
        mediaMessage: {
          fileName: nome,
          mimeType: mimetype,
          data: base64
        }
      },
      {
        headers: {
          "apikey": EVOLUTION_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Mídia enviada para:", numero);
  } catch (err) {
    console.log("Erro ao enviar mídia:", err.response?.data || err.message);
  }
}

// ===============================
// ROTA WEBHOOK (ESTE É O QUE O EVOLUTION USA!)
// ===============================
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK RECEBIDO");
  console.log(JSON.stringify(req.body, null, 2));

  res.status(200).send("OK");

  // Verifica se é mensagem recebida
  const message = req.body?.message;

  if (!message) return;

  const from = message.from;
  const text = message.text?.body || null;

  // ===========================
  // SE FOR MENSAGEM DE TEXTO
  // ===========================
  if (text) {
    console.log("Texto recebido:", text);

    await enviarMensagem(from, "Recebi sua mensagem 😎");
  }

  // ===========================
  // SE FOR MÍDIA BASE64
  // ===========================
  if (message.type === "media") {
    const base64 = message.media?.data;
    const mimetype = message.media?.mimeType;
    const filename = message.media?.fileName || "arquivo";

    console.log("📸 Mídia recebida:", mimetype);

    if (base64) {
      await enviarMidiaBase64(from, filename, base64, mimetype);
    }
  }
});

// ===============================
// INICIA O SERVIDOR
// ===============================
app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
