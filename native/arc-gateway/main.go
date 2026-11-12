// arc-gateway: the local gateway between AI apps and their providers, and the door to Cammut.
//
//	arc-gateway run        keep the gateway running (restarts it if it stops); this is what starts at logon
//	arc-gateway serve      run the gateway in this process
//	arc-gateway install    start at logon (a shortcut in the Startup folder) and start now
//	arc-gateway uninstall  remove the Startup shortcut
//	arc-gateway status     print /health
//	arc-gateway migrate    write gateway.json from an older gateway-config.json
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const version = "1.0.0"

func main() {
	cmd := "run"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "serve":
		os.Exit(serve())
	case "run":
		os.Exit(supervise())
	case "install":
		os.Exit(install())
	case "uninstall":
		os.Exit(uninstall())
	case "status":
		os.Exit(status())
	case "migrate":
		os.Exit(migrate())
	case "version", "-v", "--version":
		fmt.Println("arc-gateway", version)
	default:
		fmt.Fprintln(os.Stderr, "usage: arc-gateway [run|serve|install|uninstall|status|migrate|version]")
		os.Exit(2)
	}
}

// openLog writes to logs/arc-gateway.log and starts a new file past 5 MB.
func openLog() {
	p := filepath.Join(Home(), "logs", "arc-gateway.log")
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	if st, err := os.Stat(p); err == nil && st.Size() > 5<<20 {
		_ = os.Rename(p, p+".1")
	}
	if f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
		log.SetOutput(f)
	}
	log.SetFlags(log.LstdFlags | log.LUTC)
}

func serve() int {
	openLog()
	cfg := LoadConfig()
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Port))
	if err != nil {
		log.Printf("serve: port %d is taken: %v", cfg.Port, err)
		return 3
	}
	log.Printf("serve: arc-gateway %s on 127.0.0.1:%d, %d routes, cammut %v", version, cfg.Port, len(cfg.Routes), cfg.Cammut.Upstreams)
	srv := &http.Server{Handler: NewServer(LoadConfig), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	err = srv.Serve(ln)
	log.Printf("serve: stopped: %v", err)
	return 1
}

// supervise keeps one "serve" child alive. Port 7423 is the single-instance lock, so a second "run" leaves at once.
func supervise() int {
	lock, err := net.Listen("tcp", "127.0.0.1:7423")
	if err != nil {
		openLog()
		log.Printf("run: port 7423 is taken, so another gateway keeper runs already; leaving (%v)", err)
		return 0
	}
	defer lock.Close()
	openLog()
	self, _ := os.Executable()
	wait := time.Second
	for {
		start := time.Now()
		c := exec.Command(self, "serve")
		hideWindow(c)
		if err := c.Start(); err != nil {
			log.Printf("run: cannot start serve: %v", err)
		} else {
			log.Printf("run: serve started, pid %d", c.Process.Pid)
			err = c.Wait()
			log.Printf("run: serve stopped: %v", err)
		}
		if time.Since(start) > time.Minute {
			wait = time.Second
		} else if wait < 30*time.Second {
			wait *= 2
		}
		time.Sleep(wait)
	}
}

func status() int {
	cfg := LoadConfig()
	r, err := (&http.Client{Timeout: 3 * time.Second}).Get(fmt.Sprintf("http://127.0.0.1:%d/health", cfg.Port))
	if err != nil {
		fmt.Println("not running:", err)
		return 1
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	fmt.Println(string(b))
	return 0
}

func startupDir() string {
	return filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
}

func install() int {
	if runtime.GOOS != "windows" {
		fmt.Println("install: Windows only; on other systems start 'arc-gateway run' from your login script")
		return 2
	}
	self, _ := os.Executable()
	lnk := filepath.Join(startupDir(), "Arc gateway.lnk")
	ps := fmt.Sprintf(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');$s.TargetPath='%s';$s.Arguments='run';$s.WorkingDirectory='%s';$s.WindowStyle=7;$s.Description='Arc gateway';$s.Save()`,
		lnk, self, filepath.Dir(self))
	if out, err := exec.Command("powershell", "-NoProfile", "-Command", ps).CombinedOutput(); err != nil {
		fmt.Println("install failed:", err, string(out))
		return 1
	}
	c := exec.Command(self, "run")
	hideWindow(c)
	_ = c.Start()
	fmt.Println("installed: starts at every logon; started now")
	return 0
}

func uninstall() int {
	err := os.Remove(filepath.Join(startupDir(), "Arc gateway.lnk"))
	if err != nil && !os.IsNotExist(err) {
		fmt.Println("uninstall failed:", err)
		return 1
	}
	fmt.Println("removed from logon; stop the running copy in Task Manager (arc-gateway.exe) if needed")
	return 0
}

// migrate turns the older gateway-config.json into gateway.json. It keeps an existing gateway.json.
func migrate() int {
	if _, err := os.Stat(configPath()); err == nil {
		fmt.Println("gateway.json already exists; nothing changed")
		return 0
	}
	var old map[string]any
	b, err := os.ReadFile(filepath.Join(Home(), "gateway-config.json"))
	if err == nil {
		_ = json.Unmarshal(b, &old)
	}
	c := defaultConfig()
	str := func(k, d string) string {
		if v, ok := old[k].(string); ok && v != "" {
			return v
		}
		return d
	}
	c.DefaultReasoningEffort = str("defaultReasoningEffort", c.DefaultReasoningEffort)
	c.ForceReasoningEffort = str("forceReasoningEffort", "")
	if g := obj(old["cammutRecall"]); g != nil {
		gb, _ := json.Marshal(g)
		_ = json.Unmarshal(gb, &c.Cammut.Governor)
		c.Cammut.Governor.UsageLog = true // the older gateway always wrote the usage log
	}
	if pc := obj(old["anthropicPromptCaching"]); pc != nil {
		pb, _ := json.Marshal(pc)
		_ = json.Unmarshal(pb, &c.PromptCaching)
	}
	if os.Getenv("ARC_MIGRATE_ROUTES") != "" { // optional: a JSON array of routes to start with
		_ = json.Unmarshal([]byte(os.Getenv("ARC_MIGRATE_ROUTES")), &c.Routes)
	}
	out, _ := json.MarshalIndent(c, "", "  ")
	if err := os.WriteFile(configPath(), out, 0o600); err != nil {
		fmt.Println("migrate failed:", err)
		return 1
	}
	fmt.Println("wrote", configPath())
	return 0
}
