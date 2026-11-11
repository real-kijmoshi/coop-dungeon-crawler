package main

import (
	"math"
	"strconv"
)

func itoa(n int) string { return strconv.Itoa(n) }

func sqrt(v float64) float64 { return math.Sqrt(v) }

func indexOf(list []string, v string) int {
	for i, x := range list {
		if x == v {
			return i
		}
	}
	return 0
}
