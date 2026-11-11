package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPinnedDirectInviteSupportsRegistrationAndWebSocket(t *testing.T) {
	upgrader := websocket.Upgrader{}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Fragment != "" || strings.Contains(r.RequestURI, "key=") {
			t.Error("public key fragment was sent in an HTTP request")
		}
		switch r.URL.Path {
		case "/register", "/login":
			if r.TLS == nil {
				t.Error("credentials sent without TLS")
			}
			var body map[string]string
			if json.NewDecoder(r.Body).Decode(&body) != nil || body["username"] != "test" {
				t.Error("authentication body lost")
			}
			w.WriteHeader(200)
			w.Write([]byte(`{"message":"ok"}`))
		case "/ws":
			ws, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer ws.Close()
			if _, _, err = ws.ReadMessage(); err != nil {
				return
			}
			ws.WriteJSON(map[string]any{"t": "welcome"})
			ws.WriteJSON(map[string]any{"t": "gameState", "d": 42})
			for {
				if _, _, err = ws.ReadMessage(); err != nil {
					return
				}
			}
		default:
			http.NotFound(w, r)
		}
	})
	server := httptest.NewTLSServer(handler)
	defer server.Close()
	digest := sha256.Sum256(server.Certificate().RawSubjectPublicKeyInfo)
	invite := server.URL + "/#key=" + hex.EncodeToString(digest[:])
	if err := register(invite, "test", "password"); err != nil {
		t.Fatal(err)
	}
	c, err := Dial(invite, "test", "password")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	select {
	case event := <-c.States:
		if string(event.D) != "42" {
			t.Fatal("wrong state")
		}
	case <-time.After(time.Second):
		t.Fatal("TLS WebSocket failed")
	}
	wrong := server.URL + "/#key=" + strings.Repeat("0", 64)
	if err := login(wrong, "test", "password"); err == nil {
		t.Fatal("accepted the wrong TLS public key")
	}
	if c, err := Dial(wrong, "test", "password"); err == nil {
		c.Close()
		t.Fatal("WebSocket accepted wrong TLS public key")
	}
	// The same self-signed host is never trusted without its invite key.
	if err := login(server.URL, "test", "password"); err == nil {
		t.Fatal("self-signed host accepted without invite key")
	}
}
func TestDirectPinParsingAndDowngradeRejection(t *testing.T) {
	for _, address := range []string{"http://example.com/#key=" + strings.Repeat("a", 64), "https://example.com/#key=bad", "https://example.com/#other=value", "https://user:pass@example.com/", "ftp://example.com/"} {
		if _, _, err := parseServerAddress(address); err == nil {
			t.Fatal("accepted invalid invite", address)
		}
	}
	address := "https://93.184.216.34:3143/#key=" + strings.Repeat("a", 64)
	wire, err := wsURL(address)
	if err != nil {
		t.Fatal(err)
	}
	if wire != "wss://93.184.216.34:3143/ws" {
		t.Fatal("invite leaked into websocket target", wire)
	}
}
