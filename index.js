const express = require('express');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- CONFIGURAÇÕES BUSCADAS DO AMBIENTE ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY; 
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const INSTANCIA = process.env.INSTANCIA; 
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

const ARQUIVO_LISTA = './lista.json';

if (!OPENAI_API_KEY || !EVOLUTION_API_KEY || !EVOLUTION_URL || !INSTANCIA || !ADMIN_NUMBER) {
    console.error("ERRO CRÍTICO: Uma ou mais variáveis de ambiente não foram definidas.");
    process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- FUNÇÕES PRINCIPAIS ---

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
    const numeroRemetente = remetente.split('@')[0];
    if (comando.toLowerCase() === '!resetar') {
        if (numeroRemetente !== ADMIN_NUMBER) return;
        console.log("Comando !resetar recebido pelo admin. Resetando a lista...");
        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        listaAtual.forEach(pessoa => { pessoa.status = 'PENDENTE'; });
        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));
        await formatarEEnviarLista(jidDestino, "Lista de Pagamentos Resetada para o Novo Mês");
    }
}

// ############ A CORREÇÃO ESTÁ AQUI ############
async function processarMensagem(data) {
    try {
        const remoteJid = data.key.remoteJid; 
        const tipo = data.messageType;
        const remetente = data.key.participant || data.key.remoteJid;

        const textoMensagem = data.message?.conversation || data.message?.extendedTextMessage?.text;
        if (textoMensagem) {
            await processarComando(textoMensagem, remetente, remoteJid);
            return;
        }

        if (tipo !== 'imageMessage') return;

        // VOLTANDO AO MÉTODO SIMPLES: USAR A MINIATURA QUE JÁ VEM NA MENSAGEM
        // A opção "Webhook Base64" na Evolution API precisa estar ATIVADA.
        const base64Image = data.message?.imageMessage?.jpegThumbnail || data.base64;
        
        if (!base64Image) {
            console.log("ERRO: Imagem recebida, mas sem dados em base64. Ative a opção 'Webhook Base64' na sua instância da Evolution API.");
            return;
        }

        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        const nomesPendentes = listaAtual.filter(c => c.status !== 'PAGO').map(c => c.nome).join(", ");
        if (!nomesPendentes) return;

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: `Analise o comprovante. Valor deve ser 75.00 e o nome um destes: [${nomesPendentes}]. Responda APENAS JSON: {"aprovado": boolean, "nomeEncontrado": "string ou null"}` },
                { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] },
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
                await formatarEEnviarLista(remoteJid, "Lista de Mensalistas Atualizada");
            }
        }
    } catch (error) {
        console.error("Erro no processarMensagem:", error.message);
        if (error.response) {
            console.error("Detalhes do erro da API:", error.response.data);
        }
    }
}
// ############ FIM DA CORREÇÃO ############

async function enviarRespostaWhatsApp(jidDestino, texto) {
    try {
        const payload = { number: jidDestino, text: texto };
        await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCIA}`, payload, { 
            headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' } 
        });
    } catch (error) {
        console.error("Erro CRÍTICO ao enviar resposta via Evolution:", error.message);
        if (error.response) {
            console.error("Dados da Resposta:", JSON.stringify(error.response.data, null, 2));
        }
    }
}

app.post('/webhook', (req, res) => {
    const data = req.body;
    if (data.event === 'messages.upsert' && !data.data?.key?.fromMe) {
        processarMensagem(data.data).catch(err => console.error("Erro não capturado no webhook:", err));
    }
    res.sendStatus(200); 
});

app.get('/', (req, res) => {
    res.send('Bot de pagamentos (v10 - Simplificado) está online!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}.`);
});
