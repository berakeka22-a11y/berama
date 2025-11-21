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
const ADMIN_NUMBER = '5513991194730';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- FUNÇÕES PRINCIPAIS ---

// Função para normalizar nomes (remove acentos e deixa em minúsculas)
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

        // NOVO: Verifica se a imagem veio em base64 (essencial)
        const base64Image = data.message?.imageMessage?.jpegThumbnail || data.base64; // Tenta pegar o thumbnail ou o base64 direto
        if (!base64Image) {
            console.log("Imagem recebida, mas sem dados em base64. Verifique a configuração 'Webhook Base64' na Evolution API.");
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

async function enviarRespostaWhatsApp(jidDestino, texto) {
    try {
        // FORMATO DA MENSAGEM AJUSTADO PARA MAIOR COMPATIBILIDADE
        const payload = {
            number: jidDestino,
            textMessage: {
                text: texto
            }
        };
        await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCIA}`, payload, { 
            headers: { 
                'apikey': EVOLUTION_API_KEY,
                'Content-Type': 'application/json'
            } 
        });
    } catch (error) {
        console.error("Erro CRÍTICO ao enviar resposta via Evolution:", error.message);
        if (error.response) {
            console.error("Status da Resposta:", error.response.status);
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
    res.send('Bot de pagamentos (v3 - robusto) está online!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}.`);
});
