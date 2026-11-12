package main

// Google Vertex AI: the saved gcloud login (application default credentials) is exchanged for a short-lived
// access token, kept in memory only.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type vertexAuth struct {
	mu      sync.Mutex
	token   string
	expires time.Time
	client  *http.Client
}

func (v *vertexAuth) Token() (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.token != "" && time.Now().Before(v.expires) {
		return v.token, nil
	}
	p := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if p == "" {
		base := os.Getenv("APPDATA")
		if base == "" {
			h, _ := os.UserHomeDir()
			base = filepath.Join(h, ".config")
		}
		p = filepath.Join(base, "gcloud", "application_default_credentials.json")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", fmt.Errorf("no Google login: run gcloud auth application-default login")
	}
	var c struct{ ClientID, ClientSecret, RefreshToken string }
	var raw map[string]string
	_ = json.Unmarshal(b, &raw)
	c.ClientID, c.ClientSecret, c.RefreshToken = raw["client_id"], raw["client_secret"], raw["refresh_token"]
	r, err := v.client.PostForm("https://oauth2.googleapis.com/token", url.Values{
		"grant_type": {"refresh_token"}, "client_id": {c.ClientID}, "client_secret": {c.ClientSecret}, "refresh_token": {c.RefreshToken}})
	if err != nil {
		return "", err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return "", fmt.Errorf("Google login refused: %d; run gcloud auth application-default login", r.StatusCode)
	}
	var j struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(r.Body).Decode(&j); err != nil {
		return "", err
	}
	v.token, v.expires = j.AccessToken, time.Now().Add(time.Duration(j.ExpiresIn-120)*time.Second)
	return v.token, nil
}
