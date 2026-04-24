package main

import (
	"fmt"
	md "github.com/JohannesKaufmann/html-to-markdown"
	"github.com/JohannesKaufmann/html-to-markdown/plugin"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	options := getArguments()
	
	// Mode offline-walkthrough
	if options.offlineWalkthrough != "" {
		fmt.Println("Starting offline walkthrough conversion...")
		fmt.Printf("Processing directory: %s\n", options.offlineWalkthrough)
		
		if err := processOfflineWalkthrough(options.offlineWalkthrough); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
		return
	}
	
	// Mode normal : téléchargement de module
	fmt.Println("Authenticating with HackTheBox...")
	session := authenticateWithCookies(options.cookies)
	fmt.Println("Downloading requested module...")
	title, content := getModule(options.moduleUrl, session)
	
	// Créer le dossier du module
	moduleDir := sanitizeFileName(title)
	err := os.MkdirAll(moduleDir, 0755)
	if err != nil {
		die(err)
	}
	fmt.Printf("Created directory: %s\n", moduleDir)
	
	if options.localImages {
		fmt.Println("Downloading module images...")
		content = getImagesLocally(content, moduleDir)
	}

	markdownContent := htmlToMarkdown(content)

	// Sauvegarder le fichier markdown dans le dossier du module
	markdownPath := filepath.Join(moduleDir, title+".md")
	err = os.WriteFile(markdownPath, []byte(markdownContent), 0666)
	if err != nil {
		die(err)
	}
	fmt.Printf("Finished downloading module to: %s\n", moduleDir)
}

func htmlToMarkdown(html []string) string {
	converter := md.NewConverter("", true, nil)
	converter.Use(plugin.GitHubFlavored())
	var markdown string
	for _, content := range html {
		m, err := converter.ConvertString(content)
		if err != nil {
			die(err)
		}
		markdown += m + "\n\n\n"
	}

	// Strip some content for proper code blocks.
	markdown = strings.ReplaceAll(markdown, "shell-session", "shell")
	markdown = strings.ReplaceAll(markdown, "powershell-session", "powershell")
	markdown = strings.ReplaceAll(markdown, "[!bash!]$ ", "")

	return markdown
}

func sanitizeFileName(name string) string {
	badChars := []string{"/", "\\", "?", "%", "*", ":", "|", "\"", "<", ">", " "}
	result := name
	for _, badChar := range badChars {
		result = strings.ReplaceAll(result, badChar, "_")
	}
	return result
}
