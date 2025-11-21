const express = require('express');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- SUAS CREDENCIAIS E CONFIGURAÇÕES ---
const OPENAI_API_KEY = "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"; 
const EVOLUTION_API_KEY = "429683C4C977415CAAFCCE10F7D57E11"; 
const EVOLUTION_URL = "https://tutoriaisdigitais-evolution-api.ksyx1x.easypanel.host";
const INSTANCIA = "bera"; 
const ARQUIVO_LISTA = './lista.json';
const ADMIN_NUMBER = '5513991194730'; // SEU NÚMERO DE ADMIN JÁ CONFIGURADO

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- FUNÇÕES PRINCIPAIS ---

async function formatarEEnviarLista(jidDestino, titulo) {
    const listaDaMemoria = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));

    let mensagemLista = `📊 *${titulo}* 📊\n\n`;
    listaDaMemoria.forEach((pessoa, index) => {
        const statusIcon = pessoa.status === 'PAGO' ? '✅' : '⏳';
        mensagemLista += `${index + 1}. ${pessoa.nome} ${statusIcon}\n`;
    });

    mensagemLista += "\n---\n💳 *Forma de Pagamento*\nChave PIX: sagradoresenha@gmail.com\nReferência: Mauricio Carvalho";
    await enviarRespostaWhatsApp(jidDestino, mensagemLista);
}

async function processarComando(comando, remetente, jidDestino) {
    const numeroRemetente = remetente.split('@')[0];

    if (comando.toLowerCase() === '!resetar') {
        if (numeroRemetente !== ADMIN_NUMBER) {
            console.log(`Tentativa de uso do comando !resetar por não-admin: ${numeroRemetente}`);
            return;
        }

        console.log("Comando !resetar recebido pelo admin. Resetando a lista...");
        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));

        listaAtual.forEach(pessoa => {
            pessoa.status = 'PENDENTE';
        });

        fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));

        await formatarEEnviarLista(jidDestino, "Lista de Pagamentos Resetada para o Novo Mês");
    }
}

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

        let listaAtual = JSON.parse(fs.readFileSync(ARQUIVO_LISTA, 'utf8'));
        const nomesPendentes = listaAtual.filter(c => c.status !== 'PAGO').map(c => c.nome).join(", ");
        if (!nomesPendentes) return;

        const imageUrl = data.message.imageMessage.url;
        if (!imageUrl) return;

        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', headers: { apikey: EVOLUTION_API_KEY } });
        const base64Image = Buffer.from(imageResponse.data).toString('base64');

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
            const index = listaAtual.findIndex(c => c.nome.toLowerCase() === resultado.nomeEncontrado.toLowerCase());

            if (index !== -1 && listaAtual[index].status !== 'PAGO') {
                listaAtual[index].status = "PAGO";
                fs.writeFileSync(ARQUIVO_LISTA, JSON.stringify(listaAtual, null, 2));
                console.log(`MEMÓRIA ATUALIZADA: ${resultado.nomeEncontrado} agora está PAGO.`);

                await formatarEEnviarLista(remoteJid, "Lista de Mensalistas Atualizada");
            }
        }
    } catch (error) {
        console.error("Erro:", error.message);
    }
}

async function enviarRespostaWhatsApp(jidDestino, texto) {
    try {
        await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCIA}`, {
            number: jidDestino,
            options: { delay: 1500, presence: "composing" },
            textMessage: { text: texto }
        }, { headers: { apikey: EVOLUTION_API_KEY } });
    } catch (error) {
        console.error("Erro ao enviar resposta:", error.response?.data || error.message);
    }
}

app.post('/webhook', (req, res) => {
    const data = req.body;
    if (data.event === 'messages.upsert' && !data.data?.key?.fromMe) {
        processarMensagem(data.data).catch(err => console.error("Erro não capturado:", err));
    }
    res.sendStatus(200); 
});

app.get('/', (req, res) => {
    res.send('Bot de pagamentos (com comando !resetar) está online!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}.`);
});
