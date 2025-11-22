const express = require('express');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ===== CONFIG DO ULTRAMSG =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ULTRA_INSTANCE = process.env.ULTRA_INSTANCE;   // ex: instance51755
const ULTRA_TOKEN = process.env.ULTRA_TOKEN;         // ex: ix9ynsuisu9vgj4
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

if (!OPENAI_API_KEY || !ULTRA_INSTANCE || !ULTRA_TOKEN || !ADMIN_NUMBER) {
    console.error("ERRO CRÍTICO: Variáveis de ambiente faltando.");
    process.exit(1);
}

const ULTRA_BASE = `https://api.ultramsg.com/${ULTRA_INSTANCE}`;
const ARQUIVO_LISTA = './lista.json';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =========================================================
// FUNÇÕES AUXILIARES
// =========================================================

function normalizarNome(nome) {
    if (!nome) return '';
    return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function enviarMensagem(numero, texto) {
    try {
        await axios.post(`${ULTRA_BASE}/messages/chat`, {
            token: ULTRA_TOKEN,
            to: numero,
            body: texto
        });
    } catch (err) {
        console.error("Erro ao enviar mensagem:", err?.response?.data || err);
    }
}

async function formatarEEnviarLista(jidDestino, titulo) {
    try {
        const lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));

        let msg = `📊 *${titulo}* 📊\n\n`;
        lista.forEach((pessoa, i) => {
            const icon = pessoa.status === "PAGO" ? "✅" : "⏳";
            msg += `${i + 1}. ${pessoa.nome} ${icon}\n`;
        });

        msg += "\n💳 Chave PIX: sagradoresenha@gmail.com";

        await enviarMensagem(jidDestino, msg);
    } catch (err) {
        console.error("Erro ao enviar lista:", err);
    }
}

// =========================================================
// COMANDOS
// =========================================================

async function processarComando(comando, remetente, jidDestino) {
    const numeroRemetente = remetente.replace("@c.us", "").replace("@s.whatsapp.net", "");

    if (comando.toLowerCase() === "!resetar") {
        if (numeroRemetente !== ADMIN_NUMBER) return;

        let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));
        lista.forEach(p => p.status = "PENDENTE");
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));

        await formatarEEnviarLista(jidDestino, "Lista Resetada");
    }
}

// =========================================================
// PROCESSAR MENSAGEM RECEBIDA ULTRAMSG
// =========================================================

async function processarMensagemUltra(data) {
    try {
        const remetente = data.from;
        const texto = data.body;
        const tipo = data.type;

        // Trata comandos
        if (texto) {
            await processarComando(texto, remetente, remetente);
        }

        // Só processa comprovante (imagem)
        if (tipo !== "image") return;

        console.log("📥 Baixando imagem...");

        const downloadUrl = data.media;  // direct link do UltraMsg
        const imgBuffer = (await axios.get(downloadUrl, { responseType: "arraybuffer" })).data;
        const base64Image = Buffer.from(imgBuffer).toString('base64');

        console.log("📸 Imagem convertida para base64.");

        // Pega lista
        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));
        const pendentes = listaAtual.filter(p => p.status !== "PAGO").map(p => p.nome);

        if (pendentes.length === 0) return;

        // ————— GPT-4o Analisando —————
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `Analise o comprovante. Valor deve ser 75.00 e o nome deve ser um dos: ${pendentes.join(", ")}. Responda APENAS JSON: {"aprovado": boolean, "nomeEncontrado": "string ou null"}`
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 100,
            temperature: 0
        });

        const resultado = JSON.parse(
            response.choices[0].message.content
                .replace(/```json|```/g, "")
                .trim()
        );

        console.log("GPT:", resultado);

        if (resultado.aprovado === true && resultado.nomeEncontrado) {
            const nomeIA = normalizarNome(resultado.nomeEncontrado);

            const index = listaAtual.findIndex(
                p => normalizarNome(p.nome) === nomeIA
            );

            if (index !== -1 && listaAtual[index].status !== "PAGO") {
                listaAtual[index].status = "PAGO";
                fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));

                console.log(`💰 Pagamento confirmado: ${listaAtual[index].nome}`);

                await formatarEEnviarLista(remetente, "Pagamento Atualizado");
            }
        }

    } catch (err) {
        console.error("Erro no processamento:", err?.response?.data || err);
    }
}

// =========================================================
// WEBHOOK ULTRAMSG
// =========================================================

app.post("/webhook", async (req, res) => {
    const data = req.body;

    console.log("WEBHOOK:", data);

    if (data.type === "message") {
        await processarMensagemUltra(data);
    }

    res.sendStatus(200);
});

app.get("/", (req, res) => {
    res.send("Bot UltraMsg ON");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Bot rodando na porta ${PORT}`));
