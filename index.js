import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    try { JSON.parse(buf); } catch { req.body = {}; }
  },
  limit: "50mb"
}));

// 🔧 CONFIGURAÇÕES
const PORT = 80;
const EVOLUTION_URL = process.env.EVOLUTION_API_URL; 
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const NUMBER = process.env.EVOLUTION_NUMBER; // número conectado

// 🧾 Lista de pagamentos
let listaPagamentos = [];

// 📌 ROTA PARA CONSULTAR LISTA
app.get("/lista", (req, res) => {
  res.json(listaPagamentos);
});

// 📌 FUNÇÃO: Registrar pagamento ao receber foto no WhatsApp
async function registrarPagamento(message) {
  if (!message.mediaUrl) return;

  const item = {
    numero: message.from,
    horario: new Date().toLocaleString("pt-BR"),
    comprovante: message.mediaUrl
  };

  listaPagamentos.push(item);
  console.log("📥 Pagamento registrado:", item);

  // responder no WhatsApp
  await axios.post(`${EVOLUTION_URL}/message/sendText/${NUMBER}`, {
    number: message.from,
    text: "✔ Comprovante recebido! Seu pagamento foi registrado."
  }, {
    headers: { "apikey": EVOLUTION_KEY }
  });
}

// 📌 WEBHOOK DO EVOLUTION
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body || {};

    // evolution manda vários tipos de evento — ignorar se não for mensagem
    if (!data.event || data.event !== "message") return res.sendStatus(200);

    const msg = data.message || {};

    // Mensagem com foto (media)
    if (msg.type === "image") {
      await registrarPagamento(msg);
    }

    // Mensagem comum
    if (msg.type === "text") {
      let texto = msg.text?.toLowerCase() || "";

      if (texto.includes("lista")) {
        let resposta = "📄 Lista de pagamentos:\n\n" +
          listaPagamentos.map((p, i) =>
            `${i + 1}. ${p.numero} - ${p.horario}`
          ).join("\n");

        if (listaPagamentos.length === 0) resposta = "Nenhum pagamento registrado ainda.";

        await axios.post(`${EVOLUTION_URL}/message/sendText/${NUMBER}`, {
          number: msg.from,
          text: resposta
        }, {
          headers: { "apikey": EVOLUTION_KEY }
        });
      }
    }

    return res.sendStatus(200);

  } catch (err) {
    console.log("❌ Erro processarMensagem:", err.message);
    return res.sendStatus(200); // EVOLUTION odeia erro 500
  }
});

// 🔥 INICIAR SERVIDOR
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
