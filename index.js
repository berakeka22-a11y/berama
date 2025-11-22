const express = require('express');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

const ARQUIVO_LISTA = './lista.json';

// --- FUNÇÕES DO BOT ---

function normalizarNome(nome) {
    if (!nome) return '';
    return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function enviarRespostaWhatsApp(destino, corpo, config) {
    try {
        const ultramsgAPI = axios.create({
            baseURL: `https://api.ultramsg.com/${config.ULTRAMSG_INSTANCE}`,
            params: { token: config.ULTRAMSG_TOKEN }
        });
        const payload = { to: destino, body: corpo };
        console.log(`Enviando mensagem para ${destino}...`);
        await ultramsgAPI.post('/messages/chat', payload);
        console.log("Mensagem enviada com sucesso.");
    } catch (error) {
        console.error("ERRO CRÍTICO AO ENVIAR MENSAGEM:", error.response ? error.response.data : error.message);
    }
}

async function formatarEEnviarLista(destino, titulo, config) {
    try {
        const listaDaMemoria = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        let mensagemLista = `📊 *${titulo}* 📊\n\n`;
        listaDaMemoria.forEach((pessoa, index) => {
            const statusIcon = pessoa.status === 'PAGO' ? '✅' : '⏳';
            mensagemLista += `${index + 1}. ${pessoa.nome} ${statusIcon}\n`;
        });
        mensagemLista += "\n---\n💳 *Forma de Pagamento*\nChave PIX: sagradoresenha@gmail.com\nReferência: Mauricio Carvalho";
        await enviarRespostaWhatsApp(destino, mensagemLista, config);
    } catch (error) {
        console.error("Erro ao formatar/enviar lista:", error.message);
    }
}

async function processarComando(comando, remetente, destino, config) {
    if (comando.toLowerCase() === '!resetar') {
        if (remetente !== `${config.ADMIN_NUMBER}@c.us`) {
            console.log(`Comando !resetar ignorado. Remetente não autorizado: ${remetente}`);
            return;
        }
        console.log("Comando !resetar recebido pelo admin. Resetando a lista...");
        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        listaAtual.forEach(pessoa => { pessoa.status = 'PENDENTE'; });
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));
        await formatarEEnviarLista(destino, "Lista de Pagamentos Resetada", config);
    }
}

async function processarMensagem(data, config) {
    try {
        const { type, from, body, media } = data;
        const destino = from;

        if (type === 'chat') {
            await processarComando(body, from, destino, config);
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

        const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
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
                await formatarEEnviarLista(destino, "Lista de Mensalistas Atualizada", config);
            }
        }
    } catch (error) {
        console.error("Erro GERAL no processarMensagem:", error.message);
    }
}

// --- ROTA DO WEBHOOK (O CORAÇÃO DA NOVA LÓGICA) ---
app.post('/webhook', (req, res) => {
    // 1. CARREGA AS VARIÁVEIS AQUI, NO MOMENTO DO USO
    const config = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY, 
        ULTRAMSG_INSTANCE: process.env.ULTRAMSG_INSTANCE,
        ULTRAMSG_TOKEN: process.env.ULTRAMSG_TOKEN,
        ADMIN_NUMBER: process.env.ADMIN_NUMBER
    };

    // 2. LOG DE DEPURAÇÃO: VAMOS VER O QUE O BOT ESTÁ REALMENTE VENDO
    console.log("--- INICIANDO DEPURAÇÃO DE VARIÁVEIS ---");
    console.log("OPENAI_API_KEY existe?", !!config.OPENAI_API_KEY);
    console.log("ULTRAMSG_INSTANCE existe?", !!config.ULTRAMSG_INSTANCE);
    console.log("ULTRAMSG_TOKEN existe?", !!config.ULTRAMSG_TOKEN);
    console.log("ADMIN_NUMBER existe?", !!config.ADMIN_NUMBER);
    console.log("--- FIM DA DEPURAÇÃO ---");

    // 3. VERIFICA SE AS CHAVES FORAM CARREGADAS
    if (!config.OPENAI_API_KEY || !config.ULTRAMSG_INSTANCE || !config.ULTRAMSG_TOKEN || !config.ADMIN_NUMBER) {
        console.error("ERRO CRÍTICO NO WEBHOOK: Uma ou mais variáveis de ambiente não foram carregadas a tempo.");
        return res.sendStatus(500); // Envia um erro para indicar a falha
    }

    // 4. SE TUDO ESTIVER OK, PROCESSA A MENSAGEM
    try {
        const data = req.body.data;
        if (data && !data.fromMe) {
            console.log("Webhook recebido:", JSON.stringify(data, null, 2));
            processarMensagem(data, config).catch(err => console.error("Erro não capturado no webhook:", err.message));
        }
        res.sendStatus(200); 
    } catch (error) {
        console.error("Erro fatal na rota do webhook:", error.message);
        res.sendStatus(500);
    }
});

// --- ROTA DE STATUS ---
app.get('/', (req, res) => {
    res.send('Bot de pagamentos (v21 - Anti-Race Condition) está online!');
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}.`);
});
