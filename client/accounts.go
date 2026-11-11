package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultServer = "http://localhost:3143"

type Account struct {
	Server   string `json:"server"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func configDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "coop-dungeon-crawler")
}

func accountsPath() string {
	return filepath.Join(configDir(), "accounts.json")
}

// preferredServer is the server the installer set as default, if any.
func preferredServer() string {
	raw, err := os.ReadFile(filepath.Join(configDir(), "server"))
	if err != nil {
		return defaultServer
	}
	if s := strings.TrimSpace(string(raw)); s != "" {
		return normalizeServer(s)
	}
	return defaultServer
}

func loadAccounts() []Account {
	var list []Account
	raw, err := os.ReadFile(accountsPath())
	if err == nil {
		_ = json.Unmarshal(raw, &list)
	}
	return list
}

func saveAccounts(list []Account) error {
	p := accountsPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(list, "", "  ")
	return os.WriteFile(p, raw, 0o600)
}

// rememberAccount puts acc first in the saved list, replacing an older entry.
func rememberAccount(list []Account, acc Account) []Account {
	out := []Account{acc}
	for _, a := range list {
		if a.Server != acc.Server || a.Username != acc.Username {
			out = append(out, a)
		}
	}
	return out
}

func normalizeServer(s string) string {
	s = strings.TrimRight(strings.TrimSpace(s), "/")
	if s == "" {
		return defaultServer
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	return s
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

// postAuth calls /login or /register and returns the server's message on failure.
func postAuth(server, endpoint, username, password string) error {
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	client, base, err := authClient(server)
	if err != nil {
		return err
	}
	if client != httpClient {
		defer client.CloseIdleConnections()
	}
	base.Path += "/" + endpoint
	res, err := client.Post(base.String(), "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("could not reach %s: %w", server, err)
	}
	defer res.Body.Close()
	var out struct {
		Message string `json:"message"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode >= 300 {
		if out.Message == "" {
			out.Message = res.Status
		}
		return errors.New(out.Message)
	}
	return nil
}

func register(server, username, password string) error {
	if err := postAuth(server, "register", username, password); err != nil {
		return err
	}
	return postAuth(server, "login", username, password)
}

func login(server, username, password string) error {
	return postAuth(server, "login", username, password)
}

// HeroInfo is the summary the account screen shows for a saved hero.
type HeroInfo struct {
	Username  string  `json:"username"`
	Cls       *string `json:"cls"`
	Title     *string `json:"title"`
	Level     int     `json:"level"`
	Prestige  int     `json:"prestige"`
	Gold      int     `json:"gold"`
	Kills     int     `json:"kills"`
	Deaths    int     `json:"deaths"`
	BossKills int     `json:"bossKills"`
	MaxDepth  int     `json:"maxDepth"`
	Online    bool    `json:"online"`
}

// postJSON sends credentials (plus extra fields) to an account endpoint.
func postJSON(server, endpoint string, fields map[string]string, out any) error {
	body, _ := json.Marshal(fields)
	client, base, err := authClient(server)
	if err != nil {
		return err
	}
	if client != httpClient {
		defer client.CloseIdleConnections()
	}
	base.Path += endpoint
	res, err := client.Post(base.String(), "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("could not reach %s", hostOf(server))
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return errors.New("this server is too old for account management")
	}
	if res.StatusCode >= 300 {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(res.Body).Decode(&e)
		if e.Message == "" {
			e.Message = res.Status
		}
		return errors.New(e.Message)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

func heroInfo(a Account) (*HeroInfo, error) {
	var h HeroInfo
	err := postJSON(a.Server, "/account/info", map[string]string{"username": a.Username, "password": a.Password}, &h)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func changePassword(a Account, newPassword string) error {
	return postJSON(a.Server, "/account/password", map[string]string{"username": a.Username, "password": a.Password, "newPassword": newPassword}, nil)
}

func deleteHero(a Account, confirm string) error {
	return postJSON(a.Server, "/account/delete", map[string]string{"username": a.Username, "password": a.Password, "confirm": confirm}, nil)
}

// Class looks for the account screen (matches the server's class colors).
var classLooks = map[string]struct {
	Name  string
	Color Color
}{
	"warrior": {"Warrior", Color{255, 120, 80}},
	"rogue":   {"Rogue", Color{180, 255, 120}},
	"mage":    {"Mage", Color{140, 170, 255}},
	"cleric":  {"Cleric", Color{255, 240, 150}},
}
