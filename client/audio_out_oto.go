//go:build windows || darwin

package main

// Audio output on Windows (WASAPI) and macOS (Core Audio) through oto, which
// needs no cgo on either system.

import (
	"io"
	"time"

	"github.com/ebitengine/oto/v3"
)

type otoOutput struct {
	status string
	player *oto.Player
}

func openAudioOutput(src io.Reader) audioOutput {
	ctx, ready, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   sampleRate,
		ChannelCount: 2,
		Format:       oto.FormatSignedInt16LE,
		BufferSize:   40 * time.Millisecond,
	})
	if err != nil {
		return &otoOutput{status: "off (" + err.Error() + ")"}
	}
	o := &otoOutput{status: "playing"}
	select {
	case <-ready:
	case <-time.After(3 * time.Second):
		return &otoOutput{status: "off (the sound device did not answer)"}
	}
	if err := ctx.Err(); err != nil {
		return &otoOutput{status: "off (" + err.Error() + ")"}
	}
	o.player = ctx.NewPlayer(src)
	o.player.SetBufferSize(sampleRate * 4 / 20) // 50 ms: effects stay on time
	o.player.Play()
	return o
}

func (o *otoOutput) Status() string { return o.status }

func (o *otoOutput) Close() {
	if o.player != nil {
		o.player.Pause()
	}
}
