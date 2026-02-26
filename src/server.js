import "dotenv/config";
import express from "express";
import { buildBot } from "./bot.js";

const app = express();
app.get("/", (_, res) => res.status(200).send("OK"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("API running on port", PORT));

// Polling (simplest for Railway)
const bot = buildBot();
bot.start({
  onStart: () => console.log("Telegram bot started (polling).")
});
