const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// =======================
// CONFIG ULTRAMSG
// =======================
const INSTANCE_ID = "instance151755";
const TOKEN = "idyxynn5iaugvpj4";

const API_URL = `https://api.ultramsg.com/${INSTANCE_ID}`;

// =======================
// WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
    console.log("📩 Recebido:", req.body);

    try {
        const from = req.body.from;
        const message = req.body.body?.toLowerCase() || "";

        // Teste de resposta
        await sendMessage(from, "UltraMSG BOT online! Recebi sua mensagem.");

        res.sendStatus(200);
    } catch (error) {
        console.error("Erro no webhook:", error);
        res.sendStatus(500);
    }
});

// =======================
// ENVIAR MENSAGEM
// =======================
async function sendMessage(to, text) {
    try {
        await axios.post(`${API_URL}/messages/chat`, {
            token: TOKEN,
            to,
            body: text
        });
    } catch (error) {
        console.error("Erro ao enviar:", error.response?.data || error);
    }
}

// =======================
// SERVIDOR
// =======================
app.listen(3000, () => {
    console.log("🚀 Servidor rodando na porta 3000");
});
