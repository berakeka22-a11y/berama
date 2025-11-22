const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// ====================================================
// 🔥 SUAS APIS AQUI — COMPLETAS — NÃO REMOVO NADA 🔥
// ====================================================

// URL COMPLETA DA EVOLUTION API
const EVOLUTION_URL = "https://tutoriaisdigitais-evolution.ksyx1x.easypanel.host/api/v1";

// ID DA INSTÂNCIA
const INSTANCE = "3333";   // ← Você pediu esse ID, está aqui FIXO

// TOKEN REAL QUE VOCÊ DISSE PRA EU POR
const TOKEN = "iUuDwBt5aVZL2tnKKfzxlXkT3FZ9gcGb";

// Só mostrando no console que carregou
console.log("🔧 CONFIGURAÇÃO CARREGADA:");
console.log("URL:", EVOLUTION_URL);
console.log("INSTÂNCIA:", INSTANCE);
console.log("TOKEN:", TOKEN);

// ====================================================
// 📩 WEBHOOK — RECEBE MENSAGENS DO WHATSAPP
// ====================================================
app.post("/webhook", async (req, res) => {
    console.log("📥 Chegou mensagem:");
    console.log(JSON.stringify(req.body, null, 2));

    const msg = req.body?.message?.text?.body;
    const number = req.body?.message?.from;

    if (!msg || !number) return res.sendStatus(200);

    // Responder com base no que o usuário enviou
    if (msg.toLowerCase() === "pago") {
        await enviarMensagem(number, "✔️ Pagamento confirmado!");
    }

    if (msg.toLowerCase() === "lista") {
        await enviarMensagem(number, "📄 Sua lista atualizada:\n- Fulano: PAGO\n- Ciclano: PENDENTE");
    }

    res.sendStatus(200);
});

// ====================================================
// 📤 FUNÇÃO PARA ENVIAR MENSAGEM VIA EVOLUTION API
// ====================================================
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

        console.log("💬 Mensagem enviada:", texto);
        return r.data;

    } catch (err) {
        console.log("❌ ERRO AO ENVIAR MENSAGEM:");
        console.log(err.response?.data || err.message);
    }
}

// ====================================================
// 🚀 TESTE MANUAL — ENVIA MENSAGEM DIRETA
// ====================================================
app.get("/testar", async (req, res) => {
    await enviarMensagem("5511999999999", "Mensagem de TESTE do servidor!");
    res.send("Teste enviado!");
});

// ====================================================
// 🖥️ START DO SERVIDOR
// ====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
