import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// CONFIG ULTRAMSG
const INSTANCE = "instance151755";
const TOKEN = "idyxynn5iaugvpj4";

// LISTA DE PAGAMENTOS
let pagamentos = [];

// WEBHOOK
app.post("/webhook", async (req, res) => {
    const data = req.body;

    // UltraMsg envia assim:
    const mensagem = data?.data?.body;
    const numero = data?.data?.from;

    if (!mensagem || !numero) {
        return res.sendStatus(200);
    }

    const texto = mensagem.toLowerCase().trim();

    // 👉 COMANDO: lista
    if (texto === "lista") {
        const resposta =
            pagamentos.length === 0
                ? "Nenhum pagamento registrado ainda."
                : "Pagamentos registrados:\n\n" +
                  pagamentos.map((p, i) => `${i + 1}. ${p}`).join("\n");

        await enviarMensagem(numero, resposta);
        return res.sendStatus(200);
    }

    // 👉 COMANDO: paguei NOME
    if (texto.startsWith("paguei")) {
        const nome = texto.replace("paguei", "").trim();

        if (!nome) {
            await enviarMensagem(numero, "Use assim:\n\npaguei João");
            return res.sendStatus(200);
        }

        pagamentos.push(nome);

        await enviarMensagem(
            numero,
            `Pagamento registrado com sucesso 🟢\n\nNome: *${nome}*`
        );

        return res.sendStatus(200);
    }

    // 👉 RESPOSTA PADRÃO
    const comandos = `Bem-vindo! Aqui estão os comandos:

• lista  
Mostra todos os pagamentos.

• paguei NOME  
Registra um pagamento.

Exemplo:  
paguei Carlos`;

    await enviarMensagem(numero, comandos);
    res.sendStatus(200);
});

// FUNÇÃO DE ENVIO ULTRAMSG
async function enviarMensagem(to, body) {
    try {
        await axios.post(
            `https://api.ultramsg.com/${INSTANCE}/messages/chat`,
            {
                token: TOKEN,
                to,
                body
            }
        );
    } catch (error) {
        console.error("Erro ao enviar mensagem:", error.response?.data || error);
    }
}

app.listen(3000, () =>
    console.log("🔥 BOT DE PAGAMENTOS ULTRAMSG RODANDO NA PORTA 3000 🔥")
);
