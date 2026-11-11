//go:build !windows && !darwin

package main

// Audio output on Linux and other Unix systems: the mixer's stream is piped into a
// command-line player that reads raw audio from its standard input.

import (
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Players that accept raw 16-bit 44.1 kHz stereo on stdin, tried in this order.
var pipePlayers = [][]string{
	{"paplay", "--raw", "--rate=44100", "--channels=2", "--format=s16le", "--latency-msec=50", "--client-name=Dungeon Crawler"},
	{"pw-cat", "--playback", "--raw", "--rate", "44100", "--channels", "2", "--format", "s16", "--latency", "50ms", "-"},
	{"aplay", "-q", "-t", "raw", "-f", "S16_LE", "-r", "44100", "-c", "2", "--buffer-time=80000", "-"},
	{"ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32", "-analyzeduration", "0", "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", "-"},
}

type pipeOutput struct {
	mu     sync.Mutex
	status string
	cmd    *exec.Cmd
	closed bool
}

func openAudioOutput(src io.Reader) audioOutput {
	o := &pipeOutput{status: "starting"}
	var candidates [][]string
	if p := os.Getenv("CDC_AUDIO_PLAYER"); p != "" {
		// A custom command; it must read raw s16le 44.1 kHz stereo from stdin.
		candidates = [][]string{strings.Fields(p)}
	} else {
		for _, c := range pipePlayers {
			if _, err := exec.LookPath(c[0]); err == nil {
				candidates = append(candidates, c)
			}
		}
	}
	if len(candidates) == 0 {
		o.status = "off (no audio player found: install pulseaudio-utils, pipewire, alsa-utils or ffmpeg)"
		return o
	}
	go o.run(src, candidates)
	return o
}

func (o *pipeOutput) Status() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.status
}

func (o *pipeOutput) Close() {
	o.mu.Lock()
	o.closed = true
	if o.cmd != nil && o.cmd.Process != nil {
		_ = o.cmd.Process.Kill()
	}
	o.mu.Unlock()
}

func (o *pipeOutput) set(status string) {
	o.mu.Lock()
	o.status = status
	o.mu.Unlock()
}

// run feeds players until one works. A player that quits right away has no sound
// device (or doesn't know a flag): the next one gets a try.
func (o *pipeOutput) run(src io.Reader, candidates [][]string) {
	for _, c := range candidates {
		for attempt := 0; attempt < 3; attempt++ {
			ran, closed := o.play(src, c)
			if closed {
				return
			}
			if ran < 3*time.Second {
				break
			}
			attempt = -1 // it worked for a while (sound server restarted?): start it again
			time.Sleep(time.Second)
		}
	}
	o.set("off (no working sound device)")
}

func (o *pipeOutput) play(src io.Reader, c []string) (time.Duration, bool) {
	r, w, err := os.Pipe()
	if err != nil {
		return 0, false
	}
	cmd := exec.Command(c[0], c[1:]...)
	cmd.Stdin = r
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		r.Close()
		w.Close()
		return 0, true
	}
	err = cmd.Start()
	r.Close()
	if err != nil {
		o.mu.Unlock()
		w.Close()
		return 0, false
	}
	o.cmd = cmd
	o.status = "playing through " + c[0]
	o.mu.Unlock()
	shrinkPipe(w) // a small pipe keeps sound effects on time

	started := time.Now()
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		w.Close() // unblocks the writer below
		close(done)
	}()
	// A real player takes audio at the speed it plays it, which paces this loop.
	// The clock below is a safety net for anything that reads faster than that.
	buf := make([]byte, 2048) // ~12 ms
	clock, frames := time.Now(), int64(0)
	for {
		_, _ = src.Read(buf)
		if _, err := w.Write(buf); err != nil {
			break
		}
		frames += int64(len(buf) / 4)
		ahead := time.Duration(frames)*time.Second/sampleRate - time.Since(clock)
		if ahead > 250*time.Millisecond {
			time.Sleep(ahead - 200*time.Millisecond)
		} else if ahead < -time.Second { // the player stalled for a while: don't rush to catch up
			clock, frames = time.Now(), 0
		}
	}
	_ = cmd.Process.Kill()
	<-done
	o.mu.Lock()
	closed := o.closed
	o.mu.Unlock()
	return time.Since(started), closed
}
