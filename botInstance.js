// Shared bot instance - initialized by bot.js
let botInstance = null;

function setBot(bot) {
  botInstance = bot;
}

function getBot() {
  return botInstance;
}

module.exports = { setBot, getBot };
