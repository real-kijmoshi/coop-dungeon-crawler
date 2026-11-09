package main

import (
	"bytes"
	"compress/flate"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestSnapshotBurstKeepsLatestAndReliableEvents(t *testing.T) {
	upgrader := websocket.Upgrader{EnableCompression: true}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		ws.EnableWriteCompression(true)
		if _, _, err := ws.ReadMessage(); err != nil {
			return
		}
		ws.WriteJSON(map[string]any{"t": "welcome"})
		// Exceed the old 256-event FIFO while the UI deliberately consumes no states.
		for n := 0; n < 1000; n++ {
			ws.WriteJSON(map[string]any{"t": "gameState", "d": n})
			if n == 400 {
				ws.WriteJSON(map[string]any{"t": "message", "d": "loot"})
			}
		}
		ws.WriteJSON(map[string]any{"t": "message", "d": "done"})
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	c, err := Dial(server.URL, "test", "test")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	var messages []string
	for len(messages) < 2 {
		select {
		case ev := <-c.Events:
			if ev.T != "message" {
				t.Fatalf("unexpected event %s", ev.T)
			}
			var text string
			json.Unmarshal(ev.D, &text)
			messages = append(messages, text)
		case <-timer.C:
			t.Fatal("snapshot backlog blocked reliable messages")
		}
	}
	if strings.Join(messages, ",") != "loot,done" {
		t.Fatal(messages)
	}
	select {
	case ev := <-c.States:
		if string(ev.D) != "999" {
			t.Fatalf("stale snapshot: %s", ev.D)
		}
	default:
		t.Fatal("missing snapshot")
	}
	if len(c.States) != 0 {
		t.Fatal("snapshot queue grew")
	}
}

func TestApplicationCompressedNodeFrameWithoutWebSocketCompression(t *testing.T) {
	// Generated with Node zlib.deflateRawSync(level:1), not Go's encoder.
	payload, _ := hex.DecodeString("ab562a51b2524a4fcc4d0d2e492c4955d2514a51b2aa562a4bcc294d55b23231aaad0500")
	wire := append([]byte("CDC1"), payload...)
	upgrader := websocket.Upgrader{} // Deliberately no permessage-deflate.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		var auth struct {
			Features []string `json:"features"`
		}
		if err := ws.ReadJSON(&auth); err != nil {
			return
		}
		if len(auth.Features) != 1 || auth.Features[0] != "state-deflate-v1" {
			t.Error("client did not advertise application codec")
			return
		}
		ws.WriteJSON(map[string]any{"t": "welcome"})
		ws.WriteMessage(websocket.BinaryMessage, wire)
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	c, err := Dial(server.URL, "test", "test")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	select {
	case ev := <-c.States:
		if ev.T != "gameState" || string(ev.D) != `{"value":42}` {
			t.Fatalf("bad decoded Node frame: %s %s", ev.T, ev.D)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("application-compressed state was not received")
	}
}

func TestApplicationFrameRejectsCorruptionAndOversizedInflation(t *testing.T) {
	for _, raw := range [][]byte{[]byte("other"), append([]byte("CDC1"), 255, 255)} {
		if _, err := decodeWireMessage(websocket.BinaryMessage, raw); err == nil {
			t.Fatal("accepted corrupt binary state")
		}
	}
	var compressed bytes.Buffer
	w, _ := flate.NewWriter(&compressed, flate.BestSpeed)
	w.Write(bytes.Repeat([]byte("x"), maxStateBytes+1))
	w.Close()
	if _, err := decodeWireMessage(websocket.BinaryMessage, append([]byte("CDC1"), compressed.Bytes()...)); err == nil {
		t.Fatal("accepted oversized state")
	}
}
