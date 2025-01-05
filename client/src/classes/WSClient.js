const { io } = require("socket.io-client");

class WSClient {
  constructor(server, username, password) {
    this.server = server;
    this.username = username;
    this.password = password;
  }

  connect() {
    this.socket = io(this.server, {
      withCredentials: true,
      auth: {
        username: this.username,
        password: this.password,
      },
    });
  }
}

module.exports = WSClient;
