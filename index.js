const express = require("express");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));

const PORT = 80;

// Criar pasta comprovantes
const pasta = path.join(process.cwd(), "comprovantes");
if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);

app.post("/webhook", async (req, res) => {
    console.log("\n===== WEBHOOK RECEBIDO =====");
    console.log(JSON.stringify(req.body, null, 2));

    const data = req.body;

    // 1) TEXTO NORMAL
    if (data.type === "chat") {
        const numero = data.from;
        const texto = data.body;

        await enviarMensagem(numero, "Recebi sua mensagem! Envie o comprovante.");
        return res.sendStatus(200);
    }

    // 2) IMAGEM / COMPROVANTE
    if (data.type === "imageMessage") {
        const numero = data.from;
        const urlImagem = data.image;

        if (!urlImagem) {
            await enviarMensagem(numero, "Erro: imagem veio sem URL.");
            return res.sendStatus(200);
        }

        const nomeArquivo = `${Date.now()}_${numero.replace(/\D/g, "")}.jpg`;
        const caminho = path.join(pasta, nomeArquivo);

        try {
            const response = await axios({
                url: urlImagem,
                method: "GET",
                responseType: "stream"
            });

            const writer = fs.createWriteStream(caminho);
            response.data.pipe(writer);

            writer.on("finish", async () => {
                console.log("✔️ Comprovante salvo:", nomeArquivo);
                await enviarMensagem(numero, "Comprovante recebido e salvo!");
            });

            writer.on("error", (err) => console.log("Erro ao salvar imagem:", err));

        } catch (err) {
            console.log("Erro baixando imagem:", err);
        }

        return res.sendStatus(200);
    }

    return res.sendStatus(200);
});

// Função enviar mensagem
async function enviarMensagem(to, body) {
    try {
        await axios.post(
            "https://api.ultramsg.com/instance151755/messages/chat",
            new URLSearchParams({
                token: "idyxynn5iaugvpj4",
                to,
                body
            })
        );

        console.log("Resposta enviada para", to);
    } catch (err) {
        console.log("Erro ao enviar mensagem:", err?.response?.data || err);
    }
}

app.listen(PORT, () => {
    console.log("🔥 Servidor rodando na porta", PORT);
});
