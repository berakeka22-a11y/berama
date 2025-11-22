import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ======================================
// CONFIGURAÇÃO ULTRAMSG (SEU INSTANCE)
// ======================================
const INSTANCE_ID = "instance151755";
const TOKEN = "idyxynn5iaugvpj4";

// URL base da API ULTRAMSG
const API_URL = `https://api.ultramsg.com/${INSTANCE_ID}`;

// =======================================
// ROTAS
// =======================================

// Rota Webhook (UltraMSG envia as mensagens aqui)
app.post("/webhook", async (req, res) => {
    console.log("📩 Recebido do UltraMSG:", req.body);

    try {
        const message = req.body.body.toLowerCase();
        const from = req.body.from;

        // Resposta simples só para confirmar que o bot funciona
        await sendMessage(from, "✅ Bot UltraMSG funcionando! Recebi sua mensagem.");

        res.sendStatus(200);
    } catch (error) {
        console.error("Erro Webhook:", error);
        res.sendStatus(500);
    }
});

// ======================================
// Função para enviar mensagem no UltraMSG
// ======================================
async function sendMessage(to, text) {
    try {
        await axios.post(`${API_URL}/messages/chat`, {
            token: TOKEN,
            to,
            body: text
        });
    } catch (error) {
        console.error("Erro ao enviar mensagem:", error.response?.data || error);
    }
}

// ======================================
// INICIAR SERVIDOR
// ======================================
app.listen(3000, () => {
    console.log("🚀 Servidor rodando na porta 3000");
    console.log("Webhook configurado em: /webhook");
});
