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
	server := flag.String("server", "", "server address, e.g. play.example.com:3143 (with -user/-pass skips the menu)")
	user := flag.String("user", "", "username")
	pass := flag.String("pass", "", "password")
	reg := flag.Bool("register", false, "create the account first (with -server/-user/-pass)")
	noMusic := flag.Bool("no-music", false, "start with music and sound effects off")
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

	settings := loadSettings()
	if *noMusic {
		settings.Music, settings.Sounds = false, false
	}
	app := &App{
		cv:       &Canvas{s: s},
		events:   make(chan tcell.Event, 64),
		audio:    newAudio(settings),
		settings: settings,
	}
	if *server != "" {
		app.server = normalizeServer(*server)
	}

	exitMsg := ""
	defer func() {
		app.audio.Close()
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

	// One goroutine reads the terminal for the whole session (menu and game).
	go func() {
		for {
			ev := s.PollEvent()
			if ev == nil {
				return
			}
			app.events <- ev
		}
	}()

	status := ""
	for {
		if conn == nil {
			var ok bool
			conn, acc, ok = runMenu(app, status)
			if !ok {
				exitMsg = "Thanks for playing!"
				return
			}
		}
		msg, toMenu := runGame(app, conn, acc)
		conn = nil
		if !toMenu {
			exitMsg = msg
			return
		}
		status = msg
	}
}
