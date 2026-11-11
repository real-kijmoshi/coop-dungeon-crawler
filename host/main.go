// Windows host: runtime and server are packed by the Windows release workflow.
package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

//go:embed assets/bundle.zip
var assets embed.FS
var version = "dev"
var urlPattern = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

func unpack(data []byte, dest string) error {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, f := range r.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		out := filepath.Join(dest, filepath.FromSlash(name))
		rel, err := filepath.Rel(dest, out)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) || strings.Contains(name, ":") || f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe archive entry %q", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(out, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(out), 0700); err != nil {
			return err
		}
		src, err := f.Open()
		if err != nil {
			return err
		}
		dst, err := os.OpenFile(out, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if err != nil {
			src.Close()
			return err
		}
		_, err = io.Copy(dst, src)
		closeErr := dst.Close()
		src.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

type options struct {
	local, lan, public, direct, openFirewall         bool
	skipFirewall, noUPnP, noFallback, removeFirewall bool
	port, externalPort                               int
	dataDir, publicIP, firewallHelper                string
}

func (o options) validate() error {
	if o.port < 1 || o.port > 65535 || o.externalPort < 0 || o.externalPort > 65535 {
		return errors.New("ports must be between 1 and 65535")
	}
	if (o.local && (o.lan || o.public || o.direct)) || (o.lan && (o.public || o.direct)) {
		return errors.New("local and LAN modes cannot be combined with Internet modes")
	}
	if o.openFirewall && !o.lan && !o.direct {
		return errors.New("--open-firewall requires --lan or --direct")
	}
	if o.openFirewall && o.skipFirewall {
		return errors.New("choose --open-firewall or --no-firewall")
	}
	if o.publicIP != "" && (net.ParseIP(o.publicIP) == nil || net.ParseIP(o.publicIP).To4() == nil) {
		return errors.New("--public-ip must be an IPv4 address")
	}
	if o.firewallHelper != "" && o.firewallHelper != "direct" && o.firewallHelper != "lan" {
		return errors.New("invalid firewall helper scope")
	}
	return nil
}
func stop(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func run() error {
	var o options
	flag.BoolVar(&o.local, "local", false, "host only on this computer")
	flag.BoolVar(&o.lan, "lan", false, "host on your local network")
	flag.BoolVar(&o.public, "public", false, "share through Cloudflare; combine with --direct for both")
	flag.BoolVar(&o.direct, "direct", false, "open a direct HTTPS Internet port and attempt router forwarding")
	flag.BoolVar(&o.openFirewall, "open-firewall", false, "configure this mode's app-specific Windows firewall rule")
	flag.BoolVar(&o.skipFirewall, "no-firewall", false, "skip automatic direct-mode firewall configuration")
	flag.BoolVar(&o.noUPnP, "no-upnp", false, "skip automatic router mapping; use manual forwarding")
	flag.BoolVar(&o.noFallback, "no-fallback", false, "do not automatically start Cloudflare if direct setup fails")
	flag.BoolVar(&o.removeFirewall, "remove-firewall", false, "remove this mode's own firewall rule and exit")
	flag.IntVar(&o.port, "port", 3143, "local/LAN port or direct HTTPS listening port")
	flag.IntVar(&o.externalPort, "external-port", 0, "preferred router public port (default: --port)")
	flag.StringVar(&o.publicIP, "public-ip", "", "public IPv4 override for manual forwarding")
	flag.StringVar(&o.dataDir, "data-dir", "", "save folder (default: LocalAppData/CoopDungeonHost)")
	flag.StringVar(&o.firewallHelper, "firewall-helper", "", "internal: configure only an elevated firewall rule")
	flag.Parse()
	if o.firewallHelper != "" {
		if o.port < 1 || o.port > 65535 {
			return errors.New("invalid firewall port")
		}
	} else {
		readerMode := !o.local && !o.lan && !o.public && !o.direct && !o.removeFirewall
		if readerMode {
			fmt.Println("Coop Dungeon Host\n1. Internet: Cloudflare (no router setup)\n2. Internet: Direct HTTPS (open game port)\n3. Internet: Both Cloudflare and Direct\n4. Local network\n5. This computer only")
			fmt.Print("Choose [1/2/3/4/5]: ")
		}
		// One reader is shared with the stop prompt, preserving piped input.
	}
	reader := bufio.NewReader(os.Stdin)
	if o.firewallHelper == "" && !o.local && !o.lan && !o.public && !o.direct && !o.removeFirewall {
		choice, _ := reader.ReadString('\n')
		switch strings.TrimSpace(choice) {
		case "1":
			o.public = true
		case "2":
			o.direct = true
		case "3":
			o.public = true
			o.direct = true
		case "4":
			o.lan = true
		case "5":
			o.local = true
		default:
			return errors.New("no hosting mode selected")
		}
	}
	if err := o.validate(); err != nil {
		return err
	}
	if o.dataDir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			return err
		}
		o.dataDir = filepath.Join(base, "CoopDungeonHost")
	}
	root, err := filepath.Abs(o.dataDir)
	if err != nil {
		return err
	}
	if o.firewallHelper != "" {
		return configureFirewall(root, o.firewallHelper, o.port, o.removeFirewall)
	}
	if o.removeFirewall {
		scope := "lan"
		if o.direct {
			scope = "direct"
		} else if !o.lan {
			return errors.New("use --direct or --lan with --remove-firewall")
		}
		return removeFirewall(root, scope, o.port)
	}
	if err = os.MkdirAll(filepath.Join(root, "saves"), 0700); err != nil {
		return err
	}
	releaseLock, err := acquireDataLock(root)
	if err != nil {
		return err
	}
	defer releaseLock()
	probe, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(o.port)))
	if err != nil {
		return fmt.Errorf("port %d is already in use: %w", o.port, err)
	}
	defer probe.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	attach, closeGroup, err := newProcessGroup()
	if err != nil {
		return fmt.Errorf("child-process cleanup setup failed: %w", err)
	}
	defer closeGroup()
	runtimeDir := filepath.Join(root, "runtime-"+version)
	if _, err := os.Stat(filepath.Join(runtimeDir, ".ready")); err != nil {
		fmt.Println("Preparing bundled runtime (first launch of this version)...")
		data, err := assets.ReadFile("assets/bundle.zip")
		if err != nil {
			return err
		}
		if err = unpack(data, runtimeDir); err != nil {
			return err
		}
		if err = os.WriteFile(filepath.Join(runtimeDir, ".ready"), []byte(version), 0600); err != nil {
			return err
		}
	}
	node := filepath.Join(runtimeDir, "node.exe")
	nodePort := o.port
	nodeHost := "127.0.0.1"
	if o.lan {
		nodeHost = "0.0.0.0"
	}
	firewallOK := true
	if o.direct || o.openFirewall {
		if o.skipFirewall {
			fmt.Println("Windows firewall setup skipped; direct reachability is unverified.")
			firewallOK = false
		} else {
			scope := "lan"
			program := node
			if o.direct {
				scope = "direct"
				program, err = os.Executable()
				if err != nil {
					return err
				}
			}
			profiles := "Private"
			if o.direct {
				profiles = "Private/Public"
			}
			fmt.Printf("Configuring TCP port %d for this application on %s networks. Windows may request Administrator permission.\n", o.port, profiles)
			if err = ensureFirewall(root, program, scope, o.port); err != nil {
				fmt.Println("Firewall rule was not configured:", err)
				firewallOK = false
			} else {
				fmt.Println("Windows firewall: game-port rule is configured.")
			}
		}
	}
	if ctx.Err() != nil {
		return nil
	}
	var identity *directIdentity
	var directListener net.Listener
	if o.direct {
		identity, err = loadDirectIdentity(root)
		if err != nil {
			return err
		}
		backendProbe, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			return err
		}
		nodePort = backendProbe.Addr().(*net.TCPAddr).Port
		backendProbe.Close()
		probe.Close()
		directListener, err = net.Listen("tcp4", net.JoinHostPort("0.0.0.0", strconv.Itoa(o.port)))
		if err != nil {
			return err
		}
		defer directListener.Close()
	} else {
		probe.Close()
	}
	endpoint := "http://127.0.0.1:" + strconv.Itoa(nodePort)
	cmd := exec.Command(node, filepath.Join(runtimeDir, "server", "index.js"))
	cmd.Dir = filepath.Join(runtimeDir, "server")
	cmd.Env = append(os.Environ(), "PORT="+strconv.Itoa(nodePort), "HOST="+nodeHost, "DATA_DIR="+filepath.Join(root, "saves"))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		return err
	}
	serverDone := make(chan struct{})
	var serverErr error
	go func() { serverErr = cmd.Wait(); close(serverDone) }()
	if err = attach(cmd); err != nil {
		stop(cmd)
		return fmt.Errorf("could not attach server process cleanup: %w", err)
	}
	defer func() {
		select {
		case <-serverDone:
			return
		default:
		}
		if err := os.WriteFile(filepath.Join(root, "saves", "stop.request"), []byte("stop"), 0600); err != nil {
			fmt.Println("Could not request a graceful save:", err)
		}
		select {
		case <-serverDone:
		case <-time.After(8 * time.Second):
			fmt.Println("Server did not stop in time; preserving its last autosave.")
			stop(cmd)
			<-serverDone
		}
	}()
	client := http.Client{Timeout: 2 * time.Second}
	ready := false
	for i := 0; i < 60; i++ {
		select {
		case <-serverDone:
			return fmt.Errorf("server exited during startup: %v", serverErr)
		case <-ctx.Done():
			return nil
		default:
		}
		res, err := client.Get(endpoint + "/api/status")
		if err == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				ready = true
				break
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	if !ready {
		return errors.New("server did not become ready within 30 seconds")
	}
	localAddress := endpoint
	if identity != nil {
		localAddress = directInvite(net.ParseIP("127.0.0.1"), o.port, identity.pin)
	}
	fmt.Println("\nPLAY ON THIS COMPUTER:", localAddress, "\nSAVES:", filepath.Join(root, "saves"))
	var directDone <-chan error
	if o.direct {
		server, done, err := newDirectServer(directListener, endpoint, identity)
		if err != nil {
			return err
		}
		defer server.Close()
		directDone = done
		fmt.Printf("Direct HTTPS listener: ready on TCP %d. Only paste full key-bearing direct invites into client v0.3.0 or later.\n", o.port)
	}
	mappingFailures := make(chan error, 1)
	startCloudflare := o.public
	if o.direct {
		externalPort := o.externalPort
		if externalPort == 0 {
			externalPort = o.port
		}
		var mapping *portMapping
		if !o.noUPnP {
			fmt.Println("Trying UPnP/NAT-PMP router forwarding...")
			mapCtx, mapCancel := context.WithTimeout(ctx, 12*time.Second)
			mapping, err = openRouterPort(mapCtx, o.port, externalPort, firewallRuleName(root, "direct", o.port))
			mapCancel()
			if err != nil {
				fmt.Println("Automatic forwarding unavailable:", err)
			}
		} else {
			fmt.Println("Automatic router mapping skipped; manual forwarding is required.")
		}
		var observedIP net.IP
		if o.publicIP != "" {
			observedIP = net.ParseIP(o.publicIP)
		} else {
			ipCtx, ipCancel := context.WithTimeout(ctx, 7*time.Second)
			observedIP, err = lookupPublicIPv4(ipCtx)
			ipCancel()
			if err != nil {
				fmt.Println(err)
			}
		}
		forwardOK := false
		if mapping != nil {
			externalPort = mapping.externalPort
			fmt.Printf("Router reports a %s TCP mapping: %s:%d -> this computer:%d.\n", mapping.kind, mapping.externalIP, externalPort, o.port)
			forwardOK = publicIPv4(mapping.externalIP) && (observedIP == nil || observedIP.Equal(mapping.externalIP))
			if observedIP == nil {
				observedIP = mapping.externalIP
			}
			if !forwardOK {
				fmt.Println("Router/public addresses suggest upstream NAT or CGNAT. Direct Internet access may need ISP/router changes.")
			}
			renewCtx, stopRenew := context.WithCancel(ctx)
			interval := mapping.lease / 2
			if interval < 100*time.Millisecond {
				interval = 100 * time.Millisecond
			}
			renewed := maintainMapping(renewCtx, mapping, interval, func(err error) {
				select {
				case mappingFailures <- err:
				default:
				}
			})
			defer func() {
				stopRenew()
				<-renewed
				cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cleanupCancel()
				if err := mapping.remove(cleanupCtx); err != nil {
					fmt.Println("Could not remove the router mapping; its finite lease will expire:", err)
				} else {
					fmt.Println("Temporary router mapping removed.")
				}
			}()
		}
		if observedIP != nil {
			fmt.Println("\nDIRECT INVITE (external reachability NOT independently verified):\n" + directInvite(observedIP, externalPort, identity.pin))
			if !publicIPv4(observedIP) {
				fmt.Println("This is not a globally routable IPv4 address.")
			}
		} else {
			fmt.Println("No public IP discovered. Use --public-ip with your router's public IPv4, or use Cloudflare.")
		}
		fmt.Printf("For manual forwarding: router TCP public port %d -> your PC's LAN IPv4, TCP %d. Keep the entire #key=... part of the invite.\n", externalPort, o.port)
		if (!forwardOK || !firewallOK) && !o.noFallback {
			fmt.Println("Starting Cloudflare fallback while the direct port remains available for manual setup.")
			startCloudflare = true
		}
	}
	if ctx.Err() != nil {
		return nil
	}
	var tunnel *exec.Cmd
	var tunnelDone <-chan error
	startTunnel := func() error {
		if tunnel != nil {
			return nil
		}
		child := exec.Command(filepath.Join(runtimeDir, "cloudflared.exe"), "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", endpoint)
		pipe, err := child.StderrPipe()
		if err != nil {
			return err
		}
		child.Stdout = os.Stdout
		if err = child.Start(); err != nil {
			return err
		}
		if err = attach(child); err != nil {
			stop(child)
			return err
		}
		tunnel = child
		done := make(chan error, 1)
		tunnelDone = done
		go func() {
			scanner := bufio.NewScanner(pipe)
			for scanner.Scan() {
				line := scanner.Text()
				if u := urlPattern.FindString(line); u != "" {
					fmt.Println("\nCLOUDFLARE INVITE:\n" + u + "\nPaste this URL into the client's Server field. Tunnel is connecting; allow a few seconds.")
				} else {
					fmt.Println(line)
				}
			}
			done <- child.Wait()
			close(done)
		}()
		return nil
	}
	defer func() { stop(tunnel) }()
	if startCloudflare {
		if err := startTunnel(); err != nil {
			fmt.Println("Cloudflare could not start:", err)
		}
	}
	fmt.Println("Keep this window open. Press Enter to stop and save (Ctrl+C also stops).")
	enter := make(chan struct{})
	go func() {
		if _, err := reader.ReadString('\n'); err == nil {
			close(enter)
		}
	}()
	for {
		select {
		case <-serverDone:
			return fmt.Errorf("game server stopped: %v", serverErr)
		case err := <-directDone:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				return fmt.Errorf("direct HTTPS server stopped: %w", err)
			}
			directDone = nil
		case err := <-tunnelDone:
			fmt.Println("Cloudflare stopped; local/direct hosting stays available:", err)
			tunnelDone = nil
			tunnel = nil
		case err := <-mappingFailures:
			fmt.Println("Router mapping renewal failed:", err)
			if !o.noFallback {
				if err := startTunnel(); err != nil {
					fmt.Println("Cloudflare fallback failed:", err)
				}
			}
		case <-enter:
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Host error:", err)
		if len(os.Args) == 1 {
			fmt.Println("Press Enter to close.")
			_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		}
		os.Exit(1)
	}
}
