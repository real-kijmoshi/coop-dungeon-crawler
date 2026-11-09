package main

import (
	"bytes"
	"compress/flate"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const maxStateBytes = 4 * 1024 * 1024

// Application compression remains effective when a tunnel does not negotiate
// WebSocket permessage-deflate. Legacy JSON text frames still work unchanged.
func decodeWireMessage(messageType int, raw []byte) ([]byte, error) {
	if messageType == websocket.TextMessage {
		return raw, nil
	}
	if messageType != websocket.BinaryMessage || !bytes.HasPrefix(raw, []byte("CDC1")) {
		return nil, errors.New("unsupported binary game frame")
	}
	r := flate.NewReader(bytes.NewReader(raw[4:]))
	defer r.Close()
	decoded, err := io.ReadAll(io.LimitReader(r, maxStateBytes+1))
	if err != nil {
		return nil, err
	}
	if len(decoded) > maxStateBytes {
		return nil, errors.New("game frame exceeds decompression limit")
	}
	return decoded, nil
}

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
	States  chan NetEvent // latest snapshot only; reliable events keep their FIFO
}

type frame struct {
	T  string          `json:"t"`
	D  json.RawMessage `json:"d,omitempty"`
	ID *int            `json:"id,omitempty"`
}

// wsURL turns "http://host:port" (or a bare "host:port") into "ws://host:port/ws".
func wsURL(server string) (string, error) {
	u, _, err := parseServerAddress(server)
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
	_, pin, err := parseServerAddress(server)
	if err != nil {
		return nil, err
	}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second, EnableCompression: true, Proxy: http.ProxyFromEnvironment, TLSClientConfig: serverTLSConfig(pin)}
	ws, _, err := dialer.Dial(addr, nil)
	if err != nil {
		return nil, fmt.Errorf("could not reach %s: %w", server, err)
	}
	ws.SetReadLimit(maxStateBytes)
	auth, _ := json.Marshal(map[string]any{
		"t":        "auth",
		"d":        map[string]string{"username": username, "password": password},
		"features": []string{"state-deflate-v1"},
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

	c := &Conn{ws: ws, pending: map[int]func(json.RawMessage){}, Events: make(chan NetEvent, 256), States: make(chan NetEvent, 1)}
	go c.readLoop()
	return c, nil
}

func (c *Conn) readLoop() {
	defer func() {
		c.ws.Close()
		c.Events <- NetEvent{T: "_closed"}
	}()
	for {
		messageType, raw, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		raw, err = decodeWireMessage(messageType, raw)
		if err != nil {
			return
		}
		var f frame
		if json.Unmarshal(raw, &f) != nil {
			continue
		}
		if f.T == "gameState" {
			c.queueState(NetEvent{T: f.T, D: f.D})
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

// Only readLoop produces snapshots. Replace an unconsumed frame instead of
// making the UI play through stale positions after a burst or a slow redraw.
func (c *Conn) queueState(ev NetEvent) {
	select {
	case c.States <- ev:
	default:
		select {
		case <-c.States:
		default:
		}
		c.States <- ev
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
