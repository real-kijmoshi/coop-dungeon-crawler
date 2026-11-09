// Windows host: runtime and server are packed by the Windows release workflow.
package main

import (
 "archive/zip"
 "bufio"
 "bytes"
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
 r, err := zip.NewReader(bytes.NewReader(data), int64(len(data))); if err != nil { return err }
 for _, f := range r.File {
  name := strings.ReplaceAll(f.Name, "\\", "/")
  out := filepath.Join(dest, filepath.FromSlash(name))
  rel, err := filepath.Rel(dest, out)
  if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) || strings.Contains(name, ":") || f.Mode()&os.ModeSymlink != 0 { return fmt.Errorf("unsafe archive entry %q", f.Name) }
  if f.FileInfo().IsDir() { if err := os.MkdirAll(out, 0700); err != nil { return err }; continue }
  if err := os.MkdirAll(filepath.Dir(out), 0700); err != nil { return err }
  src, err := f.Open(); if err != nil { return err }
  dst, err := os.OpenFile(out, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600); if err != nil { src.Close(); return err }
  _, err = io.Copy(dst, src); closeErr := dst.Close(); src.Close(); if err != nil { return err }; if closeErr != nil { return closeErr }
 }
 return nil
}

func stop(cmd *exec.Cmd) { if cmd != nil && cmd.Process != nil { _ = cmd.Process.Kill() } }

