package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type directIdentity struct {
	cert tls.Certificate
	pin  string
}

func loadDirectIdentity(root string) (*directIdentity, error) {
	dir := filepath.Join(root, "tls")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	keyFile := filepath.Join(dir, "host-key.pem")
	certFile := filepath.Join(dir, "host-cert.pem")
	var key ed25519.PrivateKey
	data, err := os.ReadFile(keyFile)
	if os.IsNotExist(err) {
		_, key, err = ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		encoded, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return nil, err
		}
		if err = os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0600); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		block, _ := pem.Decode(data)
		if block == nil {
			return nil, errors.New("invalid saved direct-host TLS key")
		}
		parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		var ok bool
		key, ok = parsed.(ed25519.PrivateKey)
		if !ok {
			return nil, errors.New("unsupported saved direct-host TLS key")
		}
	}
	publicDER, err := x509.MarshalPKIXPublicKey(key.Public())
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(publicDER)
	pin := hex.EncodeToString(digest[:])
	renew := true
	if raw, err := os.ReadFile(certFile); err == nil {
		if block, _ := pem.Decode(raw); block != nil {
			if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
				hash := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
				if hash != digest {
					return nil, errors.New("saved direct-host certificate does not match its key")
				}
				renew = time.Until(cert.NotAfter) < 7*24*time.Hour || time.Now().Before(cert.NotBefore)
			}
		}
	}
	if renew {
		serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
		if err != nil {
			return nil, err
		}
		template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Coop Dungeon direct host"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(365 * 24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}}
		raw, err := x509.CreateCertificate(rand.Reader, template, template, key.Public(), key)
		if err != nil {
			return nil, err
		}
		if err = os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw}), 0600); err != nil {
			return nil, err
		}
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, err
	}
	return &directIdentity{cert: cert, pin: pin}, nil
}

func directInvite(ip net.IP, port int, pin string) string {
	return (&url.URL{Scheme: "https", Path: "/", Host: net.JoinHostPort(ip.String(), strconv.Itoa(port)), Fragment: "key=" + pin}).String()
}

func newDirectServer(listener net.Listener, backend string, identity *directIdentity) (*http.Server, <-chan error, error) {
	target, err := url.Parse(backend)
	if err != nil {
		return nil, nil, err
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(req *http.Request) { director(req); req.Header.Set("X-Forwarded-Proto", "https") }
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "Game server is unavailable", http.StatusBadGateway)
	}
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 10 * time.Second, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{identity.cert}}}
	done := make(chan error, 1)
	go func() { done <- server.Serve(tls.NewListener(listener, server.TLSConfig)); close(done) }()
	return server, done, nil
}

func publicIPv4(ip net.IP) bool {
	if ip == nil || ip.To4() == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, cidr := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24"} {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return false
		}
	}
	return true
}

func lookupPublicIPv4(ctx context.Context) (net.IP, error) {
	client := &http.Client{Timeout: 4 * time.Second}
	for _, endpoint := range []string{"https://api.ipify.org", "https://checkip.amazonaws.com"} {
		req, _ := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
		res, err := client.Do(req)
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(res.Body, 128))
		res.Body.Close()
		if err == nil && res.StatusCode == 200 {
			if ip := net.ParseIP(strings.TrimSpace(string(data))); publicIPv4(ip) {
				return ip.To4(), nil
			}
		}
	}
	return nil, fmt.Errorf("could not discover a public IPv4 address; supply --public-ip or use Cloudflare")
}
