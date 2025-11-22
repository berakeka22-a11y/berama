// ===============================
// BOT PAGAMENTOS EVOLUTION API
// ===============================
const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "50mb" }));

// ===============================
// CONFIGURAÇÕES
// ===============================
const INSTANCE_KEY = "bera";
const API_KEY = "429683C4C977415CAAFCCE10F7D57E11";
const BASE_URL = "https://tutoriaisdigitais-evolution-api.ksyx1x.easypanel.host";

const LISTA_ARQUIVO = "./lista.json";

// ===============================
// CARREGAR / SALVAR LISTA
// ===============================
function carregarLista() {
    if (!fs.existsSync(LISTA_ARQUIVO)) return [];
    try {
        return JSON.parse(fs.readFileSync(LISTA_ARQUIVO));
    } catch {
        return [];
    }
}

function salvarLista(lista) {
    fs.writeFileSync(LISTA_ARQUIVO, JSON.stringify(lista, null, 2));
}

// ===============================
// ENVIAR MENSAGEM TEXTO
// ===============================
async function enviarTexto(numero, texto) {
    try {
        await axios.post(
            `${BASE_URL}/message/sendText/${INSTANCE_KEY}`,
            {
                number: numero,
                text: texto
            },
            {
                headers: {
                    apikey: API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );
    } catch (e) {
        console.log("Erro ao enviar texto:", e.response?.data || e.message);
    }
}

// ===============================
// BAIXAR MÍDIA
// ===============================
async function baixarMidia(messageId) {
    try {
        const url = `${BASE_URL}/message/downloadMedia/${INSTANCE_KEY}/${messageId}`;

        const res = await axios.get(url, {
            headers: { apikey: API_KEY }
        });

        if (!res.data || !res.data.base64) {
            console.log("Media não retornou base64!");
            return null;
        }

        return res.data.base64;

    } catch (err) {
        console.log("ERRO download:", err.response?.data || err.message);
        return null;
    }
}

// ===============================
// WEBHOOK PRINCIPAL
// ===============================
app.post("/webhook", async (req, res) => {
    console.log("📩 Webhook recebido!");

    const event = req.body;

    // Já testado: Evolution envia => event.event === "messages.upsert"
    if (!event || event.event !== "messages.upsert") {
        return res.sendStatus(200);
    }

    const msg = event.data;
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const type = msg.type;

    // ===============================
    // TEXTO
    // ===============================
    if (type === "text") {
        const texto = msg.body.toLowerCase();

        if (texto === "lista") {
            const lista = carregarLista();
            if (lista.length === 0) {
                await enviarTexto(from, "Nenhum pagamento registrado.");
            } else {
                const formatada = lista.map((x, i) =>
                    `${i + 1}. ${x.numero} — ${x.data}`
                ).join("\n");

                await enviarTexto(from, "📄 Lista:\n" + formatada);
            }
            return res.sendStatus(200);
        }
    }

    // ===============================
    // IMAGEM (COMPROVANTE)
    // ===============================
    if (type === "image" || type === "document") {
        const messageId = msg.id;

        console.log("📷 Comprovante recebido. ID:", messageId);

        const base64 = await baixarMidia(messageId);

        if (!base64) {
            await enviarTexto(from, "Erro ao baixar a imagem do comprovante.");
            return res.sendStatus(200);
        }

        // Salvar local
        const nomeArquivo = `comprovante_${Date.now()}.jpg`;
        fs.writeFileSync(nomeArquivo, Buffer.from(base64, "base64"));

        // Salvar registro na lista
        const lista = carregarLista();
        lista.push({
            numero: from,
            data: new Date().toLocaleString(),
            arquivo: nomeArquivo
        });
        salvarLista(lista);

        await enviarTexto(from, "Pagamento confirmado! ✅");
        return res.sendStatus(200);
    }

    return res.sendStatus(200);
});

// ===============================
// SERVIDOR ONLINE
// ===============================
app.listen(80, () => {
    console.log("🚀 Servidor rodando na porta 80!");
});
