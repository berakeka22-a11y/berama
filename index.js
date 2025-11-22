// =========================
// CONFIGURAÇÕES DO SERVIDOR
// =========================
import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// =========================
// CONFIGURAÇÕES DA EVOLUTION
// =========================
const INSTANCE_KEY = "bera";
const API_KEY = "429683C4C977415CAAFCCE10F7D57E11";
const BASE_URL = "https://tutoriaisdigitais-evolution-api.ksyx1x.easypanel.host";

// =========================
// FUNÇÃO PARA ENVIAR TEXTO
// =========================
async function sendText(number, message) {
    try {
        await axios.post(
            `${BASE_URL}/message/sendText/${INSTANCE_KEY}`,
            {
                number,
                text: message
            },
            {
                headers: {
                    "apikey": API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );
        console.log("Mensagem enviada:", message);
    } catch (error) {
        console.log("Erro ao enviar texto:", error.response?.data || error.message);
    }
}

// =========================
// FUNÇÃO PARA BAIXAR MÍDIA
// =========================
async function downloadMedia(messageId) {
    try {
        const url = `${BASE_URL}/message/downloadMedia/${INSTANCE_KEY}/${messageId}`;

        const res = await axios.get(url, {
            headers: {
                "apikey": API_KEY
            }
        });

        if (!res.data || !res.data.base64) {
            console.log("Erro: base64 não retornado!");
            return null;
        }

        return res.data.base64;

    } catch (error) {
        console.log("Erro no download da mídia:", error.response?.data || error.message);
        return null;
    }
}

// =========================
// LISTA DE PAGAMENTO
// =========================
let lista = [];

// Salvar em arquivo local
function salvarLista() {
    fs.writeFileSync("lista.json", JSON.stringify(lista, null, 2));
}

// Carregar ao iniciar
if (fs.existsSync("lista.json")) {
    lista = JSON.parse(fs.readFileSync("lista.json"));
}

// =========================
// ROTA DO WEBHOOK
// =========================
app.post("/webhook", async (req, res) => {
    console.log("📩 Webhook recebido!");

    const body = req.body;

    // =======================
    // SEGURANÇA
    // =======================
    if (!body || !body.data) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    const msg = body.data;

    // =======================
    // MENSAGEM TEXTO
    ============================
    if (msg.type === "text") {
        const from = msg.from;
        const texto = msg.body;

        console.log("📨 Mensagem recebida:", texto);

        if (texto.toLowerCase() === "lista") {
            if (lista.length === 0) {
                await sendText(from, "Nenhum pagamento registrado ainda.");
            } else {
                await sendText(from, "📃 Lista:\n" + lista.join("\n"));
            }
        }
    }

    // =======================
    // RECEBIMENTO DE IMAGEM (COMPROVANTE)
    // =======================
    if (msg.type === "image" || msg.type === "document") {
        const from = msg.from;
        const messageId = msg.id;

        console.log("📷 Recebido comprovante, ID:", messageId);

        const base64 = await downloadMedia(messageId);

        if (!base64) {
            console.log("❌ Falha ao baixar imagem.");
            await sendText(from, "Erro ao processar o comprovante.");
            return res.sendStatus(200);
        }

        console.log("✔ Mídia baixada com sucesso!");

        // SALVA LOCAL
        const filename = `comprovante_${Date.now()}.jpg`;
        const buffer = Buffer.from(base64, "base64");
        fs.writeFileSync(filename, buffer);

        // ADICIONA NA LISTA
        lista.push(`Pagamento recebido de ${from} às ${new Date().toLocaleString()}`);
        salvarLista();

        await sendText(from, "Pagamento confirmado! ✅");

        console.log("✔ Comprovante processado e salvo.");
    }

    return res.sendStatus(200);
});

// =========================
// INICIAR SERVIDOR
// =========================
app.listen(80, () => {
    console.log("Servidor rodando na porta 80");
    console.log("Webhook ativo e aguardando mensagens...");
});
