package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// NetEvent is something that arrived from the server, delivered to the game loop.
type NetEvent struct {
	T     string
	D     json.RawMessage
	reply func(json.RawMessage) // set for request replies
}

// Conn is a WebSocket connection speaking the server's JSON protocol.
type Conn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
	mu      sync.Mutex
	nextID  int
	pending map[int]func(json.RawMessage)
	Events  chan NetEvent
}

type frame struct {
	T  string          `json:"t"`
	D  json.RawMessage `json:"d,omitempty"`
	ID *int            `json:"id,omitempty"`
}

// wsURL turns "http://host:port" (or a bare "host:port") into "ws://host:port/ws".
func wsURL(server string) (string, error) {
	if !strings.Contains(server, "://") {
		server = "http://" + server
	}
	u, err := url.Parse(server)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https", "wss":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/ws"
	return u.String(), nil
}

// Dial connects and authenticates. It returns once the server accepted the login.
func Dial(server, username, password string) (*Conn, error) {
	addr, err := wsURL(server)
	if err != nil {
		return nil, err
	}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	ws, _, err := dialer.Dial(addr, nil)
	if err != nil {
		return nil, fmt.Errorf("could not reach %s: %w", server, err)
	}
	auth, _ := json.Marshal(map[string]any{
		"t": "auth",
		"d": map[string]string{"username": username, "password": password},
	})
	if err := ws.WriteMessage(websocket.TextMessage, auth); err != nil {
		ws.Close()
		return nil, err
	}
	ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, raw, err := ws.ReadMessage()
	if err != nil {
		ws.Close()
		return nil, fmt.Errorf("no answer from server: %w", err)
	}
	ws.SetReadDeadline(time.Time{})
	var f frame
	if err := json.Unmarshal(raw, &f); err != nil {
		ws.Close()
		return nil, err
	}
	if f.T != "welcome" {
		ws.Close()
		var reason string
		_ = json.Unmarshal(f.D, &reason)
		if reason == "" {
			reason = "login rejected"
		}
		return nil, errors.New(reason)
	}

	c := &Conn{ws: ws, pending: map[int]func(json.RawMessage){}, Events: make(chan NetEvent, 256)}
	go c.readLoop()
	return c, nil
}

func (c *Conn) readLoop() {
	defer func() {
		c.Events <- NetEvent{T: "_closed"}
	}()
	for {
		_, raw, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		var f frame
		if json.Unmarshal(raw, &f) != nil {
			continue
		}
		if f.T == "reply" && f.ID != nil {
			c.mu.Lock()
			cb := c.pending[*f.ID]
			delete(c.pending, *f.ID)
			c.mu.Unlock()
			if cb != nil {
				c.Events <- NetEvent{T: "_reply", D: f.D, reply: cb}
			}
			continue
		}
		c.Events <- NetEvent{T: f.T, D: f.D}
	}
}

func (c *Conn) write(t string, args []any, id *int) {
	if args == nil {
		args = []any{}
	}
	msg := map[string]any{"t": t, "a": args}
	if id != nil {
		msg["id"] = *id
	}
	raw, _ := json.Marshal(msg)
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_ = c.ws.WriteMessage(websocket.TextMessage, raw)
}

// Send fires an event without waiting for an answer.
func (c *Conn) Send(t string, args ...any) {
	c.write(t, args, nil)
}

// Request sends an event; cb runs on the game loop when the reply arrives.
func (c *Conn) Request(t string, cb func(json.RawMessage), args ...any) {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	c.pending[id] = cb
	c.mu.Unlock()
	c.write(t, args, &id)
}

func (c *Conn) Close() {
	c.ws.Close()
}
