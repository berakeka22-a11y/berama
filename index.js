const express = require('express');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ===============================
//  VARIÁVEIS DE AMBIENTE
// ===============================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const INSTANCIA = process.env.INSTANCIA;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

const ARQUIVO_LISTA = './lista.json';

if (!OPENAI_API_KEY || !EVOLUTION_API_KEY || !EVOLUTION_URL || !INSTANCIA || !ADMIN_NUMBER) {
    console.error("❌ ERRO: Faltam variáveis de ambiente.");
    process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===============================
// FUNÇÕES PRINCIPAIS
// ===============================

function normalizarNome(nome) {
    if (!nome) return '';
    return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function enviarWhats(jid, texto) {
    try {
        const payload = { number: jid, text: texto };

        await axios.post(
            `${EVOLUTION_URL}/message/sendText/${INSTANCIA}`,
            payload,
            { headers: { apikey: EVOLUTION_API_KEY } }
        );
    } catch (err) {
        console.error("❌ Erro ao enviar mensagem:", err.response?.data || err.message);
    }
}

async function formatarEEnviarLista(jidDestino, titulo) {
    try {
        const lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));

        let msg = `📊 *${titulo}* 📊\n\n`;
        lista.forEach((pessoa, i) => {
            const icone = pessoa.status === 'PAGO' ? '✅' : '⏳';
            msg += `${i + 1}. ${pessoa.nome} ${icone}\n`;
        });

        msg += "\n🔑 *PIX:* sagradoresenha@gmail.com\n👤 *Mauricio Carvalho*";

        await enviarWhats(jidDestino, msg);
    } catch (err) {
        console.error("❌ Erro ao formatar lista:", err.message);
    }
}

async function processarComando(texto, remetente, jidDestino) {
    const numero = remetente.split("@")[0];

    if (texto.toLowerCase() === "!resetar") {
        if (numero !== ADMIN_NUMBER) return;

        let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, "utf8"));
        lista.forEach(p => p.status = "PENDENTE");
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));

        await formatarEEnviarLista(jidDestino, "Lista Resetada");
    }
}

// ===============================
// PROCESSAR MENSAGEM
// ===============================
async function processarMensagem(data) {
    try {
        const remoteJid = data.key.remoteJid;
        const tipo = data.messageType;
        const remetente = data.key.participant || remoteJid;

        // --------------------
        // TEXTO (comando)
        // --------------------
        const texto = data.message?.conversation || data.message?.extendedTextMessage?.text;

        if (texto) {
            await processarComando(texto, remetente, remoteJid);
            return;
        }

        // --------------------
        // IMAGEM
        // --------------------
        if (tipo !== "imageMessage") return;

        console.log("📥 Baixando imagem do Evolution...");

        const download = await axios.post(
            `${EVOLUTION_URL}/chat/downloadMedia`,
            data.message,
            {
                headers: { apikey: EVOLUTION_API_KEY },
                responseType: "arraybuffer"
            }
        );

        const base64 = Buffer.from(download.data).toString("base64");

        let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        const pendentes = lista.filter(p => p.status !== "PAGO").map(p => p.nome).join(", ");

        if (!pendentes) return;

        // --------------------
        // ENVIAR PRA OPENAI
        // --------------------
        const ai = await openai.chat.completions.create({
            model: "gpt-4o",
            max_tokens: 100,
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: `Analise comprovante. Valor deve ser 75.00. Nome deve ser um de: [${pendentes}]. Responda APENAS JSON: {"aprovado": true/false, "nomeEncontrado": "nome"}`
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: { url: `data:image/jpeg;base64,${base64}` }
                        }
                    ]
                }
            ]
        });

        const result = JSON.parse(
            ai.choices[0].message.content.replace(/```json|```/g, "").trim()
        );

        console.log("🤖 OpenAI:", result);

        if (result.aprovado && result.nomeEncontrado) {
            const nomeNorm = normalizarNome(result.nomeEncontrado);

            const index = lista.findIndex(
                p => normalizarNome(p.nome) === nomeNorm
            );

            if (index !== -1 && lista[index].status !== "PAGO") {
                lista[index].status = "PAGO";
                fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));

                console.log(`💾 Atualizado: ${lista[index].nome} = PAGO`);
                await formatarEEnviarLista(remoteJid, "Lista Atualizada");
            }
        }
    } catch (err) {
        console.error("❌ ERRO processarMensagem:", err.response?.data || err.message);
    }
}

// ===============================
// WEBHOOK
// ===============================
app.post("/webhook", (req, res) => {
    const data = req.body;

    if (data.event === "messages.upsert" && !data.data?.key?.fromMe) {
        processarMensagem(data.data);
    }

    res.sendStatus(200);
});

// ===============================
// ROOT
// ===============================
app.get("/", (req, res) => {
    res.send("Bot de pagamentos funcionando ✔ Porta 80");
});

// ===============================
// INICIAR SERVIDOR (PORTA 80)
// ===============================
app.listen(80, () => {
    console.log("🚀 Servidor rodando na porta 80");
});
