//go:build !linux && !windows && !darwin

package main

import "os"

func shrinkPipe(*os.File) {}
