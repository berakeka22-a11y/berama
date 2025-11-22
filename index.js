const express = require('express');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- CONFIGURAÇÕES DO AMBIENTE ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const ULTRAMSG_INSTANCE = process.env.ULTRAMSG_INSTANCE;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

const ARQUIVO_LISTA = './lista.json';

if (!OPENAI_API_KEY || !ULTRAMSG_INSTANCE || !ULTRAMSG_TOKEN || !ADMIN_NUMBER) {
    console.error("ERRO CRÍTICO: Uma ou mais variáveis de ambiente não foram definidas. Verifique os nomes e valores no Easypanel.");
    process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const ultramsgAPI = axios.create({
    baseURL: `https://api.ultramsg.com/${ULTRAMSG_INSTANCE}`,
    params: { token: ULTRAMSG_TOKEN }
});

// --- FUNÇÕES DO BOT ---

function normalizarNome(nome) {
    if (!nome) return '';
    return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function enviarRespostaWhatsApp(destino, corpo) {
    try {
        const payload = { to: destino, body: corpo };
        console.log(`Enviando mensagem para ${destino}...`);
        await ultramsgAPI.post('/messages/chat', payload);
        console.log("Mensagem enviada com sucesso.");
    } catch (error) {
        console.error("ERRO CRÍTICO AO ENVIAR MENSAGEM:", error.response ? error.response.data : error.message);
    }
}

async function formatarEEnviarLista(destino, titulo) {
    try {
        const listaDaMemoria = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        let mensagemLista = `📊 *${titulo}* 📊\n\n`;
        listaDaMemoria.forEach((pessoa, index) => {
            const statusIcon = pessoa.status === 'PAGO' ? '✅' : '⏳';
            mensagemLista += `${index + 1}. ${pessoa.nome} ${statusIcon}\n`;
        });
        mensagemLista += "\n---\n💳 *Forma de Pagamento*\nChave PIX: sagradoresenha@gmail.com\nReferência: Mauricio Carvalho";
        await enviarRespostaWhatsApp(destino, mensagemLista);
    } catch (error) {
        console.error("Erro ao formatar/enviar lista:", error.message);
    }
}

async function processarComando(comando, remetente, destino) {
    if (comando.toLowerCase() === '!resetar') {
        if (remetente !== `${ADMIN_NUMBER}@c.us`) {
            console.log(`Comando !resetar ignorado. Remetente não autorizado: ${remetente}`);
            return;
        }
        console.log("Comando !resetar recebido pelo admin. Resetando a lista...");
        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        listaAtual.forEach(pessoa => { pessoa.status = 'PENDENTE'; });
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));
        await formatarEEnviarLista(destino, "Lista de Pagamentos Resetada");
    }
}

async function processarMensagem(data) {
    try {
        const { type, from, body, media } = data;
        const destino = from; // Responde para a origem (grupo ou privado)

        if (type === 'chat') {
            await processarComando(body, from, destino);
            return;
        }

        if (type !== 'image') return;

        console.log("Imagem recebida. URL:", media);
        
        const downloadResponse = await axios.get(media, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(downloadResponse.data).toString('base64');
        
        if (!base64Image) {
            console.log("Falha ao baixar ou converter a imagem.");
            return;
        }
        console.log("Imagem baixada. Enviando para análise da OpenAI...");

        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        const nomesPendentes = listaAtual.filter(c => c.status !== 'PAGO').map(c => c.nome).join(", ");
        if (!nomesPendentes) {
            console.log("Todos já pagaram. Ignorando comprovante.");
            return;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: `Analise o comprovante. Valor deve ser 75.00 e o nome um destes: [${nomesPendentes}]. Responda APENAS JSON: {"aprovado": boolean, "nomeEncontrado": "string ou null"}` },
                { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }
            ],
            max_tokens: 100, temperature: 0 
        });

        const resultado = JSON.parse(response.choices[0].message.content.replace(/```json|```/g, '').trim());
        console.log("Análise OpenAI:", resultado);

        if (resultado.aprovado === true && resultado.nomeEncontrado) {
            const nomeNormalizadoIA = normalizarNome(resultado.nomeEncontrado);
            const index = listaAtual.findIndex(c => normalizarNome(c.nome) === nomeNormalizadoIA);
            
            if (index !== -1 && listaAtual[index].status !== 'PAGO') {
                listaAtual[index].status = "PAGO";
                fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));
                console.log(`MEMÓRIA ATUALIZADA: ${listaAtual[index].nome} agora está PAGO.`);
                await formatarEEnviarLista(destino, "Lista de Mensalistas Atualizada");
            } else {
                console.log(`Nome "${resultado.nomeEncontrado}" encontrado, mas não está na lista de pendentes ou já foi pago.`);
            }
        }
    } catch (error) {
        console.error("Erro GERAL no processarMensagem:", error.message);
    }
}

// --- ROTA DO WEBHOOK ---
app.post('/webhook', (req, res) => {
    try {
        const data = req.body.data;
        if (data && !data.fromMe) {
            console.log("Webhook recebido:", JSON.stringify(data, null, 2));
            processarMensagem(data).catch(err => console.error("Erro não capturado no webhook:", err.message));
        }
        res.sendStatus(200); 
    } catch (error) {
        console.error("Erro fatal na rota do webhook:", error.message);
        res.sendStatus(500);
    }
});

// --- ROTA DE STATUS ---
app.get('/', (req, res) => {
    res.send('Bot de pagamentos (v19 - UltraMsg FINAL) está online!');
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}.`);
});
