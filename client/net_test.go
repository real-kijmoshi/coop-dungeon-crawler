package main

import (
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
