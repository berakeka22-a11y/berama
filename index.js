// ==========================
// index.js COMPLETO (EVOLUTION API)
// ==========================

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ==========================
// VARIÁVEIS DE AMBIENTE
// ==========================
const API_KEY = process.env.EVOLUTION_API_KEY;
const BASE_URL = process.env.EVOLUTION_URL;
const INSTANCE = process.env.INSTANCIA;

if (!API_KEY || !BASE_URL || !INSTANCE) {
    console.error("❌ Variáveis ausentes no .env");
    console.log("EVOLUTION_API_KEY, EVOLUTION_URL, INSTANCIA");
    process.exit(1);
}

console.log("🔧 Variáveis carregadas:");
console.log({ API_KEY, BASE_URL, INSTANCE });

// ==========================
// FUNÇÃO: Enviar mensagem
// ==========================
async function sendMessage(to, message) {
    try {
        const url = `${BASE_URL}/message/sendText/${INSTANCE}`;

        await axios.post(url, {
            number: to,
            textMessage: { text: message }
        }, {
            headers: { Authorization: API_KEY }
        });

        console.log("📤 Mensagem enviada:", message);
    } catch (err) {
        console.error("❌ Erro ao enviar mensagem:", err?.response?.data || err.message);
    }
}

// ==========================
// FUNÇÃO MOCK — ATUALIZAR LISTA
// (Depois você troca pelo banco real)
// ==========================
async function atualizarListaPagamento(numero, valor) {
    console.log("💾 Salvando pagamento:");
    console.log("Número:", numero);
    console.log("Valor:", valor);
    // aqui salvava no Supabase/Postgres
    return true;
}

// ==========================
// FUNÇÃO: INTERPRETAR COMPROVANTE
// ==========================
function extrairValorPIX(textoExtraido) {
    if (!textoExtraido) return null;

    // pega número com vírgula ou ponto
    const match = textoExtraido.match(/(\d{1,5}[.,]\d{2})/);

    if (match) return match[1];

    return null;
}

// ==========================
// ROTA PRINCIPAL DO WEBHOOK
// ==========================
app.post("/webhook", async (req, res) => {
    console.log("📩 WEBHOOK RECEBIDO");
    console.log(JSON.stringify(req.body, null, 2));

    res.sendStatus(200);

    try {
        const data = req.body;

        if (!data || !data.message) {
            console.log("⚠️ Webhook sem message");
            return;
        }

        const msg = data.message;
        const from = msg.from;

        // ==========================
        // 1. MENSAGEM DE TEXTO
        // ==========================
        if (msg.type === "textMessage") {
            const texto = msg.textMessage.text.toLowerCase();

            if (texto.includes("pagar")) {
                await sendMessage(from, "💰 Envie o comprovante do PIX.");
            }

            if (texto.includes("lista")) {
                await sendMessage(from, "📄 A lista está vazia no momento.");
            }
        }

        // ==========================
        // 2. IMAGEM COM BASE64 ATIVADO
        // ==========================
        if (msg.type === "imageMessage") {
            const b64 = msg.imageMessage?.image;
            const caption = msg.imageMessage?.caption || "";

            console.log("🖼️ Recebi uma foto base64:", b64 ? "sim" : "não");

            if (b64) {
                console.log("📥 FOTO BASE64 RECEBIDA");
            }

            // extrair valor do caption
            const valor = extrairValorPIX(caption);

            if (valor) {
                await atualizarListaPagamento(from, valor);
                await sendMessage(from, `✅ Pagamento de *${valor}* recebido!`);
            } else {
                await sendMessage(from, "❌ Não consegui identificar o valor no comprovante.");
            }
        }

        // ==========================
        // 3. DOCUMENTO (PDF/IMG)
        // ==========================
        if (msg.type === "documentMessage") {
            const filename = msg.documentMessage?.fileName || "arquivo";

            await sendMessage(from, `📄 Recebi o documento: *${filename}*`);
        }

        // ==========================
        // 4. OUTROS TIPOS
        // ==========================
        console.log("📌 Tipo recebido:", msg.type);

    } catch (err) {
        console.error("❌ Erro no processamento:", err?.response?.data || err.message);
    }
});

// ==========================
// ROTA PARA TESTE
// ==========================
app.get("/", (req, res) => {
    res.send("🚀 Servidor Evolution API rodando!");
});

// ==========================
// INICIAR SERVIDOR
// ==========================
app.listen(80, () => {
    console.log("🔥 Servidor rodando na porta 80");
});
