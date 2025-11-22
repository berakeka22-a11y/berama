const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// =======================
// 🔥 SUAS APIS
// =======================
const EVOLUTION_URL = "https://tutoriaisdigitais-evolution.ksyx1x.easypanel.host/api/v1";
const INSTANCE = "3333";
const TOKEN = "iUuDwBt5aVZL2tnKKfzxlXkT3FZ9gcGb";

// =======================
// 📩 WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
    console.log("📥 Recebido:");
    console.log(JSON.stringify(req.body, null, 2));

    const data = req.body;
    const number = data?.message?.from;

    if (!number) return res.sendStatus(200);

    // --- Extrair texto se existir ---
    let msg = null;

    // Mensagem normal de texto
    if (data?.message?.text?.body) {
        msg = data.message.text.body.toLowerCase();
    }

    // Mensagem de imagem
    if (data?.message?.image) {
        msg = "imagem"; // só pra identificar
    }

    // Mensagem de áudio
    if (data?.message?.audio) {
        msg = "audio";
    }

    // Caso não tenha nada identificável
    if (!msg) msg = "outro";

    console.log("Mensagem interpretada:", msg);

    // --- Respostas ---
    if (msg === "pago") {
        await enviarMensagem(number, "✔️ Pagamento confirmado!");
    }

    if (msg === "lista") {
        await enviarMensagem(number, "📄 Lista:\n- Alex: PAGO\n- João: PENDENTE");
    }

    if (msg === "imagem") {
        await enviarMensagem(number, "🖼️ Recebi sua imagem!");
    }

    if (msg === "audio") {
        await enviarMensagem(number, "🎤 Recebi seu áudio!");
    }

    res.sendStatus(200);
});

// =======================
// 📤 ENVIAR MENSAGEM
// =======================
async function enviarMensagem(numero, texto) {
    try {
        const url = `${EVOLUTION_URL}/${INSTANCE}/send-message`;

        const body = {
            number: numero,
            text: texto
        };

        const headers = {
            Authorization: `Bearer ${TOKEN}`
        };

        const r = await axios.post(url, body, { headers });

        console.log("💬 Enviado:", texto);
        return r.data;

    } catch (err) {
        console.log("❌ Erro ao enviar:");
        console.log(err.response?.data || err.message);
    }
}

// =======================
// 🚀 SERVIDOR
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Rodando na porta ${PORT}`);
});
