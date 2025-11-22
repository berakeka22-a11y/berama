import express from "express";
import fs from "fs";
import axios from "axios";
import path from "path";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));

const PORT = 80;

// Criar pasta de comprovantes se não existir
const pasta = path.join(process.cwd(), "comprovantes");
if (!fs.existsSync(pasta)) fs.mkdirSync(pasta);

// Webhook do UltraMSG
app.post("/webhook", async (req, res) => {
    console.log("\n===== RECEBIDO DO ULTRAMSG =====");
    console.log(JSON.stringify(req.body, null, 2));

    const data = req.body;

    // 1) Mensagem de texto
    if (data.type === "chat") {
        const texto = data.body;
        const numero = data.from;

        console.log(`Mensagem de TEXTO recebida de ${numero}: ${texto}`);

        await enviarMensagem(numero, "Recebi sua mensagem! Envie o comprovante para validar.");
        return res.sendStatus(200);
    }

    // 2) Mensagem de imagem (COMPROVANTE)
    if (data.type === "imageMessage") {
        try {
            const numero = data.from;
            const urlImagem = data.image;

            console.log("📸 Recebido comprovante:", urlImagem);

            if (!urlImagem) {
                console.log("ERRO: webhook mandou imagem sem URL");
                await enviarMensagem(numero, "Erro ao receber a imagem.");
                return res.sendStatus(200);
            }

            // Baixar a imagem
            const nomeArquivo = `${Date.now()}_${numero.replace(/\D/g, "")}.jpg`;
            const caminhoSalvar = path.join(pasta, nomeArquivo);

            const response = await axios({
                url: urlImagem,
                method: "GET",
                responseType: "stream",
            });

            const writer = fs.createWriteStream(caminhoSalvar);
            response.data.pipe(writer);

            writer.on("finish", async () => {
                console.log("✔️ Comprovante salvo:", nomeArquivo);
                await enviarMensagem(numero, "Comprovante recebido e salvo com sucesso!");
            });

            writer.on("error", (err) => console.log("Erro ao salvar arquivo:", err));

        } catch (err) {
            console.error("ERRO ao processar imagem:", err);
        }

        return res.sendStatus(200);
    }

    res.sendStatus(200);
});

// Função para enviar mensagem
async function enviarMensagem(to, body) {
    try {
        await axios.post(
            "https://api.ultramsg.com/instance151755/messages/chat",
            new URLSearchParams({
                token: "idyxynn5iaugvpj4",
                to,
                body,
            })
        );
        console.log("✔️ Resposta enviada para", to);
    } catch (err) {
        console.error("Erro ao enviar mensagem:", err.response?.data || err);
    }
}

// Iniciar servidor
app.listen(PORT, () => {
    console.log("🔥 Servidor rodando na porta", PORT);
});
