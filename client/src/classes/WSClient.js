const { io } = require("socket.io-client");

class WSClient {
  constructor(server, username, password) {
    this.server = server;
    this.username = username;
    this.password = password;
    this.socket = null;
  }

  /**
   * Connects and resolves once the server accepted the credentials.
   * Rejects with the server's error message otherwise.
   */
  connect(timeoutMs = 10000) {
    this.socket = io(this.server, {
      auth: {
        username: this.username,
        password: this.password,
      },
      reconnection: true,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.socket.disconnect();
        reject(new Error(`Timed out connecting to ${this.server}`));
      }, timeoutMs);

      const onConnect = () => {
        cleanup();
        resolve(this.socket);
      };
      const onError = (err) => {
        cleanup();
        this.socket.disconnect();
        reject(err);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off("connect", onConnect);
        this.socket.off("connect_error", onError);
      };

      this.socket.once("connect", onConnect);
      this.socket.once("connect_error", onError);
    });
  }
}

module.exports = WSClient;
