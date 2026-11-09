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

func accountsPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "coop-dungeon-crawler", "accounts.json")
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
	res, err := httpClient.Post(server+"/"+endpoint, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("could not reach %s", server)
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
