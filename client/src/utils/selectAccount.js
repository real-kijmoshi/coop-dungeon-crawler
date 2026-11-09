const inquirer = require("inquirer");
const axios = require("axios").default;
const { existsSync, writeFileSync, readFileSync, mkdirSync } = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const DEFAULT_SERVER = "http://localhost:3143";

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(ACCOUNTS_FILE)) writeFileSync(ACCOUNTS_FILE, "[]");

let accounts = [];
try {
  accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  if (!Array.isArray(accounts)) accounts = [];
} catch {
  accounts = [];
}

const saveAccounts = () => {
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
};

const normalizeServer = (server) => {
  server = server.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(server)) server = `http://${server}`;
  return server;
};

const askCredentials = () =>
  inquirer.prompt([
    {
      type: "input",
      name: "server",
      message: "Server address:",
      default: DEFAULT_SERVER,
      validate: (input) =>
        input.trim() !== "" || "Server address cannot be empty",
    },
    {
      type: "input",
      name: "username",
      message: "Username:",
      validate: (input) => input.trim() !== "" || "Username cannot be empty",
    },
    {
      type: "password",
      name: "password",
      message: "Password:",
      mask: "*",
      validate: (input) => input.trim() !== "" || "Password cannot be empty",
    },
  ]);

const errorMessage = (error) =>
  error?.response?.data?.message || error.message || String(error);

const authenticate = async (action) => {
  console.clear();
  let { server, username, password } = await askCredentials();
  server = normalizeServer(server);
  username = username.trim();

  try {
    if (action === "register") {
      console.log(`Registering ${username} on ${server}...`);
      await axios.post(`${server}/register`, { username, password });
    }
    console.log(`Logging in to ${server} as ${username}...`);
    await axios.post(`${server}/login`, { username, password });
    return { username, password, server };
  } catch (error) {
    console.error(`Failed to ${action}: ${errorMessage(error)}`);
    await inquirer.prompt([
      { type: "input", name: "ok", message: "Press enter to continue" },
    ]);
    return false;
  }
};

const newAccount = async () => {
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What do you want to do?",
      choices: ["login", "register"],
    },
  ]);

  const res = await authenticate(action);
  if (!res) return false;

  accounts = accounts.filter(
    (a) => !(a.username === res.username && a.server === res.server),
  );
  accounts.push(res);
  saveAccounts();
  return res;
};

const loop = async () => {
  console.clear();
  const { index } = await inquirer.prompt([
    {
      type: "list",
      name: "index",
      message: "Which account do you want to use?",
      choices: [
        ...accounts.map((a, i) => ({
          name: `${a.username} - ${a.server}`,
          value: i,
        })),
        { name: "new account", value: -1 },
      ],
    },
  ]);

  if (index === -1) {
    const result = await newAccount();
    return result || loop();
  }
  return accounts[index];
};

const accountManager = async () => {
  try {
    if (!accounts.length) {
      const acc = await newAccount();
      if (acc) return acc;
    }
    return await loop();
  } catch (error) {
    console.error("An error occurred:", error);
    return null;
  }
};

module.exports = accountManager;