func run() error {
 local := flag.Bool("local", false, "host on this computer only")
 lan := flag.Bool("lan", false, "allow connections from your local network")
 public := flag.Bool("public", false, "publish through a temporary Cloudflare HTTPS tunnel")
 firewall := flag.Bool("open-firewall", false, "LAN only: add a Windows private-network inbound rule; requires Administrator")
 port := flag.Int("port", 3143, "server port")
 dataDir := flag.String("data-dir", "", "save folder (default: LocalAppData/CoopDungeonHost)")
 flag.Parse()
 if *port < 1 || *port > 65535 { return errors.New("port must be between 1 and 65535") }
 modes:=0; for _, b := range []bool{*local,*lan,*public} { if b { modes++ } }; if modes>1 { return errors.New("choose only one of --local, --lan, --public") }
 if *dataDir == "" { base,err:=os.UserCacheDir();if err!=nil{return err}; *dataDir=filepath.Join(base,"CoopDungeonHost") }
 root, err := filepath.Abs(*dataDir); if err != nil { return err }
 if err := os.MkdirAll(filepath.Join(root,"saves"),0700); err != nil { return err }
 // Exclusive lock also prevents two instances from writing the same saves.
 lock, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(*port)); if err != nil { return fmt.Errorf("port %d is already in use; stop the other host or use --port: %w",*port,err) }
 if modes==0 {
  fmt.Println("Coop Dungeon Host\n1. Share over the Internet (temporary Cloudflare URL)\n2. Local network\n3. This computer only")
  fmt.Println("Public mode makes the game server reachable by anyone with its URL, through Cloudflare. No router or inbound firewall changes. The URL changes each restart.")
  fmt.Print("Choose [1/2/3]: ")
  line,_:=bufio.NewReader(os.Stdin).ReadString('\n')
  switch strings.TrimSpace(line) {case "1":*public=true;case "2":*lan=true;case "3":*local=true;default: lock.Close();return errors.New("no hosting mode selected")}
 }
 if *firewall && !*lan { lock.Close(); return errors.New("--open-firewall is only valid with --lan") }
 runtimeDir:=filepath.Join(root,"runtime-"+version)
 if _,err:=os.Stat(filepath.Join(runtimeDir,".ready"));err!=nil {
  fmt.Println("Preparing bundled runtime (first launch of this version)...")
  data,err:=assets.ReadFile("assets/bundle.zip");if err!=nil{lock.Close();return err}
  if err=unpack(data,runtimeDir);err!=nil{lock.Close();return err}
  if err=os.WriteFile(filepath.Join(runtimeDir,".ready"),[]byte(version),0600);err!=nil{lock.Close();return err}
 }
 node:=filepath.Join(runtimeDir,"node.exe")
 if *firewall {
  fmt.Println("Adding a rule for this bundled Node runtime, TCP port",*port,"on Private networks, limited to the local subnet.")
  // Delete only this exact named launcher-owned rule before replacing it.
  name:="CoopDungeonHost-"+version+"-"+strconv.Itoa(*port)
  _=exec.Command("netsh","advfirewall","firewall","delete","rule","name="+name).Run()
  out,err:=exec.Command("netsh","advfirewall","firewall","add","rule","name="+name,"dir=in","action=allow","program="+node,"protocol=TCP","localport="+strconv.Itoa(*port),"profile=private","remoteip=localsubnet").CombinedOutput()
  if err!=nil{lock.Close();return fmt.Errorf("firewall rule failed: run from an Administrator terminal or allow the server manually. %s",out)}
 }
 host:="127.0.0.1";if *lan{host="0.0.0.0"}
 lock.Close()
 cmd:=exec.Command(node,filepath.Join(runtimeDir,"server","index.js"))
 cmd.Dir=filepath.Join(runtimeDir,"server")
 cmd.Env=append(os.Environ(),"PORT="+strconv.Itoa(*port),"HOST="+host,"DATA_DIR="+filepath.Join(root,"saves"))
 cmd.Stdout=os.Stdout;cmd.Stderr=os.Stderr
 if err:=cmd.Start();err!=nil{return err};defer stop(cmd)
 done:=make(chan error,1);go func(){done<-cmd.Wait()}()
 endpoint:="http://127.0.0.1:"+strconv.Itoa(*port)
 client:=http.Client{Timeout:2*time.Second}
 ready:=false
 for i:=0;i<60;i++ {select{case err:=<-done:return fmt.Errorf("server exited during startup: %v",err);default:}
  res,err:=client.Get(endpoint+"/api/status");if err==nil{res.Body.Close();if res.StatusCode==200{ready=true;break}};time.Sleep(500*time.Millisecond)
 }
 if !ready{return errors.New("server did not become ready within 30 seconds")}
 fmt.Println("\nLOCAL ADDRESS:",endpoint,"\nSAVES:",filepath.Join(root,"saves"))
 var tunnel *exec.Cmd
 var tunnelDone chan error
 if *public {
  tunnel=exec.Command(filepath.Join(runtimeDir,"cloudflared.exe"),"tunnel","--no-autoupdate","--protocol","http2","--url",endpoint)
  pipe,err:=tunnel.StderrPipe();if err!=nil{return err};tunnel.Stdout=os.Stdout
  if err=tunnel.Start();err!=nil{return err};defer stop(tunnel)
  tunnelDone=make(chan error,1)
  go func(){scanner:=bufio.NewScanner(pipe);for scanner.Scan(){line:=scanner.Text();if u:=urlPattern.FindString(line);u!=""{fmt.Println("\nSHARE THIS FULL ADDRESS WITH FRIENDS:\n"+u+"\nPaste it into the client's Server field, or open it for launch commands.\nTunnel is connecting; allow a few seconds before joining.")}else{fmt.Println(line)}};tunnelDone<-tunnel.Wait()}()
 }
 fmt.Println("Keep this window open. Press Enter to stop and save (Ctrl+C also stops).")
 enter:=make(chan struct{});go func(){_,err:=bufio.NewReader(os.Stdin).ReadString('\n');if err==nil{close(enter)}}()
 interrupts:=make(chan os.Signal,1);signal.Notify(interrupts,os.Interrupt);defer signal.Stop(interrupts)
 select{case err:=<-done:return fmt.Errorf("server stopped: %v",err);case err:=<-tunnelDone:return fmt.Errorf("public tunnel stopped: %v",err);case <-enter:case <-interrupts:}
 stop(tunnel)
 // Ask the bundled server to flush world and heroes before stopping.
 _=os.WriteFile(filepath.Join(root,"saves","stop.request"),[]byte("stop"),0600)
 select{case <-done:return nil;case <-time.After(8*time.Second):return errors.New("server did not stop cleanly; last autosave is preserved")}
}
func main(){if err:=run();err!=nil{fmt.Fprintln(os.Stderr,"Host error:",err);if len(os.Args)==1{fmt.Println("Press Enter to close.");_,_=bufio.NewReader(os.Stdin).ReadString('\n')};os.Exit(1)}}
