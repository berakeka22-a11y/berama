const express = require('express');
const fs = require('fs');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json({ limit: '50mb' }));

// UltraMsg fixo
const ULTRAMSG_INSTANCE = "instance151755";
const ULTRAMSG_TOKEN = "idyxynn5iaugvpj4";

// Variáveis ambiente
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

// Lista de pagamentos
const ARQUIVO_LISTA = "./lista.json";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const ultramsgAPI = axios.create({
    baseURL: `https://api.ultramsg.com/${ULTRAMSG_INSTANCE}`,
    params: { token: ULTRAMSG_TOKEN }
});

// ---------------------------------------------------------------
// FUNÇÕES
// ---------------------------------------------------------------

function normalizarNome(nome) {
    if (!nome) return '';
    return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function enviarRespostaWhatsApp(destino, corpo) {
    try {
        await ultramsgAPI.post("/messages/chat", {
            to: destino,
            body: corpo
        });
    } catch (e) {
        console.log("Erro enviar:", e.response?.data || e.message);
    }
}

async function formatarEEnviarLista(destino, titulo) {
    const lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));

    let msg = `📊 *${titulo}* 📊\n\n`;
    lista.forEach((p, i) => {
        msg += `${i + 1}. ${p.nome} ${p.status === "PAGO" ? "✅" : "⏳"}\n`;
    });

    msg += "\n💳 Chave PIX: sagradoresenha@gmail.com";

    await enviarRespostaWhatsApp(destino, msg);
}

async function processarComando(body, from) {
    if (body === "!resetar" && from === `${ADMIN_NUMBER}@c.us`) {
        let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));
        lista.forEach(x => x.status = "PENDENTE");
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));

        await formatarEEnviarLista(from, "Lista Resetada");
    }
}

async function processarMensagem(msg) {

    const { type, body, from, media } = msg;

    // Comandos
    if (type === "chat") {
        await processarComando(body.trim().toLowerCase(), from);
        return;
    }

    // Só processar imagens de comprovante
    if (type !== "image") return;

    console.log("📸 Recebi comprovante");

    // Download imagem
    const img = await axios.get(media, { responseType: "arraybuffer" });
    const base64Image = Buffer.from(img.data).toString("base64");

    // Carregar lista
    let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));
    const pendentes = lista.filter(x => x.status !== "PAGO").map(x => x.nome);

    if (pendentes.length === 0) return;

    // IA analisando
    const ia = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 100,
        temperature: 0,
        messages: [
            {
                role: "system",
                content:
                    `Analise o comprovante. Valor deve ser 75.00 e nome um destes: [${pendentes.join(", ")}].
                     Responda SOMENTE JSON: {"aprovado":true/false,"nomeEncontrado":"string ou null"}`
            },
            {
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                    }
                ]
            }
        ]
    });

    const result = JSON.parse(
        ia.choices[0].message.content.replace(/```json|```/g, "").trim()
    );

    console.log("🔍 IA:", result);

    if (result.aprovado && result.nomeEncontrado) {
        const nomeIA = normalizarNome(result.nomeEncontrado);
        const pos = lista.findIndex(x => normalizarNome(x.nome) === nomeIA);

        if (pos !== -1) {
            lista[pos].status = "PAGO";
            fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));
            await formatarEEnviarLista(from, "Pagamento Confirmado!");
        }
    }
}

// ---------------------------------------------------------------
// WEBHOOK ULTRAMSG CORRETO
// ---------------------------------------------------------------

app.post("/webhook", (req, res) => {
    try {
        const body = req.body;

        console.log("📥 Recebido:", JSON.stringify(body, null, 2));

        // UltraMsg envia:  { messages: [ {...} ] }
        if (!body.messages || !Array.isArray(body.messages)) {
            return res.sendStatus(200);
        }

        body.messages.forEach(msg => {
            if (!msg.fromMe) processarMensagem(msg);
        });

        res.sendStatus(200);
    } catch (e) {
        console.log("Erro webhook:", e.message);
        res.sendStatus(500);
    }
});

app.get("/", (req, res) => res.send("Bot pagamentos UltraMsg OK"));

app.listen(process.env.PORT || 3000, () =>
    console.log("🚀 Rodando servidor")
);
