package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDirectIdentityPersists(t *testing.T) {
	root := t.TempDir()
	first, err := loadDirectIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := loadDirectIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.pin) != 64 || first.pin != second.pin {
		t.Fatal("direct identity changed after restart")
	}
	cert, _ := x509.ParseCertificate(first.cert.Certificate[0])
	hash := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
	if first.pin != hex.EncodeToString(hash[:]) {
		t.Fatal("invite does not identify TLS key")
	}
	if _, err := os.Stat(filepath.Join(root, "tls", "host-key.pem")); err != nil {
		t.Fatal(err)
	}
}
func TestDirectHTTPSProxyForwardsAndPreservesHTTPS(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Forwarded-Proto") != "https" {
			t.Error("wrong public protocol")
		}
		io.WriteString(w, "encrypted dungeon")
	}))
	defer backend.Close()
	identity, err := loadDirectIdentity(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server, done, err := newDirectServer(listener, backend.URL, identity)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	roots := x509.NewCertPool()
	cert, _ := x509.ParseCertificate(identity.cert.Certificate[0])
	roots.AddCert(cert)
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	r, err := client.Get("https://" + listener.Addr().String() + "/api/status")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if string(body) != "encrypted dungeon" {
		t.Fatal(string(body))
	}
	invite := directInvite(net.ParseIP("93.184.216.34"), 3143, identity.pin)
	if !strings.HasPrefix(invite, "https://93.184.216.34:3143/#key=") {
		t.Fatal(invite)
	}
	server.Close()
	<-done
}
func TestPublicAddressClassification(t *testing.T) {
	for _, text := range []string{"127.0.0.1", "192.168.1.1", "10.1.2.3", "172.16.1.1", "100.64.0.1", "169.254.1.2", "203.0.113.1", "198.51.100.1", "::1"} {
		if publicIPv4(net.ParseIP(text)) {
			t.Fatal("not public", text)
		}
	}
	if !publicIPv4(net.ParseIP("93.184.216.34")) {
		t.Fatal("public address rejected")
	}
}
func TestSaveFolderLockSurvivesDifferentPortChoices(t *testing.T) {
	root := t.TempDir()
	release, err := acquireDataLock(root)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := acquireDataLock(root); err == nil {
		second()
		release()
		t.Fatal("two hosts can write the same saves")
	}
	release()
	release, err = acquireDataLock(root)
	if err != nil {
		t.Fatal("lock persisted after close", err)
	}
	release()
}
func TestModesAllowBothAndRejectConflicts(t *testing.T) {
	for _, o := range []options{{port: 3143, public: true, direct: true}, {port: 3143, direct: true}, {port: 3143, lan: true, openFirewall: true}} {
		if err := o.validate(); err != nil {
			t.Fatal(err)
		}
	}
	for _, o := range []options{{port: 3143, public: true, lan: true}, {port: 3143, direct: true, local: true}, {port: 3143, public: true, openFirewall: true}, {port: 0, direct: true}, {port: 3143, direct: true, publicIP: "not-an-ip"}} {
		if o.validate() == nil {
			t.Fatal("accepted conflicting options", o)
		}
	}
}
func TestPublicLookupHonorsCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := lookupPublicIPv4(ctx); err == nil {
		t.Fatal("lookup should fail when cancelled")
	}
}
