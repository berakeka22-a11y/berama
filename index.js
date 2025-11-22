const express = require('express');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- CONFIGURAÇÕES DO AMBIENTE (AGORA PARA ULTRAMSG) ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

const ARQUIVO_LISTA = './lista.json';

if (!OPENAI_API_KEY || !ULTRAMSG_INSTANCE_ID || !ULTRAMSG_TOKEN || !ADMIN_NUMBER) {
    console.error("ERRO CRÍTICO: Uma ou mais variáveis de ambiente não foram definidas.");
    process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const ultramsgAPI = axios.create({
    baseURL: 'https://api.ultramsg.com',
    params: { token: ULTRAMSG_TOKEN }
});

// --- FUNÇÕES PRINCIPAIS (A LÓGICA DO BOT) ---

function normalizarNome(nome) {
    if (!nome) return '';
    return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function formatarEEnviarLista(jidDestino, titulo) {
    try {
        const listaDaMemoria = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        let mensagemLista = `📊 *${titulo}* 📊\n\n`;
        listaDaMemoria.forEach((pessoa, index) => {
            const statusIcon = pessoa.status === 'PAGO' ? '✅' : '⏳';
            mensagemLista += `${index + 1}. ${pessoa.nome} ${statusIcon}\n`;
        });
        mensagemLista += "\n---\n💳 *Forma de Pagamento*\nChave PIX: sagradoresenha@gmail.com\nReferência: Mauricio Carvalho";
        await enviarRespostaWhatsApp(jidDestino, mensagemLista);
    } catch (error) {
        console.error("Erro ao formatar ou enviar lista:", error.message);
    }
}

async function processarComando(comando, remetente, jidDestino) {
    if (comando.toLowerCase() === '!resetar') {
        if (remetente !== `${ADMIN_NUMBER}@c.us`) return;
        console.log("Comando !resetar recebido pelo admin. Resetando a lista...");
        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        listaAtual.forEach(pessoa => { pessoa.status = 'PENDENTE'; });
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));
        await formatarEEnviarLista(jidDestino, "Lista de Pagamentos Resetada para o Novo Mês");
    }
}

// ############ CÓDIGO FINAL E DEFINITIVO (v18) - ADAPTADO PARA ULTRAMSG ############
async function processarMensagem(data) {
    try {
        const { type, from, body, media } = data;
        const jidDestino = from.includes('@g.us') ? from : from; // Responde no grupo ou no privado

        // Processa comandos de texto
        if (type === 'chat') {
            await processarComando(body, from, jidDestino);
            return;
        }

        // Processa apenas imagens
        if (type !== 'image') return;

        console.log("Imagem recebida. URL da mídia:", media);
        
        // A UltraMsg já nos dá a URL pública da imagem. É muito mais simples!
        const downloadResponse = await axios.get(media, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(downloadResponse.data).toString('base64');
        
        if (!base64Image) {
            console.log("Falha ao baixar ou converter a imagem.");
            return;
        }
        console.log("Imagem baixada e convertida para base64 com sucesso.");

        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        const nomesPendentes = listaAtual.filter(c => c.status !== 'PAGO').map(c => c.nome).join(", ");
        if (!nomesPendentes) return;

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
                await formatarEEnviarLista(jidDestino, "Lista de Mensalistas Atualizada");
            }
        }
    } catch (error) {
        console.error("Erro no processarMensagem:", error.message);
        if (error.response) {
            console.error("Detalhes do erro da API:", error.response.data);
        }
    }
}
// ############ FIM DO CÓDIGO FINAL ############

async function enviarRespostaWhatsApp(jidDestino, texto) {
    try {
        const payload = { to: jidDestino, body: texto };
        await ultramsgAPI.post(`/${ULTRAMSG_INSTANCE_ID}/messages/chat`, payload);
    } catch (error) {
        console.error("Erro CRÍTICO ao enviar resposta via UltraMsg:", error.message);
        if (error.response) {
            console.error("Dados da Resposta:", JSON.stringify(error.response.data, null, 2));
        }
    }
}

app.post('/webhook', (req, res) => {
    // A UltraMsg envia os dados dentro de 'data'
    const data = req.body.data;
    if (data && !data.fromMe) {
        processarMensagem(data).catch(err => console.error("Erro não capturado no webhook:", err));
    }
    res.sendStatus(200); 
});

app.get('/', (req, res) => {
    res.send('Bot de pagamentos (v18 - UltraMsg) está online!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}.`);
});
