package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Direct invites pin the host's persistent TLS public key. The fragment never
// goes to the server or into a WebSocket request target.
func parseServerAddress(server string) (*url.URL, []byte, error) {
	u, err := url.Parse(normalizeServer(server))
	if err != nil || u.Hostname() == "" {
		return nil, nil, errors.New("invalid server address")
	}
	if u.User != nil {
		return nil, nil, errors.New("enter credentials in the username/password fields")
	}
	switch u.Scheme {
	case "http", "https", "ws", "wss":
	default:
		return nil, nil, errors.New("use an http or https server address")
	}
	var pin []byte
	if u.Fragment != "" {
		values, err := url.ParseQuery(u.Fragment)
		if err != nil || len(values) != 1 || len(values["key"]) != 1 {
			return nil, nil, errors.New("invalid direct invite key")
		}
		pin, err = hex.DecodeString(values.Get("key"))
		if err != nil || len(pin) != sha256.Size {
			return nil, nil, errors.New("direct invite key must be 64 hexadecimal characters")
		}
		if u.Scheme != "https" && u.Scheme != "wss" {
			return nil, nil, errors.New("direct invite keys require HTTPS")
		}
	}
	u.Fragment = ""
	u.RawFragment = ""
	u.Path = strings.TrimRight(u.Path, "/")
	return u, pin, nil
}

func serverTLSConfig(pin []byte) *tls.Config {
	if len(pin) == 0 {
		return nil
	}
	trusted := append([]byte(nil), pin...)
	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		// The invite authenticates the public key rather than a purchased domain.
		// Verification is mandatory below; certificate errors are never ignored.
		InsecureSkipVerify: true,
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("server supplied no TLS certificate")
			}
			cert := cs.PeerCertificates[0]
			actual := sha256.Sum256(cert.RawSubjectPublicKeyInfo)
			if subtle.ConstantTimeCompare(actual[:], trusted) != 1 {
				return errors.New("server key does not match the invite")
			}
			now := time.Now()
			if now.Before(cert.NotBefore) || now.After(cert.NotAfter) {
				return errors.New("server TLS certificate has expired or is not yet valid")
			}
			return nil
		},
	}
}

func authClient(server string) (*http.Client, *url.URL, error) {
	u, pin, err := parseServerAddress(server)
	if err != nil {
		return nil, nil, err
	}
	if u.Scheme == "wss" {
		u.Scheme = "https"
	}
	if u.Scheme == "ws" {
		u.Scheme = "http"
	}
	if len(pin) == 0 {
		return httpClient, u, nil
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = serverTLSConfig(pin)
	host := u.Host
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "https" || req.URL.Host != host {
			return fmt.Errorf("direct authentication cannot redirect to a different server")
		}
		return nil
	}}
	return client, u, nil
}
