const express = require('express');
const fs = require('fs');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(express.json({ limit: '50mb' }));

// -----------------------------------------------------------------------------
// CONFIGURAÇÕES
// -----------------------------------------------------------------------------

// UltraMsg fixo (funciona mesmo com Easypanel bugado)
const ULTRAMSG_INSTANCE = "instance151755";
const ULTRAMSG_TOKEN = "idyxynn5iaugvpj4";

// Variáveis do ambiente
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

// Arquivo da lista
const ARQUIVO_LISTA = "./lista.json";

// -----------------------------------------------------------------------------
// INICIALIZAÇÃO
// -----------------------------------------------------------------------------

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const ultramsgAPI = axios.create({
    baseURL: `https://api.ultramsg.com/${ULTRAMSG_INSTANCE}`,
    params: { token: ULTRAMSG_TOKEN }
});

// -----------------------------------------------------------------------------
// FUNÇÕES DO BOT
// -----------------------------------------------------------------------------

function normalizarNome(nome) {
    if (!nome) return '';
    return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function enviarRespostaWhatsApp(destino, corpo) {
    try {
        console.log("→ Enviando resposta para", destino);
        await ultramsgAPI.post('/messages/chat', { to: destino, body: corpo });
        console.log("✔ Mensagem enviada");
    } catch (e) {
        console.log("Erro ao enviar:", e.response ? e.response.data : e.message);
    }
}

async function formatarEEnviarLista(destino, titulo) {
    try {
        const lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));

        let txt = `📊 *${titulo}* 📊\n\n`;
        lista.forEach((p, idx) => {
            const icone = p.status === "PAGO" ? "✅" : "⏳";
            txt += `${idx + 1}. ${p.nome} ${icone}\n`;
        });

        txt += "\n💳 Chave PIX: sagradoresenha@gmail.com\nReferência: Mauricio Carvalho";

        await enviarRespostaWhatsApp(destino, txt);
    } catch (e) {
        console.log("Erro formatar lista:", e.message);
    }
}

async function processarComando(body, remetente, destino) {
    if (body.toLowerCase() === "!resetar") {
        if (remetente !== `${ADMIN_NUMBER}@c.us`) {
            console.log("→ Reset bloqueado para não admin");
            return;
        }

        let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        lista.forEach(x => x.status = "PENDENTE");
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));

        await formatarEEnviarLista(destino, "Lista Resetada");
    }
}

async function processarMensagem(data) {
    try {
        const { type, from, body, media } = data;
        const destino = from;

        if (type === "chat") {
            return await processarComando(body, from, destino);
        }

        if (type !== "image") return;

        console.log("📸 Imagem recebida");

        const down = await axios.get(media, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(down.data).toString('base64');

        let lista = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        const pendentes = lista.filter(x => x.status !== "PAGO").map(x => x.nome);

        if (pendentes.length === 0) {
            console.log("Todos pagos");
            return;
        }

        const ia = await openai.chat.completions.create({
            model: "gpt-4o",
            max_tokens: 100,
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content:
                        `Analise o comprovante. Valor deve ser 75.00 e o nome um destes: [${pendentes.join(", ")}].
                         Responda SOMENTE JSON:
                         {"aprovado":true/false,"nomeEncontrado":"string ou null"}`
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

        const resultado = JSON.parse(
            ia.choices[0].message.content.replace(/```json|```/g, "").trim()
        );

        console.log("🔍 Análise:", resultado);

        if (resultado.aprovado && resultado.nomeEncontrado) {
            const nomeIA = normalizarNome(resultado.nomeEncontrado);
            const posicao = lista.findIndex(
                x => normalizarNome(x.nome) === nomeIA
            );

            if (posicao !== -1) {
                lista[posicao].status = "PAGO";
                fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(lista, null, 2));
                await formatarEEnviarLista(destino, "Lista Atualizada");
            }
        }

    } catch (e) {
        console.log("ERRO processarMensagem:", e.message);
    }
}

// -----------------------------------------------------------------------------
// WEBHOOK CORRIGIDO PARA ULTRAMSG
// -----------------------------------------------------------------------------

app.post("/webhook", (req, res) => {
    try {
        const body = req.body;

        console.log("📩 Webhook recebido:", JSON.stringify(body, null, 2));

        if (!body || !body.data) {
            console.log("⚠️ Webhook sem data");
            return res.sendStatus(200);
        }

        const data = body.data;

        if (data.fromMe) return res.sendStatus(200);

        processarMensagem(data);

        res.sendStatus(200);
    } catch (e) {
        console.log("Erro webhook:", e.message);
        res.sendStatus(500);
    }
});

// -----------------------------------------------------------------------------
// STATUS
// -----------------------------------------------------------------------------

app.get("/", (req, res) => {
    res.send("Bot pagamentos UltraMsg Online v1.0");
});

// -----------------------------------------------------------------------------
// INICIAR SERVIDOR
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Rodando porta", PORT));
