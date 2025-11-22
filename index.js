import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "200mb" }));

// ===============================
// CONFIGURAÇÃO PRINCIPAL
// ===============================
const EVOLUTION_API_URL = "https://api.evolution.chat/v1/messages";
const EVOLUTION_API_KEY = process.env.EVO_KEY;
const SESSION = process.env.SESSION || "bera";  // seu número da Evolution

// Pasta de comprovantes
const MEDIA_DIR = "./comprovantes";
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR);

// Lista de pagamentos
let listaPagamentos = [];

// ===============================
// FUNÇÃO — ENVIAR MENSAGEM
// ===============================
async function enviarMensagem(numero, mensagem) {
  try {
    await axios.post(
      `${EVOLUTION_API_URL}/sendText/${SESSION}`,
      {
        number: numero,
        text: mensagem,
      },
      {
        headers: {
          apikey: EVOLUTION_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.log("Erro ao enviar mensagem:", err.response?.data || err);
  }
}

// ===============================
// FUNÇÃO — SALVAR MÍDIA BASE64
// ===============================
async function salvarMidia(tipo, base64, nomeAutor) {
  const extensao = tipo === "image" ? ".jpg" : ".bin";
  const nomeArquivo = `${Date.now()}_${nomeAutor}${extensao}`;
  const caminho = path.join(MEDIA_DIR, nomeArquivo);

  const base64Data = base64.replace(/^data:.*;base64,/, "");

  fs.writeFileSync(caminho, base64Data, "base64");

  return caminho;
}

// ===============================
// WEBHOOK PRINCIPAL
// ===============================
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Confirma para Evolution
  res.sendStatus(200);

  if (!body || !body.messages || body.messages.length === 0) {
    return;
  }

  for (const msg of body.messages) {
    const from = msg.from;
    const nome = msg.pushName || "Usuário";

    // ===============================
    // TEXTO NORMAL
    // ===============================
    if (msg.type === "text") {
      const texto = msg.text.body.toLowerCase();

      // LISTA DE PAGAMENTOS
      if (texto.includes("lista")) {
        if (listaPagamentos.length === 0) {
          enviarMensagem(from, "Nenhum pagamento registrado.");
        } else {
          const lista = listaPagamentos
            .map((x, i) => `${i + 1} — ${x.nome}`)
            .join("\n");

          enviarMensagem(from, `Pagamentos confirmados:\n\n${lista}`);
        }
      }

      continue;
    }

    // ===============================
    // MIDIA (FOTO / PDF / IMAGEM)
    // ===============================
    if (
      msg.type === "image" ||
      msg.type === "document" ||
      msg.type === "audio" ||
      msg.type === "video"
    ) {
      try {
        // Verifica se veio base64
        if (!msg.media || !msg.media.data) {
          enviarMensagem(from, "Erro: mídia veio sem base64.");
          continue;
        }

        const caminho = await salvarMidia(msg.type, msg.media.data, nome);

        // SALVA NO REGISTRO
        listaPagamentos.push({
          nome: nome,
          numero: from,
          arquivo: caminho,
          data: new Date().toISOString(),
        });

        enviarMensagem(from, `Comprovante recebido, ${nome}! Pagamento confirmado ✔️`);

      } catch (err) {
        console.error("Erro ao processar mídia:", err);
        enviarMensagem(from, "Erro ao processar o arquivo.");
      }
    }
  }
});

// ===============================
// ROTA DE STATUS
// ===============================
app.get("/", (req, res) => {
  res.send("Webhook rodando perfeitamente! ✔️");
});

// ===============================
// INICIAR SERVIDOR NA PORTA 80
// ===============================
app.listen(80, () => {
  console.log("Servidor rodando na porta 80...");
});
