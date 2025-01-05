const WSClient = require("./src/classes/WSClient");
const selectAccount = require("./src/utils/selectAccount");
const { start } = require("./src/game");

(async () => {
  const account = await selectAccount();
  const ws = new WSClient(account.server, account.username, account.password);

  ws.connect();

  ws.socket.once("connect", () => {
    console.clear();
    start(account, ws);
  });
})();
