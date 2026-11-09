// Coop Dungeon Crawler terminal client.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/gdamore/tcell/v2"
)

var version = "dev"

func main() {
	server := flag.String("server", "", "server address, e.g. play.example.com:3143 (with -user/-pass skips the login screen)")
	user := flag.String("user", "", "username")
	pass := flag.String("pass", "", "password")
	reg := flag.Bool("register", false, "create the account first (with -server/-user/-pass)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("coop-dungeon-crawler client", version)
		return
	}

	// Quick start from the command line.
	var conn *Conn
	var acc Account
	if *user != "" && *pass != "" {
		acc = Account{Server: normalizeServer(*server), Username: *user, Password: *pass}
		if *reg {
			if err := register(acc.Server, acc.Username, acc.Password); err != nil {
				fmt.Fprintln(os.Stderr, "Registration failed:", err)
				os.Exit(1)
			}
		}
		var err error
		conn, err = Dial(acc.Server, acc.Username, acc.Password)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Could not join the game:", err)
			os.Exit(1)
		}
		_ = saveAccounts(rememberAccount(loadAccounts(), acc))
	}

	s, err := tcell.NewScreen()
	if err == nil {
		err = s.Init()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not open the terminal:", err)
		os.Exit(1)
	}
	exitMsg := ""
	defer func() {
		if r := recover(); r != nil {
			s.Fini()
			panic(r)
		}
		s.Fini()
		if exitMsg != "" {
			fmt.Println(exitMsg)
		}
	}()
	s.SetStyle(tcell.StyleDefault.Background(tc(theme.bg)).Foreground(tc(theme.text)))
	s.HideCursor()
	cv := &Canvas{s: s}

	if conn == nil {
		var ok bool
		srv := ""
		if *server != "" {
			srv = normalizeServer(*server)
		}
		conn, acc, ok = runLogin(cv, srv)
		if !ok {
			return
		}
	}
	exitMsg = runGame(cv, conn, acc)
}
