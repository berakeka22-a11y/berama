// ======================================
// BOT PAGAMENTOS – MODO DIAGNÓSTICO
// MOSTRA O WEBHOOK COMPLETO NOS LOGS
// ======================================

import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// ENV
const PORT = process.env.PORT || 80;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const INSTANCIA = process.env.INSTANCIA;

// ======================================
// TESTE
// ======================================
app.get("/", (req, res) => {
  res.send("BOT ONLINE – DIAGNÓSTICO ATIVO");
});

// ======================================
// WEBHOOK – MOSTRA TUDO QUE CHEGA
// ======================================
app.post("/webhook", async (req, res) => {
  console.log("📩 WEBHOOK RECEBIDO:");
  console.log(JSON.stringify(req.body, null, 2)); // << MOSTRA TUDO

  // Responde para o Evolution imediatamente
  res.sendStatus(200);

  // NÃO PROCESSA MAIS NADA!
  // Só queremos ver o conteúdo REAL enviado pela Evolution.
});

// ======================================
// INICIAR SERVIDOR
// ======================================
app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
  console.log("Instância:", INSTANCIA);
});
