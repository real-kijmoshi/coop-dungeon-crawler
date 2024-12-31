const inquirer = require("inquirer");
const axios = require("axios").default;
const { existsSync, writeFileSync, readFileSync, mkdirSync } = require("fs");
const path = require("path");

const ACCOUNTS_FILE = path.join(__dirname, "..", "..", "data", "accounts.json");

if (!existsSync(ACCOUNTS_FILE)) {
  writeFileSync(ACCOUNTS_FILE, "[]");
}

let accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));

const saveAccounts = () => {
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts));
};

const login = async () => {
  console.clear();
  const { server, username, password } = await inquirer.prompt([
    {
      type: "input",
      name: "server",
      message: "Server address:",
      validate: input => input.trim() !== "" || "Server address cannot be empty"
    },
    {
      type: "input",
      name: "username",
      message: "Username:",
      validate: input => input.trim() !== "" || "Username cannot be empty"
    },
    {
      type: "password",
      name: "password",
      message: "Password:",
      validate: input => input.trim() !== "" || "Password cannot be empty"
    },
  ]);

  console.log(`Logging in to ${server} as ${username}...`);
  
  try {
    const res = await axios.post(`${server}/login`, {
      username,
      password,
    });

    if (res?.data?.message === "Login successful.") {
      console.clear();
      console.log("Success!");
      return {
        username,
        password,
        server,
      };
    }
  } catch (error) {
    console.error("Error while logging in:", error.message);
  }
  
  return false;
};

const register = async () => {
  console.clear();
  const { server, username, password } = await inquirer.prompt([
    {
      type: "input",
      name: "server",
      message: "Server address:",
      validate: input => input.trim() !== "" || "Server address cannot be empty"
    },
    {
      type: "input",
      name: "username",
      message: "Username:",
      validate: input => input.trim() !== "" || "Username cannot be empty"
    },
    {
      type: "password",
      name: "password",
      message: "Password:",
      validate: input => input.trim() !== "" || "Password cannot be empty"
    },
  ]);

  try {
    const res = await axios.post(`${server}/register`, {
      username,
      password,
    });

    if (res?.data?.message === "Registration successful.") {
      console.clear();
      console.log("Registration successful!");
      return {
        username,
        password,
        server,
      };
    }
  } catch (error) {
    console.error("Error while registering:", error.message);
  }

  return false;
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

  const res = action === "login" ? await login() : await register();
  
  if (res) {
    accounts.push(res);
    saveAccounts();
    return res;
  }
  return false;
};

const loop = async () => {
  console.clear();
  const { account } = await inquirer.prompt([
    {
      type: "list",
      name: "account",
      message: "Which account do you want to use?",
      choices: [...accounts.map(a => `${a.username} - ${a.server}`), "new account"]
    },
  ]);

  if (account === "new account") {
    const result = await newAccount();
    if (!result) {
      console.log("Failed to create new account. Please try again.");
      return loop();
    }
    return result;
  }

  const [username, server] = account.split(" - ");
  const selectedAccount = accounts.find(
    a => a.username === username && a.server === server
  );
  return selectedAccount || loop();
};

const accountManager = async () => {
  try {
    if (!accounts.length) {
      const newAcc = await newAccount();
      if (newAcc) {
        return await loop();
      }
    }
    return await loop();
  } catch (error) {
    console.error("An error occurred:", error);
    return null;
  }
};

module.exports = accountManager;