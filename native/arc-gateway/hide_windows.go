//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow starts a child without a console window.
func hideWindow(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
