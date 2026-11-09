const WSClient = require("./src/classes/WSClient");
const selectAccount = require("./src/utils/selectAccount");
const { start } = require("./src/game");

(async () => {
  const account = await selectAccount();
  if (!account) {
    console.error("No account selected.");
    process.exit(1);
  }

  console.log(`Connecting to ${account.server}...`);
  const ws = new WSClient(account.server, account.username, account.password);

  try {
    await ws.connect();
  } catch (error) {
    console.error(`Could not join the game: ${error.message}`);
    process.exit(1);
  }

  start(account, ws);
})();
